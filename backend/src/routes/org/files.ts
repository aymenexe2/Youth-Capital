import crypto from "crypto";
import express, { Router, type IRouter } from "express";
import { db, orgFilesTable, orgTasksTable, orgProjectsTable, orgTaskCommentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getOrg, canEditTask, type OrgContext } from "../../lib/org/context.js";
import { recordOrgAudit } from "../../lib/org/audit.js";
import { notifyMembers } from "../../lib/org/notify.js";
import { authLimiter } from "../../middlewares/rateLimit.js";
import { badRequest, forbidden, idParam, notFound } from "./util.js";
import { taskVisibility } from "./tasks.js";

// Private file storage (evidence, invoices, documents). Files live in the
// database and are only served after checking the caller can see the record
// they're attached to — there are no public URLs.

const router: IRouter = Router({ mergeParams: true });
export const MAX_FILE_BYTES = 4 * 1024 * 1024; // stays under Vercel's 4.5 MB request cap

// Allowed types, with the leading bytes each must actually start with so a
// renamed executable can't pass as a PDF.
const TYPES: Record<string, { ext: string[]; magic?: number[][] }> = {
  "application/pdf": { ext: ["pdf"], magic: [[0x25, 0x50, 0x44, 0x46]] },
  "image/png": { ext: ["png"], magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/jpeg": { ext: ["jpg", "jpeg"], magic: [[0xff, 0xd8, 0xff]] },
  "image/webp": { ext: ["webp"], magic: [[0x52, 0x49, 0x46, 0x46]] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: ["docx"], magic: [[0x50, 0x4b, 0x03, 0x04]] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: ["xlsx"], magic: [[0x50, 0x4b, 0x03, 0x04]] },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: ["pptx"], magic: [[0x50, 0x4b, 0x03, 0x04]] },
  "text/csv": { ext: ["csv"] },
  "text/plain": { ext: ["txt"] },
};

function detectType(name: string, declared: string, buf: Buffer): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const mime = Object.keys(TYPES).find((m) => m === declared && TYPES[m].ext.includes(ext))
    ?? Object.keys(TYPES).find((m) => TYPES[m].ext.includes(ext));
  if (!mime) return null;
  const spec = TYPES[mime];
  if (spec.magic && !spec.magic.some((sig) => sig.every((b, i) => buf[i] === b))) return null;
  // Text types must actually be text (no NUL bytes).
  if (!spec.magic && buf.subarray(0, 8192).includes(0)) return null;
  return mime;
}

// Which records files can be attached to, and who may read/write them.
type Access = { canRead: (ctx: OrgContext, id: number) => Promise<boolean>; canWrite: (ctx: OrgContext, id: number) => Promise<boolean> };
const ENTITIES: Record<string, Access> = {
  task: {
    canRead: async (ctx, id) => {
      const [t] = await db.select({ id: orgTasksTable.id }).from(orgTasksTable).where(and(await taskVisibility(ctx), eq(orgTasksTable.id, id)));
      return Boolean(t);
    },
    canWrite: async (ctx, id) => {
      const [t] = await db.select().from(orgTasksTable).where(and(await taskVisibility(ctx), eq(orgTasksTable.id, id)));
      if (!t) return false;
      if (t.assigneeMembershipId === ctx.membership.id) return true;
      const project = t.projectId ? (await db.select().from(orgProjectsTable).where(eq(orgProjectsTable.id, t.projectId)))[0] ?? null : null;
      return canEditTask(ctx, t, project);
    },
  },
};

export function registerFileEntity(type: string, access: Access) {
  ENTITIES[type] = access;
}

router.post("/files", authLimiter, express.raw({ type: () => true, limit: MAX_FILE_BYTES }), async (req, res) => {
  const ctx = getOrg(req);
  const entityType = String(req.query.entityType || "");
  const entityId = Number(req.query.entityId);
  const name = String(req.query.name || "").replace(/[\\/\0\r\n"]/g, "_").slice(0, 160).trim();
  const access = ENTITIES[entityType];
  if (!access || !Number.isInteger(entityId) || entityId <= 0 || !name) {
    badRequest(res, "Specify what the file is attached to and its name");
    return;
  }
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    badRequest(res, "The file is empty");
    return;
  }
  if (!(await access.canWrite(ctx, entityId))) {
    forbidden(res, "You can't attach files here");
    return;
  }
  const mimeType = detectType(name, String(req.headers["content-type"] || ""), buf);
  if (!mimeType) {
    badRequest(res, "Unsupported file type. Use PDF, images (PNG/JPEG/WebP), Word, Excel, PowerPoint, CSV or text.");
    return;
  }
  const [file] = await db.insert(orgFilesTable).values({
    orgId: ctx.org.id, uploadedByUserId: ctx.userId, entityType, entityId, fileName: name, mimeType, size: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"), data: buf,
  }).returning({ id: orgFilesTable.id, fileName: orgFilesTable.fileName, mimeType: orgFilesTable.mimeType, size: orgFilesTable.size, createdAt: orgFilesTable.createdAt });

  // Files on a task count as evidence in its timeline.
  if (entityType === "task") {
    const note = typeof req.query.note === "string" ? req.query.note.slice(0, 2000) : null;
    await db.insert(orgTaskCommentsTable).values({ orgId: ctx.org.id, taskId: entityId, authorMembershipId: ctx.membership.id, kind: "evidence", body: note || null, fileId: file.id });
    const [t] = await db.select().from(orgTasksTable).where(eq(orgTasksTable.id, entityId));
    notifyMembers(ctx.org.id, ctx.org.slug, [t.assigneeMembershipId, t.reviewerMembershipId, t.createdByMembershipId], ctx.userId, {
      type: "task.comment", title: `New evidence on "${t.title}"`, body: name, link: `/tasks/${t.id}`,
    });
    await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "task.evidence_added", entityType: "task", entityId, summary: t.title, after: { fileId: file.id, fileName: name } });
  } else {
    await recordOrgAudit({ orgId: ctx.org.id, actorUserId: ctx.userId, action: "file.uploaded", entityType, entityId, summary: name, after: { fileId: file.id } });
  }
  res.status(201).json({ file });
});

router.get("/files", async (req, res) => {
  const ctx = getOrg(req);
  const entityType = String(req.query.entityType || "");
  const entityId = Number(req.query.entityId);
  const access = ENTITIES[entityType];
  if (!access || !Number.isInteger(entityId) || !(await access.canRead(ctx, entityId))) {
    notFound(res, "Record");
    return;
  }
  const files = await db.select({ id: orgFilesTable.id, fileName: orgFilesTable.fileName, mimeType: orgFilesTable.mimeType, size: orgFilesTable.size, createdAt: orgFilesTable.createdAt })
    .from(orgFilesTable).where(and(eq(orgFilesTable.orgId, ctx.org.id), eq(orgFilesTable.entityType, entityType), eq(orgFilesTable.entityId, entityId)));
  res.json({ files });
});

router.get("/files/:id", async (req, res) => {
  const ctx = getOrg(req);
  const id = idParam(req);
  const [file] = id ? await db.select().from(orgFilesTable).where(and(eq(orgFilesTable.id, id), eq(orgFilesTable.orgId, ctx.org.id))) : [];
  const access = file ? ENTITIES[file.entityType] : null;
  if (!file || !access || !(await access.canRead(ctx, file.entityId))) {
    notFound(res, "File");
    return;
  }
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.end(file.data);
});

export default router;
