-- Organisation workspace tables (manage/ app): creates the new org_* tables and enums only.
-- Existing tables are not touched. Run once in the Supabase SQL editor; it is all-or-nothing.
BEGIN;
CREATE TYPE "public"."org_budget_change_status" AS ENUM('pending', 'approved', 'rejected');
CREATE TYPE "public"."org_budget_status" AS ENUM('draft', 'approved', 'closed');
CREATE TYPE "public"."org_committee_kind" AS ENUM('committee', 'governance', 'working_group');
CREATE TYPE "public"."org_committee_role" AS ENUM('head', 'member');
CREATE TYPE "public"."org_event_status" AS ENUM('planned', 'confirmed', 'completed', 'cancelled');
CREATE TYPE "public"."org_event_type" AS ENUM('meeting', 'workshop', 'conference', 'forum', 'training', 'campaign', 'other');
CREATE TYPE "public"."org_finance_account_kind" AS ENUM('bank', 'cash', 'mobile_money', 'other');
CREATE TYPE "public"."org_membership_status" AS ENUM('active', 'inactive', 'suspended', 'left');
CREATE TYPE "public"."org_priority" AS ENUM('low', 'medium', 'high', 'urgent');
CREATE TYPE "public"."org_project_role" AS ENUM('manager', 'member');
CREATE TYPE "public"."org_project_status" AS ENUM('draft', 'planned', 'active', 'on_hold', 'completed', 'cancelled');
CREATE TYPE "public"."org_region_kind" AS ENUM('region', 'province', 'local', 'diaspora');
CREATE TYPE "public"."org_review_case_status" AS ENUM('open', 'responded', 'resolved');
CREATE TYPE "public"."org_role_scope" AS ENUM('organisation', 'committee', 'region', 'assigned');
CREATE TYPE "public"."org_status" AS ENUM('active', 'suspended');
CREATE TYPE "public"."org_task_comment_kind" AS ENUM('comment', 'evidence', 'review_approved', 'review_returned');
CREATE TYPE "public"."org_task_status" AS ENUM('backlog', 'todo', 'in_progress', 'in_review', 'completed', 'blocked', 'cancelled');
CREATE TYPE "public"."org_transaction_kind" AS ENUM('income', 'expense', 'reversal');
CREATE TYPE "public"."org_transaction_status" AS ENUM('expected', 'submitted', 'approved', 'paid', 'received', 'posted', 'rejected', 'cancelled');
CREATE TABLE "org_achievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'award' NOT NULL,
	"color" text,
	"auto_rule" jsonb,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"actor_user_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"summary" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_budget_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"budget_id" integer NOT NULL,
	"previous_amount" numeric(14, 2) NOT NULL,
	"new_amount" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" "org_budget_change_status" DEFAULT 'pending' NOT NULL,
	"requested_by_membership_id" integer,
	"decided_by_membership_id" integer,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"project_id" integer,
	"committee_id" integer,
	"owner_membership_id" integer,
	"period_start" date,
	"period_end" date,
	"approved_amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'MAD' NOT NULL,
	"status" "org_budget_status" DEFAULT 'draft' NOT NULL,
	"created_by_membership_id" integer,
	"approved_by_membership_id" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_committee_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"committee_id" integer NOT NULL,
	"membership_id" integer NOT NULL,
	"role" "org_committee_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_committees" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" "org_committee_kind" DEFAULT 'committee' NOT NULL,
	"color" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"project_id" integer,
	"committee_id" integer,
	"organiser_membership_id" integer,
	"title" text NOT NULL,
	"type" "org_event_type" DEFAULT 'meeting' NOT NULL,
	"status" "org_event_status" DEFAULT 'planned' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"venue" text,
	"online_url" text,
	"expected_attendance" integer,
	"actual_attendance" integer,
	"agenda" text,
	"report" text,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"uploaded_by_user_id" integer,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_finance_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" "org_finance_account_kind" DEFAULT 'bank' NOT NULL,
	"currency" text DEFAULT 'MAD' NOT NULL,
	"institution" text,
	"opening_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reconciled_through" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"email" text NOT NULL,
	"role_id" integer NOT NULL,
	"region_id" integer,
	"committee_id" integer,
	"sponsor_id" integer,
	"title" text,
	"token_hash" text NOT NULL,
	"invited_by_id" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_invitations_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE "org_member_achievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"achievement_id" integer NOT NULL,
	"membership_id" integer NOT NULL,
	"reason" text,
	"awarded_by_user_id" integer,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"status" "org_membership_status" DEFAULT 'active' NOT NULL,
	"title" text,
	"region_id" integer,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"sponsor_id" integer,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_point_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"membership_id" integer NOT NULL,
	"rule_key" text,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" integer,
	"evidence_url" text,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_point_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"key" text NOT NULL,
	"points" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);

CREATE TABLE "org_point_settings" (
	"org_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"inactivity_days" integer DEFAULT 90 NOT NULL,
	"review_threshold" integer DEFAULT -500 NOT NULL,
	"missed_deadline_grace_days" integer DEFAULT 2 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_project_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"membership_id" integer NOT NULL,
	"role" "org_project_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"committee_id" integer,
	"owner_membership_id" integer,
	"title" text NOT NULL,
	"description" text,
	"objective" text,
	"status" "org_project_status" DEFAULT 'planned' NOT NULL,
	"priority" "org_priority" DEFAULT 'medium' NOT NULL,
	"start_date" date,
	"end_date" date,
	"location" text,
	"risks" text,
	"final_report" text,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"kind" "org_region_kind" DEFAULT 'region' NOT NULL,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_review_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"membership_id" integer NOT NULL,
	"trigger" text NOT NULL,
	"detail" text,
	"status" "org_review_case_status" DEFAULT 'open' NOT NULL,
	"member_response" text,
	"responded_at" timestamp with time zone,
	"decision" text,
	"decision_note" text,
	"decided_by_user_id" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"scope" "org_role_scope" DEFAULT 'assigned' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_sponsor_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"sponsor_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"committed_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'MAD' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_sponsor_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"sponsor_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"shared_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_sponsor_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'project_sponsors' NOT NULL,
	"sponsor_ids" integer[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_membership_id" integer,
	"published_by_membership_id" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_sponsors" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"website" text,
	"contact_name" text,
	"contact_email" text,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_task_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"author_membership_id" integer,
	"kind" "org_task_comment_kind" DEFAULT 'comment' NOT NULL,
	"body" text,
	"url" text,
	"file_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_task_dependencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"depends_on_task_id" integer NOT NULL
);

CREATE TABLE "org_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"project_id" integer,
	"event_id" integer,
	"milestone_id" integer,
	"title" text NOT NULL,
	"description" text,
	"definition_of_done" text,
	"status" "org_task_status" DEFAULT 'todo' NOT NULL,
	"priority" "org_priority" DEFAULT 'medium' NOT NULL,
	"assignee_membership_id" integer,
	"reviewer_membership_id" integer,
	"due_date" date,
	"evidence_required" boolean DEFAULT false NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_membership_id" integer,
	"validated_at" timestamp with time zone,
	"validated_by_membership_id" integer,
	"completed_at" timestamp with time zone,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "org_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"reference" text NOT NULL,
	"kind" "org_transaction_kind" NOT NULL,
	"direction" text NOT NULL,
	"status" "org_transaction_status" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'MAD' NOT NULL,
	"date" date NOT NULL,
	"account_id" integer,
	"budget_id" integer,
	"project_id" integer,
	"committee_id" integer,
	"sponsor_id" integer,
	"category" text,
	"counterparty" text,
	"description" text NOT NULL,
	"funding_type" text,
	"external_reference" text,
	"requested_by_membership_id" integer,
	"approved_by_membership_id" integer,
	"approved_at" timestamp with time zone,
	"posted_by_membership_id" integer,
	"posted_at" timestamp with time zone,
	"rejection_reason" text,
	"reverses_id" integer,
	"reversed_by_id" integer,
	"reconciled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "organisations" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"logo_url" text,
	"primary_color" text,
	"default_language" text DEFAULT 'en' NOT NULL,
	"currency" text DEFAULT 'MAD' NOT NULL,
	"timezone" text DEFAULT 'Africa/Casablanca' NOT NULL,
	"country" text DEFAULT 'MA' NOT NULL,
	"status" "org_status" DEFAULT 'active' NOT NULL,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);



ALTER TABLE "org_achievements" ADD CONSTRAINT "org_achievements_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_audit_events" ADD CONSTRAINT "org_audit_events_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_audit_events" ADD CONSTRAINT "org_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_budget_changes" ADD CONSTRAINT "org_budget_changes_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_budget_changes" ADD CONSTRAINT "org_budget_changes_budget_id_org_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."org_budgets"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_budget_changes" ADD CONSTRAINT "org_budget_changes_requested_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("requested_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_budget_changes" ADD CONSTRAINT "org_budget_changes_decided_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("decided_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_budgets" ADD CONSTRAINT "org_budgets_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_budgets" ADD CONSTRAINT "org_budgets_project_id_org_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."org_projects"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_budgets" ADD CONSTRAINT "org_budgets_committee_id_org_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."org_committees"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_budgets" ADD CONSTRAINT "org_budgets_owner_membership_id_org_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_budgets" ADD CONSTRAINT "org_budgets_created_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_budgets" ADD CONSTRAINT "org_budgets_approved_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_committee_members" ADD CONSTRAINT "org_committee_members_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_committee_members" ADD CONSTRAINT "org_committee_members_committee_id_org_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."org_committees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_committee_members" ADD CONSTRAINT "org_committee_members_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_committees" ADD CONSTRAINT "org_committees_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_project_id_org_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."org_projects"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_committee_id_org_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."org_committees"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_organiser_membership_id_org_memberships_id_fk" FOREIGN KEY ("organiser_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_files" ADD CONSTRAINT "org_files_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_files" ADD CONSTRAINT "org_files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_finance_accounts" ADD CONSTRAINT "org_finance_accounts_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_role_id_org_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."org_roles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_region_id_org_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."org_regions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_member_achievements" ADD CONSTRAINT "org_member_achievements_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_member_achievements" ADD CONSTRAINT "org_member_achievements_achievement_id_org_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."org_achievements"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_member_achievements" ADD CONSTRAINT "org_member_achievements_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_member_achievements" ADD CONSTRAINT "org_member_achievements_awarded_by_user_id_users_id_fk" FOREIGN KEY ("awarded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_role_id_org_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."org_roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_region_id_org_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."org_regions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_milestones" ADD CONSTRAINT "org_milestones_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_milestones" ADD CONSTRAINT "org_milestones_project_id_org_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."org_projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_notifications" ADD CONSTRAINT "org_notifications_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_notifications" ADD CONSTRAINT "org_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_point_events" ADD CONSTRAINT "org_point_events_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_point_events" ADD CONSTRAINT "org_point_events_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_point_events" ADD CONSTRAINT "org_point_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_point_rules" ADD CONSTRAINT "org_point_rules_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_point_settings" ADD CONSTRAINT "org_point_settings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_project_members" ADD CONSTRAINT "org_project_members_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_project_members" ADD CONSTRAINT "org_project_members_project_id_org_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."org_projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_project_members" ADD CONSTRAINT "org_project_members_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_projects" ADD CONSTRAINT "org_projects_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_projects" ADD CONSTRAINT "org_projects_committee_id_org_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."org_committees"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_projects" ADD CONSTRAINT "org_projects_owner_membership_id_org_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_projects" ADD CONSTRAINT "org_projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_regions" ADD CONSTRAINT "org_regions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_review_cases" ADD CONSTRAINT "org_review_cases_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_review_cases" ADD CONSTRAINT "org_review_cases_membership_id_org_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_review_cases" ADD CONSTRAINT "org_review_cases_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_roles" ADD CONSTRAINT "org_roles_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_sponsor_projects" ADD CONSTRAINT "org_sponsor_projects_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_sponsor_projects" ADD CONSTRAINT "org_sponsor_projects_sponsor_id_org_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."org_sponsors"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_sponsor_projects" ADD CONSTRAINT "org_sponsor_projects_project_id_org_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."org_projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_sponsor_shares" ADD CONSTRAINT "org_sponsor_shares_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_sponsor_shares" ADD CONSTRAINT "org_sponsor_shares_sponsor_id_org_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."org_sponsors"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_sponsor_shares" ADD CONSTRAINT "org_sponsor_shares_shared_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("shared_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_sponsor_updates" ADD CONSTRAINT "org_sponsor_updates_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_sponsor_updates" ADD CONSTRAINT "org_sponsor_updates_project_id_org_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."org_projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_sponsor_updates" ADD CONSTRAINT "org_sponsor_updates_created_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_sponsor_updates" ADD CONSTRAINT "org_sponsor_updates_published_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("published_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_sponsors" ADD CONSTRAINT "org_sponsors_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_task_comments" ADD CONSTRAINT "org_task_comments_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_task_comments" ADD CONSTRAINT "org_task_comments_task_id_org_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."org_tasks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_task_comments" ADD CONSTRAINT "org_task_comments_author_membership_id_org_memberships_id_fk" FOREIGN KEY ("author_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_task_dependencies" ADD CONSTRAINT "org_task_dependencies_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_task_dependencies" ADD CONSTRAINT "org_task_dependencies_task_id_org_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."org_tasks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_task_dependencies" ADD CONSTRAINT "org_task_dependencies_depends_on_task_id_org_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."org_tasks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_project_id_org_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."org_projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_event_id_org_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."org_events"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_milestone_id_org_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."org_milestones"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_assignee_membership_id_org_memberships_id_fk" FOREIGN KEY ("assignee_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_reviewer_membership_id_org_memberships_id_fk" FOREIGN KEY ("reviewer_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_submitted_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("submitted_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_validated_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("validated_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_created_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_transactions" ADD CONSTRAINT "org_transactions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "org_transactions" ADD CONSTRAINT "org_transactions_account_id_org_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."org_finance_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "org_transactions" ADD CONSTRAINT "org_transactions_budget_id_org_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."org_budgets"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "org_transactions" ADD CONSTRAINT "org_transactions_project_id_org_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."org_projects"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_transactions" ADD CONSTRAINT "org_transactions_committee_id_org_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."org_committees"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_transactions" ADD CONSTRAINT "org_transactions_requested_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("requested_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_transactions" ADD CONSTRAINT "org_transactions_approved_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "org_transactions" ADD CONSTRAINT "org_transactions_posted_by_membership_id_org_memberships_id_fk" FOREIGN KEY ("posted_by_membership_id") REFERENCES "public"."org_memberships"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "org_achievements_org_idx" ON "org_achievements" USING btree ("org_id");
CREATE INDEX "org_audit_events_org_created_idx" ON "org_audit_events" USING btree ("org_id","created_at");
CREATE INDEX "org_audit_events_entity_idx" ON "org_audit_events" USING btree ("org_id","entity_type","entity_id");
CREATE INDEX "org_budget_changes_budget_idx" ON "org_budget_changes" USING btree ("budget_id");
CREATE INDEX "org_budgets_org_idx" ON "org_budgets" USING btree ("org_id");
CREATE UNIQUE INDEX "org_committee_members_unique_idx" ON "org_committee_members" USING btree ("committee_id","membership_id");
CREATE INDEX "org_committee_members_membership_idx" ON "org_committee_members" USING btree ("membership_id");
CREATE INDEX "org_committees_org_idx" ON "org_committees" USING btree ("org_id");
CREATE INDEX "org_events_org_starts_idx" ON "org_events" USING btree ("org_id","starts_at");
CREATE INDEX "org_files_entity_idx" ON "org_files" USING btree ("org_id","entity_type","entity_id");
CREATE INDEX "org_finance_accounts_org_idx" ON "org_finance_accounts" USING btree ("org_id");
CREATE INDEX "org_invitations_org_idx" ON "org_invitations" USING btree ("org_id");
CREATE UNIQUE INDEX "org_member_achievements_unique_idx" ON "org_member_achievements" USING btree ("achievement_id","membership_id");
CREATE UNIQUE INDEX "org_memberships_org_user_idx" ON "org_memberships" USING btree ("org_id","user_id");
CREATE INDEX "org_memberships_user_idx" ON "org_memberships" USING btree ("user_id");
CREATE INDEX "org_milestones_project_idx" ON "org_milestones" USING btree ("project_id");
CREATE INDEX "org_notifications_user_idx" ON "org_notifications" USING btree ("user_id","org_id","read_at");
CREATE INDEX "org_point_events_member_idx" ON "org_point_events" USING btree ("org_id","membership_id");
CREATE UNIQUE INDEX "org_point_events_auto_unique_idx" ON "org_point_events" USING btree ("membership_id","rule_key","source_type","source_id") WHERE source_id is not null and rule_key is not null;
CREATE UNIQUE INDEX "org_point_rules_org_key_idx" ON "org_point_rules" USING btree ("org_id","key");
CREATE UNIQUE INDEX "org_project_members_unique_idx" ON "org_project_members" USING btree ("project_id","membership_id");
CREATE INDEX "org_project_members_membership_idx" ON "org_project_members" USING btree ("membership_id");
CREATE INDEX "org_projects_org_idx" ON "org_projects" USING btree ("org_id");
CREATE INDEX "org_regions_org_idx" ON "org_regions" USING btree ("org_id");
CREATE INDEX "org_review_cases_org_idx" ON "org_review_cases" USING btree ("org_id","status");
CREATE UNIQUE INDEX "org_roles_org_key_idx" ON "org_roles" USING btree ("org_id","key");
CREATE UNIQUE INDEX "org_sponsor_projects_unique_idx" ON "org_sponsor_projects" USING btree ("sponsor_id","project_id");
CREATE UNIQUE INDEX "org_sponsor_shares_unique_idx" ON "org_sponsor_shares" USING btree ("sponsor_id","entity_type","entity_id");
CREATE INDEX "org_sponsor_updates_project_idx" ON "org_sponsor_updates" USING btree ("org_id","project_id");
CREATE INDEX "org_sponsors_org_idx" ON "org_sponsors" USING btree ("org_id");
CREATE INDEX "org_task_comments_task_idx" ON "org_task_comments" USING btree ("task_id");
CREATE UNIQUE INDEX "org_task_dependencies_unique_idx" ON "org_task_dependencies" USING btree ("task_id","depends_on_task_id");
CREATE INDEX "org_tasks_org_status_idx" ON "org_tasks" USING btree ("org_id","status");
CREATE INDEX "org_tasks_project_idx" ON "org_tasks" USING btree ("project_id");
CREATE INDEX "org_tasks_assignee_idx" ON "org_tasks" USING btree ("assignee_membership_id");
CREATE UNIQUE INDEX "org_transactions_org_ref_idx" ON "org_transactions" USING btree ("org_id","reference");
CREATE INDEX "org_transactions_org_date_idx" ON "org_transactions" USING btree ("org_id","date");
CREATE INDEX "org_transactions_budget_idx" ON "org_transactions" USING btree ("budget_id");
CREATE INDEX "org_transactions_project_idx" ON "org_transactions" USING btree ("project_id");
COMMIT;
