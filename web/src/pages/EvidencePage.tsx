import { ApiError, api } from '../api/client'
import { EmptyState, ErrorState, PageTitle, Skeleton } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { Alerts } from './evidence/Events'
import { Ablation, Accuracy, Protocol, Uncertainty } from './evidence/Forecast'
import { External, Importance, Personalisation, Subgroups } from './evidence/More'
import { Robustness } from './evidence/Robustness'
import type { Basis } from './evidence/shared'
import { WhatChanged } from './evidence/Versions'

const TOC_LINK =
  'block whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-sm text-muted no-underline hover:bg-surface hover:text-ink hover:no-underline lg:border-0 lg:px-2'

export default function EvidencePage() {
  const res = useApi((s) => api.evaluation(s), [])
  const ev = res.data

  if (res.error && !ev) {
    const missing = res.error instanceof ApiError && res.error.status === 404
    return (
      <div>
        <PageTitle title="Evidence" />
        {missing ? (
          <EmptyState title="No evaluation results yet" tone="notice">
            The server has no benchmark file to show. Every figure on this page is read from it, never typed in by hand, so the
            page stays empty until results exist. Generate them with{' '}
            <code className="num rounded bg-bg px-1.5 py-0.5 text-xs">python -m pratirup.cli report</code> and reload.
          </EmptyState>
        ) : (
          <ErrorState error={res.error} onRetry={res.reload} title="Could not load the evaluation" />
        )}
      </div>
    )
  }
  if (!ev) {
    return (
      <div aria-busy="true" aria-label="Loading evaluation">
        <PageTitle title="Evidence" />
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  const hasVersions = !!(ev.versions?.v1 && ev.versions.latest)
  // Section order, which also drives the (a), (b), ... letters and the contents list.
  const toc: [string, string][] = [
    ...(hasVersions ? ([['v2', 'What changed in v2']] as [string, string][]) : []),
    ['protocol', 'Protocol'],
    ['accuracy', 'Forecast accuracy'],
    ['ablation', 'Data streams'],
    ['uncertainty', 'Uncertainty'],
    ['alerts', 'Alerts'],
    ['personalisation', 'Personalisation'],
    ['robustness', 'Robustness'],
    ['subgroups', 'Subgroups'],
    ['importance', 'Feature importance'],
    ...(ev.external != null ? ([['external', 'External validation']] as [string, string][]) : []),
  ]
  const L = (id: string) => String.fromCharCode(97 + toc.findIndex(([x]) => x === id))
  const hasTest = !!ev.forecast.test
  const basis: Basis = hasTest ? 'test' : 'dev_cv'
  const nTest = ev.meta.split.test_patients
  const nDev = ev.meta.split.dev_patients

  return (
    <div>
      <PageTitle
        title="Evidence"
        sub={
          (hasTest
            ? `How well does the twin do on ${nTest} patients it never saw? Every number on this page is read from the benchmark file the server generated, not written by hand.`
            : 'How well does the twin do? Every number on this page is read from the benchmark file the server generated, not written by hand.') +
          (ev.versions?.current != null ? ` Results are for model v${ev.versions.current}.` : '')
        }
      />

      {!hasTest && (
        <div role="status" className="mb-6 rounded-md border-2 border-high/60 bg-surface p-4 text-sm">
          <p className="font-semibold">Showing development cross-validation, not final test results</p>
          <p className="mt-1 text-muted">
            The held-out test evaluation ({nTest} patients, scored once) is not in the results file yet. Until it is, accuracy,
            alert and calibration figures below come from 5-fold patient-grouped cross-validation on the {nDev} development
            patients, which were also used to make design choices, so treat them as provisional. Robustness, subgroups,
            bootstrap intervals and feature importance appear only with the test run.
          </p>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[190px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="scroll-x lg:sticky lg:top-40 lg:self-start">
          <ul className="flex gap-2 lg:block lg:space-y-0.5">
            {toc.map(([id, label]) => (
              <li key={id} className="shrink-0">
                <a href={`#${id}`} className={TOC_LINK}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-9">
          {hasVersions && <WhatChanged ev={ev} letter={L('v2')} />}
          <Protocol ev={ev} letter={L('protocol')} />
          <Accuracy ev={ev} basis={basis} letter={L('accuracy')} />
          <Ablation ev={ev} basis={basis} letter={L('ablation')} />
          <Uncertainty ev={ev} basis={basis} letter={L('uncertainty')} />
          <Alerts ev={ev} basis={basis} letter={L('alerts')} />
          <Personalisation ev={ev} basis={basis} letter={L('personalisation')} />
          <Robustness ev={ev} letter={L('robustness')} />
          <Subgroups ev={ev} letter={L('subgroups')} />
          <Importance ev={ev} letter={L('importance')} />
          <External ev={ev} letter={L('external')} />
        </div>
      </div>
    </div>
  )
}
