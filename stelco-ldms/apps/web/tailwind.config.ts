import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Thaana (Dhivehi) fallbacks: Faruma/MV Faseyha are the common Maldivian fonts; MV Boli ships with
      // Windows, Noto Sans Thaana elsewhere. Latin text keeps the system UI font.
      fontFamily: { sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Faruma', 'MV Faseyha', 'MV Boli', 'Noto Sans Thaana', 'sans-serif'] },
      colors: {
        brand: { 50: '#eef6ff', 100: '#d9eaff', 500: '#1f6fd1', 600: '#175bb0', 700: '#124a8f', 900: '#0b2c55' },
      },
    },
  },
  plugins: [],
} satisfies Config;
