import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { useApi } from './useApi.js'
import { useActionLifetime } from './useActionLifetime.js'
import { accessBlocked, getAccessSession, subscribeAccessSession } from '../lib/accessSession.js'

const count = value => Number.isSafeInteger(value) && value >= 0

function validFeed(value, number, basis) {
  const page = value?.page
  if (!page || page.number !== number || page.size !== 100 || !count(page.total)
    || page.totalPages !== Math.max(1, Math.ceil(page.total / 100))
    || page.hasPrevious !== (number > 1) || page.hasMore !== (number * 100 < page.total)
    || typeof page.basis !== 'string' || !/^[a-f0-9]{64}$/.test(page.basis) || (basis && basis !== page.basis)
    || !Array.isArray(value.tools) || !value.summary || value.summary.total !== page.total
    || !['total', 'open', 'urgent', 'fixed', 'toolsUntrusted'].every(key => count(value.summary[key]))
    || value.summary.open + value.summary.fixed !== page.total || value.summary.urgent > value.summary.open
    || value.summary.toolsUntrusted > value.summary.urgent) return false
  let shown = 0
  const apps = new Set(), originals = new Set()
  const known = { total: 0, open: 0, fixed: 0, urgent: 0, toolsUntrusted: 0 }
  for (const tool of value.tools) {
    if (!tool || typeof tool.applicationId !== 'string' || !tool.applicationId || apps.has(tool.applicationId) || !Array.isArray(tool.reports)
      || !['total', 'open', 'urgent', 'fixed'].every(key => count(tool[key]))
      || tool.open + tool.fixed !== tool.total || tool.urgent > tool.open || tool.reports.length > tool.total
      || tool.total > page.total || tool.open > value.summary.open || tool.fixed > value.summary.fixed || tool.urgent > value.summary.urgent) return false
    apps.add(tool.applicationId)
    for (const key of ['total', 'open', 'fixed', 'urgent']) known[key] += tool[key]
    if (tool.urgent > 0) known.toolsUntrusted += 1
    let open = 0, fixed = 0, urgent = 0
    for (const report of tool.reports) {
      if (!report || typeof report.id !== 'string' || !report.id || originals.has(report.id) || typeof report.body !== 'string'
        || typeof report.open !== 'boolean' || typeof report.urgent !== 'boolean') return false
      originals.add(report.id)
      if (report.open) { open += 1; if (report.urgent) urgent += 1 } else fixed += 1
      shown += 1
    }
    if (open > tool.open || fixed > tool.fixed || urgent > tool.urgent) return false
  }
  return Object.keys(known).every(key => known[key] <= value.summary[key])
    && shown === Math.max(0, Math.min(100, page.total - (number - 1) * 100))
}

// The basis belongs to a visible, read-only list version, not a write receipt.
// Page changes hide old originals; transient refresh failures keep them locked.
export function useReportFeed() {
  const session = useSyncExternalStore(subscribeAccessSession, getAccessSession, getAccessSession)
  const location = useLocation()
  const identity = `${session.generation}:${location.key}:${location.pathname}`
  const capture = useActionLifetime(identity)
  const [navigation, setNavigation] = useState({ identity, number: 1, basis: null })
  const active = navigation.identity === identity ? navigation : { identity, number: 1, basis: null }
  const lock = useRef({ identity, pending: false })
  if (lock.current.identity !== identity) lock.current = { identity, pending: false }
  const path = active.number === 1 && !active.basis ? '/reports'
    : `/reports?page=${active.number}${active.basis ? `&basis=${active.basis}` : ''}`
  const resource = useApi(path)
  const malformed = resource.data && !validFeed(resource.data, active.number, active.basis)
  const changed = resource.errorStatus === 409
  const denied = [401, 403, 404, 410].includes(resource.errorStatus) || accessBlocked(session)
  const error = resource.error || (malformed ? '신고 목록 응답을 확인하지 못했습니다. 다시 조회해주세요.' : null)
  const data = !changed && !denied && !malformed ? resource.data : null

  useEffect(() => {
    if (!resource.loading) lock.current.pending = false
  }, [resource.loading, resource.data, resource.error, path])

  function current() {
    return getAccessSession().generation === session.generation && !accessBlocked(getAccessSession())
  }
  function move(number) {
    if (!current() || lock.current.pending || resource.loading || error || !data) return
    if (!Number.isSafeInteger(number) || number < 1 || number > 10000 || number === data.page.number
      || (number > data.page.number && !data.page.hasMore)
      || (number < data.page.number && !data.page.hasPrevious)) return
    lock.current.pending = true
    setNavigation({ identity, number, basis: data.page.basis })
  }
  async function read(first = false, afterWrite = false) {
    const viewCurrent = capture()
    if (!current() || !viewCurrent() || (!afterWrite && (lock.current.pending || resource.loading))) return
    const operation = lock.current
    operation.pending = true
    if (first && path !== '/reports') {
      setNavigation({ identity, number: 1, basis: null })
      return
    }
    try { return await resource.reload() } finally {
      if (viewCurrent() && current() && lock.current === operation) operation.pending = false
    }
  }
  return {
    data, error, changed, denied, loading: resource.loading, identity,
    locked: resource.loading || Boolean(error) || denied,
    shown: data?.tools.reduce((sum, tool) => sum + tool.reports.length, 0) ?? 0,
    previous: () => move(active.number - 1), next: () => move(active.number + 1),
    retry: () => read(), first: () => read(true), afterWrite: () => read(true, true),
  }
}
