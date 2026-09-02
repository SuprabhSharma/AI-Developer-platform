/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./features/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: { 950: "#080b0f", 900: "#0d1117", 800: "#161b22", 700: "#21262d", 600: "#30363d", 500: "#484f58", 400: "#6e7681" },
        signal: { DEFAULT: "#58a6ff", dim: "#388bfd" },
        github: { blue: "#58a6ff", green: "#3fb950", red: "#f85149", yellow: "#d29922" },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Noto Sans", "Helvetica", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Consolas", "Liberation Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
