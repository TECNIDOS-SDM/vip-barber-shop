"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";

type TopNavigationProps = {
  adminHref?: string;
  barberHref?: string;
};

export function TopNavigation({
  adminHref = "/auth/login?next=/admin",
  barberHref = "/auth/login?next=/barbero"
}: TopNavigationProps) {
  const pathname = usePathname();

  return (
    <header className="mb-6 flex flex-col gap-4 rounded-[1.75rem] border border-[#d9b15f]/15 bg-[#120f0b]/80 px-4 py-4 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <Link href="/" className="w-fit">
        <Logo />
      </Link>
      <nav className="grid grid-cols-3 gap-2 rounded-2xl border border-[#d9b15f]/15 bg-black/30 p-1">
        <Link
          href="/"
          className={cn(
            "rounded-xl px-4 py-3 text-center text-sm font-semibold transition",
            pathname === "/"
              ? "bg-accent text-ink"
              : "text-sand/75 hover:bg-white/6 hover:text-sand"
          )}
        >
          Reservar
        </Link>
        <Link
          href={adminHref}
          className={cn(
            "rounded-xl px-4 py-3 text-center text-sm font-semibold transition",
            pathname.startsWith("/admin") || pathname.startsWith("/auth/login")
              ? "bg-accent text-ink"
              : "text-sand/75 hover:bg-white/6 hover:text-sand"
          )}
        >
          Admin
        </Link>
        <Link
          href={barberHref}
          className={cn(
            "rounded-xl px-4 py-3 text-center text-sm font-semibold transition",
            pathname.startsWith("/barbero")
              ? "bg-accent text-ink"
              : "text-sand/75 hover:bg-white/6 hover:text-sand"
          )}
        >
          Barberos
        </Link>
      </nav>
    </header>
  );
}
