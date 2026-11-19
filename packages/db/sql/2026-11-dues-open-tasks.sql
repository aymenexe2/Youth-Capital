-- Membership dues (joining 100 MAD + annual 200 MAD by default, editable per organisation),
-- the per-year dues ledger behind the "verified member" badge, and open (claimable) tasks.
-- Existing data is not modified. Run once in the Supabase SQL editor; all-or-nothing.
BEGIN;

ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "joining_fee" numeric(14, 2) DEFAULT '100' NOT NULL;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "annual_fee" numeric(14, 2) DEFAULT '200' NOT NULL;

ALTER TABLE "org_tasks" ADD COLUMN IF NOT EXISTS "open_to_claim" boolean DEFAULT false NOT NULL;
ALTER TABLE "org_tasks" ADD COLUMN IF NOT EXISTS "claim_committee_id" integer;
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_claim_committee_id_org_committees_id_fk"
  FOREIGN KEY ("claim_committee_id") REFERENCES "public"."org_committees"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE IF NOT EXISTS "org_membership_dues" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"membership_id" integer NOT NULL,
	"year" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"includes_joining_fee" boolean DEFAULT false NOT NULL,
	"method" text,
	"reference" text,
	"note" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "org_membership_dues" ADD CONSTRAINT "org_membership_dues_org_id_organisations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_membership_dues" ADD CONSTRAINT "org_membership_dues_membership_id_org_memberships_id_fk"
  FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_membership_dues" ADD CONSTRAINT "org_membership_dues_recorded_by_membership_id_org_memberships_id_fk"
  FOREIGN KEY ("recorded_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
CREATE UNIQUE INDEX IF NOT EXISTS "org_membership_dues_member_year_idx" ON "org_membership_dues" USING btree ("membership_id", "year");
CREATE INDEX IF NOT EXISTS "org_membership_dues_org_year_idx" ON "org_membership_dues" USING btree ("org_id", "year");

COMMIT;
