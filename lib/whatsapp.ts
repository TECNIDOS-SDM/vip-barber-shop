export function normalizeWhatsAppNumber(value: string) {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (digits.startsWith("57")) {
    return digits;
  }

  if (digits.length === 10) {
    return `57${digits}`;
  }

  return digits;
}

export function buildWhatsAppUrl(value: string) {
  const phone = normalizeWhatsAppNumber(value);

  if (!phone) {
    return "#";
  }

  return `https://wa.me/${phone}`;
}
