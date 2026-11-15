import { Router, type IRouter } from "express";
import {
  db, organisationsTable, orgRolesTable, orgMembershipsTable, orgRegionsTable, orgCommitteesTable,
  orgCommitteeMembersTable, orgProjectsTable, usersTable,
} from "@workspace/db";
import { and, eq, sql, count, isNull } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "../../middlewares/validate.js";
import { getOrg, requirePerm, can } from "../../lib/org/context.js";
import { ADMIN_ROLE_KEY, PERMISSIONS, PERMISSION_GROUPS, ROLE_SCOPES } from "../../lib/org/permissions.js";
import { recordOrgAudit, diff } from "../../lib/org/audit.js";
import { optionalHttpUrl } from "../../validation/common.js";
import { badRequest, conflict, forbidden, idParam, notFound, optionalId, optionalText, validatePatch } from "./util.js";

// Organisation settings, roles, regions and committees.

const router: IRouter = Router({ mergeParams: true });

// Bootstrap for the workspace app: the organisation plus who "I" am in it.
router.get("/", (req, res) => {
  const ctx = getOrg(req);
  res.json({
    organisation: ctx.org,
    me: {
      membershipId: ctx.membership.id,
      title: ctx.membership.title,
      regionId: ctx.membership.regionId,
      role: { id: ctx.role.id, key: ctx.role.key, name: ctx.role.name },
      scope: ctx.scope,
      permissions: [...ctx.perms],
      committeeIds: ctx.committeeIds,
      headCommitteeIds: ctx.headCommitteeIds,
      projectIds: ctx.projectIds,
      managedProjectIds: ctx.managedProjectIds,
    },
  });
});

const UpdateOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: optionalText(2000),
  logoUrl: optionalHttpUrl.transform((v) => v ?? null),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish().transform((v) => v ?? null),
  defaultLanguage: z.enum(["en", "fr", "ar"]),
  currency: z.string().trim().toUpperCase().length(3),
  timezone: z.string().trim().max(64),
});

router.patch("/", requirePerm("org.manage"), validatePatch(UpdateOrgSchema), async (req, res) => {
  const ctx = getOrg(req);
  const changes = diff(ctx.org, req.body);
  const [org] = await db.update(organisationsTable).set({ ...req.body, updatedAt: new Date() })
    .where(eq(organisationsTable.id, ctx.org.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "organisation.updated", entityType: "organisation", entityId: org.id, ...changes });
  res.json({ organisation: org });
});

router.get("/meta", (_req, res) => {
  res.json({ permissions: PERMISSIONS, permissionGroups: PERMISSION_GROUPS, scopes: ROLE_SCOPES });
});

// ── Roles ───────────────────────────────────────────────────────────────────

router.get("/roles", async (req, res) => {
  const ctx = getOrg(req);
  const rows = await db
    .select({ role: orgRolesTable, members: count(orgMembershipsTable.id) })
    .from(orgRolesTable)
    .leftJoin(orgMembershipsTable, and(eq(orgMembershipsTable.roleId, orgRolesTable.id), sql`${orgMembershipsTable.status} <> 'left'`))
    .where(eq(orgRolesTable.orgId, ctx.org.id))
    .groupBy(orgRolesTable.id)
    .orderBy(orgRolesTable.id);
  res.json({ roles: rows.map((r) => ({ ...r.role, memberCount: Number(r.members) })) });
});

const RoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: optionalText(500),
  scope: z.enum(ROLE_SCOPES),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).transform((p) => [...new Set(p)]),
});

router.post("/roles", requirePerm("roles.manage"), validateBody(RoleSchema), async (req, res) => {
  const ctx = getOrg(req);
  const key = `custom_${Date.now().toString(36)}`;
  const [role] = await db.insert(orgRolesTable).values({ orgId: ctx.org.id, key, ...req.body }).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "role.created", entityType: "role", entityId: role.id, summary: role.name, after: req.body });
  res.status(201).json({ role });
});

router.patch("/roles/:id", requirePerm("roles.manage"), validatePatch(RoleSchema), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [role] = id ? await db.select().from(orgRolesTable).where(and(eq(orgRolesTable.id, id), eq(orgRolesTable.orgId, ctx.org.id))) : [];
  if (!role) {
    notFound(res, "Role");
    return;
  }
  // The admin role always keeps every permission at organisation scope, so an
  // organisation can't lock itself out of its own workspace.
  if (role.key === ADMIN_ROLE_KEY && (req.body.permissions || req.body.scope)) {
    badRequest(res, "The Organisation Admin role's permissions can't be changed");
    return;
  }
  const changes = diff(role, req.body);
  const [updated] = await db.update(orgRolesTable).set(req.body).where(eq(orgRolesTable.id, role.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "role.updated", entityType: "role", entityId: role.id, summary: updated.name, ...changes });
  res.json({ role: updated });
});

router.delete("/roles/:id", requirePerm("roles.manage"), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [role] = id ? await db.select().from(orgRolesTable).where(and(eq(orgRolesTable.id, id), eq(orgRolesTable.orgId, ctx.org.id))) : [];
  if (!role) {
    notFound(res, "Role");
    return;
  }
  if (role.isSystem) {
    badRequest(res, "Built-in roles can't be deleted");
    return;
  }
  const [{ n }] = await db.select({ n: count() }).from(orgMembershipsTable).where(eq(orgMembershipsTable.roleId, role.id));
  if (Number(n) > 0) {
    conflict(res, "Reassign this role's members before deleting it");
    return;
  }
  await db.delete(orgRolesTable).where(eq(orgRolesTable.id, role.id));
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "role.deleted", entityType: "role", entityId: role.id, summary: role.name, before: role });
  res.json({ success: true });
});

// ── Regions ─────────────────────────────────────────────────────────────────

router.get("/regions", async (req, res) => {
  const ctx = getOrg(req);
  const rows = await db
    .select({ region: orgRegionsTable, members: count(orgMembershipsTable.id) })
    .from(orgRegionsTable)
    .leftJoin(orgMembershipsTable, and(eq(orgMembershipsTable.regionId, orgRegionsTable.id), eq(orgMembershipsTable.status, "active")))
    .where(eq(orgRegionsTable.orgId, ctx.org.id))
    .groupBy(orgRegionsTable.id)
    .orderBy(orgRegionsTable.name);
  res.json({ regions: rows.map((r) => ({ ...r.region, memberCount: Number(r.members) })) });
});

const RegionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["region", "province", "local", "diaspora"]).default("region"),
  code: optionalText(20),
  parentId: optionalId,
});

async function assertParentInOrg(orgId: number, parentId: number | null) {
  if (!parentId) return true;
  const [p] = await db.select({ id: orgRegionsTable.id }).from(orgRegionsTable).where(and(eq(orgRegionsTable.id, parentId), eq(orgRegionsTable.orgId, orgId)));
  return Boolean(p);
}

router.post("/regions", requirePerm("regions.manage"), validateBody(RegionSchema), async (req, res) => {
  const ctx = getOrg(req);
  if (!(await assertParentInOrg(ctx.org.id, req.body.parentId))) {
    badRequest(res, "Parent region not found");
    return;
  }
  const [region] = await db.insert(orgRegionsTable).values({ orgId: ctx.org.id, ...req.body }).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "region.created", entityType: "region", entityId: region.id, summary: region.name });
  res.status(201).json({ region });
});

router.patch("/regions/:id", requirePerm("regions.manage"), validatePatch(RegionSchema), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [region] = id ? await db.select().from(orgRegionsTable).where(and(eq(orgRegionsTable.id, id), eq(orgRegionsTable.orgId, ctx.org.id))) : [];
  if (!region) {
    notFound(res, "Region");
    return;
  }
  if (req.body.parentId !== undefined) {
    if (req.body.parentId === region.id || !(await assertParentInOrg(ctx.org.id, req.body.parentId))) {
      badRequest(res, "Invalid parent region");
      return;
    }
  }
  const [updated] = await db.update(orgRegionsTable).set(req.body).where(eq(orgRegionsTable.id, region.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "region.updated", entityType: "region", entityId: region.id, summary: updated.name, ...diff(region, req.body) });
  res.json({ region: updated });
});

router.delete("/regions/:id", requirePerm("regions.manage"), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [region] = id ? await db.select().from(orgRegionsTable).where(and(eq(orgRegionsTable.id, id), eq(orgRegionsTable.orgId, ctx.org.id))) : [];
  if (!region) {
    notFound(res, "Region");
    return;
  }
  const [{ n }] = await db.select({ n: count() }).from(orgRegionsTable).where(eq(orgRegionsTable.parentId, region.id));
  if (Number(n) > 0) {
    conflict(res, "Delete or move this region's sub-regions first");
    return;
  }
  await db.delete(orgRegionsTable).where(eq(orgRegionsTable.id, region.id));
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "region.deleted", entityType: "region", entityId: region.id, summary: region.name, before: region });
  res.json({ success: true });
});

// ── Committees ──────────────────────────────────────────────────────────────

router.get("/committees", async (req, res) => {
  const ctx = getOrg(req);
  const committees = await db.select().from(orgCommitteesTable).where(eq(orgCommitteesTable.orgId, ctx.org.id)).orderBy(orgCommitteesTable.name);
  const [memberCounts, projectCounts, heads] = await Promise.all([
    db.select({ committeeId: orgCommitteeMembersTable.committeeId, n: count() }).from(orgCommitteeMembersTable)
      .where(eq(orgCommitteeMembersTable.orgId, ctx.org.id)).groupBy(orgCommitteeMembersTable.committeeId),
    db.select({ committeeId: orgProjectsTable.committeeId, n: count() }).from(orgProjectsTable)
      .where(and(eq(orgProjectsTable.orgId, ctx.org.id), sql`${orgProjectsTable.status} not in ('completed','cancelled')`)).groupBy(orgProjectsTable.committeeId),
    db.select({ committeeId: orgCommitteeMembersTable.committeeId, membershipId: orgCommitteeMembersTable.membershipId, fullName: usersTable.fullName, avatarUrl: usersTable.avatarUrl })
      .from(orgCommitteeMembersTable)
      .innerJoin(orgMembershipsTable, eq(orgMembershipsTable.id, orgCommitteeMembersTable.membershipId))
      .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
      .where(and(eq(orgCommitteeMembersTable.orgId, ctx.org.id), eq(orgCommitteeMembersTable.role, "head"))),
  ]);
  const byId = <T extends { committeeId: number | null }>(rows: T[]) => new Map(rows.map((r) => [r.committeeId, r]));
  const mc = byId(memberCounts);
  const pc = byId(projectCounts);
  res.json({
    committees: committees.map((c) => ({
      ...c,
      memberCount: Number(mc.get(c.id)?.n ?? 0),
      activeProjectCount: Number(pc.get(c.id)?.n ?? 0),
      heads: heads.filter((h) => h.committeeId === c.id).map(({ committeeId, ...h }) => h),
      isMine: ctx.committeeIds.includes(c.id),
    })),
  });
});

router.get("/committees/:id", async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [committee] = id ? await db.select().from(orgCommitteesTable).where(and(eq(orgCommitteesTable.id, id), eq(orgCommitteesTable.orgId, ctx.org.id))) : [];
  if (!committee) {
    notFound(res, "Committee");
    return;
  }
  const members = await db
    .select({
      membershipId: orgCommitteeMembersTable.membershipId, role: orgCommitteeMembersTable.role,
      fullName: usersTable.fullName, avatarUrl: usersTable.avatarUrl, title: orgMembershipsTable.title,
    })
    .from(orgCommitteeMembersTable)
    .innerJoin(orgMembershipsTable, eq(orgMembershipsTable.id, orgCommitteeMembersTable.membershipId))
    .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
    .where(and(eq(orgCommitteeMembersTable.committeeId, committee.id), eq(orgCommitteeMembersTable.orgId, ctx.org.id)))
    .orderBy(sql`${orgCommitteeMembersTable.role} = 'head' desc`, usersTable.fullName);
  res.json({ committee, members, canManage: canManageCommitteeMembers(ctx, committee.id) });
});

const CommitteeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: optionalText(2000),
  kind: z.enum(["committee", "governance", "working_group"]).default("committee"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish().transform((v) => v ?? null),
  archived: z.boolean().optional(),
});

router.post("/committees", requirePerm("committees.manage"), validateBody(CommitteeSchema.omit({ archived: true })), async (req, res) => {
  const ctx = getOrg(req);
  const [committee] = await db.insert(orgCommitteesTable).values({ orgId: ctx.org.id, ...req.body }).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "committee.created", entityType: "committee", entityId: committee.id, summary: committee.name });
  res.status(201).json({ committee });
});

router.patch("/committees/:id", requirePerm("committees.manage"), validatePatch(CommitteeSchema), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [committee] = id ? await db.select().from(orgCommitteesTable).where(and(eq(orgCommitteesTable.id, id), eq(orgCommitteesTable.orgId, ctx.org.id))) : [];
  if (!committee) {
    notFound(res, "Committee");
    return;
  }
  const { archived, ...rest } = req.body;
  const patch = { ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) };
  const [updated] = await db.update(orgCommitteesTable).set(patch).where(eq(orgCommitteesTable.id, committee.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "committee.updated", entityType: "committee", entityId: committee.id, summary: updated.name, ...diff(committee, patch) });
  res.json({ committee: updated });
});

// Committee heads can add and remove ordinary members of their own committee;
// appointing heads needs committees.manage.
function canManageCommitteeMembers(ctx: ReturnType<typeof getOrg>, committeeId: number) {
  return can(ctx, "committees.manage") || ctx.headCommitteeIds.includes(committeeId);
}

const CommitteeMemberSchema = z.object({
  membershipId: z.coerce.number().int().positive(),
  role: z.enum(["head", "member"]).default("member"),
});

router.post("/committees/:id/members", validateBody(CommitteeMemberSchema), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [committee] = id ? await db.select().from(orgCommitteesTable)
    .where(and(eq(orgCommitteesTable.id, id), eq(orgCommitteesTable.orgId, ctx.org.id), isNull(orgCommitteesTable.archivedAt))) : [];
  if (!committee) {
    notFound(res, "Committee");
    return;
  }
  if (!canManageCommitteeMembers(ctx, committee.id) || (req.body.role === "head" && !can(ctx, "committees.manage"))) {
    forbidden(res);
    return;
  }
  const [membership] = await db.select().from(orgMembershipsTable)
    .where(and(eq(orgMembershipsTable.id, req.body.membershipId), eq(orgMembershipsTable.orgId, ctx.org.id)));
  if (!membership) {
    notFound(res, "Member");
    return;
  }
  const [row] = await db.insert(orgCommitteeMembersTable)
    .values({ orgId: ctx.org.id, committeeId: committee.id, membershipId: membership.id, role: req.body.role })
    .onConflictDoUpdate({ target: [orgCommitteeMembersTable.committeeId, orgCommitteeMembersTable.membershipId], set: { role: req.body.role } })
    .returning();
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId, action: "committee.member_set", entityType: "committee", entityId: committee.id,
    summary: committee.name, after: { membershipId: membership.id, role: req.body.role },
  });
  res.status(201).json({ member: row });
});

router.delete("/committees/:id/members/:membershipId", async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const membershipId = idParam(req, "membershipId");
  const [row] = id && membershipId ? await db.select().from(orgCommitteeMembersTable)
    .where(and(eq(orgCommitteeMembersTable.committeeId, id), eq(orgCommitteeMembersTable.membershipId, membershipId), eq(orgCommitteeMembersTable.orgId, ctx.org.id))) : [];
  if (!row) {
    notFound(res, "Committee member");
    return;
  }
  if (!canManageCommitteeMembers(ctx, row.committeeId) || (row.role === "head" && !can(ctx, "committees.manage"))) {
    forbidden(res);
    return;
  }
  await db.delete(orgCommitteeMembersTable).where(eq(orgCommitteeMembersTable.id, row.id));
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId, action: "committee.member_removed", entityType: "committee", entityId: row.committeeId,
    before: { membershipId: row.membershipId, role: row.role },
  });
  res.json({ success: true });
});

export default router;
