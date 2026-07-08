CREATE TYPE "public"."application_status" AS ENUM('applied', 'interviewing', 'offer', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."cv_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_offer_id" uuid NOT NULL,
	"cv_version_id" uuid,
	"cover_letter_id" uuid,
	"status" "application_status" DEFAULT 'applied' NOT NULL,
	"applied_at" timestamp,
	"interview_at" timestamp,
	"interview_notes" text,
	"interview_prep" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "applications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cover_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_offer_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"status" "cv_status" DEFAULT 'draft' NOT NULL,
	"pdf_url" text,
	"language" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cover_letters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cover_letters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cv_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job_offer_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"status" "cv_status" DEFAULT 'draft' NOT NULL,
	"pdf_url" text,
	"language" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cv_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cv_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company" text NOT NULL,
	"role" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"raw_description" text NOT NULL,
	"ai_bullets" text[],
	"tags" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "experiences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"raw_text" text NOT NULL,
	"source_url" text,
	"company_parsed" text,
	"role_parsed" text,
	"seniority" text,
	"keywords" text[],
	"requirements_summary" jsonb,
	"language" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_offers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"phone" text,
	"website_url" text,
	"github_url" text,
	"linkedin_url" text,
	"education" jsonb,
	"ai_summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "testimonials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"company" text,
	"role" text,
	"content" text NOT NULL,
	"rating" integer NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "testimonials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "testimonials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_offer_id_job_offers_id_fk" FOREIGN KEY ("job_offer_id") REFERENCES "public"."job_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_cv_version_id_cv_versions_id_fk" FOREIGN KEY ("cv_version_id") REFERENCES "public"."cv_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_cover_letter_id_cover_letters_id_fk" FOREIGN KEY ("cover_letter_id") REFERENCES "public"."cover_letters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_letters" ADD CONSTRAINT "cover_letters_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_letters" ADD CONSTRAINT "cover_letters_job_offer_id_job_offers_id_fk" FOREIGN KEY ("job_offer_id") REFERENCES "public"."job_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_versions" ADD CONSTRAINT "cv_versions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_versions" ADD CONSTRAINT "cv_versions_job_offer_id_job_offers_id_fk" FOREIGN KEY ("job_offer_id") REFERENCES "public"."job_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "applications_isolation" ON "applications" AS PERMISSIVE FOR ALL TO public USING ("applications"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("applications"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "cover_letters_isolation" ON "cover_letters" AS PERMISSIVE FOR ALL TO public USING ("cover_letters"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("cover_letters"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "cv_versions_isolation" ON "cv_versions" AS PERMISSIVE FOR ALL TO public USING ("cv_versions"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("cv_versions"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "experiences_isolation" ON "experiences" AS PERMISSIVE FOR ALL TO public USING ("experiences"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("experiences"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "job_offers_isolation" ON "job_offers" AS PERMISSIVE FOR ALL TO public USING ("job_offers"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("job_offers"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "profiles_isolation" ON "profiles" AS PERMISSIVE FOR ALL TO public USING ("profiles"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("profiles"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "testimonials_select_public_or_own" ON "testimonials" AS PERMISSIVE FOR SELECT TO public USING ("testimonials"."approved" = true OR "testimonials"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "testimonials_insert_own" ON "testimonials" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("testimonials"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "testimonials_update_own" ON "testimonials" AS PERMISSIVE FOR UPDATE TO public USING ("testimonials"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("testimonials"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "testimonials_delete_own" ON "testimonials" AS PERMISSIVE FOR DELETE TO public USING ("testimonials"."user_id" = current_setting('app.current_user_id', true));