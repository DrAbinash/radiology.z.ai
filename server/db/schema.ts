/**
 * Standalone Radiology Service — database schema.
 *
 * Owns: users, report drafts, protocols, quick findings, study tabs,
 * learned patterns, print settings, AI settings.
 *
 * Does NOT own: studies or patients (those live in Orthanc + optionally
 * the ERP). Studies are fetched live from Orthanc on every request.
 */
import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import bcrypt from "bcryptjs";

// ── Users (simple 2-user auth — you + your wife) ─────────────────────────────
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  // Bcrypt hash — set via the seed script or env vars on first boot
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("radiologist"), // admin | radiologist
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Sessions ────────────────────────────────────────────────────────────────
export const sessionsTable = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byToken: uniqueIndex("sessions_token_uq").on(t.token),
    byExpiry: index("sessions_expiry_idx").on(t.expiresAt),
  }),
);

// ── Report drafts (work-in-progress, keyed by Orthanc StudyInstanceUID) ─────
export const reportDraftsTable = pgTable(
  "report_drafts",
  {
    id: serial("id").primaryKey(),
    // Orthanc study identifier — the StudyInstanceUID from DICOM
    studyInstanceUid: text("study_instance_uid").notNull(),
    // Cached patient demographics (from Orthanc tags, optionally enriched from ERP)
    patientName: text("patient_name"),
    patientId: text("patient_id"),
    accessionNumber: text("accession_number"),
    modality: text("modality"),
    studyDescription: text("study_description"),
    studyDate: text("study_date"),
    // Report sections
    clinicalHistory: text("clinical_history"),
    technique: text("technique"),
    findings: text("findings"),
    impression: text("impression"),
    recommendation: text("recommendation"),
    abnormalities: jsonb("abnormalities").$type<unknown[]>().default([]),
    activeProtocolName: text("active_protocol_name"),
    // Radiologist
    radiologistId: integer("radiologist_id"),
    radiologistName: text("radiologist_name"),
    status: text("status").notNull().default("draft"), // draft | finalized
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalReportText: text("final_report_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudyUid: index("drafts_study_uid_idx").on(t.studyInstanceUid),
    byStatus: index("drafts_status_idx").on(t.status),
  }),
);

// ── Protocols (indication-specific presets, universal modality field) ───────
export const protocolsTable = pgTable(
  "protocols",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    region: text("region").notNull(),
    modality: text("modality").notNull().default("MRI"),
    checklist: jsonb("checklist").$type<string[]>().default([]),
    techniqueText: text("technique_text"),
    normalText: text("normal_text"),
    recommendationText: text("recommendation_text"),
    requiredMeasurements: jsonb("required_measurements").$type<string[]>().default([]),
    isGoldStandard: boolean("is_gold_standard").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byRegionModality: index("protocols_region_modality_idx").on(t.region, t.modality),
  }),
);

// ── Quick findings (abnormality buttons) ────────────────────────────────────
export const quickFindingsTable = pgTable(
  "quick_findings",
  {
    id: serial("id").primaryKey(),
    studyType: text("study_type").notNull(),
    label: text("label").notNull(),
    findingText: text("finding_text").default(""),
    impressionText: text("impression_text").default(""),
    techniqueText: text("technique_text").default(""),
    recommendationText: text("recommendation_text").default(""),
    tags: text("tags").default(""),
    suggests: text("suggests").default(""),
    properties: text("properties").default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudyType: index("qf_study_type_idx").on(t.studyType),
    byStudyLabel: uniqueIndex("qf_study_label_uq").on(t.studyType, t.label),
  }),
);

// ── Study tabs (regions) ────────────────────────────────────────────────────
export const studyTabsTable = pgTable("study_tabs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  modality: text("modality").notNull().default("MRI"),
  techniqueText: text("technique_text").default(""),
  normalText: text("normal_text").default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ── Learned patterns (per-radiologist) ──────────────────────────────────────
export const learnedPatternsTable = pgTable(
  "learned_patterns",
  {
    id: serial("id").primaryKey(),
    radiologistId: integer("radiologist_id").notNull(),
    triggerLabel: text("trigger_label").notNull(),
    suggestedText: text("suggested_text").notNull(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byRadLabel: index("learned_rad_label_idx").on(t.radiologistId, t.triggerLabel),
  }),
);

// ── Print settings (single row, id=1) ───────────────────────────────────────
export const printSettingsTable = pgTable("print_settings", {
  id: serial("id").primaryKey(),
  hospitalName: text("hospital_name").notNull().default("Hope NeuroTrauma & Multi Speciality Hospital"),
  hospitalTagline: text("hospital_tagline").notNull().default("Saving Brains. Saving Lives. Restoring Hope."),
  hospitalAddress: text("hospital_address").notNull().default("Castairs Town, Near Bajla Mahila College, Deoghar - 814112, Jharkhand"),
  hospitalPhone: text("hospital_phone").notNull().default(""),
  hospitalEmail: text("hospital_email").notNull().default(""),
  logoDataUrl: text("logo_data_url"),
  reportTitle: text("report_title").notNull().default("RADIOLOGY REPORT"),
  layout: jsonb("layout").$type<string[]>().default(["patientBox", "clinicalHistory", "technique", "findings", "impression", "recommendation"]),
  signatureName: text("signature_name").notNull().default("Dr. Abinash Kumar"),
  signatureQualification: text("signature_qualification").notNull().default("MBBS, M.S, M.Ch.(Neurosurgery), FMAS, FIAGES, DNB"),
  signatureRegistrationNo: text("signature_registration_no").notNull().default(""),
  signatureImageDataUrl: text("signature_image_data_url"),
  showQualification: boolean("show_qualification").notNull().default(true),
  showRegistrationNo: boolean("show_registration_no").notNull().default(false),
  footerDisclaimer: text("footer_disclaimer").notNull().default("This report is for diagnostic purposes only. Please correlate with clinical findings."),
  paperSize: text("paper_size").notNull().default("A4"),
  fontSize: text("font_size").notNull().default("medium"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ── AI settings (Ollama) ────────────────────────────────────────────────────
export const aiSettingsTable = pgTable("ai_settings", {
  id: serial("id").primaryKey(),
  ollamaUrl: text("ollama_url").notNull().default("http://localhost:11434"),
  model: text("model").notNull().default("llama3.2"),
  temperature: text("temperature").notNull().default("0.3"),
  maxTokens: integer("max_tokens").notNull().default(1024),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ── Helper: hash a password for seeding ─────────────────────────────────────
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
