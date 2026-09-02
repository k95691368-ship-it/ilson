import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'

// GET 한 번을 상태로 감싼다.
//
// 세 가지를 신경 썼다.
// 1) 화면을 떠난 뒤 도착한 응답으로 상태를 바꾸지 않는다. 이미 사라진 화면의
//    데이터가 다음 화면에 잠깐 그려지는 일이 실제로 생긴다.
// 2) 다시 불러올 때 기존 데이터를 지우지 않는다. 지우면 새로고침할 때마다
//    화면이 빈 상태로 깜빡이고, 그게 느린 것보다 나쁘게 느껴진다.
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
  const resourceKey = skip || !path ? null : path
  const [snapshot, setSnapshot] = useState(() => ({
    key: resourceKey,
    data: null,
    error: null,
    loading: Boolean(resourceKey),
  }))
  const alive = useRef(true)
  const seq = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    const mine = ++seq.current
    if (!resourceKey) {
      setSnapshot({ key: null, data: null, error: null, loading: false })
      return
    }

    // 내가 보낸 것이 아직 최신인가. 응답을 쓰기 직전마다 다시 본다.
    const latest = () => alive.current && seq.current === mine
    setSnapshot((previous) =>
      previous.key === resourceKey
        ? { ...previous, loading: true }
        : { key: resourceKey, data: null, error: null, loading: true }
    )
    try {
      const result = await api.get(resourceKey)
      if (latest()) {
        setSnapshot({ key: resourceKey, data: result, error: null, loading: true })
      }
    } catch (err) {
      if (latest()) {
        setSnapshot((previous) => ({
          key: resourceKey,
          data: previous.key === resourceKey ? previous.data : null,
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
  }, [resourceKey])

  useEffect(() => {
    load()
  }, [load])

  const setData = useCallback(
    (next) => {
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
    [resourceKey]
  )

  // effect가 새 요청을 시작하기 전 렌더에서도 다른 URL의 상태는 숨긴다.
  const isCurrentResource = snapshot.key === resourceKey
  const data = isCurrentResource ? snapshot.data : null
  const error = isCurrentResource ? snapshot.error : null
  const loading = resourceKey ? (isCurrentResource ? snapshot.loading : true) : false

  return { data, error, loading, reload: load, setData }
}
