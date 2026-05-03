import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function generateDepositCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const rand = Array.from({ length: 5 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join("");
    const code = rand;
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.depositCode, code));
    if (!existing) return code;
  }
  throw new Error("Could not generate unique deposit code");
}

const router: IRouter = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, email, password, phone } = parsed.data;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const depositCode = await generateDepositCode();

  const [user] = await db
    .insert(usersTable)
    .values({ name, email, passwordHash, phone: phone || null, role: "agent", isActive: true, depositCode })
    .returning();

  req.session.userId = user.id;
  req.session.userRole = user.role;

  res.status(201).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    },
    message: "Registration successful",
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  req.session.userId = user.id;
  req.session.userRole = user.role;

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      depositCode: user.depositCode ?? null,
      createdAt: user.createdAt.toISOString(),
    },
    message: "Login successful",
  });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.json({ message: "Logged out" });
  });
});

router.patch("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const { name, phone, currentPassword, newPassword } = req.body;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const updates: Partial<{ name: string; phone: string | null; passwordHash: string }> = {};
  if (name && typeof name === "string") updates.name = name.trim();
  if (phone !== undefined) updates.phone = phone || null;

  if (newPassword) {
    if (!currentPassword) { res.status(400).json({ error: "Current password required" }); return; }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) { res.status(400).json({ error: "Current password is incorrect" }); return; }
    if (newPassword.length < 6) { res.status(400).json({ error: "New password must be at least 6 characters" }); return; }
    updates.passwordHash = await bcrypt.hash(newPassword, 12);
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
  res.json({
    id: updated.id, name: updated.name, email: updated.email, phone: updated.phone,
    role: updated.role, isActive: updated.isActive, depositCode: updated.depositCode ?? null, createdAt: updated.createdAt.toISOString(),
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    depositCode: user.depositCode ?? null,
    createdAt: user.createdAt.toISOString(),
  });
});

export default router;
