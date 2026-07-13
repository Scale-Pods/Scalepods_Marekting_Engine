import type { Config } from 'tailwindcss'

// ScalePods brand tokens (TRD §9 / brand-kit). Colors are wired to CSS vars so
// the dark/light theme switch in index.css stays the single source of truth.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // RGB-channel vars let Tailwind's /opacity modifiers work (e.g. bg-sage/12).
        page: 'rgb(var(--bg-page-rgb) / <alpha-value>)',
        card: 'rgb(var(--bg-card-rgb) / <alpha-value>)',
        panel: 'rgb(var(--bg-panel-rgb) / <alpha-value>)',
        sage: 'rgb(var(--accent-green-rgb) / <alpha-value>)',
        electric: 'rgb(var(--accent-blue-rgb) / <alpha-value>)',
        terracotta: 'rgb(var(--accent-orange-rgb) / <alpha-value>)',
        'alt-green': 'rgb(var(--alt-bg-green-rgb) / <alpha-value>)',
        ink: 'rgb(var(--text-primary-rgb) / <alpha-value>)',
        muted: 'var(--text-muted)',
        line: 'var(--border-subtle)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['Menlo', 'Monaco', 'Consolas', '"Fira Code"', 'monospace'],
      },
      borderRadius: { xl2: '1.25rem' },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
      },
    },
  },
  plugins: [],
} satisfies Config
