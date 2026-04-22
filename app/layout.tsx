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
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
