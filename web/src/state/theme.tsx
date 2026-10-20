import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeSetting = 'auto' | 'light' | 'dark'
const KEY = 'pratirup-theme'

interface ThemeCtx {
  setting: ThemeSetting
  /** what is actually showing */
  resolved: 'light' | 'dark'
  cycle: () => void
}

const Ctx = createContext<ThemeCtx | null>(null)

function readStored(): ThemeSetting {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* storage unavailable (private mode, blocked): fall back to the OS setting */
  }
  return 'auto'
}

function apply(setting: ThemeSetting) {
  const root = document.documentElement
  if (setting === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', setting)
  try {
    if (setting === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, setting)
  } catch {
    /* storage unavailable: the choice just will not persist */
  }
}

function systemDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSetting] = useState<ThemeSetting>(readStored)
  const [sysDark, setSysDark] = useState<boolean>(systemDark)

  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }
    const on = () => setSysDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // The DOM attribute is applied synchronously in the click handler so that charts,
  // which read resolved CSS colours during render, never see the previous theme.
  const cycle = useCallback(() => {
    const next: ThemeSetting = setting === 'auto' ? 'light' : setting === 'light' ? 'dark' : 'auto'
    apply(next)
    setSetting(next)
  }, [setting])

  const resolved: 'light' | 'dark' = setting === 'auto' ? (sysDark ? 'dark' : 'light') : setting
  const value = useMemo(() => ({ setting, resolved, cycle }), [setting, resolved, cycle])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTheme outside ThemeProvider')
  return v
}
