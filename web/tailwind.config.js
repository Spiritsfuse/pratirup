/** @type {import('tailwindcss').Config} */
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    fontFamily: {
      sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', '"Liberation Mono"', 'monospace'],
    },
    fontSize: {
      xs: ['12px', '16px'],
      sm: ['13px', '18px'],
      base: ['15px', '22px'],
      lg: ['17px', '24px'],
      xl: ['20px', '26px'],
      '2xl': ['24px', '30px'],
      '3xl': ['30px', '36px'],
      '4xl': ['38px', '42px'],
    },
    extend: {
      colors: {
        bg: c('bg'),
        surface: c('surface'),
        ink: c('ink'),
        muted: c('muted'),
        line: c('line'),
        accent: c('accent'),
        'accent-soft': c('accent-soft'),
        vlow: c('vlow'),
        low: c('low'),
        inrange: c('inrange'),
        high: c('high'),
        vhigh: c('vhigh'),
        pastfc: c('pastfc'),
        scenario: c('scenario'),
      },
      borderRadius: { DEFAULT: '4px', md: '5px', lg: '6px' },
      screens: { xs: '420px' },
      maxWidth: { page: '1400px' },
    },
  },
  plugins: [],
}
