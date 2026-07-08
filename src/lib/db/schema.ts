import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// RLS: każda tabela porównuje user_id z session variable ustawianą per-request
// wewnątrz transakcji (`SET LOCAL app.current_user_id = $1`) — patrz src/lib/db/scoped.ts
// i docs/architecture.md sekcja 2/23. Druga warstwa (helper wymuszający .where(userId)
// w kodzie) nie zastępuje tego — to niezależne linie obrony.
function ownRowPolicy(policyName: string, userIdColumn: AnyPgColumn) {
  return pgPolicy(policyName, {
    for: "all",
    using: sql`${userIdColumn} = current_setting('app.current_user_id', true)`,
    withCheck: sql`${userIdColumn} = current_setting('app.current_user_id', true)`,
  });
}

// --- Better Auth (user/session/account/verification) ---
// Kształt pól zweryfikowany ze źródła @better-auth/core (getAuthTables), nie zgadywany.
// Domyślne id Better Auth to losowy string generowany w aplikacji (nie DB uuid) —
// stąd `text`, nie `uuid`, jako typ id i wszystkich FK do user.id.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: "date" }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    mode: "date",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

// --- Domena aplikacji (docs/architecture.md sekcja 2, 9, 18) ---
// `experiences.embedding` (RAG/pgvector) świadomie pominięte na tym etapie —
// patrz DECISIONS.md "RAG odłożone do fazy skalowania", dochodzi w Kroku 6.

export const cvStatus = pgEnum("cv_status", ["draft", "approved"]);
export const applicationStatus = pgEnum("application_status", [
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
]);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text("phone"),
    websiteUrl: text("website_url"),
    githubUrl: text("github_url"),
    linkedinUrl: text("linkedin_url"),
    education:
      jsonb("education").$type<
        Array<{ school: string; degree: string; from: string; to: string }>
      >(),
    aiSummary: text("ai_summary"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [ownRowPolicy("profiles_isolation", t.userId)],
).enableRLS();

export const experiences = pgTable(
  "experiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    company: text("company").notNull(),
    role: text("role").notNull(),
    startDate: timestamp("start_date", { mode: "date" }).notNull(),
    endDate: timestamp("end_date", { mode: "date" }),
    rawDescription: text("raw_description").notNull(),
    aiBullets: text("ai_bullets").array(),
    tags: text("tags").array(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [ownRowPolicy("experiences_isolation", t.userId)],
).enableRLS();

export const jobOffers = pgTable(
  "job_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rawText: text("raw_text").notNull(),
    sourceUrl: text("source_url"),
    companyParsed: text("company_parsed"),
    roleParsed: text("role_parsed"),
    seniority: text("seniority"),
    keywords: text("keywords").array(),
    requirementsSummary: jsonb("requirements_summary"),
    language: text("language"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [ownRowPolicy("job_offers_isolation", t.userId)],
).enableRLS();

export const cvVersions = pgTable(
  "cv_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    jobOfferId: uuid("job_offer_id")
      .notNull()
      .references(() => jobOffers.id, { onDelete: "cascade" }),
    content: jsonb("content").notNull(),
    status: cvStatus("status").notNull().default("draft"),
    pdfUrl: text("pdf_url"),
    language: text("language"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [ownRowPolicy("cv_versions_isolation", t.userId)],
).enableRLS();

export const coverLetters = pgTable(
  "cover_letters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    jobOfferId: uuid("job_offer_id")
      .notNull()
      .references(() => jobOffers.id, { onDelete: "cascade" }),
    content: jsonb("content").notNull(),
    status: cvStatus("status").notNull().default("draft"),
    pdfUrl: text("pdf_url"),
    language: text("language"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [ownRowPolicy("cover_letters_isolation", t.userId)],
).enableRLS();

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    jobOfferId: uuid("job_offer_id")
      .notNull()
      .references(() => jobOffers.id, { onDelete: "cascade" }),
    cvVersionId: uuid("cv_version_id").references(() => cvVersions.id, {
      onDelete: "set null",
    }),
    coverLetterId: uuid("cover_letter_id").references(() => coverLetters.id, {
      onDelete: "set null",
    }),
    status: applicationStatus("status").notNull().default("applied"),
    appliedAt: timestamp("applied_at", { mode: "date" }),
    interviewAt: timestamp("interview_at", { mode: "date" }),
    interviewNotes: text("interview_notes"),
    interviewPrep: jsonb("interview_prep"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [ownRowPolicy("applications_isolation", t.userId)],
).enableRLS();

export const testimonials = pgTable(
  "testimonials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    company: text("company"),
    role: text("role"),
    content: text("content").notNull(),
    rating: integer("rating").notNull(),
    approved: boolean("approved").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Publiczna strona główna czyta tylko zaakceptowane opinie (dowolny user,
    // nawet niezalogowany — current_setting zwróci '' i nie dopasuje żadnego
    // wiersza po userId); właściciel zawsze widzi/zarządza własnym wpisem.
    pgPolicy("testimonials_select_public_or_own", {
      for: "select",
      using: sql`${t.approved} = true OR ${t.userId} = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy("testimonials_insert_own", {
      for: "insert",
      withCheck: sql`${t.userId} = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy("testimonials_update_own", {
      for: "update",
      using: sql`${t.userId} = current_setting('app.current_user_id', true)`,
      withCheck: sql`${t.userId} = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy("testimonials_delete_own", {
      for: "delete",
      using: sql`${t.userId} = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();
