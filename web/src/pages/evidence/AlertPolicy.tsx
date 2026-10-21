import type { Evaluation } from '../../api/types'
import { Stat, cx } from '../../components/ui'
import { useApp } from '../../state/app'
import { type Basis, Sub, f1, pc } from './shared'

type PopKey = 'dev' | 'test' | 'external_t2d'

/** Label for each population the consolidated alert policy was scored on. */
function populations(ev: Evaluation): { key: PopKey; label: string; sub: string }[] {
  const ap = ev.alert_policy
  if (!ap) return []
  const ext = ev.external as { subjects?: { t2d?: number }; dataset?: string } | undefined
  const out: { key: PopKey; label: string; sub: string }[] = []
  if (ap.dev)
    out.push({
      key: 'dev',
      label: 'Development patients',
      sub: `${ev.meta.split.dev_patients} patients, cross-validated; thresholds were set here`,
    })
  if (ap.test)
    out.push({ key: 'test', label: 'Held-out test patients', sub: `${ev.meta.split.test_patients} patients, scored once` })
  if (ap.external_t2d) {
    const name = ext?.dataset ? ext.dataset.split(' (')[0] : 'external dataset'
    out.push({
      key: 'external_t2d',
      label: 'External dataset, type 2',
      sub: `${name}${ext?.subjects?.t2d ? `, ${ext.subjects.t2d} people` : ''}`,
    })
  }
  return out
}

const KINDS: { key: 'hypo' | 'hyper2'; label: string }[] = [
  { key: 'hypo', label: 'Below 70 mg/dL' },
  { key: 'hyper2', label: 'Above 250 mg/dL' },
]

/** The consolidated v2 alert policy: what the app actually alerts on. */
export function AlertPolicy({ ev, basis }: { ev: Evaluation; basis: Basis }) {
  const { meta } = useApp()
  const ap = ev.alert_policy
  const pops = populations(ev)
  if (!ap || !pops.length) return null
  const useTest = basis === 'test' && !!ap.test
  const head = (useTest ? ap.test : (ap.dev ?? ap.test))!
  const headLabel = useTest ? 'held-out test patients' : 'development patients'
  const budget = meta?.alert_policy?.false_alert_budget_per_day
  const cooldown = meta?.alert_policy?.cooldown_min
  return (
    <div className="space-y-4">
      <Sub>Alert policy: one stream per patient</Sub>
      <p className="-mt-2 max-w-3xl text-sm text-muted">
        An alert fires when the model puts enough probability on glucose going below 70 or above 250 mg/dL within 60 minutes.
        {cooldown ? ` Alerts share one ${cooldown}-minute cooldown, and a predicted low can break through a high alert's cooldown.` : ''}{' '}
        A predicted rise above 180 only ranks the patient on the worklist. An alert is true if a real event follows it, and false
        otherwise.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Alerts per patient-day" value={f1(head.alerts_per_day, 1)} sub={`${headLabel}, both kinds together`} />
        <Stat
          label="False alerts per patient-day"
          value={f1(head.false_alerts_per_day, 1)}
          sub={budget != null ? `design budget: at most ${budget}, set on development patients` : undefined}
        />
        <Stat label="Positive predictive value" value={pc(head.ppv, 0)} sub="share of alerts followed by a real event" />
        <Stat
          label="Patient-days scored"
          value={head.patient_days.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          sub={headLabel}
        />
      </div>

      <div className="card">
        <div className="scroll-x px-1 pb-1 pt-1">
          <table className="tbl">
            <caption className="sr-only">Consolidated alert policy: alert burden and precision by population</caption>
            <thead>
              <tr>
                <th scope="col">Population</th>
                <th scope="col" className="r">
                  Patient-days
                </th>
                <th scope="col" className="r">
                  Alerts / patient-day
                </th>
                <th scope="col" className="r">
                  False alerts / patient-day
                </th>
                <th scope="col" className="r" title="Positive predictive value: share of alerts followed by a real event">
                  PPV
                </th>
              </tr>
            </thead>
            <tbody>
              {pops.map((p) => {
                const r = ap[p.key]!
                return (
                  <tr key={p.key} className={cx(p.key === 'test' && 'bg-accent-soft/50')}>
                    <td>
                      <span className="font-medium">{p.label}</span>
                      <span className="block text-xs text-muted">{p.sub}</span>
                    </td>
                    <td className="num r">{r.patient_days.toFixed(0)}</td>
                    <td className="num r font-semibold">{f1(r.alerts_per_day, 2)}</td>
                    <td className="num r">{f1(r.false_alerts_per_day, 2)}</td>
                    <td className="num r">{pc(r.ppv, 1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="scroll-x px-1 pb-1 pt-1">
          <table className="tbl">
            <caption className="sr-only">Consolidated alert policy: detection of events by kind and population</caption>
            <thead>
              <tr>
                <th scope="col">Alert kind</th>
                <th scope="col">Population</th>
                <th scope="col" className="r">
                  Events
                </th>
                <th scope="col" className="r">
                  Sensitivity
                </th>
                <th scope="col" className="r" title="Share of events warned about at least 30 minutes ahead">
                  Sens. with ≥30 min warning
                </th>
                <th scope="col" className="r">
                  Median lead time
                </th>
              </tr>
            </thead>
            <tbody>
              {KINDS.flatMap((k) =>
                pops.map((p, i) => {
                  const r = ap[p.key]![k.key]
                  return (
                    <tr key={`${k.key}-${p.key}`} className={cx(i === 0 && 'border-t border-line')}>
                      <td className="font-medium">{i === 0 ? k.label : <span className="sr-only">{k.label}</span>}</td>
                      <td>{p.label}</td>
                      <td className="num r">{r.episodes}</td>
                      <td className="num r">
                        <span className="font-semibold">{pc(r.sensitivity, 1)}</span>{' '}
                        <span className="text-xs text-muted">
                          ({Math.round(r.sensitivity * r.episodes)}/{r.episodes})
                        </span>
                      </td>
                      <td className="num r">{pc(r.sensitivity_lead30, 1)}</td>
                      <td className="num r whitespace-nowrap">
                        {r.lead_time_median_min != null ? `${r.lead_time_median_min.toFixed(0)} min` : '–'}
                      </td>
                    </tr>
                  )
                }),
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
          Events are glucose staying past the level for at least 15 minutes. Sensitivity is the share of events the policy warned
          about; the ≥30 min column counts only warnings given at least half an hour ahead. The alert thresholds are probability
          cut-offs chosen on development patients
          {budget != null ? ` to keep false alerts at or under ${budget} per patient-day` : ''}
          {ap.dev && ap.test
            ? `; that rate was ${f1(ap.dev.false_alerts_per_day, 2)} on development patients and ${f1(ap.test.false_alerts_per_day, 2)} on the held-out test patients`
            : ''}
          {ap.external_t2d ? `, and ${f1(ap.external_t2d.false_alerts_per_day, 2)} on the external dataset` : ''}.
        </p>
      </div>
    </div>
  )
}
