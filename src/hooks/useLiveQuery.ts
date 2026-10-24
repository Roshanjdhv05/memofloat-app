import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventName } from '@shared/types'
import { api, messageOf } from '../lib/api'

export interface LiveQuery<T> {
  data: T | undefined
  /** True only until the first result arrives (refreshes keep showing the previous data). */
  loading: boolean
  error: string | null
  refresh: () => void
}

/**
 * Loads data through the preload API and keeps it fresh when the main process announces changes.
 *
 * - Change events are coalesced: the first event refetches at once, a burst after it triggers at most
 *   one more refetch per `coalesceMs`.
 * - While the window is hidden no refetch happens; one runs when it becomes visible again.
 * - Responses that arrive out of order are discarded, so older data never overwrites newer data.
 */
export function useLiveQuery<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
  events: readonly EventName[],
  coalesceMs = 350
): LiveQuery<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher
  const sequence = useRef(0)
  const stale = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback(async () => {
    const mine = ++sequence.current
    stale.current = false
    try {
      const value = await fetchRef.current()
      if (mine !== sequence.current) return
      setData(value)
      setError(null)
    } catch (e) {
      if (mine !== sequence.current) return
      setError(messageOf(e))
    } finally {
      if (mine === sequence.current) setLoading(false)
    }
  }, [])

  // Re-run when the query changes.
  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Refetch on change events: the first event after a quiet period refetches immediately (so a click
  // on "pin" feels instant); further events inside the window collapse into one trailing refetch.
  useEffect(() => {
    let trailing = false
    const arm = () => {
      timer.current = setTimeout(() => {
        timer.current = null
        if (trailing) {
          trailing = false
          void run()
          arm()
        }
      }, coalesceMs)
    }
    const onChange = () => {
      if (document.hidden) {
        stale.current = true
        return
      }
      if (timer.current) {
        trailing = true
        return
      }
      void run()
      arm()
    }
    const unsubscribe = events.map((name) => api().on(name, onChange as never))
    const onVisible = () => {
      if (!document.hidden && stale.current) void run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      unsubscribe.forEach((off) => off())
      document.removeEventListener('visibilitychange', onVisible)
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, coalesceMs, events.join('|')])

  return { data, loading, error, refresh: () => void run() }
}
