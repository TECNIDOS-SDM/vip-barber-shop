const ADMIN_LOGIN_DOMAIN = "admin.local";

export function adminIdentifierToEmail(identifier: string) {
  const value = identifier.trim();

  if (value.includes("@")) {
    return value.toLowerCase();
  }

  return `${value.toLowerCase()}@${ADMIN_LOGIN_DOMAIN}`;
}

export function getSuggestedCredentials() {
  return {
    adminAlias: "Admin123",
    barberAlias: "Barbero",
    barberEmail: "barbero@admin.local"
  };
}
