/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        corp: { DEFAULT: '#1565C0', light: '#D0EAFF', dark: '#0D47A1' },
        pers: { DEFAULT: '#2E7D32', light: '#D6F0D6', dark: '#1B5E20' },
        expense: { DEFAULT: '#B71C1C', light: '#FFEBEE', dark: '#7F0000' },
        fixed: { DEFAULT: '#E65100', light: '#FFF3CC', dark: '#BF360C' },
        loan: { DEFAULT: '#6A1E6E', light: '#F5E0FF', dark: '#4A148C' },
        forecast: { DEFAULT: '#FF8F00', light: '#FFE0A0', dark: '#E65100' },
      }
    },
  },
  plugins: [],
}
