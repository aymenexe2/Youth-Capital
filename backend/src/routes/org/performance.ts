import { Router, type IRouter } from "express";
import {
  db, orgPointEventsTable, orgPointSettingsTable, orgPointRulesTable, orgAchievementsTable, orgMemberAchievementsTable,
  orgReviewCasesTable, orgMembershipsTable, orgCommitteeMembersTable, orgRegionsTable, usersTable,
} from "@workspace/db";
import { and, eq, gte, inArray, desc, sql, sum, count, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "../../middlewares/validate.js";
import { getOrg, can, isOrgWide, colleagueMembershipIds, requirePerm, type OrgContext } from "../../lib/org/context.js";
import { recordOrgAudit, diff } from "../../lib/org/audit.js";
import { notifyMembers } from "../../lib/org/notify.js";
import { getRules, getSettings, recordPoints, recheckMember, memberTotal, openReviewCase, reviewerMembershipIds, RULE_KEYS } from "../../lib/org/points.js";
import { httpUrl } from "../../validation/common.js";
import { badRequest, conflict, forbidden, idParam, notFound, optionalText, validatePatch } from "./util.js";

// Performance (brief §7): points, leaderboard, badges and membership review cases.

const router: IRouter = Router({ mergeParams: true });

const PERIODS: Record<string, number | null> = { all: null, month: 30, quarter: 91, year: 365 };

async function activeMember(ctx: OrgContext, membershipId: number) {
  const [m] = await db.select().from(orgMembershipsTable)
    .where(and(eq(orgMembershipsTable.id, membershipId), eq(orgMembershipsTable.orgId, ctx.org.id)));
  return m ?? null;
}

// Committee heads with performance.manage act within their committees only.
async function canManagePointsFor(ctx: OrgContext, membershipId: number) {
  if (!can(ctx, "performance.manage")) return false;
  if (membershipId === ctx.membership.id) return false; // nobody adjusts their own score, admins included
  if (isOrgWide(ctx)) return true;
  return (await colleagueMembershipIds(ctx)).has(membershipId);
}

router.get("/performance/me", async (req, res) => {
  const ctx = getOrg(req);
  const [total, history, rules, settings, badges, cases] = await Promise.all([
    memberTotal(ctx.org.id, ctx.membership.id),
    db.select({ event: orgPointEventsTable, actorName: usersTable.fullName }).from(orgPointEventsTable)
      .leftJoin(usersTable, eq(usersTable.id, orgPointEventsTable.actorUserId))
      .where(and(eq(orgPointEventsTable.orgId, ctx.org.id), eq(orgPointEventsTable.membershipId, ctx.membership.id)))
      .orderBy(desc(orgPointEventsTable.createdAt)).limit(100),
    getRules(ctx.org.id),
    getSettings(ctx.org.id),
    db.select({ a: orgAchievementsTable, awardedAt: orgMemberAchievementsTable.awardedAt, reason: orgMemberAchievementsTable.reason })
      .from(orgMemberAchievementsTable).innerJoin(orgAchievementsTable, eq(orgAchievementsTable.id, orgMemberAchievementsTable.achievementId))
      .where(and(eq(orgMemberAchievementsTable.orgId, ctx.org.id), eq(orgMemberAchievementsTable.membershipId, ctx.membership.id))),
    db.select().from(orgReviewCasesTable)
      .where(and(eq(orgReviewCasesTable.orgId, ctx.org.id), eq(orgReviewCasesTable.membershipId, ctx.membership.id)))
      .orderBy(desc(orgReviewCasesTable.createdAt)).limit(5),
  ]);
  // Rank among active members, organisation-wide.
  const [{ rank }] = (await db.execute<{ rank: number }>(sql`
    select count(*) + 1 as rank from (
      select m.id, coalesce(sum(p.points), 0) as total from ${orgMembershipsTable} m
      left join ${orgPointEventsTable} p on p.membership_id = m.id
      where m.org_id = ${ctx.org.id} and m.status = 'active' group by m.id
    ) t where t.total > ${total}`)).rows as any;
  res.json({
    total, rank: Number(rank),
    history: history.map(({ event, actorName }) => ({ ...event, actorName })),
    rules, settings: { enabled: settings.enabled, inactivityDays: settings.inactivityDays, reviewThreshold: settings.reviewThreshold, missedDeadlineGraceDays: settings.missedDeadlineGraceDays },
    badges: badges.map(({ a, awardedAt, reason }) => ({ ...a, awardedAt, reason })),
    reviewCases: cases,
    canManage: can(ctx, "performance.manage"), canReview: can(ctx, "performance.review"),
  });
});

router.get("/performance/leaderboard", async (req, res) => {
  const ctx = getOrg(req);
  const days = PERIODS[String(req.query.period || "all")] ?? null;
  const regionId = Number(req.query.regionId) || null;
  const committeeId = Number(req.query.committeeId) || null;

  const pointConds: SQL[] = [sql`p.membership_id = m.id`];
  if (days) pointConds.push(sql`p.created_at >= ${new Date(Date.now() - days * 86400000)}`);
  const memberConds: SQL[] = [sql`m.org_id = ${ctx.org.id}`, sql`m.status = 'active'`, sql`m.sponsor_id is null`];
  if (regionId) {
    // A region filter includes its provinces and local units.
    memberConds.push(sql`m.region_id in (
      with recursive tree as (select id from ${orgRegionsTable} where id = ${regionId} and org_id = ${ctx.org.id}
        union all select r.id from ${orgRegionsTable} r join tree t on r.parent_id = t.id)
      select id from tree)`);
  }
  if (committeeId) memberConds.push(sql`m.id in (select membership_id from ${orgCommitteeMembersTable} where committee_id = ${committeeId} and org_id = ${ctx.org.id})`);

  const rows = (await db.execute(sql`
    select m.id as "membershipId", u.full_name as "fullName", u.avatar_url as "avatarUrl", m.title, m.region_id as "regionId",
      coalesce((select sum(p.points) from ${orgPointEventsTable} p where ${sql.join(pointConds, sql` and `)}), 0)::int as points,
      (select count(*) from ${orgMemberAchievementsTable} ma where ma.membership_id = m.id)::int as badges
    from ${orgMembershipsTable} m join ${usersTable} u on u.id = m.user_id
    where ${sql.join(memberConds, sql` and `)}
    order by points desc, u.full_name asc
    limit 100`)).rows as any[];
  res.json({ leaderboard: rows.map((r, i) => ({ ...r, rank: i + 1 })) });
});

router.get("/performance/members/:id", async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const target = id ? await activeMember(ctx, id) : null;
  if (!target || (id !== ctx.membership.id && !(await canManagePointsFor(ctx, target.id)) && !can(ctx, "performance.review"))) {
    notFound(res, "Member");
    return;
  }
  const [total, history, badges] = await Promise.all([
    memberTotal(ctx.org.id, target.id),
    db.select({ event: orgPointEventsTable, actorName: usersTable.fullName }).from(orgPointEventsTable)
      .leftJoin(usersTable, eq(usersTable.id, orgPointEventsTable.actorUserId))
      .where(and(eq(orgPointEventsTable.orgId, ctx.org.id), eq(orgPointEventsTable.membershipId, target.id)))
      .orderBy(desc(orgPointEventsTable.createdAt)).limit(200),
    db.select({ id: orgAchievementsTable.id, name: orgAchievementsTable.name, icon: orgAchievementsTable.icon, color: orgAchievementsTable.color, awardedAt: orgMemberAchievementsTable.awardedAt })
      .from(orgMemberAchievementsTable).innerJoin(orgAchievementsTable, eq(orgAchievementsTable.id, orgMemberAchievementsTable.achievementId))
      .where(eq(orgMemberAchievementsTable.membershipId, target.id)),
  ]);
  const canEditPoints = await canManagePointsFor(ctx, target.id);
  res.json({ total, history: history.map(({ event, actorName }) => ({ ...event, actorName })), badges, canEditPoints });
});

// Manual awards and adjustments always need a written reason.
const AdjustSchema = z.object({
  membershipId: z.coerce.number().int().positive(),
  ruleKey: z.enum(RULE_KEYS as [string, ...string[]]).nullish(),
  points: z.coerce.number().int().min(-1000).max(1000).optional(),
  reason: z.string().trim().min(3).max(1000),
  sourceType: z.enum(["manual", "project", "event", "task"]).default("manual"),
  sourceId: z.coerce.number().int().positive().nullish(),
  evidenceUrl: httpUrl.max(2000).nullish(),
}).refine((v) => v.ruleKey || (v.points !== undefined && v.points !== 0), { message: "Choose a rule or enter a points amount", path: ["points"] });

router.post("/performance/adjustments", validateBody(AdjustSchema), async (req, res) => {
  const ctx = getOrg(req);
  const body = req.body as z.infer<typeof AdjustSchema>;
  const target = await activeMember(ctx, body.membershipId);
  if (!target || target.status !== "active") {
    notFound(res, "Member");
    return;
  }
  if (!(await canManagePointsFor(ctx, target.id))) {
    forbidden(res, target.id === ctx.membership.id ? "You can't adjust your own points" : "You can't adjust points for this member");
    return;
  }
  let points = body.points ?? 0;
  if (body.ruleKey) {
    const rule = (await getRules(ctx.org.id)).find((r) => r.key === body.ruleKey)!;
    if (!rule.enabled) {
      badRequest(res, "That rule is switched off for this organisation");
      return;
    }
    points = body.points ?? rule.points;
  }
  const event = await recordPoints({
    orgId: ctx.org.id, orgSlug: ctx.org.slug, membershipId: target.id, points, reason: body.reason, ruleKey: body.ruleKey ?? null,
    sourceType: body.sourceType, sourceId: body.sourceId ?? null, evidenceUrl: body.evidenceUrl ?? null, actorUserId: ctx.userId,
  });
  if (!event) {
    conflict(res, "These points were already awarded for this source");
    return;
  }
  res.status(201).json({ event });
});

// Correct an awarded point entry (wrong amount, wrong reason) or remove it.
// Same people who can award points to that member; never on your own entries; the
// change and its reason go to the audit log with the before/after values.
async function loadPointEvent(ctx: OrgContext, id: number | null) {
  if (!id) return null;
  const [e] = await db.select().from(orgPointEventsTable).where(and(eq(orgPointEventsTable.id, id), eq(orgPointEventsTable.orgId, ctx.org.id)));
  return e ?? null;
}

const EditPointsSchema = z.object({
  points: z.coerce.number().int().min(-1000).max(1000).refine((n) => n !== 0, "Points can't be zero — delete the entry instead").optional(),
  reason: z.string().trim().min(3).max(1000).optional(),
  editReason: z.string().trim().min(3).max(1000),
});

router.patch("/performance/events/:id", validateBody(EditPointsSchema), async (req, res) => {
  const ctx = getOrg(req);
  const event = await loadPointEvent(ctx, idParam(req));
  if (!event || !(await canManagePointsFor(ctx, event.membershipId))) {
    notFound(res, "Point entry");
    return;
  }
  const { editReason, ...patch } = req.body as z.infer<typeof EditPointsSchema>;
  if (patch.points === undefined && patch.reason === undefined) {
    badRequest(res, "Nothing to change");
    return;
  }
  const [updated] = await db.update(orgPointEventsTable).set(patch).where(eq(orgPointEventsTable.id, event.id)).returning();
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId, action: "points.edited", entityType: "membership", entityId: event.membershipId,
    summary: `${event.points > 0 ? "+" : ""}${event.points} → ${updated.points > 0 ? "+" : ""}${updated.points}`, reason: editReason,
    before: { points: event.points, reason: event.reason }, after: { points: updated.points, reason: updated.reason },
  });
  if (updated.points !== event.points) {
    notifyMembers(ctx.org.id, ctx.org.slug, [event.membershipId], ctx.userId, {
      type: "points", title: `Points corrected: ${event.points > 0 ? "+" : ""}${event.points} → ${updated.points > 0 ? "+" : ""}${updated.points}`, body: editReason, link: "/performance",
    });
  }
  await recheckMember(ctx.org.id, ctx.org.slug, event.membershipId);
  res.json({ event: updated });
});

router.delete("/performance/events/:id", validateBody(z.object({ reason: z.string().trim().min(3).max(1000) })), async (req, res) => {
  const ctx = getOrg(req);
  const event = await loadPointEvent(ctx, idParam(req));
  if (!event || !(await canManagePointsFor(ctx, event.membershipId))) {
    notFound(res, "Point entry");
    return;
  }
  await db.delete(orgPointEventsTable).where(eq(orgPointEventsTable.id, event.id));
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId, action: "points.removed", entityType: "membership", entityId: event.membershipId,
    summary: `${event.points > 0 ? "+" : ""}${event.points} removed`, reason: req.body.reason,
    before: { points: event.points, reason: event.reason, ruleKey: event.ruleKey, sourceType: event.sourceType, sourceId: event.sourceId },
  });
  notifyMembers(ctx.org.id, ctx.org.slug, [event.membershipId], ctx.userId, {
    type: "points", title: `Points removed: ${event.points > 0 ? "+" : ""}${event.points}`, body: req.body.reason, link: "/performance",
  });
  await recheckMember(ctx.org.id, ctx.org.slug, event.membershipId);
  res.json({ success: true });
});

// ── Rules & settings ───────────────────────────────────────────────────────

router.get("/performance/rules", async (req, res) => {
  const ctx = getOrg(req);
  const settings = await getSettings(ctx.org.id);
  res.json({ rules: await getRules(ctx.org.id), settings });
});

const SettingsSchema = z.object({
  enabled: z.boolean(),
  inactivityDays: z.coerce.number().int().min(14).max(730),
  reviewThreshold: z.coerce.number().int().min(-100000).max(0),
  missedDeadlineGraceDays: z.coerce.number().int().min(0).max(60),
  rules: z.array(z.object({ key: z.enum(RULE_KEYS as [string, ...string[]]), points: z.coerce.number().int().min(-1000).max(1000), enabled: z.boolean() })).max(RULE_KEYS.length),
});

router.patch("/performance/rules", requirePerm("performance.manage"), validatePatch(SettingsSchema), async (req, res) => {
  const ctx = getOrg(req);
  if (!isOrgWide(ctx)) {
    forbidden(res, "Point rules are set organisation-wide");
    return;
  }
  const { rules, ...settingsPatch } = req.body as Partial<z.infer<typeof SettingsSchema>>;
  const before = { settings: await getSettings(ctx.org.id), rules: await getRules(ctx.org.id) };
  if (Object.keys(settingsPatch).length) {
    await db.update(orgPointSettingsTable).set({ ...settingsPatch, updatedAt: new Date() }).where(eq(orgPointSettingsTable.orgId, ctx.org.id));
  }
  for (const r of rules ?? []) {
    await db.insert(orgPointRulesTable).values({ orgId: ctx.org.id, key: r.key, points: r.points, enabled: r.enabled })
      .onConflictDoUpdate({ target: [orgPointRulesTable.orgId, orgPointRulesTable.key], set: { points: r.points, enabled: r.enabled } });
  }
  const after = { settings: await getSettings(ctx.org.id), rules: await getRules(ctx.org.id) };
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId, action: "points.rules_updated", entityType: "organisation", entityId: ctx.org.id,
    ...diff({ ...before.settings, rules: before.rules } as any, { ...settingsPatch, ...(rules ? { rules: after.rules } : {}) }),
  });
  res.json(after);
});

// ── Badges ─────────────────────────────────────────────────────────────────

router.get("/performance/achievements", async (req, res) => {
  const ctx = getOrg(req);
  const rows = await db.select({ a: orgAchievementsTable, holders: count(orgMemberAchievementsTable.id) }).from(orgAchievementsTable)
    .leftJoin(orgMemberAchievementsTable, eq(orgMemberAchievementsTable.achievementId, orgAchievementsTable.id))
    .where(eq(orgAchievementsTable.orgId, ctx.org.id)).groupBy(orgAchievementsTable.id).orderBy(orgAchievementsTable.name);
  res.json({ achievements: rows.map(({ a, holders }) => ({ ...a, holders: Number(holders) })) });
});

const AchievementSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: optionalText(300),
  icon: z.enum(["award", "trophy", "star", "medal", "flame", "rocket", "heart", "shield"]).default("award"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish().transform((v) => v ?? null),
  autoRule: z.object({ type: z.enum(["points", "tasks"]), threshold: z.coerce.number().int().min(1).max(1_000_000) }).nullish().transform((v) => v ?? null),
  archived: z.boolean().optional(),
});

router.post("/performance/achievements", requirePerm("performance.manage"), validateBody(AchievementSchema.omit({ archived: true })), async (req, res) => {
  const ctx = getOrg(req);
  const [a] = await db.insert(orgAchievementsTable).values({ ...req.body, orgId: ctx.org.id }).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "achievement.created", entityType: "achievement", entityId: a.id, summary: a.name });
  res.status(201).json({ achievement: a });
});

router.patch("/performance/achievements/:id", requirePerm("performance.manage"), validatePatch(AchievementSchema), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [a] = id ? await db.select().from(orgAchievementsTable).where(and(eq(orgAchievementsTable.id, id), eq(orgAchievementsTable.orgId, ctx.org.id))) : [];
  if (!a) {
    notFound(res, "Badge");
    return;
  }
  const { archived, ...rest } = req.body;
  const patch = { ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) };
  const [updated] = await db.update(orgAchievementsTable).set(patch).where(eq(orgAchievementsTable.id, a.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "achievement.updated", entityType: "achievement", entityId: a.id, summary: updated.name, ...diff(a, patch) });
  res.json({ achievement: updated });
});

router.post("/performance/achievements/:id/award", validateBody(z.object({ membershipId: z.coerce.number().int().positive(), reason: z.string().trim().min(3).max(500) })), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [a] = id ? await db.select().from(orgAchievementsTable).where(and(eq(orgAchievementsTable.id, id), eq(orgAchievementsTable.orgId, ctx.org.id), isNull(orgAchievementsTable.archivedAt))) : [];
  const target = a ? await activeMember(ctx, req.body.membershipId) : null;
  if (!a || !target) {
    notFound(res, "Badge or member");
    return;
  }
  if (!(await canManagePointsFor(ctx, target.id))) {
    forbidden(res);
    return;
  }
  const [row] = await db.insert(orgMemberAchievementsTable).values({ orgId: ctx.org.id, achievementId: a.id, membershipId: target.id, reason: req.body.reason, awardedByUserId: ctx.userId })
    .onConflictDoNothing().returning();
  if (!row) {
    conflict(res, "This member already has that badge");
    return;
  }
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "achievement.awarded", entityType: "membership", entityId: target.id, summary: a.name, reason: req.body.reason });
  notifyMembers(ctx.org.id, ctx.org.slug, [target.id], ctx.userId, { type: "achievement", title: `Badge earned: ${a.name}`, body: req.body.reason, link: "/performance" });
  res.status(201).json({ award: row });
});

router.delete("/performance/achievements/:id/award/:membershipId", requirePerm("performance.manage"), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const membershipId = idParam(req, "membershipId");
  const [row] = id && membershipId ? await db.select().from(orgMemberAchievementsTable)
    .where(and(eq(orgMemberAchievementsTable.orgId, ctx.org.id), eq(orgMemberAchievementsTable.achievementId, id), eq(orgMemberAchievementsTable.membershipId, membershipId))) : [];
  if (!row || !(await canManagePointsFor(ctx, membershipId!))) {
    notFound(res, "Badge award");
    return;
  }
  await db.delete(orgMemberAchievementsTable).where(eq(orgMemberAchievementsTable.id, row.id));
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "achievement.revoked", entityType: "membership", entityId: membershipId, before: row });
  res.json({ success: true });
});

// ── Review cases ───────────────────────────────────────────────────────────

const caseColumns = {
  rc: orgReviewCasesTable, fullName: usersTable.fullName, avatarUrl: usersTable.avatarUrl, membershipStatus: orgMembershipsTable.status,
};

router.get("/performance/reviews", requirePerm("performance.review"), async (req, res) => {
  const ctx = getOrg(req);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const conds: SQL[] = [eq(orgReviewCasesTable.orgId, ctx.org.id)];
  if (status === "active") conds.push(inArray(orgReviewCasesTable.status, ["open", "responded"]));
  else if (status === "resolved") conds.push(eq(orgReviewCasesTable.status, "resolved"));
  const rows = await db.select(caseColumns).from(orgReviewCasesTable)
    .innerJoin(orgMembershipsTable, eq(orgMembershipsTable.id, orgReviewCasesTable.membershipId))
    .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
    .where(and(...conds)).orderBy(desc(orgReviewCasesTable.createdAt)).limit(200);
  const totals = new Map<number, number>();
  for (const r of rows) if (!totals.has(r.rc.membershipId)) totals.set(r.rc.membershipId, await memberTotal(ctx.org.id, r.rc.membershipId));
  res.json({ cases: rows.map(({ rc, ...m }) => ({ ...rc, ...m, points: totals.get(rc.membershipId) ?? 0 })) });
});

router.post("/performance/reviews", requirePerm("performance.review"), validateBody(z.object({ membershipId: z.coerce.number().int().positive(), detail: z.string().trim().min(3).max(2000) })), async (req, res) => {
  const ctx = getOrg(req);
  const target = await activeMember(ctx, req.body.membershipId);
  if (!target) {
    notFound(res, "Member");
    return;
  }
  const rc = await openReviewCase(ctx.org.id, ctx.org.slug, target.id, "manual", req.body.detail, ctx.userId);
  if (!rc) {
    conflict(res, "This member already has an open review case");
    return;
  }
  res.status(201).json({ case: rc });
});

// The member's chance to explain before any decision (due process).
router.post("/performance/reviews/:id/respond", validateBody(z.object({ response: z.string().trim().min(3).max(3000) })), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [rc] = id ? await db.select().from(orgReviewCasesTable).where(and(eq(orgReviewCasesTable.id, id), eq(orgReviewCasesTable.orgId, ctx.org.id))) : [];
  if (!rc || rc.membershipId !== ctx.membership.id) {
    notFound(res, "Review case");
    return;
  }
  if (rc.status === "resolved") {
    conflict(res, "This case is already resolved");
    return;
  }
  const [updated] = await db.update(orgReviewCasesTable).set({ memberResponse: req.body.response, respondedAt: new Date(), status: "responded" })
    .where(eq(orgReviewCasesTable.id, rc.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "review.responded", entityType: "membership", entityId: rc.membershipId });
  notifyMembers(ctx.org.id, ctx.org.slug, await reviewerMembershipIds(ctx.org.id), ctx.userId, { type: "review.responded", title: "A member responded to their review", link: "/performance?tab=reviews" });
  res.json({ case: updated });
});

const DecideSchema = z.object({
  decision: z.enum(["no_action", "support_plan", "warning", "status_change"]),
  note: z.string().trim().min(3).max(3000),
  newStatus: z.enum(["active", "inactive", "suspended", "left"]).optional(),
}).refine((v) => v.decision !== "status_change" || v.newStatus, { message: "Choose the new membership status", path: ["newStatus"] });

router.post("/performance/reviews/:id/decide", requirePerm("performance.review"), validateBody(DecideSchema), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [rc] = id ? await db.select().from(orgReviewCasesTable).where(and(eq(orgReviewCasesTable.id, id), eq(orgReviewCasesTable.orgId, ctx.org.id))) : [];
  if (!rc) {
    notFound(res, "Review case");
    return;
  }
  if (rc.status === "resolved") {
    conflict(res, "This case is already resolved");
    return;
  }
  if (rc.membershipId === ctx.membership.id) {
    forbidden(res, "You can't decide your own review case");
    return;
  }
  const body = req.body as z.infer<typeof DecideSchema>;
  // A status change here is a recorded human decision, made through the same
  // path as any other membership status change.
  if (body.decision === "status_change") {
    const [m] = await db.select().from(orgMembershipsTable).where(eq(orgMembershipsTable.id, rc.membershipId));
    if (m.status !== body.newStatus) {
      await db.update(orgMembershipsTable).set({ status: body.newStatus }).where(eq(orgMembershipsTable.id, m.id));
      await recordOrgAudit({
        orgId: ctx.org.id, actorUserId: ctx.userId, action: "membership.status_changed", entityType: "membership", entityId: m.id,
        reason: `Review case #${rc.id}: ${body.note}`, before: { status: m.status }, after: { status: body.newStatus },
      });
    }
  }
  const [updated] = await db.update(orgReviewCasesTable)
    .set({ status: "resolved", decision: body.decision, decisionNote: body.note, decidedByUserId: ctx.userId, decidedAt: new Date() })
    .where(eq(orgReviewCasesTable.id, rc.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "review.decided", entityType: "membership", entityId: rc.membershipId, summary: body.decision, reason: body.note });
  notifyMembers(ctx.org.id, ctx.org.slug, [rc.membershipId], ctx.userId, { type: "review.decided", title: "Your membership review was decided", body: body.note, link: "/performance", email: true });
  res.json({ case: updated });
});

// Top performers this month, for the dashboard.
export async function topPerformers(orgId: number, limit = 5) {
  const since = new Date(Date.now() - 30 * 86400000);
  const rows = await db.select({ membershipId: orgPointEventsTable.membershipId, points: sum(orgPointEventsTable.points), fullName: usersTable.fullName, avatarUrl: usersTable.avatarUrl })
    .from(orgPointEventsTable)
    .innerJoin(orgMembershipsTable, eq(orgMembershipsTable.id, orgPointEventsTable.membershipId))
    .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
    .where(and(eq(orgPointEventsTable.orgId, orgId), gte(orgPointEventsTable.createdAt, since), eq(orgMembershipsTable.status, "active")))
    .groupBy(orgPointEventsTable.membershipId, usersTable.fullName, usersTable.avatarUrl)
    .orderBy(desc(sum(orgPointEventsTable.points))).limit(limit);
  return rows.map((r) => ({ ...r, points: Number(r.points) })).filter((r) => r.points > 0);
}

export default router;
