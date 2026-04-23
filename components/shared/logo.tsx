import Image from "next/image";

type LogoProps = {
  title?: string;
};

export function Logo({ title = "AGENDA TU CITA" }: LogoProps) {
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
      <h1 className="text-xl font-black uppercase tracking-[0.08em] text-[#facc15] sm:text-2xl">
        {title}
      </h1>
    </div>
  );
}
