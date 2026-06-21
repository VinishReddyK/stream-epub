/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101418",
        paper: "#f7f8f5",
        line: "#d9ded6",
        moss: "#4d6f50",
        leaf: "#6f8f5f",
        cream: "#fffdf6"
      }
    }
  },
  plugins: []
};
