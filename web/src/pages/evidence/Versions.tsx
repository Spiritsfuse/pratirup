import type { ReactNode } from 'react'
import type { Evaluation, VersionSummary } from '../../api/types'
import { cx } from '../../components/ui'
import { HORIZON_NOTE, Section, f1, pc } from './shared'

interface Row {
  key: string
  measure: ReactNode
  v1: ReactNode
  v2: ReactNode
  change?: ReactNode
}

/** "+0.20 mg/dL (+2.4%)" for a lower-is-better metric; the word keeps the meaning out of colour alone. */
function Delta({ a, b, unit = 'mg/dL' }: { a: number; b: number; unit?: string }) {
  const d = b - a
  const rel = a !== 0 ? (d / a) * 100 : null
  const word = Math.abs(d) < 0.005 ? 'same' : d < 0 ? 'better' : 'worse'
  return (
    <span className="num whitespace-nowrap">
      {d > 0 ? '+' : ''}
      {d.toFixed(2)} {unit}
      {rel != null && (
        <span className="text-muted">
          {' '}
          ({rel > 0 ? '+' : ''}
          {rel.toFixed(1)}%)
        </span>
      )}{' '}
      <span className={cx('font-sans text-xs', word === 'better' ? 'font-semibold text-ink' : 'text-muted')}>{word}</span>
    </span>
  )
}

function dateOf(v: VersionSummary): string {
  return v.evaluated_at ? v.evaluated_at.slice(0, 10) : ''
}

export function WhatChanged({ ev, letter }: { ev: Evaluation; letter: string }) {
  const vs = ev.versions
  const a = vs?.v1
  const b = vs?.latest
  if (!vs || !a || !b) return null
  const hs = ['30', '60', '120'].filter((h) => a.mae?.[h] != null && b.mae?.[h] != null)

  const rows: Row[] = [
    ...hs.map((h) => ({
      key: `mae${h}`,
      measure: (
        <>
          MAE at +{h} min{HORIZON_NOTE(h)}, mg/dL
        </>
      ),
      v1: <span className="num">{f1(a.mae[h], 2)}</span>,
      v2: <span className="num font-semibold">{f1(b.mae[h], 2)}</span>,
      change: <Delta a={a.mae[h]} b={b.mae[h]} />,
    })),
    {
      key: 'cov60',
      measure: <>80% interval coverage at +60 min</>,
      v1: <span className="num">{pc(a.coverage_60, 1)}</span>,
      v2: <span className="num font-semibold">{pc(b.coverage_60, 1)}</span>,
      change: (
        <span className="num whitespace-nowrap text-muted">
          {((b.coverage_60 - a.coverage_60) * 100 >= 0 ? '+' : '') + ((b.coverage_60 - a.coverage_60) * 100).toFixed(1)} points
        </span>
      ),
    },
    {
      key: 'noise',
      measure: (
        <>
          MAE at +30 min with random sensor noise (SD 10 mg/dL), mg/dL
          <span className="block text-xs text-muted">last value carried forward in brackets</span>
        </>
      ),
      v1: (
        <span className="num">
          {f1(a.noise10_mae_30, 2)} <span className="text-muted">({f1(a.noise10_mae_30_persistence, 2)})</span>
          <span className="block font-sans text-xs text-muted">
            {a.noise10_mae_30 > a.noise10_mae_30_persistence ? 'worse than last value' : 'better than last value'}
          </span>
        </span>
      ),
      v2: (
        <span className="num">
          <span className="font-semibold">{f1(b.noise10_mae_30, 2)}</span>{' '}
          <span className="text-muted">({f1(b.noise10_mae_30_persistence, 2)})</span>
          <span className="block font-sans text-xs text-muted">
            {b.noise10_mae_30 > b.noise10_mae_30_persistence ? 'worse than last value' : 'better than last value'}
          </span>
        </span>
      ),
      change: <Delta a={a.noise10_mae_30} b={b.noise10_mae_30} />,
    },
    {
      key: 'alerts',
      measure: <>Alerts per patient-day</>,
      v1: <span className="num">{f1(a.alerts_per_day, 1)}</span>,
      v2: <span className="num font-semibold">{f1(b.alerts_per_day, 1)}</span>,
      change: <Delta a={a.alerts_per_day} b={b.alerts_per_day} unit="per day" />,
    },
    {
      key: 'false',
      measure: <>False alerts per patient-day</>,
      v1: a.false_alerts_per_day != null ? <span className="num">{f1(a.false_alerts_per_day, 1)}</span> : <span className="text-muted">not reported</span>,
      v2: b.false_alerts_per_day != null ? <span className="num font-semibold">{f1(b.false_alerts_per_day, 1)}</span> : <span className="text-muted">not reported</span>,
    },
    {
      key: 'design',
      measure: <>Alert design</>,
      v1: <span className="text-sm">{a.alert_design}</span>,
      v2: <span className="text-sm font-semibold">{b.alert_design}</span>,
    },
  ]

  const changes = (vs.changes ?? []).map((c) => c.replace(/^v\d+:\s*/, ''))

  return (
    <Section
      id="v2"
      letter={letter}
      title="What changed in v2"
      lead="The model was revised once after the first held-out evaluation. This compares the two versions on the same test patients."
      basis="test"
      basisN={ev.meta.split.test_patients}
    >
      <div className="card">
        <div className="scroll-x px-1 pb-1 pt-1">
          <table className="tbl">
            <caption className="sr-only">Model v1 compared with model v2 on the held-out test patients</caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col" className="r">
                  v1
                  {dateOf(a) && <span className="block text-[11px] font-normal">{dateOf(a)}</span>}
                </th>
                <th scope="col" className="r">
                  v2
                  {dateOf(b) && <span className="block text-[11px] font-normal">{dateOf(b)}</span>}
                </th>
                <th scope="col" className="r">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.measure}</td>
                  <td className="r">{r.v1}</td>
                  <td className={cx('r', 'bg-accent-soft/40')}>{r.v2}</td>
                  <td className="r">{r.change ?? <span className="text-muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
          Lower is better for every MAE and for alerts. Same <span className="num">{ev.meta.split.test_patients}</span> test patients for
          both versions; v1 results are archived unchanged.
        </p>
      </div>

      {changes.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-base">What was changed</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="max-w-3xl rounded-md border border-line bg-surface px-4 py-3 text-sm">
        v2 trades ~1–2% clean accuracy for robustness to sensor noise and a usable alert load; both changes were chosen on
        development patients only and the test set was re-scored once with the reason logged (results/runs.jsonl).
      </p>
    </Section>
  )
}

