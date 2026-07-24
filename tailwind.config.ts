import type {Config} from 'tailwindcss';

// Code 92 Command Center design tokens — see DESIGN.md.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Theme-aware RGB channels are defined in app/globals.css.
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
        raised: 'rgb(var(--color-raised) / <alpha-value>)',
        hairline: 'rgb(var(--color-hairline) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        amber: 'rgb(var(--color-amber) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        faint: 'rgb(var(--color-faint) / <alpha-value>)'
      },
      fontFamily: {
        sans: ['var(--font-plex-sans)', 'system-ui', 'sans-serif'],
        arabic: [
          'var(--font-plex-arabic)',
          'var(--font-plex-sans)',
          'system-ui',
          'sans-serif'
        ],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
};

export default config;
