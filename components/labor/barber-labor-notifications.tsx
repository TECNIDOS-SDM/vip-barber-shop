"use client";

import { useEffect, useRef, useState } from "react";
import { formatLaborDate, formatLaborTimestamp } from "@/lib/labor/week";
import type { LaborNotification } from "@/types/labor";

type BarberLaborNotificationsProps = {
  active: boolean;
  revision: number;
  onUnreadCount: (count: number) => void;
};

function formatRecargoText(value: string) {
  return value
    .replace(/penalidad informativa/gi, "recargo informativo")
    .replace(/penalidades?/gi, "Recargo");
}

export function BarberLaborNotifications({ active, revision, onUnreadCount }: BarberLaborNotificationsProps) {
  const [notifications, setNotifications] = useState<LaborNotification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isStale, setIsStale] = useState(true);
  const isRefreshingRef = useRef(false);
  const observedRevisionRef = useRef(revision);

  useEffect(() => {
    if (revision !== observedRevisionRef.current) {
      observedRevisionRef.current = revision;
      setIsStale(true);
    }
  }, [revision]);

  useEffect(() => {
    const markStaleWhenVisible = () => {
      if (document.visibilityState === "visible") {
        setIsStale(true);
      }
    };

    document.addEventListener("visibilitychange", markStaleWhenVisible);

    return () => {
      document.removeEventListener("visibilitychange", markStaleWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (!active || !isStale || isRefreshingRef.current) {
      return;
    }

    let mounted = true;
    isRefreshingRef.current = true;

    async function loadNotifications() {
      try {
        const response = await fetch("/api/barber/labor-notifications", { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok || !mounted) {
          return;
        }

        setNotifications(payload.notifications as LaborNotification[]);
        onUnreadCount(payload.unreadCount ?? 0);
        setIsStale(false);
      } finally {
        isRefreshingRef.current = false;

        if (mounted) {
          setLoaded(true);
        }
      }
    }

    void loadNotifications();

    return () => {
      mounted = false;
    };
  }, [active, isStale, onUnreadCount]);

  if (!loaded) {
    return <div className="h-24 rounded-2xl bg-white/5" />;
  }

  return (
    <div className="space-y-3">
      {notifications.length ? (
        notifications.map((notification) => (
          <div key={notification.id} className="rounded-xl border border-white/10 bg-black/15 px-3 py-3 text-sm text-sand/75">
            <p className="font-semibold text-sand">{formatRecargoText(notification.titulo)}</p>
            <p className="mt-1">{formatRecargoText(notification.mensaje)}</p>
            {notification.valor_penalidad !== null ? (
              <p className="mt-2 text-xs text-sand/60">{formatLaborDate(notification.fecha)} · {formatLaborTimestamp(notification.created_at)}</p>
            ) : null}
          </div>
        ))
      ) : (
        <p className="text-sm text-sand/65">No tienes notificaciones esta semana.</p>
      )}
    </div>
  );
}
