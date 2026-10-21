import type { AlertInfo, AlertKind, Meta, Risk, RiskItem, RiskKind, Stats24h, TierName } from '../api/types'
import { ALERT_SHORT, RISK_ORDER, minutesAgo, prob, pct } from '../lib/format'
import { useApp } from '../state/app'
import { BellIcon } from './icons'
import { cx } from './ui'

/** Text colour for a glucose reading by consensus range. Always paired with the number itself. */
export function glucoseTone(g: number | null): string {
  if (g == null) return 'text-muted'
  if (g < 54) return 'text-vlow'
  if (g < 70) return 'text-low'
  if (g > 250) return 'text-vhigh'
  if (g > 180) return 'text-high'
  return 'text-ink'
}

// ---------------------------------------------------------------- priority

const TIER_STYLE: Record<TierName, { cls: string; swatch: string; label: string; blurb: string }> = {
  urgent: {
    cls: 'border-low bg-low text-surface font-semibold',
    swatch: '',
    label: 'Urgent',
    blurb: 'Glucose is below 70 mg/dL now',
  },
  act: {
    cls: 'border-vhigh bg-vhigh/15 text-ink font-semibold',
    swatch: 'bg-vhigh',
    label: 'Act',
    blurb: 'An alert fired in the last 60 min, or glucose is above 250 mg/dL now',
  },
  watch: {
    cls: 'border-high bg-high/15 text-ink font-semibold',
    swatch: 'bg-high',
    label: 'Watch',
    blurb: 'Raised risk of leaving range within 60 min (ranked, no alert)',
  },
  data: {
    cls: 'border-dashed border-muted text-muted',
    swatch: 'bg-muted',
    label: 'Data',
    blurb: 'No recent CGM reading',
  },
  review: {
    cls: 'border-accent text-accent',
    swatch: 'bg-accent',
    label: 'Review',
    blurb: 'Time out of range worth a look over the last 24 h',
  },
  stable: {
    cls: 'border-inrange text-ink',
    swatch: 'bg-inrange',
    label: 'Stable',
    blurb: 'Within targets',
  },
  waiting: {
    cls: 'border-line text-muted',
    swatch: 'bg-line',
    label: 'Waiting',
    blurb: 'Waiting for enough CGM data',
  },
  ended: { cls: 'border-line text-muted', swatch: 'bg-line', label: 'Ended', blurb: 'CGM wear has finished' },
}
export const TIER_ORDER: TierName[] = ['urgent', 'act', 'watch', 'data', 'review', 'stable', 'waiting', 'ended']
export function tierInfo(name: TierName) {
  return TIER_STYLE[name]
}

export function PriorityChip({ name, className = '' }: { name: TierName; className?: string }) {
  const s = TIER_STYLE[name]
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-xs uppercase tracking-wide',
        s.cls,
        className,
      )}
    >
      {s.swatch && <span className={cx('h-2 w-2 rounded-[2px]', s.swatch)} aria-hidden="true" />}
      {s.label}
    </span>
  )
}

// ---------------------------------------------------------------- regimen

const SHORT: Record<string, string> = {
  'alpha-glucosidase inhibitor': 'α-glucosidase inh.',
  'no glucose-lowering drug recorded': 'no agent recorded',
}
export function RegimenChips({ items, limit }: { items: string[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items
  const rest = items.length - shown.length
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((r) => (
        <span key={r} className="chip" title={r}>
          {SHORT[r] ?? r}
        </span>
      ))}
      {rest > 0 && <span className="chip">+{rest}</span>}
    </span>
  )
}

// ---------------------------------------------------------------- AGP bar

export const AGP = {
  vlow: 'bg-vlow',
  low: 'bg-low',
  inrange: 'bg-inrange',
  high: 'bg-high',
  vhigh: 'bg-vhigh',
}

export function agpSegments(s: Stats24h) {
  const tbr = s.tbr ?? 0
  const tbr2 = s.tbr_l2 ?? 0
  const tar = s.tar ?? 0
  const tar2 = s.tar_l2 ?? 0
  return [
    { key: 'vlow', label: 'Below 54', v: tbr2, cls: AGP.vlow },
    { key: 'low', label: '54–69', v: Math.max(0, tbr - tbr2), cls: AGP.low },
    { key: 'inrange', label: '70–180', v: s.tir ?? 0, cls: AGP.inrange },
    { key: 'high', label: '181–250', v: Math.max(0, tar - tar2), cls: AGP.high },
    { key: 'vhigh', label: 'Above 250', v: tar2, cls: AGP.vhigh },
  ]
}

export function AgpBar({ stats, height = 10, className = '' }: { stats: Stats24h; height?: number; className?: string }) {
  if (!stats.n || stats.tir == null) {
    return <div className={cx('rounded bg-line/60', className)} style={{ height }} aria-label="No 24-hour data" role="img" />
  }
  const segs = agpSegments(stats)
  const label = `Last 24 hours: ${segs.map((s) => `${s.label} mg/dL ${pct(s.v)}`).join(', ')}`
  return (
    <div
      className={cx('flex w-full gap-px overflow-hidden rounded-[3px]', className)}
      style={{ height }}
      role="img"
      aria-label={label}
      title={label}
    >
      {segs.map((s) => (
        <div key={s.key} className={s.cls} style={{ width: `${s.v * 100}%`, display: s.v > 0 ? undefined : 'none' }} />
      ))}
    </div>
  )
}

export function AgpLegend({ stats }: { stats: Stats24h }) {
  if (!stats.n || stats.tir == null) return null
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {agpSegments(stats).map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className={cx('h-2.5 w-2.5 rounded-[2px]', s.cls)} aria-hidden="true" />
          <span>{s.label}</span>
          <span className="num text-ink">{pct(s.v)}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- alerts

const ALERT_BADGE: Record<AlertKind, { box: string; icon: string }> = {
  hypo: { box: 'border-low bg-low/10', icon: 'text-low' },
  hyper2: { box: 'border-vhigh bg-vhigh/10', icon: 'text-vhigh' },
}

/** Interruptive-alert badge. Text stays in the ink colour for contrast; the bell and border carry the hue. */
export function AlertBadge({ alert, nowT, className = '' }: { alert: AlertInfo; nowT?: number; className?: string }) {
  const st = ALERT_BADGE[alert.kind]
  const ago = nowT != null ? minutesAgo(Math.max(0, nowT - alert.t)) : ''
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-x-1.5', className)}>
      <span
        className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-xs font-semibold text-ink', st.box)}
        title={alert.label}
      >
        <BellIcon width={13} height={13} className={st.icon} />
        Alert · {ALERT_SHORT[alert.kind]}
      </span>
      {ago && <span className="text-xs text-muted">{ago}</span>}
    </span>
  )
}

/**
 * Which probability gates a risk row. <70 and >250 use the consolidated alert policy thresholds;
 * >180 is a ranking signal, so its threshold is only a reference tick.
 */
export function riskGate(kind: RiskKind, r: RiskItem, meta: Meta | null): { alerting: boolean; threshold: number; above: boolean } {
  const alerting = kind !== 'hyper'
  const pol = alerting ? meta?.alert_policy?.thresholds?.[kind as AlertKind] : undefined
  const threshold = pol ?? r.threshold
  return { alerting, threshold, above: r.p != null && r.p >= threshold }
}

// ---------------------------------------------------------------- risk mini bars

export const RISK_SHORT: Record<RiskKind, string> = { hypo: '<70', hyper: '>180', hyper2: '>250' }
export const RISK_FILL: Record<RiskKind, string> = { hypo: 'bg-low', hyper: 'bg-high', hyper2: 'bg-vhigh' }
export const RISK_NOW: Record<RiskKind, string> = {
  hypo: 'Already below 70 mg/dL',
  hyper: 'Already above 180 mg/dL',
  hyper2: 'Already above 250 mg/dL',
}
/** Bar length uses a square-root scale so small probabilities stay visible. */
export function riskPos(p: number): number {
  return Math.sqrt(Math.min(1, Math.max(0, p))) * 100
}

export function RiskMini({ risk, abstain = false }: { risk: Risk; abstain?: boolean }) {
  const { meta } = useApp()
  return (
    <ul className="space-y-1" aria-label="Probability within the next 60 minutes">
      {RISK_ORDER.map((k) => {
        const r = risk[k]
        const g = riskGate(k, r, meta)
        const now = !r.at_risk && r.p == null
        const kindNote = g.alerting ? 'alert threshold' : 'ranking signal, no alert, reference level'
        const desc = abstain
          ? 'no forecast'
          : now
            ? RISK_NOW[k].toLowerCase()
            : `${prob(r.p)}, ${kindNote} ${prob(g.threshold)}, ${g.above ? 'above' : 'below'}`
        return (
          <li key={k} className="flex items-center gap-2" aria-label={`${RISK_SHORT[k]} mg/dL: ${desc}`}>
            <span className="num w-9 shrink-0 text-xs text-muted">{RISK_SHORT[k]}</span>
            {abstain || now ? (
              <span className="flex-1 text-xs italic text-muted">{abstain ? 'no forecast' : RISK_NOW[k].replace(' mg/dL', '').replace('Already ', 'now ')}</span>
            ) : (
              <>
                <span
                  className="relative block h-1.5 min-w-[56px] flex-1 rounded-full bg-line/80"
                  aria-hidden="true"
                  title={g.alerting ? `Alert threshold ${prob(g.threshold)}` : `Ranking signal only, no alert. Reference level ${prob(g.threshold)}`}
                >
                  <span
                    className={cx('absolute inset-y-0 left-0 rounded-full', g.above ? RISK_FILL[k] : 'bg-muted/45')}
                    style={{ width: `${riskPos(r.p ?? 0)}%` }}
                  />
                  <span
                    className={cx('absolute -top-[3px] h-[12px] w-[2px] rounded-full', g.alerting ? 'bg-ink' : 'bg-muted/70')}
                    style={{ left: `${riskPos(g.threshold)}%` }}
                  />
                </span>
                <span className={cx('num w-9 shrink-0 text-right text-xs', g.above ? 'font-semibold text-ink' : 'text-muted')}>
                  {prob(r.p)}
                </span>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}
