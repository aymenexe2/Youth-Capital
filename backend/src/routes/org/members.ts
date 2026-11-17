import crypto from "crypto";
import { Router, type IRouter } from "express";
import {
  db, orgMembershipsTable, orgRolesTable, orgInvitationsTable, orgCommitteeMembersTable, orgCommitteesTable,
  orgProjectMembersTable, orgProjectsTable, orgTasksTable, orgRegionsTable, usersTable,
} from "@workspace/db";
import { and, eq, isNull, ne, sql, count, desc } from "drizzle-orm";
import { z } from "zod";
import { validateBody } from "../../middlewares/validate.js";
import {
  getOrg, requirePerm, can, isOrgWide, canSeeMemberDetails, canEditMember, colleagueMembershipIds, type OrgContext,
} from "../../lib/org/context.js";
import { ADMIN_ROLE_KEY } from "../../lib/org/permissions.js";
import { recordOrgAudit, diff } from "../../lib/org/audit.js";
import { isMailerConfigured, sendEmailToMany } from "../../lib/mailer.js";
import { wrapEmailHtml } from "../../lib/email-template.js";
import { manageUrl } from "../../lib/urls.js";
import { badRequest, conflict, forbidden, hashToken, idParam, notFound, optionalId, optionalText, validatePatch } from "./util.js";

const router: IRouter = Router({ mergeParams: true });

const memberColumns = {
  membershipId: orgMembershipsTable.id,
  userId: orgMembershipsTable.userId,
  status: orgMembershipsTable.status,
  title: orgMembershipsTable.title,
  regionId: orgMembershipsTable.regionId,
  skills: orgMembershipsTable.skills,
  joinedAt: orgMembershipsTable.joinedAt,
  lastActiveAt: orgMembershipsTable.lastActiveAt,
  roleId: orgRolesTable.id,
  roleKey: orgRolesTable.key,
  roleName: orgRolesTable.name,
  fullName: usersTable.fullName,
  email: usersTable.email,
  phone: usersTable.phone,
  avatarUrl: usersTable.avatarUrl,
};

const membersQuery = (orgId: number) => db
  .select(memberColumns)
  .from(orgMembershipsTable)
  .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
  .innerJoin(orgRolesTable, eq(orgRolesTable.id, orgMembershipsTable.roleId))
  .where(eq(orgMembershipsTable.orgId, orgId))
  .$dynamic();

// Light directory of active members (name, photo, position) — what any member
// needs to see who's assigned to what. Contact details are not included.
router.get("/people", async (req, res) => {
  const ctx = getOrg(req);
  const people = await db
    .select({ membershipId: orgMembershipsTable.id, fullName: usersTable.fullName, avatarUrl: usersTable.avatarUrl, title: orgMembershipsTable.title, regionId: orgMembershipsTable.regionId })
    .from(orgMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
    .where(and(eq(orgMembershipsTable.orgId, ctx.org.id), eq(orgMembershipsTable.status, "active"), isNull(orgMembershipsTable.sponsorId)))
    .orderBy(usersTable.fullName);
  res.json({ people });
});

async function visibilityFilter(ctx: OrgContext) {
  const colleagues = isOrgWide(ctx) || ctx.scope === "region" ? new Set<number>() : await colleagueMembershipIds(ctx);
  return (m: { membershipId: number; regionId: number | null }) => canSeeMemberDetails(ctx, { id: m.membershipId, regionId: m.regionId }, colleagues);
}

router.get("/members", async (req, res) => {
  const ctx = getOrg(req);
  const rows = await membersQuery(ctx.org.id).where(and(eq(orgMembershipsTable.orgId, ctx.org.id), ne(orgMembershipsTable.status, "left"))).orderBy(usersTable.fullName);
  const visible = rows.filter(await visibilityFilter(ctx));
  const committeeRows = visible.length
    ? await db.select({ membershipId: orgCommitteeMembersTable.membershipId, committeeId: orgCommitteeMembersTable.committeeId, role: orgCommitteeMembersTable.role })
        .from(orgCommitteeMembersTable).where(eq(orgCommitteeMembersTable.orgId, ctx.org.id))
    : [];
  res.json({
    members: visible.map((m) => ({
      ...m,
      committees: committeeRows.filter((c) => c.membershipId === m.membershipId).map(({ membershipId, ...c }) => c),
      canEdit: canEditMember(ctx, { id: m.membershipId, regionId: m.regionId }),
    })),
    scope: ctx.scope,
  });
});

router.get("/members/:id", async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [member] = id ? await membersQuery(ctx.org.id).where(and(eq(orgMembershipsTable.orgId, ctx.org.id), eq(orgMembershipsTable.id, id))) : [];
  if (!member || !(await visibilityFilter(ctx))(member)) {
    notFound(res, "Member");
    return;
  }
  const [committees, projects, taskStats] = await Promise.all([
    db.select({ id: orgCommitteesTable.id, name: orgCommitteesTable.name, color: orgCommitteesTable.color, role: orgCommitteeMembersTable.role })
      .from(orgCommitteeMembersTable)
      .innerJoin(orgCommitteesTable, eq(orgCommitteesTable.id, orgCommitteeMembersTable.committeeId))
      .where(and(eq(orgCommitteeMembersTable.orgId, ctx.org.id), eq(orgCommitteeMembersTable.membershipId, member.membershipId))),
    db.select({ id: orgProjectsTable.id, title: orgProjectsTable.title, status: orgProjectsTable.status, role: orgProjectMembersTable.role })
      .from(orgProjectMembersTable)
      .innerJoin(orgProjectsTable, eq(orgProjectsTable.id, orgProjectMembersTable.projectId))
      .where(and(eq(orgProjectMembersTable.orgId, ctx.org.id), eq(orgProjectMembersTable.membershipId, member.membershipId))),
    db.select({ status: orgTasksTable.status, n: count() }).from(orgTasksTable)
      .where(and(eq(orgTasksTable.orgId, ctx.org.id), eq(orgTasksTable.assigneeMembershipId, member.membershipId)))
      .groupBy(orgTasksTable.status),
  ]);
  res.json({
    member: { ...member, committees, projects, taskStats: Object.fromEntries(taskStats.map((t) => [t.status, Number(t.n)])) },
    canEdit: canEditMember(ctx, { id: member.membershipId, regionId: member.regionId }),
    canChangeRole: can(ctx, "roles.manage"),
    canDelete: canDeleteMember(ctx, member.membershipId),
  });
});

// Permanent removal is for organisation-wide editors only, and never yourself.
const canDeleteMember = (ctx: OrgContext, membershipId: number) =>
  can(ctx, "members.edit") && isOrgWide(ctx) && membershipId !== ctx.membership.id;

const UpdateMemberSchema = z.object({
  roleId: z.coerce.number().int().positive().optional(),
  regionId: optionalId,
  title: optionalText(120),
  skills: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  status: z.enum(["active", "inactive", "suspended", "left"]).optional(),
  // Required for membership-status changes: due process needs a recorded reason.
  reason: z.string().trim().max(1000).optional(),
});

async function activeAdminCount(orgId: number) {
  const [{ n }] = await db.select({ n: count() }).from(orgMembershipsTable)
    .innerJoin(orgRolesTable, eq(orgRolesTable.id, orgMembershipsTable.roleId))
    .where(and(eq(orgMembershipsTable.orgId, orgId), eq(orgRolesTable.key, ADMIN_ROLE_KEY), eq(orgMembershipsTable.status, "active")));
  return Number(n);
}

router.patch("/members/:id", validatePatch(UpdateMemberSchema), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [target] = id ? await db.select({ m: orgMembershipsTable, roleKey: orgRolesTable.key })
    .from(orgMembershipsTable).innerJoin(orgRolesTable, eq(orgRolesTable.id, orgMembershipsTable.roleId))
    .where(and(eq(orgMembershipsTable.id, id), eq(orgMembershipsTable.orgId, ctx.org.id))) : [];
  if (!target) {
    notFound(res, "Member");
    return;
  }
  const m = target.m;
  if (!canEditMember(ctx, { id: m.id, regionId: m.regionId })) {
    forbidden(res);
    return;
  }
  const { reason, ...patch } = req.body as z.infer<typeof UpdateMemberSchema>;

  if (patch.roleId !== undefined && patch.roleId !== m.roleId) {
    if (!can(ctx, "roles.manage")) {
      forbidden(res, "Changing roles requires the roles.manage permission");
      return;
    }
    const [role] = await db.select().from(orgRolesTable).where(and(eq(orgRolesTable.id, patch.roleId), eq(orgRolesTable.orgId, ctx.org.id)));
    if (!role) {
      badRequest(res, "Role not found");
      return;
    }
  }
  if (patch.regionId) {
    const [region] = await db.select({ id: orgRegionsTable.id }).from(orgRegionsTable).where(and(eq(orgRegionsTable.id, patch.regionId), eq(orgRegionsTable.orgId, ctx.org.id)));
    // A regional coordinator can only move members within their own region.
    if (!region || (!isOrgWide(ctx) && !ctx.regionIds.includes(patch.regionId))) {
      badRequest(res, "Region not found or outside your scope");
      return;
    }
  }
  const statusChanging = patch.status !== undefined && patch.status !== m.status;
  if (statusChanging && !reason) {
    badRequest(res, "A reason is required when changing membership status");
    return;
  }
  // Never leave an organisation without an active administrator.
  const losingAdmin = target.roleKey === ADMIN_ROLE_KEY && m.status === "active" &&
    ((patch.roleId !== undefined && patch.roleId !== m.roleId) || (statusChanging && patch.status !== "active"));
  if (losingAdmin && (await activeAdminCount(ctx.org.id)) <= 1) {
    conflict(res, "This is the only active administrator — appoint another first");
    return;
  }

  const changes = diff(m, patch);
  const [updated] = await db.update(orgMembershipsTable).set(patch).where(eq(orgMembershipsTable.id, m.id)).returning();
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId,
    action: statusChanging ? "membership.status_changed" : patch.roleId !== undefined && patch.roleId !== m.roleId ? "membership.role_changed" : "membership.updated",
    entityType: "membership", entityId: m.id, reason: reason || null, ...changes,
  });
  res.json({ membership: updated });
});

// Remove someone from the organisation entirely. Their committee/project seats
// and points go with them; tasks, transactions and documents they touched stay,
// just without their name attached. They can be invited again later.
router.delete("/members/:id", async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [target] = id ? await db.select({ m: orgMembershipsTable, roleKey: orgRolesTable.key, fullName: usersTable.fullName, email: usersTable.email })
    .from(orgMembershipsTable)
    .innerJoin(orgRolesTable, eq(orgRolesTable.id, orgMembershipsTable.roleId))
    .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
    .where(and(eq(orgMembershipsTable.id, id), eq(orgMembershipsTable.orgId, ctx.org.id))) : [];
  if (!target) {
    notFound(res, "Member");
    return;
  }
  if (target.m.id === ctx.membership.id) {
    forbidden(res, "You can't remove yourself");
    return;
  }
  if (!canDeleteMember(ctx, target.m.id)) {
    forbidden(res);
    return;
  }
  if (target.roleKey === ADMIN_ROLE_KEY && target.m.status === "active" && (await activeAdminCount(ctx.org.id)) <= 1) {
    conflict(res, "This is the only active administrator — appoint another first");
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  await db.delete(orgMembershipsTable).where(and(eq(orgMembershipsTable.id, target.m.id), eq(orgMembershipsTable.orgId, ctx.org.id)));
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId, action: "membership.deleted", entityType: "membership", entityId: target.m.id,
    summary: `${target.fullName} <${target.email}>`, reason: reason || null,
  });
  res.json({ success: true });
});

// ── Invitations ─────────────────────────────────────────────────────────────

router.get("/invitations", requirePerm("members.invite"), async (req, res) => {
  const ctx = getOrg(req);
  const rows = await db
    .select({ invitation: orgInvitationsTable, roleName: orgRolesTable.name, invitedBy: usersTable.fullName })
    .from(orgInvitationsTable)
    .innerJoin(orgRolesTable, eq(orgRolesTable.id, orgInvitationsTable.roleId))
    .leftJoin(usersTable, eq(usersTable.id, orgInvitationsTable.invitedById))
    .where(and(eq(orgInvitationsTable.orgId, ctx.org.id), isNull(orgInvitationsTable.acceptedAt), isNull(orgInvitationsTable.revokedAt)))
    .orderBy(desc(orgInvitationsTable.createdAt));
  res.json({
    invitations: rows.map(({ invitation: { tokenHash, ...inv }, roleName, invitedBy }) => ({
      ...inv, roleName, invitedBy, expired: inv.expiresAt < new Date(),
    })),
  });
});

const InviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  roleId: z.coerce.number().int().positive(),
  regionId: optionalId,
  committeeId: optionalId,
  title: optionalText(120),
});

router.post("/invitations", requirePerm("members.invite"), validateBody(InviteSchema), async (req, res) => {
  const ctx = getOrg(req);
  const body = req.body as z.infer<typeof InviteSchema>;
  const [role] = await db.select().from(orgRolesTable).where(and(eq(orgRolesTable.id, body.roleId), eq(orgRolesTable.orgId, ctx.org.id)));
  if (!role) {
    badRequest(res, "Role not found");
    return;
  }
  // Without roles.manage you can only invite people as ordinary members —
  // otherwise members.invite would be a back door to granting any role.
  if (!can(ctx, "roles.manage") && role.key !== "member") {
    forbidden(res, "You can only invite people with the Member role");
    return;
  }
  if (body.regionId) {
    const [region] = await db.select({ id: orgRegionsTable.id }).from(orgRegionsTable).where(and(eq(orgRegionsTable.id, body.regionId), eq(orgRegionsTable.orgId, ctx.org.id)));
    if (!region) {
      badRequest(res, "Region not found");
      return;
    }
  }
  if (!isOrgWide(ctx) && ctx.scope === "region" && (!body.regionId || !ctx.regionIds.includes(body.regionId))) {
    forbidden(res, "Invite people into your own region");
    return;
  }
  if (body.committeeId) {
    const [committee] = await db.select({ id: orgCommitteesTable.id }).from(orgCommitteesTable).where(and(eq(orgCommitteesTable.id, body.committeeId), eq(orgCommitteesTable.orgId, ctx.org.id)));
    if (!committee) {
      badRequest(res, "Committee not found");
      return;
    }
  }
  const [alreadyMember] = await db.select({ id: orgMembershipsTable.id }).from(orgMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
    .where(and(eq(orgMembershipsTable.orgId, ctx.org.id), sql`lower(${usersTable.email}) = ${body.email}`, ne(orgMembershipsTable.status, "left")));
  if (alreadyMember) {
    conflict(res, "This person is already a member");
    return;
  }

  // Re-inviting the same address replaces the previous pending invitation.
  await db.update(orgInvitationsTable).set({ revokedAt: new Date() })
    .where(and(eq(orgInvitationsTable.orgId, ctx.org.id), eq(orgInvitationsTable.email, body.email), isNull(orgInvitationsTable.acceptedAt), isNull(orgInvitationsTable.revokedAt)));

  const token = crypto.randomBytes(32).toString("base64url");
  const [invitation] = await db.insert(orgInvitationsTable).values({
    orgId: ctx.org.id, email: body.email, roleId: role.id, regionId: body.regionId, committeeId: body.committeeId, title: body.title,
    tokenHash: hashToken(token), invitedById: ctx.userId, expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  }).returning();

  const link = `${manageUrl()}/invite/${token}`;
  let emailed = false;
  if (isMailerConfigured) {
    const html = wrapEmailHtml(
      `<p style="font-size:16px;font-weight:600;margin:0 0 8px">You're invited to join ${ctx.org.name.replace(/[<>&"]/g, "")}</p>` +
      `<p style="margin:0 0 16px">You've been invited to the ${ctx.org.name.replace(/[<>&"]/g, "")} workspace as <strong>${role.name.replace(/[<>&"]/g, "")}</strong>. ` +
      `Sign in with this email address (or create a Youth Capital account with it) to accept. The invitation expires in 14 days.</p>` +
      `<p><a href="${link}">Accept invitation</a></p>`,
    );
    const [result] = await sendEmailToMany([body.email], `Invitation to join ${ctx.org.name}`, html);
    emailed = Boolean(result?.success);
  }
  await recordOrgAudit({
    orgId: ctx.org.id, actorUserId: ctx.userId, action: "invitation.created", entityType: "invitation", entityId: invitation.id,
    summary: body.email, after: { roleId: role.id, regionId: body.regionId, committeeId: body.committeeId },
  });
  const { tokenHash, ...safe } = invitation;
  // The link is returned once so it can be shared manually when email isn't configured.
  res.status(201).json({ invitation: safe, link, emailed });
});

router.delete("/invitations/:id", requirePerm("members.invite"), async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [inv] = id ? await db.select().from(orgInvitationsTable).where(and(eq(orgInvitationsTable.id, id), eq(orgInvitationsTable.orgId, ctx.org.id))) : [];
  if (!inv) {
    notFound(res, "Invitation");
    return;
  }
  await db.update(orgInvitationsTable).set({ revokedAt: new Date() }).where(eq(orgInvitationsTable.id, inv.id));
  await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "invitation.revoked", entityType: "invitation", entityId: inv.id, summary: inv.email });
  res.json({ success: true });
});

// Organisation analytics for the members page — aggregate counts only.
router.get("/members-stats", requirePerm("members.view"), async (req, res) => {
  const ctx = getOrg(req);
  if (!isOrgWide(ctx)) {
    forbidden(res, "Organisation-wide statistics need an organisation-wide role");
    return;
  }
  const [byStatus, byRegion, byCommittee, growth] = await Promise.all([
    db.select({ status: orgMembershipsTable.status, n: count() }).from(orgMembershipsTable)
      .where(eq(orgMembershipsTable.orgId, ctx.org.id)).groupBy(orgMembershipsTable.status),
    db.select({ regionId: orgMembershipsTable.regionId, n: count() }).from(orgMembershipsTable)
      .where(and(eq(orgMembershipsTable.orgId, ctx.org.id), eq(orgMembershipsTable.status, "active"))).groupBy(orgMembershipsTable.regionId),
    db.select({ committeeId: orgCommitteeMembersTable.committeeId, n: count() }).from(orgCommitteeMembersTable)
      .where(eq(orgCommitteeMembersTable.orgId, ctx.org.id)).groupBy(orgCommitteeMembersTable.committeeId),
    db.select({ month: sql<string>`to_char(date_trunc('month', ${orgMembershipsTable.joinedAt}), 'YYYY-MM')`, n: count() })
      .from(orgMembershipsTable).where(eq(orgMembershipsTable.orgId, ctx.org.id))
      .groupBy(sql`1`).orderBy(sql`1`),
  ]);
  res.json({
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
    byRegion: byRegion.map((r) => ({ regionId: r.regionId, count: Number(r.n) })),
    byCommittee: byCommittee.map((r) => ({ committeeId: r.committeeId, count: Number(r.n) })),
    growth: growth.map((r) => ({ month: r.month, count: Number(r.n) })),
  });
});

export default router;
