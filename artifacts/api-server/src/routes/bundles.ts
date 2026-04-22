import { Router, type IRouter } from "express";
import { eq, and, gte, lte, type SQL } from "drizzle-orm";
import { db, bundlesTable } from "@workspace/db";
import {
  ListBundlesQueryParams,
  CreateBundleBody,
  GetBundleParams,
  UpdateBundleParams,
  UpdateBundleBody,
  DeleteBundleParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

function formatBundle(b: typeof bundlesTable.$inferSelect) {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    dataAmount: b.dataAmount,
    validityDays: b.validityDays,
    price: Number(b.price),
    category: b.category,
    network: b.network,
    isActive: b.isActive,
    createdAt: b.createdAt.toISOString(),
  };
}

router.get("/bundles", async (req, res): Promise<void> => {
  const params = ListBundlesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { category, network, minPrice, maxPrice } = params.data as { category?: string; network?: string; minPrice?: number; maxPrice?: number };

  const conditions: SQL[] = [eq(bundlesTable.isActive, true)];

  if (category) {
    conditions.push(eq(bundlesTable.category, category));
  }
  if (network) {
    conditions.push(eq(bundlesTable.network, network));
  }
  if (minPrice !== undefined) {
    conditions.push(gte(bundlesTable.price, String(minPrice)));
  }
  if (maxPrice !== undefined) {
    conditions.push(lte(bundlesTable.price, String(maxPrice)));
  }

  const bundles = await db
    .select()
    .from(bundlesTable)
    .where(and(...conditions));

  res.json(bundles.map(formatBundle));
});

router.post("/bundles", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateBundleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [bundle] = await db
    .insert(bundlesTable)
    .values({ ...parsed.data, price: String(parsed.data.price) })
    .returning();

  res.status(201).json(formatBundle(bundle));
});

router.get("/bundles/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetBundleParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [bundle] = await db
    .select()
    .from(bundlesTable)
    .where(eq(bundlesTable.id, params.data.id));

  if (!bundle) {
    res.status(404).json({ error: "Bundle not found" });
    return;
  }

  res.json(formatBundle(bundle));
});

router.patch("/bundles/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateBundleParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateBundleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Partial<typeof bundlesTable.$inferInsert> = { ...parsed.data };
  if (parsed.data.price !== undefined) {
    updateData.price = String(parsed.data.price);
  }

  const [bundle] = await db
    .update(bundlesTable)
    .set(updateData)
    .where(eq(bundlesTable.id, params.data.id))
    .returning();

  if (!bundle) {
    res.status(404).json({ error: "Bundle not found" });
    return;
  }

  res.json(formatBundle(bundle));
});

router.delete("/bundles/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteBundleParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [bundle] = await db
    .delete(bundlesTable)
    .where(eq(bundlesTable.id, params.data.id))
    .returning();

  if (!bundle) {
    res.status(404).json({ error: "Bundle not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
