import { Router, type IRouter } from "express";
import {
  db, organisationsTable, orgRolesTable, orgMembershipsTable, orgInvitationsTable, orgCommitteeMembersTable,
  orgCommitteesTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../../lib/session.js";
import { validateBody } from "../../middlewares/validate.js";
import { authLimiter } from "../../middlewares/rateLimit.js";
import { loadOrgContext } from "../../lib/org/context.js";
import { ADMIN_ROLE_KEY, ROLE_TEMPLATES } from "../../lib/org/permissions.js";
import { recordOrgAudit } from "../../lib/org/audit.js";
import { slugify } from "../../lib/slug.js";
import { badRequest, conflict, forbidden, hashToken, notFound, optionalText, orgErrorHandler } from "./util.js";
import workspaceRouter from "./workspace.js";
import membersRouter from "./members.js";
import projectsRouter from "./projects.js";
import eventsRouter from "./events.js";
import tasksRouter from "./tasks.js";
import activityRouter from "./activity.js";
import performanceRouter from "./performance.js";
import financeRouter from "./finance.js";
import accountingRouter from "./accounting.js";
import sponsorsRouter, { sponsorGuard } from "./sponsors.js";
import filesRouter from "./files.js";

// /api/org — the organisation workspace API. Everything under /:slug runs
// through loadOrgContext, which resolves the caller's membership in that
// organisation; every handler then scopes its queries by ctx.org.id.

const router: IRouter = Router();
router.use(requireAuth);

const LANGUAGES = ["en", "fr", "ar"] as const;
const RESERVED_SLUGS = new Set(["new", "invite", "invitations", "api", "admin", "settings"]);

const CreateOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/, "Use lowercase letters, numbers and dashes").optional(),
  description: optionalText(2000),
  defaultLanguage: z.enum(LANGUAGES).default("en"),
  currency: z.string().trim().toUpperCase().length(3).default("MAD"),
  timezone: z.string().trim().max(64).default("Africa/Casablanca"),
});

// Organisations the current user belongs to.
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const rows = await db
    .select({ org: organisationsTable, membership: orgMembershipsTable, role: orgRolesTable })
    .from(orgMembershipsTable)
    .innerJoin(organisationsTable, eq(organisationsTable.id, orgMembershipsTable.orgId))
    .innerJoin(orgRolesTable, eq(orgRolesTable.id, orgMembershipsTable.roleId))
    .where(and(eq(orgMembershipsTable.userId, user.id), sql`${orgMembershipsTable.status} <> 'left'`))
    .orderBy(organisationsTable.name);
  res.json({
    organisations: rows.map((r) => ({
      id: r.org.id, slug: r.org.slug, name: r.org.name, logoUrl: r.org.logoUrl, primaryColor: r.org.primaryColor,
      status: r.org.status, membershipStatus: r.membership.status, role: { key: r.role.key, name: r.role.name },
    })),
    canCreate: canCreateOrganisation(user),
  });
});

// Self-service tenant creation is off by default during the pilot: platform
// admins can always create one; everyone else only when ALLOW_ORG_SIGNUP=true.
function canCreateOrganisation(user: any) {
  return user.role === "admin" || process.env.ALLOW_ORG_SIGNUP === "true";
}

router.post("/", authLimiter, validateBody(CreateOrgSchema), async (req, res) => {
  const user = (req as any).user;
  if (!canCreateOrganisation(user)) {
    forbidden(res, "Creating organisations is not enabled for your account");
    return;
  }
  const body = req.body as z.infer<typeof CreateOrgSchema>;
  const slug = body.slug || slugify(body.name).slice(0, 48) || `org-${Date.now()}`;
  if (RESERVED_SLUGS.has(slug)) {
    badRequest(res, "That address is reserved");
    return;
  }
  const [taken] = await db.select({ id: organisationsTable.id }).from(organisationsTable).where(eq(organisationsTable.slug, slug));
  if (taken) {
    conflict(res, "That organisation address is already taken");
    return;
  }

  const org = await db.transaction(async (tx) => {
    const [org] = await tx.insert(organisationsTable).values({
      slug, name: body.name, description: body.description, defaultLanguage: body.defaultLanguage,
      currency: body.currency, timezone: body.timezone, createdById: user.id,
    }).returning();
    const roles = await tx.insert(orgRolesTable).values(
      ROLE_TEMPLATES.map((r) => ({ orgId: org.id, key: r.key, name: r.name, description: r.description, scope: r.scope, permissions: r.permissions, isSystem: true })),
    ).returning();
    const adminRole = roles.find((r) => r.key === ADMIN_ROLE_KEY)!;
    await tx.insert(orgMembershipsTable).values({ orgId: org.id, userId: user.id, roleId: adminRole.id, title: "Organisation Admin" });
    return org;
  });

  await recordOrgAudit({ orgId: org.id, actorUserId: user.id, action: "organisation.created", entityType: "organisation", entityId: org.id, summary: org.name });
  res.status(201).json({ organisation: org });
});

// ── Invitations (accepted outside an org context: the invitee isn't a member yet) ──

async function findInvitation(token: string) {
  const [row] = await db
    .select({ invitation: orgInvitationsTable, org: organisationsTable, role: orgRolesTable })
    .from(orgInvitationsTable)
    .innerJoin(organisationsTable, eq(organisationsTable.id, orgInvitationsTable.orgId))
    .innerJoin(orgRolesTable, eq(orgRolesTable.id, orgInvitationsTable.roleId))
    .where(eq(orgInvitationsTable.tokenHash, hashToken(token)));
  return row;
}

function invitationState(inv: typeof orgInvitationsTable.$inferSelect) {
  if (inv.acceptedAt) return "accepted";
  if (inv.revokedAt) return "revoked";
  if (inv.expiresAt < new Date()) return "expired";
  return "pending";
}

router.get("/invitations/:token", async (req, res) => {
  const row = await findInvitation(String(req.params.token));
  if (!row) {
    notFound(res, "Invitation");
    return;
  }
  const user = (req as any).user;
  res.json({
    organisation: { name: row.org.name, slug: row.org.slug, logoUrl: row.org.logoUrl },
    role: row.role.name,
    email: row.invitation.email,
    state: invitationState(row.invitation),
    emailMatches: row.invitation.email.toLowerCase() === String(user.email).toLowerCase(),
  });
});

router.post("/invitations/:token/accept", authLimiter, async (req, res) => {
  const user = (req as any).user;
  const row = await findInvitation(String(req.params.token));
  if (!row) {
    notFound(res, "Invitation");
    return;
  }
  const state = invitationState(row.invitation);
  if (state !== "pending") {
    conflict(res, `This invitation is ${state}`);
    return;
  }
  // The invitation is bound to an email address, not to whoever holds the link.
  if (row.invitation.email.toLowerCase() !== String(user.email).toLowerCase()) {
    forbidden(res, "This invitation was sent to a different email address");
    return;
  }

  const inv = row.invitation;
  const membership = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(orgMembershipsTable)
      .where(and(eq(orgMembershipsTable.orgId, inv.orgId), eq(orgMembershipsTable.userId, user.id)));
    let membership;
    if (existing) {
      [membership] = await tx.update(orgMembershipsTable)
        .set({ status: "active", roleId: inv.roleId, regionId: inv.regionId ?? existing.regionId, title: inv.title ?? existing.title, sponsorId: inv.sponsorId })
        .where(eq(orgMembershipsTable.id, existing.id)).returning();
    } else {
      [membership] = await tx.insert(orgMembershipsTable)
        .values({ orgId: inv.orgId, userId: user.id, roleId: inv.roleId, regionId: inv.regionId, title: inv.title, sponsorId: inv.sponsorId }).returning();
    }
    if (inv.committeeId) {
      const [committee] = await tx.select({ id: orgCommitteesTable.id }).from(orgCommitteesTable)
        .where(and(eq(orgCommitteesTable.id, inv.committeeId), eq(orgCommitteesTable.orgId, inv.orgId), isNull(orgCommitteesTable.archivedAt)));
      if (committee) {
        await tx.insert(orgCommitteeMembersTable).values({ orgId: inv.orgId, committeeId: committee.id, membershipId: membership.id }).onConflictDoNothing();
      }
    }
    await tx.update(orgInvitationsTable).set({ acceptedAt: new Date() }).where(eq(orgInvitationsTable.id, inv.id));
    return membership;
  });

  await recordOrgAudit({
    orgId: inv.orgId, actorUserId: user.id, action: "membership.joined", entityType: "membership", entityId: membership.id,
    summary: `${user.fullName} joined as ${row.role.name}`, after: { roleId: inv.roleId, regionId: membership.regionId },
  });
  res.json({ organisation: { slug: row.org.slug, name: row.org.name } });
});

const scoped: IRouter = Router({ mergeParams: true });
scoped.use(workspaceRouter);
scoped.use(membersRouter);
scoped.use(projectsRouter);
scoped.use(eventsRouter);
scoped.use(tasksRouter);
scoped.use(activityRouter);
scoped.use(performanceRouter);
scoped.use(filesRouter);
scoped.use(financeRouter);
scoped.use(accountingRouter);
scoped.use(sponsorsRouter);
router.use("/:slug", loadOrgContext, sponsorGuard, scoped);

router.use(orgErrorHandler);

export default router;
