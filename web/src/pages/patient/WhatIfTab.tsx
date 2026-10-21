import { useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { ApiError, api } from '../../api/client'
import type { RiskKind, Sensitivity, SensitivityChange, SensitivityPack } from '../../api/types'
import { ChartBox, useChartColors } from '../../components/ChartBox'
import { AlertIcon } from '../../components/icons'
import { Disclosure, EmptyState, ProvChip, cx } from '../../components/ui'
import { RISK_ORDER, clockLabel, prob, round, signed } from '../../lib/format'

const NOT_CAUSAL = 'Model sensitivity — associational, not causal'
const RISK_TITLE: Record<RiskKind, string> = {
  hypo: 'Below 70 mg/dL',
  hyper: 'Above 180 mg/dL (ranking signal, no alert)',
  hyper2: 'Above 250 mg/dL',
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  disabled,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit: string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className={cx('mt-2', disabled && 'opacity-50')}>
      <div className="flex items-baseline justify-between text-sm">
        <label htmlFor={id} className="text-muted">
          {label}
        </label>
        <span className="num font-semibold">
          {value} <span className="font-normal text-muted">{unit}</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-2 w-full"
      />
    </div>
  )
}

function Check({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm font-medium">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[rgb(var(--scenario))]"
      />
      <span>{children}</span>
    </label>
  )
}

function Compare({ r }: { r: Sensitivity }) {
  const c = useChartColors()
  const rows = r.baseline.horizons.map((b, i) => {
    const s = r.scenario.horizons[i]
    return {
      h: b.horizon,
      base: b.yhat,
      baseBand: [b.lo, b.hi] as [number, number],
      scen: s.yhat,
      scenBand: [s.lo, s.hi] as [number, number],
      bLo: b.lo,
      bHi: b.hi,
      sLo: s.lo,
      sHi: s.hi,
    }
  })
  const vals = rows.flatMap((x) => [x.bLo, x.bHi, x.sLo, x.sHi])
  const yMin = Math.max(20, Math.floor((Math.min(...vals, 60) - 10) / 10) * 10)
  const yMax = Math.ceil((Math.max(...vals, 200) + 10) / 10) * 10
  const yTicks = [54, 70, 120, 180, 250, 300, 350, 400].filter((v) => v >= yMin && v <= yMax)
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <svg width="26" height="12" aria-hidden="true">
            <rect x="1" y="1" width="24" height="10" fill={c.accent} fillOpacity="0.2" />
            <line x1="1" y1="6" x2="25" y2="6" stroke={c.accent} strokeWidth="2.4" />
          </svg>
          Baseline forecast (as logged)
        </li>
        <li className="flex items-center gap-1.5">
          <svg width="26" height="12" aria-hidden="true">
            <defs>
              <pattern id="hatch-key" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" stroke={c.scenario} strokeWidth="1.6" strokeOpacity="0.7" />
              </pattern>
            </defs>
            <rect x="1" y="1" width="24" height="10" fill="url(#hatch-key)" stroke={c.scenario} strokeDasharray="3 2" />
            <line x1="1" y1="6" x2="25" y2="6" stroke={c.scenario} strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          Hypothetical scenario (hatched, dashed)
        </li>
      </ul>
      <ChartBox height={280} label="Baseline and hypothetical scenario forecasts at 30, 60 and 120 minutes">
        {(w) => (
          <ComposedChart width={w} height={280} data={rows} margin={{ top: 12, right: 22, bottom: 4, left: 0 }}>
            <defs>
              <pattern id="whatif-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke={c.scenario} strokeWidth="2" strokeOpacity="0.6" />
              </pattern>
            </defs>
            <CartesianGrid stroke={c.line} strokeOpacity={0.55} vertical={false} />
            <XAxis
              dataKey="h"
              type="number"
              domain={[10, 135]}
              ticks={[30, 60, 120]}
              tickFormatter={(v: number) => `+${v} min`}
              tick={{ fill: c.muted, fontSize: 11 }}
              stroke={c.line}
            />
            <YAxis
              type="number"
              domain={[yMin, yMax]}
              ticks={yTicks}
              interval={0}
              width={50}
              tick={{ fill: c.muted, fontSize: 11 }}
              stroke={c.line}
              label={{ value: 'Glucose (mg/dL)', angle: -90, position: 'insideLeft', offset: 8, style: { fill: c.muted, fontSize: 11, textAnchor: 'middle' } }}
            />
            <ReferenceArea y1={70} y2={180} fill={c.inrange} fillOpacity={0.09} />
            <ReferenceLine y={70} stroke={c.inrange} strokeOpacity={0.7} strokeDasharray="4 4" />
            <ReferenceLine y={180} stroke={c.inrange} strokeOpacity={0.7} strokeDasharray="4 4" />
            <Area dataKey="baseBand" type="linear" stroke="none" fill={c.accent} fillOpacity={0.2} isAnimationActive={false} activeDot={false} />
            <Area
              dataKey="scenBand"
              type="linear"
              stroke={c.scenario}
              strokeDasharray="3 3"
              strokeOpacity={0.8}
              fill="url(#whatif-hatch)"
              isAnimationActive={false}
              activeDot={false}
            />
            <Line
              dataKey="base"
              type="linear"
              stroke={c.accent}
              strokeWidth={2.6}
              isAnimationActive={false}
              dot={{ r: 4.5, fill: c.accent, stroke: c.surface, strokeWidth: 1.5 }}
              activeDot={false}
            />
            <Line
              dataKey="scen"
              type="linear"
              stroke={c.scenario}
              strokeWidth={2.2}
              strokeDasharray="6 4"
              isAnimationActive={false}
              dot={{ r: 4.5, fill: c.surface, stroke: c.scenario, strokeWidth: 2 }}
              activeDot={false}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: c.muted, strokeDasharray: '2 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as (typeof rows)[number]
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                    <p className="num font-semibold">+{d.h} min</p>
                    <p>
                      Baseline <span className="num font-semibold">{round(d.base)}</span>{' '}
                      <span className="num text-muted">
                        ({round(d.bLo)}–{round(d.bHi)})
                      </span>
                    </p>
                    <p style={{ color: c.scenario }}>
                      Scenario <span className="num font-semibold">{round(d.scen)}</span>{' '}
                      <span className="num">
                        ({round(d.sLo)}–{round(d.sHi)})
                      </span>
                    </p>
                  </div>
                )
              }}
            />
          </ComposedChart>
        )}
      </ChartBox>
    </div>
  )
}

function Results({ r, atT }: { r: Sensitivity; atT: number | null }) {
  const stale = atT != null && atT !== r.t
  const packRisk = (p: SensitivityPack, k: RiskKind) => p.risk[k]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base">{NOT_CAUSAL}</h3>
        <ProvChip kind="sensitivity" />
      </div>
      {stale && (
        <div role="status" className="rounded-md border border-high/60 bg-high/10 px-3 py-2 text-sm">
          This result was computed at <span className="num font-semibold">{clockLabel(r.t)}</span>. The demo clock has moved; run
          it again to see the current time.
        </div>
      )}

      <section className="card p-4" aria-labelledby="wi-fc">
        <h4 id="wi-fc" className="mb-1 text-sm font-semibold">
          Forecast: baseline vs scenario at <span className="num">{r.label}</span>
        </h4>
        <Compare r={r} />
        <div className="scroll-x mt-3">
          <table className="tbl">
            <caption className="sr-only">Forecast by horizon, baseline and scenario</caption>
            <thead>
              <tr>
                <th scope="col">Horizon</th>
                <th scope="col" className="r">
                  Baseline (mg/dL)
                </th>
                <th scope="col" className="r">
                  Scenario (mg/dL)
                </th>
                <th scope="col" className="r">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {r.baseline.horizons.map((b, i) => {
                const s = r.scenario.horizons[i]
                const d = s.yhat - b.yhat
                return (
                  <tr key={b.horizon} className={cx(b.horizon > 60 && 'text-muted')}>
                    <td className="num">
                      +{b.horizon} min {b.horizon > 60 && <span className="chip ml-1 !text-[11px]">exploratory</span>}
                    </td>
                    <td className="num r">
                      <span className="font-semibold">{round(b.yhat)}</span>{' '}
                      <span className="text-muted">
                        ({round(b.lo)}–{round(b.hi)})
                      </span>
                    </td>
                    <td className="num r">
                      <span className="font-semibold">{round(s.yhat)}</span>{' '}
                      <span className="text-muted">
                        ({round(s.lo)}–{round(s.hi)})
                      </span>
                    </td>
                    <td className="num r font-semibold">{signed(d)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="wi-risk">
        <h4 id="wi-risk" className="px-4 pt-4 text-sm font-semibold">
          Risk in the next 60 min
        </h4>
        <div className="scroll-x px-1 pb-2">
          <table className="tbl">
            <caption className="sr-only">Risk probabilities, baseline and scenario</caption>
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col" className="r">
                  Baseline
                </th>
                <th scope="col" className="r">
                  Scenario
                </th>
                <th scope="col" className="r">
                  Change (points)
                </th>
              </tr>
            </thead>
            <tbody>
              {RISK_ORDER.map((k) => {
                const b = packRisk(r.baseline, k)
                const s = packRisk(r.scenario, k)
                return (
                  <tr key={k}>
                    <td>{RISK_TITLE[k]}</td>
                    {b == null || s == null ? (
                      <td colSpan={3} className="r italic text-muted">
                        glucose is already beyond this level
                      </td>
                    ) : (
                      <>
                        <td className="num r">{prob(b)}</td>
                        <td className="num r">{prob(s)}</td>
                        <td className="num r font-semibold">{signed((s - b) * 100, 1)}</td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-4" aria-labelledby="wi-in">
        <h4 id="wi-in" className="text-sm font-semibold">
          What was changed
        </h4>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {r.applied.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {r.changed_features.length > 0 ? (
          <div className="scroll-x mt-3">
            <table className="tbl">
              <caption className="sr-only">Model inputs that changed</caption>
              <thead>
                <tr>
                  <th scope="col">Model input</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {r.changed_features.map((f) => (
                  <tr key={f.feature}>
                    <td>{f.label}</td>
                    <td className="num text-muted">{f.before}</td>
                    <td className="num font-semibold">{f.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">These edits did not change any model input, so the forecast is unchanged.</p>
        )}
      </section>

      {r.ood_warnings.length > 0 && (
        <div role="alert" className="rounded-md border-2 border-high/70 bg-high/10 p-3.5 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <AlertIcon className="text-high" width={16} height={16} /> Outside what the model has seen
          </p>
          <ul className="mt-1 list-disc pl-6">
            {r.ood_warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <Disclosure title="Read this before drawing conclusions">{r.disclaimer}</Disclosure>
    </div>
  )
}

export function WhatIfTab({ rid, t, live }: { rid: string; t: number | null; live: boolean }) {
  const [addMeal, setAddMeal] = useState(true)
  const [grams, setGrams] = useState(300)
  const [carb, setCarb] = useState(105)
  const [removeMeals, setRemoveMeals] = useState(false)
  const [addIns, setAddIns] = useState(false)
  const [units, setUnits] = useState(4)
  const [removeIns, setRemoveIns] = useState(false)
  const [state, setState] = useState<{
    status: 'idle' | 'loading' | 'error' | 'done'
    data?: Sensitivity
    error?: Error
  }>({ status: 'idle' })

  const changes: SensitivityChange[] = []
  if (removeMeals) changes.push({ kind: 'remove_recent_meals' })
  if (removeIns) changes.push({ kind: 'remove_recent_insulin' })
  if (addMeal) changes.push({ kind: 'add_meal', grams, carb_grams: Math.min(carb, grams) })
  if (addIns) changes.push({ kind: 'add_fast_insulin', units })

  if (live)
    return (
      <EmptyState title="What-if is available for replayed patients">
        The sensitivity analysis re-computes the forecast from a recorded history, so it is not offered on a live stream.
      </EmptyState>
    )

  async function run() {
    if (t == null || changes.length === 0) return
    setState((s) => ({ status: 'loading', data: s.data }))
    try {
      const data = await api.sensitivity(rid, t, changes)
      setState({ status: 'done', data })
    } catch (e) {
      setState((s) => ({ status: 'error', error: e as Error, data: s.data }))
    }
  }

  const err = state.error
  const is409 = err instanceof ApiError && err.status === 409

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <section className="card p-4 lg:sticky lg:top-44" aria-labelledby="wi-ctl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 id="wi-ctl" className="text-base">
            Change a logged input
          </h3>
          <ProvChip kind="sensitivity" text="Hypothetical" />
        </div>
        <p className="mb-4 text-xs text-muted">
          {NOT_CAUSAL}. See how the model&apos;s forecast moves when one thing in the record is different. It does not say
          what would actually happen.
        </p>

        <fieldset className="space-y-4">
          <legend className="sr-only">Hypothetical changes</legend>

          <div className="rounded-md border border-line p-3">
            <Check id="wi-add-meal" checked={addMeal} onChange={setAddMeal}>
              Add a meal now
            </Check>
            <Slider id="wi-grams" label="Meal size" value={grams} min={50} max={800} step={10} unit="g" disabled={!addMeal} onChange={(v) => { setGrams(v); setCarb((c) => Math.min(c, v)) }} />
            <Slider id="wi-carb" label="of which carbohydrate-dense food" value={Math.min(carb, grams)} min={0} max={grams} step={5} unit="g" disabled={!addMeal} onChange={setCarb} />
          </div>

          <div className="rounded-md border border-line p-3">
            <Check id="wi-rm-meal" checked={removeMeals} onChange={setRemoveMeals}>
              Remove meal logs from the last 3 h
            </Check>
          </div>

          <div className="rounded-md border border-line p-3">
            <Check id="wi-add-ins" checked={addIns} onChange={setAddIns}>
              Add fast-acting insulin now
            </Check>
            <Slider id="wi-units" label="Dose" value={units} min={1} max={20} unit="IU" disabled={!addIns} onChange={setUnits} />
          </div>

          <div className="rounded-md border border-line p-3">
            <Check id="wi-rm-ins" checked={removeIns} onChange={setRemoveIns}>
              Remove insulin logged in the last 4 h
            </Check>
          </div>
        </fieldset>

        <button
          type="button"
          className="btn btn-primary mt-4 w-full"
          onClick={run}
          disabled={t == null || changes.length === 0 || state.status === 'loading'}
        >
          {state.status === 'loading' ? 'Running…' : 'Run'}
        </button>
        {changes.length === 0 && <p className="mt-2 text-xs text-muted">Choose at least one change to run.</p>}
        <p className="mt-3 text-xs text-muted">
          Runs at the current demo clock: <span className="num text-ink">{t != null ? clockLabel(t) : '…'}</span>
        </p>
      </section>

      <div className="min-w-0">
        {state.status === 'error' && (
          <div role="alert" className="card mb-4 flex items-start gap-3 border-low/50 p-4">
            <AlertIcon className="mt-0.5 shrink-0 text-low" width={18} height={18} />
            <div>
              <p className="font-semibold">{is409 ? 'No forecast exists at this time' : 'The run failed'}</p>
              <p className="mt-0.5 text-sm text-muted">
                {is409
                  ? 'The twin has no forecast at this moment, for example because CGM readings are missing or wear has ended, so there is nothing to compare against. Move the demo clock to a time when a forecast is shown and try again.'
                  : err?.message}
              </p>
            </div>
          </div>
        )}
        {state.data ? (
          <div className={cx(state.status === 'loading' && 'opacity-60')}>
            <Results r={state.data} atT={t} />
          </div>
        ) : state.status !== 'error' ? (
          <EmptyState title="Nothing has been run yet">
            Pick one or more changes on the left and press Run. You will see the baseline forecast beside a hatched, dashed
            scenario, the change in risk, and exactly which model inputs moved.
          </EmptyState>
        ) : null}
      </div>
    </div>
  )
}
