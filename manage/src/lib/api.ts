import { customFetch } from "@workspace/api-client-react";

// Thin JSON helpers over the shared client (credentials + base URL handled there).
const json = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  get: <T = any>(path: string) => customFetch<T>(path),
  post: <T = any>(path: string, body: unknown = {}) => customFetch<T>(path, json("POST", body)),
  patch: <T = any>(path: string, body: unknown) => customFetch<T>(path, json("PATCH", body)),
  del: <T = any>(path: string, body?: unknown) => customFetch<T>(path, body === undefined ? { method: "DELETE" } : json("DELETE", body)),
  // Raw upload to private storage; the server checks type, size and access.
  upload: <T = any>(slug: string, entityType: string, entityId: number, file: File, note?: string) =>
    customFetch<T>(`/api/org/${slug}/files?${new URLSearchParams({ entityType, entityId: String(entityId), name: file.name, ...(note ? { note } : {}) })}`, {
      method: "POST", body: file, headers: { "content-type": file.type || "application/octet-stream" },
    }),
};

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// The API answers errors as { error, message, issues? } — surface the message.
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  const data = (err as any)?.data;
  if (data?.issues?.length) return data.issues.map((i: any) => (i.path ? `${i.path}: ${i.message}` : i.message)).join(" · ");
  if (typeof data?.message === "string") return data.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export const errorStatus = (err: unknown): number | undefined => (err as any)?.status;
