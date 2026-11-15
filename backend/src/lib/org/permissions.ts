// Permission catalog for the organisation workspace. Roles are templates over
// these keys; the organisation can edit any non-admin role's permission list.
// Finance and sponsor permissions are defined now so role templates don't need
// migrating when those modules ship — no endpoint checks them yet.

export const PERMISSIONS = [
  "org.manage",
  "roles.manage",
  "members.view",
  "members.invite",
  "members.edit",
  "regions.manage",
  "committees.manage",
  "projects.view",
  "projects.create",
  "projects.manage",
  "events.view",
  "events.manage",
  "tasks.view",
  "tasks.assign",
  "tasks.validate",
  "reports.view",
  "audit.view",
  "performance.manage",
  "performance.review",
  "finance.view",
  "finance.create_expense",
  "finance.approve",
  "finance.export",
  "sponsors.manage",
  "sponsor.publish_update",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_GROUPS: { key: string; permissions: Permission[]; available: boolean }[] = [
  { key: "organisation", permissions: ["org.manage", "roles.manage", "regions.manage", "committees.manage", "audit.view"], available: true },
  { key: "members", permissions: ["members.view", "members.invite", "members.edit"], available: true },
  { key: "work", permissions: ["projects.view", "projects.create", "projects.manage", "events.view", "events.manage", "tasks.view", "tasks.assign", "tasks.validate", "reports.view"], available: true },
  { key: "performance", permissions: ["performance.manage", "performance.review"], available: true },
  { key: "finance", permissions: ["finance.view", "finance.create_expense", "finance.approve", "finance.export"], available: true },
  { key: "sponsors", permissions: ["sponsors.manage", "sponsor.publish_update"], available: true },
];

export const ROLE_SCOPES = ["organisation", "committee", "region", "assigned"] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

export const ADMIN_ROLE_KEY = "org_admin";
// Sponsor-portal accounts: no internal permissions; only /portal routes are reachable.
export const SPONSOR_ROLE_KEY = "sponsor";

type RoleTemplate = { key: string; name: string; description: string; scope: RoleScope; permissions: Permission[] };

// Seeded into every new organisation. Names are editable afterwards.
export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: ADMIN_ROLE_KEY,
    name: "Organisation Admin",
    description: "Organisation-wide administration and authorised records.",
    scope: "organisation",
    permissions: [...PERMISSIONS],
  },
  {
    key: "treasurer",
    name: "Treasurer",
    description: "Finance module, budgets, expenses, approvals and reports.",
    scope: "organisation",
    permissions: ["members.view", "projects.view", "events.view", "tasks.view", "reports.view", "finance.view", "finance.create_expense", "finance.approve", "finance.export"],
  },
  {
    key: "committee_head",
    name: "Committee Head",
    description: "Own committee members, projects, events and tasks.",
    scope: "committee",
    permissions: ["members.view", "projects.view", "projects.create", "projects.manage", "events.view", "events.manage", "tasks.view", "tasks.assign", "tasks.validate", "reports.view", "performance.manage"],
  },
  {
    key: "project_manager",
    name: "Project Manager",
    description: "Assigned projects, their team, milestones and tasks.",
    scope: "assigned",
    permissions: ["members.view", "projects.view", "projects.manage", "events.view", "tasks.view", "tasks.assign", "tasks.validate"],
  },
  {
    key: "regional_coordinator",
    name: "Regional Coordinator",
    description: "Members and activities within an assigned region.",
    scope: "region",
    permissions: ["members.view", "members.invite", "members.edit", "projects.view", "events.view", "events.manage", "tasks.view", "tasks.assign"],
  },
  {
    key: SPONSOR_ROLE_KEY,
    name: "Sponsor",
    description: "External sponsor contact. Sees only the sponsor portal for projects they fund.",
    scope: "assigned",
    permissions: [],
  },
  {
    key: "member",
    name: "Member",
    description: "Own profile, own tasks and permitted committee/project spaces.",
    scope: "assigned",
    permissions: ["projects.view", "events.view", "tasks.view"],
  },
];

export const isPermission = (p: string): p is Permission => (PERMISSIONS as readonly string[]).includes(p);
