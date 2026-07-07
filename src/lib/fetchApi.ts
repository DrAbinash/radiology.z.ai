import { readRadSession } from "./session";

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const session = readRadSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (session?.token) headers["Authorization"] = `Bearer ${session.token}`;

  const res = await fetch(path, { ...init, headers, credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
