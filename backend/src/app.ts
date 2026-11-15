import express, { type Express } from "express";
import type { IncomingMessage, ServerResponse } from "http";
import cors from "cors";
import helmetImport, { type HelmetOptions } from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { optionalAuth } from "./lib/session.js";
import { globalLimiter } from "./middlewares/rateLimit.js";

// Vercel's @vercel/node builder type-checks against helmet's CJS typings
// (index.d.cts), where an ESM default import is typed as the whole module
// namespace and isn't callable (TS2349). At runtime the default import is the
// helmet function under both the ESM and CJS builds, so pin its type here.
const helmet = helmetImport as unknown as (
  options?: Readonly<HelmetOptions>,
) => (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

const app: Express = express();

// Needed for req.ip to reflect the real client address behind Vercel's edge
// proxy instead of the proxy's own internal address — otherwise every
// request looks like it comes from the same IP, which breaks both IP-based
// rate limiting and the consent-based IP capture on /api/sahara-feedback.
// Trust exactly one hop (Vercel's own edge in front of the function), not
// `true` — trusting the whole X-Forwarded-For chain lets a client spoof
// their own IP by prepending a fake one, which silently defeats IP-based
// rate limiting. express-rate-limit refuses to start with `true` for
// exactly this reason (ERR_ERL_PERMISSIVE_TRUST_PROXY).
app.set("trust proxy", 1);

const isProd = process.env.NODE_ENV === "production";
// 5175 is the organisation-management app (manage/).
const DEV_ORIGINS = ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"];
// Browsers send Origin as scheme://host with no trailing slash, so normalise
// config entries the same way (stray quotes, paths and trailing slashes would
// otherwise never match). The two app URLs are always allowed too, so a
// mistyped ALLOWED_ORIGINS can't lock out the sites this API exists to serve.
const toOrigin = (value: string) => {
  const v = value.trim().replace(/^["']|["']$/g, "");
  try {
    return new URL(v).origin;
  } catch {
    return v.replace(/\/+$/, "");
  }
};
// A site served at both example.org and www.example.org is one site: allowing
// one allows the other, so visitors on the bare domain can still sign in.
const withWwwTwin = (origin: string) => {
  try {
    const u = new URL(origin);
    const twin = u.hostname.startsWith("www.") ? u.hostname.slice(4) : u.hostname.split(".").length === 2 ? `www.${u.hostname}` : null;
    return twin ? [origin, `${u.protocol}//${twin}${u.port ? `:${u.port}` : ""}`] : [origin];
  } catch {
    return [origin];
  }
};
const allowedOrigins = [...new Set([
  ...(process.env.ALLOWED_ORIGINS?.split(",") ?? []),
  process.env.FRONTEND_URL ?? "",
  process.env.MANAGE_URL ?? "",
].map(toOrigin).filter((o) => o && o !== "null").flatMap(withWwwTwin))];

if (isProd && !allowedOrigins.length) {
  logger.warn("ALLOWED_ORIGINS is not set in production — cross-origin requests will be rejected.");
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: IncomingMessage & { id?: string | number }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: ServerResponse) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(helmet());
// This is a JSON API, not a page meant for search results — the X-Robots-Tag
// header (unlike a <meta name="robots"> tag) applies to any content type, so
// it works here even though nothing we return is HTML.
app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});
app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});
// API responses are per-user and per-origin: never let browsers or the CDN
// store them. Without this, a response cached on one site (with that site's
// CORS header) gets replayed as a 304 on another, and session data like
// /api/auth/me was marked "public". No ETags means no 304 revalidation either.
app.set("etag", false);
app.use((_req, res, next) => {
  res.vary("Origin");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      // No Origin header (curl, server-to-server, same-origin) — allow.
      if (!origin) {
        callback(null, true);
        return;
      }
      const allowList = isProd ? allowedOrigins : [...allowedOrigins, ...DEV_ORIGINS];
      // Omit CORS headers rather than throwing — the browser then blocks the
      // response from being read, without us leaking a stack trace via Express's
      // default error handler.
      callback(null, allowList.includes(origin));
    },
    credentials: true,
  }),
);
app.use(cookieParser());
// JSON only, deliberately: every client here sends application/json, and a
// cross-site <form> can't set that content-type without triggering a CORS
// preflight (which our origin allowlist rejects). Parsing
// application/x-www-form-urlencoded too — a "simple" content-type exempt
// from preflight — would let a plain HTML form on another site submit
// authenticated requests using the session cookie (SameSite=None is
// required in prod since frontend/backend are cross-origin). Do not add
// express.urlencoded() back without a CSRF token to go with it.
app.use(express.json({ limit: "100kb" }));
app.use("/api", globalLimiter);
app.use(optionalAuth);

app.get("/", (req, res) => {
  res.json({
    status: "alive",
    message: "Simulation Governing API is active and resilient.",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", router);

export default app;
