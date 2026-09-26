import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api } from '../api/client.ts'
import { accessBlocked, getAccessSession, subscribeAccessSession } from '../lib/accessSession.js'

// GET 한 번을 상태로 감싼다.
//
// 세 가지를 신경 썼다.
// 1) 화면을 떠난 뒤 도착한 응답으로 상태를 바꾸지 않는다. 이미 사라진 화면의
//    데이터가 다음 화면에 잠깐 그려지는 일이 실제로 생긴다.
// 2) 일시적인 재조회 실패에는 현재 데이터를 유지하되, 접근이 거절되거나
//    리소스가 사라진 응답이면 원문과 그 원문에 대한 작업 화면을 숨긴다.
// 3) **늦게 온 응답이 최신 응답을 덮어쓰지 않는다.**
//
// 3번이 빠져 있었다. alive 는 화면을 떠났는지만 본다. 같은 화면에 머문 채
// 주소만 바뀌는 경우 — 부서가 조회 화면에서 "묶인 그 신청서 보기"를 누르거나,
// 담당자가 목록에서 다른 건으로 옮겨 갈 때 — 는 둘 다 alive 라서 먼저 보낸
// 요청이 나중에 도착하면 그대로 덮어쓴다.
//
// 그러면 **주소는 B인데 화면은 A**가 된다. 예외도 안 나고 화면도 안 깨진다.
// 부서는 남의 신청서를 자기 것으로 읽고, 그 화면에서 서명하거나 확인을
// 누른다. 이 사이트에서 가장 조용하고 가장 나쁜 종류다.
//
// 요청마다 번호를 매기고 **마지막에 보낸 것만** 받는다.
export function useApi(path, { skip = false } = {}) {
  const access = useSyncExternalStore(subscribeAccessSession, getAccessSession, getAccessSession)
  const blocked = accessBlocked(access)
  const resourcePath = skip || !path ? null : path
  const resourceKey = resourcePath ? `${access.generation}:${resourcePath}` : null
  const [snapshot, setSnapshot] = useState(() => ({
    key: resourceKey,
    data: null,
    error: null,
    loading: Boolean(resourceKey),
  }))
  const alive = useRef(true)
  const seq = useRef(0)
  const controller = useRef(null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      controller.current?.abort()
    }
  }, [])

  const load = useCallback(async () => {
    if (!alive.current) return
    const mine = ++seq.current
    controller.current?.abort()
    controller.current = null
    if (!resourceKey || blocked) {
      setSnapshot({ key: null, data: null, error: null, loading: false })
      return
    }

    // 내가 보낸 것이 아직 최신인가. 응답을 쓰기 직전마다 다시 본다.
    const pending = new AbortController()
    controller.current = pending
    const latest = () => alive.current && seq.current === mine && !pending.signal.aborted
      && getAccessSession().generation === access.generation && !accessBlocked(getAccessSession())
    setSnapshot((previous) =>
      previous.key === resourceKey
        ? { ...previous, loading: true }
        : { key: resourceKey, data: null, error: null, loading: true }
    )
    try {
      const result = await api.get(resourcePath, { signal: pending.signal })
      if (latest()) {
        setSnapshot({ key: resourceKey, data: result, error: null, loading: true })
      }
    } catch (err) {
      if (latest()) {
        const unavailable = [401, 403, 404, 410].includes(err.status)
        setSnapshot((previous) => ({
          key: resourceKey,
          data: !unavailable && previous.key === resourceKey ? previous.data : null,
          error: err.message || '불러오지 못했습니다.',
          loading: true,
        }))
      }
    } finally {
      // 뒤처진 응답은 loading 도 안 건드린다. 건드리면 아직 오는 중인
      // 최신 요청이 다 온 것처럼 보인다.
      if (latest()) {
        setSnapshot((previous) =>
          previous.key === resourceKey ? { ...previous, loading: false } : previous
        )
      }
    }
  }, [resourceKey, resourcePath, blocked, access.generation])

  useEffect(() => {
    load()
    return () => { controller.current?.abort() }
  }, [load])

  const setData = useCallback(
    (next) => {
      if (getAccessSession().generation !== access.generation || accessBlocked(getAccessSession())) return
      setSnapshot((previous) => {
        const previousData = previous.key === resourceKey ? previous.data : null
        return {
          key: resourceKey,
          data: typeof next === 'function' ? next(previousData) : next,
          error: previous.key === resourceKey ? previous.error : null,
          loading: previous.key === resourceKey ? previous.loading : false,
        }
      })
    },
    [resourceKey, access.generation]
  )

  // effect가 새 요청을 시작하기 전 렌더에서도 다른 URL의 상태는 숨긴다.
  const isCurrentResource = snapshot.key === resourceKey
  const data = !blocked && isCurrentResource ? snapshot.data : null
  const error = resourcePath && access.status === 'blocked'
    ? access.error || '접근 권한을 다시 확인해 주세요.'
    : isCurrentResource ? snapshot.error : null
  const loading = resourcePath ? (blocked ? access.status === 'checking' : isCurrentResource ? snapshot.loading : true) : false

  return { data, error, loading, reload: load, setData }
}
