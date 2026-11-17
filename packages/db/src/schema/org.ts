import {
  pgTable, text, serial, integer, timestamp, pgEnum, boolean, date, jsonb, index, uniqueIndex, doublePrecision, customType, numeric,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users.js";

// Organisation management platform (the "workspace" app). Multi-tenant: every
// tenant-owned table carries orgId, and the API scopes every query by it —
// a membership row is what grants a user access to an organisation at all.
// Timestamps here are timezone-aware so they can be shown in each
// organisation's configured timezone.

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const orgStatusEnum = pgEnum("org_status", ["active", "suspended"]);
export const orgRoleScopeEnum = pgEnum("org_role_scope", ["organisation", "committee", "region", "assigned"]);
export const orgMembershipStatusEnum = pgEnum("org_membership_status", ["active", "inactive", "suspended", "left"]);
export const orgCommitteeKindEnum = pgEnum("org_committee_kind", ["committee", "governance", "working_group"]);
export const orgCommitteeRoleEnum = pgEnum("org_committee_role", ["head", "member"]);
export const orgRegionKindEnum = pgEnum("org_region_kind", ["region", "province", "local", "diaspora"]);
export const orgProjectStatusEnum = pgEnum("org_project_status", ["draft", "planned", "active", "on_hold", "completed", "cancelled"]);
export const orgPriorityEnum = pgEnum("org_priority", ["low", "medium", "high", "urgent"]);
export const orgProjectRoleEnum = pgEnum("org_project_role", ["manager", "member"]);
export const orgEventTypeEnum = pgEnum("org_event_type", ["meeting", "workshop", "conference", "forum", "training", "campaign", "other"]);
export const orgEventStatusEnum = pgEnum("org_event_status", ["planned", "confirmed", "completed", "cancelled"]);
export const orgTaskStatusEnum = pgEnum("org_task_status", ["backlog", "todo", "in_progress", "in_review", "completed", "blocked", "cancelled"]);
export const orgTaskCommentKindEnum = pgEnum("org_task_comment_kind", ["comment", "evidence", "review_approved", "review_returned"]);

export const organisationsTable = pgTable("organisations", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  defaultLanguage: text("default_language").notNull().default("en"),
  currency: text("currency").notNull().default("MAD"),
  timezone: text("timezone").notNull().default("Africa/Casablanca"),
  country: text("country").notNull().default("MA"),
  status: orgStatusEnum("status").notNull().default("active"),
  // Legal identity for accounting documents (Morocco: ICE, IF, RC).
  legalName: text("legal_name"),
  ice: text("ice"),
  taxId: text("tax_id"),
  registryNumber: text("registry_number"),
  address: text("address"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// Roles are per-organisation templates: a permission list plus the scope those
// permissions apply within. System roles are seeded on creation and can be
// edited but not deleted (org_admin's permissions are fixed).
export const orgRolesTable = pgTable("org_roles", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  permissions: text("permissions").array().notNull().default([]),
  scope: orgRoleScopeEnum("scope").notNull().default("assigned"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("org_roles_org_key_idx").on(t.orgId, t.key)]);

// Geographic structure: regions → provinces → local units, via parentId.
export const orgRegionsTable = pgTable("org_regions", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  parentId: integer("parent_id"),
  name: text("name").notNull(),
  kind: orgRegionKindEnum("kind").notNull().default("region"),
  code: text("code"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_regions_org_idx").on(t.orgId)]);

export const orgMembershipsTable = pgTable("org_memberships", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  roleId: integer("role_id").notNull().references(() => orgRolesTable.id),
  status: orgMembershipStatusEnum("status").notNull().default("active"),
  // Position held in the organisation's own vocabulary, e.g. "Regional Coordinator".
  title: text("title"),
  regionId: integer("region_id").references(() => orgRegionsTable.id, { onDelete: "set null" }),
  skills: text("skills").array().notNull().default([]),
  // Set for sponsor-portal accounts: the sponsor this contact represents.
  sponsorId: integer("sponsor_id"),
  joinedAt: ts("joined_at").notNull().defaultNow(),
  lastActiveAt: ts("last_active_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("org_memberships_org_user_idx").on(t.orgId, t.userId),
  index("org_memberships_user_idx").on(t.userId),
]);

// Only a hash of the invitation token is stored; the raw token is emailed once.
export const orgInvitationsTable = pgTable("org_invitations", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  roleId: integer("role_id").notNull().references(() => orgRolesTable.id, { onDelete: "cascade" }),
  regionId: integer("region_id").references(() => orgRegionsTable.id, { onDelete: "set null" }),
  committeeId: integer("committee_id"),
  sponsorId: integer("sponsor_id"),
  title: text("title"),
  tokenHash: text("token_hash").notNull().unique(),
  invitedById: integer("invited_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_invitations_org_idx").on(t.orgId)]);

export const orgCommitteesTable = pgTable("org_committees", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  kind: orgCommitteeKindEnum("kind").notNull().default("committee"),
  color: text("color"),
  archivedAt: ts("archived_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_committees_org_idx").on(t.orgId)]);

export const orgCommitteeMembersTable = pgTable("org_committee_members", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  committeeId: integer("committee_id").notNull().references(() => orgCommitteesTable.id, { onDelete: "cascade" }),
  membershipId: integer("membership_id").notNull().references(() => orgMembershipsTable.id, { onDelete: "cascade" }),
  role: orgCommitteeRoleEnum("role").notNull().default("member"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("org_committee_members_unique_idx").on(t.committeeId, t.membershipId),
  index("org_committee_members_membership_idx").on(t.membershipId),
]);

export const orgProjectsTable = pgTable("org_projects", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  committeeId: integer("committee_id").references(() => orgCommitteesTable.id, { onDelete: "set null" }),
  ownerMembershipId: integer("owner_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  objective: text("objective"),
  status: orgProjectStatusEnum("status").notNull().default("planned"),
  priority: orgPriorityEnum("priority").notNull().default("medium"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  location: text("location"),
  risks: text("risks"),
  finalReport: text("final_report"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("org_projects_org_idx").on(t.orgId)]);

export const orgProjectMembersTable = pgTable("org_project_members", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => orgProjectsTable.id, { onDelete: "cascade" }),
  membershipId: integer("membership_id").notNull().references(() => orgMembershipsTable.id, { onDelete: "cascade" }),
  role: orgProjectRoleEnum("role").notNull().default("member"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("org_project_members_unique_idx").on(t.projectId, t.membershipId),
  index("org_project_members_membership_idx").on(t.membershipId),
]);

export const orgMilestonesTable = pgTable("org_milestones", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => orgProjectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  dueDate: date("due_date"),
  completedAt: ts("completed_at"),
  position: integer("position").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_milestones_project_idx").on(t.projectId)]);

export const orgEventsTable = pgTable("org_events", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => orgProjectsTable.id, { onDelete: "set null" }),
  committeeId: integer("committee_id").references(() => orgCommitteesTable.id, { onDelete: "set null" }),
  organiserMembershipId: integer("organiser_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  type: orgEventTypeEnum("type").notNull().default("meeting"),
  status: orgEventStatusEnum("status").notNull().default("planned"),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at"),
  venue: text("venue"),
  onlineUrl: text("online_url"),
  expectedAttendance: integer("expected_attendance"),
  actualAttendance: integer("actual_attendance"),
  agenda: text("agenda"),
  report: text("report"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("org_events_org_starts_idx").on(t.orgId, t.startsAt)]);

export const orgTasksTable = pgTable("org_tasks", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => orgProjectsTable.id, { onDelete: "cascade" }),
  eventId: integer("event_id").references(() => orgEventsTable.id, { onDelete: "set null" }),
  milestoneId: integer("milestone_id").references(() => orgMilestonesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  definitionOfDone: text("definition_of_done"),
  status: orgTaskStatusEnum("status").notNull().default("todo"),
  priority: orgPriorityEnum("priority").notNull().default("medium"),
  assigneeMembershipId: integer("assignee_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  reviewerMembershipId: integer("reviewer_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  dueDate: date("due_date"),
  evidenceRequired: boolean("evidence_required").notNull().default(false),
  // Kanban ordering within a status column.
  position: doublePrecision("position").notNull().default(0),
  submittedAt: ts("submitted_at"),
  submittedByMembershipId: integer("submitted_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  validatedAt: ts("validated_at"),
  validatedByMembershipId: integer("validated_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  completedAt: ts("completed_at"),
  createdByMembershipId: integer("created_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  index("org_tasks_org_status_idx").on(t.orgId, t.status),
  index("org_tasks_project_idx").on(t.projectId),
  index("org_tasks_assignee_idx").on(t.assigneeMembershipId),
]);

export const orgTaskDependenciesTable = pgTable("org_task_dependencies", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => orgTasksTable.id, { onDelete: "cascade" }),
  dependsOnTaskId: integer("depends_on_task_id").notNull().references(() => orgTasksTable.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("org_task_dependencies_unique_idx").on(t.taskId, t.dependsOnTaskId)]);

// Comments, evidence and review decisions share one timeline per task.
export const orgTaskCommentsTable = pgTable("org_task_comments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => orgTasksTable.id, { onDelete: "cascade" }),
  authorMembershipId: integer("author_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  kind: orgTaskCommentKindEnum("kind").notNull().default("comment"),
  body: text("body"),
  url: text("url"),
  fileId: integer("file_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_task_comments_task_idx").on(t.taskId)]);

// Append-only: the API never updates or deletes these rows. Records actor,
// before/after values and a reason for important changes and approvals.
export const orgAuditEventsTable = pgTable("org_audit_events", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  summary: text("summary"),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("org_audit_events_org_created_idx").on(t.orgId, t.createdAt),
  index("org_audit_events_entity_idx").on(t.orgId, t.entityType, t.entityId),
]);

export const orgNotificationsTable = pgTable("org_notifications", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  readAt: ts("read_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_notifications_user_idx").on(t.userId, t.orgId, t.readAt)]);

// ── Private files ───────────────────────────────────────────────────────────
// Evidence and documents are stored in Postgres (not a public CDN) and only
// served through an access-checked endpoint. Small files only (4 MB cap).
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const orgFilesTable = pgTable("org_files", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  data: bytea("data").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_files_entity_idx").on(t.orgId, t.entityType, t.entityId)]);

// ── Performance: points, badges, review cases ───────────────────────────────

export const orgPointSettingsTable = pgTable("org_point_settings", {
  orgId: integer("org_id").primaryKey().references(() => organisationsTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  inactivityDays: integer("inactivity_days").notNull().default(90),
  reviewThreshold: integer("review_threshold").notNull().default(-500),
  missedDeadlineGraceDays: integer("missed_deadline_grace_days").notNull().default(2),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// Point values per action. Rules can be switched off; deductions start disabled.
export const orgPointRulesTable = pgTable("org_point_rules", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  points: integer("points").notNull(),
  enabled: boolean("enabled").notNull().default(true),
}, (t) => [uniqueIndex("org_point_rules_org_key_idx").on(t.orgId, t.key)]);

// Every score change is an event traceable to its source; totals are sums.
export const orgPointEventsTable = pgTable("org_point_events", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  membershipId: integer("membership_id").notNull().references(() => orgMembershipsTable.id, { onDelete: "cascade" }),
  ruleKey: text("rule_key"),
  points: integer("points").notNull(),
  reason: text("reason").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id"),
  evidenceUrl: text("evidence_url"),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("org_point_events_member_idx").on(t.orgId, t.membershipId),
  // Automatic awards happen at most once per member, rule and source.
  uniqueIndex("org_point_events_auto_unique_idx").on(t.membershipId, t.ruleKey, t.sourceType, t.sourceId).where(sql`source_id is not null and rule_key is not null`),
]);

export const orgAchievementsTable = pgTable("org_achievements", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon").notNull().default("award"),
  color: text("color"),
  // null = awarded manually; otherwise e.g. { type: "points", threshold: 500 } or { type: "tasks", threshold: 10 }
  autoRule: jsonb("auto_rule"),
  archivedAt: ts("archived_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_achievements_org_idx").on(t.orgId)]);

export const orgMemberAchievementsTable = pgTable("org_member_achievements", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  achievementId: integer("achievement_id").notNull().references(() => orgAchievementsTable.id, { onDelete: "cascade" }),
  membershipId: integer("membership_id").notNull().references(() => orgMembershipsTable.id, { onDelete: "cascade" }),
  reason: text("reason"),
  awardedByUserId: integer("awarded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  awardedAt: ts("awarded_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("org_member_achievements_unique_idx").on(t.achievementId, t.membershipId)]);

export const orgReviewCaseStatusEnum = pgEnum("org_review_case_status", ["open", "responded", "resolved"]);

// Membership review safeguard: triggers open a case; a human decides.
export const orgReviewCasesTable = pgTable("org_review_cases", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  membershipId: integer("membership_id").notNull().references(() => orgMembershipsTable.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(),
  detail: text("detail"),
  status: orgReviewCaseStatusEnum("status").notNull().default("open"),
  memberResponse: text("member_response"),
  respondedAt: ts("responded_at"),
  decision: text("decision"),
  decisionNote: text("decision_note"),
  decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  decidedAt: ts("decided_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_review_cases_org_idx").on(t.orgId, t.status)]);

// ── Finance ────────────────────────────────────────────────────────────────
// Money is numeric(14,2) (never floating point) with an explicit currency.
// Posted entries are immutable: corrections are reversal entries that link
// back to the original, with a reason.

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const orgFinanceAccountKindEnum = pgEnum("org_finance_account_kind", ["bank", "cash", "mobile_money", "other"]);

// Bank/cash accounts. Labels only — online-banking credentials are never stored.
export const orgFinanceAccountsTable = pgTable("org_finance_accounts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: orgFinanceAccountKindEnum("kind").notNull().default("bank"),
  currency: text("currency").notNull().default("MAD"),
  institution: text("institution"),
  openingBalance: money("opening_balance").notNull().default("0"),
  reconciledThrough: date("reconciled_through"),
  ledgerCode: text("ledger_code"),
  archivedAt: ts("archived_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_finance_accounts_org_idx").on(t.orgId)]);

export const orgBudgetStatusEnum = pgEnum("org_budget_status", ["draft", "approved", "closed"]);

export const orgBudgetsTable = pgTable("org_budgets", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  projectId: integer("project_id").references(() => orgProjectsTable.id, { onDelete: "set null" }),
  committeeId: integer("committee_id").references(() => orgCommitteesTable.id, { onDelete: "set null" }),
  // Delegated owner: sees this budget and can submit expenses against it without org-wide finance access.
  ownerMembershipId: integer("owner_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  approvedAmount: money("approved_amount").notNull(),
  currency: text("currency").notNull().default("MAD"),
  status: orgBudgetStatusEnum("status").notNull().default("draft"),
  createdByMembershipId: integer("created_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  approvedByMembershipId: integer("approved_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  approvedAt: ts("approved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_budgets_org_idx").on(t.orgId)]);

export const orgBudgetChangeStatusEnum = pgEnum("org_budget_change_status", ["pending", "approved", "rejected"]);

export const orgBudgetChangesTable = pgTable("org_budget_changes", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  budgetId: integer("budget_id").notNull().references(() => orgBudgetsTable.id, { onDelete: "cascade" }),
  previousAmount: money("previous_amount").notNull(),
  newAmount: money("new_amount").notNull(),
  reason: text("reason").notNull(),
  status: orgBudgetChangeStatusEnum("status").notNull().default("pending"),
  requestedByMembershipId: integer("requested_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  decidedByMembershipId: integer("decided_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  decisionNote: text("decision_note"),
  decidedAt: ts("decided_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_budget_changes_budget_idx").on(t.budgetId)]);

export const orgTransactionKindEnum = pgEnum("org_transaction_kind", ["income", "expense", "reversal"]);
// Expenses: submitted → approved → paid (posted); or rejected/cancelled.
// Income: expected → received (posted). Reversals are posted on creation.
export const orgTransactionStatusEnum = pgEnum("org_transaction_status", ["expected", "submitted", "approved", "paid", "received", "posted", "rejected", "cancelled"]);

export const orgTransactionsTable = pgTable("org_transactions", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  reference: text("reference").notNull(),
  kind: orgTransactionKindEnum("kind").notNull(),
  direction: text("direction").notNull(), // "in" | "out"
  status: orgTransactionStatusEnum("status").notNull(),
  amount: money("amount").notNull(),
  currency: text("currency").notNull().default("MAD"),
  date: date("date").notNull(),
  accountId: integer("account_id").references(() => orgFinanceAccountsTable.id),
  budgetId: integer("budget_id").references(() => orgBudgetsTable.id),
  projectId: integer("project_id").references(() => orgProjectsTable.id, { onDelete: "set null" }),
  committeeId: integer("committee_id").references(() => orgCommitteesTable.id, { onDelete: "set null" }),
  sponsorId: integer("sponsor_id"),
  category: text("category"),
  counterparty: text("counterparty"),
  description: text("description").notNull(),
  fundingType: text("funding_type"),
  externalReference: text("external_reference"),
  // "general" for general administration when there's no project (analytical axis).
  costCenter: text("cost_center"),
  // Supplier identifiers required on Moroccan invoices.
  supplierIce: text("supplier_ice"),
  supplierIf: text("supplier_if"),
  requestedByMembershipId: integer("requested_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  approvedByMembershipId: integer("approved_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  approvedAt: ts("approved_at"),
  postedByMembershipId: integer("posted_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  postedAt: ts("posted_at"),
  rejectionReason: text("rejection_reason"),
  reversesId: integer("reverses_id"),
  reversedById: integer("reversed_by_id"),
  reconciled: boolean("reconciled").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("org_transactions_org_ref_idx").on(t.orgId, t.reference),
  index("org_transactions_org_date_idx").on(t.orgId, t.date),
  index("org_transactions_budget_idx").on(t.budgetId),
  index("org_transactions_project_idx").on(t.projectId),
]);

// ── Sponsors ───────────────────────────────────────────────────────────────

export const orgSponsorsTable = pgTable("org_sponsors", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  website: text("website"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  description: text("description"),
  status: text("status").notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_sponsors_org_idx").on(t.orgId)]);

// Which projects a sponsor funds, and the committed amount.
export const orgSponsorProjectsTable = pgTable("org_sponsor_projects", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  sponsorId: integer("sponsor_id").notNull().references(() => orgSponsorsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => orgProjectsTable.id, { onDelete: "cascade" }),
  committedAmount: money("committed_amount").notNull().default("0"),
  currency: text("currency").notNull().default("MAD"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("org_sponsor_projects_unique_idx").on(t.sponsorId, t.projectId)]);

// Progress updates for sponsors. Visibility: every sponsor of the project, named sponsors only, or public.
export const orgSponsorUpdatesTable = pgTable("org_sponsor_updates", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => orgProjectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  visibility: text("visibility").notNull().default("project_sponsors"),
  sponsorIds: integer("sponsor_ids").array().notNull().default([]),
  status: text("status").notNull().default("draft"),
  createdByMembershipId: integer("created_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  publishedByMembershipId: integer("published_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  publishedAt: ts("published_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("org_sponsor_updates_project_idx").on(t.orgId, t.projectId)]);

// Internal records explicitly shared with one sponsor (expenditure evidence,
// documents). Rows are the publication log: who shared what, when.
export const orgSponsorSharesTable = pgTable("org_sponsor_shares", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  sponsorId: integer("sponsor_id").notNull().references(() => orgSponsorsTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  sharedByMembershipId: integer("shared_by_membership_id").references(() => orgMembershipsTable.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("org_sponsor_shares_unique_idx").on(t.sponsorId, t.entityType, t.entityId)]);

// ── Accounting Pro (double entry) ─────────────────────────────────────────
// Generated automatically from posted Finance transactions. Entries are never
// edited or deleted: corrections are reversal entries. Numbers are gapless
// per organisation and fiscal year (2026-0001, 2026-0002, …).

// Chart of accounts (Plan comptable). Seeded with defaults; editable labels.
export const orgLedgerAccountsTable = pgTable("org_ledger_accounts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  label: text("label").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("org_ledger_accounts_org_code_idx").on(t.orgId, t.code)]);

// Which ledger account an expense category or funding type posts to.
export const orgAccountMappingsTable = pgTable("org_account_mappings", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "expense_category" | "funding_type"
  key: text("key").notNull(),
  accountCode: text("account_code").notNull(),
}, (t) => [uniqueIndex("org_account_mappings_unique_idx").on(t.orgId, t.kind, t.key)]);

export const orgJournalEntriesTable = pgTable("org_journal_entries", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  fiscalYear: integer("fiscal_year").notNull(),
  number: text("number").notNull(), // EcritureNum, e.g. 2026-0001
  journalCode: text("journal_code").notNull(), // BQ (bank), CA (cash), OD (misc), AN (opening)
  date: date("date").notNull(),
  label: text("label").notNull(),
  transactionId: integer("transaction_id").references(() => orgTransactionsTable.id),
  accountId: integer("account_id").references(() => orgFinanceAccountsTable.id),
  pieceRef: text("piece_ref"),
  pieceDate: date("piece_date"),
  reversesEntryId: integer("reverses_entry_id"),
  postedByUserId: integer("posted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("org_journal_entries_number_idx").on(t.orgId, t.number),
  // One automatic entry per Finance transaction.
  uniqueIndex("org_journal_entries_tx_idx").on(t.transactionId).where(sql`transaction_id is not null`),
  uniqueIndex("org_journal_entries_opening_idx").on(t.accountId).where(sql`journal_code = 'AN'`),
  index("org_journal_entries_org_date_idx").on(t.orgId, t.date),
]);

export const orgJournalLinesTable = pgTable("org_journal_lines", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  entryId: integer("entry_id").notNull().references(() => orgJournalEntriesTable.id),
  lineNo: integer("line_no").notNull(),
  accountCode: text("account_code").notNull(),
  accountLabel: text("account_label").notNull(),
  label: text("label").notNull(),
  debit: money("debit").notNull().default("0"),
  credit: money("credit").notNull().default("0"),
  projectId: integer("project_id").references(() => orgProjectsTable.id, { onDelete: "set null" }),
  analytic: text("analytic"), // project title or "Administration générale"
}, (t) => [
  index("org_journal_lines_entry_idx").on(t.entryId),
  index("org_journal_lines_org_account_idx").on(t.orgId, t.accountCode),
]);

// Gapless numbering: one counter row per organisation and fiscal year,
// incremented inside the posting transaction (a rollback releases the number).
export const orgJournalSequencesTable = pgTable("org_journal_sequences", {
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  fiscalYear: integer("fiscal_year").notNull(),
  last: integer("last").notNull().default(0),
}, (t) => [uniqueIndex("org_journal_sequences_pk_idx").on(t.orgId, t.fiscalYear)]);

// Locked periods: month 1–12, or 0 for the whole fiscal year (closing).
export const orgAccountingLocksTable = pgTable("org_accounting_locks", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  fiscalYear: integer("fiscal_year").notNull(),
  month: integer("month").notNull(),
  lockedByUserId: integer("locked_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("org_accounting_locks_unique_idx").on(t.orgId, t.fiscalYear, t.month)]);

export type OrgJournalEntry = typeof orgJournalEntriesTable.$inferSelect;
export type OrgSponsor = typeof orgSponsorsTable.$inferSelect;
export type OrgTransaction = typeof orgTransactionsTable.$inferSelect;
export type OrgBudget = typeof orgBudgetsTable.$inferSelect;

export type Organisation = typeof organisationsTable.$inferSelect;
export type OrgRole = typeof orgRolesTable.$inferSelect;
export type OrgMembership = typeof orgMembershipsTable.$inferSelect;
export type OrgRegion = typeof orgRegionsTable.$inferSelect;
export type OrgCommittee = typeof orgCommitteesTable.$inferSelect;
export type OrgProject = typeof orgProjectsTable.$inferSelect;
export type OrgEvent = typeof orgEventsTable.$inferSelect;
export type OrgTask = typeof orgTasksTable.$inferSelect;
