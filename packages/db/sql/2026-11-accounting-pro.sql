-- Accounting Pro + Finance cost centres: new columns, accounting tables and role permissions.
-- Existing data is not modified except: treasurer roles gain the Accounting Pro permissions, and
-- an Accountant role is added to each organisation. Run once in the Supabase SQL editor; all-or-nothing.
BEGIN;
CREATE TABLE "org_account_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"account_code" text NOT NULL
);

CREATE TABLE "org_accounting_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"fiscal_year" integer NOT NULL,
	"month" integer NOT NULL,
	"locked_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"fiscal_year" integer NOT NULL,
	"number" text NOT NULL,
	"journal_code" text NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL,
	"transaction_id" integer,
	"account_id" integer,
	"piece_ref" text,
	"piece_date" date,
	"reverses_entry_id" integer,
	"posted_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_journal_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"entry_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"account_code" text NOT NULL,
	"account_label" text NOT NULL,
	"label" text NOT NULL,
	"debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"project_id" integer,
	"analytic" text
);

CREATE TABLE "org_journal_sequences" (
	"org_id" integer NOT NULL,
	"fiscal_year" integer NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "org_ledger_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);










DROP INDEX "org_achievements_org_idx";
DROP INDEX "org_audit_events_entity_idx";
DROP INDEX "org_audit_events_org_created_idx";
DROP INDEX "org_budget_changes_budget_idx";
DROP INDEX "org_budgets_org_idx";
DROP INDEX "org_memberships_org_user_idx";
DROP INDEX "org_memberships_user_idx";
DROP INDEX "org_projects_org_idx";
DROP INDEX "org_committees_org_idx";
DROP INDEX "org_committee_members_membership_idx";
DROP INDEX "org_committee_members_unique_idx";
DROP INDEX "org_events_org_starts_idx";
DROP INDEX "org_files_entity_idx";
DROP INDEX "org_finance_accounts_org_idx";
DROP INDEX "org_invitations_org_idx";
DROP INDEX "org_roles_org_key_idx";
DROP INDEX "org_regions_org_idx";
DROP INDEX "org_member_achievements_unique_idx";
DROP INDEX "org_milestones_project_idx";
DROP INDEX "org_notifications_user_idx";
DROP INDEX "org_point_events_auto_unique_idx";
DROP INDEX "org_point_events_member_idx";
DROP INDEX "org_point_rules_org_key_idx";
DROP INDEX "org_project_members_membership_idx";
DROP INDEX "org_project_members_unique_idx";
DROP INDEX "org_review_cases_org_idx";
DROP INDEX "org_sponsor_projects_unique_idx";
DROP INDEX "org_sponsors_org_idx";
DROP INDEX "org_sponsor_shares_unique_idx";
DROP INDEX "org_sponsor_updates_project_idx";
DROP INDEX "org_task_comments_task_idx";
DROP INDEX "org_tasks_assignee_idx";
DROP INDEX "org_tasks_org_status_idx";
DROP INDEX "org_tasks_project_idx";
DROP INDEX "org_task_dependencies_unique_idx";
DROP INDEX "org_transactions_budget_idx";
DROP INDEX "org_transactions_org_date_idx";
DROP INDEX "org_transactions_org_ref_idx";
DROP INDEX "org_transactions_project_idx";
ALTER TABLE "org_memberships" ALTER COLUMN "skills" SET DEFAULT '{}';
ALTER TABLE "org_roles" ALTER COLUMN "permissions" SET DEFAULT '{}';
ALTER TABLE "org_point_settings" ALTER COLUMN "review_threshold" SET DEFAULT -500;
ALTER TABLE "organisations" ADD COLUMN "legal_name" text;
ALTER TABLE "organisations" ADD COLUMN "ice" text;
ALTER TABLE "organisations" ADD COLUMN "tax_id" text;
ALTER TABLE "organisations" ADD COLUMN "registry_number" text;
ALTER TABLE "organisations" ADD COLUMN "address" text;
ALTER TABLE "org_finance_accounts" ADD COLUMN "ledger_code" text;
ALTER TABLE "org_transactions" ADD COLUMN "cost_center" text;
ALTER TABLE "org_transactions" ADD COLUMN "supplier_ice" text;
ALTER TABLE "org_transactions" ADD COLUMN "supplier_if" text;
ALTER TABLE "org_account_mappings" ADD CONSTRAINT "org_account_mappings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_accounting_locks" ADD CONSTRAINT "org_accounting_locks_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_accounting_locks" ADD CONSTRAINT "org_accounting_locks_locked_by_user_id_users_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_journal_entries" ADD CONSTRAINT "org_journal_entries_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_journal_entries" ADD CONSTRAINT "org_journal_entries_transaction_id_org_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."org_transactions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "org_journal_entries" ADD CONSTRAINT "org_journal_entries_account_id_org_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."org_finance_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "org_journal_entries" ADD CONSTRAINT "org_journal_entries_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_journal_lines" ADD CONSTRAINT "org_journal_lines_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_journal_lines" ADD CONSTRAINT "org_journal_lines_entry_id_org_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."org_journal_entries"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "org_journal_lines" ADD CONSTRAINT "org_journal_lines_project_id_org_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."org_projects"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_journal_sequences" ADD CONSTRAINT "org_journal_sequences_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_ledger_accounts" ADD CONSTRAINT "org_ledger_accounts_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "org_account_mappings_unique_idx" ON "org_account_mappings" USING btree ("org_id","kind","key");
CREATE UNIQUE INDEX "org_accounting_locks_unique_idx" ON "org_accounting_locks" USING btree ("org_id","fiscal_year","month");
CREATE UNIQUE INDEX "org_journal_entries_number_idx" ON "org_journal_entries" USING btree ("org_id","number");
CREATE UNIQUE INDEX "org_journal_entries_tx_idx" ON "org_journal_entries" USING btree ("transaction_id") WHERE transaction_id is not null;
CREATE UNIQUE INDEX "org_journal_entries_opening_idx" ON "org_journal_entries" USING btree ("account_id") WHERE journal_code = 'AN';
CREATE INDEX "org_journal_entries_org_date_idx" ON "org_journal_entries" USING btree ("org_id","date");
CREATE INDEX "org_journal_lines_entry_idx" ON "org_journal_lines" USING btree ("entry_id");
CREATE INDEX "org_journal_lines_org_account_idx" ON "org_journal_lines" USING btree ("org_id","account_code");
CREATE UNIQUE INDEX "org_journal_sequences_pk_idx" ON "org_journal_sequences" USING btree ("org_id","fiscal_year");
CREATE UNIQUE INDEX "org_ledger_accounts_org_code_idx" ON "org_ledger_accounts" USING btree ("org_id","code");
CREATE INDEX "org_achievements_org_idx" ON "org_achievements" USING btree ("org_id");
CREATE INDEX "org_audit_events_entity_idx" ON "org_audit_events" USING btree ("org_id","entity_type","entity_id");
CREATE INDEX "org_audit_events_org_created_idx" ON "org_audit_events" USING btree ("org_id","created_at");
CREATE INDEX "org_budget_changes_budget_idx" ON "org_budget_changes" USING btree ("budget_id");
CREATE INDEX "org_budgets_org_idx" ON "org_budgets" USING btree ("org_id");
CREATE UNIQUE INDEX "org_memberships_org_user_idx" ON "org_memberships" USING btree ("org_id","user_id");
CREATE INDEX "org_memberships_user_idx" ON "org_memberships" USING btree ("user_id");
CREATE INDEX "org_projects_org_idx" ON "org_projects" USING btree ("org_id");
CREATE INDEX "org_committees_org_idx" ON "org_committees" USING btree ("org_id");
CREATE INDEX "org_committee_members_membership_idx" ON "org_committee_members" USING btree ("membership_id");
CREATE UNIQUE INDEX "org_committee_members_unique_idx" ON "org_committee_members" USING btree ("committee_id","membership_id");
CREATE INDEX "org_events_org_starts_idx" ON "org_events" USING btree ("org_id","starts_at");
CREATE INDEX "org_files_entity_idx" ON "org_files" USING btree ("org_id","entity_type","entity_id");
CREATE INDEX "org_finance_accounts_org_idx" ON "org_finance_accounts" USING btree ("org_id");
CREATE INDEX "org_invitations_org_idx" ON "org_invitations" USING btree ("org_id");
CREATE UNIQUE INDEX "org_roles_org_key_idx" ON "org_roles" USING btree ("org_id","key");
CREATE INDEX "org_regions_org_idx" ON "org_regions" USING btree ("org_id");
CREATE UNIQUE INDEX "org_member_achievements_unique_idx" ON "org_member_achievements" USING btree ("achievement_id","membership_id");
CREATE INDEX "org_milestones_project_idx" ON "org_milestones" USING btree ("project_id");
CREATE INDEX "org_notifications_user_idx" ON "org_notifications" USING btree ("user_id","org_id","read_at");
CREATE UNIQUE INDEX "org_point_events_auto_unique_idx" ON "org_point_events" USING btree ("membership_id","rule_key","source_type","source_id") WHERE source_id is not null and rule_key is not null;
CREATE INDEX "org_point_events_member_idx" ON "org_point_events" USING btree ("org_id","membership_id");
CREATE UNIQUE INDEX "org_point_rules_org_key_idx" ON "org_point_rules" USING btree ("org_id","key");
CREATE INDEX "org_project_members_membership_idx" ON "org_project_members" USING btree ("membership_id");
CREATE UNIQUE INDEX "org_project_members_unique_idx" ON "org_project_members" USING btree ("project_id","membership_id");
CREATE INDEX "org_review_cases_org_idx" ON "org_review_cases" USING btree ("org_id","status");
CREATE UNIQUE INDEX "org_sponsor_projects_unique_idx" ON "org_sponsor_projects" USING btree ("sponsor_id","project_id");
CREATE INDEX "org_sponsors_org_idx" ON "org_sponsors" USING btree ("org_id");
CREATE UNIQUE INDEX "org_sponsor_shares_unique_idx" ON "org_sponsor_shares" USING btree ("sponsor_id","entity_type","entity_id");
CREATE INDEX "org_sponsor_updates_project_idx" ON "org_sponsor_updates" USING btree ("org_id","project_id");
CREATE INDEX "org_task_comments_task_idx" ON "org_task_comments" USING btree ("task_id");
CREATE INDEX "org_tasks_assignee_idx" ON "org_tasks" USING btree ("assignee_membership_id");
CREATE INDEX "org_tasks_org_status_idx" ON "org_tasks" USING btree ("org_id","status");
CREATE INDEX "org_tasks_project_idx" ON "org_tasks" USING btree ("project_id");
CREATE UNIQUE INDEX "org_task_dependencies_unique_idx" ON "org_task_dependencies" USING btree ("task_id","depends_on_task_id");
CREATE INDEX "org_transactions_budget_idx" ON "org_transactions" USING btree ("budget_id");
CREATE INDEX "org_transactions_org_date_idx" ON "org_transactions" USING btree ("org_id","date");
CREATE UNIQUE INDEX "org_transactions_org_ref_idx" ON "org_transactions" USING btree ("org_id","reference");
CREATE INDEX "org_transactions_project_idx" ON "org_transactions" USING btree ("project_id");

-- Role templates: treasurers can run Accounting Pro; add a read-only Accountant role.
UPDATE "org_roles" SET "permissions" = array(SELECT DISTINCT unnest("permissions" || ARRAY['accounting.view', 'accounting.manage']))
  WHERE "key" = 'treasurer';
INSERT INTO "org_roles" ("org_id", "key", "name", "description", "permissions", "scope", "is_system")
  SELECT "id", 'accountant', 'Accountant', 'Reviews the books: finance records, Accounting Pro and legal exports (read-only).',
         ARRAY['finance.view', 'finance.export', 'reports.view', 'accounting.view'], 'organisation', true
  FROM "organisations"
  ON CONFLICT ("org_id", "key") DO NOTHING;
COMMIT;
