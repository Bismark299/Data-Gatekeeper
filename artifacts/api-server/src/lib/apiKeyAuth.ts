import crypto from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      apiUser?: typeof usersTable.$inferSelect;
    }
  }
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const random = crypto.randomBytes(24).toString("hex"); // 48 hex chars
  const raw    = `dk_live_${random}`;
  const hash   = crypto.createHash("sha256").update(raw).digest("hex");
  const prefix = random.substring(0, 8);
  return { raw, hash, prefix };
}

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.headers["x-api-key"] as string | undefined;
  if (!key) {
    res.status(401).json({ error: "Missing X-API-Key header", docs: "/api/v1/docs" });
    return;
  }

  const hash = hashApiKey(key);
  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(
      eq(usersTable.apiKeyHash, hash),
      eq(usersTable.isActive, true),
      isNull(usersTable.deletedAt),
    ));

  if (!user) {
    res.status(401).json({ error: "Invalid or inactive API key" });
    return;
  }

  // Update lastUsedAt fire-and-forget
  db.update(usersTable)
    .set({ apiKeyLastUsedAt: new Date() })
    .where(eq(usersTable.id, user.id))
    .catch(() => {});

  req.apiUser = user;
  next();
}
