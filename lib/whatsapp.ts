export function normalizeWhatsAppNumber(value: string) {
  return value.replace(/\D/g, "");
}

export function buildWhatsAppUrl(value: string) {
  const phone = normalizeWhatsAppNumber(value);

  if (!phone) {
    return "#";
  }

  return `https://wa.me/${phone}`;
}
