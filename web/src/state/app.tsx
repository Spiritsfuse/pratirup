import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Meta } from '../api/types'
import { useApi } from '../hooks/useApi'
import { clamp } from '../lib/format'

/** Routes that depend on the demo clock. Playback stops elsewhere. */
export function isClockRoute(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/patients/')
}

export type PlaySpeed = 1 | 4

interface AppCtx {
  meta: Meta | null
  metaError: Error | null
  metaLoading: boolean
  reloadMeta: () => void
  /** current demo minute, null until /api/meta has loaded and the URL has no ?t= */
  t: number | null
  tMin: number
  tMax: number
  tDefault: number
  setT: (t: number) => void
  step: (deltaMin: number) => void
  jumpDefault: () => void
  playing: boolean
  setPlaying: (p: boolean) => void
  speed: PlaySpeed
  setSpeed: (s: PlaySpeed) => void
  /** path + ?t= (and any extra params) so links keep the clock */
  link: (path: string, extra?: Record<string, string>) => string
}

const Ctx = createContext<AppCtx | null>(null)
const TICK_MIN = 15

export function AppProvider({ children }: { children: ReactNode }) {
  const meta = useApi((s) => api.meta(s), [])
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  const [playing, setPlayingState] = useState(false)
  const [speed, setSpeed] = useState<PlaySpeed>(1)

  const m = meta.data
  // Slider grid is aligned to multiples of 15 so step buttons land on clean times.
  const tMin = m ? Math.ceil(m.clock.min / TICK_MIN) * TICK_MIN : 0
  const tMax = m ? Math.floor(m.clock.max / TICK_MIN) * TICK_MIN : 0
  const tDefault = m ? m.clock.default : 0

  const raw = params.get('t')
  const parsed = raw != null && /^\d+$/.test(raw) ? Number(raw) : null
  const t = m ? clamp(parsed ?? tDefault, tMin, tMax) : null

  const tRef = useRef<number | null>(t)
  tRef.current = t
  const setParamsRef = useRef(setParams)
  setParamsRef.current = setParams

  const setT = useCallback((next: number) => {
    setParamsRef.current(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.set('t', String(Math.round(next)))
        return p
      },
      { replace: true },
    )
  }, [])

  const step = useCallback(
    (delta: number) => {
      const cur = tRef.current
      if (cur == null) return
      setT(clamp(Math.round(cur / TICK_MIN) * TICK_MIN + delta, tMin, tMax))
    },
    [setT, tMin, tMax],
  )

  const jumpDefault = useCallback(() => setT(tDefault), [setT, tDefault])

  // Make links shareable: write the effective clock into the URL when a clock page has no ?t=.
  useEffect(() => {
    if (isClockRoute(pathname) && t != null && parsed == null) setT(t)
  }, [pathname, t, parsed, setT])

  // Playback stops when leaving clock pages or reaching the end of the recordings.
  useEffect(() => {
    if (!isClockRoute(pathname)) setPlayingState(false)
  }, [pathname])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const cur = tRef.current
      if (cur == null) return
      const next = Math.floor(cur / TICK_MIN) * TICK_MIN + TICK_MIN
      if (next >= tMax) {
        setT(tMax)
        setPlayingState(false)
      } else {
        setT(next)
      }
    }, 1000 / speed)
    return () => window.clearInterval(id)
  }, [playing, speed, tMax, setT])

  const setPlaying = useCallback((p: boolean) => setPlayingState(p), [])

  const link = useCallback(
    (path: string, extra?: Record<string, string>) => {
      const p = new URLSearchParams()
      if (tRef.current != null) p.set('t', String(tRef.current))
      if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v)
      const q = p.toString()
      return q ? `${path}?${q}` : path
    },
    [],
  )

  const value = useMemo<AppCtx>(
    () => ({
      meta: m,
      metaError: meta.error,
      metaLoading: meta.loading,
      reloadMeta: meta.reload,
      t,
      tMin,
      tMax,
      tDefault,
      setT,
      step,
      jumpDefault,
      playing,
      setPlaying,
      speed,
      setSpeed,
      link,
    }),
    [m, meta.error, meta.loading, meta.reload, t, tMin, tMax, tDefault, setT, step, jumpDefault, playing, setPlaying, speed, link],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
