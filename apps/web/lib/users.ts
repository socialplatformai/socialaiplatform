import { api } from "./api";

// B1/B2 (ADR-0010): gestão de usuários por convite. Papéis crus alinhados a UserRole (.NET): Member=0, Admin=1.
export const UserRole = { Member: 0, Admin: 1 } as const;

// O backend devolve Role como STRING ("Admin"/"Member") nos DTOs de usuário — espelho dos enums.
export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  role: string; // "Admin" | "Member"
}

export interface InviteResult {
  token: string;
  link: string; // o Admin copia-e-cola (entrega por e-mail fora de escopo nesta fase).
}

export const usersApi = {
  /** GET /api/users (Admin) — membros do workspace. */
  list: () => api<AppUser[]>("/api/users"),
  /** POST /api/users/invite (Admin) — token + link de convite (uso único, TTL 7d). */
  invite: (email: string, role: number) =>
    api<InviteResult>("/api/users/invite", {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),
  /** DELETE /api/users/{id} (Admin) — 409 ao tentar remover o último Admin. */
  remove: (id: string) => api<void>(`/api/users/${id}`, { method: "DELETE" }),
  /** POST /api/auth/accept-invite — convidado cria a conta (anônimo). Devolve tokens (AuthResponse). */
  acceptInvite: (token: string, password: string, name?: string) =>
    api<{
      accessToken: string;
      refreshToken?: string;
      role?: string;
    }>("/api/auth/accept-invite", {
      method: "POST",
      body: JSON.stringify({ token, password, name }),
    }),
};
