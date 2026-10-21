import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { Evaluation, ModelDef, PointMetrics } from '../../api/types'
import { ChartBox, alpha, useChartColors } from '../../components/ChartBox'
import { Segmented, Stat, cx } from '../../components/ui'
import {
  type Basis,
  BasisChip,
  FOUNDATION_KEY,
  FOUNDATION_LABEL,
  HORIZON_NOTE,
  Pending,
  Section,
  Sub,
  f1,
  foundationAt,
  foundationBlock,
  modelLabel,
  pc,
  pk,
  primaryModel,
  safeKey,
  sortedHorizons,
} from './shared'

const NOMINAL = 0.8 // the intervals are built to be 80% intervals

// ---------------------------------------------------------------- protocol

export function Protocol({ ev, letter }: { ev: Evaluation; letter: string }) {
  const m = ev.meta
  const ts = m.test_stage
  const dev = m.dev_stage
  return (
    <Section
      id="protocol"
      letter={letter}
      title="Protocol"
      lead="How the numbers on this page were produced. The split is by patient, never by time window, so no patient contributes to both training and scoring."
    >
      <ol className="list-decimal space-y-1.5 pl-5 text-sm">
        {m.protocol.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ol>
      <dl className="grid gap-x-8 gap-y-3 rounded-md border border-line bg-surface p-4 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted">Dataset</dt>
          <dd>{m.dataset}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Split</dt>
          <dd className="num">
            by {m.split.unit}: {m.split.dev_patients} development · {m.split.test_patients} test
          </dd>
          <dd className="num text-xs text-muted">
            {m.split.folds}-fold grouped CV · stratified by {m.split.stratified_by} · seed {m.split.seed}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Development run</dt>
          <dd className="num">
            {dev.dev_recordings ?? '–'} recordings · {dev.issuable_rows?.toLocaleString() ?? '–'} forecasts scored
          </dd>
          <dd className="num text-xs text-muted">
            commit {dev.git_commit ?? '–'} · {dev.generated_at ?? ''}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted">Held-out test evaluation</dt>
          {ts ? (
            <>
              <dd className="num">
                evaluated {ts.evaluated_at ?? '–'} · {ts.test_patients ?? '–'} patients · {ts.test_recordings ?? '–'} recordings ·{' '}
                {ts.issuable_rows?.toLocaleString() ?? '–'} forecasts scored
              </dd>
              <dd className="num text-xs text-muted">
                commit {ts.git_commit ?? '–'}
                {ts.reason ? ` · re-run reason: ${ts.reason}` : ' · scored once with the frozen model'}
              </dd>
            </>
          ) : (
            <dd>
              Not in this results file yet. Every number below is from <strong>development cross-validation</strong> and will be
              replaced by held-out test results when they are generated.
            </dd>
          )}
        </div>
      </dl>
      <p className="text-xs text-muted">Results file generated {m.generated_at}.</p>
    </Section>
  )
}

// ---------------------------------------------------------------- accuracy

function WrapTick(props: { x?: number; y?: number; payload?: { value: string }; chars: number; fill: string; boldLabels: Set<string> }) {
  const { x = 0, y = 0, payload, chars, fill, boldLabels } = props
  const words = (payload?.value ?? '').split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > chars && cur) {
      lines.push(cur)
      cur = w
    } else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)
  const bold = boldLabels.has(payload?.value ?? '')
  return (
    <text x={x - 6} y={y} textAnchor="end" fill={fill} fontSize={11} fontWeight={bold ? 700 : 400}>
      {lines.map((l, i) => (
        <tspan key={i} x={x - 6} dy={i === 0 ? `${-(lines.length - 1) * 0.5 + 0.35}em` : '1.1em'}>
          {l}
        </tspan>
      ))}
    </text>
  )
}

interface CompareEntry {
  key: string
  label: string
  kind: string
  /** metrics by horizon; the foundation model only has MAE and RMSE */
  at: (h: string) => { mae: number; rmse: number; bias?: number; parkes?: Record<string, number> } | undefined
}

/** App models plus, when the results file has it, the zero-shot foundation model (slotted after the GRU). */
function compareEntries(ev: Evaluation, block: Record<string, Record<string, PointMetrics>>, basis: Basis): CompareEntry[] {
  const hs = sortedHorizons(block)
  const out: CompareEntry[] = ev.models
    .filter((m) => hs.some((h) => block[h]?.[m.key]))
    .map((m) => ({ key: m.key, label: m.label, kind: m.kind, at: (h: string) => block[h]?.[m.key] }))
  if (hs.some((h) => foundationAt(ev, basis, h))) {
    const entry: CompareEntry = {
      key: FOUNDATION_KEY,
      label: FOUNDATION_LABEL,
      kind: 'foundation',
      at: (h) => {
        const f = foundationAt(ev, basis, h)
        return f ? { mae: f.mae, rmse: f.rmse } : undefined
      },
    }
    const i = out.findIndex((e) => e.key === 'gru_seq')
    out.splice(i >= 0 ? i + 1 : out.length, 0, entry)
  }
  return out
}

function MaeChart({ ev, entries, hs }: { ev: Evaluation; entries: CompareEntry[]; hs: string[] }) {
  const c = useChartColors()
  const data = entries.map((m) => {
    const row: Record<string, string | number | undefined> = { label: m.label, kind: m.kind }
    for (const h of hs) row[`h${h}`] = m.at(h)?.mae
    return row
  })
  const colorFor = (h: string) => (Number(h) === 30 ? c.pastfc : Number(h) === 60 ? c.accent : alpha(c.muted, 0.45))
  const bold = new Set(ev.models.filter((m) => m.kind === 'pratirup').map((m) => m.label))
  const rowH = 20 * hs.length + 18
  return (
    <ChartBox height={data.length * rowH + 44} label="Grouped bar chart of mean absolute error by model and forecast horizon">
      {(w) => {
        const yw = w < 520 ? 118 : 208
        return (
          <BarChart
            layout="vertical"
            width={w}
            height={data.length * rowH + 44}
            data={data}
            margin={{ top: 22, right: 38, bottom: 4, left: 0 }}
            barGap={1}
            barCategoryGap="14%"
          >
            <CartesianGrid stroke={c.line} horizontal={false} strokeOpacity={0.7} />
            <XAxis
              type="number"
              orientation="top"
              tick={{ fill: c.muted, fontSize: 11 }}
              stroke={c.line}
              tickLine={false}
              label={{ value: 'MAE, mg/dL (lower is better)', position: 'top', offset: 6, style: { fill: c.muted, fontSize: 11 } }}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={yw}
              tickLine={false}
              stroke={c.line}
              interval={0}
              tick={<WrapTick chars={Math.floor(yw / 6.4)} fill={c.ink} boldLabels={bold} />}
            />
            <Tooltip
              cursor={{ fill: c.line, fillOpacity: 0.35 }}
              isAnimationActive={false}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                    <p className="mb-1 font-semibold">{label}</p>
                    {hs.map((h) => {
                      const v = (payload[0].payload as Record<string, number | undefined>)[`h${h}`]
                      return (
                        <p key={h} className="flex justify-between gap-4">
                          <span className="text-muted">
                            +{h} min{HORIZON_NOTE(h)}
                          </span>
                          <span className="num">{f1(v, 2)} mg/dL</span>
                        </p>
                      )
                    })}
                  </div>
                )
              }}
            />
            <Legend
              verticalAlign="bottom"
              iconType="square"
              wrapperStyle={{ fontSize: 12, paddingTop: 6 }}
              formatter={(v: string) => <span style={{ color: c.muted }}>{v}</span>}
            />
            {hs.map((h) => (
              <Bar
                key={h}
                dataKey={`h${h}`}
                name={`+${h} min${HORIZON_NOTE(h)}`}
                fill={colorFor(h)}
                isAnimationActive={false}
                radius={[0, 2, 2, 0]}
              >
                <LabelList dataKey={`h${h}`} position="right" formatter={(v: number) => v.toFixed(1)} style={{ fill: c.muted, fontSize: 10 }} />
              </Bar>
            ))}
          </BarChart>
        )
      }}
    </ChartBox>
  )
}

function Contrasts({ ev, h }: { ev: Evaluation; h: string }) {
  const b = ev.bootstrap_test?.[h]
  if (!b) return null
  const safe = new Map(ev.models.map((m) => [safeKey(m.key), m]))
  const rows = Object.entries(b).map(([k, v]) => {
    const [a, c] = k.split('_vs_')
    const A: ModelDef | undefined = safe.get(a)
    const C: ModelDef | undefined = safe.get(c)
    return { k, a: A?.label ?? a, c: C?.label ?? c, v }
  })
  return (
    <div className="scroll-x rounded-md border border-line bg-surface">
      <table className="tbl">
        <caption className="sr-only">Patient-level bootstrap of the MAE difference at +{h} minutes</caption>
        <thead>
          <tr>
            <th scope="col">Comparison (MAE of first minus second)</th>
            <th scope="col" className="r">
              Difference, mg/dL
            </th>
            <th scope="col" className="r">
              95% CI
            </th>
            <th scope="col" className="r" title="Share of bootstrap resamples in which the first model had the lower MAE">
              First is better in
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ k, a, c, v }) => (
            <tr key={k}>
              <td>
                {a} <span className="text-muted">vs</span> {c}
              </td>
              <td className="num r font-semibold">{f1(v.diff, 2)}</td>
              <td className="num r text-muted">
                {f1(v.ci95[0], 2)} to {f1(v.ci95[1], 2)}
              </td>
              <td className="num r">{pc(v.p_a_better)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-3 py-2 text-xs text-muted">
        Resampled by patient ({ev.meta.split.test_patients} test patients), so the interval reflects patient-to-patient variation,
        not just the number of forecasts. Negative differences favour the first model.
      </p>
    </div>
  )
}

const PER_PATIENT_MODELS = ['persistence', 'lgbm[full]', 'lgbm[full]+personal']

function PerPatient({ ev }: { ev: Evaluation }) {
  const pp = ev.per_patient_test
  if (!pp) return null
  const hs = sortedHorizons(pp)
  const keys = PER_PATIENT_MODELS.filter((k) => hs.some((h) => pp[h]?.[k]))
  if (!keys.length) return null
  const n = ev.meta.split.test_patients
  const main = primaryModel(ev)
  return (
    <div>
      <Sub right={<BasisChip basis="test" />}>Per-patient error: how much does accuracy vary between people?</Sub>
      <div className="card">
        <div className="scroll-x px-1 pb-1">
          <table className="tbl">
            <caption className="sr-only">
              Mean and standard deviation, across test patients, of each patient&apos;s MAE and RMSE
            </caption>
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>
                  Model
                </th>
                {hs.map((h) => (
                  <th key={h} scope="colgroup" colSpan={2} className="r">
                    +{h} min{HORIZON_NOTE(h)}
                  </th>
                ))}
              </tr>
              <tr>
                {hs.flatMap((h) => [
                  <th key={`${h}m`} scope="col" className="r !pt-0 text-[11px] font-medium">
                    MAE
                  </th>,
                  <th key={`${h}r`} scope="col" className="r !pt-0 text-[11px] font-medium">
                    RMSE
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className={cx(k === main && 'bg-accent-soft/50')}>
                  <td className={cx(k.startsWith('lgbm') && 'font-semibold')}>{modelLabel(ev, k)}</td>
                  {hs.flatMap((h) => {
                    const v = pp[h]?.[k]
                    return [
                      <td key={`${h}m`} className="num r whitespace-nowrap">
                        {v ? (
                          <>
                            <span className="font-semibold">{f1(v.mae_mean, 2)}</span> <span className="text-muted">± {f1(v.mae_sd, 2)}</span>
                          </>
                        ) : (
                          '–'
                        )}
                      </td>,
                      <td key={`${h}r`} className="num r whitespace-nowrap">
                        {v ? (
                          <>
                            {f1(v.rmse_mean, 2)} <span className="text-muted">± {f1(v.rmse_sd, 2)}</span>
                          </>
                        ) : (
                          '–'
                        )}
                      </td>,
                    ]
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
          Mean ± SD across the <span className="num">{n}</span> test patients, in mg/dL. A larger SD means accuracy differs more from
          one person to the next; the headline figures above pool every forecast instead.
        </p>
      </div>
    </div>
  )
}

export function Accuracy({ ev, basis, letter }: { ev: Evaluation; basis: Basis; letter: string }) {
  const block = basis === 'test' && ev.forecast.test ? ev.forecast.test : ev.forecast.dev_cv
  const hs = sortedHorizons(block)
  const [h, setH] = useState<string>(hs.includes('60') ? '60' : hs[0])
  const main = primaryModel(ev)
  const base = 'persistence'
  const headline = (hz: string) => {
    const b = ev.bootstrap_test?.[hz]?.lgbm_full_vs_persistence
    const fullM = block[hz]?.['lgbm[full]']
    const baseM = block[hz]?.[base]
    if (b) {
      const lower = -b.diff
      return (
        <>
          <strong className="font-semibold text-ink">{hz}-min MAE is {f1(Math.abs(lower), 2)} mg/dL {lower >= 0 ? 'lower' : 'higher'}</strong>{' '}
          than carrying the last value forward (95% CI {f1(Math.min(-b.ci95[0], -b.ci95[1]), 2)} to {f1(Math.max(-b.ci95[0], -b.ci95[1]), 2)}, patient bootstrap, population model with personal history).
        </>
      )
    }
    if (fullM && baseM) {
      const d = baseM.mae - fullM.mae
      return (
        <>
          <strong className="font-semibold text-ink">{hz}-min MAE is {f1(Math.abs(d), 2)} mg/dL {d >= 0 ? 'lower' : 'higher'}</strong> than
          carrying the last value forward (development cross-validation; confidence interval comes with the held-out test run).
        </>
      )
    }
    return null
  }
  const entries = compareEntries(ev, block, basis)
  const rows = entries.filter((m) => m.at(h))
  const best = Math.min(...rows.map((m) => m.at(h)!.mae))
  const hasFoundation = entries.some((m) => m.key === FOUNDATION_KEY)
  const fProtocol = ev.foundation_model?.protocol
  const mainM = (hz: string) => block[hz]?.[main]
  return (
    <Section
      id="accuracy"
      letter={letter}
      title="Forecast accuracy"
      lead="Mean absolute error (MAE) is the average gap, in mg/dL, between what the twin forecast and what the sensor then read. Last-value-carried-forward is the bar any forecast has to clear."
      basis={basis}
      basisN={basis === 'test' ? ev.meta.split.test_patients : ev.meta.split.dev_patients}
    >
      <p className="-mb-2 text-sm text-muted">
        <strong className="font-semibold text-ink">{modelLabel(ev, main)}</strong> against{' '}
        <strong className="font-semibold text-ink">{modelLabel(ev, base)}</strong>, mean absolute error in mg/dL.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {hs.map((hz) => (
          <Stat
            key={hz}
            label={`+${hz} min MAE`}
            value={
              <>
                {f1(mainM(hz)?.mae, 2)} <span className="text-sm text-muted">mg/dL</span>
              </>
            }
            sub={
              <>
                Last value: <span className="num text-ink">{f1(block[hz]?.[base]?.mae, 2)}</span>
                {Number(hz) > 60 && <span className="chip ml-2 !text-[11px]">exploratory</span>}
              </>
            }
          />
        ))}
      </div>

      <ul className="space-y-1.5 text-sm text-muted">
        {['30', '60'].filter((x) => hs.includes(x)).map((hz) => (
          <li key={hz}>{headline(hz)}</li>
        ))}
      </ul>

      <div className="card p-4">
        <Sub>MAE by model and horizon</Sub>
        <MaeChart ev={ev} entries={entries} hs={hs} />
        <p className="mt-2 text-xs text-muted">
          Bold rows are Pratirup. Grey bars are +120 min, which is exploratory: the further ahead, the less any model can
          know.
          {hasFoundation && ' The foundation model is a pretrained reference, not part of Pratirup.'}
        </p>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <Sub>Full error table</Sub>
          <Segmented
            label="Forecast horizon"
            value={h}
            onChange={setH}
            options={hs.map((x) => ({ key: x, label: `+${x} min${Number(x) > 60 ? '*' : ''}` }))}
          />
        </div>
        <div className="scroll-x px-1 pb-2">
          <table className="tbl">
            <caption className="sr-only">Forecast error by model at +{h} minutes</caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col" className="r">
                  MAE
                </th>
                <th scope="col" className="r">
                  RMSE
                </th>
                <th scope="col" className="r">
                  Bias
                </th>
                <th scope="col" className="r" title="Clarke-style Parkes error grid, type 2: zone A (clinically accurate)">
                  Parkes A
                </th>
                <th scope="col" className="r" title="Zones A and B: no or benign clinical effect">
                  Parkes A+B
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const r = m.at(h)!
                const isMain = m.kind === 'pratirup'
                const partial = m.kind === 'foundation'
                return (
                  <tr key={m.key} className={cx(isMain && 'bg-accent-soft/50')}>
                    <td className={cx(isMain && 'font-semibold')}>{m.label}</td>
                    <td className={cx('num r', r.mae === best && 'font-bold text-accent')}>{f1(r.mae, 2)}</td>
                    <td className="num r">{f1(r.rmse, 2)}</td>
                    <td className="num r text-muted">{partial ? '—' : f1(r.bias, 2)}</td>
                    <td className="num r">{partial ? '—' : pk(r.parkes?.A)}</td>
                    <td className="num r">{partial ? '—' : pk(r.parkes?.['A+B'], 2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
          MAE, RMSE and bias are in mg/dL; bias is forecast minus actual. Best MAE is in bold colour.
          {Number(h) > 60 ? ' *+120 min is exploratory.' : ''} Parkes zones are percentages of forecasts.
        </p>
        {hasFoundation && (
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            <strong className="font-semibold text-ink">Chronos-Bolt small</strong> is Amazon&apos;s pretrained time-series model,
            used zero-shot (no training on our data).{fProtocol ? ` Protocol: ${fProtocol}.` : ''} Only MAE and RMSE were scored for
            it, over <span className="num">{foundationBlock(ev, basis)?.n_forecasts?.toLocaleString() ?? '–'}</span> forecasts, so
            its other cells are —.
          </p>
        )}
      </div>

      <PerPatient ev={ev} />

      {ev.bootstrap_test ? (
        <div>
          <Sub right={<BasisChip basis="test" />}>Is the difference real? Patient-level bootstrap</Sub>
          <Contrasts ev={ev} h={h} />
        </div>
      ) : (
        <Pending title="Bootstrap confidence intervals">
          Intervals on the accuracy differences are computed on the held-out test patients, and will appear here once that
          evaluation is in the results file.
        </Pending>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------- ablation

const SHORT: Record<string, string> = {
  'lgbm[cgm]': 'CGM only',
  'lgbm[cgm+events]': '+ logs',
  'lgbm[cgm+events+ehr]': '+ clinical record',
  'lgbm[full]': '+ personal history',
  'lgbm[full]+personal': '+ self-correction',
}

export function Ablation({ ev, basis, letter }: { ev: Evaluation; basis: Basis; letter: string }) {
  const c = useChartColors()
  const block = basis === 'test' && ev.forecast.test ? ev.forecast.test : ev.forecast.dev_cv
  const hs = sortedHorizons(block)
  const ladder = ev.models.filter((m) => (m.kind === 'ablation' || m.kind === 'pratirup') && hs.some((h) => block[h]?.[m.key]))
  const data = ladder.map((m) => {
    const row: Record<string, string | number> = { name: SHORT[m.key] ?? m.label, full: m.label }
    for (const h of hs) if (block[h]?.[m.key]) row[`h${h}`] = block[h][m.key].mae
    return row
  })
  // data-driven summary at +60
  let summary: React.ReactNode = null
  const k60 = hs.includes('60') ? '60' : hs[0]
  if (ladder.length >= 2) {
    const v = ladder.map((m) => block[k60]?.[m.key]?.mae ?? NaN)
    let bigI = 1
    let bigD = 0
    for (let i = 1; i < v.length; i++) {
      const d = v[i - 1] - v[i]
      if (d > bigD) {
        bigD = d
        bigI = i
      }
    }
    summary = (
      <>
        At +{k60} min, MAE goes from <span className="num text-ink">{f1(v[0], 2)}</span> mg/dL with CGM alone to{' '}
        <span className="num text-ink">{f1(v[v.length - 1], 2)}</span> mg/dL with every stream. The biggest single step is{' '}
        <strong className="font-semibold text-ink">{SHORT[ladder[bigI].key] ?? ladder[bigI].label}</strong> (
        <span className="num text-ink">−{f1(bigD, 2)}</span> mg/dL).
      </>
    )
  }
  return (
    <Section
      id="ablation"
      letter={letter}
      title="What each data stream adds"
      lead="The same model family, retrained with one more data stream at a time. If a stream does not lower the error, it does not earn its place."
      basis={basis}
      basisN={basis === 'test' ? ev.meta.split.test_patients : ev.meta.split.dev_patients}
    >
      <div className="card p-4">
        <ChartBox height={300} label="Line chart of MAE as data streams are added">
          {(w) => (
            <LineChart width={w} height={300} data={data} margin={{ top: 20, right: 28, bottom: 6, left: 0 }}>
              <CartesianGrid stroke={c.line} vertical={false} strokeOpacity={0.7} />
              <XAxis dataKey="name" tick={{ fill: c.muted, fontSize: w < 520 ? 10 : 11 }} stroke={c.line} tickLine={false} interval={0} />
              <YAxis
                width={46}
                tick={{ fill: c.muted, fontSize: 11 }}
                stroke={c.line}
                tickLine={false}
                domain={['auto', 'auto']}
                label={{ value: 'MAE (mg/dL)', angle: -90, position: 'insideLeft', style: { fill: c.muted, fontSize: 11, textAnchor: 'middle' } }}
              />
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: c.muted, strokeDasharray: '2 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as Record<string, string | number>
                  return (
                    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                      <p className="mb-1 font-semibold">{String(d.full)}</p>
                      {hs.map((h) => (
                        <p key={h} className="flex justify-between gap-4">
                          <span className="text-muted">
                            +{h} min{HORIZON_NOTE(h)}
                          </span>
                          <span className="num">{f1(Number(d[`h${h}`]), 2)} mg/dL</span>
                        </p>
                      ))}
                    </div>
                  )
                }}
              />
              <Legend verticalAlign="top" height={24} iconType="plainline" formatter={(v: string) => <span style={{ color: c.muted, fontSize: 12 }}>{v}</span>} />
              {hs.map((h) => (
                <Line
                  key={h}
                  dataKey={`h${h}`}
                  name={`+${h} min${HORIZON_NOTE(h)}`}
                  type="linear"
                  stroke={Number(h) === 30 ? c.pastfc : Number(h) === 60 ? c.accent : c.muted}
                  strokeWidth={Number(h) > 60 ? 1.6 : 2.4}
                  strokeDasharray={Number(h) > 60 ? '5 4' : undefined}
                  dot={{ r: 4, fill: c.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                >
                  <LabelList dataKey={`h${h}`} position="top" offset={8} formatter={(v: number) => v.toFixed(2)} style={{ fill: c.muted, fontSize: 10 }} />
                </Line>
              ))}
            </LineChart>
          )}
        </ChartBox>
        {summary && <p className="mt-2 text-sm text-muted">{summary}</p>}
        <p className="mt-2 text-xs text-muted">
          Streams: <em>CGM</em> is the recent glucose trace; <em>logs</em> are meals, insulin and oral agents; the{' '}
          <em>clinical record</em> is labs and history; <em>personal history</em> is this patient&apos;s own usual daily pattern;{' '}
          <em>self-correction</em> nudges forecasts by the patient&apos;s recent errors.
        </p>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------- uncertainty

export function Uncertainty({ ev, basis, letter }: { ev: Evaluation; basis: Basis; letter: string }) {
  const useTest = basis === 'test' && ev.intervals.test
  const hs = sortedHorizons(useTest ? ev.intervals.test! : ev.intervals.dev_cv)
  const c = useChartColors()
  return (
    <Section
      id="uncertainty"
      letter={letter}
      title="Uncertainty: are the 80% intervals honest?"
      lead="Every forecast comes with a range that should contain the outcome about 80% of the time. If coverage is far below 80%, the twin is overconfident; far above, the range is too wide to be useful."
      basis={basis}
      basisN={basis === 'test' ? ev.meta.split.test_patients : ev.meta.split.dev_patients}
    >
      <div className="card scroll-x">
        <table className="tbl">
          <caption className="sr-only">Interval coverage and width by horizon</caption>
          <thead>
            <tr>
              <th scope="col">Horizon</th>
              <th scope="col">{useTest ? 'Coverage, population intervals' : 'Coverage'}</th>
              {useTest && <th scope="col">Coverage, with personal correction</th>}
              <th scope="col" className="r">
                Mean width, mg/dL
              </th>
            </tr>
          </thead>
          <tbody>
            {hs.map((h) => {
              const pop = useTest ? ev.intervals.test![h].population : ev.intervals.dev_cv[h]
              const per = useTest ? ev.intervals.test![h].personal : null
              const cov = (x: number) => (
                <div className="flex min-w-[170px] items-center gap-2">
                  <span className="num w-12 text-right font-semibold">{pc(x, 1)}</span>
                  <span className="relative block h-2 flex-1 rounded-full bg-line/80" aria-hidden="true">
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${x * 100}%`, background: c.accent }} />
                    <span className="absolute -top-[3px] h-[14px] w-[2px] bg-ink" style={{ left: `${NOMINAL * 100}%` }} />
                  </span>
                </div>
              )
              return (
                <tr key={h}>
                  <td className="num">
                    +{h} min {Number(h) > 60 && <span className="chip ml-1 !text-[11px]">exploratory</span>}
                  </td>
                  <td>{cov(pop.coverage)}</td>
                  {useTest && <td>{per ? cov(per.coverage) : null}</td>}
                  <td className="num r">{f1(pop.mean_width, 1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
          The tick marks the nominal {pc(NOMINAL)}.{' '}
          {useTest
            ? 'These are scored on patients the intervals were never tuned on, so a gap from 80% is real miscalibration.'
            : 'On development data the intervals are tuned to hit 80% by construction (conformal calibration), so this check is only meaningful on the held-out test patients. Those results are not in this file yet.'}
        </p>
      </div>
    </Section>
  )
}
