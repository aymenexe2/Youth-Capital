import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, organisationsTable, orgTasksTable, orgMembershipsTable, orgNotificationsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { notifyMembers } from "../lib/org/notify.js";
import { applyRule, getSettings, openReviewCase } from "../lib/org/points.js";

// Scheduled jobs. Vercel Cron calls GET /api/cron/daily with
// "Authorization: Bearer $CRON_SECRET" (see backend/vercel.json).

const router: IRouter = Router();
const OPEN = ["backlog", "todo", "in_progress", "blocked", "in_review"] as const;
const isoDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = String(req.headers.authorization || "");
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

// One reminder per task per kind: skip users already notified for this link.
async function alreadyNotified(orgId: number, type: string, link: string, sinceHours: number) {
  const [row] = await db.select({ id: orgNotificationsTable.id }).from(orgNotificationsTable)
    .where(and(eq(orgNotificationsTable.orgId, orgId), eq(orgNotificationsTable.type, type), eq(orgNotificationsTable.link, link),
      gte(orgNotificationsTable.createdAt, new Date(Date.now() - sinceHours * 3600000)))).limit(1);
  return Boolean(row);
}

export async function runDailyJobs() {
  const summary = { organisations: 0, dueSoon: 0, overdue: 0, penalties: 0, reviewCases: 0 };
  const orgs = await db.select().from(organisationsTable).where(eq(organisationsTable.status, "active"));
  for (const org of orgs) {
    summary.organisations++;
    const settings = await getSettings(org.id);

    // 1. Due tomorrow.
    const dueSoon = await db.select().from(orgTasksTable).where(and(eq(orgTasksTable.orgId, org.id), eq(orgTasksTable.dueDate, isoDay(1)),
      inArray(orgTasksTable.status, ["backlog", "todo", "in_progress", "blocked"]), isNotNull(orgTasksTable.assigneeMembershipId)));
    for (const t of dueSoon) {
      const link = `/tasks/${t.id}`;
      if (await alreadyNotified(org.id, "task.due_soon", link, 20)) continue;
      notifyMembers(org.id, org.slug, [t.assigneeMembershipId], 0, { type: "task.due_soon", title: `Due tomorrow: ${t.title}`, link, email: true });
      summary.dueSoon++;
    }

    // 2. Overdue: notify once, and apply the missed-deadline rule after the grace period (if enabled).
    const overdue = await db.select().from(orgTasksTable).where(and(eq(orgTasksTable.orgId, org.id), lt(orgTasksTable.dueDate, isoDay(0)),
      inArray(orgTasksTable.status, [...OPEN]), isNotNull(orgTasksTable.assigneeMembershipId)));
    for (const t of overdue) {
      const link = `/tasks/${t.id}`;
      if (!(await alreadyNotified(org.id, "task.overdue", link, 24 * 365))) {
        notifyMembers(org.id, org.slug, [t.assigneeMembershipId, t.reviewerMembershipId, t.createdByMembershipId], 0, {
          type: "task.overdue", title: `Overdue: ${t.title}`, body: `Was due ${t.dueDate}`, link, email: true,
        });
        summary.overdue++;
      }
      // Work already submitted on time-ish isn't penalised while it waits for review.
      if (t.status !== "in_review" && t.dueDate! <= isoDay(-settings.missedDeadlineGraceDays - 1)) {
        const ev = await applyRule(org.id, org.slug, "missed_deadline", t.assigneeMembershipId!, "task", t.id, `Missed deadline (${t.dueDate}): ${t.title}`);
        if (ev) summary.penalties++;
      }
    }

    // 3. Inactivity opens a review case — never an automatic status change.
    if (settings.enabled) {
      const cutoff = new Date(Date.now() - settings.inactivityDays * 86400000);
      const inactive = await db.select({ id: orgMembershipsTable.id, lastActiveAt: orgMembershipsTable.lastActiveAt }).from(orgMembershipsTable)
        .where(and(eq(orgMembershipsTable.orgId, org.id), eq(orgMembershipsTable.status, "active"), isNull(orgMembershipsTable.sponsorId), lt(orgMembershipsTable.joinedAt, cutoff),
          or(isNull(orgMembershipsTable.lastActiveAt), lt(orgMembershipsTable.lastActiveAt, cutoff))));
      for (const m of inactive) {
        const rc = await openReviewCase(org.id, org.slug, m.id, "inactivity",
          `No activity in the workspace for ${settings.inactivityDays} days${m.lastActiveAt ? ` (last active ${m.lastActiveAt.toISOString().slice(0, 10)})` : ""}.`, null);
        if (rc) summary.reviewCases++;
      }
    }
  }
  return summary;
}

router.get("/daily", async (req: Request, res: Response) => {
  if (!authorised(req)) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid cron secret" });
    return;
  }
  try {
    const summary = await runDailyJobs();
    logger.info({ summary }, "Daily jobs complete");
    res.json(summary);
  } catch (err) {
    req.log.error({ err }, "Daily jobs failed");
    res.status(500).json({ error: "Internal", message: "Daily jobs failed" });
  }
});

export default router;
