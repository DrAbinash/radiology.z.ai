/**
 * seed-defaults.ts — creates the 2 users (from env vars) + default protocols.
 *
 * Run once after db:push:
 *   pnpm seed
 *
 * Env vars (set in .env):
 *   RADIOLOGIST_USERNAME, RADIOLOGIST_PASSWORD, RADIOLOGIST_NAME
 *   ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_NAME
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("✗ DATABASE_URL not set"); process.exit(1); }

import * as schema from "../server/db/schema.ts";
const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

async function seed() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  Seeding default users + protocols             ║");
  console.log("╚═══════════════════════════════════════════════╝");

  // ── Users ──────────────────────────────────────────────────────────────────
  const users = [
    {
      username: process.env.ADMIN_USERNAME ?? "abinash",
      password: process.env.ADMIN_PASSWORD ?? "changeme",
      name: process.env.ADMIN_NAME ?? "Dr. Abinash Kumar",
      role: "admin",
    },
    {
      username: process.env.RADIOLOGIST_USERNAME ?? "sugandha",
      password: process.env.RADIOLOGIST_PASSWORD ?? "changeme",
      name: process.env.RADIOLOGIST_NAME ?? "Dr. Sugandha Priyadarshini",
      role: "radiologist",
    },
  ];

  for (const u of users) {
    const [existing] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.username, u.username)).limit(1);
    const hash = await bcrypt.hash(u.password, 10);
    if (existing) {
      await db.update(schema.usersTable).set({ passwordHash: hash, name: u.name, role: u.role }).where(eq(schema.usersTable.id, existing.id));
      console.log(`  ✓ Updated user: ${u.username} (${u.role})`);
    } else {
      await db.insert(schema.usersTable).values({ username: u.username, passwordHash: hash, name: u.name, role: u.role });
      console.log(`  ✓ Created user: ${u.username} (${u.role})`);
    }
  }

  // ── Default protocols (Brain MRI — the rest via seed:ct / seed:usg-xray) ───
  const defaultProtocols = [
    {
      name: "MRI Brain Routine",
      region: "Brain",
      modality: "MRI",
      checklist: ["Ventricles", "Basal cisterns", "Brain parenchyma", "Midline shift", "Grey-white differentiation", "Acute haemorrhage", "Infarct", "Mass effect", "Sinuses"],
      techniqueText: "MRI of the brain performed with T1, T2, FLAIR, DWI, and SWI sequences.",
      normalText: "The brain parenchyma shows normal signal intensity. The ventricular system and basal cisterns are normal. No midline shift or mass effect. No acute infarct or haemorrhage.",
      recommendationText: "Clinical correlation is advised.",
      requiredMeasurements: [],
      isGoldStandard: true,
      sortOrder: 1,
    },
  ];

  for (const p of defaultProtocols) {
    const [existing] = await db.select().from(schema.protocolsTable).where(eq(schema.protocolsTable.name, p.name)).limit(1);
    if (!existing) {
      await db.insert(schema.protocolsTable).values(p);
      console.log(`  ✓ Created protocol: ${p.name}`);
    } else {
      console.log(`  • Protocol exists: ${p.name}`);
    }
  }

  // ── Default study tab ─────────────────────────────────────────────────────
  const [tabExisting] = await db.select().from(schema.studyTabsTable).where(eq(schema.studyTabsTable.name, "Brain")).limit(1);
  if (!tabExisting) {
    await db.insert(schema.studyTabsTable).values({ name: "Brain", modality: "MRI", sortOrder: 1 });
    console.log("  ✓ Created study tab: Brain");
  }

  console.log("\n✅ Seed complete.");
  console.log(`   Login at http://localhost:${process.env.SERVER_PORT ?? 3000}`);
  console.log(`   Users: ${users.map((u) => u.username).join(", ")}`);
  await pool.end();
  process.exit(0);
}

seed().catch((err) => { console.error("✗ Seed failed:", err); process.exit(1); });
