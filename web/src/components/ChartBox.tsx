import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTheme } from '../state/theme'

/** Renders children with the measured container width (avoids ResponsiveContainer 0-size warnings). */
export function ChartBox({
  height,
  children,
  className = '',
  label,
}: {
  height: number
  children: (width: number) => ReactNode
  className?: string
  label?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (ref.current) setW(Math.floor(ref.current.getBoundingClientRect().width))
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0)
      setW((cur) => (Math.abs(cur - next) >= 1 ? next : cur))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className={className} style={{ height, width: '100%' }} role={label ? 'img' : undefined} aria-label={label}>
      {w > 0 ? children(w) : null}
    </div>
  )
}

function rgbVar(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const parts = raw.split(/\s+/).filter(Boolean)
  return parts.length === 3 ? `rgb(${parts.join(',')})` : raw || '#888'
}

/** "rgb(1,2,3)" -> "rgba(1,2,3,a)" */
export function alpha(color: string, a: number): string {
  return color.startsWith('rgb(') ? color.replace('rgb(', 'rgba(').replace(')', `,${a})`) : color
}

export interface ChartColors {
  bg: string
  surface: string
  ink: string
  muted: string
  line: string
  accent: string
  accentSoft: string
  vlow: string
  low: string
  inrange: string
  high: string
  vhigh: string
  pastfc: string
  scenario: string
}

/** Resolved theme colours for SVG charts (re-read when the theme changes). */
export function useChartColors(): ChartColors {
  const { resolved } = useTheme()
  return useMemo(
    () => ({
      bg: rgbVar('--bg'),
      surface: rgbVar('--surface'),
      ink: rgbVar('--ink'),
      muted: rgbVar('--muted'),
      line: rgbVar('--line'),
      accent: rgbVar('--accent'),
      accentSoft: rgbVar('--accent-soft'),
      vlow: rgbVar('--vlow'),
      low: rgbVar('--low'),
      inrange: rgbVar('--inrange'),
      high: rgbVar('--high'),
      vhigh: rgbVar('--vhigh'),
      pastfc: rgbVar('--pastfc'),
      scenario: rgbVar('--scenario'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved],
  )
}
