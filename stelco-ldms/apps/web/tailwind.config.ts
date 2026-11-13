import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef6ff', 100: '#d9eaff', 500: '#1f6fd1', 600: '#175bb0', 700: '#124a8f', 900: '#0b2c55' },
      },
    },
  },
  plugins: [],
} satisfies Config;
