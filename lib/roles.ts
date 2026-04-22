import type { UserRole } from "@/types";

export function getRoleHomePath(role: UserRole | null) {
  if (role === "barbero") {
    return "/barbero";
  }

  return "/admin";
}
