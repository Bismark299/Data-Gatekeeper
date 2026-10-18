import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, numberVerificationsTable, usersTable } from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/auth";

const router = Router();
const normalize = (v: string) => v.replace(/\D/g, "");

router.post("/number-verifications", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !["agent", "dealer", "admin"].includes(user.role)) {
    res.status(403).json({ error: "Agent or dealer account required" });
    return;
  }
  const input = req.body?.numbers;
  if (!Array.isArray(input) || input.length < 1 || input.length > 500 || input.some(x => typeof x !== "string")) {
    res.status(400).json({ error: "Submit between 1 and 500 phone numbers." }); return;
  }
  const numbers = [...new Set(input.map(normalize).filter(n => /^\d{10,15}$/.test(n)))];
  if (!numbers.length) { res.status(400).json({ error: "No valid phone numbers found." }); return; }
  const created = await db.insert(numberVerificationsTable).values(numbers.map(phoneNumber => ({ userId, phoneNumber }))).returning();
  res.status(201).json({ submissions: created, skippedInvalid: input.length - numbers.length });
});

router.get("/number-verifications/my", requireAuth, async (req, res): Promise<void> => {
  const submissions = await db.select().from(numberVerificationsTable)
    .where(eq(numberVerificationsTable.userId, req.session.userId!))
    .orderBy(desc(numberVerificationsTable.createdAt)).limit(1000);
  res.json({ submissions });
});

router.get("/admin/number-verifications", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select({
    id: numberVerificationsTable.id, userId: numberVerificationsTable.userId,
    agentName: usersTable.name, agentEmail: usersTable.email,
    phoneNumber: numberVerificationsTable.phoneNumber, status: numberVerificationsTable.status,
    adminNote: numberVerificationsTable.adminNote, createdAt: numberVerificationsTable.createdAt,
    updatedAt: numberVerificationsTable.updatedAt,
  }).from(numberVerificationsTable).innerJoin(usersTable, eq(usersTable.id, numberVerificationsTable.userId))
    .orderBy(desc(numberVerificationsTable.createdAt)).limit(5000);
  res.json({ submissions: rows });
});

router.patch("/admin/number-verifications/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { status, note } = req.body ?? {};
  if (!Number.isInteger(id) || id < 1 || !["verified", "rejected", "pending"].includes(status) ||
      (note != null && (typeof note !== "string" || note.length > 500))) {
    res.status(400).json({ error: "Invalid verification update." }); return;
  }
  const [updated] = await db.update(numberVerificationsTable)
    .set({ status, adminNote: note?.trim() || null, reviewedBy: req.session.userId!, updatedAt: new Date() })
    .where(eq(numberVerificationsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Submission not found." }); return; }
  res.json({ submission: updated });
});

router.get("/admin/number-verifications/export.csv", requireAdmin, async (req, res): Promise<void> => {
  const rows = await db.select({
    agentName: usersTable.name, agentEmail: usersTable.email, phoneNumber: numberVerificationsTable.phoneNumber,
    status: numberVerificationsTable.status, adminNote: numberVerificationsTable.adminNote,
    submittedAt: numberVerificationsTable.createdAt,
  }).from(numberVerificationsTable).innerJoin(usersTable, eq(usersTable.id, numberVerificationsTable.userId))
    .orderBy(desc(numberVerificationsTable.createdAt)).limit(5000);
  const csv = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  res.type("text/csv").attachment("number-verifications.csv")
    .send(["Agent,Email,Phone,Status,Admin Note,Submitted At", ...rows.map(r =>
      [r.agentName,r.agentEmail,r.phoneNumber,r.status,r.adminNote,r.submittedAt.toISOString()].map(csv).join(","))].join("\r\n"));
});
export default router;
