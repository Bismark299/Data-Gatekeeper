import { Router } from "express";
import {
  db, storesTable, storeBundlesTable, storeOrdersTable, storeWithdrawalsTable,
  bundlesTable, usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";

const router = Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? "";
const DOMAIN = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://localhost:8080";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
}

function formatStore(store: typeof storesTable.$inferSelect) {
  return {
    ...store,
    profitBalance: parseFloat(store.profitBalance),
  };
}

function formatStoreBundle(
  sb: typeof storeBundlesTable.$inferSelect,
  bundle: typeof bundlesTable.$inferSelect
) {
  return {
    id: sb.id,
    storeId: sb.storeId,
    bundleId: sb.bundleId,
    sellingPrice: parseFloat(sb.sellingPrice),
    isActive: sb.isActive,
    createdAt: sb.createdAt,
    name: bundle.name,
    description: bundle.description,
    dataAmount: bundle.dataAmount,
    validityDays: bundle.validityDays,
    basePrice: parseFloat(bundle.price),
    network: bundle.network,
    category: bundle.category,
  };
}

function formatStoreOrder(o: typeof storeOrdersTable.$inferSelect) {
  return {
    ...o,
    sellingPrice: parseFloat(o.sellingPrice),
    basePrice: parseFloat(o.basePrice),
    profit: parseFloat(o.profit),
  };
}

// ─── AUTHENTICATED: MY STORE ─────────────────────────────────────────────────

router.get("/stores/my", requireAuth, async (req, res) => {
  const [store] = await db
    .select()
    .from(storesTable)
    .where(eq(storesTable.userId, req.session.userId!));
  if (!store) { res.json(null); return; }
  res.json(formatStore(store));
});

const CreateStoreBody = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
  colorTheme: z.enum(["yellow", "red", "blue", "green", "purple", "orange", "teal"]).optional(),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/).optional(),
});

router.post("/stores", requireAuth, async (req, res) => {
  const parsed = CreateStoreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid store data", details: parsed.error.issues }); return; }

  const existing = await db.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.userId, req.session.userId!));
  if (existing.length > 0) { res.status(409).json({ error: "You already have a store" }); return; }

  const { name, description, colorTheme, slug: customSlug } = parsed.data;
  let slug = customSlug ?? slugify(name);

  // Ensure slug uniqueness
  const [conflict] = await db.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.slug, slug));
  if (conflict) { slug = `${slug}-${Date.now().toString(36)}`; }

  const [store] = await db.insert(storesTable).values({
    userId: req.session.userId!,
    name,
    slug,
    description: description ?? "",
    colorTheme: colorTheme ?? "blue",
  }).returning();

  res.status(201).json(formatStore(store));
});

const UpdateStoreBody = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(300).optional(),
  colorTheme: z.enum(["yellow", "red", "blue", "green", "purple", "orange", "teal"]).optional(),
  isActive: z.boolean().optional(),
});

router.put("/stores/my", requireAuth, async (req, res) => {
  const parsed = UpdateStoreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid data" }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.userId, req.session.userId!));
  if (!store) { res.status(404).json({ error: "No store found" }); return; }

  const [updated] = await db.update(storesTable).set(parsed.data).where(eq(storesTable.id, store.id)).returning();
  res.json(formatStore(updated));
});

// ─── STORE BUNDLES ────────────────────────────────────────────────────────────

router.get("/stores/my/bundles", requireAuth, async (req, res) => {
  const [store] = await db.select().from(storesTable).where(eq(storesTable.userId, req.session.userId!));
  if (!store) { res.status(404).json({ error: "No store found" }); return; }

  const rows = await db
    .select()
    .from(storeBundlesTable)
    .innerJoin(bundlesTable, eq(storeBundlesTable.bundleId, bundlesTable.id))
    .where(and(eq(storeBundlesTable.storeId, store.id), eq(bundlesTable.isActive, true)))
    .orderBy(desc(storeBundlesTable.createdAt));

  res.json(rows.map(r => formatStoreBundle(r.store_bundles, r.bundles)));
});

const AddStoreBundleBody = z.object({
  bundleId: z.number().int().positive(),
  sellingPrice: z.number().positive(),
});

router.post("/stores/my/bundles", requireAuth, async (req, res) => {
  const parsed = AddStoreBundleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid bundle data" }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.userId, req.session.userId!));
  if (!store) { res.status(404).json({ error: "No store found" }); return; }

  const [bundle] = await db.select().from(bundlesTable).where(eq(bundlesTable.id, parsed.data.bundleId));
  if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }

  if (parsed.data.sellingPrice < parseFloat(bundle.price)) {
    res.status(400).json({ error: `Selling price must be at least GH₵${bundle.price} (base price)` });
    return;
  }

  // Check not already in store
  const [existing] = await db.select({ id: storeBundlesTable.id }).from(storeBundlesTable)
    .where(and(eq(storeBundlesTable.storeId, store.id), eq(storeBundlesTable.bundleId, parsed.data.bundleId)));
  if (existing) { res.status(409).json({ error: "Bundle already in your store" }); return; }

  const [sb] = await db.insert(storeBundlesTable).values({
    storeId: store.id,
    bundleId: bundle.id,
    sellingPrice: parsed.data.sellingPrice.toFixed(2),
  }).returning();

  res.status(201).json(formatStoreBundle(sb, bundle));
});

router.put("/stores/my/bundles/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = z.object({ sellingPrice: z.number().positive(), isActive: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid data" }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.userId, req.session.userId!));
  if (!store) { res.status(404).json({ error: "No store found" }); return; }

  const [sb] = await db.select().from(storeBundlesTable).where(and(eq(storeBundlesTable.id, id), eq(storeBundlesTable.storeId, store.id)));
  if (!sb) { res.status(404).json({ error: "Bundle not found in store" }); return; }

  const [bundle] = await db.select().from(bundlesTable).where(eq(bundlesTable.id, sb.bundleId));
  if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }

  if (parsed.data.sellingPrice < parseFloat(bundle.price)) {
    res.status(400).json({ error: `Selling price must be at least GH₵${bundle.price}` });
    return;
  }

  const [updated] = await db.update(storeBundlesTable).set({
    sellingPrice: parsed.data.sellingPrice.toFixed(2),
    ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
  }).where(eq(storeBundlesTable.id, id)).returning();

  res.json(formatStoreBundle(updated, bundle));
});

router.delete("/stores/my/bundles/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.userId, req.session.userId!));
  if (!store) { res.status(404).json({ error: "No store found" }); return; }

  await db.delete(storeBundlesTable).where(and(eq(storeBundlesTable.id, id), eq(storeBundlesTable.storeId, store.id)));
  res.json({ ok: true });
});

// ─── STORE ORDERS & STATS ────────────────────────────────────────────────────

router.get("/stores/my/orders", requireAuth, async (req, res) => {
  const [store] = await db.select().from(storesTable).where(eq(storesTable.userId, req.session.userId!));
  if (!store) { res.status(404).json({ error: "No store found" }); return; }

  const orders = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.storeId, store.id)).orderBy(desc(storeOrdersTable.createdAt));
  res.json(orders.map(formatStoreOrder));
});

router.get("/stores/my/stats", requireAuth, async (req, res) => {
  const [store] = await db.select().from(storesTable).where(eq(storesTable.userId, req.session.userId!));
  if (!store) { res.status(404).json({ error: "No store found" }); return; }

  const orders = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.storeId, store.id));
  const completed = orders.filter(o => o.status === "completed");
  const totalSales = completed.length;
  const totalRevenue = completed.reduce((s, o) => s + parseFloat(o.sellingPrice), 0);
  const totalProfit = completed.reduce((s, o) => s + parseFloat(o.profit), 0);
  const totalPending = orders.filter(o => o.status === "pending" || o.status === "processing").length;

  res.json({
    totalSales,
    totalRevenue: +totalRevenue.toFixed(2),
    totalProfit: +totalProfit.toFixed(2),
    profitBalance: parseFloat(store.profitBalance),
    totalPending,
  });
});

// ─── WITHDRAWALS ─────────────────────────────────────────────────────────────

router.get("/stores/my/withdrawals", requireAuth, async (req, res) => {
  const [store] = await db.select().from(storesTable).where(eq(storesTable.userId, req.session.userId!));
  if (!store) { res.status(404).json({ error: "No store found" }); return; }

  const list = await db.select().from(storeWithdrawalsTable).where(eq(storeWithdrawalsTable.storeId, store.id)).orderBy(desc(storeWithdrawalsTable.createdAt));
  res.json(list.map(w => ({ ...w, amount: parseFloat(w.amount) })));
});

const WithdrawBody = z.object({
  amount: z.number().positive(),
  method: z.string().optional(),
  bankCode: z.string().optional(),
  accountNumber: z.string().min(3),
  note: z.string().optional(),
});

router.post("/stores/my/withdraw", requireAuth, async (req, res) => {
  const parsed = WithdrawBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid withdrawal data" }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.userId, req.session.userId!));
  if (!store) { res.status(404).json({ error: "No store found" }); return; }

  const profit = parseFloat(store.profitBalance);
  if (parsed.data.amount > profit) {
    res.status(400).json({ error: `Insufficient profit balance. Available: GH₵${profit.toFixed(2)}` });
    return;
  }
  if (parsed.data.amount < 1) {
    res.status(400).json({ error: "Minimum withdrawal is GH₵1.00" }); return;
  }

  // Deduct from profit balance + create withdrawal record
  const newBalance = (profit - parsed.data.amount).toFixed(2);
  await db.update(storesTable).set({ profitBalance: newBalance }).where(eq(storesTable.id, store.id));

  const [w] = await db.insert(storeWithdrawalsTable).values({
    storeId: store.id,
    amount: parsed.data.amount.toFixed(2),
    status: "pending",
    method: parsed.data.method ?? "mobile_money",
    accountNumber: parsed.data.accountNumber,
    note: parsed.data.note ?? "",
  }).returning();

  // Initiate Paystack transfer
  let transferStatus = "pending";
  let transferCode = "";
  try {
    // Step 1: Create transfer recipient
    const recipientType = parsed.data.method === "bank" ? "ghipss" : "mobile_money";
    const bankCode = parsed.data.bankCode ?? "MTN";
    const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
      method: "POST",
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: recipientType,
        name: store.name,
        account_number: parsed.data.accountNumber,
        bank_code: bankCode,
        currency: "GHS",
      }),
    });
    const recipientData = await recipientRes.json() as any;
    if (!recipientRes.ok || !recipientData.data?.recipient_code) {
      throw new Error(recipientData.message ?? "Failed to create recipient");
    }
    const recipientCode: string = recipientData.data.recipient_code;

    // Step 2: Initiate transfer (amount in pesewas = GHS * 100)
    const transferRes = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "balance",
        amount: Math.round(parsed.data.amount * 100),
        recipient: recipientCode,
        reason: parsed.data.note || `Profit withdrawal - ${store.name}`,
        currency: "GHS",
      }),
    });
    const transferData = await transferRes.json() as any;
    if (transferRes.ok && transferData.data?.transfer_code) {
      transferCode = transferData.data.transfer_code;
      transferStatus = transferData.data.status === "success" ? "completed" : "processing";
    }
  } catch (_err) {
    // Transfer failed — keep as pending for manual processing
  }

  if (transferStatus !== "pending") {
    await db.update(storeWithdrawalsTable).set({
      status: transferStatus,
      note: transferCode ? `${parsed.data.note ?? ""} [${transferCode}]`.trim() : (parsed.data.note ?? ""),
    }).where(eq(storeWithdrawalsTable.id, w.id));
  }

  const [updated] = await db.select().from(storeWithdrawalsTable).where(eq(storeWithdrawalsTable.id, w.id));
  res.status(201).json({ ...updated, amount: parseFloat(updated.amount) });
});

// ─── PUBLIC STORE ROUTES ──────────────────────────────────────────────────────

router.get("/s/:slug", async (req, res) => {
  const { slug } = req.params;
  const [store] = await db.select().from(storesTable).where(and(eq(storesTable.slug, slug), eq(storesTable.isActive, true)));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  const rows = await db
    .select()
    .from(storeBundlesTable)
    .innerJoin(bundlesTable, eq(storeBundlesTable.bundleId, bundlesTable.id))
    .where(and(eq(storeBundlesTable.storeId, store.id), eq(storeBundlesTable.isActive, true), eq(bundlesTable.isActive, true)))
    .orderBy(bundlesTable.network);

  res.json({
    store: {
      id: store.id,
      name: store.name,
      slug: store.slug,
      description: store.description,
      colorTheme: store.colorTheme,
    },
    bundles: rows.map(r => formatStoreBundle(r.store_bundles, r.bundles)),
  });
});

const StoreCheckoutBody = z.object({
  storeBundleId: z.number().int().positive(),
  customerPhone: z.string().min(7),
  customerEmail: z.string().email(),
});

router.post("/s/:slug/checkout", async (req, res) => {
  const parsed = StoreCheckoutBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid checkout data", details: parsed.error.issues }); return; }

  const { slug } = req.params;
  const [store] = await db.select().from(storesTable).where(and(eq(storesTable.slug, slug), eq(storesTable.isActive, true)));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  const [sbRow] = await db
    .select()
    .from(storeBundlesTable)
    .innerJoin(bundlesTable, eq(storeBundlesTable.bundleId, bundlesTable.id))
    .where(and(eq(storeBundlesTable.id, parsed.data.storeBundleId), eq(storeBundlesTable.storeId, store.id), eq(storeBundlesTable.isActive, true)));

  if (!sbRow) { res.status(404).json({ error: "Bundle not found in this store" }); return; }

  const sb = sbRow.store_bundles;
  const bundle = sbRow.bundles;
  const sellingPrice = parseFloat(sb.sellingPrice);
  const basePrice = parseFloat(bundle.price);
  const profit = +(sellingPrice - basePrice).toFixed(2);

  const reference = `STORE-${store.id}-${Date.now()}`;
  const callbackUrl = `${DOMAIN}/s/${slug}?ref=${reference}`;

  // Create pending store_order first
  const [storeOrder] = await db.insert(storeOrdersTable).values({
    storeId: store.id,
    storeBundleId: sb.id,
    bundleId: bundle.id,
    bundleName: bundle.name,
    bundleData: bundle.dataAmount,
    bundleNetwork: bundle.network,
    bundleValidityDays: bundle.validityDays,
    customerPhone: parsed.data.customerPhone,
    customerEmail: parsed.data.customerEmail,
    sellingPrice: sellingPrice.toFixed(2),
    basePrice: basePrice.toFixed(2),
    profit: profit.toFixed(2),
    paystackReference: reference,
    status: "pending",
  }).returning();

  // Initialize Paystack
  const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: parsed.data.customerEmail,
      amount: Math.round(sellingPrice * 100),
      reference,
      callback_url: callbackUrl,
      metadata: {
        storeOrderId: storeOrder.id,
        storeId: store.id,
        bundleName: bundle.name,
        customerPhone: parsed.data.customerPhone,
      },
    }),
  });

  const psData = await paystackRes.json() as { status: boolean; data?: { authorization_url: string; access_code: string } };
  if (!psData.status) { res.status(502).json({ error: "Payment gateway error. Please try again." }); return; }

  res.json({ authorizationUrl: psData.data!.authorization_url, reference, storeOrderId: storeOrder.id });
});

router.get("/s/:slug/orders", async (req, res) => {
  const { slug } = req.params;
  const { phone } = req.query as { phone?: string };
  if (!phone || phone.trim().length < 7) {
    res.status(400).json({ error: "Valid phone number required" }); return;
  }
  const [store] = await db.select().from(storesTable).where(eq(storesTable.slug, slug));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }
  const orders = await db
    .select({
      id: storeOrdersTable.id,
      bundleData: storeOrdersTable.bundleData,
      bundleNetwork: storeOrdersTable.bundleNetwork,
      customerPhone: storeOrdersTable.customerPhone,
      sellingPrice: storeOrdersTable.sellingPrice,
      status: storeOrdersTable.status,
      paystackReference: storeOrdersTable.paystackReference,
      createdAt: storeOrdersTable.createdAt,
    })
    .from(storeOrdersTable)
    .where(and(eq(storeOrdersTable.storeId, store.id), eq(storeOrdersTable.customerPhone, phone.trim())))
    .orderBy(desc(storeOrdersTable.createdAt))
    .limit(50);
  res.json(orders.map(o => ({ ...o, sellingPrice: parseFloat(o.sellingPrice as any) })));
});

router.post("/s/:slug/verify", async (req, res) => {
  const { ref } = req.body as { ref?: string };
  if (!ref) { res.status(400).json({ error: "Reference required" }); return; }

  const [storeOrder] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.paystackReference, ref));
  if (!storeOrder) { res.status(404).json({ error: "Order not found" }); return; }
  if (storeOrder.status === "completed") { res.json(formatStoreOrder(storeOrder)); return; }

  const psRes = await fetch(`https://api.paystack.co/transaction/verify/${ref}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  });
  const psData = await psRes.json() as { status: boolean; data?: { status: string; amount: number } };

  if (!psData.status || psData.data?.status !== "success") {
    res.status(402).json({ error: "Payment not successful" });
    return;
  }

  // Payment confirmed — move to "processing" for admin to fulfil; profit credited on admin completion
  if (storeOrder.status !== "processing") {
    await db.update(storeOrdersTable).set({ status: "processing" }).where(eq(storeOrdersTable.id, storeOrder.id));
  }

  const [updated] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.id, storeOrder.id));
  res.json(formatStoreOrder(updated));
});

// ─── PAYSTACK WEBHOOK (store orders) ─────────────────────────────────────────

router.post("/s/paystack/webhook", async (req, res) => {
  const sig = req.headers["x-paystack-signature"] as string;
  const hash = crypto.createHmac("sha512", PAYSTACK_SECRET).update(JSON.stringify(req.body)).digest("hex");
  if (hash !== sig) { res.status(401).json({ error: "Invalid signature" }); return; }

  const { event, data } = req.body as { event: string; data: { reference: string; status: string; amount: number } };
  if (event !== "charge.success" || !data.reference.startsWith("STORE-")) { res.sendStatus(200); return; }

  const [storeOrder] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.paystackReference, data.reference));
  if (!storeOrder || storeOrder.status === "completed" || storeOrder.status === "processing") { res.sendStatus(200); return; }

  // Payment confirmed via webhook — move to processing for admin to fulfil
  await db.update(storeOrdersTable).set({ status: "processing" }).where(eq(storeOrdersTable.id, storeOrder.id));

  res.sendStatus(200);
});

// Admin: list all stores
router.get("/admin/stores", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const stores = await db.select().from(storesTable).orderBy(desc(storesTable.createdAt));
  res.json(stores.map(formatStore));
});

// ─── ADMIN: STORE ORDERS ──────────────────────────────────────────────────────

router.get("/admin/store-orders", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const rows = await db
    .select({
      id: storeOrdersTable.id,
      storeId: storeOrdersTable.storeId,
      storeName: storesTable.name,
      storeSlug: storesTable.slug,
      bundleData: storeOrdersTable.bundleData,
      bundleNetwork: storeOrdersTable.bundleNetwork,
      customerPhone: storeOrdersTable.customerPhone,
      customerEmail: storeOrdersTable.customerEmail,
      sellingPrice: storeOrdersTable.sellingPrice,
      basePrice: storeOrdersTable.basePrice,
      profit: storeOrdersTable.profit,
      status: storeOrdersTable.status,
      paystackReference: storeOrdersTable.paystackReference,
      createdAt: storeOrdersTable.createdAt,
      updatedAt: storeOrdersTable.updatedAt,
    })
    .from(storeOrdersTable)
    .innerJoin(storesTable, eq(storeOrdersTable.storeId, storesTable.id))
    .orderBy(desc(storeOrdersTable.createdAt));
  res.json(rows.map(o => ({
    ...o,
    sellingPrice: parseFloat(o.sellingPrice as any),
    basePrice: parseFloat(o.basePrice as any),
    profit: parseFloat(o.profit as any),
  })));
});

router.patch("/admin/store-orders/:id/complete", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [order] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.status === "completed") { res.json(formatStoreOrder(order)); return; }

  await db.update(storeOrdersTable).set({ status: "completed" }).where(eq(storeOrdersTable.id, id));

  // Credit profit to store owner
  const profit = parseFloat(order.profit);
  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, order.storeId));
  if (store) {
    const newProfit = (parseFloat(store.profitBalance) + profit).toFixed(2);
    await db.update(storesTable).set({ profitBalance: newProfit }).where(eq(storesTable.id, store.id));
  }

  const [updated] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.id, id));
  res.json(formatStoreOrder(updated));
});

router.patch("/admin/store-orders/:id/cancel", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [order] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  await db.update(storeOrdersTable).set({ status: "cancelled" }).where(eq(storeOrdersTable.id, id));
  const [updated] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.id, id));
  res.json(formatStoreOrder(updated));
});

export { router as storesRouter };
