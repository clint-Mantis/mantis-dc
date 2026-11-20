/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#c4161c', dark: '#9e1116', light: '#fbe9ea' },
        ink: { DEFAULT: '#2b2f33', soft: '#3b4046' },
      },
      fontSize: { xxs: '0.68rem' },
    },
  },
  plugins: [],
};
