import { db, orgNotificationsTable, orgMembershipsTable, usersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "../logger.js";
import { isMailerConfigured, sendEmailToMany } from "../mailer.js";
import { wrapEmailHtml } from "../email-template.js";
import { manageUrl } from "../urls.js";

type Notice = { type: string; title: string; body?: string; link?: string; email?: boolean };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * In-app notification (plus optional email) to the users behind some
 * memberships. Never notifies the actor about their own action. Fire-and-forget:
 * a failed notification must not fail the request that caused it.
 */
export function notifyMembers(orgId: number, orgSlug: string, membershipIds: (number | null | undefined)[], actorUserId: number, n: Notice) {
  const ids = [...new Set(membershipIds.filter((x): x is number => typeof x === "number"))];
  if (!ids.length) return;
  (async () => {
    const recipients = await db
      .select({ userId: orgMembershipsTable.userId, email: usersTable.email })
      .from(orgMembershipsTable)
      .innerJoin(usersTable, eq(usersTable.id, orgMembershipsTable.userId))
      .where(and(eq(orgMembershipsTable.orgId, orgId), inArray(orgMembershipsTable.id, ids), eq(orgMembershipsTable.status, "active")));
    const targets = recipients.filter((r) => r.userId !== actorUserId);
    if (!targets.length) return;
    await db.insert(orgNotificationsTable).values(
      targets.map((r) => ({ orgId, userId: r.userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null })),
    );
    if (n.email && isMailerConfigured) {
      const href = `${manageUrl()}/o/${orgSlug}${n.link ?? ""}`;
      const html = wrapEmailHtml(
        `<p style="font-size:16px;font-weight:600;margin:0 0 8px">${escapeHtml(n.title)}</p>` +
        (n.body ? `<p style="margin:0 0 16px">${escapeHtml(n.body)}</p>` : "") +
        `<p><a href="${href}">Open in workspace</a></p>`,
      );
      await sendEmailToMany(targets.map((r) => r.email), n.title, html);
    }
  })().catch((err) => logger.error({ err, type: n.type }, "Failed to send org notification"));
}
