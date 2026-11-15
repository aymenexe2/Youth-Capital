import {
  db, orgPointSettingsTable, orgPointRulesTable, orgPointEventsTable, orgAchievementsTable, orgMemberAchievementsTable,
  orgReviewCasesTable, orgTasksTable, orgMembershipsTable, orgRolesTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql, sum, count } from "drizzle-orm";
import { logger } from "../logger.js";
import { recordOrgAudit } from "./audit.js";
import { notifyMembers } from "./notify.js";
import { ADMIN_ROLE_KEY } from "./permissions.js";

// Points engine (brief §7). Points recognise contribution; they never change
// membership on their own — a low score or inactivity only opens a review case.

export const RULE_DEFAULTS: { key: string; points: number; enabled: boolean; auto: boolean }[] = [
  { key: "task_approved", points: 20, enabled: true, auto: true },
  { key: "project_contribution", points: 50, enabled: true, auto: false },
  { key: "event_participation", points: 30, enabled: true, auto: false },
  { key: "leadership", points: 100, enabled: true, auto: false },
  // Deductions are opt-in: an organisation must decide its policy first.
  { key: "missed_deadline", points: -15, enabled: false, auto: true },
];
export const RULE_KEYS = RULE_DEFAULTS.map((r) => r.key);

export async function getSettings(orgId: number) {
  const [row] = await db.select().from(orgPointSettingsTable).where(eq(orgPointSettingsTable.orgId, orgId));
  if (row) return row;
  const [created] = await db.insert(orgPointSettingsTable).values({ orgId }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(orgPointSettingsTable).where(eq(orgPointSettingsTable.orgId, orgId)))[0];
}

export async function getRules(orgId: number) {
  const rows = await db.select().from(orgPointRulesTable).where(eq(orgPointRulesTable.orgId, orgId));
  return RULE_DEFAULTS.map((d) => {
    const r = rows.find((x) => x.key === d.key);
    return { key: d.key, auto: d.auto, points: r?.points ?? d.points, enabled: r?.enabled ?? d.enabled };
  });
}

export async function memberTotal(orgId: number, membershipId: number) {
  const [{ total }] = await db.select({ total: sum(orgPointEventsTable.points) }).from(orgPointEventsTable)
    .where(and(eq(orgPointEventsTable.orgId, orgId), eq(orgPointEventsTable.membershipId, membershipId)));
  return Number(total ?? 0);
}

type Award = {
  orgId: number; orgSlug: string; membershipId: number; points: number; reason: string;
  ruleKey?: string | null; sourceType: string; sourceId?: number | null; evidenceUrl?: string | null; actorUserId: number | null;
};

/** Records a point event, then runs badge and review checks. Returns null if it was a duplicate auto-award. */
export async function recordPoints(a: Award) {
  const [event] = await db.insert(orgPointEventsTable).values({
    orgId: a.orgId, membershipId: a.membershipId, ruleKey: a.ruleKey ?? null, points: a.points, reason: a.reason,
    sourceType: a.sourceType, sourceId: a.sourceId ?? null, evidenceUrl: a.evidenceUrl ?? null, actorUserId: a.actorUserId,
  }).onConflictDoNothing().returning();
  if (!event) return null;
  await recordOrgAudit({
    orgId: a.orgId, actorUserId: a.actorUserId, action: a.points >= 0 ? "points.awarded" : "points.deducted", entityType: "membership",
    entityId: a.membershipId, summary: `${a.points > 0 ? "+" : ""}${a.points}`, reason: a.reason, after: { ruleKey: a.ruleKey, sourceType: a.sourceType, sourceId: a.sourceId },
  });
  notifyMembers(a.orgId, a.orgSlug, [a.membershipId], a.actorUserId ?? 0, {
    type: "points", title: `${a.points > 0 ? "+" : ""}${a.points} points`, body: a.reason, link: "/performance",
  });
  await Promise.all([checkAutoAchievements(a.orgId, a.orgSlug, a.membershipId), checkLowScore(a.orgId, a.orgSlug, a.membershipId)]);
  return event;
}

/** Applies an enabled rule automatically (e.g. on task approval). Idempotent per source. */
export async function applyRule(orgId: number, orgSlug: string, ruleKey: string, membershipId: number, sourceType: string, sourceId: number, reason: string) {
  try {
    const settings = await getSettings(orgId);
    if (!settings.enabled) return null;
    const rule = (await getRules(orgId)).find((r) => r.key === ruleKey);
    if (!rule?.enabled || rule.points === 0) return null;
    return await recordPoints({ orgId, orgSlug, membershipId, points: rule.points, reason, ruleKey, sourceType, sourceId, actorUserId: null });
  } catch (err) {
    logger.error({ err, ruleKey }, "Failed to apply point rule");
    return null;
  }
}

async function checkAutoAchievements(orgId: number, orgSlug: string, membershipId: number) {
  const auto = await db.select().from(orgAchievementsTable)
    .where(and(eq(orgAchievementsTable.orgId, orgId), isNull(orgAchievementsTable.archivedAt), sql`${orgAchievementsTable.autoRule} is not null`));
  if (!auto.length) return;
  const held = new Set((await db.select({ id: orgMemberAchievementsTable.achievementId }).from(orgMemberAchievementsTable)
    .where(eq(orgMemberAchievementsTable.membershipId, membershipId))).map((r) => r.id));
  const pending = auto.filter((a) => !held.has(a.id));
  if (!pending.length) return;
  const total = await memberTotal(orgId, membershipId);
  const [{ tasks }] = await db.select({ tasks: count() }).from(orgTasksTable)
    .where(and(eq(orgTasksTable.orgId, orgId), eq(orgTasksTable.assigneeMembershipId, membershipId), eq(orgTasksTable.status, "completed")));
  for (const a of pending) {
    const rule = a.autoRule as { type: string; threshold: number };
    const value = rule.type === "tasks" ? Number(tasks) : total;
    if (value < rule.threshold) continue;
    const [row] = await db.insert(orgMemberAchievementsTable).values({ orgId, achievementId: a.id, membershipId, reason: "Earned automatically" })
      .onConflictDoNothing().returning();
    if (row) notifyMembers(orgId, orgSlug, [membershipId], 0, { type: "achievement", title: `Badge earned: ${a.name}`, link: "/performance" });
  }
}

// Members who can decide review cases: holders of performance.review (admins always).
export async function reviewerMembershipIds(orgId: number) {
  const rows = await db.select({ id: orgMembershipsTable.id, key: orgRolesTable.key, perms: orgRolesTable.permissions })
    .from(orgMembershipsTable).innerJoin(orgRolesTable, eq(orgRolesTable.id, orgMembershipsTable.roleId))
    .where(and(eq(orgMembershipsTable.orgId, orgId), eq(orgMembershipsTable.status, "active")));
  return rows.filter((r) => r.key === ADMIN_ROLE_KEY || r.perms.includes("performance.review")).map((r) => r.id);
}

/** Opens a review case unless one is already open. Never changes membership status. */
export async function openReviewCase(orgId: number, orgSlug: string, membershipId: number, trigger: string, detail: string, actorUserId: number | null) {
  const [open] = await db.select({ id: orgReviewCasesTable.id }).from(orgReviewCasesTable)
    .where(and(eq(orgReviewCasesTable.orgId, orgId), eq(orgReviewCasesTable.membershipId, membershipId), inArray(orgReviewCasesTable.status, ["open", "responded"])));
  if (open) return null;
  const [rc] = await db.insert(orgReviewCasesTable).values({ orgId, membershipId, trigger, detail }).returning();
  await recordOrgAudit({ orgId, actorUserId, action: "review.opened", entityType: "membership", entityId: membershipId, summary: trigger, reason: detail });
  notifyMembers(orgId, orgSlug, [membershipId], actorUserId ?? 0, {
    type: "review.opened", title: "A membership review was opened", body: "You can explain your situation before any decision is made.", link: "/performance", email: true,
  });
  notifyMembers(orgId, orgSlug, (await reviewerMembershipIds(orgId)).filter((id) => id !== membershipId), actorUserId ?? 0, {
    type: "review.opened", title: "New membership review case", body: detail, link: "/performance?tab=reviews",
  });
  return rc;
}

async function checkLowScore(orgId: number, orgSlug: string, membershipId: number) {
  const settings = await getSettings(orgId);
  if (!settings.enabled) return;
  const total = await memberTotal(orgId, membershipId);
  if (total <= settings.reviewThreshold) {
    await openReviewCase(orgId, orgSlug, membershipId, "low_score", `Score of ${total} reached the review threshold (${settings.reviewThreshold}).`, null);
  }
}
