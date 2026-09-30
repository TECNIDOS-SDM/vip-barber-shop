"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { shouldShowWednesdayPromotion } from "@/lib/promotion-day";

export function PromotionModal() {
  const [isOpen, setIsOpen] = useState(() => shouldShowWednesdayPromotion());

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Promoción miércoles 2x1 en corte básico"
        className="relative w-full max-w-lg"
      >
        <button
          type="button"
          autoFocus
          aria-label="Cerrar promoción"
          onClick={() => setIsOpen(false)}
          className="absolute right-2 top-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/80 text-white shadow-lg transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>

        <Image
          src="/promocion-miercoles-2x1.png"
          alt="Promoción miércoles 2x1 en corte básico de VIP Barber Top"
          width={1170}
          height={1169}
          priority
          sizes="(max-width: 640px) calc(100vw - 2rem), 512px"
          className="max-h-[calc(100dvh-2rem)] h-auto w-full rounded-[1.75rem] border border-accent/30 object-contain shadow-2xl shadow-black"
        />
      </div>
    </div>
  );
}
