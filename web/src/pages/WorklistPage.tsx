import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Meta, TierName, WorklistPatient } from '../api/types'
import { AgpBar, AlertBadge, PriorityChip, RegimenChips, RiskMini, TIER_ORDER, glucoseTone, tierInfo } from '../components/clinical'
import { BellIcon, ChevronIcon, TrendIcon } from '../components/icons'
import { ErrorState, LiveBadge, PageTitle, ProvChip, Skeleton, cx } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { minutesAgo, pct, round, sexLabel } from '../lib/format'
import { useApp } from '../state/app'

const COLS =
  'lg:grid lg:grid-cols-[minmax(160px,1.15fr)_minmax(190px,1.2fr)_120px_minmax(140px,0.9fr)_minmax(170px,1fr)_minmax(150px,1fr)] lg:gap-x-5'

function statusText(p: WorklistPatient): string {
  switch (p.status) {
    case 'monitoring':
      return minutesAgo(p.minutes_since_reading)
    case 'no_recent_data':
      return `No reading for ${p.minutes_since_reading ?? '?'} min`
    case 'ended':
      return 'CGM wear finished'
    case 'not_started':
      return 'CGM not started yet'
    case 'warming_up':
      return 'Warming up'
  }
}

function PatientRow({ p, href, nowT }: { p: WorklistPatient; href: string; nowT: number }) {
  const s = p.summary
  const live = p.mode === 'live'
  const f = p.forecast_60
  const inactive = p.status !== 'monitoring'
  return (
    <li className="relative border-b border-line px-4 py-3 last:border-b-0 hover:bg-bg/70 focus-within:bg-bg/70">
      <div className={cx('flex flex-col gap-3', COLS, 'lg:items-center')}>
        {/* priority */}
        <div className="order-2 min-w-0 lg:order-none">
          <PriorityChip name={p.priority.name} />
          <p className="mt-1 text-xs leading-snug text-muted">{p.priority.reason}</p>
          {p.alert && <AlertBadge alert={p.alert} nowT={nowT} className="mt-1.5" />}
        </div>

        {/* patient */}
        <div className="order-1 flex min-w-0 flex-col gap-1.5 lg:order-none">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to={href}
              className="num text-base font-semibold text-ink no-underline after:absolute after:inset-0 after:content-[''] hover:no-underline focus-visible:after:rounded-md"
              aria-label={`Open ${s.display_id}, ${p.priority.name}: ${p.priority.reason}`}
            >
              {s.display_id}
            </Link>
            {live && <LiveBadge />}
            <span className="text-sm text-muted">
              {s.age != null ? `${s.age} y` : ''} {sexLabel(s.sex)}
            </span>
          </div>
          <RegimenChips items={s.regimen} limit={3} />
        </div>

        {/* glucose now + forecast: side by side on small screens, separate columns on desktop */}
        <div className="order-3 grid grid-cols-2 gap-3 lg:order-none lg:contents">
        <div className="lg:block">
          <div className="flex items-center gap-1.5">
            <span className={cx('num text-3xl font-medium leading-none', glucoseTone(p.glucose))}>
              {p.glucose != null ? round(p.glucose) : '–'}
            </span>
            {p.glucose != null && !inactive && <TrendIcon trend={p.trend} size={22} className="text-ink" />}
          </div>
          <p className="text-xs text-muted lg:mt-1">
            <span className="lg:hidden">mg/dL · </span>
            {statusText(p)}
          </p>
        </div>

        {/* forecast */}
        <div>
          <p className="section-title lg:hidden">Forecast +60 min</p>
          {f ? (
            <p className="num text-base">
              <span className="text-muted">→ </span>
              <span className="font-semibold text-accent">{round(f.yhat)}</span>{' '}
              <span className="text-sm text-muted">
                ({round(f.lo)}–{round(f.hi)})
              </span>
            </p>
          ) : (
            <p className="text-sm italic text-muted">{inactive ? 'paused' : 'no forecast'}</p>
          )}
          <p className="hidden text-xs text-muted lg:block">+60 min · 80% interval</p>
        </div>
        </div>

        {/* risk */}
        <div className="order-5 lg:order-none">
          <p className="section-title mb-1 lg:hidden">Risk in next 60 min</p>
          <RiskMini risk={p.risk} abstain={inactive} />
        </div>

        {/* 24 h */}
        <div className="order-6 lg:order-none">
          <p className="section-title mb-1 lg:hidden">Last 24 h</p>
          <AgpBar stats={p.stats_24h} height={10} />
          <p className="mt-1 text-xs text-muted">
            {p.stats_24h.n ? (
              <>
                <span className="num text-ink">{pct(p.stats_24h.tir)}</span> in range
                {p.stats_24h.tbr != null && p.stats_24h.tbr > 0 ? (
                  <>
                    {' '}
                    · <span className="num text-ink">{pct(p.stats_24h.tbr)}</span> low
                  </>
                ) : null}
              </>
            ) : (
              'no 24 h data'
            )}
          </p>
        </div>
      </div>
    </li>
  )
}

/** "How alerts work": inline disclosure so it never overflows on a phone. Numbers come from /api/meta. */
function AlertsExplainer({ meta }: { meta: Meta | null }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const pol = meta?.alert_policy
  const cooldown = pol?.cooldown_min ?? 60
  const per = cooldown === 60 ? 'hour' : `${cooldown} min`
  const budget = pol?.false_alert_budget_per_day ?? 1
  return (
    <div className="mb-4">
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <BellIcon width={14} height={14} />
        How alerts work
        <ChevronIcon width={14} height={14} className={cx('transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div id={id} className="card mt-2 max-w-3xl border-accent/40 bg-accent-soft p-4 text-sm">
          <h2 className="mb-1 text-base">Alerts</h2>
          <p>
            One alert stream per patient: predicted &lt; 70 or &gt; 250 mg/dL within 60 min, at most one alert per {per} (a low
            can override). Rising above 180 is ranked, not alerted. Thresholds were set on development patients for ≤ {budget}{' '}
            false alert per patient-day.
          </p>
          <p className="mt-2 text-xs text-muted">
            The <span className="font-semibold text-ink">Alert</span> badge appears on a row for 60 minutes after an alert fires.
            The <span className="font-semibold text-ink">Watch</span> tier is a ranking of raised risk, including a predicted rise
            above 180, and does not interrupt anyone.
          </p>
        </div>
      )}
    </div>
  )
}

function HeaderRow() {
  return (
    <div
      className={cx(
        'hidden border-b border-line bg-bg/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted',
        COLS,
      )}
      aria-hidden="true"
    >
      <span>Priority</span>
      <span>Patient</span>
      <span>Glucose now</span>
      <span>Forecast</span>
      <span>Risk · next 60 min</span>
      <span>Last 24 h</span>
    </div>
  )
}

function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading worklist">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="card flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:gap-6">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </div>
  )
}

export default function WorklistPage() {
  const { t, link, meta } = useApp()
  const [poll, setPoll] = useState<number | undefined>(undefined)
  const wl = useApi((s) => api.worklist(t as number, s), [t], { enabled: t != null, pollMs: poll })
  const data = wl.data

  // A live stream changes server-side without the clock moving; keep the list fresh while one exists.
  const hasLive = !!data?.patients.some((p) => p.mode === 'live')
  useEffect(() => {
    setPoll(hasLive ? 2500 : undefined)
  }, [hasLive])

  const groups = useMemo(() => {
    const m = new Map<TierName, WorklistPatient[]>()
    for (const p of data?.patients ?? []) {
      const arr = m.get(p.priority.name) ?? []
      arr.push(p)
      m.set(p.priority.name, arr)
    }
    return TIER_ORDER.filter((n) => m.has(n)).map((n) => ({ name: n, items: m.get(n)! }))
  }, [data])

  return (
    <div>
      <PageTitle
        title="Worklist"
        sub={
          data ? (
            <>
              {data.patients.length} patients at <span className="num text-ink">{data.label}</span>, ordered by what needs
              attention first. Move the demo clock to see how the picture changes.
            </>
          ) : (
            'Patients ordered by what needs attention first.'
          )
        }
        right={
          <div className="flex flex-wrap gap-1.5">
            <ProvChip kind="replay" />
            <ProvChip kind="forecast" />
          </div>
        }
      />

      {wl.error && !data && <ErrorState error={wl.error} onRetry={wl.reload} title="Could not load the worklist" />}
      {!data && !wl.error && <Loading />}

      {data && (
        <>
          {wl.error && (
            <div className="mb-3">
              <ErrorState error={wl.error} onRetry={wl.reload} compact title="Showing the last loaded worklist" />
            </div>
          )}
          <div className="mb-3 flex flex-wrap gap-2" aria-label="Patients by priority">
            {groups.map((g) => (
              <a
                key={g.name}
                href={`#tier-${g.name}`}
                className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 text-sm no-underline hover:bg-bg hover:no-underline"
              >
                <PriorityChip name={g.name} />
                <span className="num font-semibold text-ink">{g.items.length}</span>
              </a>
            ))}
          </div>

          <AlertsExplainer meta={meta} />

          <div className="space-y-6">
            {groups.map((g) => {
              const info = tierInfo(g.name)
              return (
                <section key={g.name} id={`tier-${g.name}`} aria-labelledby={`h-${g.name}`} className="scroll-mt-40">
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 id={`h-${g.name}`} className="flex items-center gap-2 text-base">
                      <PriorityChip name={g.name} />
                      <span className="num">{g.items.length}</span>
                      <span className="sr-only">{g.items.length === 1 ? 'patient' : 'patients'}</span>
                    </h2>
                    <p className="text-sm text-muted">{info.blurb}</p>
                  </div>
                  <div className="card overflow-hidden">
                    <HeaderRow />
                    <ul>
                      {g.items.map((p) => (
                        <PatientRow
                          key={p.recording_id}
                          p={p}
                          nowT={data.t}
                          href={link(`/patients/${encodeURIComponent(p.recording_id)}`)}
                        />
                      ))}
                    </ul>
                  </div>
                </section>
              )
            })}
          </div>

          <p className="mt-5 max-w-3xl text-xs text-muted">
            Priority encodes consensus glucose targets (70 and 180 mg/dL, with 54 and 250 as level-2 thresholds) plus the
            model's 60-minute risk estimates. Risk bars use a square-root scale so small probabilities stay visible. On the &lt;70 and
            &gt;250 bars the dark tick is the alert threshold and the bar fills in colour once the estimate crosses it; the &gt;180 bar is a
            ranking signal with no alert, so its tick is only a reference.
          </p>
        </>
      )}
    </div>
  )
}
