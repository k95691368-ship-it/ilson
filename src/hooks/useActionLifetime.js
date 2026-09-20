import { useCallback, useEffect, useRef } from 'react'

// A completed server write stays completed. This only suppresses UI effects from
// a request whose form has since changed identity or left the screen.
export function useActionLifetime(identity) {
  const current = useRef({ identity, active: false, generation: 0 })
  if (current.current.identity !== identity) current.current = { identity, active: false, generation: 0 }

  useEffect(() => {
    const view = current.current
    view.active = true
    view.generation += 1
    return () => { view.active = false; view.generation += 1 }
  }, [identity])

  return useCallback(() => {
    const view = current.current
    const generation = view.generation
    return () => current.current === view && view.active && view.generation === generation
  }, [])
}
