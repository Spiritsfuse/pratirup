import type { AlertKind, DriverSource, EventKind, RiskKind, Trend } from '../api/types'

/** Demo clock helpers. t = wear-day index * 1440 + minute of day. */
export function dayIndex(t: number): number {
  return Math.floor(t / 1440)
}
export function hhmm(t: number): string {
  const m = ((Math.round(t) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
export function clockLabel(t: number): string {
  return `Day ${dayIndex(t) + 1} · ${hhmm(t)}`
}
export function snap15(t: number): number {
  return Math.round(t / 15) * 15
}

export function round(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '–'
  return n.toFixed(digits)
}
export function signed(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '–'
  const s = n.toFixed(digits)
  return n > 0 ? `+${s}` : s
}
/** fraction (0–1) -> "12%" */
export function pct(frac: number | null | undefined, digits = 0): string {
  if (frac == null || Number.isNaN(frac)) return '–'
  return `${(frac * 100).toFixed(digits)}%`
}
/** Probabilities: show "<1%" rather than a misleading "0%". */
export function prob(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return '–'
  const v = p * 100
  if (v > 0 && v < 1) return '<1%'
  return `${v.toFixed(0)}%`
}
export function minutesAgo(m: number | null | undefined): string {
  if (m == null) return ''
  if (m <= 0) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)} h ${m % 60} min ago`
}

export const TREND_TEXT: Record<Trend, string> = {
  rising_fast: 'rising fast',
  rising: 'rising',
  rising_slow: 'rising slowly',
  steady: 'steady',
  falling_slow: 'falling slowly',
  falling: 'falling',
  falling_fast: 'falling fast',
}

export const RISK_LABEL: Record<RiskKind, string> = {
  hypo: 'Below 70',
  hyper: 'Above 180',
  hyper2: 'Above 250',
}
export const RISK_ORDER: RiskKind[] = ['hypo', 'hyper', 'hyper2']

/** Interruptive alerts (model v2): only a predicted low or a predicted very high. */
export const ALERT_SHORT: Record<AlertKind, string> = { hypo: 'predicted < 70', hyper2: 'predicted > 250' }
export const ALERT_TEXT: Record<AlertKind, string> = {
  hypo: 'Glucose predicted to fall below 70 mg/dL within 60 min',
  hyper2: 'Glucose predicted to exceed 250 mg/dL within 60 min',
}

export const SOURCE_LABEL: Record<string, string> = {
  cgm: 'CGM',
  logs: 'Logs',
  'clinical record': 'Clinical record',
  'personal history': 'Personal history',
  time: 'Time',
}
export function sourceKey(s: DriverSource | string): string {
  return s in SOURCE_LABEL ? s : 'cgm'
}

export const EVENT_LABEL: Record<EventKind, string> = {
  meal: 'Meal',
  insulin: 'Insulin',
  oral: 'Oral agent',
  csii_bolus: 'Pump bolus',
  csii_basal_rate: 'Pump basal rate',
  insulin_iv: 'IV insulin',
}

export function eventSentence(e: { kind: EventKind; detail: string; amount: number | null; unit: string | null }): string {
  const base = EVENT_LABEL[e.kind] ?? e.kind
  const amt = e.amount != null ? ` ${e.amount % 1 === 0 ? e.amount : e.amount.toFixed(1)} ${e.unit ?? ''}`.trimEnd() : ''
  const detail = e.detail && e.detail !== 'data not available' ? `: ${e.detail}` : e.detail ? ' (details not recorded)' : ''
  return `${base}${amt}${detail}`
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function sexLabel(s: string | null | undefined): string {
  if (!s) return ''
  return s.toLowerCase().startsWith('f') ? 'F' : s.toLowerCase().startsWith('m') ? 'M' : s
}
