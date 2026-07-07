/**
 * Auth middleware — simple session-based auth for 2 users (you + your wife).
 *
 * No ERP dependency. Users are stored in the `users` table with bcrypt-hashed
 * passwords. Sessions are httpOnly cookies + a DB record.
 *
 * First boot: the seed script creates the 2 users from env vars
 * (RADIOLOGIST_USERNAME/PASSWORD, ADMIN_USERNAME/PASSWORD).
 */
import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { sessionsTable, usersTable } from "../db/schema";
import { eq, gt } from "drizzle-orm";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    name: string;
    role: string;
  };
}

function extractToken(req: Request): string | null {
  const cookie = req.headers.cookie ?? "";
  const match = cookie.match(/rad_session=([^;]+)/);
  if (match) return match[1];
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.token, token))
    .limit(1);

  if (!session || new Date(session.expiresAt) <= new Date()) {
    res.status(401).json({ error: "Session expired. Please log in again." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  req.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
