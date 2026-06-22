/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14171f',
        panel: '#fffefd',
        line: '#e5ded4',
        mist: '#faf9f7',
        brand: '#1f2937',
        good: '#14834f',
        warn: '#b45309',
        bad: '#c2410c',
      },
      boxShadow: {
        soft: '0 10px 24px rgba(20, 23, 31, 0.08), 0 2px 6px rgba(20, 23, 31, 0.05)',
      },
    },
  },
  plugins: [],
};
