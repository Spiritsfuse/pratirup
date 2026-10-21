import { Suspense, lazy } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { RegimenChips } from '../components/clinical'
import { TwinView } from '../components/twin/TwinView'
import { ErrorState, LiveBadge, ProvChip, Skeleton, Tabs, type TabDef } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { clockLabel, round, sexLabel } from '../lib/format'
import { useApp } from '../state/app'

// The Twin tab is the landing view and ships with this page; the others load on demand.
const LedgerTab = lazy(() => import('./patient/LedgerTab').then((m) => ({ default: m.LedgerTab })))
const AgpTab = lazy(() => import('./patient/AgpTab').then((m) => ({ default: m.AgpTab })))
const WhatIfTab = lazy(() => import('./patient/WhatIfTab').then((m) => ({ default: m.WhatIfTab })))
const RecordTab = lazy(() => import('./patient/RecordTab').then((m) => ({ default: m.RecordTab })))

type TabKey = 'twin' | 'ledger' | 'agp' | 'whatif' | 'record'
const TAB_KEYS: TabKey[] = ['twin', 'ledger', 'agp', 'whatif', 'record']

function TabFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num text-sm font-medium">{children}</dd>
    </div>
  )
}

export default function PatientPage() {
  const { rid = '' } = useParams()
  const { t, link } = useApp()
  const [params, setParams] = useSearchParams()
  const rec = useApi((s) => api.patient(rid, s), [rid])
  const raw = params.get('tab') as TabKey | null
  const tab: TabKey = raw && TAB_KEYS.includes(raw) ? raw : 'twin'
  const p = rec.data
  const s = p?.summary
  const live = p ? p.mode === 'live' : rid.startsWith('LIVE-')

  const tabs: TabDef<TabKey>[] = [
    { key: 'twin', label: 'Twin' },
    { key: 'ledger', label: 'Ledger' },
    { key: 'agp', label: 'AGP', hint: 'Ambulatory glucose profile' },
    { key: 'whatif', label: 'What-if', disabled: live, hint: live ? 'Available for replayed patients' : undefined },
    { key: 'record', label: 'Record' },
  ]

  function setTab(k: TabKey) {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (k === 'twin') n.delete('tab')
        else n.set('tab', k)
        return n
      },
      { replace: false },
    )
  }

  if (rec.error && !p) {
    return (
      <div className="space-y-4">
        <Link to={link('/')} className="text-sm">
          ← Back to worklist
        </Link>
        <ErrorState
          error={rec.error}
          onRetry={(rec.error as { status?: number }).status === 404 ? undefined : rec.reload}
          title={rec.error.message.toLowerCase().includes('unknown') ? 'That patient was not found' : 'Could not load this patient'}
        />
      </div>
    )
  }

  return (
    <div>
      <Link to={link('/')} className="mb-3 inline-block text-sm">
        ← Worklist
      </Link>

      <header className="mb-4">
        {!s ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-5 w-full max-w-xl" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="num text-2xl">{s.display_id}</h1>
              {live && <LiveBadge />}
              <ProvChip kind="research" text="De-identified research record" />
              {!live && <ProvChip kind="replay" />}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 md:grid-cols-6">
              <Fact label="Age · sex">
                {s.age ?? '–'} y · {sexLabel(s.sex) || '–'}
              </Fact>
              <Fact label="BMI">{round(s.bmi, 1)} kg/m²</Fact>
              <Fact label="Diabetes duration">{s.diabetes_duration_y != null ? `${s.diabetes_duration_y} y` : '–'}</Fact>
              <Fact label="HbA1c">
                {s.hba1c_pct != null ? `${round(s.hba1c_pct, 1)}%` : '–'}
                {s.hba1c_mmolmol != null && <span className="font-normal text-muted"> ({round(s.hba1c_mmolmol)} mmol/mol)</span>}
              </Fact>
              <Fact label="Fasting C-peptide">{s.cpeptide_fasting_nmol != null ? `${round(s.cpeptide_fasting_nmol, 2)} nmol/L` : '–'}</Fact>
              {p && !live && (
                <Fact label="CGM wear">
                  <span className="text-xs font-normal">
                    {clockLabel(p.start_demo)} to {clockLabel(p.end_demo)}
                  </span>
                </Fact>
              )}
            </dl>
            <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Regimen</span>
                <RegimenChips items={s.regimen} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Complications</span>
                {s.complications.length ? (
                  <span className="flex flex-wrap gap-1">
                    {s.complications.map((c) => (
                      <span key={c} className="chip">
                        {c}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-xs italic text-muted">none recorded</span>
                )}
              </div>
            </div>
          </>
        )}
      </header>

      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Patient views" />

      <div className="pt-4" role="tabpanel" aria-label={tabs.find((x) => x.key === tab)?.label}>
        {tab === 'twin' && <TwinView key={rid} rid={rid} t={t} live={live} pollMs={live ? 1500 : undefined} />}
        <Suspense fallback={<TabFallback />}>
          {tab === 'ledger' && <LedgerTab key={rid} rid={rid} t={t} live={live} />}
          {tab === 'agp' && <AgpTab key={rid} rid={rid} t={t} live={live} />}
          {tab === 'whatif' && <WhatIfTab key={rid} rid={rid} t={t} live={!!live} />}
          {tab === 'record' && <RecordTab record={p} />}
        </Suspense>
      </div>
    </div>
  )
}
