import type {Config} from 'tailwindcss';

// Code 92 Command Center design tokens — see DESIGN.md.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // layered surfaces, dark only
        bg: '#0B0E13',
        panel: '#11151C',
        raised: '#161C26',
        hairline: 'rgba(255,255,255,0.07)',
        // phosphor green: primary actions + healthy status
        accent: '#34D399',
        // status hues are the only other saturated colors
        amber: '#FBBF24',
        danger: '#F87171',
        // text
        ink: '#E6EAF2',
        muted: '#8B95A7',
        faint: '#5B6577'
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
