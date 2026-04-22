import Image from "next/image";

export function Logo() {
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
      <div>
        <p className="text-xs uppercase tracking-[0.35em] text-[#f0c76e]/85">
          VIP BarberTop
        </p>
        <h1 className="text-lg font-semibold text-sand">VIP BarberTop</h1>
      </div>
    </div>
  );
}
