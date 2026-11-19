import { Router, type IRouter } from "express";
import {
  db, orgEventsTable, orgCommitteesTable, orgProjectsTable, orgMembershipsTable, orgTasksTable, usersTable, type OrgEvent,
} from "@workspace/db";
import { and, eq, gte, lte, or, isNull, inArray, sql, count, type SQL } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "../../middlewares/validate.js";
import { getOrg, can, isOrgWide, visibleProjectIds, canManageEvent, canCreateEvent, type OrgContext } from "../../lib/org/context.js";
import { recordOrgAudit, diff } from "../../lib/org/audit.js";
import { notifyMembers } from "../../lib/org/notify.js";
import { optionalHttpUrl } from "../../validation/common.js";
import { badRequest, forbidden, idParam, notFound, optionalId, optionalText, validatePatch } from "./util.js";
import { findVisibleProject } from "./projects.js";

const router: IRouter = Router({ mergeParams: true });

const TYPES = ["meeting", "workshop", "conference", "forum", "training", "campaign", "other"] as const;
const STATUSES = ["planned", "confirmed", "completed", "cancelled"] as const;

// Organisation-wide events (no committee or project) are visible to everyone.
async function eventVisibility(ctx: OrgContext): Promise<SQL> {
  const tenant = eq(orgEventsTable.orgId, ctx.org.id);
  if (can(ctx, "events.view") && isOrgWide(ctx)) return tenant;
  if (!can(ctx, "events.view")) return and(tenant, eq(orgEventsTable.organiserMembershipId, ctx.membership.id))!;
  const projects = await visibleProjectIds(ctx);
  const rules: SQL[] = [
    eq(orgEventsTable.organiserMembershipId, ctx.membership.id),
    and(isNull(orgEventsTable.committeeId), isNull(orgEventsTable.projectId))!,
  ];
  if (ctx.committeeIds.length) rules.push(inArray(orgEventsTable.committeeId, ctx.committeeIds));
  if (projects === "all") rules.push(sql`${orgEventsTable.projectId} is not null`);
  else if (projects.length) rules.push(inArray(orgEventsTable.projectId, projects));
  return and(tenant, or(...rules))!;
}

async function findVisibleEvent(ctx: OrgContext, id: number | null): Promise<OrgEvent | null> {
  if (!id) return null;
  const [e] = await db.select().from(orgEventsTable).where(and(await eventVisibility(ctx), eq(orgEventsTable.id, id)));
  return e ?? null;
}

router.get("/events", async (req, res) => {
  const ctx = getOrg(req);
  const conds: SQL[] = [await eventVisibility(ctx)];
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if (from && !isNaN(+from)) conds.push(gte(orgEventsTable.startsAt, from));
  if (to && !isNaN(+to)) conds.push(lte(orgEventsTable.startsAt, to));
  const rows = await db
    .select({ event: orgEventsTable, committeeName: orgCommitteesTable.name, committeeColor: orgCommitteesTable.color, projectTitle: orgProjectsTable.title, organiserName: usersTable.fullName })
    .from(orgEventsTable)
    .leftJoin(orgCommitteesTable, eq(orgCommitteesTable.id, orgEventsTable.committeeId))
    .leftJoin(orgProjectsTable, eq(orgProjectsTable.id, orgEventsTable.projectId))
    .leftJoin(orgMembershipsTable, eq(orgMembershipsTable.id, orgEventsTable.organiserMembershipId))
    .leftJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
    .where(and(...conds))
    .orderBy(orgEventsTable.startsAt);
  res.json({
    events: rows.map(({ event, ...rest }) => ({ ...event, ...rest, canManage: canManageEvent(ctx, event) })),
    canCreate: can(ctx, "events.manage"),
  });
});

const EventSchema = z.object({
  title: z.string().trim().min(2).max(200),
  type: z.enum(TYPES).default("meeting"),
  status: z.enum(STATUSES).default("planned"),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullish().transform((v) => v ?? null),
  venue: optionalText(300),
  onlineUrl: optionalHttpUrl.transform((v) => v ?? null),
  committeeId: optionalId,
  projectId: optionalId,
  organiserMembershipId: optionalId,
  expectedAttendance: z.coerce.number().int().min(0).max(1_000_000).nullish().transform((v) => v ?? null),
  actualAttendance: z.coerce.number().int().min(0).max(1_000_000).nullish().transform((v) => v ?? null),
  agenda: optionalText(10000),
  report: optionalText(20000),
});

async function validateLinks(ctx: OrgContext, b: { committeeId?: number | null; projectId?: number | null; organiserMembershipId?: number | null }) {
  if (b.committeeId) {
    const [c] = await db.select({ id: orgCommitteesTable.id }).from(orgCommitteesTable).where(and(eq(orgCommitteesTable.id, b.committeeId), eq(orgCommitteesTable.orgId, ctx.org.id)));
    if (!c) return "Committee not found";
  }
  if (b.projectId && !(await findVisibleProject(ctx, b.projectId))) return "Project not found";
  if (b.organiserMembershipId) {
    const [m] = await db.select({ id: orgMembershipsTable.id }).from(orgMembershipsTable)
      .where(and(eq(orgMembershipsTable.id, b.organiserMembershipId), eq(orgMembershipsTable.orgId, ctx.org.id), eq(orgMembershipsTable.status, "active")));
    if (!m) return "Organiser not found";
  }
  return null;
}

router.post("/events", validateBody(EventSchema), async (req, res) => {
  const ctx = getOrg(req);
  const body = req.body as z.infer<typeof EventSchema>;
  if (!canCreateEvent(ctx, body)) {
    forbidden(res, "You can't create events for this committee or project");
    return;
  }
  const linkError = await validateLinks(ctx, body);
  if (linkError) {
    badRequest(res, linkError);
    return;
  }
  if (body.endsAt && body.endsAt < body.startsAt) {
    badRequest(res, "The event must end after it starts");
    return;
  }
  const organiser = body.organiserMembershipId ?? ctx.membership.id;
  const [event] = await db.insert(orgEventsTable).values({ ...body, orgId: ctx.org.id, organiserMembershipId: organiser, createdById: ctx.userId }).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "event.created", entityType: "event", entityId: event.id, summary: event.title });
  notifyMembers(ctx.org.id, ctx.org.slug, [organiser], ctx.userId, { type: "event.organiser", title: `You're organising "${event.title}"`, link: `/events/${event.id}`, email: true });
  res.status(201).json({ event });
});

router.get("/events/:id", async (req, res) => {
  const ctx = getOrg(req);
  const event = await findVisibleEvent(ctx, idParam(req));
  if (!event) {
    notFound(res, "Event");
    return;
  }
  const [taskStats, committee, project, organiser] = await Promise.all([
    db.select({ status: orgTasksTable.status, n: count() }).from(orgTasksTable)
      .where(and(eq(orgTasksTable.orgId, ctx.org.id), eq(orgTasksTable.eventId, event.id))).groupBy(orgTasksTable.status),
    event.committeeId ? db.select().from(orgCommitteesTable).where(eq(orgCommitteesTable.id, event.committeeId)).then((r) => r[0] ?? null) : null,
    event.projectId ? db.select({ id: orgProjectsTable.id, title: orgProjectsTable.title }).from(orgProjectsTable).where(eq(orgProjectsTable.id, event.projectId)).then((r) => r[0] ?? null) : null,
    event.organiserMembershipId
      ? db.select({ membershipId: orgMembershipsTable.id, fullName: usersTable.fullName, avatarUrl: usersTable.avatarUrl }).from(orgMembershipsTable)
          .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId)).where(eq(orgMembershipsTable.id, event.organiserMembershipId)).then((r) => r[0] ?? null)
      : null,
  ]);
  res.json({
    event, committee, project, organiser,
    taskStats: Object.fromEntries(taskStats.map((t) => [t.status, Number(t.n)])),
    canManage: canManageEvent(ctx, event),
  });
});

router.patch("/events/:id", validatePatch(EventSchema), async (req, res) => {
  const ctx = getOrg(req);
  const event = await findVisibleEvent(ctx, idParam(req));
  if (!event) {
    notFound(res, "Event");
    return;
  }
  if (!canManageEvent(ctx, event)) {
    forbidden(res);
    return;
  }
  const patch = req.body as Partial<z.infer<typeof EventSchema>>;
  const relinking = (patch.committeeId !== undefined && patch.committeeId !== event.committeeId) || (patch.projectId !== undefined && patch.projectId !== event.projectId);
  if (relinking && !canCreateEvent(ctx, { committeeId: patch.committeeId ?? event.committeeId, projectId: patch.projectId ?? event.projectId })) {
    forbidden(res, "You can't move this event to that committee or project");
    return;
  }
  const linkError = await validateLinks(ctx, patch);
  if (linkError) {
    badRequest(res, linkError);
    return;
  }
  const startsAt = patch.startsAt ?? event.startsAt;
  const endsAt = patch.endsAt !== undefined ? patch.endsAt : event.endsAt;
  if (endsAt && endsAt < startsAt) {
    badRequest(res, "The event must end after it starts");
    return;
  }
  const changes = diff(event, patch);
  const [updated] = await db.update(orgEventsTable).set({ ...patch, updatedAt: new Date() }).where(eq(orgEventsTable.id, event.id)).returning();
  if (Object.keys(changes.after).length) {
    await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "event.updated", entityType: "event", entityId: event.id, summary: updated.title, ...changes });
  }
  // People with tasks for this event hear about date/venue/status changes.
  if (changes.after.startsAt || changes.after.venue || changes.after.status) {
    const assignees = await db.select({ id: orgTasksTable.assigneeMembershipId }).from(orgTasksTable)
      .where(and(eq(orgTasksTable.orgId, ctx.org.id), eq(orgTasksTable.eventId, event.id)));
    notifyMembers(ctx.org.id, ctx.org.slug, [updated.organiserMembershipId, ...assignees.map((a) => a.id)], ctx.userId, {
      type: "event.changed", title: `"${updated.title}" was updated`, link: `/events/${event.id}`,
    });
  }
  res.json({ event: updated });
});

export default router;
