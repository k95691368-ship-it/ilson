import { useState } from 'react'
import { useApi } from './useApi.js'

// Filtering and issue selection define independent cursor histories. A changed
// resource key hides the previous response immediately in useApi.
export function useOverrideEvents(filters, { refresh = '', skip = false } = {}) {
  const params = new URLSearchParams(Object.entries(filters).filter(([name, value]) => value != null && value !== ''
    && !(['productId', 'validity', 'action'].includes(name) && value === 'all')))
  const filterKey = params.toString()
  const [navigation, setNavigation] = useState({ key: filterKey, cursors: [''] })
  if (navigation.key !== filterKey) setNavigation({ key: filterKey, cursors: [''] })
  const cursors = navigation.key === filterKey ? navigation.cursors : ['']
  const cursor = cursors.at(-1)
  if (cursor) params.set('cursor', cursor)
  if (refresh) params.set('refresh', refresh)
  const resource = useApi(`/override/events${params.size ? `?${params}` : ''}`, { skip })
  const page = resource.data?.page
  return { ...resource, events: resource.data?.events ?? [], page, pageNumber: cursors.length,
    hasPrevious: cursors.length > 1,
    previous: () => setNavigation({ key: filterKey, cursors: cursors.slice(0, -1) }),
    next: () => { if (page?.hasMore && page.nextCursor) setNavigation({ key: filterKey, cursors: [...cursors, page.nextCursor] }) },
  }
}
