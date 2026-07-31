import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'

// GET 한 번을 상태로 감싼다.
//
// 두 가지를 신경 썼다.
// 1) 화면을 떠난 뒤 도착한 응답으로 상태를 바꾸지 않는다. 이미 사라진 화면의
//    데이터가 다음 화면에 잠깐 그려지는 일이 실제로 생긴다.
// 2) 다시 불러올 때 기존 데이터를 지우지 않는다. 지우면 새로고침할 때마다
//    화면이 빈 상태로 깜빡이고, 그게 느린 것보다 나쁘게 느껴진다.
export function useApi(path, { skip = false } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(!skip)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    if (skip || !path) return
    setLoading(true)
    try {
      const result = await api.get(path)
      if (alive.current) {
        setData(result)
        setError(null)
      }
    } catch (err) {
      if (alive.current) setError(err.message || '불러오지 못했습니다.')
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [path, skip])

  useEffect(() => {
    load()
  }, [load])

  return { data, error, loading, reload: load, setData }
}
