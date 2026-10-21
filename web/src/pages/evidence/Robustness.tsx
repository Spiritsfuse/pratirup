import { Fragment, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { Evaluation } from '../../api/types'
import { ChartBox, useChartColors } from '../../components/ChartBox'
import { Segmented, cx } from '../../components/ui'
import { BasisChip, HORIZON_NOTE, Pending, Section, Sub, f1, pc, sortedHorizons } from './shared'

// ---------------------------------------------------------------- robustness table

const ROBUST_LABEL: Record<string, string> = {
  drop10: '10% of readings missing at random',
  drop30: '30% of readings missing at random',
  gap60_daily: 'A 60-minute sensor gap every day',
  noise5: 'Random sensor noise, SD 5 mg/dL',
  noise10: 'Random sensor noise, SD 10 mg/dL',
  noise20: 'Random sensor noise, SD 20 mg/dL',
  arnoise10: 'Autocorrelated (AR(1)) noise, SD 10 mg/dL',
}

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Missing data', keys: ['drop10', 'drop30', 'gap60_daily'] },
  { title: 'Sensor noise', keys: ['noise5', 'noise10', 'noise20', 'arnoise10'] },
]

function ReferenceRow({ ev }: { ev: Evaluation }) {
  const t = ev.forecast.test
  const i = ev.intervals.test
  if (!t) return null
  return (
    <tr className="bg-accent-soft/50">
      <td className="font-semibold">No degradation (reference)</td>
      <td className="num r text-muted">–</td>
      <td className="num r font-semibold">{f1(t['30']?.['lgbm[full]']?.mae, 2)}</td>
      <td className="num r text-muted">{f1(t['30']?.persistence?.mae, 2)}</td>
      <td className="num r font-semibold">{f1(t['60']?.['lgbm[full]']?.mae, 2)}</td>
      <td className="num r text-muted">{f1(t['60']?.persistence?.mae, 2)}</td>
      <td className="num r">{pc(i?.['30']?.population.coverage, 1)}</td>
      <td className="num r">{pc(i?.['60']?.population.coverage, 1)}</td>
    </tr>
  )
}

export function Robustness({ ev, letter }: { ev: Evaluation; letter: string }) {
  const r = ev.robustness_test
  const n = ev.meta.split.test_patients
  // Known conditions in a sensible order, then anything else the results file adds.
  const known = new Set(GROUPS.flatMap((g) => g.keys))
  const extra = r ? Object.keys(r).filter((k) => !known.has(k)) : []
  const groups = r
    ? [
        ...GROUPS.map((g) => ({ title: g.title, keys: g.keys.filter((k) => r[k]) })),
        ...(extra.length ? [{ title: 'Other conditions', keys: extra }] : []),
      ].filter((g) => g.keys.length)
    : []
  // Coverage under the heaviest noise, read from the table so the caption cannot drift from it.
  const noiseKeys = (r ? GROUPS[1].keys.filter((k) => r[k]) : []) as string[]
  const worstCov = r && noiseKeys.length ? Math.min(...noiseKeys.map((k) => r[k].coverage_30)) : null
  return (
    <Section
      id="robustness"
      letter={letter}
      title="Robustness: messy sensor data"
      lead="Real CGM data has dropouts and noise. Here the test recordings are deliberately degraded and the twin is re-scored. The twin should decline to forecast when it lacks data rather than guess, and should degrade gracefully."
      basis={r ? 'test' : undefined}
      basisN={n}
    >
      {!r ? (
        <Pending title="Available with the held-out test evaluation">
          Robustness runs on the {n} held-out test patients, so it is not shown from development data. It will appear here once
          the test evaluation is in the results file.
        </Pending>
      ) : (
        <div className="card">
          <div className="scroll-x">
            <table className="tbl">
              <caption className="sr-only">Forecast error and coverage under degraded sensor data</caption>
              <thead>
                <tr>
                  <th scope="col" rowSpan={2}>
                    Condition
                  </th>
                  <th
                    scope="col"
                    rowSpan={2}
                    className="r"
                    title="Share of moments where the twin declined to forecast (abstained)"
                  >
                    No forecast issued
                  </th>
                  <th scope="colgroup" colSpan={2} className="r">
                    +30 min MAE, mg/dL
                  </th>
                  <th scope="colgroup" colSpan={2} className="r">
                    +60 min MAE, mg/dL
                  </th>
                  <th scope="colgroup" colSpan={2} className="r">
                    80% interval coverage
                  </th>
                </tr>
                <tr>
                  {['Twin', 'Last value', 'Twin', 'Last value', '+30', '+60'].map((x, i) => (
                    <th key={i} scope="col" className="r !pt-0 text-[11px] font-medium">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <ReferenceRow ev={ev} />
                {groups.map((g) => (
                  <Fragment key={g.title}>
                    <tr>
                      <th
                        scope="rowgroup"
                        colSpan={8}
                        className="!border-b-0 bg-bg/60 !py-1.5 text-[11px] uppercase tracking-wide"
                      >
                        {g.title}
                      </th>
                    </tr>
                    {g.keys.map((k) => {
                      const v = r[k]
                      return (
                        <tr key={k}>
                          <td>{ROBUST_LABEL[k] ?? k}</td>
                          <td className="num r">{pc(v.abstention_rate, 1)}</td>
                          <td className="num r font-semibold">{f1(v.mae_30_lgbm, 2)}</td>
                          <td className="num r text-muted">{f1(v.mae_30_persistence, 2)}</td>
                          <td className="num r font-semibold">{f1(v.mae_60_lgbm, 2)}</td>
                          <td className="num r text-muted">{f1(v.mae_60_persistence, 2)}</td>
                          <td className="num r">{pc(v.coverage_30, 1)}</td>
                          <td className="num r">{pc(v.coverage_60, 1)}</td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            Robustness uses the population model, before personal correction. The first row is the same model on the unmodified
            test data. <em>No forecast issued</em> is the share of moments where the twin refused to forecast because too many
            readings were missing. Autocorrelated noise drifts slowly, like a real sensor, instead of jumping independently at
            every reading.
            {worstCov != null && (
              <>
                {' '}
                Noise also makes the intervals overconfident: at +30 min the 80% interval held the outcome only{' '}
                <span className="num text-ink">{pc(worstCov, 0)}</span> of the time under the heaviest noise.
              </>
            )}
          </p>
        </div>
      )}

      <NoiseExperiment ev={ev} />
    </Section>
  )
}

// ---------------------------------------------------------------- why v2

type SeriesKey = 'v1' | 'v2' | 'pers'

export function NoiseExperiment({ ev }: { ev: Evaluation }) {
  const ne = ev.noise_experiment_dev
  const c = useChartColors()
  const hs = ne ? sortedHorizons(ne.results) : []
  const [h, setH] = useState<string>(hs.includes('30') ? '30' : (hs[0] ?? '30'))
  if (!ne || !hs.length) return null
  const res = ne.results[h] ?? ne.results[hs[0]]
  const sds = ne.eval_noise_sd
  const data = sds.map((sd) => {
    const v1 = res[`v1_clean_training|sd=${sd}`]
    const v2 = res[`v2_noise_augmented|sd=${sd}`]
    return { sd, v1: v1?.mae, v2: v2?.mae, pers: v1?.mae_persistence ?? v2?.mae_persistence }
  })
  const label: Record<SeriesKey, string> = {
    v1: 'v1 (trained on clean data)',
    v2: 'v2 (noise-augmented training)',
    pers: 'Last value carried forward',
  }
  const color: Record<SeriesKey, string> = { v1: c.vhigh, v2: c.accent, pers: c.muted }
  // First noise level at which a model stops beating "last value".
  const firstLose = (k: 'v1' | 'v2') => data.find((d) => d[k] != null && d.pers != null && d[k]! > d.pers!)?.sd
  const l1 = firstLose('v1')
  const l2 = firstLose('v2')
  const maxSd = Math.max(...sds)
  const d = ne.decision
  const trainSds = ne.train_noise_sd
  return (
    <div className="space-y-3 border-t border-line pt-5">
      <Sub right={<BasisChip basis="dev_cv" />}>Why v2: accuracy under sensor noise (development patients)</Sub>
      <p className="max-w-3xl text-sm text-muted">
        v1 was trained only on clean CGM and fell apart when the signal was noisy. v2 also trains on copies of the development
        recordings with added noise
        {trainSds?.length ? ` (SD ${trainSds.join(', ')} mg/dL)` : ''} and sees a measure of how rough the recent trace is. Each
        point below re-scores the same development patients after adding random noise of the stated size to the readings.
      </p>

      <div className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">MAE as sensor noise grows</p>
          <Segmented
            label="Forecast horizon"
            value={h}
            onChange={setH}
            options={hs.map((x) => ({ key: x, label: `+${x} min${Number(x) > 60 ? '*' : ''}` }))}
          />
        </div>
        <ChartBox
          height={280}
          label={`Line chart of +${h} minute MAE against added sensor noise for v1, v2 and last value carried forward`}
        >
          {(w) => (
            <LineChart width={w} height={280} data={data} margin={{ top: 8, right: 24, bottom: 22, left: 0 }}>
              <CartesianGrid stroke={c.line} vertical={false} strokeOpacity={0.7} />
              <XAxis
                dataKey="sd"
                type="number"
                domain={[0, maxSd]}
                ticks={sds}
                tick={{ fill: c.muted, fontSize: 11 }}
                stroke={c.line}
                tickLine={false}
                label={{
                  value: 'Added sensor noise, SD (mg/dL)',
                  position: 'insideBottom',
                  offset: -14,
                  style: { fill: c.muted, fontSize: 11 },
                }}
              />
              <YAxis
                width={46}
                tick={{ fill: c.muted, fontSize: 11 }}
                stroke={c.line}
                tickLine={false}
                domain={[0, 'auto']}
                label={{
                  value: 'MAE (mg/dL)',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: c.muted, fontSize: 11, textAnchor: 'middle' },
                }}
              />
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: c.muted, strokeDasharray: '2 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as { sd: number; v1?: number; v2?: number; pers?: number }
                  return (
                    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                      <p className="mb-1 font-semibold">Added noise SD {row.sd} mg/dL</p>
                      {(['v1', 'v2', 'pers'] as SeriesKey[]).map((k) => (
                        <p key={k} className="flex justify-between gap-4">
                          <span style={{ color: color[k] }}>{label[k]}</span>
                          <span className="num">{f1(row[k], 2)}</span>
                        </p>
                      ))}
                    </div>
                  )
                }}
              />
              <Legend
                verticalAlign="top"
                height={26}
                iconType="plainline"
                formatter={(v: string) => <span style={{ color: c.muted, fontSize: 12 }}>{v}</span>}
              />
              <Line
                dataKey="pers"
                name={label.pers}
                type="linear"
                stroke={color.pers}
                strokeWidth={1.8}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="v1"
                name={label.v1}
                type="linear"
                stroke={color.v1}
                strokeWidth={2.2}
                dot={{ r: 4, fill: c.surface, stroke: color.v1, strokeWidth: 2 }}
                isAnimationActive={false}
              />
              <Line
                dataKey="v2"
                name={label.v2}
                type="linear"
                stroke={color.v2}
                strokeWidth={2.6}
                dot={{ r: 4, fill: color.v2, stroke: c.surface, strokeWidth: 1.5 }}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ChartBox>

        <div className="scroll-x mt-1">
          <table className="tbl">
            <caption className="sr-only">+{h} minute MAE by added sensor noise, v1 and v2</caption>
            <thead>
              <tr>
                <th scope="col">
                  +{h} min MAE{HORIZON_NOTE(h)}
                </th>
                {sds.map((sd) => (
                  <th key={sd} scope="col" className="r">
                    {sd === 0 ? 'No added noise' : `SD ${sd}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['v1', 'v2', 'pers'] as SeriesKey[]).map((k) => (
                <tr key={k} className={cx(k === 'v2' && 'bg-accent-soft/50')}>
                  <td className={cx(k === 'v2' && 'font-semibold')}>{label[k]}</td>
                  {data.map((row) => {
                    const v = row[k]
                    const loses = k !== 'pers' && v != null && row.pers != null && v > row.pers
                    return (
                      <td
                        key={row.sd}
                        className={cx('num r', k !== 'pers' && !loses && 'font-semibold', k === 'pers' && 'text-muted')}
                      >
                        {f1(v, 2)}
                        {loses && <span className="sr-only"> (worse than last value)</span>}
                        {loses && (
                          <span aria-hidden="true" className="ml-0.5 text-low">
                            *
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          A forecast is only useful while it stays below the last-value line; <span className="text-low">*</span> marks where it
          does not. At +{h} min, v1 first falls behind last value at noise SD{' '}
          {l1 != null ? <span className="num text-ink">{l1}</span> : 'none of the tested levels'}
          {l1 != null ? ' mg/dL' : ''}; v2{' '}
          {l2 != null ? (
            <>
              first does at SD <span className="num text-ink">{l2}</span> mg/dL
            </>
          ) : (
            'stays ahead at every tested level'
          )}
          .{Number(h) > 60 ? ' *+120 min is exploratory.' : ''}
        </p>
      </div>

      {d && (
        <p className="max-w-3xl text-xs text-muted">
          <strong className="font-semibold text-ink">Decision rule.</strong> {d.rule}. On development patients, clean +60 min MAE
          changed by{' '}
          <span className="num text-ink">
            {d.clean_60_relative_change >= 0 ? '+' : ''}
            {(d.clean_60_relative_change * 100).toFixed(1)}%
          </span>
          , and +30 min MAE at noise SD 10 improved by{' '}
          <span className="num text-ink">{(d.noisy10_30_relative_gain * 100).toFixed(1)}%</span>
          {d.noisy10_30_beats_persistence ? ' and beat last value' : ' but did not beat last value'}.{' '}
          {d.adopt_v2 ? 'The rule adopted v2.' : 'The rule did not adopt v2.'}
        </p>
      )}
    </div>
  )
}
