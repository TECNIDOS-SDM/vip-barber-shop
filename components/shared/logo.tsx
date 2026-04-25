import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = {
  title?: string;
  titleClassName?: string;
};

export function Logo({
  title = "AGENDA TU CITA",
  titleClassName
}: LogoProps) {
  return (
    <div className="inline-flex items-center gap-3">
      <div className="relative h-14 w-14 overflow-hidden rounded-full border border-[#f0c76e]/50 bg-black shadow-[0_10px_35px_rgba(240,199,110,0.28)]">
        <Image
          src="/vip-barbertop-logo.jpeg"
          alt="Logo VIP BarberTop"
          fill
          sizes="56px"
          className="object-cover"
          priority
        />
      </div>
      {title ? (
        <h1
          className={cn(
            "whitespace-nowrap text-xl font-black uppercase tracking-[0.08em] text-[#facc15] sm:text-2xl",
            titleClassName
          )}
        >
          {title}
        </h1>
      ) : null}
    </div>
  );
}
