import { useCallback, useEffect, useRef, useState } from 'react'

export interface ApiState<T> {
  data: T | null
  error: Error | null
  /** true until the first response (or error) arrives */
  loading: boolean
  /** true while any request is in flight (including background polls) */
  fetching: boolean
  reload: () => void
}

interface Options {
  /** poll interval in ms; requests never overlap */
  pollMs?: number
  /** set false to hold off fetching */
  enabled?: boolean
}

/**
 * Small fetch hook. Keeps the previous response on screen while a new one loads
 * (so clock playback does not flicker) and coalesces overlapping requests: at most
 * one request is in flight, and one follow-up fires with the latest inputs.
 */
export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  { pollMs, enabled = true }: Options = {},
): ApiState<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({
    data: null,
    error: null,
    loading: enabled,
  })
  const [fetching, setFetching] = useState(false)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const inflight = useRef(false)
  const queued = useRef(false)
  const alive = useRef(true)
  const ctrl = useRef<AbortController | null>(null)

  const run = useCallback(() => {
    if (inflight.current) {
      queued.current = true
      return
    }
    inflight.current = true
    setFetching(true)
    const c = new AbortController()
    ctrl.current = c
    fetcherRef
      .current(c.signal)
      .then((data) => {
        if (alive.current) setState({ data, error: null, loading: false })
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name === 'AbortError' || !alive.current) return
        setState((s) => ({ data: s.data, error: e as Error, loading: false }))
      })
      .finally(() => {
        inflight.current = false
        if (alive.current && queued.current) {
          queued.current = false
          run()
        } else if (alive.current) {
          setFetching(false)
        }
      })
  }, [])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      ctrl.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  useEffect(() => {
    if (!pollMs || !enabled) return
    const id = setInterval(run, pollMs)
    return () => clearInterval(id)
  }, [pollMs, enabled, run])

  const reload = useCallback(() => {
    setState((s) => (s.data ? { ...s, error: null } : { data: null, error: null, loading: true }))
    run()
  }, [run])

  return { data: state.data, error: state.error, loading: state.loading, fetching, reload }
}
