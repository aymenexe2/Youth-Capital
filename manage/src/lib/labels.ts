// English labels for API enum values; pass through t() when rendering.
export const TASK_STATUS: Record<string, string> = {
  backlog: "Backlog", todo: "To do", in_progress: "In progress", in_review: "In review",
  completed: "Completed", blocked: "Blocked", cancelled: "Cancelled",
};
export const TASK_COLUMNS = ["backlog", "todo", "in_progress", "in_review", "completed"] as const;

export const PROJECT_STATUS: Record<string, string> = {
  draft: "Draft", planned: "Planned", active: "Active", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled",
};
export const EVENT_STATUS: Record<string, string> = { planned: "Planned", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" };
export const EVENT_TYPE: Record<string, string> = {
  meeting: "Meeting", workshop: "Workshop", conference: "Conference", forum: "Forum", training: "Training", campaign: "Campaign", other: "Other",
};
export const PRIORITY: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
export const MEMBERSHIP_STATUS: Record<string, string> = { active: "Active", inactive: "Inactive", suspended: "Suspended", left: "Left" };
export const SCOPE: Record<string, string> = {
  organisation: "Whole organisation", committee: "Own committees", region: "Own region", assigned: "Assigned work only",
};
export const REGION_KIND: Record<string, string> = { region: "Region", province: "Province / prefecture", local: "Local unit", diaspora: "Diaspora" };
export const COMMITTEE_KIND: Record<string, string> = { committee: "Committee", governance: "Governance body", working_group: "Working group" };

export const PERMISSION_LABEL: Record<string, string> = {
  "org.manage": "Edit organisation settings",
  "roles.manage": "Manage roles and assign them",
  "members.view": "View member profiles and contacts",
  "members.invite": "Invite new members",
  "members.edit": "Edit member details and status",
  "regions.manage": "Manage regions",
  "committees.manage": "Manage committees",
  "projects.view": "View committee projects",
  "projects.create": "Create projects",
  "projects.manage": "Manage projects",
  "events.view": "View events",
  "events.manage": "Create and manage events",
  "tasks.view": "View project tasks",
  "tasks.assign": "Create and assign tasks",
  "tasks.validate": "Validate submitted tasks",
  "reports.view": "View reports",
  "audit.view": "View the full audit log",
  "performance.manage": "Award points and badges, set point rules",
  "performance.review": "Decide membership review cases",
  "finance.view": "View all finance records",
  "finance.create_expense": "Submit expenses",
  "finance.approve": "Approve finance",
  "finance.export": "Export finance records",
  "accounting.view": "View Accounting Pro and download legal exports",
  "accounting.manage": "Configure accounting, post missing entries and lock periods",
  "sponsors.manage": "Manage sponsors and portal access",
  "sponsor.publish_update": "Publish sponsor updates and share records",
};
export const PERMISSION_GROUP_LABEL: Record<string, string> = {
  organisation: "Organisation", members: "Members", work: "Projects, events & tasks", performance: "Performance", finance: "Finance", accounting: "Accounting Pro", sponsors: "Sponsors",
};

// Readable sentences for audit actions.
export const AUDIT_ACTION: Record<string, string> = {
  "organisation.created": "created the organisation",
  "organisation.updated": "updated organisation settings",
  "role.created": "created a role",
  "role.updated": "updated a role",
  "role.deleted": "deleted a role",
  "region.created": "added a region",
  "region.updated": "updated a region",
  "region.deleted": "deleted a region",
  "committee.created": "created a committee",
  "committee.updated": "updated a committee",
  "committee.member_set": "updated committee membership",
  "committee.member_removed": "removed a committee member",
  "membership.joined": "joined the organisation",
  "membership.updated": "updated a member",
  "membership.role_changed": "changed a member's role",
  "membership.status_changed": "changed a membership status",
  "invitation.created": "sent an invitation",
  "invitation.revoked": "revoked an invitation",
  "project.created": "created a project",
  "project.updated": "updated a project",
  "project.status_changed": "changed a project's status",
  "project.member_set": "updated a project team",
  "project.member_removed": "removed someone from a project",
  "milestone.created": "added a milestone",
  "milestone.updated": "updated a milestone",
  "milestone.deleted": "deleted a milestone",
  "event.created": "created an event",
  "event.updated": "updated an event",
  "task.created": "created a task",
  "task.updated": "updated a task",
  "task.status_changed": "moved a task",
  "task.reassigned": "reassigned a task",
  "task.due_date_changed": "changed a due date",
  "task.submitted": "submitted a task for review",
  "task.approved": "approved a task",
  "task.returned": "returned a task with changes requested",
  "task.evidence_added": "added evidence",
  "task.dependency_added": "added a task dependency",
  "task.dependency_removed": "removed a task dependency",
  "points.awarded": "awarded points",
  "points.deducted": "deducted points",
  "points.rules_updated": "updated the point rules",
  "achievement.created": "created a badge",
  "achievement.updated": "updated a badge",
  "achievement.awarded": "awarded a badge",
  "achievement.revoked": "revoked a badge",
  "review.opened": "opened a membership review",
  "review.responded": "responded to a membership review",
  "review.decided": "decided a membership review",
  "file.uploaded": "uploaded a file",
  "finance.account_created": "added a finance account",
  "finance.account_updated": "updated a finance account",
  "finance.reconciled": "reconciled an account",
  "finance.budget_created": "proposed a budget",
  "finance.budget_updated": "updated a budget",
  "finance.budget_approved": "approved a budget",
  "finance.budget_change_requested": "requested a budget change",
  "finance.budget_change_approved": "approved a budget change",
  "finance.budget_change_rejected": "rejected a budget change",
  "finance.expense_submitted": "submitted an expense",
  "finance.expense_approved": "approved an expense",
  "finance.expense_rejected": "rejected an expense",
  "finance.expense_paid": "recorded a payment",
  "finance.income_expected": "recorded expected income",
  "finance.income_received": "recorded income received",
  "finance.transaction_edited": "edited a finance entry",
  "finance.transaction_cancelled": "cancelled a finance entry",
  "finance.transaction_reversed": "reversed a finance entry",
  "finance.reversal_posted": "posted a reversal",
  "finance.report_viewed": "generated a financial report",
  "finance.exported": "exported finance records",
  "accounting.exported": "exported accounting records",
  "accounting.period_locked": "locked an accounting period",
  "accounting.backfilled": "posted missing journal entries",
  "accounting.identity_updated": "updated the legal identity",
  "accounting.mapping_updated": "updated the account mapping",
  "sponsor.created": "added a sponsor",
  "sponsor.updated": "updated a sponsor",
  "sponsor.project_linked": "linked a funded project",
  "sponsor.project_unlinked": "unlinked a funded project",
  "sponsor.contact_invited": "invited a sponsor contact",
  "sponsor.update_drafted": "drafted a sponsor update",
  "sponsor.update_edited": "edited a sponsor update",
  "sponsor.update_published": "published a sponsor update",
  "sponsor.update_unpublished": "unpublished a sponsor update",
  "sponsor.shared": "shared a record with a sponsor",
  "sponsor.unshared": "stopped sharing a record with a sponsor",
};

export const POINT_RULE: Record<string, { label: string; description: string }> = {
  task_approved: { label: "Approved task completion", description: "Awarded automatically when a reviewer approves the member's task." },
  project_contribution: { label: "Meaningful project contribution", description: "Awarded by a manager for a significant contribution to a project." },
  event_participation: { label: "Verified event participation", description: "Awarded by a manager once participation is verified." },
  leadership: { label: "Approved leadership responsibility", description: "Awarded by a manager for taking on an approved leadership role." },
  missed_deadline: { label: "Missed deadline", description: "Deducted automatically after the grace period if a task is still open. Off unless your policy allows it." },
};
export const REVIEW_TRIGGER: Record<string, string> = { inactivity: "Inactivity", low_score: "Low score", manual: "Opened manually" };
export const REVIEW_DECISION: Record<string, string> = {
  no_action: "No action needed", support_plan: "Support plan agreed", warning: "Formal warning", status_change: "Membership status changed",
};
export const REVIEW_STATUS: Record<string, string> = { open: "Awaiting member", responded: "Member responded", resolved: "Resolved" };
export const PERIOD: Record<string, string> = { all: "All time", year: "Last 12 months", quarter: "Last 3 months", month: "Last 30 days" };

export const TX_STATUS: Record<string, string> = {
  expected: "Expected", submitted: "Awaiting approval", approved: "Approved — to pay", paid: "Paid", received: "Received",
  posted: "Posted", rejected: "Rejected", cancelled: "Cancelled",
};
export const TX_KIND: Record<string, string> = { income: "Income", expense: "Expense", reversal: "Reversal" };
export const FUNDING_TYPE: Record<string, string> = {
  grant: "Grant", donation: "Donation", sponsorship: "Sponsorship", membership_fees: "Membership fees", event_revenue: "Event revenue",
  public_funding: "Public funding", other: "Other",
};
export const EXPENSE_CATEGORIES = ["Venue", "Catering", "Transport", "Accommodation", "Printing & materials", "Communication", "Equipment", "Services", "Fees", "Other"];
export const ACCOUNT_KIND: Record<string, string> = { bank: "Bank account", cash: "Cash box", mobile_money: "Mobile money", other: "Other" };
export const BUDGET_STATUS: Record<string, string> = { draft: "Draft — awaiting approval", approved: "Approved", closed: "Closed" };
export const UPDATE_VISIBILITY: Record<string, string> = { project_sponsors: "All sponsors of the project", named: "Named sponsors only", public: "Public" };
