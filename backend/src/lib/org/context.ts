import type { Request, Response, NextFunction } from "express";
import {
  db, organisationsTable, orgMembershipsTable, orgRolesTable, orgCommitteeMembersTable, orgProjectMembersTable,
  orgProjectsTable, orgRegionsTable, type Organisation, type OrgMembership, type OrgRole,
} from "@workspace/db";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { ADMIN_ROLE_KEY, PERMISSIONS, type Permission, type RoleScope } from "./permissions.js";

// Everything an org-scoped route needs to authorise a request: the tenant, the
// caller's membership and role in it, and the committees/regions/projects that
// bound the role's scope. Loaded once per request by loadOrgContext.
export type OrgContext = {
  org: Organisation;
  membership: OrgMembership;
  role: OrgRole;
  userId: number;
  perms: Set<string>;
  scope: RoleScope;
  committeeIds: number[];
  headCommitteeIds: number[];
  regionIds: number[];
  projectIds: number[];
  managedProjectIds: number[];
};

export function getOrg(req: Request): OrgContext {
  const ctx = (req as any).org as OrgContext | undefined;
  if (!ctx) throw new Error("Org context missing — route mounted outside loadOrgContext");
  return ctx;
}

export const can = (ctx: OrgContext, perm: Permission) => ctx.perms.has(perm);
export const isOrgWide = (ctx: OrgContext) => ctx.scope === "organisation";

export function requirePerm(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!can(getOrg(req), perm)) {
      res.status(403).json({ error: "Forbidden", message: `Missing permission: ${perm}` });
      return;
    }
    next();
  };
}

// Region ids for a region and everything beneath it (provinces, local units).
async function regionSubtree(orgId: number, rootId: number): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(sql`
    with recursive tree as (
      select id from ${orgRegionsTable} where id = ${rootId} and org_id = ${orgId}
      union all
      select r.id from ${orgRegionsTable} r join tree t on r.parent_id = t.id where r.org_id = ${orgId}
    )
    select id from tree`);
  return rows.rows.map((r) => Number(r.id));
}

// Non-members get a 404, not a 403, so organisation slugs can't be probed.
// Platform admins (users.role = admin) get no implicit access to tenant data.
export async function loadOrgContext(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user;
    const slug = String(req.params.slug || "").toLowerCase();
    const [row] = await db
      .select({ org: organisationsTable, membership: orgMembershipsTable, role: orgRolesTable })
      .from(orgMembershipsTable)
      .innerJoin(organisationsTable, eq(organisationsTable.id, orgMembershipsTable.orgId))
      .innerJoin(orgRolesTable, eq(orgRolesTable.id, orgMembershipsTable.roleId))
      .where(and(eq(organisationsTable.slug, slug), eq(orgMembershipsTable.userId, user.id)));

    if (!row || row.membership.status === "left") {
      res.status(404).json({ error: "NotFound", message: "Organisation not found" });
      return;
    }
    if (row.org.status !== "active") {
      res.status(403).json({ error: "Forbidden", message: "This organisation is suspended" });
      return;
    }
    if (row.membership.status === "suspended") {
      res.status(403).json({ error: "Forbidden", message: "Your membership is suspended" });
      return;
    }

    const orgId = row.org.id;
    const membershipId = row.membership.id;
    const [committees, projects, owned] = await Promise.all([
      db.select({ committeeId: orgCommitteeMembersTable.committeeId, role: orgCommitteeMembersTable.role })
        .from(orgCommitteeMembersTable)
        .where(and(eq(orgCommitteeMembersTable.orgId, orgId), eq(orgCommitteeMembersTable.membershipId, membershipId))),
      db.select({ projectId: orgProjectMembersTable.projectId, role: orgProjectMembersTable.role })
        .from(orgProjectMembersTable)
        .where(and(eq(orgProjectMembersTable.orgId, orgId), eq(orgProjectMembersTable.membershipId, membershipId))),
      db.select({ id: orgProjectsTable.id })
        .from(orgProjectsTable)
        .where(and(eq(orgProjectsTable.orgId, orgId), eq(orgProjectsTable.ownerMembershipId, membershipId))),
    ]);
    const regionIds = row.membership.regionId ? await regionSubtree(orgId, row.membership.regionId) : [];

    const ctx: OrgContext = {
      org: row.org,
      membership: row.membership,
      role: row.role,
      userId: user.id,
      // Administrators hold every permission, including ones added after the
      // organisation was created.
      perms: new Set(row.role.key === ADMIN_ROLE_KEY ? PERMISSIONS : row.role.permissions),
      scope: row.role.scope,
      committeeIds: committees.map((c) => c.committeeId),
      headCommitteeIds: committees.filter((c) => c.role === "head").map((c) => c.committeeId),
      regionIds,
      projectIds: [...new Set([...projects.map((p) => p.projectId), ...owned.map((p) => p.id)])],
      managedProjectIds: [...new Set([...projects.filter((p) => p.role === "manager").map((p) => p.projectId), ...owned.map((p) => p.id)])],
    };
    (req as any).org = ctx;

    // Activity tracking for membership-review rules (throttled to one write per hour).
    const last = row.membership.lastActiveAt?.getTime() ?? 0;
    if (Date.now() - last > 60 * 60 * 1000) {
      db.update(orgMembershipsTable).set({ lastActiveAt: new Date() }).where(eq(orgMembershipsTable.id, membershipId)).catch(() => {});
    }
    next();
  } catch (err) {
    req.log.error({ err }, "Load org context error");
    res.status(500).json({ error: "Internal", message: "Server error" });
  }
}

// ── Scope rules ─────────────────────────────────────────────────────────────
// Every list query ANDs one of these with `orgId = ctx.org.id`.

const inIds = (col: any, ids: number[]): SQL => (ids.length ? inArray(col, ids) : sql`false`);

export function projectVisibility(ctx: OrgContext): SQL {
  const tenant = eq(orgProjectsTable.orgId, ctx.org.id);
  if (can(ctx, "projects.view") && isOrgWide(ctx)) return tenant;
  const mine = [inIds(orgProjectsTable.id, ctx.projectIds)];
  if (can(ctx, "projects.view")) mine.push(inIds(orgProjectsTable.committeeId, ctx.committeeIds));
  return and(tenant, or(...mine))!;
}

export async function visibleProjectIds(ctx: OrgContext): Promise<number[] | "all"> {
  if (can(ctx, "projects.view") && isOrgWide(ctx)) return "all";
  const rows = await db.select({ id: orgProjectsTable.id }).from(orgProjectsTable).where(projectVisibility(ctx));
  return rows.map((r) => r.id);
}

type ProjectLike = { id: number; committeeId: number | null; ownerMembershipId: number | null };

export function canManageProject(ctx: OrgContext, p: ProjectLike): boolean {
  if (p.ownerMembershipId === ctx.membership.id) return true;
  if (!can(ctx, "projects.manage")) return false;
  if (isOrgWide(ctx)) return true;
  if (ctx.managedProjectIds.includes(p.id)) return true;
  return ctx.scope === "committee" && p.committeeId != null && ctx.headCommitteeIds.includes(p.committeeId);
}

export function canCreateProject(ctx: OrgContext, committeeId: number | null | undefined): boolean {
  if (!can(ctx, "projects.create")) return false;
  if (isOrgWide(ctx)) return true;
  return committeeId != null && ctx.headCommitteeIds.includes(committeeId);
}

type TaskLike = {
  assigneeMembershipId: number | null; reviewerMembershipId: number | null; createdByMembershipId: number | null; projectId: number | null;
};

export function canEditTask(ctx: OrgContext, t: TaskLike, project: ProjectLike | null): boolean {
  if (t.createdByMembershipId === ctx.membership.id) return true;
  if (!can(ctx, "tasks.assign")) return false;
  if (isOrgWide(ctx)) return true;
  return project != null && canManageProject(ctx, project);
}

// Separation of duties: nobody validates their own work.
export function canValidateTask(ctx: OrgContext, t: TaskLike, project: ProjectLike | null): boolean {
  if (t.assigneeMembershipId === ctx.membership.id) return false;
  if (t.reviewerMembershipId === ctx.membership.id) return true;
  if (!can(ctx, "tasks.validate")) return false;
  if (isOrgWide(ctx)) return true;
  return project != null && canManageProject(ctx, project);
}

export function canSeeMemberDetails(ctx: OrgContext, m: { id: number; regionId: number | null }, committeeMemberIds: Set<number>): boolean {
  if (m.id === ctx.membership.id) return true;
  if (!can(ctx, "members.view")) return false;
  if (isOrgWide(ctx)) return true;
  if (ctx.scope === "region") return m.regionId != null && ctx.regionIds.includes(m.regionId);
  return committeeMemberIds.has(m.id);
}

export function canEditMember(ctx: OrgContext, m: { id: number; regionId: number | null }): boolean {
  if (!can(ctx, "members.edit")) return false;
  if (isOrgWide(ctx)) return true;
  return ctx.scope === "region" && m.regionId != null && ctx.regionIds.includes(m.regionId);
}

// Membership ids sharing a committee or project with the caller — the
// "people I work with" set used for committee/assigned-scope visibility.
export async function colleagueMembershipIds(ctx: OrgContext): Promise<Set<number>> {
  const [byCommittee, byProject] = await Promise.all([
    ctx.committeeIds.length
      ? db.select({ id: orgCommitteeMembersTable.membershipId }).from(orgCommitteeMembersTable)
          .where(and(eq(orgCommitteeMembersTable.orgId, ctx.org.id), inArray(orgCommitteeMembersTable.committeeId, ctx.committeeIds)))
      : Promise.resolve([]),
    ctx.projectIds.length
      ? db.select({ id: orgProjectMembersTable.membershipId }).from(orgProjectMembersTable)
          .where(and(eq(orgProjectMembersTable.orgId, ctx.org.id), inArray(orgProjectMembersTable.projectId, ctx.projectIds)))
      : Promise.resolve([]),
  ]);
  return new Set([...byCommittee, ...byProject].map((r) => r.id));
}

type EventLike = { committeeId: number | null; projectId: number | null; organiserMembershipId: number | null };

export function canManageEvent(ctx: OrgContext, e: EventLike): boolean {
  if (e.organiserMembershipId === ctx.membership.id) return true;
  if (!can(ctx, "events.manage")) return false;
  if (isOrgWide(ctx)) return true;
  if (ctx.scope === "committee" && e.committeeId != null) return ctx.headCommitteeIds.includes(e.committeeId);
  if (e.projectId != null) return ctx.managedProjectIds.includes(e.projectId);
  return false;
}

export function canCreateEvent(ctx: OrgContext, e: { committeeId?: number | null; projectId?: number | null }): boolean {
  if (!can(ctx, "events.manage")) return false;
  if (isOrgWide(ctx)) return true;
  if (e.committeeId != null) return ctx.scope === "committee" && ctx.headCommitteeIds.includes(e.committeeId);
  if (e.projectId != null) return ctx.managedProjectIds.includes(e.projectId);
  // Regional coordinators may run their own local events with no committee/project.
  return ctx.scope === "region";
}
