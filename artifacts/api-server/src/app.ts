import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import session from "express-session";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import connectPg from "connect-pg-simple";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";

const PgStore = connectPg(session);

const app: Express = express();

app.set("trust proxy", 1);

// Compress all API responses with gzip
app.use(compression());

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'"],
        styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc:      ["'self'", "data:", "https:"],
        fontSrc:     ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc:  ["'self'", "https://api.paystack.co"],
        frameSrc:    ["'self'", "https://*.paystack.co"],
        objectSrc:   ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS: allow the local Vite dev server and any production domain set via APP_ORIGIN.
const allowedOrigins: string[] = [
  "http://localhost:5173",
  ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : []),
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// Capture the raw body buffer for webhook HMAC verification (Paystack signs raw bytes).
// Must be set up before express.json() so the buffer is available in webhook handlers.
app.use(express.json({
  limit: "1mb",
  verify: (req: express.Request, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be set.");
}

app.use(
  session({
    // PostgreSQL session store: persists sessions across restarts,
    // allows immediate invalidation when a user is deactivated or role-changed,
    // and does not leak memory under load.
    store: new PgStore({
      pool,
      tableName: "sessions",
      createTableIfMissing: false,
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

// ── Rate limiters ─────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in 15 minutes." },
});

const walletLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many wallet requests. Please slow down." },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many orders. Please slow down." },
});

const publicApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  // Key by API key header so each client gets its own bucket; fall back to IP
  keyGenerator: (req) => (req.headers["x-api-key"] as string | undefined) ?? req.ip ?? "unknown",
  validate: { keyGeneratorIpFallback: false }, // suppress IPv6 warning — key is the API key, not raw IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Maximum 60 requests per minute per API key." },
});

app.use("/api/auth", authLimiter);
app.use("/api/wallet", walletLimiter);
app.use("/api/orders", orderLimiter);
app.use("/api/cart/checkout", orderLimiter);
app.use("/api/v1", publicApiLimiter);
app.use("/api", apiLimiter);

app.use("/api", router);

// ── Global JSON error handler ─────────────────────────────────────────────────
// Must be registered AFTER all routes. Express detects error handlers by their
// 4-argument signature (err, req, res, next). Without this, Express falls back
// to its built-in handler which sends HTML — never acceptable for an API server.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { statusCode?: number })?.statusCode
    ?? 500;
  const message = (err as { message?: string })?.message ?? "Internal server error";
  req.log?.error({ err }, "Unhandled error");
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
});

// ── Serve React frontend (production) ─────────────────────────────────────────
// In production the frontend is built into artifacts/data-bundle/dist/public.
// All non-API requests are served the SPA index.html.
if (process.env.NODE_ENV === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(__dirname, "../../data-bundle/dist/public");

  app.use(express.static(frontendDist));

  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
