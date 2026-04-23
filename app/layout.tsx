import type { Metadata } from "next";
import { Manrope, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body"
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-heading"
});

export const metadata: Metadata = {
  applicationName: "VIP BarberTop",
  title: "VIP BarberTop | Reservas para barberia",
  description:
    "Sistema profesional de reservas para VIP BarberTop, optimizado para celular."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="dark">
      <body
        className={`${manrope.variable} ${jakarta.variable} min-h-screen font-sans`}
      >
        <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
          <div className="rounded-[1.75rem] border border-[#facc15]/20 bg-black/55 px-5 py-4 text-center shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <p className="text-3xl font-black uppercase tracking-[0.18em] text-[#facc15] sm:text-4xl">
              VIP BARBERTOP
            </p>
          </div>
        </div>
        {children}
        <Toaster
          richColors
          position="top-center"
          toastOptions={{
            style: {
              background: "#17110a",
              color: "#f7e7bf",
              border: "1px solid rgba(240, 199, 110, 0.25)"
            }
          }}
        />
      </body>
    </html>
  );
}
