export const RAD_SESSION_KEY = "rad_session";

export type RadUser = {
  id: number;
  username: string;
  name: string;
  role: string;
};

export type RadSession = {
  token: string;
  user: RadUser;
};

export function readRadSession(): RadSession | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(RAD_SESSION_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RadSession;
    if (!parsed?.user || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeRadSession(s: RadSession): void {
  try { window.localStorage.setItem(RAD_SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function clearRadSession(): void {
  try { window.localStorage.removeItem(RAD_SESSION_KEY); } catch { /* ignore */ }
}

export function isAdmin(role: string): boolean {
  return role === "admin";
}
