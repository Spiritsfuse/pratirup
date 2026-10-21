import { useMemo } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api/client'
import type { Agp, AgpBin } from '../../api/types'
import { ChartBox, useChartColors, type ChartColors } from '../../components/ChartBox'
import { AGP } from '../../components/clinical'
import { InfoIcon } from '../../components/icons'
import { EmptyState, ErrorState, ProvChip, Skeleton, cx } from '../../components/ui'
import { useApi } from '../../hooks/useApi'
import { hhmm, pct, round } from '../../lib/format'

// ---------------------------------------------------------------- data

interface Row {
  tod: number
  n: number
  /** 5th-95th percentile band as [low, high]; null = gap */
  b90: [number, number] | null
  /** 25th-75th percentile band */
  b50: [number, number] | null
  p50: number | null
  p5: number | null
  p25: number | null
  p75: number | null
  p95: number | null
}

const num = (v: number | null | undefined): v is number => v != null && Number.isFinite(v)

/** Bins with a missing percentile become gaps. Bands are [low, high] pairs, so they are never stacked from zero. */
function buildRows(profile: AgpBin[]): Row[] {
  return [...profile]
    .sort((a, b) => a.tod - b.tod)
    .map((b) => ({
      tod: b.tod,
      n: b.n,
      b90: num(b.p5) && num(b.p95) ? [b.p5, b.p95] : null,
      b50: num(b.p25) && num(b.p75) ? [b.p25, b.p75] : null,
      p50: num(b.p50) ? b.p50 : null,
      p5: num(b.p5) ? b.p5 : null,
      p25: num(b.p25) ? b.p25 : null,
      p75: num(b.p75) ? b.p75 : null,
      p95: num(b.p95) ? b.p95 : null,
    }))
}

function binHalf(rows: Row[]): number {
  return rows.length > 1 ? Math.max(1, (rows[1].tod - rows[0].tod) / 2) : 15
}

const X_TICKS = [0, 180, 360, 540, 720, 900, 1080, 1260, 1440]
const Y_TICKS = [54, 70, 180, 250, 400]
const todLabel = (v: number) => (v >= 1440 ? '24:00' : hhmm(v))

// ---------------------------------------------------------------- targets

interface Target {
  op: '<' | '<=' | '>' | '>='
  v: number
}
function parseTarget(s: string | undefined): Target | null {
  const m = /^\s*(<=|>=|<|>)\s*([\d.]+)/.exec(s ?? '')
  return m ? { op: m[1] as Target['op'], v: Number(m[2]) } : null
}
function meets(valuePct: number, t: Target | null): boolean | null {
  if (!t) return null
  switch (t.op) {
    case '<':
      return valuePct < t.v
    case '<=':
      return valuePct <= t.v
    case '>':
      return valuePct > t.v
    case '>=':
      return valuePct >= t.v
  }
}
const prettyTarget = (s: string | undefined) => (s ?? '').replace('<=', '≤ ').replace('>=', '≥ ')
function verdict(ok: boolean | null, t: Target | null): string {
  if (ok == null || !t) return ''
  if (ok) return 'within target'
  return t.op.startsWith('<') ? 'above target' : 'below target'
}

// ---------------------------------------------------------------- chart

function Tip({
  active,
  payload,
  half,
}: {
  active?: boolean
  payload?: { payload: Row }[]
  half: number
}) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  const k = (a: number | null, b: number | null) => (a != null && b != null ? `${round(a)}–${round(b)}` : '–')
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="num mb-1 font-semibold text-ink">
        {todLabel(r.tod - half)}–{todLabel(r.tod + half)}
      </p>
      <p className="flex justify-between gap-4">
        <span className="text-muted">Median</span>
        <span className="num font-semibold">{r.p50 != null ? `${round(r.p50)} mg/dL` : '–'}</span>
      </p>
      <p className="flex justify-between gap-4">
        <span className="text-muted">25–75%</span>
        <span className="num">{k(r.p25, r.p75)}</span>
      </p>
      <p className="flex justify-between gap-4">
        <span className="text-muted">5–95%</span>
        <span className="num">{k(r.p5, r.p95)}</span>
      </p>
      <p className="flex justify-between gap-4">
        <span className="text-muted">Readings</span>
        <span className="num">{r.n}</span>
      </p>
    </div>
  )
}

function summary(rows: Row[]): string {
  const med = rows.filter((r) => r.p50 != null) as (Row & { p50: number })[]
  if (!med.length) return 'Ambulatory glucose profile by time of day.'
  const lo = med.reduce((a, b) => (b.p50 < a.p50 ? b : a))
  const hi = med.reduce((a, b) => (b.p50 > a.p50 ? b : a))
  return `Ambulatory glucose profile by time of day. Median glucose is lowest at about ${round(lo.p50)} mg/dL around ${hhmm(lo.tod)} and highest at about ${round(hi.p50)} mg/dL around ${hhmm(hi.tod)}.`
}

function AgpChart({ profile, c }: { profile: AgpBin[]; c: ChartColors }) {
  const rows = useMemo(() => buildRows(profile), [profile])
  const half = useMemo(() => binHalf(rows), [rows])
  const compact = typeof window !== 'undefined' && window.innerWidth < 520
  const h = compact ? 300 : 380
  const yWidth = compact ? 40 : 46
  return (
    <ChartBox height={h} label={summary(rows)}>
      {(w) => (
        <ComposedChart width={w} height={h} data={rows} margin={{ top: 10, right: compact ? 12 : 20, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={c.line} strokeOpacity={0.5} vertical={false} />
          <XAxis
            dataKey="tod"
            type="number"
            domain={[0, 1440]}
            ticks={compact ? [0, 360, 720, 1080, 1440] : X_TICKS}
            tickFormatter={todLabel}
            tick={{ fill: c.muted, fontSize: 11 }}
            stroke={c.line}
            tickMargin={6}
            allowDataOverflow
          />
          <YAxis
            type="number"
            domain={[40, 400]}
            ticks={Y_TICKS}
            interval={0}
            width={yWidth}
            tick={{ fill: c.muted, fontSize: 11 }}
            stroke={c.line}
            allowDataOverflow
          />
          <ReferenceArea y1={70} y2={180} fill={c.inrange} fillOpacity={0.09} ifOverflow="hidden" />
          <ReferenceLine y={54} stroke={c.muted} strokeOpacity={0.45} strokeDasharray="1 4" ifOverflow="hidden" />
          <ReferenceLine y={250} stroke={c.muted} strokeOpacity={0.45} strokeDasharray="1 4" ifOverflow="hidden" />
          <ReferenceLine y={70} stroke={c.inrange} strokeOpacity={0.85} strokeDasharray="5 4" ifOverflow="hidden" />
          <ReferenceLine y={180} stroke={c.inrange} strokeOpacity={0.85} strokeDasharray="5 4" ifOverflow="hidden" />

          <Area
            dataKey="b90"
            type="monotone"
            stroke="none"
            fill={c.accent}
            fillOpacity={0.16}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={false}
            legendType="none"
          />
          <Area
            dataKey="b50"
            type="monotone"
            stroke="none"
            fill={c.accent}
            fillOpacity={0.34}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={false}
            legendType="none"
          />
          <Line
            dataKey="p50"
            type="monotone"
            stroke={c.accent}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={{ r: 3.5, fill: c.accent, stroke: c.surface, strokeWidth: 1.5 }}
          />
          <Tooltip
            content={<Tip half={half} />}
            isAnimationActive={false}
            cursor={{ stroke: c.muted, strokeDasharray: '2 3' }}
          />
        </ComposedChart>
      )}
    </ChartBox>
  )
}

function AgpLegendKey() {
  const item = 'flex items-center gap-1.5 whitespace-nowrap'
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Chart legend">
      <li className={item}>
        <svg width="26" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="25" y2="5" stroke="rgb(var(--accent))" strokeWidth="2" />
        </svg>
        Median
      </li>
      <li className={item}>
        <svg width="26" height="12" aria-hidden="true">
          <rect x="1" y="1" width="24" height="10" fill="rgb(var(--accent))" fillOpacity="0.34" />
        </svg>
        25–75% of days
      </li>
      <li className={item}>
        <svg width="26" height="12" aria-hidden="true">
          <rect x="1" y="1" width="24" height="10" fill="rgb(var(--accent))" fillOpacity="0.16" />
        </svg>
        5–95% of days
      </li>
      <li className={item}>
        <svg width="26" height="12" aria-hidden="true">
          <rect x="1" y="1" width="24" height="10" fill="rgb(var(--inrange))" fillOpacity="0.2" />
          <line x1="1" y1="1" x2="25" y2="1" stroke="rgb(var(--inrange))" strokeDasharray="4 3" />
          <line x1="1" y1="11" x2="25" y2="11" stroke="rgb(var(--inrange))" strokeDasharray="4 3" />
        </svg>
        Target range 70–180
      </li>
    </ul>
  )
}

// ---------------------------------------------------------------- time in ranges

function TimeInRanges({ d }: { d: Agp }) {
  const r = d.ranges!
  const t = d.targets ?? {}
  const rows = [
    { key: 'very_high', name: 'Very high', range: '>250', frac: r.very_high, cls: AGP.vhigh, target: t.very_high, total: r.very_high, totalNote: '' },
    { key: 'high', name: 'High', range: '181–250', frac: r.high, cls: AGP.high, target: t.high_total, total: r.high + r.very_high, totalNote: 'all above 180' },
    { key: 'in_range', name: 'In range', range: '70–180', frac: r.in_range, cls: AGP.inrange, target: t.in_range, total: r.in_range, totalNote: '' },
    { key: 'low', name: 'Low', range: '54–69', frac: r.low, cls: AGP.low, target: t.low_total, total: r.low + r.very_low, totalNote: 'all below 70' },
    { key: 'very_low', name: 'Very low', range: '<54', frac: r.very_low, cls: AGP.vlow, target: t.very_low, total: r.very_low, totalNote: '' },
  ]
  const label = `Time in ranges: ${rows.map((x) => `${x.name} ${x.range} mg/dL ${pct(x.frac, 1)}`).join(', ')}`
  return (
    <section className="card p-4" aria-labelledby="tir-h">
      <h3 id="tir-h" className="text-base">
        Time in ranges
      </h3>
      <p className="mb-3 text-xs text-muted">Share of readings, against the consensus targets</p>
      <div className="flex gap-4">
        <div
          className="flex w-12 shrink-0 flex-col gap-px self-stretch overflow-hidden rounded-[4px]"
          style={{ minHeight: 280 }}
          role="img"
          aria-label={label}
          title={label}
        >
          {rows.map((x) => (
            <div
              key={x.key}
              className={x.cls}
              style={{ flexGrow: x.frac, flexShrink: 1, flexBasis: 0, minHeight: x.frac > 0 ? 3 : 0, display: x.frac > 0 ? undefined : 'none' }}
            />
          ))}
        </div>
        <ul className="min-w-0 flex-1 space-y-3">
          {rows.map((x) => {
            const tg = parseTarget(x.target)
            const ok = meets(x.total * 100, tg)
            return (
              <li key={x.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <span className={cx('h-2.5 w-2.5 shrink-0 rounded-[2px]', x.cls)} aria-hidden="true" />
                    <span className="font-medium">{x.name}</span>
                    <span className="num text-xs text-muted">{x.range}</span>
                  </span>
                  <span className="num text-base font-semibold">{pct(x.frac, 1)}</span>
                </div>
                {tg && (
                  <p className="ml-[18px] text-xs text-muted">
                    Target <span className="num text-ink">{prettyTarget(x.target)}</span>
                    {x.totalNote && (
                      <>
                        {' '}
                        for {x.totalNote} (<span className="num text-ink">{pct(x.total, 1)}</span>)
                      </>
                    )}{' '}
                    ·{' '}
                    <span className={cx(ok === false && 'font-semibold text-ink')}>{verdict(ok, tg)}</span>
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- tiles

function Tile({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: React.ReactNode }) {
  return (
    <div className="card p-3.5">
      <p className="section-title">{label}</p>
      <p className="num mt-1 text-2xl font-medium leading-tight">
        {value}
        {unit && <span className="ml-1 text-sm text-muted">{unit}</span>}
      </p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  )
}

function Tiles({ d }: { d: Agp }) {
  const cvT = parseTarget(d.targets?.cv_pct)
  const cvOk = d.cv_pct != null ? meets(d.cv_pct, cvT) : null
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Tile label="Mean glucose" value={round(d.mean)} unit="mg/dL" sub="average of all readings" />
      <Tile label="GMI" value={d.gmi_pct != null ? `${d.gmi_pct.toFixed(1)}%` : '–'} sub="glucose management indicator, an A1c estimate" />
      <Tile
        label="CV"
        value={d.cv_pct != null ? `${round(d.cv_pct, 1)}%` : '–'}
        sub={
          cvT ? (
            <>
              Variability. Target <span className="num text-ink">{prettyTarget(d.targets?.cv_pct)}</span>
              {cvOk != null && <> · {verdict(cvOk, cvT)}</>}
            </>
          ) : (
            'Variability'
          )
        }
      />
      <Tile label="GRI" value={d.gri != null ? round(d.gri, 0) : '–'} sub="Glycaemia risk index, 0–100. Lower is better" />
      <Tile
        label="Days of data"
        value={d.days != null ? d.days.toFixed(1) : '–'}
        sub={<>{d.n_readings.toLocaleString()} readings</>}
      />
      <Tile label="Coverage" value={pct(d.coverage, 0)} sub="of expected 15-minute readings" />
    </div>
  )
}

// ---------------------------------------------------------------- tab

function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the glucose profile">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[420px] w-full" />
        <Skeleton className="h-[420px] w-full" />
      </div>
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

export function AgpTab({ rid, t, live }: { rid: string; t: number | null; live: boolean }) {
  const c = useChartColors()
  const res = useApi((s) => api.agp(rid, live ? null : t, s), [rid, live ? null : t], { enabled: live || t != null, pollMs: live ? 5000 : undefined })
  const d = res.data

  if (res.error && !d) return <ErrorState error={res.error} onRetry={res.reload} title="Could not load the glucose profile" />
  if (!d) return <Loading />

  if (!d.available || !d.profile || !d.ranges) {
    return (
      <div className="space-y-4">
        {res.error && <ErrorState error={res.error} onRetry={res.reload} compact title="Showing the last loaded data" />}
        <EmptyState title="The glucose profile is not available yet" tone="notice">
          <p>{d.reason ?? 'There is not enough CGM data for an ambulatory glucose profile.'}</p>
          <p className="mt-1">
            {live
              ? 'It appears by itself as the stream delivers more readings.'
              : 'Move the demo clock later in the recording and it will appear.'}{' '}
            <span className="num">{d.n_readings.toLocaleString()}</span> readings so far.
          </p>
        </EmptyState>
      </div>
    )
  }

  const tableRows = buildRows(d.profile)
  const tableHalf = binHalf(tableRows)

  return (
    <div className="space-y-4">
      {res.error && <ErrorState error={res.error} onRetry={res.reload} compact title="Showing the last loaded data" />}

      {d.sufficient === false && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-line bg-bg px-3 py-2 text-sm text-muted">
          <InfoIcon className="mt-0.5 shrink-0" width={16} height={16} />
          <span>{d.sufficiency_note ?? 'There is less data than the consensus recommends for a reliable profile.'}</span>
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card min-w-0 p-4" aria-labelledby="agp-h">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="agp-h" className="text-base">
                Ambulatory glucose profile
              </h2>
              <p className="text-xs text-muted">Every day of CGM folded onto one 24-hour clock</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ProvChip kind="observed" text="Observed CGM, summarised" />
            </div>
          </div>
          <AgpLegendKey />
          <div className="mt-2">
            <AgpChart profile={d.profile} c={c} />
          </div>
          <p className="mt-2 text-xs text-muted">Glucose in mg/dL against time of day. Gaps mean too few readings in that half hour.</p>

          <details className="mt-3 rounded-md border border-line">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Profile values as a table</summary>
            <div className="scroll-x max-h-72 overflow-y-auto border-t border-line">
              <table className="tbl">
                <caption className="sr-only">Glucose percentiles by time of day, mg/dL</caption>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col" className="r">5%</th>
                    <th scope="col" className="r">25%</th>
                    <th scope="col" className="r">Median</th>
                    <th scope="col" className="r">75%</th>
                    <th scope="col" className="r">95%</th>
                    <th scope="col" className="r">Readings</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.tod}>
                      <td className="num">{hhmm(r.tod - tableHalf)}</td>
                      <td className="num r">{round(r.p5)}</td>
                      <td className="num r">{round(r.p25)}</td>
                      <td className="num r font-semibold">{round(r.p50)}</td>
                      <td className="num r">{round(r.p75)}</td>
                      <td className="num r">{round(r.p95)}</td>
                      <td className="num r text-muted">{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <TimeInRanges d={d} />
      </div>

      <Tiles d={d} />

      <p className="max-w-4xl text-xs text-muted">
        {d.note} Computed from readings up to {live ? 'the latest reading' : 'the demo clock'}.
      </p>
    </div>
  )
}
