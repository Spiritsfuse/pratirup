import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { Twin } from '../../api/types'
import { useApi } from '../../hooks/useApi'
import { clockLabel, minutesAgo, pct, round, TREND_TEXT } from '../../lib/format'
import { glucoseTone } from '../clinical'
import { TrendIcon } from '../icons'
import { ErrorState, LiveBadge, ProvChip, Segmented, Skeleton, cx } from '../ui'
import { DriversCard, RiskCard, StateCard } from './Rails'
import { ChartLegend, EventKey, TwinChart } from './TwinChart'

export interface TwinViewProps {
  rid: string
  /** demo clock; ignored for live recordings */
  t: number | null
  live?: boolean
  pollMs?: number
}

function windowStats(twin: Twin) {
  const obs = new Map(twin.observations.map((o) => [o.t, o.glucose]))
  let n = 0
  let twinAbs = 0
  let baseAbs = 0
  let inside = 0
  let nAll = 0
  for (const p of twin.past_forecasts) {
    if (p.actual == null) continue
    nAll++
    if (p.actual >= p.lo && p.actual <= p.hi) inside++
    const g0 = obs.get(p.issued_t)
    if (g0 == null) continue
    n++
    twinAbs += Math.abs(p.yhat - p.actual)
    baseAbs += Math.abs(g0 - p.actual)
  }
  if (!n) return null
  return { n, twinMae: twinAbs / n, baseMae: baseAbs / n, coverage: nAll ? inside / nAll : 0 }
}

function AbstainCard({ twin }: { twin: Twin }) {
  const reason = twin.abstain_reason ?? 'No forecast is available at this time'
  return (
    <div role="status" className="card flex flex-wrap items-start gap-4 border-2 border-high/60 bg-surface p-5">
      <div className="min-w-[220px] flex-1">
        <p className="section-title text-high">Forecast paused</p>
        <p className="mt-1 text-lg font-semibold">{reason}</p>
        <p className="mt-1.5 max-w-2xl text-sm text-muted">
          The twin abstains rather than guess: it needs a fresh, reasonably complete run of CGM readings. Observed
          glucose is still shown below. Move the demo clock, or wait for new readings on a live stream, and the forecast
          returns by itself.
        </p>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true" aria-label="Loading the twin">
      <div className="card p-4">
        <Skeleton className="mb-3 h-4 w-2/3" />
        <Skeleton className="h-[340px] w-full" />
        <Skeleton className="mt-2 h-[100px] w-full" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

export function TwinView({ rid, t, live = false, pollMs }: TwinViewProps) {
  const [windowH, setWindowH] = useState<number>(12)
  const [showPast, setShowPast] = useState(true)
  const res = useApi((s) => api.twin(rid, live ? null : t, windowH, s), [rid, live ? null : t, windowH], {
    enabled: live || t != null,
    pollMs,
  })
  const twin = res.data
  const stats = useMemo(() => (twin ? windowStats(twin) : null), [twin])

  if (res.error && !twin) return <ErrorState error={res.error} onRetry={res.reload} title="Could not load the twin" />
  if (!twin) return <Loading />

  const st = twin.state
  const fc = twin.forecast
  const h60 = fc?.horizons.find((h) => h.horizon === 60)

  return (
    <div className="space-y-4">
      {res.error && <ErrorState error={res.error} onRetry={res.reload} compact title="Showing the last loaded data" />}

      {!fc && <AbstainCard twin={twin} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <section className="card p-4" aria-labelledby="chart-h">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
              <div>
                <h2 id="chart-h" className="text-base">
                  Glucose, observed and forecast
                </h2>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {st && st.glucose != null ? (
                    <>
                      <span className="flex items-center gap-1.5">
                        <span className={cx('num text-2xl font-medium leading-none', glucoseTone(st.glucose))}>{round(st.glucose)}</span>
                        <span className="text-muted">mg/dL</span>
                        <TrendIcon trend={st.trend} size={20} />
                        <span className="text-muted">{TREND_TEXT[st.trend]}</span>
                      </span>
                      <span className="text-muted">
                        {minutesAgo(twin.clock.minutes_since_reading)}
                        <span className="num"> · {clockLabel(twin.clock.t)}</span>
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">
                      No reading yet <span className="num">· {clockLabel(twin.clock.t)}</span>
                    </span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {live && <LiveBadge />}
                {!live && <ProvChip kind="replay" />}
                <Segmented
                  label="Time window"
                  value={windowH}
                  onChange={setWindowH}
                  options={[
                    { key: 6, label: '6 h' },
                    { key: 12, label: '12 h' },
                    { key: 24, label: '24 h' },
                  ]}
                />
              </div>
            </div>

            <ChartLegend showPast={showPast} />
            <label className="mb-2 mt-2.5 flex w-fit cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showPast}
                onChange={(e) => setShowPast(e.target.checked)}
                className="h-4 w-4 accent-[rgb(var(--accent))]"
              />
              Show what the twin predicted 60 min earlier
            </label>

            <TwinChart twin={twin} windowH={windowH} showPast={showPast} />
            <div className="mt-1.5">
              <EventKey />
            </div>

            {showPast && (
              <p className="mt-3 rounded-md bg-bg px-3 py-2 text-sm text-muted">
                {stats ? (
                  <>
                    <strong className="font-semibold text-ink">Twin vs reality in this window.</strong> Forecasts made 60 min
                    before each reading were off by <span className="num text-ink">{round(stats.twinMae, 1)} mg/dL</span> on
                    average; carrying the last value forward would have been off by{' '}
                    <span className="num text-ink">{round(stats.baseMae, 1)} mg/dL</span>. The 80% band held the outcome{' '}
                    <span className="num text-ink">{pct(stats.coverage)}</span> of the time (
                    <span className="num">{stats.n}</span> forecasts).
                  </>
                ) : (
                  'No scored forecasts in this window yet: each forecast is scored when its target time arrives.'
                )}
              </p>
            )}
          </section>

          {fc && (
            <section className="card" aria-labelledby="fc-h">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
                <h3 id="fc-h" className="text-base">
                  Forecast from {clockLabel(fc.issued_t)}
                </h3>
                <ProvChip kind="forecast" />
              </div>
              <div className="scroll-x px-1 pb-2 pt-1">
                <table className="tbl">
                  <caption className="sr-only">Forecast by horizon with 80 percent intervals</caption>
                  <thead>
                    <tr>
                      <th scope="col">Horizon</th>
                      <th scope="col">Target time</th>
                      <th scope="col" className="r">
                        Forecast (mg/dL)
                      </th>
                      <th scope="col" className="r">
                        80% interval
                      </th>
                      <th scope="col" className="r" title="Population model before this patient's personal correction">
                        Before personal correction
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fc.horizons.map((h) => (
                      <tr key={h.horizon} className={cx(h.horizon > 60 && 'text-muted')}>
                        <td className="num font-medium">
                          +{h.horizon} min{' '}
                          {h.horizon > 60 && <span className="chip ml-1 !text-[11px]">exploratory</span>}
                          {h.horizon === 60 && <span className="chip ml-1 !text-[11px] !text-accent">headline</span>}
                        </td>
                        <td className="num">{clockLabel(h.target_t)}</td>
                        <td className={cx('num r text-base', h.horizon <= 60 && 'font-semibold text-ink')}>{round(h.yhat)}</td>
                        <td className="num r">
                          {round(h.lo)}–{round(h.hi)}
                        </td>
                        <td className="num r">{round(h.yhat_population)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 pb-4 text-xs text-muted">
                {h60 ? (
                  <>
                    At +60 min the twin expects <span className="num text-ink">{round(h60.yhat)} mg/dL</span>, with an 80% interval of{' '}
                    <span className="num text-ink">
                      {round(h60.lo)}–{round(h60.hi)}
                    </span>
                    .{' '}
                  </>
                ) : null}
                +120 min is exploratory and less reliable.
              </p>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <RiskCard twin={twin} />
          <StateCard twin={twin} />
          <DriversCard twin={twin} />
        </div>
      </div>
    </div>
  )
}
