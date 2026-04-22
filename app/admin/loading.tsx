import { RouteLoadingCard } from "@/components/shared/route-loading-card";

export default function Loading() {
  return (
    <RouteLoadingCard
      title="Abriendo panel administrador"
      description="Cargando agenda, reservas y herramientas del equipo..."
    />
  );
}
