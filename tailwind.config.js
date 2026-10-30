/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 50: "#eef3fa", 100: "#d5e0f0", 500: "#1f4b86", 700: "#12335f", 800: "#0b2545", 900: "#071a33" },
        income: "#15803d",
        expense: "#b91c1c",
      },
      fontFamily: { sans: ["Inter", "Noto Sans Bengali", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
