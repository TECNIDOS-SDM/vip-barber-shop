import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "#030303",
        surface: "#0d0b08",
        accent: "#f0c76e",
        sand: "#f7e7bf",
        ink: "#16110a",
        muted: "#c9b489",
        danger: "#ff6b6b"
      },
      boxShadow: {
        glow: "0 20px 60px rgba(240, 199, 110, 0.22)"
      },
      backgroundImage: {
        grain:
          "radial-gradient(circle at top, rgba(240,199,110,0.18), transparent 30%), radial-gradient(circle at bottom right, rgba(255,255,255,0.05), transparent 20%)"
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        rise: "rise 0.6s ease-out"
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" }
        },
        rise: {
          from: { opacity: "0", transform: "translateY(18px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        }
      }
    }
  },
  plugins: []
};

export default config;
