import { useState } from 'react'
import type { Evaluation } from '../../api/types'
import { Segmented, cx } from '../../components/ui'
import { type Basis, Bar2, Pending, SOURCE_GROUP, Section, f1, pc, sortedHorizons } from './shared'

// ---------------------------------------------------------------- personalisation

export function Personalisation({ ev, basis }: { ev: Evaluation; basis: Basis }) {
  const sel = ev.personalisation.selected
  const hs = sortedHorizons(sel)
  const test = basis === 'test' ? ev.personalisation.test : undefined
  const block = basis === 'test' && ev.forecast.test ? ev.forecast.test : ev.forecast.dev_cv
  const rows = hs.map((h) => {
    const before = test?.[h]?.mae_population ?? block[h]?.['lgbm[full]']?.mae
    const after = test?.[h]?.mae_personal ?? block[h]?.['lgbm[full]+personal']?.mae
    return { h, before, after, p: sel[h] }
  })
  return (
    <Section
      id="personalisation"
      letter="f"
      title="Personalisation: learning each patient's habits"
      lead="After every forecast resolves, the twin keeps a decaying average of its own recent errors for that patient and adds a share of it to the next forecast. It needs no retraining and corrects a patient's persistent over- or under-shoot."
      basis={basis}
      basisN={basis === 'test' ? ev.meta.split.test_patients : ev.meta.split.dev_patients}
    >
      <div className="card scroll-x">
        <table className="tbl">
          <caption className="sr-only">Effect of the online personal correction</caption>
          <thead>
            <tr>
              <th scope="col">Horizon</th>
              <th scope="col" className="r">
                MAE, population model
              </th>
              <th scope="col" className="r">
                MAE, with self-correction
              </th>
              <th scope="col" className="r">
                Change
              </th>
              <th scope="col" className="r" title="Share of the running error average added to each forecast">
                Weight λ
              </th>
              <th scope="col" className="r" title="After this many readings an error counts half as much">
                Half-life
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ h, before, after, p }) => {
              const d = before != null && after != null ? after - before : null
              return (
                <tr key={h}>
                  <td className="num">
                    +{h} min {Number(h) > 60 && <span className="chip ml-1 !text-[11px]">exploratory</span>}
                  </td>
                  <td className="num r">{f1(before, 2)}</td>
                  <td className="num r font-semibold">{f1(after, 2)}</td>
                  <td className={cx('num r', d != null && d < 0 && 'font-semibold text-inrange')}>
                    {d == null ? '–' : `${d > 0 ? '+' : ''}${d.toFixed(2)} mg/dL`}
                    {d != null && before ? <span className="text-xs text-muted"> ({((d / before) * 100).toFixed(1)}%)</span> : null}
                  </td>
                  <td className="num r">{p?.lambda ?? '–'}</td>
                  <td className="num r">
                    {p ? `${p.halflife} readings (${((p.halflife * 15) / 60).toFixed(0)} h)` : '–'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
          Weight and half-life were chosen on development folds. Gains are modest by design: the correction is conservative so it
          cannot chase noise.
        </p>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------- robustness

const ROBUST_LABEL: Record<string, string> = {
  drop10: '10% of readings missing at random',
  drop30: '30% of readings missing at random',
  gap60_daily: 'A 60-minute sensor gap every day',
  noise10: 'Sensor noise, SD 10 mg/dL',
  noise20: 'Sensor noise, SD 20 mg/dL',
}

export function Robustness({ ev }: { ev: Evaluation }) {
  const r = ev.robustness_test
  const n = ev.meta.split.test_patients
  return (
    <Section
      id="robustness"
      letter="g"
      title="Robustness: messy sensor data"
      lead="Real CGM data has dropouts and noise. Here the test recordings are deliberately degraded and the twin is re-scored. The twin should abstain when it lacks data rather than guess, and should degrade gracefully."
      basis={r ? 'test' : undefined}
      basisN={n}
    >
      {!r ? (
        <Pending title="Available with the held-out test evaluation">
          Robustness runs on the {n} held-out test patients, so it is not shown from development data. It will appear here once
          the test evaluation is in the results file.
        </Pending>
      ) : (
        <div className="card scroll-x">
          <table className="tbl">
            <caption className="sr-only">Forecast error and coverage under degraded sensor data</caption>
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>
                  Condition
                </th>
                <th scope="col" rowSpan={2} className="r" title="Share of moments where the twin declined to forecast">
                  Abstains
                </th>
                <th scope="col" colSpan={2} className="r">
                  +30 min MAE, mg/dL
                </th>
                <th scope="col" colSpan={2} className="r">
                  +60 min MAE, mg/dL
                </th>
                <th scope="col" colSpan={2} className="r">
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
              {Object.entries(r).map(([k, v]) => (
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
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            Robustness uses the population model, before personal correction. The first row is the same model on the unmodified
            test data.
          </p>
        </div>
      )}
    </Section>
  )
}

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

// ---------------------------------------------------------------- subgroups

const GROUP_LABEL: Record<string, string> = {
  'rx_insulin_grp=insulin': 'On insulin',
  'rx_insulin_grp=no_insulin': 'Not on insulin',
  'hba1c_grp=hba1c_ge_8': 'HbA1c 8% or higher',
  'hba1c_grp=hba1c_lt_8': 'HbA1c below 8%',
}

export function Subgroups({ ev }: { ev: Evaluation }) {
  const g = ev.subgroups_test
  return (
    <Section
      id="subgroups"
      letter="h"
      title="Subgroups: does it work for everyone?"
      lead="Accuracy and alerting split by treatment and by glycaemic control. Subgroups of 20 patients are small, so differences here are a prompt for more data, not a conclusion."
      basis={g ? 'test' : undefined}
      basisN={ev.meta.split.test_patients}
    >
      {!g ? (
        <Pending title="Available with the held-out test evaluation">
          Subgroup results are computed on the held-out test patients and will appear here with that evaluation.
        </Pending>
      ) : (
        <div className="card scroll-x">
          <table className="tbl">
            <caption className="sr-only">Forecast and alert performance by subgroup</caption>
            <thead>
              <tr>
                <th scope="col">Subgroup</th>
                <th scope="col" className="r">
                  Patients
                </th>
                <th scope="col" className="r">
                  +30 min MAE (twin / last value)
                </th>
                <th scope="col" className="r">
                  +60 min MAE (twin / last value)
                </th>
                <th scope="col" className="r">
                  Sensitivity, above 180
                </th>
                <th scope="col" className="r">
                  False alerts / patient-day
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(g).map(([k, v]) => (
                <tr key={k}>
                  <td className="font-medium">{GROUP_LABEL[k] ?? k}</td>
                  <td className="num r">{v.patients}</td>
                  <td className="num r">
                    <span className="font-semibold">{f1(v.mae_30_lgbm, 2)}</span> <span className="text-muted">/ {f1(v.mae_30_persistence, 2)}</span>
                  </td>
                  <td className="num r">
                    <span className="font-semibold">{f1(v.mae_60_lgbm, 2)}</span> <span className="text-muted">/ {f1(v.mae_60_persistence, 2)}</span>
                  </td>
                  <td className="num r">{pc(v.hyper_sensitivity, 1)}</td>
                  <td className="num r">{f1(v.hyper_false_alerts_per_day, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            Forecasts here use the population model. Each patient appears in exactly one group per split.
          </p>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------- importance

export function Importance({ ev }: { ev: Evaluation }) {
  const imp = ev.importance_test
  const hs = imp ? sortedHorizons(imp) : []
  const [h, setH] = useState<string>(hs.includes('60') ? '60' : (hs[0] ?? '60'))
  return (
    <Section
      id="importance"
      letter="i"
      title="What the model relies on"
      lead="Which inputs carry the most weight, in two views: how often the model splits on a feature, and how many mg/dL each data stream moves the forecast on average (SHAP). These are associations the model uses, not causes."
      basis={imp ? 'test' : undefined}
      basisN={ev.meta.split.test_patients}
    >
      {!imp ? (
        <Pending title="Available with the held-out test evaluation">
          Feature importance is computed on the held-out test patients and will appear here with that evaluation.
        </Pending>
      ) : (
        <>
          <Segmented
            label="Forecast horizon"
            value={h}
            onChange={setH}
            options={hs.map((x) => ({ key: x, label: `+${x} min` }))}
          />
          {imp[h] && <ImportanceBody data={imp[h]} h={h} />}
        </>
      )}
    </Section>
  )
}

function ImportanceBody({ data, h }: { data: NonNullable<Evaluation['importance_test']>[string]; h: string }) {
  const top = data.gain_top.slice(0, 12)
  const max = Math.max(...top.map((x) => x.share), 1e-9)
  const groups = Object.entries(data.shap_by_group_mgdl).sort((a, b) => b[1] - a[1])
  const total = groups.reduce((s, [, v]) => s + v, 0) || 1
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-4">
        <h3 className="text-base">Top inputs by split gain, +{h} min</h3>
        <p className="mb-3 text-xs text-muted">Share of the model&apos;s total gain.</p>
        <ul className="space-y-2">
          {top.map((x) => (
            <li key={x.feature} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
              <span className="min-w-0 truncate text-sm" title={x.label ?? x.feature}>
                {x.label ?? x.feature}
              </span>
              <span className="num text-right text-xs font-semibold">{pc(x.share, 1)}</span>
              <Bar2 frac={x.share / max} color="rgb(var(--accent))" className="col-span-2" />
            </li>
          ))}
        </ul>
      </div>
      <div className="card p-4">
        <h3 className="text-base">Weight by data stream (SHAP), +{h} min</h3>
        <p className="mb-3 text-xs text-muted">Mean absolute effect on the forecast, in mg/dL, summed per stream.</p>
        <div className="flex h-4 w-full gap-px overflow-hidden rounded" role="img" aria-label={groups.map(([k, v]) => `${SOURCE_GROUP[k]?.label ?? k} ${pc(v / total)}`).join(', ')}>
          {groups.map(([k, v]) => (
            <div key={k} style={{ width: `${(v / total) * 100}%`, background: SOURCE_GROUP[k]?.color ?? '#888' }} />
          ))}
        </div>
        <table className="tbl mt-3">
          <caption className="sr-only">SHAP weight by data stream</caption>
          <thead>
            <tr>
              <th scope="col">Data stream</th>
              <th scope="col" className="r">
                mg/dL
              </th>
              <th scope="col" className="r">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([k, v]) => (
              <tr key={k}>
                <td>
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-[2px] align-middle" style={{ background: SOURCE_GROUP[k]?.color ?? '#888' }} aria-hidden="true" />
                  {SOURCE_GROUP[k]?.label ?? k}
                </td>
                <td className="num r">{f1(v, 2)}</td>
                <td className="num r font-semibold">{pc(v / total, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- external

export function External({ ev }: { ev: Evaluation }) {
  if (!ev.external) return null
  return (
    <Section
      id="external"
      letter="j"
      title="External validation"
      lead="Results on a dataset from outside the development cohort, as provided in the results file."
    >
      <details className="card" open>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Raw results</summary>
        <pre tabIndex={0} className="num m-0 max-h-96 overflow-auto border-t border-line bg-bg px-4 py-3 text-xs">
          {JSON.stringify(ev.external, null, 2)}
        </pre>
      </details>
    </Section>
  )
}
