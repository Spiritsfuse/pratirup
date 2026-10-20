import type { SVGProps } from 'react'
import type { Trend } from '../api/types'
import { TREND_TEXT } from '../lib/format'

type P = SVGProps<SVGSVGElement>

function Svg({ children, ...rest }: P) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const PlayIcon = (p: P) => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
  </Svg>
)
export const PauseIcon = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="4.5" width="4.2" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.8" y="4.5" width="4.2" height="15" rx="1" fill="currentColor" stroke="none" />
  </Svg>
)
export const StepBackIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 5v14" />
    <path d="M19 5.5v13L9 12z" fill="currentColor" stroke="none" />
  </Svg>
)
export const StepForwardIcon = (p: P) => (
  <Svg {...p}>
    <path d="M18 5v14" />
    <path d="M5 5.5v13L15 12z" fill="currentColor" stroke="none" />
  </Svg>
)
export const JumpIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
  </Svg>
)
export const SunIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
  </Svg>
)
export const MoonIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
  </Svg>
)
export const AutoThemeIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
  </Svg>
)
export const ChevronIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
)
export const ExternalIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
)
export const AlertIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v5M12 17.6v.1" />
  </Svg>
)
export const InfoIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.6v.1" />
  </Svg>
)
export const RefreshIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </Svg>
)

/**
 * Rate-of-change arrow. Fast trends use a double arrow. Always paired with an
 * accessible text label, since colour and shape are not enough on their own.
 */
const ROT: Record<Trend, number> = {
  rising_fast: -90,
  rising: -90,
  rising_slow: -45,
  steady: 0,
  falling_slow: 45,
  falling: 90,
  falling_fast: 90,
}
export function TrendIcon({ trend, size = 20, className = '' }: { trend: Trend | null; size?: number; className?: string }) {
  if (!trend) return null
  const fast = trend === 'rising_fast' || trend === 'falling_fast'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={`Glucose ${TREND_TEXT[trend]}`}
      className={className}
    >
      <title>{`Glucose ${TREND_TEXT[trend]}`}</title>
      <g transform={`rotate(${ROT[trend]} 12 12)`}>
        {fast ? (
          <>
            <path d="M3 12h13M11 6l6 6-6 6" transform="translate(0 -4)" />
            <path d="M3 12h13M11 6l6 6-6 6" transform="translate(0 4)" />
          </>
        ) : (
          <path d="M4 12h15M12.5 5.5L19 12l-6.5 6.5" />
        )}
      </g>
    </svg>
  )
}
