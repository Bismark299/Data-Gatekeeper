import express, { type Express } from "express";
import cors from "cors";
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

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

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

app.use(express.json({ limit: "1mb" }));
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

app.use("/api/auth", authLimiter);
app.use("/api/wallet", walletLimiter);
app.use("/api/orders", orderLimiter);
app.use("/api/cart/checkout", orderLimiter);
app.use("/api", apiLimiter);

app.use("/api", router);

// ── Serve React frontend (production) ─────────────────────────────────────────
// In production the frontend is built into artifacts/data-bundle/dist/public.
// All non-API requests are served the SPA index.html.
if (process.env.NODE_ENV === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(__dirname, "../../data-bundle/dist/public");

  app.use(express.static(frontendDist));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
