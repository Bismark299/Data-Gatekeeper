import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    userRole?: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Re-queries the DB on every admin request to prevent privilege escalation
// after a role downgrade or account deactivation — session cache is NOT trusted.
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db
    .select({ role: usersTable.role, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));
  if (!user || user.role !== "admin" || !user.isActive) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  req.session.userRole = user.role;
  next();
}
