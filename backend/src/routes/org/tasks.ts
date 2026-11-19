import { Router, type IRouter } from "express";
import {
  db, orgTasksTable, orgTaskCommentsTable, orgTaskDependenciesTable, orgProjectsTable, orgEventsTable, orgMilestonesTable,
  orgProjectMembersTable, orgMembershipsTable, orgCommitteesTable, orgAuditEventsTable, orgFilesTable, usersTable, type OrgTask, type OrgProject,
} from "@workspace/db";
import { and, eq, or, inArray, ne, lt, lte, gte, notInArray, isNull, sql, desc, asc, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { validateBody } from "../../middlewares/validate.js";
import {
  getOrg, can, isOrgWide, visibleProjectIds, canEditTask, canValidateTask, canManageProject, canManageEvent, type OrgContext,
} from "../../lib/org/context.js";
import { recordOrgAudit, diff } from "../../lib/org/audit.js";
import { notifyMembers } from "../../lib/org/notify.js";
import { applyRule } from "../../lib/org/points.js";
import { httpUrl } from "../../validation/common.js";
import { badRequest, conflict, forbidden, idParam, isoDate, notFound, optionalId, optionalText, PRIORITIES, validatePatch } from "./util.js";

const router: IRouter = Router({ mergeParams: true });

const STATUSES = ["backlog", "todo", "in_progress", "in_review", "completed", "blocked", "cancelled"] as const;
// Statuses a task can be moved to directly. in_review and completed are only
// reachable through /submit and /review so every completion has a validation record.
const DIRECT_STATUSES = ["backlog", "todo", "in_progress", "blocked", "cancelled"] as const;
const OPEN = ["backlog", "todo", "in_progress", "blocked", "in_review"] as const;

async function taskVisibility(ctx: OrgContext): Promise<SQL> {
  const tenant = eq(orgTasksTable.orgId, ctx.org.id);
  if (can(ctx, "tasks.view") && isOrgWide(ctx)) return tenant;
  const mine: SQL[] = [
    eq(orgTasksTable.assigneeMembershipId, ctx.membership.id),
    eq(orgTasksTable.reviewerMembershipId, ctx.membership.id),
    eq(orgTasksTable.createdByMembershipId, ctx.membership.id),
  ];
  if (can(ctx, "tasks.view")) {
    const projects = await visibleProjectIds(ctx);
    if (projects === "all") mine.push(sql`${orgTasksTable.projectId} is not null`);
    else if (projects.length) mine.push(inArray(orgTasksTable.projectId, projects));
    // Open tasks waiting to be claimed, for whoever is eligible to take them.
    mine.push(and(
      eq(orgTasksTable.openToClaim, true), isNull(orgTasksTable.assigneeMembershipId),
      ctx.committeeIds.length ? or(isNull(orgTasksTable.claimCommitteeId), inArray(orgTasksTable.claimCommitteeId, ctx.committeeIds))! : isNull(orgTasksTable.claimCommitteeId),
      projects === "all" ? sql`true` : projects.length ? or(isNull(orgTasksTable.projectId), inArray(orgTasksTable.projectId, projects))! : isNull(orgTasksTable.projectId),
    )!);
  }
  return and(tenant, or(...mine))!;
}

async function loadTask(ctx: OrgContext, id: number | null): Promise<{ task: OrgTask; project: OrgProject | null } | null> {
  if (!id) return null;
  const [task] = await db.select().from(orgTasksTable).where(and(await taskVisibility(ctx), eq(orgTasksTable.id, id)));
  if (!task) return null;
  const project = task.projectId
    ? (await db.select().from(orgProjectsTable).where(and(eq(orgProjectsTable.id, task.projectId), eq(orgProjectsTable.orgId, ctx.org.id))))[0] ?? null
    : null;
  return { task, project };
}

function flags(ctx: OrgContext, task: OrgTask, project: OrgProject | null) {
  const isAssignee = task.assigneeMembershipId === ctx.membership.id;
  const canEdit = canEditTask(ctx, task, project);
  return {
    canEdit,
    canValidate: task.status === "in_review" && canValidateTask(ctx, task, project),
    canSubmit: (isAssignee || canEdit) && ["todo", "in_progress", "blocked", "backlog"].includes(task.status),
    canChangeStatus: isAssignee || canEdit,
    isAssignee,
    canClaim: canClaim(ctx, task),
    canRelease: task.openToClaim && isAssignee && ["backlog", "todo", "in_progress", "blocked"].includes(task.status),
  };
}

// Anyone with tasks.view can take an open task, unless it's reserved for a committee they're not in.
function canClaim(ctx: OrgContext, task: OrgTask) {
  return task.openToClaim && task.assigneeMembershipId == null && ["backlog", "todo"].includes(task.status) &&
    can(ctx, "tasks.view") && (task.claimCommitteeId == null || ctx.committeeIds.includes(task.claimCommitteeId));
}

const assignee = alias(orgMembershipsTable, "assignee");
const assigneeUser = alias(usersTable, "assignee_user");
const reviewer = alias(orgMembershipsTable, "reviewer");
const reviewerUser = alias(usersTable, "reviewer_user");

const taskSelect = {
  task: orgTasksTable,
  projectTitle: orgProjectsTable.title,
  eventTitle: orgEventsTable.title,
  assigneeName: assigneeUser.fullName,
  assigneeAvatar: assigneeUser.avatarUrl,
  reviewerName: reviewerUser.fullName,
};

const taskQuery = () => db.select(taskSelect).from(orgTasksTable)
  .leftJoin(orgProjectsTable, eq(orgProjectsTable.id, orgTasksTable.projectId))
  .leftJoin(orgEventsTable, eq(orgEventsTable.id, orgTasksTable.eventId))
  .leftJoin(assignee, eq(assignee.id, orgTasksTable.assigneeMembershipId))
  .leftJoin(assigneeUser, eq(assigneeUser.id, assignee.userId))
  .leftJoin(reviewer, eq(reviewer.id, orgTasksTable.reviewerMembershipId))
  .leftJoin(reviewerUser, eq(reviewerUser.id, reviewer.userId))
  .$dynamic();

const today = () => new Date().toISOString().slice(0, 10);

router.get("/tasks", async (req, res) => {
  const ctx = getOrg(req);
  const q = req.query;
  const conds: SQL[] = [await taskVisibility(ctx)];
  const num = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  if (num(q.projectId)) conds.push(eq(orgTasksTable.projectId, num(q.projectId)!));
  if (num(q.eventId)) conds.push(eq(orgTasksTable.eventId, num(q.eventId)!));
  if (typeof q.status === "string" && (STATUSES as readonly string[]).includes(q.status)) conds.push(eq(orgTasksTable.status, q.status as any));
  if (q.assignee === "me") conds.push(eq(orgTasksTable.assigneeMembershipId, ctx.membership.id));
  else if (num(q.assignee)) conds.push(eq(orgTasksTable.assigneeMembershipId, num(q.assignee)!));
  if (q.reviewer === "me") conds.push(eq(orgTasksTable.reviewerMembershipId, ctx.membership.id));
  if (q.open === "true") conds.push(inArray(orgTasksTable.status, [...OPEN]));
  if (q.claimable === "true") conds.push(and(eq(orgTasksTable.openToClaim, true), isNull(orgTasksTable.assigneeMembershipId), inArray(orgTasksTable.status, ["backlog", "todo"]))!);
  if (q.due === "overdue") conds.push(and(lt(orgTasksTable.dueDate, today()), notInArray(orgTasksTable.status, ["completed", "cancelled"]))!);

  const rows = await taskQuery().where(and(...conds)).orderBy(asc(orgTasksTable.position), desc(orgTasksTable.createdAt)).limit(2000);
  const ids = rows.map((r) => r.task.id);
  const deps = ids.length
    ? await db.select({ taskId: orgTaskDependenciesTable.taskId, status: orgTasksTable.status })
        .from(orgTaskDependenciesTable)
        .innerJoin(orgTasksTable, eq(orgTasksTable.id, orgTaskDependenciesTable.dependsOnTaskId))
        .where(and(eq(orgTaskDependenciesTable.orgId, ctx.org.id), inArray(orgTaskDependenciesTable.taskId, ids)))
    : [];

  // Project rows are needed for the per-task permission flags.
  const projectIds = [...new Set(rows.map((r) => r.task.projectId).filter((x): x is number => x != null))];
  const projects = projectIds.length ? await db.select().from(orgProjectsTable).where(and(eq(orgProjectsTable.orgId, ctx.org.id), inArray(orgProjectsTable.id, projectIds))) : [];
  const projectById = new Map(projects.map((p) => [p.id, p]));

  res.json({
    tasks: rows.map(({ task, ...rest }) => ({
      ...task, ...rest,
      blockedByOpenDependencies: deps.some((d) => d.taskId === task.id && d.status !== "completed"),
      ...flags(ctx, task, task.projectId ? projectById.get(task.projectId) ?? null : null),
    })),
  });
});

const TaskSchema = z.object({
  title: z.string().trim().min(2).max(300),
  description: optionalText(10000),
  definitionOfDone: optionalText(3000),
  projectId: optionalId,
  eventId: optionalId,
  milestoneId: optionalId,
  assigneeMembershipId: optionalId,
  reviewerMembershipId: optionalId,
  dueDate: isoDate,
  priority: z.enum(PRIORITIES).default("medium"),
  status: z.enum(["backlog", "todo"]).default("todo"),
  evidenceRequired: z.boolean().default(false),
  openToClaim: z.boolean().default(false),
  claimCommitteeId: optionalId,
  dependsOn: z.array(z.coerce.number().int().positive()).max(20).default([]),
});

async function committeeInOrg(ctx: OrgContext, id: number) {
  const [c] = await db.select({ id: orgCommitteesTable.id }).from(orgCommitteesTable).where(and(eq(orgCommitteesTable.id, id), eq(orgCommitteesTable.orgId, ctx.org.id)));
  return Boolean(c);
}

async function activeMembership(ctx: OrgContext, id: number | null | undefined) {
  if (!id) return true;
  const [m] = await db.select({ id: orgMembershipsTable.id }).from(orgMembershipsTable)
    .where(and(eq(orgMembershipsTable.id, id), eq(orgMembershipsTable.orgId, ctx.org.id), eq(orgMembershipsTable.status, "active"), isNull(orgMembershipsTable.sponsorId)));
  return Boolean(m);
}

router.post("/tasks", validateBody(TaskSchema), async (req, res) => {
  const ctx = getOrg(req);
  const { dependsOn, ...body } = req.body as z.infer<typeof TaskSchema>;

  let project: OrgProject | null = null;
  if (body.projectId) {
    [project] = await db.select().from(orgProjectsTable).where(and(eq(orgProjectsTable.id, body.projectId), eq(orgProjectsTable.orgId, ctx.org.id)));
    if (!project) {
      badRequest(res, "Project not found");
      return;
    }
  }
  let allowed: boolean;
  if (project) {
    allowed = can(ctx, "tasks.assign") && (isOrgWide(ctx) || canManageProject(ctx, project)) || project.ownerMembershipId === ctx.membership.id;
  } else if (body.eventId) {
    const [event] = await db.select().from(orgEventsTable).where(and(eq(orgEventsTable.id, body.eventId), eq(orgEventsTable.orgId, ctx.org.id)));
    if (!event) {
      badRequest(res, "Event not found");
      return;
    }
    allowed = canManageEvent(ctx, event) || (can(ctx, "tasks.assign") && isOrgWide(ctx));
  } else {
    // Personal tasks: anyone may create one for themselves.
    allowed = (can(ctx, "tasks.assign") && isOrgWide(ctx)) || !body.assigneeMembershipId || body.assigneeMembershipId === ctx.membership.id;
  }
  if (!allowed) {
    forbidden(res, "You can't create tasks here");
    return;
  }
  if (body.openToClaim) {
    if (!can(ctx, "tasks.assign") && !(project && project.ownerMembershipId === ctx.membership.id)) {
      forbidden(res, "Publishing open tasks needs the tasks.assign permission");
      return;
    }
    body.assigneeMembershipId = null;
    if (body.claimCommitteeId && !(await committeeInOrg(ctx, body.claimCommitteeId))) {
      badRequest(res, "Committee not found");
      return;
    }
  } else {
    body.claimCommitteeId = null;
  }
  if (body.milestoneId) {
    const [ms] = await db.select({ projectId: orgMilestonesTable.projectId }).from(orgMilestonesTable)
      .where(and(eq(orgMilestonesTable.id, body.milestoneId), eq(orgMilestonesTable.orgId, ctx.org.id)));
    if (!ms || ms.projectId !== body.projectId) {
      badRequest(res, "Milestone not found in this project");
      return;
    }
  }
  if (!(await activeMembership(ctx, body.assigneeMembershipId)) || !(await activeMembership(ctx, body.reviewerMembershipId))) {
    badRequest(res, "Assignee or reviewer not found");
    return;
  }
  if (body.reviewerMembershipId && body.reviewerMembershipId === body.assigneeMembershipId) {
    badRequest(res, "The reviewer must be someone other than the assignee");
    return;
  }
  if (dependsOn.length) {
    const found = await db.select({ id: orgTasksTable.id }).from(orgTasksTable).where(and(eq(orgTasksTable.orgId, ctx.org.id), inArray(orgTasksTable.id, dependsOn)));
    if (found.length !== new Set(dependsOn).size) {
      badRequest(res, "Dependency task not found");
      return;
    }
  }

  const [{ maxPos }] = await db.select({ maxPos: sql<number>`coalesce(max(${orgTasksTable.position}), 0)` }).from(orgTasksTable)
    .where(and(eq(orgTasksTable.orgId, ctx.org.id), eq(orgTasksTable.status, body.status)));
  const task = await db.transaction(async (tx) => {
    const [task] = await tx.insert(orgTasksTable).values({
      ...body, orgId: ctx.org.id, createdByMembershipId: ctx.membership.id, position: Number(maxPos) + 1,
    }).returning();
    if (dependsOn.length) {
      await tx.insert(orgTaskDependenciesTable).values([...new Set(dependsOn)].map((d) => ({ orgId: ctx.org.id, taskId: task.id, dependsOnTaskId: d })));
    }
    // Assignees join the project team so they can see its context.
    if (project && body.assigneeMembershipId) {
      await tx.insert(orgProjectMembersTable).values({ orgId: ctx.org.id, projectId: project.id, membershipId: body.assigneeMembershipId }).onConflictDoNothing();
    }
    return task;
  });
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "task.created", entityType: "task", entityId: task.id, summary: task.title, after: { assigneeMembershipId: task.assigneeMembershipId, dueDate: task.dueDate } });
  notifyMembers(ctx.org.id, ctx.org.slug, [task.assigneeMembershipId], ctx.userId, {
    type: "task.assigned", title: `New task: ${task.title}`, body: task.dueDate ? `Due ${task.dueDate}` : undefined, link: `/tasks/${task.id}`, email: true,
  });
  res.status(201).json({ task });
});

// Take an open task. Atomic: if two people click at once, only the first gets it.
router.post("/tasks/:id/claim", async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const found = await loadTask(ctx, id);
  if (!found) {
    // It may have just been taken (and so dropped out of your view): say so rather than "not found".
    const [raw] = id ? await db.select({ open: orgTasksTable.openToClaim, committee: orgTasksTable.claimCommitteeId }).from(orgTasksTable)
      .where(and(eq(orgTasksTable.id, id), eq(orgTasksTable.orgId, ctx.org.id))) : [];
    if (raw?.open && can(ctx, "tasks.view") && (raw.committee == null || ctx.committeeIds.includes(raw.committee))) conflict(res, "Someone has already taken this task");
    else notFound(res, "Task");
    return;
  }
  const { task, project } = found;
  if (!canClaim(ctx, task)) {
    if (task.openToClaim && task.assigneeMembershipId != null) conflict(res, "Someone has already taken this task");
    else forbidden(res, "This task isn't open for you to take");
    return;
  }
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx.update(orgTasksTable)
      .set({ assigneeMembershipId: ctx.membership.id, status: "todo", updatedAt: new Date() })
      .where(and(eq(orgTasksTable.id, task.id), eq(orgTasksTable.orgId, ctx.org.id), isNull(orgTasksTable.assigneeMembershipId)))
      .returning();
    if (row && project) {
      await tx.insert(orgProjectMembersTable).values({ orgId: ctx.org.id, projectId: project.id, membershipId: ctx.membership.id }).onConflictDoNothing();
    }
    return row;
  });
  if (!claimed) {
    conflict(res, "Someone has already taken this task");
    return;
  }
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "task.claimed", entityType: "task", entityId: task.id, summary: task.title, after: { assigneeMembershipId: ctx.membership.id } });
  notifyMembers(ctx.org.id, ctx.org.slug, [task.createdByMembershipId], ctx.userId, {
    type: "task.claimed", title: `Open task taken: ${task.title}`, link: `/tasks/${task.id}`,
  });
  res.json({ task: claimed });
});

// Give an open task back so someone else can take it.
router.post("/tasks/:id/release", async (req, res) => {
  const ctx = getOrg(req);
  const found = await loadTask(ctx, idParam(req));
  if (!found) {
    notFound(res, "Task");
    return;
  }
  const { task, project } = found;
  if (!flags(ctx, task, project).canRelease) {
    forbidden(res, "Only the person who took this open task can give it back");
    return;
  }
  const [row] = await db.update(orgTasksTable)
    .set({ assigneeMembershipId: null, status: "todo", updatedAt: new Date() })
    .where(and(eq(orgTasksTable.id, task.id), eq(orgTasksTable.orgId, ctx.org.id), eq(orgTasksTable.assigneeMembershipId, ctx.membership.id)))
    .returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "task.released", entityType: "task", entityId: task.id, summary: task.title, before: { assigneeMembershipId: ctx.membership.id } });
  res.json({ task: row });
});

router.get("/tasks/:id", async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const found = await loadTask(ctx, id);
  if (!found) {
    notFound(res, "Task");
    return;
  }
  const { task, project } = found;
  const [[detail], comments, dependencies, dependents, history] = await Promise.all([
    taskQuery().where(eq(orgTasksTable.id, task.id)),
    db.select({ comment: orgTaskCommentsTable, authorName: usersTable.fullName, authorAvatar: usersTable.avatarUrl, fileName: orgFilesTable.fileName, fileSize: orgFilesTable.size })
      .from(orgTaskCommentsTable)
      .leftJoin(orgFilesTable, and(eq(orgFilesTable.id, orgTaskCommentsTable.fileId), eq(orgFilesTable.orgId, orgTaskCommentsTable.orgId)))
      .leftJoin(orgMembershipsTable, eq(orgMembershipsTable.id, orgTaskCommentsTable.authorMembershipId))
      .leftJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
      .where(and(eq(orgTaskCommentsTable.orgId, ctx.org.id), eq(orgTaskCommentsTable.taskId, task.id)))
      .orderBy(asc(orgTaskCommentsTable.createdAt)),
    db.select({ id: orgTasksTable.id, title: orgTasksTable.title, status: orgTasksTable.status })
      .from(orgTaskDependenciesTable).innerJoin(orgTasksTable, eq(orgTasksTable.id, orgTaskDependenciesTable.dependsOnTaskId))
      .where(and(eq(orgTaskDependenciesTable.orgId, ctx.org.id), eq(orgTaskDependenciesTable.taskId, task.id))),
    db.select({ id: orgTasksTable.id, title: orgTasksTable.title, status: orgTasksTable.status })
      .from(orgTaskDependenciesTable).innerJoin(orgTasksTable, eq(orgTasksTable.id, orgTaskDependenciesTable.taskId))
      .where(and(eq(orgTaskDependenciesTable.orgId, ctx.org.id), eq(orgTaskDependenciesTable.dependsOnTaskId, task.id))),
    db.select({ event: orgAuditEventsTable, actorName: usersTable.fullName })
      .from(orgAuditEventsTable).leftJoin(usersTable, eq(usersTable.id, orgAuditEventsTable.actorUserId))
      .where(and(eq(orgAuditEventsTable.orgId, ctx.org.id), eq(orgAuditEventsTable.entityType, "task"), eq(orgAuditEventsTable.entityId, task.id)))
      .orderBy(asc(orgAuditEventsTable.createdAt)),
  ]);
  const { task: _t, ...names } = detail;
  res.json({
    task: { ...task, ...names },
    comments: comments.map(({ comment, ...a }) => ({ ...comment, ...a })),
    dependencies, dependents,
    history: history.map(({ event, actorName }) => ({ ...event, actorName })),
    ...flags(ctx, task, project),
  });
});

const UpdateTaskSchema = TaskSchema.omit({ status: true, dependsOn: true, projectId: true }).extend({
  status: z.enum(DIRECT_STATUSES).optional(),
  position: z.number().finite().optional(),
  reason: z.string().trim().max(1000).optional(),
});

router.patch("/tasks/:id", validatePatch(UpdateTaskSchema), async (req, res) => {
  const ctx = getOrg(req);
  const found = await loadTask(ctx, idParam(req));
  if (!found) {
    notFound(res, "Task");
    return;
  }
  const { task, project } = found;
  const { reason, ...patch } = req.body as z.infer<typeof UpdateTaskSchema>;
  const f = flags(ctx, task, project);
  const fieldKeys = Object.keys(patch).filter((k) => k !== "status" && k !== "position");

  // Assignees may move their own task between working states; anything else
  // (reassigning, dates, cancelling) needs edit rights.
  if (fieldKeys.length && !f.canEdit) {
    forbidden(res, "Only the task's manager can change these details");
    return;
  }
  if (patch.claimCommitteeId && !(await committeeInOrg(ctx, patch.claimCommitteeId))) {
    badRequest(res, "Committee not found");
    return;
  }
  if (patch.status !== undefined && patch.status !== task.status) {
    if (!f.canChangeStatus) {
      forbidden(res);
      return;
    }
    if (patch.status === "cancelled" && !f.canEdit) {
      forbidden(res, "Only the task's manager can cancel it");
      return;
    }
    if (task.status === "in_review") {
      conflict(res, "This task is awaiting review — approve or return it instead");
      return;
    }
    // Reopening validated work is itself a validation decision.
    if (task.status === "completed" && (!canValidateTask(ctx, task, project) || !reason)) {
      forbidden(res, "Reopening a completed task needs a reviewer and a reason");
      return;
    }
    if (patch.status === "in_progress" && (await hasOpenDependencies(ctx, task.id))) {
      conflict(res, "Finish this task's dependencies first");
      return;
    }
  }
  const nextAssignee = patch.assigneeMembershipId !== undefined ? patch.assigneeMembershipId : task.assigneeMembershipId;
  const nextReviewer = patch.reviewerMembershipId !== undefined ? patch.reviewerMembershipId : task.reviewerMembershipId;
  if (nextReviewer && nextReviewer === nextAssignee) {
    badRequest(res, "The reviewer must be someone other than the assignee");
    return;
  }
  if (!(await activeMembership(ctx, patch.assigneeMembershipId)) || !(await activeMembership(ctx, patch.reviewerMembershipId))) {
    badRequest(res, "Assignee or reviewer not found");
    return;
  }
  if (patch.milestoneId) {
    const [ms] = await db.select({ projectId: orgMilestonesTable.projectId }).from(orgMilestonesTable)
      .where(and(eq(orgMilestonesTable.id, patch.milestoneId), eq(orgMilestonesTable.orgId, ctx.org.id)));
    if (!ms || ms.projectId !== task.projectId) {
      badRequest(res, "Milestone not found in this project");
      return;
    }
  }

  const set: Partial<OrgTask> = { ...patch, updatedAt: new Date() };
  if (patch.status && task.status === "completed") Object.assign(set, { completedAt: null, validatedAt: null, validatedByMembershipId: null });
  const { position: _p, ...auditable } = patch;
  const changes = diff(task, auditable);
  const [updated] = await db.update(orgTasksTable).set(set).where(eq(orgTasksTable.id, task.id)).returning();

  if (Object.keys(changes.after).length) {
    const action = changes.after.status ? "task.status_changed"
      : changes.after.assigneeMembershipId !== undefined ? "task.reassigned"
      : changes.after.dueDate !== undefined ? "task.due_date_changed" : "task.updated";
    await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action, entityType: "task", entityId: task.id, summary: updated.title, reason: reason || null, ...changes });
  }
  if (changes.after.assigneeMembershipId) {
    if (task.projectId) {
      await db.insert(orgProjectMembersTable).values({ orgId: ctx.org.id, projectId: task.projectId, membershipId: changes.after.assigneeMembershipId as number }).onConflictDoNothing();
    }
    notifyMembers(ctx.org.id, ctx.org.slug, [changes.after.assigneeMembershipId as number], ctx.userId, {
      type: "task.assigned", title: `New task: ${updated.title}`, link: `/tasks/${task.id}`, email: true,
    });
  }
  res.json({ task: updated });
});

async function hasOpenDependencies(ctx: OrgContext, taskId: number) {
  const [row] = await db.select({ id: orgTasksTable.id }).from(orgTaskDependenciesTable)
    .innerJoin(orgTasksTable, eq(orgTasksTable.id, orgTaskDependenciesTable.dependsOnTaskId))
    .where(and(eq(orgTaskDependenciesTable.orgId, ctx.org.id), eq(orgTaskDependenciesTable.taskId, taskId), ne(orgTasksTable.status, "completed")))
    .limit(1);
  return Boolean(row);
}

// Who gets the "please review" notification: the named reviewer, otherwise the project's managers.
async function reviewRecipients(ctx: OrgContext, task: OrgTask) {
  if (task.reviewerMembershipId) return [task.reviewerMembershipId];
  if (!task.projectId) return [task.createdByMembershipId];
  const managers = await db.select({ id: orgProjectMembersTable.membershipId }).from(orgProjectMembersTable)
    .where(and(eq(orgProjectMembersTable.orgId, ctx.org.id), eq(orgProjectMembersTable.projectId, task.projectId), eq(orgProjectMembersTable.role, "manager")));
  return managers.map((m) => m.id).filter((id) => id !== task.assigneeMembershipId);
}

const SubmitSchema = z.object({ note: optionalText(5000) });

router.post("/tasks/:id/submit", validateBody(SubmitSchema), async (req, res) => {
  const ctx = getOrg(req);
  const found = await loadTask(ctx, idParam(req));
  if (!found) {
    notFound(res, "Task");
    return;
  }
  const { task, project } = found;
  if (!flags(ctx, task, project).canSubmit) {
    forbidden(res, task.status === "in_review" ? "Already submitted for review" : "You can't submit this task");
    return;
  }
  if (await hasOpenDependencies(ctx, task.id)) {
    conflict(res, "Finish this task's dependencies first");
    return;
  }
  if (task.evidenceRequired) {
    const [evidence] = await db.select({ id: orgTaskCommentsTable.id }).from(orgTaskCommentsTable)
      .where(and(eq(orgTaskCommentsTable.orgId, ctx.org.id), eq(orgTaskCommentsTable.taskId, task.id), eq(orgTaskCommentsTable.kind, "evidence"))).limit(1);
    if (!evidence) {
      badRequest(res, "This task requires evidence — add a file link or proof before submitting");
      return;
    }
  }
  const now = new Date();
  const [updated] = await db.update(orgTasksTable)
    .set({ status: "in_review", submittedAt: now, submittedByMembershipId: ctx.membership.id, updatedAt: now })
    .where(and(eq(orgTasksTable.id, task.id), eq(orgTasksTable.status, task.status)))
    .returning();
  if (!updated) {
    conflict(res, "The task changed while you were submitting it — reload and try again");
    return;
  }
  if (req.body.note) {
    await db.insert(orgTaskCommentsTable).values({ orgId: ctx.org.id, taskId: task.id, authorMembershipId: ctx.membership.id, kind: "comment", body: req.body.note });
  }
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "task.submitted", entityType: "task", entityId: task.id, summary: task.title, before: { status: task.status }, after: { status: "in_review" } });
  notifyMembers(ctx.org.id, ctx.org.slug, await reviewRecipients(ctx, task), ctx.userId, {
    type: "task.review_requested", title: `Review requested: ${task.title}`, link: `/tasks/${task.id}`, email: true,
  });
  res.json({ task: updated });
});

const ReviewSchema = z.object({
  decision: z.enum(["approve", "return"]),
  reason: z.string().trim().max(3000).optional(),
}).refine((v) => v.decision === "approve" || (v.reason && v.reason.length >= 3), { message: "Explain what needs to change", path: ["reason"] });

router.post("/tasks/:id/review", validateBody(ReviewSchema), async (req, res) => {
  const ctx = getOrg(req);
  const found = await loadTask(ctx, idParam(req));
  if (!found) {
    notFound(res, "Task");
    return;
  }
  const { task, project } = found;
  if (task.status !== "in_review") {
    conflict(res, "This task isn't awaiting review");
    return;
  }
  if (!canValidateTask(ctx, task, project)) {
    forbidden(res, task.assigneeMembershipId === ctx.membership.id ? "You can't validate your own task" : "You can't validate this task");
    return;
  }
  const { decision, reason } = req.body as z.infer<typeof ReviewSchema>;
  const now = new Date();
  const set = decision === "approve"
    ? { status: "completed" as const, validatedAt: now, validatedByMembershipId: ctx.membership.id, completedAt: now, updatedAt: now }
    : { status: "in_progress" as const, updatedAt: now };
  const [updated] = await db.update(orgTasksTable).set(set)
    .where(and(eq(orgTasksTable.id, task.id), eq(orgTasksTable.status, "in_review"))).returning();
  if (!updated) {
    conflict(res, "This task was already reviewed");
    return;
  }
  await db.insert(orgTaskCommentsTable).values({
    orgId: ctx.org.id, taskId: task.id, authorMembershipId: ctx.membership.id,
    kind: decision === "approve" ? "review_approved" : "review_returned", body: reason || null,
  });
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId, action: decision === "approve" ? "task.approved" : "task.returned",
    entityType: "task", entityId: task.id, summary: task.title, reason: reason || null,
    before: { status: "in_review" }, after: { status: updated.status, submittedBy: task.submittedByMembershipId },
  });
  // Approved work earns the assignee points (once per task, if the rule is on).
  if (decision === "approve" && task.assigneeMembershipId) {
    await applyRule(ctx.org.id, ctx.org.slug, "task_approved", task.assigneeMembershipId, "task", task.id, `Task approved: ${task.title}`);
  }
  notifyMembers(ctx.org.id, ctx.org.slug, [task.assigneeMembershipId, task.submittedByMembershipId], ctx.userId, decision === "approve"
    ? { type: "task.approved", title: `Approved: ${task.title}`, link: `/tasks/${task.id}`, email: true }
    : { type: "task.returned", title: `Changes requested: ${task.title}`, body: reason, link: `/tasks/${task.id}`, email: true });
  res.json({ task: updated });
});

const CommentSchema = z.object({
  kind: z.enum(["comment", "evidence"]).default("comment"),
  body: optionalText(5000),
  url: httpUrl.max(2000).nullish().transform((v) => v ?? null),
}).refine((v) => v.body || v.url, { message: "Write a comment or add a link" });

router.post("/tasks/:id/comments", validateBody(CommentSchema), async (req, res) => {
  const ctx = getOrg(req);
  const found = await loadTask(ctx, idParam(req));
  if (!found) {
    notFound(res, "Task");
    return;
  }
  const { task, project } = found;
  const f = flags(ctx, task, project);
  if (req.body.kind === "evidence" && !f.isAssignee && !f.canEdit) {
    forbidden(res, "Only the assignee or the task's manager can add evidence");
    return;
  }
  const [comment] = await db.insert(orgTaskCommentsTable).values({
    orgId: ctx.org.id, taskId: task.id, authorMembershipId: ctx.membership.id, kind: req.body.kind, body: req.body.body, url: req.body.url,
  }).returning();
  if (req.body.kind === "evidence") {
    await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "task.evidence_added", entityType: "task", entityId: task.id, summary: task.title, after: { url: comment.url } });
  }
  notifyMembers(ctx.org.id, ctx.org.slug, [task.assigneeMembershipId, task.reviewerMembershipId, task.createdByMembershipId], ctx.userId, {
    type: "task.comment", title: `New ${req.body.kind === "evidence" ? "evidence" : "comment"} on "${task.title}"`, body: comment.body ?? undefined, link: `/tasks/${task.id}`,
  });
  res.status(201).json({ comment });
});

// ── Dependencies ────────────────────────────────────────────────────────────

router.post("/tasks/:id/dependencies", validateBody(z.object({ dependsOnTaskId: z.coerce.number().int().positive() })), async (req, res) => {
  const ctx = getOrg(req);
  const found = await loadTask(ctx, idParam(req));
  if (!found) {
    notFound(res, "Task");
    return;
  }
  if (!canEditTask(ctx, found.task, found.project)) {
    forbidden(res);
    return;
  }
  const dependsOn = await loadTask(ctx, req.body.dependsOnTaskId);
  if (!dependsOn || dependsOn.task.id === found.task.id) {
    badRequest(res, "Dependency task not found");
    return;
  }
  // Reject cycles: the new prerequisite must not (transitively) depend on this task.
  const cycle = await db.execute<{ id: number }>(sql`
    with recursive chain as (
      select depends_on_task_id as id from ${orgTaskDependenciesTable} where task_id = ${dependsOn.task.id} and org_id = ${ctx.org.id}
      union
      select d.depends_on_task_id from ${orgTaskDependenciesTable} d join chain c on d.task_id = c.id where d.org_id = ${ctx.org.id}
    )
    select id from chain where id = ${found.task.id} limit 1`);
  if (cycle.rows.length) {
    badRequest(res, "That would create a circular dependency");
    return;
  }
  await db.insert(orgTaskDependenciesTable).values({ orgId: ctx.org.id, taskId: found.task.id, dependsOnTaskId: dependsOn.task.id }).onConflictDoNothing();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "task.dependency_added", entityType: "task", entityId: found.task.id, summary: found.task.title, after: { dependsOnTaskId: dependsOn.task.id } });
  res.status(201).json({ success: true });
});

router.delete("/tasks/:id/dependencies/:dependsOnId", async (req, res) => {
  const ctx = getOrg(req);
  const found = await loadTask(ctx, idParam(req));
  const dependsOnId = idParam(req, "dependsOnId");
  if (!found || !dependsOnId) {
    notFound(res, "Task");
    return;
  }
  if (!canEditTask(ctx, found.task, found.project)) {
    forbidden(res);
    return;
  }
  await db.delete(orgTaskDependenciesTable).where(and(
    eq(orgTaskDependenciesTable.orgId, ctx.org.id), eq(orgTaskDependenciesTable.taskId, found.task.id), eq(orgTaskDependenciesTable.dependsOnTaskId, dependsOnId),
  ));
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "task.dependency_removed", entityType: "task", entityId: found.task.id, summary: found.task.title, before: { dependsOnTaskId: dependsOnId } });
  res.json({ success: true });
});

// Due-soon list for the dashboard and reminders (next 7 days, still open).
export async function dueSoonForMember(ctx: OrgContext) {
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  return db.select({ id: orgTasksTable.id, title: orgTasksTable.title, dueDate: orgTasksTable.dueDate, status: orgTasksTable.status, priority: orgTasksTable.priority })
    .from(orgTasksTable)
    .where(and(eq(orgTasksTable.orgId, ctx.org.id), eq(orgTasksTable.assigneeMembershipId, ctx.membership.id),
      inArray(orgTasksTable.status, [...OPEN]), gte(orgTasksTable.dueDate, today()), lte(orgTasksTable.dueDate, in7)))
    .orderBy(asc(orgTasksTable.dueDate));
}

export { taskVisibility };
export default router;
