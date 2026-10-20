import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import type { CalibrationBin, EventsBlock, Evaluation } from '../../api/types'
import { ChartBox, useChartColors } from '../../components/ChartBox'
import { Stat, cx } from '../../components/ui'
import { type Basis, Section, Sub, f1, pc } from './shared'

const KINDS: { key: string; title: string; short: string }[] = [
  { key: 'hypo', title: 'Glucose below 70 mg/dL', short: 'Below 70' },
  { key: 'hyper', title: 'Glucose above 180 mg/dL', short: 'Above 180' },
  { key: 'hyper2', title: 'Glucose above 250 mg/dL', short: 'Above 250' },
]

function lead(n: number | null | undefined, iqr: number[] | null | undefined): string {
  if (n == null) return '–'
  const base = `${n.toFixed(0)} min`
  return iqr && iqr.length === 2 ? `${base} (IQR ${iqr[0].toFixed(0)}–${iqr[1].toFixed(0)})` : base
}

export function Alerts({ ev, basis }: { ev: Evaluation; basis: Basis }) {
  const block: EventsBlock = basis === 'test' && ev.events.test ? ev.events.test : ev.events.dev_cv
  const scorers = ev.event_scorers
  // alert burden: from the test results when present, otherwise computed from the classifier rows being shown
  const burden =
    basis === 'test' && ev.alert_burden_test
      ? ev.alert_burden_test
      : {
          by_kind: Object.fromEntries(KINDS.map((k) => [k.key, block[k.key]?.classifier?.event.alerts_per_day ?? 0])),
          total_alerts_per_day: KINDS.reduce((s, k) => s + (block[k.key]?.classifier?.event.alerts_per_day ?? 0), 0),
        }
  const patientDays = block.hyper?.classifier?.event.patient_days
  return (
    <Section
      id="alerts"
      letter="e"
      title="Alerts: do they fire early enough, and how often are they wrong?"
      lead="An event is glucose staying beyond a consensus threshold for at least 15 minutes. Sensitivity is the share of events the twin warned about. A warning only helps if it comes early, so we also report the share caught with at least 30 minutes' notice. Positive predictive value (PPV) is the share of alerts that were followed by a real event."
      basis={basis}
      basisN={basis === 'test' ? ev.meta.split.test_patients : ev.meta.split.dev_patients}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Alert burden, all three types"
          value={
            <>
              {f1(burden.total_alerts_per_day, 1)} <span className="text-sm text-muted">/ patient-day</span>
            </>
          }
          sub={
            patientDays ? (
              <>
                Pratirup classifier, over <span className="num text-ink">{patientDays.toFixed(0)}</span> patient-days
              </>
            ) : (
              'Pratirup classifier'
            )
          }
        />
        {KINDS.map((k) => (
          <Stat
            key={k.key}
            label={`${k.short} alerts`}
            value={
              <>
                {f1(burden.by_kind[k.key], 1)} <span className="text-sm text-muted">/ patient-day</span>
              </>
            }
            sub={
              block[k.key]?.classifier ? (
                <>
                  of which false: <span className="num text-ink">{f1(block[k.key].classifier.event.false_alerts_per_day, 1)}</span>
                </>
              ) : null
            }
          />
        ))}
      </div>

      {KINDS.filter((k) => block[k.key]).map((k) => {
        const rows = scorers.filter((s) => block[k.key][s.key])
        return (
          <div key={k.key} className="card">
            <div className="px-4 pt-4">
              <Sub
                right={
                  <span className="text-xs text-muted">
                    prevalence <span className="num text-ink">{pc(block[k.key].classifier?.sample.prevalence, 1)}</span> of forecast moments ·{' '}
                    <span className="num text-ink">{block[k.key].classifier?.event.episodes}</span> events
                  </span>
                }
              >
                {k.title} within 60 min
              </Sub>
            </div>
            <div className="scroll-x px-1 pb-2">
              <table className="tbl">
                <caption className="sr-only">Alert performance for {k.title}, by scoring method</caption>
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    <th scope="col" className="r">
                      Sensitivity
                    </th>
                    <th scope="col" className="r" title="Share of events warned about at least 30 minutes ahead">
                      Sens. with ≥30 min warning
                    </th>
                    <th scope="col" className="r">
                      PPV
                    </th>
                    <th scope="col" className="r">
                      False alerts / patient-day
                    </th>
                    <th scope="col" className="r">
                      Median lead time
                    </th>
                    <th scope="col" className="r" title="Area under the precision-recall curve. A random scorer would equal the prevalence.">
                      AUPRC (prevalence)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const r = block[k.key][s.key]
                    const main = s.key === 'classifier'
                    return (
                      <tr key={s.key} className={cx(main && 'bg-accent-soft/50')}>
                        <td className={cx(main && 'font-semibold')}>{s.label}</td>
                        <td className="num r">
                          <span className="font-semibold">{pc(r.event.sensitivity, 1)}</span>{' '}
                          <span className="text-xs text-muted">
                            ({r.event.detected}/{r.event.episodes})
                          </span>
                        </td>
                        <td className="num r">{pc(r.event.sensitivity_lead30, 1)}</td>
                        <td className="num r">{pc(r.event.ppv, 1)}</td>
                        <td className="num r">{f1(r.event.false_alerts_per_day, 2)}</td>
                        <td className="num r whitespace-nowrap">{lead(r.event.lead_time_median_min, r.event.lead_time_iqr_min)}</td>
                        <td className="num r whitespace-nowrap">
                          <span className="font-semibold">{f1(r.sample.auprc, 2)}</span>{' '}
                          <span className="text-xs text-muted">({pc(r.sample.prevalence, 1)})</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      <p className="text-xs text-muted">
        Each method is given its own alert threshold, chosen on development data only. Rate-of-change and Kalman rows are simple
        rules without machine learning; they show how much the learned classifier adds.
      </p>

      <Calibration block={block} />
    </Section>
  )
}

function CalPlot({ bins, title }: { bins: CalibrationBin[]; title: string }) {
  const c = useChartColors()
  const data = bins.map((b) => ({ x: b.p_mean, y: b.observed, n: b.n }))
  const mx = Math.min(1, Math.max(...data.flatMap((d) => [d.x, d.y]), 0.02) * 1.1)
  const ticks = [0, 0.01, 0.05, 0.1, 0.25, 0.5, 1].filter((v) => v <= mx * 1.02)
  return (
    <div className="card p-3">
      <p className="mb-1 text-sm font-semibold">{title}</p>
      <ChartBox height={250} label={`Calibration plot: ${title}`}>
        {(w) => (
          <ScatterChart width={w} height={250} margin={{ top: 6, right: 12, bottom: 24, left: 0 }}>
            <CartesianGrid stroke={c.line} strokeOpacity={0.6} />
            <XAxis
              type="number"
              dataKey="x"
              scale="sqrt"
              domain={[0, mx]}
              ticks={ticks}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              tick={{ fill: c.muted, fontSize: 10 }}
              stroke={c.line}
              allowDataOverflow
              label={{ value: 'Predicted probability', position: 'insideBottom', offset: -14, style: { fill: c.muted, fontSize: 11 } }}
            />
            <YAxis
              type="number"
              dataKey="y"
              scale="sqrt"
              domain={[0, mx]}
              ticks={ticks}
              width={44}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              tick={{ fill: c.muted, fontSize: 10 }}
              stroke={c.line}
              allowDataOverflow
              label={{ value: 'Observed frequency', angle: -90, position: 'insideLeft', style: { fill: c.muted, fontSize: 11, textAnchor: 'middle' } }}
            />
            <ZAxis range={[40, 40]} />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: mx, y: mx }]} stroke={c.muted} strokeDasharray="4 4" />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: c.muted, strokeDasharray: '2 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as { x: number; y: number; n: number }
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                    <p>
                      Predicted <span className="num">{(d.x * 100).toFixed(2)}%</span>
                    </p>
                    <p>
                      Observed <span className="num">{(d.y * 100).toFixed(2)}%</span>
                    </p>
                    <p className="text-muted">
                      <span className="num">{d.n.toLocaleString()}</span> forecasts in bin
                    </p>
                  </div>
                )
              }}
            />
            <Scatter data={data} fill={c.accent} line={{ stroke: c.accent, strokeWidth: 1.8 }} isAnimationActive={false} />
          </ScatterChart>
        )}
      </ChartBox>
    </div>
  )
}

function Calibration({ block }: { block: EventsBlock }) {
  const kinds = KINDS.filter((k) => block[k.key]?.classifier?.calibration?.length)
  if (!kinds.length) return null
  return (
    <div>
      <Sub>Calibration: when the twin says 20%, does it happen about 20% of the time?</Sub>
      <div className="grid gap-4 lg:grid-cols-3">
        {kinds.map((k) => (
          <CalPlot key={k.key} bins={block[k.key].classifier.calibration!} title={`${k.title} within 60 min`} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Each dot is a group of forecasts with similar predicted risk. On the dashed diagonal means well calibrated. Both axes are
        square-root scaled so the common low-risk groups are readable.
      </p>
    </div>
  )
}
