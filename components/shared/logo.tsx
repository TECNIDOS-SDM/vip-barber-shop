export function Logo() {
  return (
    <div className="inline-flex items-center gap-3">
      <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-[#d9b15f]/50 bg-black text-[#f6d27d] shadow-[0_10px_35px_rgba(217,177,95,0.28)]">
        <div className="absolute inset-x-2 top-3 h-px bg-gradient-to-r from-transparent via-[#d9b15f] to-transparent" />
        <span className="relative text-[1.35rem] font-black tracking-[0.18em]">
          VIP
        </span>
        <div className="absolute inset-x-3 bottom-3 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#d9b15f] to-transparent" />
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.35em] text-[#d9b15f]/85">
          Premium Grooming
        </p>
        <h1 className="text-lg font-semibold text-sand">VIP Barber shop</h1>
      </div>
    </div>
  );
}
