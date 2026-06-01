import type { Request } from "express";

/**
 * Resolve the public origin (scheme + host) to use for building Paystack
 * callback_url redirects.
 *
 * Order of preference:
 *   1. APP_ORIGIN env var (explicit override)
 *   2. The browser's Origin header (the real site the customer came from)
 *   3. The forwarded Host (behind the Replit / Render reverse proxy)
 *   4. The first REPLIT_DOMAINS entry
 *   5. localhost dev fallback
 *
 * This avoids the previous bug where an unset APP_ORIGIN sent customers to
 * http://localhost:5173 after paying, so the redirect back to the store failed.
 */
export function getAppOrigin(req: Request): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN;

  const origin = req.headers.origin;
  if (origin && /^https?:\/\//.test(origin)) return origin;

  const proto = ((req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]
    ?? req.protocol
    ?? "https").trim();
  const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.headers.host;
  if (host) return `${proto}://${host}`;

  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (replitDomain) return `https://${replitDomain}`;

  return "http://localhost:5173";
}
