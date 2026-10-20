import { memo, useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type { EventKind, RiskKind, Twin, TwinEvent } from '../../api/types'
import { ChartBox, useChartColors, type ChartColors } from '../ChartBox'
import { clockLabel, eventSentence, hhmm, round } from '../../lib/format'

// ---------------------------------------------------------------- data model

interface Row {
  t: number
  obs?: number | null
  fs?: number
  pf?: number
  pfBand?: [number, number]
  fcA?: number
  fcBandA?: [number, number]
  fcB?: number
  fcBandB?: [number, number]
  /** horizon (min) when this row is a forecast point */
  h?: number
  lo?: number
  hi?: number
  pop?: number
  actual?: number | null
}

const THRESHOLDS = [54, 70, 180, 250]

function buildRows(twin: Twin, showPast: boolean): { rows: Row[]; lo: number; hi: number } {
  const nowT = twin.clock.t
  const map = new Map<number, Row>()
  const get = (t: number) => {
    let r = map.get(t)
    if (!r) {
      r = { t }
      map.set(t, r)
    }
    return r
  }
  let lo = Infinity
  let hi = -Infinity
  const see = (v: number) => {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }

  let prev: number | null = null
  for (const o of twin.observations) {
    if (prev != null && o.t - prev > 20) get(prev + 1).obs = null // break the line across missing readings
    get(o.t).obs = o.glucose
    see(o.glucose)
    prev = o.t
  }
  for (const f of twin.fingersticks) {
    get(f.t).fs = f.glucose
    see(f.glucose)
  }
  if (showPast) {
    for (const p of twin.past_forecasts) {
      if (p.target_t > nowT) continue
      const r = get(p.target_t)
      r.pf = p.yhat
      r.pfBand = [p.lo, p.hi]
      r.lo = p.lo
      r.hi = p.hi
      r.pop = p.yhat_population
      r.actual = p.actual
      see(p.lo)
      see(p.hi)
    }
  }
  const fc = twin.forecast
  const st = twin.state
  if (fc && st && st.glucose != null) {
    const g = st.glucose
    const anchor = get(fc.issued_t)
    anchor.fcA = g
    anchor.fcBandA = [g, g]
    const hs = [...fc.horizons].sort((a, b) => a.horizon - b.horizon)
    for (const h of hs) {
      const r = get(h.target_t)
      r.h = h.horizon
      r.lo = h.lo
      r.hi = h.hi
      r.pop = h.yhat_population
      see(h.lo)
      see(h.hi)
      if (h.horizon <= 60) {
        r.fcA = h.yhat
        r.fcBandA = [h.lo, h.hi]
      }
      if (h.horizon === 60) {
        r.fcB = h.yhat
        r.fcBandB = [h.lo, h.hi]
      }
      if (h.horizon > 60) {
        r.fcB = h.yhat
        r.fcBandB = [h.lo, h.hi]
      }
    }
  }
  return { rows: [...map.values()].sort((a, b) => a.t - b.t), lo, hi }
}

// ---------------------------------------------------------------- ticks

function timeTicks(min: number, max: number, plotPx: number): number[] {
  const span = max - min
  const pxPerMin = plotPx / span
  const steps = [30, 60, 120, 180, 240, 360, 720, 1440]
  const step = steps.find((s) => s * pxPerMin >= 54) ?? 1440
  const out: number[] = []
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) out.push(t)
  return out
}

function midnights(min: number, max: number): number[] {
  const out: number[] = []
  for (let t = Math.ceil(min / 1440) * 1440; t <= max; t += 1440) out.push(t)
  return out
}

// ---------------------------------------------------------------- tooltips

function MainTip({ active, payload, c }: { active?: boolean; payload?: { payload: Row }[]; c: ChartColors }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  const lines: { k: string; v: string; col?: string }[] = []
  if (r.obs != null) lines.push({ k: 'CGM', v: `${round(r.obs)} mg/dL`, col: c.ink })
  if (r.fs != null) lines.push({ k: 'Fingerstick', v: `${round(r.fs)} mg/dL`, col: c.ink })
  if (r.pf != null) {
    lines.push({
      k: 'Twin predicted 60 min earlier',
      v: `${round(r.pf)} (${round(r.lo)}–${round(r.hi)})`,
      col: c.pastfc,
    })
    if (r.obs != null) {
      const e = r.pf - r.obs
      lines.push({ k: 'Forecast error', v: `${e > 0 ? '+' : ''}${round(e)} mg/dL` })
    }
  }
  if (r.h != null && (r.fcA != null || r.fcB != null)) {
    lines.push({
      k: `Forecast +${r.h} min${r.h > 60 ? ' (exploratory)' : ''}`,
      v: `${round(r.h > 60 ? r.fcB : r.fcA)} (${round(r.lo)}–${round(r.hi)})`,
      col: c.accent,
    })
  }
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="num mb-1 font-semibold text-ink">{clockLabel(r.t)}</p>
      {lines.map((l) => (
        <p key={l.k} className="flex justify-between gap-4">
          <span className="text-muted">{l.k}</span>
          <span className="num" style={{ color: l.col }}>
            {l.v}
          </span>
        </p>
      ))}
    </div>
  )
}

interface StripPoint {
  t: number
  lane: number
  kind: EventKind | 'alert'
  text: string
  color?: string
  off?: number
}

function StripTip({ active, payload }: { active?: boolean; payload?: { payload: StripPoint }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="max-w-[260px] rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="num font-semibold text-ink">{clockLabel(p.t)}</p>
      <p className="mt-0.5 text-ink">{p.text}</p>
    </div>
  )
}

// ---------------------------------------------------------------- strip shapes

interface ShapeProps {
  cx?: number
  cy?: number
  payload?: StripPoint
}
function EventShape({ cx = 0, cy = 0, payload, c }: ShapeProps & { c: ChartColors }) {
  if (!payload) return <g />
  const x = cx + (payload.off ?? 0)
  const hit = <circle cx={x} cy={cy} r={9} fill="transparent" />
  switch (payload.kind) {
    case 'meal':
      return (
        <g>
          {hit}
          <rect x={x - 4.5} y={cy - 4.5} width={9} height={9} fill={c.ink} rx={1} />
        </g>
      )
    case 'insulin':
    case 'insulin_iv':
      return (
        <g>
          {hit}
          <path d={`M${x} ${cy - 5.5} L${x + 5.5} ${cy + 4.5} L${x - 5.5} ${cy + 4.5} Z`} fill={c.accent} />
        </g>
      )
    case 'csii_bolus':
      return (
        <g>
          {hit}
          <path
            d={`M${x} ${cy - 5.5} L${x + 5.5} ${cy + 4.5} L${x - 5.5} ${cy + 4.5} Z`}
            fill={c.surface}
            stroke={c.accent}
            strokeWidth={1.8}
          />
        </g>
      )
    case 'oral':
      return (
        <g>
          {hit}
          <circle cx={x} cy={cy} r={4.5} fill={c.surface} stroke={c.ink} strokeWidth={1.8} />
        </g>
      )
    case 'csii_basal_rate':
      return (
        <g>
          {hit}
          <rect x={x - 1.2} y={cy - 7} width={2.4} height={14} fill={c.accent} rx={1} />
        </g>
      )
    case 'alert':
      return (
        <g>
          {hit}
          <path
            d={`M${x} ${cy - 6.5} L${x + 6.5} ${cy} L${x} ${cy + 6.5} L${x - 6.5} ${cy} Z`}
            fill={payload.color}
            stroke={c.surface}
            strokeWidth={1}
          />
        </g>
      )
  }
}

const ALERT_TEXT: Record<RiskKind, string> = {
  hypo: 'Alert: glucose likely to fall below 70 mg/dL within 60 min',
  hyper: 'Alert: glucose likely to exceed 180 mg/dL within 60 min',
  hyper2: 'Alert: glucose likely to exceed 250 mg/dL within 60 min',
}

const LANE_NAME: Record<number, string> = { 3: 'Alerts', 2: 'Meals', 1: 'Insulin', 0: 'Oral/pump' }

function eventLane(k: EventKind): number {
  if (k === 'meal') return 2
  if (k === 'insulin' || k === 'csii_bolus' || k === 'insulin_iv') return 1
  return 0
}

function buildStrip(twin: Twin, c: ChartColors): StripPoint[] {
  const out: StripPoint[] = []
  const alertColor: Record<RiskKind, string> = { hypo: c.low, hyper: c.high, hyper2: c.vhigh }
  for (const e of twin.events as TwinEvent[]) {
    out.push({ t: e.t, lane: eventLane(e.kind), kind: e.kind, text: eventSentence(e) })
  }
  for (const a of twin.recent_alerts) {
    a.kinds.forEach((k, i) =>
      out.push({ t: a.t, lane: 3, kind: 'alert', text: ALERT_TEXT[k], color: alertColor[k], off: i * 9 }),
    )
  }
  return out
}

// ---------------------------------------------------------------- chart

export interface TwinChartProps {
  twin: Twin
  windowH: number
  showPast: boolean
}

function TwinChartImpl({ twin, windowH, showPast }: TwinChartProps) {
  const c = useChartColors()
  const nowT = twin.clock.t
  const fc = twin.forecast
  const xMin = nowT - windowH * 60
  const lastT = fc ? Math.max(nowT, ...fc.horizons.map((h) => h.target_t)) : nowT
  const xMax = lastT + Math.max(6, Math.round(windowH * 0.6))
  const { rows, lo, hi } = useMemo(() => buildRows(twin, showPast), [twin, showPast])
  const strip = useMemo(() => buildStrip(twin, c), [twin, c])

  const yMin = Math.max(20, Math.floor(Math.min(lo === Infinity ? 70 : lo, 50) / 10) * 10 - 10)
  const yMax = Math.ceil(Math.max(hi === -Infinity ? 200 : hi, 260) / 10) * 10 + 10
  const yTicks = [54, 70, 120, 180, 250, 300, 350, 400, 450].filter((v) => v >= yMin && v <= yMax)

  const compact = typeof window !== 'undefined' && window.innerWidth < 520
  const yWidth = compact ? 54 : 62
  const mainH = compact ? 280 : 340
  const stripH = compact ? 96 : 108
  const margin = { top: 20, right: compact ? 10 : 18, bottom: 4, left: 0 }

  const summary = twin.state
    ? `Glucose chart for the last ${windowH} hours. Latest reading ${round(twin.state.glucose)} mg/dL.` +
      (fc ? ` Forecast at plus 60 minutes: ${round(fc.horizons.find((h) => h.horizon === 60)?.yhat)} mg/dL.` : '')
    : `Glucose chart for the last ${windowH} hours.`

  return (
    <div>
      <ChartBox height={mainH} label={summary}>
        {(w) => {
          const ticks = timeTicks(xMin, xMax, w - yWidth - margin.right)
          return (
            <ComposedChart width={w} height={mainH} data={rows} margin={margin}>
              <CartesianGrid stroke={c.line} strokeOpacity={0.55} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={[xMin, xMax]}
                ticks={ticks}
                tickFormatter={(v: number) => (v % 1440 === 0 ? `Day ${v / 1440 + 1}` : hhmm(v))}
                tick={{ fill: c.muted, fontSize: 11 }}
                stroke={c.line}
                allowDataOverflow
                tickMargin={6}
              />
              <YAxis
                type="number"
                domain={[yMin, yMax]}
                ticks={yTicks}
                interval={0}
                width={yWidth}
                tick={{ fill: c.muted, fontSize: 11 }}
                stroke={c.line}
                allowDataOverflow
                label={{
                  value: 'Glucose (mg/dL)',
                  angle: -90,
                  position: 'insideLeft',
                  offset: compact ? 2 : 14,
                  style: { fill: c.muted, fontSize: 11, textAnchor: 'middle' },
                }}
              />
              <ReferenceArea y1={70} y2={180} fill={c.inrange} fillOpacity={0.09} ifOverflow="hidden" />
              {THRESHOLDS.map((v) => (
                <ReferenceLine
                  key={v}
                  y={v}
                  stroke={v === 70 || v === 180 ? c.inrange : c.muted}
                  strokeOpacity={v === 70 || v === 180 ? 0.7 : 0.55}
                  strokeDasharray="4 4"
                  ifOverflow="hidden"
                />
              ))}
              {midnights(xMin, xMax).map((m) => (
                <ReferenceLine
                  key={m}
                  x={m}
                  stroke={c.muted}
                  strokeOpacity={0.6}
                  strokeDasharray="1 4"
                  label={{ value: `Day ${m / 1440 + 1}`, position: 'insideTopLeft', fill: c.muted, fontSize: 10, offset: 4 }}
                />
              ))}

              {showPast && (
                <Area
                  dataKey="pfBand"
                  type="monotone"
                  stroke="none"
                  fill={c.pastfc}
                  fillOpacity={0.2}
                  connectNulls
                  isAnimationActive={false}
                  activeDot={false}
                  legendType="none"
                />
              )}
              <Area
                dataKey="fcBandB"
                type="linear"
                stroke="none"
                fill={c.accent}
                fillOpacity={0.09}
                connectNulls
                isAnimationActive={false}
                activeDot={false}
              />
              <Area
                dataKey="fcBandA"
                type="linear"
                stroke="none"
                fill={c.accent}
                fillOpacity={0.2}
                connectNulls
                isAnimationActive={false}
                activeDot={false}
              />

              {showPast && (
                <Line
                  dataKey="pf"
                  type="monotone"
                  stroke={c.pastfc}
                  strokeWidth={1.8}
                  strokeDasharray="6 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                  activeDot={{ r: 3.5, fill: c.pastfc, stroke: c.surface }}
                />
              )}
              <Line
                dataKey="fcB"
                type="linear"
                stroke={c.accent}
                strokeOpacity={0.55}
                strokeWidth={2}
                strokeDasharray="3 4"
                connectNulls
                isAnimationActive={false}
                dot={(p: { cx?: number; cy?: number; payload?: Row; index?: number }) =>
                  p.payload?.h != null && p.payload.h > 60 && p.cx != null && p.cy != null ? (
                    <circle key={`b${p.index}`} cx={p.cx} cy={p.cy} r={4} fill={c.surface} stroke={c.accent} strokeOpacity={0.7} strokeWidth={1.8} />
                  ) : (
                    <g key={`b${p.index}`} />
                  )
                }
                activeDot={false}
              />
              <Line
                dataKey="fcA"
                type="linear"
                stroke={c.accent}
                strokeWidth={2.6}
                connectNulls
                isAnimationActive={false}
                dot={(p: { cx?: number; cy?: number; payload?: Row; index?: number }) =>
                  p.payload?.h != null && p.payload.h <= 60 && p.cx != null && p.cy != null ? (
                    <circle key={`a${p.index}`} cx={p.cx} cy={p.cy} r={p.payload.h === 60 ? 5 : 4} fill={c.accent} stroke={c.surface} strokeWidth={1.5} />
                  ) : (
                    <g key={`a${p.index}`} />
                  )
                }
                activeDot={false}
              />
              <Line
                dataKey="obs"
                type="linear"
                stroke={c.ink}
                strokeWidth={1.9}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={{ r: 4, fill: c.ink, stroke: c.surface, strokeWidth: 1.5 }}
              />
              <Line
                dataKey="fs"
                stroke="none"
                isAnimationActive={false}
                activeDot={false}
                dot={(p: { cx?: number; cy?: number; index?: number; payload?: Row }) =>
                  p.payload?.fs != null && p.cx != null && p.cy != null ? (
                    <circle key={`f${p.index}`} cx={p.cx} cy={p.cy} r={5} fill={c.surface} stroke={c.ink} strokeWidth={2} />
                  ) : (
                    <g key={`f${p.index}`} />
                  )
                }
              />
              <ReferenceLine
                x={nowT}
                stroke={c.ink}
                strokeWidth={1.4}
                label={{ value: 'Now', position: 'top', fill: c.ink, fontSize: 11, fontWeight: 600 }}
              />
              <Tooltip
                content={<MainTip c={c} />}
                isAnimationActive={false}
                cursor={{ stroke: c.muted, strokeDasharray: '2 3' }}
              />
            </ComposedChart>
          )
        }}
      </ChartBox>

      <ChartBox height={stripH} label="Logged events and alerts along the same time axis">
        {(w) => (
          <ScatterChart width={w} height={stripH} margin={{ top: 4, right: margin.right, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={c.line} strokeOpacity={0.5} horizontal={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={[xMin, xMax]}
              ticks={timeTicks(xMin, xMax, w - yWidth - margin.right)}
              tick={false}
              tickLine={false}
              stroke={c.line}
              allowDataOverflow
              height={6}
            />
            <YAxis
              dataKey="lane"
              type="number"
              domain={[-0.7, 3.7]}
              ticks={[0, 1, 2, 3]}
              interval={0}
              width={yWidth}
              tickFormatter={(v: number) => LANE_NAME[v] ?? ''}
              tick={{ fill: c.muted, fontSize: 10, style: { fontFamily: 'IBM Plex Sans, system-ui, sans-serif' } }}
              tickLine={false}
              stroke={c.line}
            />
            <ZAxis range={[80, 80]} />
            <ReferenceLine x={nowT} stroke={c.ink} strokeWidth={1.4} />
            <Tooltip content={<StripTip />} cursor={false} isAnimationActive={false} wrapperStyle={{ zIndex: 20 }} />
            <Scatter
              data={strip}
              isAnimationActive={false}
              shape={(p: ShapeProps) => <EventShape {...p} c={c} />}
            />
          </ScatterChart>
        )}
      </ChartBox>
    </div>
  )
}

export const TwinChart = memo(TwinChartImpl)

// ---------------------------------------------------------------- legend

export function ChartLegend({ showPast }: { showPast: boolean }) {
  const item = 'flex items-center gap-1.5 whitespace-nowrap'
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Chart legend">
      <li className={item}>
        <svg width="26" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="25" y2="5" stroke="rgb(var(--ink))" strokeWidth="2" />
        </svg>
        Observed CGM
      </li>
      <li className={item}>
        <svg width="14" height="12" aria-hidden="true">
          <circle cx="7" cy="6" r="4.2" fill="rgb(var(--surface))" stroke="rgb(var(--ink))" strokeWidth="1.8" />
        </svg>
        Fingerstick
      </li>
      {showPast && (
        <li className={item}>
          <svg width="26" height="12" aria-hidden="true">
            <rect x="1" y="1" width="24" height="10" fill="rgb(var(--pastfc))" fillOpacity="0.22" />
            <line x1="1" y1="6" x2="25" y2="6" stroke="rgb(var(--pastfc))" strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          Twin&apos;s forecast made 60 min earlier (80% band)
        </li>
      )}
      <li className={item}>
        <svg width="26" height="12" aria-hidden="true">
          <rect x="1" y="1" width="24" height="10" fill="rgb(var(--accent))" fillOpacity="0.2" />
          <line x1="1" y1="6" x2="25" y2="6" stroke="rgb(var(--accent))" strokeWidth="2.4" />
        </svg>
        Forecast from now (80% interval)
      </li>
      <li className={item}>
        <svg width="26" height="12" aria-hidden="true">
          <rect x="1" y="1" width="24" height="10" fill="rgb(var(--accent))" fillOpacity="0.09" />
          <line x1="1" y1="6" x2="25" y2="6" stroke="rgb(var(--accent))" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="3 3" />
        </svg>
        +120 min (exploratory)
      </li>
      <li className={item}>
        <svg width="12" height="12" aria-hidden="true">
          <rect x="1" y="1" width="10" height="10" fill="rgb(var(--inrange))" fillOpacity="0.2" />
        </svg>
        Target range 70–180
      </li>
    </ul>
  )
}

export function EventKey() {
  const item = 'flex items-center gap-1.5 whitespace-nowrap'
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Event key">
      <li className={item}>
        <svg width="12" height="12" aria-hidden="true">
          <rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="rgb(var(--ink))" />
        </svg>
        Meal
      </li>
      <li className={item}>
        <svg width="12" height="12" aria-hidden="true">
          <path d="M6 1 L11 10 L1 10 Z" fill="rgb(var(--accent))" />
        </svg>
        Insulin
      </li>
      <li className={item}>
        <svg width="12" height="12" aria-hidden="true">
          <circle cx="6" cy="6" r="4" fill="rgb(var(--surface))" stroke="rgb(var(--ink))" strokeWidth="1.8" />
        </svg>
        Oral agent
      </li>
      <li className={item}>
        <svg width="12" height="12" aria-hidden="true">
          <rect x="4.8" y="0" width="2.4" height="12" rx="1" fill="rgb(var(--accent))" />
        </svg>
        Pump basal change
      </li>
      <li className={item}>
        <svg width="14" height="12" aria-hidden="true">
          <path d="M7 0 L13 6 L7 12 L1 6 Z" fill="rgb(var(--high))" />
        </svg>
        Alert (colour by threshold)
      </li>
    </ul>
  )
}
