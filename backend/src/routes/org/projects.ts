import { Router, type IRouter } from "express";
import {
  db, orgProjectsTable, orgProjectMembersTable, orgMilestonesTable, orgTasksTable, orgCommitteesTable,
  orgMembershipsTable, usersTable, orgBudgetsTable, orgTransactionsTable, orgJournalLinesTable, orgSponsorProjectsTable, type OrgProject,
} from "@workspace/db";
import { and, eq, inArray, sql, count, desc } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "../../middlewares/validate.js";
import { getOrg, projectVisibility, canManageProject, canCreateProject, isOrgWide, type OrgContext } from "../../lib/org/context.js";
import { recordOrgAudit, diff } from "../../lib/org/audit.js";
import { notifyMembers } from "../../lib/org/notify.js";
import { badRequest, conflict, forbidden, idParam, isoDate, notFound, optionalId, optionalText, PRIORITIES, validatePatch } from "./util.js";

const router: IRouter = Router({ mergeParams: true });

const STATUSES = ["draft", "planned", "active", "on_hold", "completed", "cancelled"] as const;

export async function findVisibleProject(ctx: OrgContext, id: number | null): Promise<OrgProject | null> {
  if (!id) return null;
  const [p] = await db.select().from(orgProjectsTable).where(and(projectVisibility(ctx), eq(orgProjectsTable.id, id)));
  return p ?? null;
}

async function membershipInOrg(orgId: number, membershipId: number | null | undefined) {
  if (!membershipId) return true;
  const [m] = await db.select({ id: orgMembershipsTable.id }).from(orgMembershipsTable)
    .where(and(eq(orgMembershipsTable.id, membershipId), eq(orgMembershipsTable.orgId, orgId), eq(orgMembershipsTable.status, "active")));
  return Boolean(m);
}

async function committeeInOrg(orgId: number, committeeId: number | null | undefined) {
  if (!committeeId) return true;
  const [c] = await db.select({ id: orgCommitteesTable.id }).from(orgCommitteesTable)
    .where(and(eq(orgCommitteesTable.id, committeeId), eq(orgCommitteesTable.orgId, orgId)));
  return Boolean(c);
}

router.get("/projects", async (req, res) => {
  const ctx = getOrg(req);
  const projects = await db
    .select({ project: orgProjectsTable, committeeName: orgCommitteesTable.name, committeeColor: orgCommitteesTable.color, ownerName: usersTable.fullName, ownerAvatar: usersTable.avatarUrl })
    .from(orgProjectsTable)
    .leftJoin(orgCommitteesTable, eq(orgCommitteesTable.id, orgProjectsTable.committeeId))
    .leftJoin(orgMembershipsTable, eq(orgMembershipsTable.id, orgProjectsTable.ownerMembershipId))
    .leftJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
    .where(projectVisibility(ctx))
    .orderBy(desc(orgProjectsTable.updatedAt));
  const ids = projects.map((p) => p.project.id);
  const [tasks, milestones, members] = ids.length ? await Promise.all([
    db.select({ projectId: orgTasksTable.projectId, status: orgTasksTable.status, n: count() }).from(orgTasksTable)
      .where(and(eq(orgTasksTable.orgId, ctx.org.id), inArray(orgTasksTable.projectId, ids))).groupBy(orgTasksTable.projectId, orgTasksTable.status),
    db.select({ projectId: orgMilestonesTable.projectId, total: count(), done: sql<number>`count(${orgMilestonesTable.completedAt})` }).from(orgMilestonesTable)
      .where(and(eq(orgMilestonesTable.orgId, ctx.org.id), inArray(orgMilestonesTable.projectId, ids))).groupBy(orgMilestonesTable.projectId),
    db.select({ projectId: orgProjectMembersTable.projectId, n: count() }).from(orgProjectMembersTable)
      .where(and(eq(orgProjectMembersTable.orgId, ctx.org.id), inArray(orgProjectMembersTable.projectId, ids))).groupBy(orgProjectMembersTable.projectId),
  ]) : [[], [], []];

  res.json({
    projects: projects.map(({ project, ...rest }) => {
      const t = tasks.filter((x) => x.projectId === project.id);
      const total = t.filter((x) => x.status !== "cancelled").reduce((s, x) => s + Number(x.n), 0);
      const completed = Number(t.find((x) => x.status === "completed")?.n ?? 0);
      const ms = milestones.find((x) => x.projectId === project.id);
      return {
        ...project, ...rest,
        taskTotal: total, taskCompleted: completed,
        progress: total ? Math.round((completed / total) * 100) : 0,
        milestoneTotal: Number(ms?.total ?? 0), milestoneDone: Number(ms?.done ?? 0),
        memberCount: Number(members.find((x) => x.projectId === project.id)?.n ?? 0),
        canManage: canManageProject(ctx, project),
      };
    }),
  });
});

const ProjectSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: optionalText(5000),
  objective: optionalText(2000),
  committeeId: optionalId,
  ownerMembershipId: optionalId,
  status: z.enum(STATUSES).default("planned"),
  priority: z.enum(PRIORITIES).default("medium"),
  startDate: isoDate,
  endDate: isoDate,
  location: optionalText(200),
  risks: optionalText(3000),
  finalReport: optionalText(10000),
});

const datesInOrder = (s?: string | null, e?: string | null) => !s || !e || s <= e;

router.post("/projects", validateBody(ProjectSchema), async (req, res) => {
  const ctx = getOrg(req);
  const body = req.body as z.infer<typeof ProjectSchema>;
  if (!canCreateProject(ctx, body.committeeId)) {
    forbidden(res, "You can create projects only for committees you lead");
    return;
  }
  const ownerId = body.ownerMembershipId ?? ctx.membership.id;
  if (!(await committeeInOrg(ctx.org.id, body.committeeId)) || !(await membershipInOrg(ctx.org.id, ownerId))) {
    badRequest(res, "Committee or owner not found");
    return;
  }
  if (!datesInOrder(body.startDate, body.endDate)) {
    badRequest(res, "End date must be after the start date");
    return;
  }
  const project = await db.transaction(async (tx) => {
    const [project] = await tx.insert(orgProjectsTable).values({ ...body, orgId: ctx.org.id, ownerMembershipId: ownerId, createdById: ctx.userId }).returning();
    await tx.insert(orgProjectMembersTable).values({ orgId: ctx.org.id, projectId: project.id, membershipId: ownerId, role: "manager" });
    return project;
  });
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "project.created", entityType: "project", entityId: project.id, summary: project.title });
  notifyMembers(ctx.org.id, ctx.org.slug, [ownerId], ctx.userId, { type: "project.owner", title: `You own the project "${project.title}"`, link: `/projects/${project.id}`, email: true });
  res.status(201).json({ project });
});

router.get("/projects/:id", async (req, res) => {
  const ctx = getOrg(req);
  const project = await findVisibleProject(ctx, idParam(req));
  if (!project) {
    notFound(res, "Project");
    return;
  }
  const [members, milestones, taskStats, committee] = await Promise.all([
    db.select({ membershipId: orgProjectMembersTable.membershipId, role: orgProjectMembersTable.role, fullName: usersTable.fullName, avatarUrl: usersTable.avatarUrl, title: orgMembershipsTable.title })
      .from(orgProjectMembersTable)
      .innerJoin(orgMembershipsTable, eq(orgMembershipsTable.id, orgProjectMembersTable.membershipId))
      .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
      .where(and(eq(orgProjectMembersTable.orgId, ctx.org.id), eq(orgProjectMembersTable.projectId, project.id)))
      .orderBy(sql`${orgProjectMembersTable.role} = 'manager' desc`, usersTable.fullName),
    db.select().from(orgMilestonesTable).where(and(eq(orgMilestonesTable.orgId, ctx.org.id), eq(orgMilestonesTable.projectId, project.id)))
      .orderBy(orgMilestonesTable.position, orgMilestonesTable.dueDate),
    db.select({ status: orgTasksTable.status, n: count() }).from(orgTasksTable)
      .where(and(eq(orgTasksTable.orgId, ctx.org.id), eq(orgTasksTable.projectId, project.id))).groupBy(orgTasksTable.status),
    project.committeeId ? db.select().from(orgCommitteesTable).where(eq(orgCommitteesTable.id, project.committeeId)).then((r) => r[0] ?? null) : null,
  ]);
  res.json({
    project, committee, members, milestones,
    taskStats: Object.fromEntries(taskStats.map((t) => [t.status, Number(t.n)])),
    canManage: canManageProject(ctx, project),
    canDelete: canDeleteProject(ctx, project),
  });
});

// Organisation-wide project managers, or the project's owner.
const canDeleteProject = (ctx: OrgContext, p: OrgProject) =>
  canManageProject(ctx, p) && (isOrgWide(ctx) || p.ownerMembershipId === ctx.membership.id);

// Delete a project with its tasks, milestones and team list; its events stay (unlinked).
// Refused while money is attached: budgets, transactions and posted accounting lines
// are legal records, and sponsors may have been shown this project — archive it instead.
router.delete("/projects/:id", async (req, res) => {
  const ctx = getOrg(req);
  const project = await findVisibleProject(ctx, idParam(req));
  if (!project) {
    notFound(res, "Project");
    return;
  }
  if (!canDeleteProject(ctx, project)) {
    forbidden(res, "Only the project owner or an organisation-wide project manager can delete it");
    return;
  }
  const inProject = (col: any) => and(eq(col.orgId, ctx.org.id), eq(col.projectId, project.id));
  const [[b], [tx], [jl], [sp], [tk]] = await Promise.all([
    db.select({ n: count() }).from(orgBudgetsTable).where(inProject(orgBudgetsTable)),
    db.select({ n: count() }).from(orgTransactionsTable).where(inProject(orgTransactionsTable)),
    db.select({ n: count() }).from(orgJournalLinesTable).where(inProject(orgJournalLinesTable)),
    db.select({ n: count() }).from(orgSponsorProjectsTable).where(inProject(orgSponsorProjectsTable)),
    db.select({ n: count() }).from(orgTasksTable).where(inProject(orgTasksTable)),
  ]);
  if (Number(b.n) || Number(tx.n) || Number(jl.n)) {
    conflict(res, "This project has budgets or financial transactions, which must be kept. Mark it as cancelled or completed instead.");
    return;
  }
  if (Number(sp.n)) {
    conflict(res, "This project is linked to a sponsor. Remove the sponsor link first, or mark the project as cancelled.");
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  await db.delete(orgProjectsTable).where(and(eq(orgProjectsTable.id, project.id), eq(orgProjectsTable.orgId, ctx.org.id)));
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId, action: "project.deleted", entityType: "project", entityId: project.id,
    summary: `${project.title} (${Number(tk.n)} task${Number(tk.n) === 1 ? "" : "s"} removed)`, reason: reason || null,
    before: { status: project.status, committeeId: project.committeeId, ownerMembershipId: project.ownerMembershipId },
  });
  res.json({ success: true });
});

router.patch("/projects/:id", validatePatch(ProjectSchema), async (req, res) => {
  const ctx = getOrg(req);
  const project = await findVisibleProject(ctx, idParam(req));
  if (!project) {
    notFound(res, "Project");
    return;
  }
  if (!canManageProject(ctx, project)) {
    forbidden(res);
    return;
  }
  const patch = req.body as Partial<z.infer<typeof ProjectSchema>>;
  // Moving a project to another committee needs the right to create projects there.
  if (patch.committeeId !== undefined && patch.committeeId !== project.committeeId &&
      (!(await committeeInOrg(ctx.org.id, patch.committeeId)) || !canCreateProject(ctx, patch.committeeId))) {
    forbidden(res, "You can't move this project to that committee");
    return;
  }
  if (patch.ownerMembershipId !== undefined && !(await membershipInOrg(ctx.org.id, patch.ownerMembershipId))) {
    badRequest(res, "Owner not found");
    return;
  }
  if (!datesInOrder(patch.startDate ?? project.startDate, patch.endDate ?? project.endDate)) {
    badRequest(res, "End date must be after the start date");
    return;
  }
  const changes = diff(project, patch);
  const [updated] = await db.update(orgProjectsTable).set({ ...patch, updatedAt: new Date() }).where(eq(orgProjectsTable.id, project.id)).returning();
  if (patch.ownerMembershipId && patch.ownerMembershipId !== project.ownerMembershipId) {
    await db.insert(orgProjectMembersTable).values({ orgId: ctx.org.id, projectId: project.id, membershipId: patch.ownerMembershipId, role: "manager" })
      .onConflictDoUpdate({ target: [orgProjectMembersTable.projectId, orgProjectMembersTable.membershipId], set: { role: "manager" } });
    notifyMembers(ctx.org.id, ctx.org.slug, [patch.ownerMembershipId], ctx.userId, { type: "project.owner", title: `You now own the project "${updated.title}"`, link: `/projects/${project.id}`, email: true });
  }
  if (Object.keys(changes.after).length) {
    await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: patch.status && patch.status !== project.status ? "project.status_changed" : "project.updated", entityType: "project", entityId: project.id, summary: updated.title, ...changes });
  }
  res.json({ project: updated });
});

// ── Team ────────────────────────────────────────────────────────────────────

const ProjectMemberSchema = z.object({ membershipId: z.coerce.number().int().positive(), role: z.enum(["manager", "member"]).default("member") });

router.post("/projects/:id/members", validateBody(ProjectMemberSchema), async (req, res) => {
  const ctx = getOrg(req);
  const project = await findVisibleProject(ctx, idParam(req));
  if (!project) {
    notFound(res, "Project");
    return;
  }
  if (!canManageProject(ctx, project)) {
    forbidden(res);
    return;
  }
  if (!(await membershipInOrg(ctx.org.id, req.body.membershipId))) {
    badRequest(res, "Member not found");
    return;
  }
  const [row] = await db.insert(orgProjectMembersTable)
    .values({ orgId: ctx.org.id, projectId: project.id, membershipId: req.body.membershipId, role: req.body.role })
    .onConflictDoUpdate({ target: [orgProjectMembersTable.projectId, orgProjectMembersTable.membershipId], set: { role: req.body.role } })
    .returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "project.member_set", entityType: "project", entityId: project.id, summary: project.title, after: req.body });
  notifyMembers(ctx.org.id, ctx.org.slug, [req.body.membershipId], ctx.userId, { type: "project.added", title: `You were added to "${project.title}"`, link: `/projects/${project.id}` });
  res.status(201).json({ member: row });
});

router.delete("/projects/:id/members/:membershipId", async (req, res) => {
  const ctx = getOrg(req);
  const project = await findVisibleProject(ctx, idParam(req));
  const membershipId = idParam(req, "membershipId");
  if (!project || !membershipId) {
    notFound(res, "Project");
    return;
  }
  if (!canManageProject(ctx, project)) {
    forbidden(res);
    return;
  }
  if (membershipId === project.ownerMembershipId) {
    badRequest(res, "Assign a new owner before removing the current one");
    return;
  }
  await db.delete(orgProjectMembersTable).where(and(
    eq(orgProjectMembersTable.orgId, ctx.org.id), eq(orgProjectMembersTable.projectId, project.id), eq(orgProjectMembersTable.membershipId, membershipId),
  ));
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "project.member_removed", entityType: "project", entityId: project.id, summary: project.title, before: { membershipId } });
  res.json({ success: true });
});

// ── Milestones ──────────────────────────────────────────────────────────────

const MilestoneSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueDate: isoDate,
  completed: z.boolean().optional(),
  position: z.number().int().min(0).max(10000).optional(),
});

router.post("/projects/:id/milestones", validateBody(MilestoneSchema), async (req, res) => {
  const ctx = getOrg(req);
  const project = await findVisibleProject(ctx, idParam(req));
  if (!project) {
    notFound(res, "Project");
    return;
  }
  if (!canManageProject(ctx, project)) {
    forbidden(res);
    return;
  }
  const { completed, ...rest } = req.body;
  const [milestone] = await db.insert(orgMilestonesTable)
    .values({ ...rest, orgId: ctx.org.id, projectId: project.id, completedAt: completed ? new Date() : null }).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "milestone.created", entityType: "project", entityId: project.id, summary: milestone.title });
  res.status(201).json({ milestone });
});

async function milestoneWithProject(ctx: OrgContext, id: number | null) {
  if (!id) return null;
  const [m] = await db.select().from(orgMilestonesTable).where(and(eq(orgMilestonesTable.id, id), eq(orgMilestonesTable.orgId, ctx.org.id)));
  if (!m) return null;
  const project = await findVisibleProject(ctx, m.projectId);
  return project ? { milestone: m, project } : null;
}

router.patch("/milestones/:id", validatePatch(MilestoneSchema), async (req, res) => {
  const ctx = getOrg(req);
  const found = await milestoneWithProject(ctx, idParam(req));
  if (!found) {
    notFound(res, "Milestone");
    return;
  }
  if (!canManageProject(ctx, found.project)) {
    forbidden(res);
    return;
  }
  const { completed, ...rest } = req.body;
  const patch = { ...rest, ...(completed !== undefined ? { completedAt: completed ? found.milestone.completedAt ?? new Date() : null } : {}) };
  const [milestone] = await db.update(orgMilestonesTable).set(patch).where(eq(orgMilestonesTable.id, found.milestone.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "milestone.updated", entityType: "project", entityId: found.project.id, summary: milestone.title, ...diff(found.milestone, patch) });
  res.json({ milestone });
});

router.delete("/milestones/:id", async (req, res) => {
  const ctx = getOrg(req);
  const found = await milestoneWithProject(ctx, idParam(req));
  if (!found) {
    notFound(res, "Milestone");
    return;
  }
  if (!canManageProject(ctx, found.project)) {
    forbidden(res);
    return;
  }
  await db.delete(orgMilestonesTable).where(eq(orgMilestonesTable.id, found.milestone.id));
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "milestone.deleted", entityType: "project", entityId: found.project.id, summary: found.milestone.title, before: found.milestone });
  res.json({ success: true });
});

export default router;
