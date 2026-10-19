import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          subtle: '#f7f7f5',
          dark: '#191919',
          'dark-subtle': '#202020',
        },
        border: {
          DEFAULT: '#e9e9e7',
          dark: '#2f2f2f',
        },
        accent: {
          DEFAULT: '#2383e2',
          hover: '#0b6fcc',
        },
      },
      borderRadius: {
        xl: '0.875rem',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Helvetica',
          '"Apple Color Emoji"',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        panel: '0 0 0 1px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config;
