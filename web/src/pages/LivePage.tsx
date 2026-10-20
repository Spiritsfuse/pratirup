import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { LiveSession } from '../api/types'
import { TwinView } from '../components/twin/TwinView'
import { EmptyState, ErrorState, LiveBadge, PageTitle, ProvChip, Segmented, Stat, cx } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { sexLabel } from '../lib/format'
import { useApp } from '../state/app'

const SPEEDS = [
  { key: 2, label: '2 s' },
  { key: 1, label: '1 s' },
  { key: 0.5, label: '0.5 s' },
  { key: 0.2, label: '0.2 s' },
]

export default function LivePage() {
  const { meta, link } = useApp()
  const clockT = meta?.clock.default ?? null
  const wl = useApi((s) => api.worklist(clockT as number, s), [clockT], { enabled: clockT != null })
  const sessions = useApi((s) => api.liveList(s), [], { pollMs: 1500 })

  const sources = useMemo(() => (wl.data?.patients ?? []).filter((p) => p.mode === 'replay'), [wl.data])
  const [source, setSource] = useState<string>('')
  const [speed, setSpeed] = useState<number>(1)
  const [activeRid, setActiveRid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<Error | null>(null)

  useEffect(() => {
    if (!source && sources.length) setSource(sources[0].recording_id)
  }, [sources, source])

  // Attach to a stream that is already running (for example after a page reload).
  const list = sessions.data?.sessions ?? []
  useEffect(() => {
    if (activeRid == null) {
      const running = list.find((x) => x.running)
      if (running) {
        setActiveRid(running.recording_id)
        setSource(running.source)
      }
    }
  }, [list, activeRid])

  const active: LiveSession | undefined = list.find((x) => x.recording_id === activeRid)
  const running = !!active?.running

  async function start() {
    if (!source) return
    setBusy(true)
    setActionError(null)
    try {
      const s = await api.liveStart(source, speed)
      setActiveRid(s.recording_id)
      sessions.reload()
    } catch (e) {
      setActionError(e as Error)
    } finally {
      setBusy(false)
    }
  }
  async function stop() {
    if (!activeRid) return
    setBusy(true)
    setActionError(null)
    try {
      await api.liveStop(activeRid)
      sessions.reload()
    } catch (e) {
      setActionError(e as Error)
    } finally {
      setBusy(false)
    }
  }

  const status = !active ? 'No stream' : running ? 'Streaming' : active.ingested_readings > 0 ? 'Stopped or finished' : 'Starting'

  return (
    <div>
      <PageTitle
        title="Live stream"
        right={
          <div className="flex gap-1.5">
            <ProvChip kind="live" />
            <ProvChip kind="replay" text="Held-out recording" />
          </div>
        }
        sub="This streams a held-out recording into the twin one reading at a time, exactly as a CGM device would: each reading updates the twin's state, issues new forecasts, scores older ones when their target time arrives, and can raise alerts. The twin never sees a reading before it is sent, so what you watch below is the same loop a real device would drive."
      />

      <section className="card mb-5 p-4" aria-labelledby="live-ctl">
        <h2 id="live-ctl" className="sr-only">
          Stream controls
        </h2>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="min-w-[240px] flex-1">
            <label htmlFor="live-src" className="section-title mb-1 block">
              Source patient
            </label>
            <select
              id="live-src"
              className="w-full"
              value={source}
              disabled={running || !sources.length}
              onChange={(e) => setSource(e.target.value)}
            >
              {!sources.length && <option value="">{wl.error ? 'Could not load patients' : 'Loading patients…'}</option>}
              {sources.map((p) => (
                <option key={p.recording_id} value={p.recording_id}>
                  {p.summary.display_id} · {p.summary.age ?? '?'} y {sexLabel(p.summary.sex)} · {p.summary.regimen_text}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="section-title mb-1" id="live-speed-l">
              Seconds per reading
            </p>
            <Segmented label="Seconds per reading" value={speed} onChange={setSpeed} options={SPEEDS} />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={start} disabled={busy || running || !source}>
              {active && !running ? 'Restart stream' : 'Start stream'}
            </button>
            <button type="button" className="btn" onClick={stop} disabled={busy || !running}>
              Stop
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          Each reading stands for 15 minutes of wear, so 0.2 s per reading replays about three days of wear per minute.
          Starting again for the same patient replaces the previous stream.
        </p>
        {actionError && (
          <div className="mt-3">
            <ErrorState error={actionError} compact title="The stream action failed" />
          </div>
        )}
      </section>

      {sessions.error && !sessions.data && <ErrorState error={sessions.error} onRetry={sessions.reload} title="Could not reach the live service" />}

      {active ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="card p-3.5">
              <p className="section-title">Status</p>
              <p className="mt-1.5 flex items-center gap-2 text-lg font-medium">
                {running ? <LiveBadge /> : <span className="chip">{status}</span>}
                {running && <span className="text-base">Streaming</span>}
              </p>
              <p className="mt-1 truncate text-xs text-muted" title={active.source}>
                Source <span className="num">{active.source}</span>
              </p>
            </div>
            <Stat label="Readings ingested" value={active.ingested_readings.toLocaleString()} sub="CGM readings sent to the twin" />
            <Stat label="Alerts raised" value={active.alerts.toLocaleString()} sub="Threshold crossings flagged by the twin" />
            <div className="card p-3.5">
              <p className="section-title">Patient page</p>
              <p className="mt-1.5 text-sm">
                <Link to={link(`/patients/${encodeURIComponent(active.recording_id)}`)}>Open full patient view</Link>
              </p>
              <p className="mt-1 text-xs text-muted">Ledger and record for this stream.</p>
            </div>
          </div>

          <TwinView key={active.recording_id} rid={active.recording_id} t={null} live pollMs={running ? 1500 : 5000} />
        </>
      ) : (
        <EmptyState title="No stream is running">
          Choose a source patient and press <strong className="font-semibold text-ink">Start stream</strong>. The twin will begin
          empty, then fill in as readings arrive: first the observed trace, then forecasts once it has enough history, then
          the ledger of scored forecasts.
        </EmptyState>
      )}

      {list.length > 0 && (
        <section className="mt-6" aria-labelledby="prev-h">
          <h2 id="prev-h" className="section-title mb-2">
            Sessions on this server
          </h2>
          <div className="card scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Stream</th>
                  <th scope="col">State</th>
                  <th scope="col" className="r">
                    Readings
                  </th>
                  <th scope="col" className="r">
                    Alerts
                  </th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.recording_id} className={cx(x.recording_id === activeRid && 'bg-accent-soft/60')}>
                    <td className="num">{x.recording_id}</td>
                    <td>{x.running ? <LiveBadge /> : <span className="text-muted">finished or stopped</span>}</td>
                    <td className="num r">{x.ingested_readings.toLocaleString()}</td>
                    <td className="num r">{x.alerts.toLocaleString()}</td>
                    <td className="r">
                      {x.recording_id !== activeRid && (
                        <button type="button" className="btn !min-h-[28px]" onClick={() => setActiveRid(x.recording_id)}>
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
