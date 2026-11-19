import { Router, type IRouter } from "express";
import { db, orgMembershipDuesTable, orgMembershipsTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "../../middlewares/validate.js";
import { getOrg } from "../../lib/org/context.js";
import { recordOrgAudit } from "../../lib/org/audit.js";
import { notifyMembers } from "../../lib/org/notify.js";
import { canManageDues, duesSummary, duesYear, feeSchedule } from "../../lib/org/dues.js";
import { conflict, forbidden, idParam, notFound, optionalText } from "./util.js";

const router: IRouter = Router({ mergeParams: true });

// Fee schedule for the organisation (visible to every member).
router.get("/dues/fees", (req, res) => {
  const ctx = getOrg(req);
  res.json({ fees: feeSchedule(ctx.org), year: duesYear(ctx.org), canManage: canManageDues(ctx) });
});

// My own dues status — the profile page.
router.get("/dues/me", async (req, res) => {
  const ctx = getOrg(req);
  res.json({ ...(await duesSummary(ctx.org, ctx.membership.id)), canManage: canManageDues(ctx) });
});

async function findMember(orgId: number, id: number | null) {
  if (!id) return null;
  const [m] = await db.select({ id: orgMembershipsTable.id, userId: orgMembershipsTable.userId, fullName: usersTable.fullName })
    .from(orgMembershipsTable).innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
    .where(and(eq(orgMembershipsTable.id, id), eq(orgMembershipsTable.orgId, orgId)));
  return m ?? null;
}

router.get("/members/:id/dues", async (req, res) => {
  const ctx = getOrg(req);
  const m = await findMember(ctx.org.id, idParam(req));
  if (!m || (m.id !== ctx.membership.id && !canManageDues(ctx))) {
    notFound(res, "Member");
    return;
  }
  res.json({ ...(await duesSummary(ctx.org, m.id)), canManage: canManageDues(ctx) });
});

const PaySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  method: z.enum(["cash", "bank_transfer", "card", "mobile_money", "other"]).nullish().transform((v) => v ?? null),
  reference: optionalText(120),
  note: optionalText(500),
});

// Mark a member as paid for a year (default: the current one). The amount follows the
// schedule: joining + annual if they've never paid before, otherwise the annual fee.
router.post("/members/:id/dues", validateBody(PaySchema), async (req, res) => {
  const ctx = getOrg(req);
  if (!canManageDues(ctx)) {
    forbidden(res);
    return;
  }
  const m = await findMember(ctx.org.id, idParam(req));
  if (!m) {
    notFound(res, "Member");
    return;
  }
  const body = req.body as z.infer<typeof PaySchema>;
  const year = body.year ?? duesYear(ctx.org);
  const fees = feeSchedule(ctx.org);
  const [prior] = await db.select({ id: orgMembershipDuesTable.id }).from(orgMembershipDuesTable)
    .where(and(eq(orgMembershipDuesTable.orgId, ctx.org.id), eq(orgMembershipDuesTable.membershipId, m.id))).limit(1);
  const first = !prior;
  const amount = first ? fees.firstYearTotal : fees.renewalFee;
  try {
    const [row] = await db.insert(orgMembershipDuesTable).values({
      orgId: ctx.org.id, membershipId: m.id, year, amount: amount.toFixed(2), includesJoiningFee: first,
      method: body.method, reference: body.reference, note: body.note, recordedByMembershipId: ctx.membership.id,
    }).returning();
    await recordOrgAudit({
      orgId: ctx.org.id, actorUserId: ctx.userId, action: "dues.paid", entityType: "membership", entityId: m.id,
      summary: `${m.fullName} — ${year}: ${amount.toFixed(2)} ${fees.currency}${first ? " (incl. joining fee)" : ""}`,
    });
    notifyMembers(ctx.org.id, ctx.org.slug, [m.id], ctx.userId, {
      type: "dues.paid", title: `Membership ${year} confirmed — you're a verified member`, link: "/profile",
    });
    res.status(201).json({ dues: { ...row, amount: Number(row.amount) } });
  } catch (err: any) {
    if ((err?.code ?? err?.cause?.code) === "23505") {
      conflict(res, `Already marked as paid for ${year}`);
      return;
    }
    throw err;
  }
});

// Undo a payment record (e.g. marked by mistake). The member loses the badge for that year.
router.delete("/members/:id/dues/:year", async (req, res) => {
  const ctx = getOrg(req);
  if (!canManageDues(ctx)) {
    forbidden(res);
    return;
  }
  const m = await findMember(ctx.org.id, idParam(req));
  const year = Number(req.params.year);
  if (!m || !Number.isInteger(year)) {
    notFound(res, "Member");
    return;
  }
  const [row] = await db.delete(orgMembershipDuesTable)
    .where(and(eq(orgMembershipDuesTable.orgId, ctx.org.id), eq(orgMembershipDuesTable.membershipId, m.id), eq(orgMembershipDuesTable.year, year)))
    .returning();
  if (!row) {
    notFound(res, "Payment");
    return;
  }
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId, action: "dues.unpaid", entityType: "membership", entityId: m.id,
    summary: `${m.fullName} — ${year}: payment record removed`,
  });
  res.json({ success: true });
});

export default router;
