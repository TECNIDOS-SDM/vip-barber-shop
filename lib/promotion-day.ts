const COLOMBIA_TIMEZONE = "America/Bogota";

export function shouldShowWednesdayPromotion(date = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: COLOMBIA_TIMEZONE,
    weekday: "short"
  }).format(date);

  return weekday === "Wed";
}
