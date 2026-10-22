import { Suspense } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApp, isClockRoute } from '../state/app'
import { useTheme } from '../state/theme'
import { clockLabel } from '../lib/format'
import {
  AutoThemeIcon,
  JumpIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  StepBackIcon,
  StepForwardIcon,
  SunIcon,
} from './icons'
import { Segmented, Skeleton, cx } from './ui'

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2 text-ink no-underline hover:no-underline" aria-label="Pratirup home">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="6" fill="rgb(var(--accent))" />
        <path
          d="M4 21 L10 15 L15 19 L21 9"
          fill="none"
          stroke="rgb(var(--surface))"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M21 9 L28 14"
          fill="none"
          stroke="rgb(var(--surface))"
          strokeWidth="2.4"
          strokeDasharray="1 4"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-lg font-semibold tracking-tight">Pratirup</span>
      <span className="chip hidden !text-[11px] xs:inline-flex">research prototype</span>
    </Link>
  )
}

function ThemeToggle() {
  const { setting, cycle } = useTheme()
  const Icon = setting === 'auto' ? AutoThemeIcon : setting === 'light' ? SunIcon : MoonIcon
  const text = setting === 'auto' ? 'Auto' : setting === 'light' ? 'Light' : 'Dark'
  return (
    <button
      type="button"
      className="btn !px-2.5"
      onClick={cycle}
      aria-label={`Colour theme: ${text}. Activate to change.`}
      title={`Theme: ${text}`}
    >
      <Icon />
      <span className="hidden sm:inline">{text}</span>
    </button>
  )
}

function Nav() {
  const { link } = useApp()
  const { pathname } = useLocation()
  const items = [
    { to: link('/'), label: 'Worklist', active: pathname === '/' || pathname.startsWith('/patients/') },
    { to: '/live', label: 'Live stream', active: pathname.startsWith('/live') },
    { to: '/evidence', label: 'Evidence', active: pathname.startsWith('/evidence') },
    { to: '/about', label: 'About', active: pathname.startsWith('/about') },
  ]
  return (
    <nav aria-label="Primary" className="scroll-x -mb-px flex gap-1">
      {items.map((i) => (
        <NavLink
          key={i.label}
          to={i.to}
          aria-current={i.active ? 'page' : undefined}
          className={cx(
            'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium no-underline hover:no-underline',
            i.active ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {i.label}
        </NavLink>
      ))}
    </nav>
  )
}

function ClockBar() {
  const c = useApp()
  const t = c.t
  const label = t != null ? clockLabel(t) : '…'
  const atMin = t != null && t <= c.tMin
  const atMax = t != null && t >= c.tMax
  return (
    <div className="sticky top-0 z-30 border-b border-line bg-bg md:top-[48px]">
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2 md:gap-x-3 md:px-6">
        <span className="section-title hidden lg:inline">Demo clock</span>
        <span
          className="num min-w-[8.6rem] rounded-md border border-line bg-surface px-2 py-1 text-center text-base font-semibold md:min-w-[9.5rem] md:px-2.5"
          aria-label={`Demo clock: ${label}`}
        >
          {label}
        </span>
        <div className="flex items-center gap-1 md:gap-1.5">
          <button
            type="button"
            className="btn-icon"
            aria-label="Step back 15 minutes"
            title="Back 15 min"
            disabled={t == null || atMin}
            onClick={() => c.step(-15)}
          >
            <StepBackIcon />
          </button>
          <button
            type="button"
            className="btn-icon !border-accent !bg-accent !text-surface"
            aria-label={c.playing ? 'Pause clock' : 'Play clock'}
            aria-pressed={c.playing}
            title={c.playing ? 'Pause' : 'Play: advance 15 min per tick'}
            disabled={t == null || atMax}
            onClick={() => c.setPlaying(!c.playing)}
          >
            {c.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Step forward 15 minutes"
            title="Forward 15 min"
            disabled={t == null || atMax}
            onClick={() => c.step(15)}
          >
            <StepForwardIcon />
          </button>
        </div>
        <Segmented
          label="Playback speed in ticks per second"
          value={c.speed}
          onChange={c.setSpeed}
          options={[
            { key: 1, label: '1/s' },
            { key: 4, label: '4/s' },
          ]}
        />
        <div className="order-last flex min-w-0 basis-full items-center gap-2 md:order-none md:flex-1 md:basis-0 md:gap-3">
          <input
            type="range"
            className="h-2 min-w-[120px] flex-1"
            min={c.tMin}
            max={c.tMax}
            step={15}
            value={t ?? c.tMin}
            disabled={t == null}
            onChange={(e) => c.setT(Number(e.target.value))}
            aria-label="Demo clock position"
            aria-valuetext={label}
          />
          <button
            type="button"
            className="btn !px-2.5 md:!px-3"
            onClick={c.jumpDefault}
            disabled={t == null}
            title="Jump to the default demo time"
            aria-label="Jump to the default demo time"
          >
            <JumpIcon />
            <span className="hidden sm:inline">Default</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function Banner() {
  const { pathname } = useLocation()
  const { meta } = useApp()
  const n = meta ? /(\d+)/.exec(meta.demo_population)?.[1] : null
  const who = n ? `${n} held-out patients` : 'held-out patients'
  let text: string
  if (isClockRoute(pathname))
    text = `Replaying real CGM from ${who} the model never saw · demo clock · not for clinical use`
  else if (pathname.startsWith('/live'))
    text = `Streaming a held-out recording one reading at a time · not for clinical use`
  else text = 'Research prototype · evaluated retrospectively · not for clinical use'
  return (
    <div className="border-b border-line bg-accent-soft">
      <p className="mx-auto max-w-page px-4 py-1.5 text-xs text-ink md:px-6">{text}</p>
    </div>
  )
}

function Footer() {
  const { meta } = useApp()
  return (
    <footer className="mt-12 border-t border-line bg-surface">
      <div className="mx-auto max-w-page px-4 py-5 text-sm text-muted md:px-6">
        <p className="max-w-4xl">
          <strong className="font-semibold text-ink">Clinical disclaimer.</strong>{' '}
          {meta?.disclaimer ??
            'Research prototype. Not a medical device. Forecasts are experimental and must be interpreted by a qualified clinician.'}
        </p>
        <p className="mt-2 text-xs">
          Pratirup · Team Aflatoon, Scaler School of Technology · Data: ShanghaiT2DM, CC BY 4.0
        </p>
      </div>
    </footer>
  )
}

function RouteFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading page">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-5 w-full max-w-xl" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function Shell() {
  const { pathname } = useLocation()
  const showClock = isClockRoute(pathname)
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-surface md:sticky md:top-0 md:z-40">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-x-6 px-4 md:px-6">
          <div className="flex min-h-[48px] items-center">
            <Wordmark />
          </div>
          <div className="order-last w-full md:order-none md:w-auto md:flex-1">
            <Nav />
          </div>
          <div className="flex items-center">
            <ThemeToggle />
          </div>
        </div>
      </header>
      {showClock && <ClockBar />}
      <Banner />
      <main id="main" className="mx-auto w-full max-w-page flex-1 px-4 py-5 md:px-6">
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
