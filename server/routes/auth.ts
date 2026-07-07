/**
 * Auth routes — login, logout, me.
 * Simple 2-user auth (you + your wife). No ERP dependency.
 */
import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { sessionsTable, usersTable } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";

const router = Router();
const SESSION_TTL_HOURS = 12;

// Whether the app is reachable over HTTPS (e.g. behind Synology's reverse
// proxy with a real certificate). Plain "NODE_ENV=production" does NOT mean
// HTTPS — most home/hospital NAS deployments are plain http://<nas-ip>:port
// on the LAN, and browsers refuse to store a Secure/SameSite=None cookie
// over plain HTTP. Set HTTPS_ENABLED=true in .env only if you've put a
// reverse proxy with TLS in front of this app.
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === "true";

// ── Basic login rate limiting (in-memory, per-username) ──────────────────
// Not a substitute for a real WAF, but stops naive brute-forcing on a
// 2-user LAN app. Resets on server restart — that's fine here.
const LOGIN_ATTEMPT_LIMIT = 8;
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const loginAttempts = new Map<string, { count: number; firstAttemptAt: number }>();

function isLockedOut(key: string): boolean {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAttemptAt > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= LOGIN_ATTEMPT_LIMIT;
}

function recordFailedAttempt(key: string): void {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.firstAttemptAt > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAttemptAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

function clearAttempts(key: string): void {
  loginAttempts.delete(key);
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  const rateLimitKey = username.toLowerCase();
  if (isLockedOut(rateLimitKey)) {
    res.status(429).json({ error: "Too many failed attempts. Please wait a few minutes and try again." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username.toLowerCase()))
    .limit(1);

  if (!user) {
    recordFailedAttempt(rateLimitKey);
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    recordFailedAttempt(rateLimitKey);
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  clearAttempts(rateLimitKey);

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  await db.insert(sessionsTable).values({
    token,
    userId: user.id,
    expiresAt,
  });

  res
    .cookie("rad_session", token, {
      httpOnly: true,
      secure: HTTPS_ENABLED,
      sameSite: HTTPS_ENABLED ? "none" : "lax",
      path: "/",
      maxAge: SESSION_TTL_HOURS * 60 * 60 * 1000,
    })
    .json({
      ok: true,
      user: { id: user.id, username: user.username, name: user.name, role: user.role },
    });
});

router.get("/me", requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

router.post("/logout", requireAuth, async (req: AuthRequest, res) => {
  const cookie = req.headers.cookie ?? "";
  const match = cookie.match(/rad_session=([^;]+)/);
  const token = match?.[1];
  if (token) {
    await db.delete(sessionsTable).where(eq(sessionsTable.token, token)).catch(() => {});
  }
  res.clearCookie("rad_session", { path: "/" }).json({ ok: true });
});

export default router;
