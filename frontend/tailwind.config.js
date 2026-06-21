/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14171f',
        panel: '#ffffff',
        line: '#d9dee8',
        mist: '#f4f6f9',
        brand: '#2563eb',
        good: '#14834f',
        warn: '#b45309',
        bad: '#c2410c',
      },
      boxShadow: {
        soft: '0 8px 28px rgba(20, 23, 31, 0.08)',
      },
    },
  },
  plugins: [],
};
