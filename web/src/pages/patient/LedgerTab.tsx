import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { api } from '../../api/client'
import type { Ledger, LedgerEntry } from '../../api/types'
import { ChartBox, useChartColors } from '../../components/ChartBox'
import { EmptyState, ErrorState, ProvChip, Skeleton, Stat, cx } from '../../components/ui'
import { useApi } from '../../hooks/useApi'
import { clockLabel, pct, round, signed } from '../../lib/format'

function Tiles({ l }: { l: Ledger }) {
  const s = l.summary
  const beats = s.mae != null && s.mae_persistence != null && s.mae < s.mae_persistence
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="This patient's MAE · +60 min"
        value={
          <>
            {round(s.mae, 1)} <span className="text-sm text-muted">mg/dL</span>
          </>
        }
        sub={
          <>
            Last-value baseline <span className="num text-ink">{round(s.mae_persistence, 1)}</span>
            {s.mae_population_model != null && (
              <>
                {' '}
                · population model <span className="num text-ink">{round(s.mae_population_model, 1)}</span>
              </>
            )}
            {s.mae != null && s.mae_persistence != null && (
              <>
                {' '}
                · <span className={beats ? 'font-semibold text-inrange' : 'font-semibold text-low'}>{beats ? 'twin is closer' : 'baseline is closer'}</span>
              </>
            )}
          </>
        }
        tone={beats ? 'good' : 'bad'}
      />
      <Stat
        label="Interval coverage"
        value={pct(s.coverage)}
        sub={
          <>
            Nominal <span className="num text-ink">{pct(s.nominal_coverage)}</span>: share of outcomes inside the 80% band
          </>
        }
      />
      <Stat label="Forecasts scored" value={s.n_resolved} sub={`Bias ${signed(s.bias, 1)} mg/dL (forecast minus actual)`} />
      <Stat label="Pending" value={s.pending} sub="Issued, target time not yet reached" />
    </div>
  )
}

function ByDay({ l }: { l: Ledger }) {
  const c = useChartColors()
  const data = l.by_day.map((d) => ({ ...d, name: `Day ${d.day}` }))
  return (
    <section className="card p-4" aria-labelledby="byday-h">
      <h3 id="byday-h" className="text-base">
        Error by wear day
      </h3>
      <p className="mb-2 text-xs text-muted">Mean absolute error of the +60 min forecast, in mg/dL. Lower is better.</p>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c.accent }} aria-hidden="true" /> Pratirup forecast
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c.muted, opacity: 0.5 }} aria-hidden="true" /> Last value carried forward
        </li>
      </ul>
      <ChartBox height={260} label="Bar chart of forecast error per wear day">
        {(w) => (
          <BarChart width={w} height={260} data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid stroke={c.line} vertical={false} strokeOpacity={0.6} />
            <XAxis dataKey="name" tick={{ fill: c.muted, fontSize: 11 }} stroke={c.line} tickLine={false} />
            <YAxis
              width={44}
              tick={{ fill: c.muted, fontSize: 11 }}
              stroke={c.line}
              tickLine={false}
              label={{ value: 'MAE (mg/dL)', angle: -90, position: 'insideLeft', style: { fill: c.muted, fontSize: 11, textAnchor: 'middle' } }}
            />
            <Tooltip
              cursor={{ fill: c.line, fillOpacity: 0.35 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as (typeof data)[number]
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                    <p className="font-semibold">{d.name}</p>
                    <p>
                      Forecast MAE <span className="num">{round(d.mae, 1)}</span> mg/dL
                    </p>
                    <p>
                      Baseline MAE <span className="num">{round(d.mae_persistence, 1)}</span> mg/dL
                    </p>
                    <p className="text-muted">
                      {d.n} forecasts · coverage <span className="num">{pct(d.coverage)}</span>
                    </p>
                  </div>
                )
              }}
            />
            <Bar dataKey="mae" fill={c.accent} radius={[2, 2, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="mae" position="top" formatter={(v: number) => v.toFixed(1)} style={{ fill: c.ink, fontSize: 10 }} />
            </Bar>
            <Bar dataKey="mae_persistence" fill={c.muted} fillOpacity={0.5} radius={[2, 2, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="mae_persistence" position="top" formatter={(v: number) => v.toFixed(1)} style={{ fill: c.muted, fontSize: 10 }} />
            </Bar>
          </BarChart>
        )}
      </ChartBox>
    </section>
  )
}

function Cross({ cx: x = 0, cy: y = 0, fill }: { cx?: number; cy?: number; fill?: string }) {
  return (
    <path
      d={`M${x - 3.5} ${y - 3.5} L${x + 3.5} ${y + 3.5} M${x + 3.5} ${y - 3.5} L${x - 3.5} ${y + 3.5}`}
      stroke={fill}
      strokeWidth={1.8}
      fill="none"
    />
  )
}

function PredActual({ entries }: { entries: LedgerEntry[] }) {
  const c = useChartColors()
  const inside = useMemo(() => entries.filter((e) => e.inside).map((e) => ({ x: e.yhat, y: e.actual, e })), [entries])
  const outside = useMemo(() => entries.filter((e) => !e.inside).map((e) => ({ x: e.yhat, y: e.actual, e })), [entries])
  const all = entries.flatMap((e) => [e.yhat, e.actual])
  const lo = Math.max(0, Math.floor((Math.min(...all) - 10) / 50) * 50)
  const hi = Math.ceil((Math.max(...all) + 10) / 50) * 50
  const ticks: number[] = []
  for (let v = lo; v <= hi; v += 50) ticks.push(v)
  return (
    <section className="card p-4" aria-labelledby="pa-h">
      <h3 id="pa-h" className="text-base">
        Predicted vs actual
      </h3>
      <p className="mb-2 text-xs text-muted">Each point is one +60 min forecast. On the diagonal means exactly right.</p>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="4" fill={c.accent} fillOpacity="0.6" />
          </svg>
          Inside the 80% band
        </li>
        <li className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden="true">
            <path d="M2 2 L10 10 M10 2 L2 10" stroke={c.low} strokeWidth="1.8" />
          </svg>
          Outside the band
        </li>
      </ul>
      <ChartBox height={300} label="Scatter plot of forecast against actual glucose">
        {(w) => (
          <ScatterChart width={w} height={300} margin={{ top: 8, right: 14, bottom: 22, left: 0 }}>
            <CartesianGrid stroke={c.line} strokeOpacity={0.6} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[lo, hi]}
              ticks={ticks}
              tick={{ fill: c.muted, fontSize: 11 }}
              stroke={c.line}
              allowDataOverflow
              label={{ value: 'Forecast (mg/dL)', position: 'insideBottom', offset: -12, style: { fill: c.muted, fontSize: 11 } }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[lo, hi]}
              ticks={ticks}
              width={44}
              tick={{ fill: c.muted, fontSize: 11 }}
              stroke={c.line}
              allowDataOverflow
              label={{ value: 'Actual (mg/dL)', angle: -90, position: 'insideLeft', style: { fill: c.muted, fontSize: 11, textAnchor: 'middle' } }}
            />
            <ZAxis range={[26, 26]} />
            <ReferenceLine segment={[{ x: lo, y: lo }, { x: hi, y: hi }]} stroke={c.muted} strokeDasharray="4 4" />
            <Tooltip
              isAnimationActive={false}
              cursor={{ strokeDasharray: '2 3', stroke: c.muted }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const e = (payload[0].payload as { e: LedgerEntry }).e
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                    <p className="num font-semibold">Issued {clockLabel(e.issued_t)}</p>
                    <p>
                      Forecast <span className="num">{round(e.yhat)}</span> ({round(e.lo)}–{round(e.hi)})
                    </p>
                    <p>
                      Actual <span className="num">{round(e.actual)}</span> · error <span className="num">{signed(e.error)}</span>
                    </p>
                  </div>
                )
              }}
            />
            <Scatter data={inside} fill={c.accent} fillOpacity={0.55} isAnimationActive={false} />
            <Scatter data={outside} fill={c.low} shape={(p: { cx?: number; cy?: number }) => <Cross {...p} fill={c.low} />} isAnimationActive={false} />
          </ScatterChart>
        )}
      </ChartBox>
    </section>
  )
}

function RecentTable({ entries }: { entries: LedgerEntry[] }) {
  const [n, setN] = useState(15)
  const recent = useMemo(() => [...entries].reverse(), [entries])
  return (
    <section className="card" aria-labelledby="recent-h">
      <div className="px-4 pt-4">
        <h3 id="recent-h" className="text-base">
          Most recent resolved forecasts
        </h3>
        <p className="text-xs text-muted">Newest first. Error is forecast minus actual, in mg/dL.</p>
      </div>
      <div className="scroll-x px-1 pb-2 pt-1">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Issued</th>
              <th scope="col">Target</th>
              <th scope="col" className="r">
                Glucose at issue
              </th>
              <th scope="col" className="r">
                Forecast
              </th>
              <th scope="col" className="r">
                80% interval
              </th>
              <th scope="col" className="r">
                Actual
              </th>
              <th scope="col" className="r">
                Error
              </th>
              <th scope="col">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {recent.slice(0, n).map((e) => (
              <tr key={e.issued_t}>
                <td className="num whitespace-nowrap">{clockLabel(e.issued_t)}</td>
                <td className="num whitespace-nowrap">{clockLabel(e.target_t)}</td>
                <td className="num r">{round(e.glucose_at_issue)}</td>
                <td className="num r font-semibold">{round(e.yhat)}</td>
                <td className="num r text-muted">
                  {round(e.lo)}–{round(e.hi)}
                </td>
                <td className="num r">{round(e.actual)}</td>
                <td className="num r">{signed(e.error)}</td>
                <td>
                  <span
                    className={cx(
                      'chip',
                      e.inside ? 'border-inrange/60 text-ink' : 'border-low/70 text-ink',
                    )}
                  >
                    <span className={cx('h-2 w-2 rounded-full', e.inside ? 'bg-inrange' : 'bg-low')} aria-hidden="true" />
                    {e.inside ? 'Inside band' : 'Outside band'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {n < recent.length && (
        <div className="border-t border-line px-4 py-2.5">
          <button type="button" className="btn" onClick={() => setN((v) => Math.min(recent.length, v + 25))}>
            Show 25 more ({recent.length - n} left)
          </button>
        </div>
      )}
    </section>
  )
}

export function LedgerTab({ rid, t, live }: { rid: string; t: number | null; live: boolean }) {
  const res = useApi((s) => api.ledger(rid, live ? null : t, s), [rid, live ? null : t], {
    enabled: live || t != null,
    pollMs: live ? 3000 : undefined,
  })
  const l = res.data
  if (res.error && !l) return <ErrorState error={res.error} onRetry={res.reload} title="Could not load the forecast ledger" />
  if (!l)
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">
          <strong className="font-semibold text-ink">The ledger.</strong> Every forecast the twin issues is stored, and scored
          when its target time arrives. Nothing is edited after the fact, so this is the twin&apos;s track record on this
          patient up to <span className="num text-ink">{clockLabel(l.t)}</span>.
        </p>
        <ProvChip kind="forecast" text="+60 min forecasts, scored" />
      </div>
      {l.summary.n_resolved === 0 ? (
        <EmptyState title="No forecasts have been scored yet">
          A forecast is scored once its target time passes. Move the demo clock forward and results will appear here: pending
          forecasts: <span className="num">{l.summary.pending}</span>.
        </EmptyState>
      ) : (
        <>
          <Tiles l={l} />
          <div className="grid gap-4 lg:grid-cols-2">
            <ByDay l={l} />
            <PredActual entries={l.entries} />
          </div>
          <RecentTable entries={l.entries} />
        </>
      )}
    </div>
  )
}
