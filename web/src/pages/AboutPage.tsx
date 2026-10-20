import { Link } from 'react-router-dom'
import { ExternalIcon } from '../components/icons'
import { PageTitle } from '../components/ui'
import { useApp } from '../state/app'

const TEAM = [
  { name: 'Dhruv Sharma', handle: 'Spiritsfuse' },
  { name: 'Pratyush Mishra', handle: 'PratyushMishra-2nd' },
  { name: 'Anushika Chauhan', handle: 'Anushika06' },
]

const LOOP = [
  {
    n: '1',
    title: 'State',
    text: 'For each patient the twin holds a small, explicit state: a Kalman-filtered glucose level and rate of change that smooth sensor noise, a count of recent readings (so it knows when it is blind), and a running profile of that patient’s own usual day.',
  },
  {
    n: '2',
    title: 'Update loop',
    text: 'Every new CGM reading, and every logged meal, insulin dose or oral agent, updates the state. Nothing is recomputed from scratch, which is why the same loop drives both a replayed recording and a live stream.',
  },
  {
    n: '3',
    title: 'Forecast',
    text: 'From the state the twin forecasts glucose 30, 60 and 120 minutes ahead, each with an 80% interval, plus the probability of going below 70 or above 180 and 250 mg/dL within the hour. If it has too little recent data it abstains instead of guessing.',
  },
  {
    n: '4',
    title: 'Ledger',
    text: 'Every forecast is stored when issued and scored when its target time arrives, per patient, with nothing edited after the fact. The ledger is how a clinician can see whether to trust the twin for this person, today.',
  },
]

const LIMITS = [
  'It is not causal. It learned associations from observational records, so “what-if” shows model sensitivity, not what would happen if a meal or dose really changed.',
  'It does not see exercise, sleep, stress, illness, alcohol or menstrual cycle. The source data has none of them.',
  'It has no macronutrient detail. Meals are free-text diet logs that were parsed into approximate quantities, and many entries carry no detail at all.',
  'It reads a CGM sensor, not blood glucose. Interstitial readings lag blood by several minutes and can drift or drop out.',
  'It was trained and tested on people with type 2 diabetes from two hospitals in Shanghai, recorded 2019–2021. It is not representative of Indian patients, other ages of onset or type 1 diabetes, and it has not been validated prospectively.',
  'The 120-minute horizon is exploratory. Uncertainty widens quickly, and the page labels it as such everywhere it appears.',
  'It gives no dosing advice and makes no treatment recommendation.',
]

export default function AboutPage() {
  const { meta } = useApp()
  return (
    <div className="max-w-4xl">
      <PageTitle
        title="About Pratirup"
        sub="A research-prototype glucose digital twin for type 2 diabetes care teams. Built by students, evaluated on held-out patients, and honest about what it cannot do."
      />

      <section className="mb-9" aria-labelledby="what">
        <h2 id="what" className="mb-2 text-xl">
          What the twin is
        </h2>
        <p className="mb-4 max-w-3xl text-muted">
          A digital twin here is a live, per-patient software model that is kept in step with the real patient by data. It is not a
          chart of past values: it carries a belief about the patient right now, and uses it to say what is likely to happen
          next and how sure it is.
        </p>
        <ol className="grid gap-3 sm:grid-cols-2">
          {LOOP.map((s) => (
            <li key={s.n} className="card p-4">
              <p className="flex items-center gap-2.5 text-base font-semibold">
                <span className="num flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs text-surface">{s.n}</span>
                {s.title}
              </p>
              <p className="mt-2 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 max-w-3xl text-sm text-muted">
          Try it: open the <Link to="/">worklist</Link>, pick a patient and move the demo clock; or start a{' '}
          <Link to="/live">live stream</Link> to watch the loop run one reading at a time. The{' '}
          <Link to="/evidence">evidence page</Link> shows how well it works.
        </p>
      </section>

      <section className="mb-9" aria-labelledby="data">
        <h2 id="data" className="mb-2 text-xl">
          Data, provenance and licences
        </h2>
        <div className="card scroll-x">
          <table className="tbl">
            <caption className="sr-only">Data sources and licences</caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Source</th>
                <th scope="col">Licence</th>
                <th scope="col">Used for</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-medium">ShanghaiT2DM</td>
                <td className="text-sm">
                  Zhao Q, Zhu J, Shen X, et al. <em>Chinese diabetes datasets for data-driven machine learning.</em> Scientific
                  Data 10, 35 (2023).{' '}
                  <a href="https://doi.org/10.1038/s41597-023-01940-7" target="_blank" rel="noopener noreferrer">
                    doi:10.1038/s41597-023-01940-7 <ExternalIcon className="inline" width={12} height={12} />
                  </a>
                </td>
                <td>
                  <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
                    CC BY 4.0
                  </a>
                </td>
                <td className="text-sm">Training, validation, test and this demo. 100 people, 109 CGM recordings, linked records.</td>
              </tr>
              <tr>
                <td className="font-medium">CGMacros</td>
                <td className="text-sm">Das A, Kerr D, Glantz N, et al. Scientific Data 12, 1557 (2025).</td>
                <td>
                  <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer">
                    CC BY-NC-SA 4.0
                  </a>
                </td>
                <td className="text-sm">External evaluation only. Not shipped; model weights are trained on ShanghaiT2DM alone.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-3 max-w-3xl space-y-1.5 text-sm text-muted">
          <li>
            <strong className="font-semibold text-ink">Real, not synthetic.</strong> {meta?.provenance.clinical_record ?? 'De-identified research record (ShanghaiT2DM, CC BY 4.0). Real, not synthetic.'}
          </li>
          <li>
            <strong className="font-semibold text-ink">Replayed.</strong> {meta?.provenance.cgm ?? 'Real CGM readings from held-out patients, replayed on a demo clock.'}
          </li>
          <li>
            <strong className="font-semibold text-ink">Time.</strong> {meta?.provenance.time_shift ?? 'Wear days and clock times are real; calendar dates are hidden.'}
          </li>
          <li>
            <strong className="font-semibold text-ink">Held out.</strong> {meta?.demo_population ?? 'The demo patients were never used for training or tuning.'}
          </li>
          <li>
            <strong className="font-semibold text-ink">Code.</strong> The project&apos;s source code is Apache-2.0; the data keeps its own
            licence.
          </li>
          {meta?.model?.trained_at && (
            <li>
              <strong className="font-semibold text-ink">Model.</strong>{' '}
              <span className="num">
                trained {meta.model.trained_at.slice(0, 10)} on {meta.model.train_patients ?? '–'} patients · commit {meta.model.git_commit ?? '–'}
              </span>
            </li>
          )}
        </ul>
      </section>

      <section className="mb-9" aria-labelledby="limits">
        <h2 id="limits" className="mb-2 text-xl">
          What it cannot represent
        </h2>
        <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="mb-9" aria-labelledby="disc">
        <h2 id="disc" className="mb-2 text-xl">
          Clinical disclaimer
        </h2>
        <div className="max-w-3xl rounded-md border-2 border-ink/70 bg-surface p-4">
          <p className="font-semibold">{meta?.disclaimer ?? 'Research prototype. Not a medical device.'}</p>
          <p className="mt-2 text-sm text-muted">
            Nothing here is medical advice, a diagnosis or a treatment recommendation. Do not use it to decide care for any
            real person.
          </p>
        </div>
      </section>

      <section aria-labelledby="team">
        <h2 id="team" className="mb-2 text-xl">
          Team Aflatoon
        </h2>
        <p className="mb-3 max-w-3xl text-sm text-muted">
          Scaler School of Technology, Bengaluru. Built for the Happiest Health Digital Twin Challenge 2026.
        </p>
        <ul className="grid gap-3 sm:grid-cols-3">
          {TEAM.map((m) => (
            <li key={m.handle} className="card p-4">
              <p className="font-semibold">{m.name}</p>
              <a
                className="num mt-1 inline-flex items-center gap-1.5 text-sm"
                href={`https://github.com/${m.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${m.name} on GitHub: github.com/${m.handle}`}
              >
                github.com/{m.handle} <ExternalIcon width={12} height={12} />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
