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

router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username.toLowerCase()))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

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
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
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
