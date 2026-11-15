import { Router, type IRouter } from "express";
import {
  db, orgAuditEventsTable, orgNotificationsTable, orgMembershipsTable, orgTasksTable, orgProjectsTable, orgEventsTable,
  orgCommitteeMembersTable, orgRegionsTable, usersTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, lt, gte, lte, notInArray, sql, count, desc, asc, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "../../middlewares/validate.js";
import { getOrg, can, isOrgWide, projectVisibility } from "../../lib/org/context.js";
import { taskVisibility, dueSoonForMember } from "./tasks.js";
import { topPerformers } from "./performance.js";

// Dashboard, audit/activity log and in-app notifications.

const router: IRouter = Router({ mergeParams: true });

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);

// One call for the dashboard; each section is only present when the caller's
// role allows it, so the client renders whatever comes back.
router.get("/dashboard", async (req, res) => {
  const ctx = getOrg(req);
  const me = ctx.membership.id;
  const tasksScope = await taskVisibility(ctx);

  const [myOpen, myOverdue, awaitingMyReview, dueSoon, projectsByStatus, upcomingProjects, upcomingEvents, taskStatus, overdue, trend] = await Promise.all([
    db.select({ n: count() }).from(orgTasksTable).where(and(eq(orgTasksTable.orgId, ctx.org.id), eq(orgTasksTable.assigneeMembershipId, me), notInArray(orgTasksTable.status, ["completed", "cancelled"]))),
    db.select({ n: count() }).from(orgTasksTable).where(and(eq(orgTasksTable.orgId, ctx.org.id), eq(orgTasksTable.assigneeMembershipId, me), lt(orgTasksTable.dueDate, today()), notInArray(orgTasksTable.status, ["completed", "cancelled"]))),
    db.select({ id: orgTasksTable.id, title: orgTasksTable.title, submittedAt: orgTasksTable.submittedAt }).from(orgTasksTable)
      .where(and(tasksScope, eq(orgTasksTable.status, "in_review"), sql`${orgTasksTable.assigneeMembershipId} is distinct from ${me}`, or(eq(orgTasksTable.reviewerMembershipId, me), and(isNull(orgTasksTable.reviewerMembershipId), can(ctx, "tasks.validate") ? sql`true` : sql`false`))))
      .orderBy(asc(orgTasksTable.submittedAt)).limit(8),
    dueSoonForMember(ctx),
    db.select({ status: orgProjectsTable.status, n: count() }).from(orgProjectsTable).where(projectVisibility(ctx)).groupBy(orgProjectsTable.status),
    db.select({ id: orgProjectsTable.id, title: orgProjectsTable.title, endDate: orgProjectsTable.endDate, status: orgProjectsTable.status }).from(orgProjectsTable)
      .where(and(projectVisibility(ctx), inArray(orgProjectsTable.status, ["planned", "active", "on_hold"]), gte(orgProjectsTable.endDate, today())))
      .orderBy(asc(orgProjectsTable.endDate)).limit(5),
    db.select({ id: orgEventsTable.id, title: orgEventsTable.title, startsAt: orgEventsTable.startsAt, venue: orgEventsTable.venue, type: orgEventsTable.type, status: orgEventsTable.status })
      .from(orgEventsTable)
      .where(and(eq(orgEventsTable.orgId, ctx.org.id), gte(orgEventsTable.startsAt, new Date()), sql`${orgEventsTable.status} <> 'cancelled'`,
        can(ctx, "events.view") && isOrgWide(ctx) ? sql`true` : or(
          eq(orgEventsTable.organiserMembershipId, me),
          and(isNull(orgEventsTable.committeeId), isNull(orgEventsTable.projectId)),
          ctx.committeeIds.length ? inArray(orgEventsTable.committeeId, ctx.committeeIds) : sql`false`,
          ctx.projectIds.length ? inArray(orgEventsTable.projectId, ctx.projectIds) : sql`false`,
        )))
      .orderBy(asc(orgEventsTable.startsAt)).limit(5),
    db.select({ status: orgTasksTable.status, n: count() }).from(orgTasksTable).where(tasksScope).groupBy(orgTasksTable.status),
    db.select({ n: count() }).from(orgTasksTable).where(and(tasksScope, lt(orgTasksTable.dueDate, today()), notInArray(orgTasksTable.status, ["completed", "cancelled"]))),
    db.select({ month: sql<string>`to_char(date_trunc('month', ${orgTasksTable.completedAt}), 'YYYY-MM')`, n: count() }).from(orgTasksTable)
      .where(and(tasksScope, eq(orgTasksTable.status, "completed"), gte(orgTasksTable.completedAt, daysAgo(183))))
      .groupBy(sql`1`).orderBy(sql`1`),
  ]);

  const body: Record<string, unknown> = {
    personal: {
      openTasks: Number(myOpen[0].n), overdueTasks: Number(myOverdue[0].n), awaitingMyReview, dueSoon,
    },
    projects: {
      byStatus: Object.fromEntries(projectsByStatus.map((r) => [r.status, Number(r.n)])),
      upcomingDeadlines: upcomingProjects,
    },
    events: { upcoming: upcomingEvents },
    tasks: {
      byStatus: Object.fromEntries(taskStatus.map((r) => [r.status, Number(r.n)])),
      overdue: Number(overdue[0].n),
      completedByMonth: trend.map((r) => ({ month: r.month, count: Number(r.n) })),
    },
  };

  // People metrics: organisation-wide, or limited to a coordinator's region.
  if (can(ctx, "members.view") && (isOrgWide(ctx) || ctx.scope === "region")) {
    const scope: SQL = isOrgWide(ctx)
      ? eq(orgMembershipsTable.orgId, ctx.org.id)
      : and(eq(orgMembershipsTable.orgId, ctx.org.id), ctx.regionIds.length ? inArray(orgMembershipsTable.regionId, ctx.regionIds) : sql`false`)!;
    const inactiveCutoff = daysAgo(90);
    const [byStatus, newJoiners, inactive, byRegion, byCommittee] = await Promise.all([
      db.select({ status: orgMembershipsTable.status, n: count() }).from(orgMembershipsTable).where(scope).groupBy(orgMembershipsTable.status),
      db.select({ n: count() }).from(orgMembershipsTable).where(and(scope, gte(orgMembershipsTable.joinedAt, daysAgo(30)))),
      db.select({ n: count() }).from(orgMembershipsTable).where(and(scope, eq(orgMembershipsTable.status, "active"), lt(orgMembershipsTable.joinedAt, inactiveCutoff),
        or(isNull(orgMembershipsTable.lastActiveAt), lt(orgMembershipsTable.lastActiveAt, inactiveCutoff)))),
      db.select({ regionId: orgMembershipsTable.regionId, name: orgRegionsTable.name, n: count() }).from(orgMembershipsTable)
        .leftJoin(orgRegionsTable, eq(orgRegionsTable.id, orgMembershipsTable.regionId))
        .where(and(scope, eq(orgMembershipsTable.status, "active"))).groupBy(orgMembershipsTable.regionId, orgRegionsTable.name)
        .orderBy(desc(count())),
      isOrgWide(ctx)
        ? db.select({ committeeId: orgCommitteeMembersTable.committeeId, n: count() }).from(orgCommitteeMembersTable)
            .where(eq(orgCommitteeMembersTable.orgId, ctx.org.id)).groupBy(orgCommitteeMembersTable.committeeId)
        : Promise.resolve([]),
    ]);
    const statusCounts = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)]));
    body.people = {
      scope: isOrgWide(ctx) ? "organisation" : "region",
      total: Object.entries(statusCounts).filter(([s]) => s !== "left").reduce((a, [, n]) => a + n, 0),
      byStatus: statusCounts,
      newJoiners: Number(newJoiners[0].n),
      inactive90d: Number(inactive[0].n),
      byRegion: byRegion.map((r) => ({ regionId: r.regionId, name: r.name, count: Number(r.n) })),
      byCommittee: byCommittee.map((r) => ({ committeeId: r.committeeId, count: Number(r.n) })),
    };
  }

  // Workload by assignee across everything the caller can see.
  if (can(ctx, "tasks.assign") || isOrgWide(ctx)) {
    const workload = await db.select({ membershipId: orgTasksTable.assigneeMembershipId, fullName: usersTable.fullName, avatarUrl: usersTable.avatarUrl, n: count() })
      .from(orgTasksTable)
      .innerJoin(orgMembershipsTable, eq(orgMembershipsTable.id, orgTasksTable.assigneeMembershipId))
      .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
      .where(and(tasksScope, inArray(orgTasksTable.status, ["todo", "in_progress", "in_review", "blocked"])))
      .groupBy(orgTasksTable.assigneeMembershipId, usersTable.fullName, usersTable.avatarUrl)
      .orderBy(desc(count())).limit(8);
    (body.tasks as any).workload = workload.map((w) => ({ ...w, count: Number(w.n) }));
  }

  body.topPerformers = await topPerformers(ctx.org.id);
  body.recentActivity = await recentActivity(ctx.org.id, can(ctx, "audit.view") ? null : ctx.userId, 8);
  res.json(body);
});

async function recentActivity(orgId: number, onlyActor: number | null, limit: number, before?: number, entityType?: string) {
  const conds: SQL[] = [eq(orgAuditEventsTable.orgId, orgId)];
  if (onlyActor) conds.push(eq(orgAuditEventsTable.actorUserId, onlyActor));
  if (before) conds.push(lt(orgAuditEventsTable.id, before));
  if (entityType) conds.push(eq(orgAuditEventsTable.entityType, entityType));
  const rows = await db.select({ event: orgAuditEventsTable, actorName: usersTable.fullName, actorAvatar: usersTable.avatarUrl })
    .from(orgAuditEventsTable)
    .leftJoin(usersTable, eq(usersTable.id, orgAuditEventsTable.actorUserId))
    .where(and(...conds))
    .orderBy(desc(orgAuditEventsTable.id))
    .limit(limit);
  return rows.map(({ event, ...a }) => ({ ...event, ...a }));
}

// Full audit log needs audit.view; everyone else sees their own actions.
router.get("/activity", async (req, res) => {
  const ctx = getOrg(req);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const before = Number(req.query.before) || undefined;
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType.slice(0, 40) : undefined;
  const full = can(ctx, "audit.view");
  const events = await recentActivity(ctx.org.id, full ? null : ctx.userId, limit, before, entityType);
  res.json({ events, full });
});

router.get("/notifications", async (req, res) => {
  const ctx = getOrg(req);
  const rows = await db.select().from(orgNotificationsTable)
    .where(and(eq(orgNotificationsTable.orgId, ctx.org.id), eq(orgNotificationsTable.userId, ctx.userId)))
    .orderBy(desc(orgNotificationsTable.createdAt)).limit(50);
  const [{ n }] = await db.select({ n: count() }).from(orgNotificationsTable)
    .where(and(eq(orgNotificationsTable.orgId, ctx.org.id), eq(orgNotificationsTable.userId, ctx.userId), isNull(orgNotificationsTable.readAt)));
  res.json({ notifications: rows, unread: Number(n) });
});

router.post("/notifications/read", validateBody(z.object({ ids: z.array(z.number().int().positive()).max(200).optional() })), async (req, res) => {
  const ctx = getOrg(req);
  const conds: SQL[] = [eq(orgNotificationsTable.orgId, ctx.org.id), eq(orgNotificationsTable.userId, ctx.userId), isNull(orgNotificationsTable.readAt)];
  if (req.body.ids?.length) conds.push(inArray(orgNotificationsTable.id, req.body.ids));
  await db.update(orgNotificationsTable).set({ readAt: new Date() }).where(and(...conds));
  res.json({ success: true });
});

// Calendar feed: events plus task due dates in a window, for the calendar view.
router.get("/calendar", async (req, res) => {
  const ctx = getOrg(req);
  const from = new Date(String(req.query.from || ""));
  const to = new Date(String(req.query.to || ""));
  if (isNaN(+from) || isNaN(+to) || +to - +from > 120 * 86400000) {
    res.status(400).json({ error: "BadRequest", message: "Provide a from/to window of at most 120 days" });
    return;
  }
  const tasks = await db.select({ id: orgTasksTable.id, title: orgTasksTable.title, dueDate: orgTasksTable.dueDate, status: orgTasksTable.status, priority: orgTasksTable.priority })
    .from(orgTasksTable)
    .where(and(await taskVisibility(ctx), gte(orgTasksTable.dueDate, from.toISOString().slice(0, 10)), lte(orgTasksTable.dueDate, to.toISOString().slice(0, 10))));
  res.json({ tasks });
});

export default router;
