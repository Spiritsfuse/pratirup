import type { ReactNode } from 'react'
import type { Evaluation, ModelDef } from '../../api/types'
import { ProvChip, cx } from '../../components/ui'

export type Basis = 'test' | 'dev_cv'

export interface Ctx {
  ev: Evaluation
  basis: Basis
}

export const HORIZON_NOTE = (h: string | number) => (Number(h) > 60 ? ' (exploratory)' : '')

export function modelLabel(ev: Evaluation, key: string): string {
  return ev.models.find((m) => m.key === key)?.label ?? key
}
export function modelKind(ev: Evaluation, key: string): ModelDef['kind'] {
  return ev.models.find((m) => m.key === key)?.kind ?? 'baseline'
}
/** The headline Pratirup model: the last model flagged as pratirup. */
export function primaryModel(ev: Evaluation): string {
  const p = ev.models.filter((m) => m.kind === 'pratirup')
  return p.length ? p[p.length - 1].key : 'lgbm[full]+personal'
}
export function sortedHorizons(block: Record<string, unknown>): string[] {
  return Object.keys(block).sort((a, b) => Number(a) - Number(b))
}
/** Mirror of the key mangling used by the bootstrap output: "lgbm[cgm+events]" -> "lgbm_cgm_events". */
export function safeKey(k: string): string {
  return k.replace(/\[/g, '_').replace(/\]/g, '').replace(/\+/g, '_')
}

export const SOURCE_GROUP: Record<string, { label: string; color: string }> = {
  cgm: { label: 'CGM history', color: '#2a8fa8' },
  time: { label: 'Time of day', color: '#b5598a' },
  events: { label: 'Logs (meals, insulin, pumps)', color: '#c98a00' },
  ehr: { label: 'Clinical record', color: '#7a8a92' },
  profile: { label: 'Personal history', color: '#6e6bd0' },
}

export function f1(n: number | null | undefined, d = 1): string {
  return n == null || Number.isNaN(n) ? '–' : n.toFixed(d)
}
export function pc(n: number | null | undefined, d = 0): string {
  return n == null || Number.isNaN(n) ? '–' : `${(n * 100).toFixed(d)}%`
}
/** Parkes values are already percentages (0-100). */
export function pk(n: number | null | undefined, d = 1): string {
  return n == null || Number.isNaN(n) ? '–' : `${n.toFixed(d)}%`
}

export function BasisChip({ basis, n }: { basis: Basis; n?: number }) {
  return basis === 'test' ? (
    <ProvChip kind="test" text={n ? `Held-out test · ${n} patients` : undefined} />
  ) : (
    <ProvChip kind="devcv" />
  )
}

export function Section({
  id,
  letter,
  title,
  lead,
  basis,
  basisN,
  children,
}: {
  id: string
  letter: string
  title: string
  lead?: ReactNode
  basis?: Basis
  basisN?: number
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-40 border-t border-line pt-7 first:border-t-0 first:pt-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <h2 id={`${id}-h`} className="flex items-baseline gap-2.5 text-xl">
          <span className="num text-sm font-medium text-muted">({letter})</span>
          {title}
        </h2>
        {basis && <BasisChip basis={basis} n={basisN} />}
      </div>
      {lead && <p className="mb-4 max-w-3xl text-sm text-muted">{lead}</p>}
      <div className="space-y-5">{children}</div>
    </section>
  )
}

export function Pending({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-surface p-4">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
  )
}

export function Sub({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-base">{children}</h3>
      {right}
    </div>
  )
}

export function Bar2({ frac, color, className }: { frac: number; color: string; className?: string }) {
  return (
    <span className={cx('relative block h-2 rounded-full bg-line/80', className)} aria-hidden="true">
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, Math.max(0, frac * 100))}%`, background: color }} />
    </span>
  )
}
