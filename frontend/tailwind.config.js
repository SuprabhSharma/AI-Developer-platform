/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./features/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: { 900: "#0b0d10", 800: "#12151a", 700: "#1b1f26", 600: "#262b34", 500: "#3a414d" },
        signal: { DEFAULT: "#f5a524", dim: "#b9791b" },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
