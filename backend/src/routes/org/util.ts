import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

// Shared bits for the organisation workspace routes.

export function idParam(req: Request, name = "id"): number | null {
  const n = Number(req.params[name]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const notFound = (res: Response, what = "Record") => res.status(404).json({ error: "NotFound", message: `${what} not found` });
export const forbidden = (res: Response, message = "You don't have permission to do this") => res.status(403).json({ error: "Forbidden", message });
export const badRequest = (res: Response, message: string) => res.status(400).json({ error: "BadRequest", message });
export const conflict = (res: Response, message: string) => res.status(409).json({ error: "Conflict", message });

export const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
export const optionalId = z.coerce.number().int().positive().nullish().transform((v) => v ?? null);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullish().transform((v) => v ?? null);
// Invitation tokens are stored hashed; only the emailed link holds the raw token.
export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

// Express 5 forwards rejected async handlers here; answer in the API's JSON shape.
export function orgErrorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  // Drizzle wraps driver errors; the Postgres code may be on the cause.
  if ((err?.code ?? err?.cause?.code) === "23505") {
    res.status(409).json({ error: "Conflict", message: "That record already exists" });
    return;
  }
  req.log.error({ err }, "Org route error");
  res.status(500).json({ error: "Internal", message: "Server error" });
}

// PATCH bodies: validate against the partial schema, then keep only the keys
// the client actually sent. Zod 4's .partial() still runs defaults and
// nullish transforms for absent keys, which would silently reset fields
// (e.g. clear a description) that the request never mentioned.
export function validatePatch(schema: z.ZodObject<any>) {
  const partial = schema.partial();
  return (req: Request, res: Response, next: NextFunction) => {
    const raw = req.body && typeof req.body === "object" ? req.body : {};
    const result = partial.safeParse(raw);
    if (!result.success) {
      res.status(400).json({
        error: "BadRequest",
        message: "Invalid request body",
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }
    req.body = Object.fromEntries(Object.entries(result.data).filter(([k]) => Object.prototype.hasOwnProperty.call(raw, k)));
    next();
  };
}
