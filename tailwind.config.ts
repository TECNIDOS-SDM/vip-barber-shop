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
        background: "#070606",
        surface: "#11100d",
        accent: "#d9b15f",
        sand: "#f7ead2",
        ink: "#17130d",
        muted: "#b7ab94",
        danger: "#ff6b6b"
      },
      boxShadow: {
        glow: "0 20px 60px rgba(217, 177, 95, 0.22)"
      },
      backgroundImage: {
        grain:
          "radial-gradient(circle at top, rgba(217,177,95,0.18), transparent 30%), radial-gradient(circle at bottom right, rgba(255,255,255,0.06), transparent 22%)"
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
