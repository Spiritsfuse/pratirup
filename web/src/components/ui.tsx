import { useId, type ReactNode } from 'react'
import { ApiError } from '../api/client'
import { AlertIcon, InfoIcon, RefreshIcon } from './icons'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden="true" />
}

export function ErrorState({
  error,
  onRetry,
  title = 'Could not load this',
  compact = false,
}: {
  error: Error | null
  onRetry?: () => void
  title?: string
  compact?: boolean
}) {
  const status = error instanceof ApiError ? error.status : undefined
  return (
    <div
      role="alert"
      className={cx('card flex flex-wrap items-start gap-3 border-low/50', compact ? 'p-3' : 'p-5')}
    >
      <AlertIcon className="mt-0.5 shrink-0 text-low" width={18} height={18} />
      <div className="min-w-[200px] flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-muted">
          {error?.message ?? 'Unknown error'}
          {status ? <span className="num"> (HTTP {status})</span> : null}
        </p>
      </div>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          <RefreshIcon /> Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  children,
  tone = 'neutral',
}: {
  title: string
  children?: ReactNode
  tone?: 'neutral' | 'notice'
}) {
  return (
    <div
      className={cx(
        'card flex items-start gap-3 p-5',
        tone === 'notice' ? 'border-accent/40 bg-accent-soft' : '',
      )}
    >
      <InfoIcon className="mt-0.5 shrink-0 text-accent" width={18} height={18} />
      <div>
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 text-sm text-muted">{children}</div>}
      </div>
    </div>
  )
}

/** Provenance chips: where a thing on screen comes from. */
export type ProvKind = 'research' | 'replay' | 'forecast' | 'sensitivity' | 'live' | 'devcv' | 'test' | 'observed'
const PROV: Record<ProvKind, { text: string; cls: string; title: string }> = {
  research: {
    text: 'Research record',
    cls: 'border-line text-muted',
    title: 'De-identified research record (ShanghaiT2DM, CC BY 4.0). Real, not synthetic.',
  },
  replay: {
    text: 'Replayed CGM',
    cls: 'border-line text-muted',
    title: 'Real CGM readings from held-out patients, replayed on a demo clock.',
  },
  observed: {
    text: 'Observed CGM',
    cls: 'border-ink/40 text-ink',
    title: 'Measured glucose readings.',
  },
  forecast: {
    text: 'Model forecast',
    cls: 'border-accent/60 bg-accent-soft text-accent',
    title: 'Model output. Experimental.',
  },
  sensitivity: {
    text: 'Sensitivity · not causal',
    cls: 'border-scenario/60 text-scenario',
    title: 'Model sensitivity to a changed input. Associational, not causal.',
  },
  live: {
    text: 'LIVE stream',
    cls: 'border-low/60 text-low',
    title: 'Readings are being streamed into the twin one at a time.',
  },
  devcv: {
    text: 'Development cross-validation',
    cls: 'border-high/70 text-ink',
    title: '5-fold patient-grouped cross-validation on the 80 development patients.',
  },
  test: {
    text: 'Held-out test patients',
    cls: 'border-inrange/70 text-ink',
    title: 'Scored once with the frozen model on 20 patients never used for training or tuning.',
  },
}
export function ProvChip({ kind, text, className = '' }: { kind: ProvKind; text?: string; className?: string }) {
  const p = PROV[kind]
  return (
    <span className={cx('chip', p.cls, className)} title={p.title}>
      {kind === 'live' && <span className="live-dot" aria-hidden="true" style={{ width: 6, height: 6 }} />}
      {text ?? p.text}
    </span>
  )
}

export function LiveBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded border border-low/60 px-1.5 py-px text-xs font-semibold tracking-wide text-low',
        className,
      )}
    >
      <span className="live-dot" aria-hidden="true" style={{ width: 6, height: 6 }} />
      LIVE
    </span>
  )
}

export interface TabDef<K extends string> {
  key: K
  label: string
  disabled?: boolean
  hint?: string
}
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: TabDef<K>[]
  value: K
  onChange: (k: K) => void
  label: string
}) {
  const id = useId()
  return (
    <div role="tablist" aria-label={label} className="scroll-x flex gap-1 overflow-y-hidden border-b border-line">
      {tabs.map((t) => {
        const active = t.key === value
        return (
          <button
            key={t.key}
            role="tab"
            id={`${id}-${t.key}`}
            type="button"
            aria-selected={active}
            aria-controls={`${id}-panel`}
            disabled={t.disabled}
            title={t.hint}
            onClick={() => onChange(t.key)}
            className={cx(
              '-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium',
              active ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink',
              t.disabled && 'cursor-not-allowed opacity-45 hover:text-muted',
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export function Segmented<K extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: K; label: string }[]
  value: K
  onChange: (k: K) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-line">
      {options.map((o, i) => {
        const active = o.key === value
        return (
          <button
            key={String(o.key)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.key)}
            className={cx(
              'min-h-[30px] px-2.5 text-xs font-medium',
              i > 0 && 'border-l border-line',
              active ? 'bg-accent text-surface' : 'bg-surface text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'good' | 'bad' | 'neutral'
}) {
  return (
    <div className="card p-3.5">
      <p className="section-title">{label}</p>
      <p
        className={cx(
          'num mt-1 text-2xl font-medium leading-tight',
          tone === 'good' && 'text-inrange',
          tone === 'bad' && 'text-low',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  )
}

export function PageTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

/** Hatched, outlined notice used for hypothetical scenarios. */
export function Disclosure({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="rounded-md border-2 border-dashed border-scenario/60 bg-surface p-3.5 text-sm">
      {title && <p className="mb-1 font-semibold text-scenario">{title}</p>}
      <div className="text-ink">{children}</div>
    </div>
  )
}
