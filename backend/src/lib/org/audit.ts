import { db, orgAuditEventsTable } from "@workspace/db";
import { logger } from "../logger.js";

type AuditInput = {
  orgId: number;
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

/**
 * Appends an organisation audit event. Unlike the platform admin log this is
 * awaited: approvals, role and membership changes must not succeed silently
 * without their audit record. Rows are never updated or deleted by the API.
 */
export async function recordOrgAudit(e: AuditInput): Promise<void> {
  try {
    await db.insert(orgAuditEventsTable).values({
      orgId: e.orgId,
      actorUserId: e.actorUserId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      summary: e.summary ?? null,
      before: (e.before ?? null) as any,
      after: (e.after ?? null) as any,
      reason: e.reason ?? null,
    });
  } catch (err) {
    logger.error({ err, action: e.action }, "Failed to write org audit event");
    throw err;
  }
}

// Only the fields that actually changed, for compact before/after records.
export function diff(before: Record<string, any>, patch: Record<string, any>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    const prev = norm(before[key]);
    const next = norm(patch[key]);
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      b[key] = prev;
      a[key] = next;
    }
  }
  return { before: b, after: a };
}
