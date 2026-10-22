import { useState } from 'react'
import type { Driver, RiskKind, Twin } from '../../api/types'
import { RISK_FILL, RISK_NOW, riskGate, riskPos } from '../clinical'
import { BellIcon, TrendIcon } from '../icons'
import { useApp } from '../../state/app'
import { ProvChip, Segmented, cx } from '../ui'
import { RISK_ORDER, SOURCE_LABEL, TREND_TEXT, pct, prob, round, signed, sourceKey } from '../../lib/format'

const RISK_TITLE: Record<RiskKind, string> = {
  hypo: 'Below 70 mg/dL',
  hyper: 'Above 180 mg/dL',
  hyper2: 'Above 250 mg/dL',
}

// ---------------------------------------------------------------- risk

export function RiskCard({ twin }: { twin: Twin }) {
  const { meta } = useApp()
  const fc = twin.forecast
  return (
    <section className="card p-4" aria-labelledby="risk-h">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 id="risk-h" className="text-base">
            Risk in the next 60 min
          </h3>
          <p className="text-xs text-muted">Probability glucose crosses the level</p>
        </div>
        <ProvChip kind="forecast" />
      </div>
      {!fc ? (
        <p className="text-sm italic text-muted">No forecast, so no risk estimate.</p>
      ) : (
        <ul className="space-y-4">
          {RISK_ORDER.map((k) => {
            const r = fc.risk[k]
            const g = riskGate(k, r, meta)
            const now = !r.at_risk && r.p == null
            const fired = fc.alert?.kind === k
            return (
              <li key={k}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{RISK_TITLE[k]}</span>
                  {now ? (
                    <span className="text-sm italic text-muted">now</span>
                  ) : (
                    <span className={cx('num text-xl font-medium', g.above ? 'text-ink' : 'text-muted')}>{prob(r.p)}</span>
                  )}
                </div>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  {g.alerting ? (
                    <>
                      <BellIcon width={12} height={12} className={k === 'hypo' ? 'text-low' : 'text-vhigh'} />
                      interruptive alert
                    </>
                  ) : (
                    'ranking signal · no alert'
                  )}
                </p>
                {now ? (
                  <p className="mt-1 text-xs text-muted">{RISK_NOW[k]}, so a forecast of crossing it does not apply.</p>
                ) : (
                  <>
                    <div
                      className="relative mt-1.5 h-2 rounded-full bg-line/80"
                      role="img"
                      aria-label={`${prob(r.p)} probability; ${g.alerting ? 'alert threshold' : 'reference level, no alert'} ${prob(g.threshold)}; ${g.above ? 'above' : 'below'}`}
                    >
                      <span
                        className={cx('absolute inset-y-0 left-0 rounded-full', g.above ? RISK_FILL[k] : 'bg-muted/45')}
                        style={{ width: `${riskPos(r.p ?? 0)}%` }}
                      />
                      <span
                        className={cx('absolute -top-[4px] h-[16px] w-[2px] rounded-full', g.alerting ? 'bg-ink' : 'bg-muted/70')}
                        style={{ left: `${riskPos(g.threshold)}%` }}
                        title={g.alerting ? `Alert threshold ${prob(g.threshold)}` : `Reference level ${prob(g.threshold)}. This level does not raise an alert.`}
                      />
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                      {g.alerting ? (
                        g.above ? (
                          <>
                            <span className={cx('h-2 w-2 rounded-[2px]', RISK_FILL[k])} aria-hidden="true" />
                            <span className="font-semibold text-ink">Above alert threshold</span>
                            {fired && <span className="font-semibold text-ink">· alert fired at this reading</span>}
                          </>
                        ) : (
                          <span className="text-muted">Below alert threshold</span>
                        )
                      ) : g.above ? (
                        <>
                          <span className={cx('h-2 w-2 rounded-[2px]', RISK_FILL[k])} aria-hidden="true" />
                          <span className="font-semibold text-ink">Raised risk</span>
                          <span className="text-muted">· ranks the patient higher on the worklist</span>
                        </>
                      ) : (
                        <span className="text-muted">Below reference level</span>
                      )}
                      <span className="text-muted">
                        (<span className="num">{prob(g.threshold)}</span>)
                      </span>
                    </p>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-4 border-t border-line pt-2.5 text-xs text-muted">
        Bar length is square-root scaled so small probabilities stay visible. On the &lt;70 and &gt;250 rows the dark tick is the
        alert threshold, chosen on development data
        {meta?.alert_policy ? ` for at most ${meta.alert_policy.false_alert_budget_per_day} false alert per patient-day` : ''}. The
        &gt;180 row is a ranking signal only: its tick is a reference level and it never raises an alert.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------- state

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-b-0">
      <dt className="text-sm text-muted" title={hint}>
        {label}
      </dt>
      <dd className="num text-right text-sm">{children}</dd>
    </div>
  )
}

export function StateCard({ twin }: { twin: Twin }) {
  const s = twin.state
  return (
    <section className="card p-4" aria-labelledby="state-h">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 id="state-h" className="text-base">
            Twin state
          </h3>
          <p className="text-xs text-muted">What the twin currently believes</p>
        </div>
        <ProvChip kind="forecast" text="Model state" />
      </div>
      {!s ? (
        <p className="py-2 text-sm italic text-muted">The twin has no state yet: it needs CGM readings first.</p>
      ) : (
        <>
          <dl>
            <Row label="Filtered level" hint="Kalman-filtered glucose, smoothing sensor noise">
              <span className="font-semibold">{round(s.kalman.level)}</span>{' '}
              <span className="text-muted">± {round(s.kalman.level_sd, 1)} mg/dL</span>
            </Row>
            <Row label="Rate of change" hint="Kalman-estimated slope">
              <span className="inline-flex items-center gap-1.5">
                <TrendIcon trend={s.trend} size={18} />
                <span className="font-semibold">{signed(s.kalman.rate_mgdl_per_min, 1)}</span>
                <span className="text-muted">mg/dL/min</span>
              </span>
              <span className="block font-sans text-xs text-muted">{TREND_TEXT[s.trend]}</span>
            </Row>
            <Row label="Readings, last 3 h" hint="Forecasts pause when fewer than 8 of 12 are present">
              <span className={cx('font-semibold', !s.data_quality.issuable && 'text-low')}>
                {s.data_quality.readings_last_3h}/{s.data_quality.expected_last_3h}
              </span>
            </Row>
            {s.data_quality.signal_roughness_mgdl != null && (
              <Row label="Signal noise (roughness, 3 h)" hint="Roughness of the sensor trace over the last 3 hours: a proxy for sensor noise">
                <span className="font-semibold">{round(s.data_quality.signal_roughness_mgdl, 1)}</span>{' '}
                <span className="text-muted">mg/dL</span>
                <span className="block font-sans text-xs text-muted">the model is trained to stay accurate when this is high</span>
              </Row>
            )}
          </dl>

          <h4 className="section-title mb-1 mt-4">Personal correction</h4>
          <p className="mb-1 text-xs text-muted">
            Adjustment learned from this patient&apos;s recent forecast errors, added to the population model.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(s.personal_correction).map(([h, v]) => (
              <div key={h} className="rounded border border-line px-2 py-1.5 text-center">
                <p className="text-xs text-muted">+{h} min</p>
                <p className="num text-sm font-semibold">{signed(v, 1)}</p>
                <p className="text-[11px] text-muted">mg/dL</p>
              </div>
            ))}
          </div>

          <h4 className="section-title mb-1 mt-4">Profile, wear so far</h4>
          <dl>
            <Row label="Mean glucose">
              {round(s.profile.mean)} <span className="text-muted">mg/dL</span>
            </Row>
            <Row label="Variability (SD)">
              {round(s.profile.sd)} <span className="text-muted">mg/dL</span>
            </Row>
            <Row label="Time above 180">{pct(s.profile.tar)}</Row>
            <Row label="Time below 70">{pct(s.profile.tbr)}</Row>
          </dl>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- drivers

export const SOURCE_COLOR: Record<string, string> = {
  cgm: '#2a8fa8',
  logs: '#c98a00',
  'clinical record': '#7a8a92',
  'personal history': '#6e6bd0',
  time: '#b5598a',
}

export function SourceChip({ source }: { source: string }) {
  const k = sourceKey(source)
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-line px-1.5 py-px text-[11px] text-muted">
      <span className="h-2 w-2 rounded-full" style={{ background: SOURCE_COLOR[k] }} aria-hidden="true" />
      {SOURCE_LABEL[k]}
    </span>
  )
}

function DriverList({ items, unit }: { items: Driver[]; unit: string }) {
  const max = Math.max(...items.map((d) => Math.abs(d.contribution)), 1e-9)
  return (
    <ul className="space-y-2.5">
      {items.map((d) => {
        const w = (Math.abs(d.contribution) / max) * 50
        const pos = d.contribution >= 0
        return (
          <li key={d.feature}>
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm leading-snug">{d.label}</p>
              <p className="num shrink-0 text-xs text-muted">{d.value}</p>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div
                className="relative h-2.5 flex-1 rounded-sm bg-line/50"
                role="img"
                aria-label={`${pos ? 'Raises' : 'Lowers'} the estimate by ${Math.abs(d.contribution).toFixed(2)} ${unit}`}
              >
                <span className="absolute inset-y-0 left-1/2 w-px bg-muted/60" />
                <span
                  className={cx('absolute inset-y-0 rounded-sm', pos ? 'bg-accent' : 'bg-pastfc')}
                  style={pos ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
                />
              </div>
              <span className={cx('num w-16 shrink-0 text-right text-xs font-semibold', pos ? 'text-accent' : 'text-ink')}>
                {pos ? '+' : '−'}
                {Math.abs(d.contribution).toFixed(unit === 'mg/dL' ? 1 : 2)}
              </span>
            </div>
            <div className="mt-1">
              <SourceChip source={d.source} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function DriversCard({ twin }: { twin: Twin }) {
  const [mode, setMode] = useState<'forecast' | 'risk'>('forecast')
  const d = twin.forecast?.drivers
  const fcItems = d?.forecast_60
  const ev = d?.event
  return (
    <section className="card p-4" aria-labelledby="why-h">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 id="why-h" className="text-base">
          Why this forecast
        </h3>
        <ProvChip kind="forecast" />
      </div>
      {!twin.forecast || (!fcItems && !ev) ? (
        <p className="py-2 text-sm italic text-muted">Drivers appear once the twin can issue a forecast.</p>
      ) : (
        <>
          <div className="mb-3">
            <Segmented
              label="Driver view"
              value={mode}
              onChange={setMode}
              options={[
                { key: 'forecast', label: '60-min forecast (mg/dL)' },
                { key: 'risk', label: 'Risk drivers' },
              ]}
            />
          </div>
          {mode === 'forecast' && fcItems && (
            <>
              <p className="mb-2 text-xs text-muted">
                How far each input moves the 60-minute forecast from the model&apos;s baseline, in mg/dL.
              </p>
              <DriverList items={fcItems} unit="mg/dL" />
            </>
          )}
          {mode === 'risk' && ev && (
            <>
              <p className="mb-2 text-xs text-muted">
                Inputs behind the highest-ranked risk:{' '}
                <strong className="font-semibold text-ink">{RISK_TITLE[ev.kind].toLowerCase()}</strong> within 60 min. Contributions
                are in log-odds (positive raises the probability).
              </p>
              <DriverList items={ev.items} unit="log-odds" />
            </>
          )}
          <p className="mt-4 border-t border-line pt-2.5 text-xs font-medium text-ink">
            Associations the model uses, not causes.
          </p>
        </>
      )}
    </section>
  )
}
