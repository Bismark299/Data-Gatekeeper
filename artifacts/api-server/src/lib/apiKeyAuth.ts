import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { db, apiClientsTable } from "@workspace/db";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      apiClient?: typeof apiClientsTable.$inferSelect;
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
  const [client] = await db
    .select()
    .from(apiClientsTable)
    .where(and(eq(apiClientsTable.keyHash, hash), eq(apiClientsTable.isActive, true)));

  if (!client) {
    res.status(401).json({ error: "Invalid or inactive API key" });
    return;
  }

  // Update lastUsedAt fire-and-forget (non-blocking)
  db.update(apiClientsTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiClientsTable.id, client.id))
    .catch(() => {});

  req.apiClient = client;
  next();
}
