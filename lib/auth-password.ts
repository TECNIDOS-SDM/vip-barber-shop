export const BARBER_PASSWORD_REQUIRED_MESSAGE =
  "La contraseña es obligatoria para crear la cuenta del barbero.";

export const BARBER_PASSWORD_POLICY_MESSAGE =
  "La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número.";

export function getBarberPasswordError(
  password: unknown,
  { required }: { required: boolean }
) {
  const value = typeof password === "string" ? password : "";

  if (!value.trim()) {
    return required ? BARBER_PASSWORD_REQUIRED_MESSAGE : null;
  }

  if (
    value.length < 8 ||
    !/[A-Z]/.test(value) ||
    !/[a-z]/.test(value) ||
    !/\d/.test(value)
  ) {
    return BARBER_PASSWORD_POLICY_MESSAGE;
  }

  return null;
}
