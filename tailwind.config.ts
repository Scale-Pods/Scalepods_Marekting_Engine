import type { Config } from 'tailwindcss'

// ScalePods brand tokens (TRD §9 / brand-kit). Colors are wired to CSS vars so
// the dark/light theme switch in index.css stays the single source of truth.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        page: 'var(--bg-page)',
        card: 'var(--bg-card)',
        panel: 'var(--bg-panel)',
        sage: 'var(--accent-green)',
        electric: 'var(--accent-blue)',
        terracotta: 'var(--accent-orange)',
        'alt-green': 'var(--alt-bg-green)',
        ink: 'var(--text-primary)',
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
