import crypto from "crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db, orgSponsorsTable, orgSponsorProjectsTable, orgSponsorUpdatesTable, orgSponsorSharesTable, orgProjectsTable, orgMilestonesTable,
  orgTasksTable, orgBudgetsTable, orgTransactionsTable, orgFilesTable, orgRolesTable, orgInvitationsTable, orgMembershipsTable, usersTable,
} from "@workspace/db";
import { and, eq, inArray, or, desc, asc, sql, isNull, isNotNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "../../middlewares/validate.js";
import { getOrg, can, requirePerm, type OrgContext } from "../../lib/org/context.js";
import { recordOrgAudit, diff } from "../../lib/org/audit.js";
import { notifyMembers } from "../../lib/org/notify.js";
import { SPONSOR_ROLE_KEY } from "../../lib/org/permissions.js";
import { isMailerConfigured, sendEmailToMany } from "../../lib/mailer.js";
import { wrapEmailHtml } from "../../lib/email-template.js";
import { manageUrl } from "../../lib/urls.js";
import { optionalHttpUrl } from "../../validation/common.js";
import { badRequest, conflict, forbidden, hashToken, idParam, notFound, optionalId, optionalText, validatePatch } from "./util.js";
import { registerFileEntity } from "./files.js";
import { sponsorHooks } from "./finance.js";

// Sponsors (brief §8). Internal routes manage sponsors, their funded projects,
// published updates and explicitly shared records. Sponsor contacts sign in
// with the "sponsor" role and can reach ONLY the /portal routes below.

const router: IRouter = Router({ mergeParams: true });

// Server-side wall for sponsor accounts: hiding menus is not security.
export function sponsorGuard(req: Request, res: Response, next: NextFunction) {
  const ctx = getOrg(req);
  if (ctx.role.key !== SPONSOR_ROLE_KEY) {
    next();
    return;
  }
  const path = req.path.replace(/\/+$/, "") || "/";
  const allowed = path === "/" || path.startsWith("/portal") || path.startsWith("/notifications");
  if (!allowed || !ctx.membership.sponsorId) {
    res.status(404).json({ error: "NotFound", message: "Not found" });
    return;
  }
  next();
}

const canViewSponsors = (ctx: OrgContext) => can(ctx, "sponsors.manage") || can(ctx, "sponsor.publish_update") || can(ctx, "finance.view");

async function findSponsor(ctx: OrgContext, id: number | null) {
  if (!id) return null;
  const [s] = await db.select().from(orgSponsorsTable).where(and(eq(orgSponsorsTable.id, id), eq(orgSponsorsTable.orgId, ctx.org.id)));
  return s ?? null;
}

sponsorHooks.registerSponsorCheck = async (ctx, id) => Boolean(await findSponsor(ctx, id));

// Money figures a sponsor may see for a project: approved budget, reported
// (posted, net of reversals) spend and their own committed/received amounts.
async function projectFinance(orgId: number, projectId: number) {
  const [row] = (await db.execute(sql`
    select
      (select coalesce(sum(approved_amount), 0) from org_budgets where org_id = ${orgId} and project_id = ${projectId} and status = 'approved') as budget,
      (select coalesce(sum(case when direction = 'out' then amount else -amount end), 0) from org_transactions
        where org_id = ${orgId} and project_id = ${projectId} and kind in ('expense','reversal') and status in ('paid','posted')
          and (kind = 'expense' or reverses_id in (select id from org_transactions where kind = 'expense'))) as spent`)).rows as any[];
  return { approvedBudget: Number(row.budget).toFixed(2), reportedSpend: Number(row.spent).toFixed(2) };
}

async function projectProgress(orgId: number, projectId: number) {
  const [t] = (await db.execute(sql`
    select count(*) filter (where status <> 'cancelled') as total, count(*) filter (where status = 'completed') as done
    from org_tasks where org_id = ${orgId} and project_id = ${projectId}`)).rows as any[];
  const total = Number(t.total), done = Number(t.done);
  return total ? Math.round((done / total) * 100) : 0;
}

async function sponsorRole(orgId: number) {
  const [role] = await db.select().from(orgRolesTable).where(and(eq(orgRolesTable.orgId, orgId), eq(orgRolesTable.key, SPONSOR_ROLE_KEY)));
  if (role) return role;
  // Organisations created before the sponsor portal get the role on first use.
  const [created] = await db.insert(orgRolesTable).values({
    orgId, key: SPONSOR_ROLE_KEY, name: "Sponsor", description: "External sponsor contact. Sees only the sponsor portal for projects they fund.",
    scope: "assigned", permissions: [], isSystem: true,
  }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(orgRolesTable).where(and(eq(orgRolesTable.orgId, orgId), eq(orgRolesTable.key, SPONSOR_ROLE_KEY))))[0];
}

// ── Internal: sponsors ─────────────────────────────────────────────────────

router.get("/sponsors", async (req, res) => {
  const ctx = getOrg(req);
  if (!canViewSponsors(ctx)) {
    forbidden(res);
    return;
  }
  const sponsors = await db.select().from(orgSponsorsTable).where(eq(orgSponsorsTable.orgId, ctx.org.id)).orderBy(asc(orgSponsorsTable.name));
  const [links, received, contacts] = await Promise.all([
    db.select({ sponsorId: orgSponsorProjectsTable.sponsorId, n: sql<number>`count(*)`, committed: sql<string>`coalesce(sum(${orgSponsorProjectsTable.committedAmount}), 0)` })
      .from(orgSponsorProjectsTable).where(eq(orgSponsorProjectsTable.orgId, ctx.org.id)).groupBy(orgSponsorProjectsTable.sponsorId),
    db.select({ sponsorId: orgTransactionsTable.sponsorId, total: sql<string>`coalesce(sum(case when direction = 'in' then amount else -amount end), 0)` })
      .from(orgTransactionsTable).where(and(eq(orgTransactionsTable.orgId, ctx.org.id), isNotNull(orgTransactionsTable.sponsorId), inArray(orgTransactionsTable.status, ["received", "posted"])))
      .groupBy(orgTransactionsTable.sponsorId),
    db.select({ sponsorId: orgMembershipsTable.sponsorId, n: sql<number>`count(*)` }).from(orgMembershipsTable)
      .where(and(eq(orgMembershipsTable.orgId, ctx.org.id), isNotNull(orgMembershipsTable.sponsorId), eq(orgMembershipsTable.status, "active"))).groupBy(orgMembershipsTable.sponsorId),
  ]);
  res.json({
    sponsors: sponsors.map((s) => ({
      ...s,
      projectCount: Number(links.find((l) => l.sponsorId === s.id)?.n ?? 0),
      committed: Number(links.find((l) => l.sponsorId === s.id)?.committed ?? 0).toFixed(2),
      received: can(ctx, "finance.view") ? Number(received.find((r) => r.sponsorId === s.id)?.total ?? 0).toFixed(2) : null,
      portalUsers: Number(contacts.find((c) => c.sponsorId === s.id)?.n ?? 0),
    })),
    canManage: can(ctx, "sponsors.manage"), canPublish: can(ctx, "sponsor.publish_update"), canShareFinance: can(ctx, "finance.approve"),
  });
});

const SponsorSchema = z.object({
  name: z.string().trim().min(2).max(160),
  logoUrl: optionalHttpUrl.transform((v) => v ?? null),
  website: optionalHttpUrl.transform((v) => v ?? null),
  contactName: optionalText(120),
  contactEmail: z.string().trim().toLowerCase().email().max(200).nullish().or(z.literal("")).transform((v) => v || null),
  description: optionalText(2000),
  status: z.enum(["active", "inactive"]).default("active"),
});

router.post("/sponsors", requirePerm("sponsors.manage"), validateBody(SponsorSchema), async (req, res) => {
  const ctx = getOrg(req);
  const [s] = await db.insert(orgSponsorsTable).values({ ...req.body, orgId: ctx.org.id }).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "sponsor.created", entityType: "sponsor", entityId: s.id, summary: s.name });
  res.status(201).json({ sponsor: s });
});

router.patch("/sponsors/:id", requirePerm("sponsors.manage"), validatePatch(SponsorSchema), async (req, res) => {
  const ctx = getOrg(req);
  const s = await findSponsor(ctx, idParam(req));
  if (!s) {
    notFound(res, "Sponsor");
    return;
  }
  const [updated] = await db.update(orgSponsorsTable).set(req.body).where(eq(orgSponsorsTable.id, s.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "sponsor.updated", entityType: "sponsor", entityId: s.id, summary: updated.name, ...diff(s, req.body) });
  res.json({ sponsor: updated });
});

router.get("/sponsors/:id", async (req, res) => {
  const ctx = getOrg(req);
  const s = canViewSponsors(ctx) ? await findSponsor(ctx, idParam(req)) : null;
  if (!s) {
    notFound(res, "Sponsor");
    return;
  }
  const [projects, contacts, shares, contributions] = await Promise.all([
    db.select({ link: orgSponsorProjectsTable, title: orgProjectsTable.title, status: orgProjectsTable.status }).from(orgSponsorProjectsTable)
      .innerJoin(orgProjectsTable, eq(orgProjectsTable.id, orgSponsorProjectsTable.projectId))
      .where(and(eq(orgSponsorProjectsTable.orgId, ctx.org.id), eq(orgSponsorProjectsTable.sponsorId, s.id))),
    db.select({ membershipId: orgMembershipsTable.id, fullName: usersTable.fullName, email: usersTable.email, status: orgMembershipsTable.status, joinedAt: orgMembershipsTable.joinedAt })
      .from(orgMembershipsTable).innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
      .where(and(eq(orgMembershipsTable.orgId, ctx.org.id), eq(orgMembershipsTable.sponsorId, s.id))),
    db.select({ share: orgSponsorSharesTable, sharedBy: usersTable.fullName }).from(orgSponsorSharesTable)
      .leftJoin(orgMembershipsTable, eq(orgMembershipsTable.id, orgSponsorSharesTable.sharedByMembershipId))
      .leftJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
      .where(and(eq(orgSponsorSharesTable.orgId, ctx.org.id), eq(orgSponsorSharesTable.sponsorId, s.id))).orderBy(desc(orgSponsorSharesTable.createdAt)),
    can(ctx, "finance.view")
      ? db.select().from(orgTransactionsTable).where(and(eq(orgTransactionsTable.orgId, ctx.org.id), eq(orgTransactionsTable.sponsorId, s.id))).orderBy(desc(orgTransactionsTable.date))
      : Promise.resolve(null),
  ]);
  // Describe shared items so the publication log is readable.
  const txIds = shares.filter((x) => x.share.entityType === "transaction").map((x) => x.share.entityId);
  const fileIds = shares.filter((x) => x.share.entityType === "file").map((x) => x.share.entityId);
  const [txs, files] = await Promise.all([
    txIds.length ? db.select({ id: orgTransactionsTable.id, reference: orgTransactionsTable.reference, amount: orgTransactionsTable.amount, description: orgTransactionsTable.description }).from(orgTransactionsTable).where(inArray(orgTransactionsTable.id, txIds)) : ([] as any[]),
    fileIds.length ? db.select({ id: orgFilesTable.id, fileName: orgFilesTable.fileName }).from(orgFilesTable).where(inArray(orgFilesTable.id, fileIds)) : ([] as any[]),
  ]);
  res.json({
    sponsor: s,
    projects: projects.map(({ link, ...p }) => ({ ...link, ...p })),
    contacts, contributions,
    shares: shares.map(({ share, sharedBy }) => ({
      ...share, sharedBy,
      label: share.entityType === "transaction" ? (() => { const t = txs.find((x) => x.id === share.entityId); return t ? `${t.reference} · ${t.amount} · ${t.description}` : `#${share.entityId}`; })()
        : files.find((f) => f.id === share.entityId)?.fileName ?? `#${share.entityId}`,
    })),
  });
});

router.post("/sponsors/:id/projects", requirePerm("sponsors.manage"), validateBody(z.object({
  projectId: z.coerce.number().int().positive(),
  committedAmount: z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", ".")).refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), "Invalid amount").transform((v) => Number(v).toFixed(2)),
  notes: optionalText(1000),
})), async (req, res) => {
  const ctx = getOrg(req);
  const s = await findSponsor(ctx, idParam(req));
  const [p] = s ? await db.select().from(orgProjectsTable).where(and(eq(orgProjectsTable.id, req.body.projectId), eq(orgProjectsTable.orgId, ctx.org.id))) : [];
  if (!s || !p) {
    notFound(res, "Sponsor or project");
    return;
  }
  const [link] = await db.insert(orgSponsorProjectsTable)
    .values({ orgId: ctx.org.id, sponsorId: s.id, projectId: p.id, committedAmount: req.body.committedAmount, currency: ctx.org.currency, notes: req.body.notes })
    .onConflictDoUpdate({ target: [orgSponsorProjectsTable.sponsorId, orgSponsorProjectsTable.projectId], set: { committedAmount: req.body.committedAmount, notes: req.body.notes } })
    .returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "sponsor.project_linked", entityType: "sponsor", entityId: s.id, summary: `${s.name} → ${p.title}`, after: req.body });
  res.status(201).json({ link });
});

router.delete("/sponsors/:id/projects/:projectId", requirePerm("sponsors.manage"), async (req, res) => {
  const ctx = getOrg(req);
  const s = await findSponsor(ctx, idParam(req));
  const projectId = idParam(req, "projectId");
  if (!s || !projectId) {
    notFound(res, "Sponsor");
    return;
  }
  await db.delete(orgSponsorProjectsTable).where(and(eq(orgSponsorProjectsTable.sponsorId, s.id), eq(orgSponsorProjectsTable.projectId, projectId), eq(orgSponsorProjectsTable.orgId, ctx.org.id)));
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "sponsor.project_unlinked", entityType: "sponsor", entityId: s.id, before: { projectId } });
  res.json({ success: true });
});

// Portal access for a sponsor contact: an invitation into the sponsor role.
router.post("/sponsors/:id/contacts", requirePerm("sponsors.manage"), validateBody(z.object({ email: z.string().trim().toLowerCase().email().max(200) })), async (req, res) => {
  const ctx = getOrg(req);
  const s = await findSponsor(ctx, idParam(req));
  if (!s) {
    notFound(res, "Sponsor");
    return;
  }
  const [existing] = await db.select({ id: orgMembershipsTable.id, sponsorId: orgMembershipsTable.sponsorId }).from(orgMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
    .where(and(eq(orgMembershipsTable.orgId, ctx.org.id), sql`lower(${usersTable.email}) = ${req.body.email}`, sql`${orgMembershipsTable.status} <> 'left'`));
  if (existing) {
    conflict(res, existing.sponsorId ? "This person already has portal access" : "This person is an internal member — use a separate email for portal access");
    return;
  }
  const role = await sponsorRole(ctx.org.id);
  const token = crypto.randomBytes(32).toString("base64url");
  await db.update(orgInvitationsTable).set({ revokedAt: new Date() })
    .where(and(eq(orgInvitationsTable.orgId, ctx.org.id), eq(orgInvitationsTable.email, req.body.email), isNull(orgInvitationsTable.acceptedAt), isNull(orgInvitationsTable.revokedAt)));
  const [inv] = await db.insert(orgInvitationsTable).values({
    orgId: ctx.org.id, email: req.body.email, roleId: role.id, sponsorId: s.id, title: `Sponsor contact — ${s.name}`, tokenHash: hashToken(token),
    invitedById: ctx.userId, expiresAt: new Date(Date.now() + 14 * 86400000),
  }).returning();
  const link = `${manageUrl()}/invite/${token}`;
  let emailed = false;
  if (isMailerConfigured) {
    const clean = (v: string) => v.replace(/[<>&"]/g, "");
    const [r] = await sendEmailToMany([req.body.email], `Your ${ctx.org.name} sponsor portal`, wrapEmailHtml(
      `<p style="font-size:16px;font-weight:600;margin:0 0 8px">Follow the projects you support</p>` +
      `<p style="margin:0 0 16px">${clean(ctx.org.name)} has given ${clean(s.name)} access to its sponsor portal. Sign in with this email address (or create an account with it) to accept. The link expires in 14 days.</p>` +
      `<p><a href="${link}">Open the sponsor portal</a></p>`));
    emailed = Boolean(r?.success);
  }
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "sponsor.contact_invited", entityType: "sponsor", entityId: s.id, summary: req.body.email, after: { invitationId: inv.id } });
  res.status(201).json({ link, emailed });
});

// ── Internal: updates & shares ─────────────────────────────────────────────

router.get("/sponsor-updates", async (req, res) => {
  const ctx = getOrg(req);
  if (!canViewSponsors(ctx)) {
    forbidden(res);
    return;
  }
  const projectId = Number(req.query.projectId) || null;
  const rows = await db.select({ u: orgSponsorUpdatesTable, projectTitle: orgProjectsTable.title }).from(orgSponsorUpdatesTable)
    .innerJoin(orgProjectsTable, eq(orgProjectsTable.id, orgSponsorUpdatesTable.projectId))
    .where(and(eq(orgSponsorUpdatesTable.orgId, ctx.org.id), ...(projectId ? [eq(orgSponsorUpdatesTable.projectId, projectId)] : [])))
    .orderBy(desc(orgSponsorUpdatesTable.createdAt)).limit(200);
  res.json({ updates: rows.map(({ u, projectTitle }) => ({ ...u, projectTitle })) });
});

const UpdateSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(3).max(10000),
  visibility: z.enum(["project_sponsors", "named", "public"]).default("project_sponsors"),
  sponsorIds: z.array(z.coerce.number().int().positive()).max(50).default([]),
});

async function validSponsorIds(ctx: OrgContext, ids: number[]) {
  if (!ids.length) return true;
  const rows = await db.select({ id: orgSponsorsTable.id }).from(orgSponsorsTable).where(and(eq(orgSponsorsTable.orgId, ctx.org.id), inArray(orgSponsorsTable.id, ids)));
  return rows.length === new Set(ids).size;
}

router.post("/sponsor-updates", requirePerm("sponsor.publish_update"), validateBody(UpdateSchema), async (req, res) => {
  const ctx = getOrg(req);
  const body = req.body as z.infer<typeof UpdateSchema>;
  const [p] = await db.select({ id: orgProjectsTable.id }).from(orgProjectsTable).where(and(eq(orgProjectsTable.id, body.projectId), eq(orgProjectsTable.orgId, ctx.org.id)));
  if (!p || !(await validSponsorIds(ctx, body.sponsorIds))) {
    badRequest(res, "Project or sponsor not found");
    return;
  }
  if (body.visibility === "named" && !body.sponsorIds.length) {
    badRequest(res, "Choose at least one sponsor for a named update");
    return;
  }
  const [u] = await db.insert(orgSponsorUpdatesTable).values({ ...body, orgId: ctx.org.id, createdByMembershipId: ctx.membership.id }).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "sponsor.update_drafted", entityType: "sponsor_update", entityId: u.id, summary: u.title });
  res.status(201).json({ update: u });
});

router.patch("/sponsor-updates/:id", requirePerm("sponsor.publish_update"), validatePatch(UpdateSchema.omit({ projectId: true })), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [u] = id ? await db.select().from(orgSponsorUpdatesTable).where(and(eq(orgSponsorUpdatesTable.id, id), eq(orgSponsorUpdatesTable.orgId, ctx.org.id))) : [];
  if (!u) {
    notFound(res, "Update");
    return;
  }
  if (req.body.sponsorIds && !(await validSponsorIds(ctx, req.body.sponsorIds))) {
    badRequest(res, "Sponsor not found");
    return;
  }
  const [updated] = await db.update(orgSponsorUpdatesTable).set(req.body).where(eq(orgSponsorUpdatesTable.id, u.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "sponsor.update_edited", entityType: "sponsor_update", entityId: u.id, summary: updated.title, ...diff(u, req.body) });
  res.json({ update: updated });
});

router.post("/sponsor-updates/:id/publish", requirePerm("sponsor.publish_update"), validateBody(z.object({ publish: z.boolean() })), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [u] = id ? await db.select().from(orgSponsorUpdatesTable).where(and(eq(orgSponsorUpdatesTable.id, id), eq(orgSponsorUpdatesTable.orgId, ctx.org.id))) : [];
  if (!u) {
    notFound(res, "Update");
    return;
  }
  const [updated] = await db.update(orgSponsorUpdatesTable).set(req.body.publish
    ? { status: "published", publishedByMembershipId: ctx.membership.id, publishedAt: new Date() }
    : { status: "draft" }).where(eq(orgSponsorUpdatesTable.id, u.id)).returning();
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: req.body.publish ? "sponsor.update_published" : "sponsor.update_unpublished", entityType: "sponsor_update", entityId: u.id, summary: u.title, after: { visibility: u.visibility, sponsorIds: u.sponsorIds } });
  if (req.body.publish) {
    const audience = await updateAudienceMemberships(ctx.org.id, updated);
    notifyMembers(ctx.org.id, ctx.org.slug, audience, ctx.userId, { type: "sponsor.update", title: `New update: ${u.title}`, link: "/portal", email: true });
  }
  res.json({ update: updated });
});

async function updateAudienceMemberships(orgId: number, u: typeof orgSponsorUpdatesTable.$inferSelect) {
  const sponsorIds = u.visibility === "named" ? u.sponsorIds
    : (await db.select({ id: orgSponsorProjectsTable.sponsorId }).from(orgSponsorProjectsTable).where(and(eq(orgSponsorProjectsTable.orgId, orgId), eq(orgSponsorProjectsTable.projectId, u.projectId)))).map((r) => r.id);
  if (!sponsorIds.length) return [];
  const rows = await db.select({ id: orgMembershipsTable.id }).from(orgMembershipsTable)
    .where(and(eq(orgMembershipsTable.orgId, orgId), inArray(orgMembershipsTable.sponsorId, sponsorIds), eq(orgMembershipsTable.status, "active")));
  return rows.map((r) => r.id);
}

// Files attached to an update (photos, reports) — visible to whoever can see the update.
registerFileEntity("sponsor_update", {
  canRead: async (ctx, id) => {
    const [u] = await db.select().from(orgSponsorUpdatesTable).where(and(eq(orgSponsorUpdatesTable.id, id), eq(orgSponsorUpdatesTable.orgId, ctx.org.id)));
    if (!u) return false;
    if (ctx.role.key !== SPONSOR_ROLE_KEY) return canViewSponsors(ctx);
    return u.status === "published" && (await updateVisibleTo(ctx, u));
  },
  canWrite: async (ctx, id) => {
    if (!can(ctx, "sponsor.publish_update")) return false;
    const [u] = await db.select({ id: orgSponsorUpdatesTable.id }).from(orgSponsorUpdatesTable).where(and(eq(orgSponsorUpdatesTable.id, id), eq(orgSponsorUpdatesTable.orgId, ctx.org.id)));
    return Boolean(u);
  },
});

// Sharing internal records with a sponsor. Financial records need the finance
// team's approval right as well as publishing rights.
router.post("/sponsors/:id/shares", requirePerm("sponsor.publish_update"), validateBody(z.object({ entityType: z.enum(["transaction", "file"]), entityId: z.coerce.number().int().positive() })), async (req, res) => {
  const ctx = getOrg(req);
  const s = await findSponsor(ctx, idParam(req));
  if (!s) {
    notFound(res, "Sponsor");
    return;
  }
  const funded = (await db.select({ projectId: orgSponsorProjectsTable.projectId }).from(orgSponsorProjectsTable).where(eq(orgSponsorProjectsTable.sponsorId, s.id))).map((r) => r.projectId);
  let projectId: number | null = null;
  let financial = req.body.entityType === "transaction";
  if (req.body.entityType === "transaction") {
    const [t] = await db.select().from(orgTransactionsTable).where(and(eq(orgTransactionsTable.id, req.body.entityId), eq(orgTransactionsTable.orgId, ctx.org.id)));
    if (!t) { notFound(res, "Transaction"); return; }
    projectId = t.projectId;
  } else {
    const [f] = await db.select().from(orgFilesTable).where(and(eq(orgFilesTable.id, req.body.entityId), eq(orgFilesTable.orgId, ctx.org.id)));
    if (!f) { notFound(res, "File"); return; }
    if (f.entityType === "transaction") {
      financial = true; // receipts and invoices are financial evidence
      const [t] = await db.select({ projectId: orgTransactionsTable.projectId }).from(orgTransactionsTable).where(eq(orgTransactionsTable.id, f.entityId));
      projectId = t?.projectId ?? null;
    } else if (f.entityType === "task") {
      const [t] = await db.select({ projectId: orgTasksTable.projectId }).from(orgTasksTable).where(eq(orgTasksTable.id, f.entityId));
      projectId = t?.projectId ?? null;
    }
  }
  if (financial && !can(ctx, "finance.approve")) {
    forbidden(res, "The finance team must approve sharing financial records");
    return;
  }
  // Only material from projects this sponsor funds can be shared with them.
  if (projectId === null || !funded.includes(projectId)) {
    badRequest(res, "Only records from projects this sponsor funds can be shared with them");
    return;
  }
  const [share] = await db.insert(orgSponsorSharesTable).values({ orgId: ctx.org.id, sponsorId: s.id, entityType: req.body.entityType, entityId: req.body.entityId, sharedByMembershipId: ctx.membership.id })
    .onConflictDoNothing().returning();
  if (!share) {
    conflict(res, "Already shared with this sponsor");
    return;
  }
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "sponsor.shared", entityType: "sponsor", entityId: s.id, summary: `${req.body.entityType} #${req.body.entityId}`, after: req.body });
  res.status(201).json({ share });
});

router.delete("/sponsor-shares/:id", requirePerm("sponsor.publish_update"), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [share] = id ? await db.select().from(orgSponsorSharesTable).where(and(eq(orgSponsorSharesTable.id, id), eq(orgSponsorSharesTable.orgId, ctx.org.id))) : [];
  if (!share) {
    notFound(res, "Share");
    return;
  }
  await db.delete(orgSponsorSharesTable).where(eq(orgSponsorSharesTable.id, share.id));
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "sponsor.unshared", entityType: "sponsor", entityId: share.sponsorId, before: share });
  res.json({ success: true });
});

// ── Sponsor portal (sponsor role only) ─────────────────────────────────────

async function updateVisibleTo(ctx: OrgContext, u: typeof orgSponsorUpdatesTable.$inferSelect) {
  const sponsorId = ctx.membership.sponsorId!;
  if (u.visibility === "named") return u.sponsorIds.includes(sponsorId);
  const [link] = await db.select({ id: orgSponsorProjectsTable.id }).from(orgSponsorProjectsTable)
    .where(and(eq(orgSponsorProjectsTable.sponsorId, sponsorId), eq(orgSponsorProjectsTable.projectId, u.projectId)));
  return Boolean(link);
}

function requireSponsor(req: Request, res: Response, next: NextFunction) {
  const ctx = getOrg(req);
  if (ctx.role.key !== SPONSOR_ROLE_KEY || !ctx.membership.sponsorId) {
    notFound(res, "Portal");
    return;
  }
  next();
}

async function portalData(ctx: OrgContext) {
  const sponsorId = ctx.membership.sponsorId!;
  const [sponsor] = await db.select().from(orgSponsorsTable).where(and(eq(orgSponsorsTable.id, sponsorId), eq(orgSponsorsTable.orgId, ctx.org.id)));
  const links = await db.select({ link: orgSponsorProjectsTable, p: orgProjectsTable }).from(orgSponsorProjectsTable)
    .innerJoin(orgProjectsTable, eq(orgProjectsTable.id, orgSponsorProjectsTable.projectId))
    .where(and(eq(orgSponsorProjectsTable.orgId, ctx.org.id), eq(orgSponsorProjectsTable.sponsorId, sponsorId)));
  const projectIds = links.map((l) => l.p.id);
  const [milestones, updates, contributions, shares] = await Promise.all([
    projectIds.length ? db.select().from(orgMilestonesTable).where(and(eq(orgMilestonesTable.orgId, ctx.org.id), inArray(orgMilestonesTable.projectId, projectIds))).orderBy(asc(orgMilestonesTable.dueDate)) : ([] as any[]),
    db.select({ u: orgSponsorUpdatesTable, projectTitle: orgProjectsTable.title }).from(orgSponsorUpdatesTable)
      .innerJoin(orgProjectsTable, eq(orgProjectsTable.id, orgSponsorUpdatesTable.projectId))
      .where(and(eq(orgSponsorUpdatesTable.orgId, ctx.org.id), eq(orgSponsorUpdatesTable.status, "published"),
        or(sql`${sponsorId} = any(${orgSponsorUpdatesTable.sponsorIds})`,
          and(sql`${orgSponsorUpdatesTable.visibility} <> 'named'`, projectIds.length ? inArray(orgSponsorUpdatesTable.projectId, projectIds) : sql`false`))))
      .orderBy(desc(orgSponsorUpdatesTable.publishedAt)),
    db.select({ reference: orgTransactionsTable.reference, date: orgTransactionsTable.date, amount: orgTransactionsTable.amount, currency: orgTransactionsTable.currency,
      direction: orgTransactionsTable.direction, projectId: orgTransactionsTable.projectId, description: orgTransactionsTable.description })
      .from(orgTransactionsTable)
      .where(and(eq(orgTransactionsTable.orgId, ctx.org.id), eq(orgTransactionsTable.sponsorId, sponsorId), inArray(orgTransactionsTable.status, ["received", "posted"])))
      .orderBy(desc(orgTransactionsTable.date)),
    db.select().from(orgSponsorSharesTable).where(and(eq(orgSponsorSharesTable.orgId, ctx.org.id), eq(orgSponsorSharesTable.sponsorId, sponsorId))),
  ]);
  const updateIds = updates.map((x) => x.u.id);
  const sharedTxIds = shares.filter((s) => s.entityType === "transaction").map((s) => s.entityId);
  const sharedFileIds = shares.filter((s) => s.entityType === "file").map((s) => s.entityId);
  const [updateFiles, sharedTxs, sharedFiles] = await Promise.all([
    updateIds.length ? db.select({ id: orgFilesTable.id, entityId: orgFilesTable.entityId, fileName: orgFilesTable.fileName, mimeType: orgFilesTable.mimeType, size: orgFilesTable.size })
      .from(orgFilesTable).where(and(eq(orgFilesTable.orgId, ctx.org.id), eq(orgFilesTable.entityType, "sponsor_update"), inArray(orgFilesTable.entityId, updateIds))) : ([] as any[]),
    sharedTxIds.length ? db.select({ id: orgTransactionsTable.id, reference: orgTransactionsTable.reference, date: orgTransactionsTable.date, amount: orgTransactionsTable.amount,
      currency: orgTransactionsTable.currency, category: orgTransactionsTable.category, counterparty: orgTransactionsTable.counterparty, description: orgTransactionsTable.description,
      projectId: orgTransactionsTable.projectId, kind: orgTransactionsTable.kind })
      .from(orgTransactionsTable).where(and(eq(orgTransactionsTable.orgId, ctx.org.id), inArray(orgTransactionsTable.id, sharedTxIds))) : ([] as any[]),
    sharedFileIds.length ? db.select({ id: orgFilesTable.id, fileName: orgFilesTable.fileName, mimeType: orgFilesTable.mimeType, size: orgFilesTable.size, createdAt: orgFilesTable.createdAt })
      .from(orgFilesTable).where(and(eq(orgFilesTable.orgId, ctx.org.id), inArray(orgFilesTable.id, sharedFileIds))) : ([] as any[]),
  ]);
  const projects = await Promise.all(links.map(async ({ link, p }) => {
    const fin = await projectFinance(ctx.org.id, p.id);
    const received = contributions.filter((c) => c.projectId === p.id).reduce((s, c) => s + (c.direction === "in" ? 1 : -1) * Number(c.amount), 0);
    return {
      id: p.id, title: p.title, objective: p.objective, description: p.description, status: p.status, startDate: p.startDate, endDate: p.endDate, location: p.location,
      progress: await projectProgress(ctx.org.id, p.id),
      milestones: milestones.filter((m) => m.projectId === p.id).map((m) => ({ id: m.id, title: m.title, dueDate: m.dueDate, completedAt: m.completedAt })),
      funding: {
        committed: link.committedAmount, received: received.toFixed(2), currency: link.currency, ...fin,
        remaining: (Number(fin.approvedBudget) - Number(fin.reportedSpend)).toFixed(2),
      },
    };
  }));
  return {
    sponsor: sponsor ? { id: sponsor.id, name: sponsor.name, logoUrl: sponsor.logoUrl, website: sponsor.website, contactName: sponsor.contactName, contactEmail: sponsor.contactEmail } : null,
    organisation: { name: ctx.org.name, logoUrl: ctx.org.logoUrl, currency: ctx.org.currency, timezone: ctx.org.timezone },
    projects,
    updates: updates.map(({ u, projectTitle }) => ({ id: u.id, projectId: u.projectId, projectTitle, title: u.title, body: u.body, publishedAt: u.publishedAt, files: updateFiles.filter((f) => f.entityId === u.id).map(({ entityId, ...f }) => f) })),
    contributions,
    shared: { transactions: sharedTxs, files: sharedFiles },
  };
}

router.get("/portal", requireSponsor, async (req, res) => {
  res.json(await portalData(getOrg(req)));
});

router.get("/portal/files/:id", requireSponsor, async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [file] = id ? await db.select().from(orgFilesTable).where(and(eq(orgFilesTable.id, id), eq(orgFilesTable.orgId, ctx.org.id))) : [];
  let allowed = false;
  if (file) {
    const [share] = await db.select({ id: orgSponsorSharesTable.id }).from(orgSponsorSharesTable)
      .where(and(eq(orgSponsorSharesTable.sponsorId, ctx.membership.sponsorId!), eq(orgSponsorSharesTable.entityType, "file"), eq(orgSponsorSharesTable.entityId, file.id)));
    allowed = Boolean(share);
    if (!allowed && file.entityType === "sponsor_update") {
      const [u] = await db.select().from(orgSponsorUpdatesTable).where(and(eq(orgSponsorUpdatesTable.id, file.entityId), eq(orgSponsorUpdatesTable.status, "published")));
      allowed = Boolean(u && (await updateVisibleTo(ctx, u)));
    }
  }
  if (!file || !allowed) {
    notFound(res, "File");
    return;
  }
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.end(file.data);
});

export default router;
