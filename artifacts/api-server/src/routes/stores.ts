import { Router } from "express";
import {
  db, storesTable, storeBundlesTable, storeOrdersTable, storeWithdrawalsTable,
  bundlesTable, usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { eq, desc, and, ne, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { dispatchOrder } from "../lib/dispatch";
import { insertLedgerEntry } from "./wallet";
import {
  genWithdrawalReference,
  processWithdrawalTransfer,
  markWithdrawalFailedAndRefund,
  WITHDRAWAL_FEE as PAYOUT_FEE,
} from "../lib/storeWithdrawals";
import { getAppOrigin } from "../lib/origin";

const router = Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? "";

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
  const sellingPrice = parseFloat(o.sellingPrice);
  const basePrice    = parseFloat(o.basePrice);
  const agentCost    = o.agentCost != null ? parseFloat(o.agentCost) : null;
  const profit       = parseFloat(o.profit);
  const systemProfit = agentCost != null ? +(agentCost - basePrice).toFixed(2) : null;
  return { ...o, sellingPrice, basePrice, agentCost, profit, systemProfit };
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
  sellingPrice: z.number().positive().max(10000),
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
  const id = parseInt(String(req.params.id), 10);
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
  const id = parseInt(String(req.params.id), 10);
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

  // Exclude bare "pending" orders — those are checkout initiations that were never paid.
  // Only show orders that progressed past the payment step.
  const orders = await db.select().from(storeOrdersTable)
    .where(and(eq(storeOrdersTable.storeId, store.id), ne(storeOrdersTable.status, "pending")))
    .orderBy(desc(storeOrdersTable.createdAt));
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
  // "pending" = not yet paid (abandoned checkout) — don't count those as pending sales
  const totalPending = orders.filter(o => o.status === "processing" || o.status === "paid").length;

  res.json({
    totalSales,
    totalRevenue: +totalRevenue.toFixed(2),
    totalProfit: +totalProfit.toFixed(2),
    profitBalance: parseFloat(store.profitBalance),
    totalPending,
  });
});

// ─── RESOLVE MOMO ACCOUNT ────────────────────────────────────────────────────

router.post("/stores/resolve-momo", requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) {
    res.status(503).json({ error: "Payment service not configured" }); return;
  }
  const { accountNumber, bankCode } = req.body as { accountNumber?: string; bankCode?: string };
  if (!accountNumber || !bankCode) {
    res.status(400).json({ error: "Account number and bank code are required" }); return;
  }
  if (!/^\d{10}$/.test(accountNumber)) {
    res.status(400).json({ error: "Account number must be exactly 10 digits" }); return;
  }
  try {
    const paystackRes = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } },
    );
    const data = await paystackRes.json() as { status: boolean; data?: { account_name: string; account_number: string }; message?: string };
    if (!data.status || !data.data) {
      res.status(400).json({ error: data.message ?? "Could not verify account. Check the number and network." }); return;
    }
    res.json({ verified: true, accountName: data.data.account_name, accountNumber: data.data.account_number });
  } catch {
    res.status(500).json({ error: "Verification service unavailable. Try again." });
  }
});

// ─── SAVE / DELETE MOMO DETAILS ──────────────────────────────────────────────

const MomoDetailsBody = z.object({
  momoNetwork: z.string().min(1),
  momoNumber: z.string().regex(/^\d{10}$/, "Must be 10 digits"),
  momoName: z.string().min(1),
});

router.post("/stores/my/momo-details", requireAuth, async (req, res) => {
  const parsed = MomoDetailsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid MoMo details" }); return; }
  await db.update(storesTable).set({
    momoNetwork: parsed.data.momoNetwork,
    momoNumber: parsed.data.momoNumber,
    momoName: parsed.data.momoName,
    // Account changed → drop the cached Paystack recipient so it gets recreated
    paystackRecipientCode: null,
  }).where(eq(storesTable.userId, req.session.userId!));
  res.json({ ok: true });
});

router.delete("/stores/my/momo-details", requireAuth, async (req, res) => {
  await db.update(storesTable).set({
    momoNetwork: null, momoNumber: null, momoName: null, paystackRecipientCode: null,
  }).where(eq(storesTable.userId, req.session.userId!));
  res.json({ ok: true });
});

// ─── WITHDRAWALS ─────────────────────────────────────────────────────────────

router.get("/stores/my/withdrawals", requireAuth, async (req, res) => {
  const [store] = await db.select().from(storesTable).where(eq(storesTable.userId, req.session.userId!));
  if (!store) { res.status(404).json({ error: "No store found" }); return; }

  const list = await db.select().from(storeWithdrawalsTable).where(eq(storeWithdrawalsTable.storeId, store.id)).orderBy(desc(storeWithdrawalsTable.createdAt));
  res.json(list.map(w => ({ ...w, amount: parseFloat(w.amount) })));
});

const WithdrawBody = z.object({
  amount: z.number().positive().max(10000),
  method: z.string().optional(),
  bankCode: z.string().optional(),
  accountNumber: z.string().min(3).max(20),
  accountName: z.string().optional(),
  note: z.string().max(200).optional(),
});

router.post("/stores/my/withdraw", requireAuth, async (req, res) => {
  const parsed = WithdrawBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid withdrawal data" }); return; }

  const WITHDRAWAL_FEE = PAYOUT_FEE;
  const MIN_WITHDRAWAL = 10;

  if (parsed.data.amount < MIN_WITHDRAWAL) {
    res.status(400).json({ error: `Minimum withdrawal is GH₵${MIN_WITHDRAWAL}.00` }); return;
  }

  let store: typeof storesTable.$inferSelect;
  let w: typeof storeWithdrawalsTable.$inferSelect;

  try {
    ({ store, w } = await db.transaction(async (tx) => {
      // Lock the store row so concurrent withdrawal requests can't both
      // read the same balance and both succeed
      const [locked] = await tx
        .select()
        .from(storesTable)
        .where(eq(storesTable.userId, req.session.userId!))
        .for("update");

      if (!locked) throw Object.assign(new Error("No store found"), { status: 404 });

      // Block if a withdrawal is already in flight (pending OR processing) so an
      // agent can't double-withdraw while a transfer is mid-settlement
      const [pendingW] = await tx
        .select({ id: storeWithdrawalsTable.id })
        .from(storeWithdrawalsTable)
        .where(
          and(
            eq(storeWithdrawalsTable.storeId, locked.id),
            inArray(storeWithdrawalsTable.status, ["pending", "processing"])
          )
        );
      if (pendingW) {
        throw Object.assign(
          new Error("You already have a withdrawal being processed. Please wait for it to complete before submitting a new one."),
          { status: 409 }
        );
      }

      const profit = parseFloat(locked.profitBalance);
      const totalDeduction = parsed.data.amount + WITHDRAWAL_FEE;

      if (totalDeduction > profit) {
        throw Object.assign(
          new Error(`Insufficient balance. Need GH₵${totalDeduction.toFixed(2)} (amount + GH₵${WITHDRAWAL_FEE} fee). Available: GH₵${profit.toFixed(2)}`),
          { status: 400 }
        );
      }

      // Deduct amount + fee from profit balance
      const newBalance = (profit - totalDeduction).toFixed(2);
      const [updatedStore] = await tx
        .update(storesTable)
        .set({ profitBalance: newBalance })
        .where(eq(storesTable.id, locked.id))
        .returning();

      const [withdrawal] = await tx.insert(storeWithdrawalsTable).values({
        storeId: locked.id,
        amount: parsed.data.amount.toFixed(2),
        status: "pending",
        method: parsed.data.method ?? "mobile_money",
        accountNumber: parsed.data.accountNumber,
        accountName: parsed.data.accountName ?? "",
        bankCode: parsed.data.bankCode ?? "MTN",
        note: parsed.data.note ?? "",
        reference: genWithdrawalReference(),
      }).returning();

      return { store: updatedStore, w: withdrawal };
    }));
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Withdrawal failed" });
    return;
  }

  // ── Attempt to auto-send via Paystack (balance check, recipient, transfer) ──
  // The webhook + reconciler settle "processing" transfers and refund failures.
  // All writes below are guarded on status='pending' so a transfer webhook that
  // arrives mid-flight (between initiateTransfer and here) is never clobbered.
  const result = await processWithdrawalTransfer(w, store);
  if (result.status !== "pending") {
    await db.update(storeWithdrawalsTable).set({
      status: result.status,
      transferCode: result.transferCode,
    }).where(and(eq(storeWithdrawalsTable.id, w.id), eq(storeWithdrawalsTable.status, "pending")));
  } else if (result.transferCode) {
    // OTP path: transfer was created but needs admin OTP — keep the code for later
    await db.update(storeWithdrawalsTable).set({
      transferCode: result.transferCode,
    }).where(and(eq(storeWithdrawalsTable.id, w.id), eq(storeWithdrawalsTable.status, "pending")));
  }

  const [updated] = await db.select().from(storeWithdrawalsTable).where(eq(storeWithdrawalsTable.id, w.id));
  res.status(201).json({ ...updated, amount: parseFloat(updated.amount), autoMessage: result.autoMessage });
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
  customerPhone: z.string().transform(s => s.replace(/\D/g, "")).pipe(z.string().length(10, "Phone must be 10 digits")),
  customerEmail: z.string().email().optional().or(z.literal("")),
}).transform(d => ({ ...d, customerEmail: d.customerEmail || undefined }));

router.post("/s/:slug/checkout", async (req, res) => {
  if (!PAYSTACK_SECRET) { res.status(503).json({ error: "Payment service is not configured" }); return; }
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
  const PAYSTACK_FEE_RATE = 0.02; // 2% Paystack processing fee passed to customer
  const feeGhs = parseFloat((sellingPrice * PAYSTACK_FEE_RATE).toFixed(2));
  const chargedPrice = parseFloat((sellingPrice + feeGhs).toFixed(2));
  const basePrice = parseFloat(bundle.price); // platform's buying cost from telecom

  // Determine store owner's role to pick the correct agent/dealer cost
  const [owner] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, store.userId));
  const ownerRole = owner?.role ?? "agent";
  const agentCost = ownerRole === "dealer"
    ? (bundle.dealerPrice != null ? parseFloat(bundle.dealerPrice) : basePrice)
    : (bundle.agentPrice  != null ? parseFloat(bundle.agentPrice)  : basePrice);

  // profit = what the agent earns (credited to their profitBalance on completion)
  const profit = +(sellingPrice - agentCost).toFixed(2);

  const reference = `STORE-${store.id}-${Date.now()}`;
  const callbackUrl = `${getAppOrigin(req)}/s/${slug}?ref=${reference}`;

  // Order record is NOT created here — only created at verify/webhook time.
  // Customers who open Paystack and cancel/close without paying leave no trace.
  const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: parsed.data.customerEmail ?? `guest-${parsed.data.customerPhone.replace(/\D/g, "")}@checkout.example.com`,
      amount: Math.round(chargedPrice * 100),
      reference,
      callback_url: callbackUrl,
      // Store all order data in metadata so we can reconstruct at verify/webhook time
      metadata: {
        storeId:            store.id,
        storeBundleId:      sb.id,
        bundleId:           bundle.id,
        bundleName:         bundle.name,
        bundleData:         bundle.dataAmount,
        bundleNetwork:      bundle.network,
        bundleValidityDays: bundle.validityDays,
        customerPhone:      parsed.data.customerPhone,
        customerEmail:      parsed.data.customerEmail ?? null,
        sellingPrice:       sellingPrice.toFixed(2),
        basePrice:          basePrice.toFixed(2),
        agentCost:          agentCost.toFixed(2),
        profit:             profit.toFixed(2),
      },
    }),
  });

  const psData = await paystackRes.json() as { status: boolean; data?: { authorization_url: string; access_code: string } };
  if (!psData.status) { res.status(502).json({ error: "Payment gateway error. Please try again." }); return; }

  res.json({ authorizationUrl: psData.data!.authorization_url, reference, storeOrderId: null });
});

router.get("/s/:slug/orders", async (req, res) => {
  const { slug } = req.params;
  const { phone } = req.query as { phone?: string };
  const phoneDigits = (phone ?? "").replace(/\D/g, "");
  if (phoneDigits.length !== 10) {
    res.status(400).json({ error: "Valid 10-digit phone number required" }); return;
  }
  const [store] = await db.select().from(storesTable).where(eq(storesTable.slug, slug));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }
  // Match against either the raw stored value (legacy, may contain spaces) or the
  // normalized digits — strip non-digits in SQL so old spaced entries still match.
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
    .where(and(
      eq(storeOrdersTable.storeId, store.id),
      sql`regexp_replace(${storeOrdersTable.customerPhone}, '\D', '', 'g') = ${phoneDigits}`,
    ))
    .orderBy(desc(storeOrdersTable.createdAt))
    .limit(50);
  res.json(orders.map(o => ({ ...o, sellingPrice: parseFloat(o.sellingPrice as any) })));
});

// Verify Paystack payment for a store order.
// Uses SELECT FOR UPDATE to prevent a race where two concurrent callbacks
// both pass the status check and try to mark the same order as processing.
router.post("/s/:slug/verify", async (req, res) => {
  const { ref } = req.body as { ref?: string };
  if (!ref) { res.status(400).json({ error: "Reference required" }); return; }

  // Quick existence check — may be null if this is the first call after payment
  const [preCheck] = await db.select({ id: storeOrdersTable.id, status: storeOrdersTable.status })
    .from(storeOrdersTable).where(eq(storeOrdersTable.paystackReference, ref));

  // Already fully processed — return immediately
  if (preCheck?.status === "completed") {
    const [order] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.id, preCheck.id));
    res.json(formatStoreOrder(order));
    return;
  }

  // Verify payment with Paystack (network call — outside DB transaction to avoid long-held locks)
  type StoreOrderMeta = {
    storeId: number; storeBundleId: number; bundleId: number;
    bundleName: string; bundleData: string; bundleNetwork: string; bundleValidityDays: number;
    customerPhone: string; customerEmail: string | null;
    sellingPrice: string; basePrice: string; agentCost: string; profit: string;
  };
  let psData: { status: boolean; data?: { status: string; amount: number; metadata?: StoreOrderMeta } };
  try {
    const psRes = await fetch(`https://api.paystack.co/transaction/verify/${ref}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    });
    psData = await psRes.json() as typeof psData;
  } catch {
    res.status(502).json({ error: "Could not reach payment gateway. Please try again in a moment." });
    return;
  }

  if (!psData.status || psData.data?.status !== "success") {
    // Payment failed/cancelled — if a record somehow exists, cancel it
    if (preCheck) {
      await db.update(storeOrdersTable)
        .set({ status: "cancelled" })
        .where(and(eq(storeOrdersTable.id, preCheck.id), eq(storeOrdersTable.status, "pending")));
    }
    res.status(402).json({ error: "Payment not successful" });
    return;
  }

  // Payment confirmed — create or transition the order record atomically.
  // onConflictDoNothing handles the webhook + verify race (both may fire simultaneously).
  const updated = await db.transaction(async (tx) => {
    if (!preCheck) {
      // First time we learn of this payment — create the record now from metadata
      const meta = psData.data!.metadata;
      if (!meta?.storeId) return null;
      const [created] = await tx.insert(storeOrdersTable).values({
        storeId:            meta.storeId,
        storeBundleId:      meta.storeBundleId,
        bundleId:           meta.bundleId,
        bundleName:         meta.bundleName,
        bundleData:         meta.bundleData,
        bundleNetwork:      meta.bundleNetwork,
        bundleValidityDays: meta.bundleValidityDays,
        customerPhone:      meta.customerPhone,
        customerEmail:      meta.customerEmail ?? undefined,
        sellingPrice:       meta.sellingPrice,
        basePrice:          meta.basePrice,
        agentCost:          meta.agentCost,
        profit:             meta.profit,
        paystackReference:  ref,
        status:             "paid",
      }).onConflictDoNothing().returning();
      if (!created) {
        // Webhook beat us — fetch the record it created
        const [existing] = await tx.select().from(storeOrdersTable).where(eq(storeOrdersTable.paystackReference, ref));
        return existing ?? null;
      }
      return created;
    }

    // Record already exists — lock and transition from pending → paid
    const [locked] = await tx.select().from(storeOrdersTable)
      .where(eq(storeOrdersTable.id, preCheck.id)).for("update");
    if (!locked) return null;
    if (locked.status !== "pending") return locked;
    const [u] = await tx.update(storeOrdersTable)
      .set({ status: "paid" })
      .where(eq(storeOrdersTable.id, locked.id))
      .returning();
    return u;
  });

  if (!updated) { res.status(500).json({ error: "Order could not be created" }); return; }
  res.json(formatStoreOrder(updated));

  // Dispatch only for freshly-paid orders (status just became "paid")
  if (updated.status === "paid" && !updated.mcbisReference && !updated.ckgodswayReference) {
    dispatchOrder({
      orderId:      updated.id,
      network:      updated.bundleNetwork,
      phone:        updated.customerPhone,
      bundleData:   updated.bundleData,
      isStoreOrder: true,
    }).then(async (outcome) => {
      if (outcome.dispatched) {
        const refCol = outcome.provider === "mcbis"
          ? { mcbisReference: outcome.reference }
          : { ckgodswayReference: outcome.reference };
        await db.update(storeOrdersTable)
          .set({ status: "processing", ...refCol })
          .where(eq(storeOrdersTable.id, updated.id));
      }
    }).catch(() => {/* non-fatal */});
  }
});

// ─── PAYSTACK WEBHOOK (store orders) ─────────────────────────────────────────

type StoreOrderMeta = {
  storeId: number; storeBundleId: number; bundleId: number;
  bundleName: string; bundleData: string; bundleNetwork: string; bundleValidityDays: number;
  customerPhone: string; customerEmail: string | null;
  sellingPrice: string; basePrice: string; agentCost: string; profit: string;
};

// Exported for the unified /api/paystack/webhook handler in index.ts
export async function handleStorePaystackWebhook(body: {
  event: string;
  data: { reference: string; status: string; amount: number; metadata?: StoreOrderMeta };
}) {
  const { event, data } = body;
  if (event !== "charge.success" || !data.reference.startsWith("STORE-")) return;

  const [existing] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.paystackReference, data.reference));

  // Already beyond pending — verify route handled it or it completed normally
  if (existing && existing.status !== "pending") return;

  let order = existing ?? null;

  if (!order) {
    // Order was never created (customer paid without returning to site first)
    const meta = data.metadata;
    if (!meta?.storeId) return;
    const [created] = await db.insert(storeOrdersTable).values({
      storeId:            meta.storeId,
      storeBundleId:      meta.storeBundleId,
      bundleId:           meta.bundleId,
      bundleName:         meta.bundleName,
      bundleData:         meta.bundleData,
      bundleNetwork:      meta.bundleNetwork,
      bundleValidityDays: meta.bundleValidityDays,
      customerPhone:      meta.customerPhone,
      customerEmail:      meta.customerEmail ?? undefined,
      sellingPrice:       meta.sellingPrice,
      basePrice:          meta.basePrice,
      agentCost:          meta.agentCost,
      profit:             meta.profit,
      paystackReference:  data.reference,
      status:             "paid",
    }).onConflictDoNothing().returning();
    if (!created) return; // verify route beat us to it
    order = created;
  } else {
    // Existing pending order — transition to paid
    const [updated] = await db.update(storeOrdersTable)
      .set({ status: "paid" })
      .where(and(eq(storeOrdersTable.id, order.id), eq(storeOrdersTable.status, "pending")))
      .returning();
    if (!updated) return;
    order = updated;
  }

  dispatchOrder({
    orderId:      order.id,
    network:      order.bundleNetwork,
    phone:        order.customerPhone,
    bundleData:   order.bundleData,
    isStoreOrder: true,
  }).then(async (outcome) => {
    if (outcome.dispatched) {
      const refCol = outcome.provider === "mcbis"
        ? { mcbisReference: outcome.reference }
        : { ckgodswayReference: outcome.reference };
      await db.update(storeOrdersTable)
        .set({ status: "processing", ...refCol })
        .where(eq(storeOrdersTable.id, order!.id));
    }
  }).catch(() => {/* non-fatal */});
}

router.post("/s/paystack/webhook", async (req, res) => {
  const sig = req.headers["x-paystack-signature"] as string;
  const hash = crypto.createHmac("sha512", PAYSTACK_SECRET).update(req.rawBody ?? Buffer.from(JSON.stringify(req.body))).digest("hex");
  if (hash !== sig) { res.status(401).json({ error: "Invalid signature" }); return; }
  res.sendStatus(200);
  handleStorePaystackWebhook(req.body).catch((err: unknown) => {
    req.log.error({ err }, "Store Paystack webhook processing error");
  });
});

// Admin: list all stores
router.get("/admin/stores", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const stores = await db.select().from(storesTable).orderBy(desc(storesTable.id));

  // Enrich each store with aggregate stats
  const enriched = await Promise.all(stores.map(async store => {
    const orders = await db.select({
      profit: storeOrdersTable.profit,
      status: storeOrdersTable.status,
    }).from(storeOrdersTable).where(eq(storeOrdersTable.storeId, store.id));

    const totalOrders = orders.length;
    const completedOrders = orders.filter(o => o.status === "completed").length;
    const processingOrders = orders.filter(o => o.status === "processing").length;
    const totalEarned = orders.filter(o => o.status === "completed").reduce((s, o) => s + parseFloat(o.profit as any), 0);

    const withdrawals = await db.select({ amount: storeWithdrawalsTable.amount, status: storeWithdrawalsTable.status })
      .from(storeWithdrawalsTable).where(eq(storeWithdrawalsTable.storeId, store.id));

    const totalWithdrawn = withdrawals.filter(w => w.status === "completed").reduce((s, w) => s + parseFloat(w.amount as any), 0);

    return {
      ...formatStore(store),
      totalOrders,
      completedOrders,
      processingOrders,
      totalEarned: parseFloat(totalEarned.toFixed(2)),
      totalWithdrawn: parseFloat(totalWithdrawn.toFixed(2)),
    };
  }));
  res.json(enriched);
});

// Global cross-store withdrawals view + payout summary for the admin dashboard.
router.get("/admin/withdrawals", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const rows = await db
    .select({
      id: storeWithdrawalsTable.id,
      storeId: storeWithdrawalsTable.storeId,
      amount: storeWithdrawalsTable.amount,
      status: storeWithdrawalsTable.status,
      method: storeWithdrawalsTable.method,
      accountNumber: storeWithdrawalsTable.accountNumber,
      accountName: storeWithdrawalsTable.accountName,
      bankCode: storeWithdrawalsTable.bankCode,
      note: storeWithdrawalsTable.note,
      reference: storeWithdrawalsTable.reference,
      transferCode: storeWithdrawalsTable.transferCode,
      failureReason: storeWithdrawalsTable.failureReason,
      createdAt: storeWithdrawalsTable.createdAt,
      updatedAt: storeWithdrawalsTable.updatedAt,
      storeName: storesTable.name,
      storeSlug: storesTable.slug,
    })
    .from(storeWithdrawalsTable)
    .leftJoin(storesTable, eq(storeWithdrawalsTable.storeId, storesTable.id))
    .orderBy(desc(storeWithdrawalsTable.createdAt));

  const withdrawals = rows.map(w => ({ ...w, amount: parseFloat(w.amount as any) }));

  // Money currently sitting in agent profit balances — i.e. ready to be withdrawn
  // but not yet requested. Surface the per-store breakdown so admins see the full
  // outstanding obligation, not just what agents have already asked for.
  const stores = await db
    .select({
      storeId: storesTable.id,
      storeName: storesTable.name,
      storeSlug: storesTable.slug,
      profitBalance: storesTable.profitBalance,
    })
    .from(storesTable)
    .orderBy(desc(storesTable.profitBalance));
  const readyForWithdrawal = stores.reduce((s, st) => s + parseFloat(st.profitBalance as any), 0);
  const pendingProfits = stores
    .map(st => ({ ...st, profitBalance: parseFloat(st.profitBalance as any) }))
    .filter(st => st.profitBalance > 0);

  const sumBy = (status: string) =>
    withdrawals.filter(w => w.status === status).reduce((s, w) => s + w.amount, 0);
  const countBy = (status: string) => withdrawals.filter(w => w.status === status).length;

  // "Paid today" — completed withdrawals finalised since local midnight (server is
  // UTC/GMT, same as Ghana, so a plain date comparison is correct here).
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const paidTodayRows = withdrawals.filter(
    w => w.status === "completed" && w.updatedAt && new Date(w.updatedAt as any) >= startOfToday,
  );
  const paidToday = paidTodayRows.reduce((s, w) => s + w.amount, 0);

  // Distinct agents with money in flight (a pending or processing request).
  const agentsPending = new Set(
    withdrawals.filter(w => w.status === "pending" || w.status === "processing").map(w => w.storeId),
  ).size;

  res.json({
    summary: {
      readyForWithdrawal: parseFloat(readyForWithdrawal.toFixed(2)),
      pendingCount: countBy("pending"),
      pendingAmount: parseFloat(sumBy("pending").toFixed(2)),
      processingCount: countBy("processing"),
      processingAmount: parseFloat(sumBy("processing").toFixed(2)),
      completedCount: countBy("completed"),
      completedAmount: parseFloat(sumBy("completed").toFixed(2)),
      paidToday: parseFloat(paidToday.toFixed(2)),
      paidTodayCount: paidTodayRows.length,
      agentsPending,
      agentsOwed: pendingProfits.length,
    },
    pendingProfits,
    withdrawals,
  });
});

router.get("/admin/stores/:storeId/withdrawals", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const storeId = parseInt(String(req.params.storeId));
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid store id" }); return; }

  const withdrawals = await db.select().from(storeWithdrawalsTable)
    .where(eq(storeWithdrawalsTable.storeId, storeId))
    .orderBy(desc(storeWithdrawalsTable.createdAt));

  res.json(withdrawals.map(w => ({ ...w, amount: parseFloat(w.amount as any) })));
});

router.get("/admin/stores/:storeId/orders", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const storeId = parseInt(String(req.params.storeId));
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid store id" }); return; }

  const rows = await db.select({
    id: storeOrdersTable.id,
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
  }).from(storeOrdersTable)
    .where(and(
      eq(storeOrdersTable.storeId, storeId),
      // Hide orders where payment was never initiated (pending + no paystack ref)
      ne(storeOrdersTable.paystackReference, ""),
    ))
    .orderBy(desc(storeOrdersTable.id));

  res.json(rows.map(o => ({
    ...o,
    sellingPrice: parseFloat(o.sellingPrice as any),
    basePrice: parseFloat(o.basePrice as any),
    profit: parseFloat(o.profit as any),
  })));
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
      agentCost: storeOrdersTable.agentCost,
      profit: storeOrdersTable.profit,
      status: storeOrdersTable.status,
      paystackReference: storeOrdersTable.paystackReference,
      createdAt: storeOrdersTable.createdAt,
      updatedAt: storeOrdersTable.updatedAt,
      ownerRole:   usersTable.role,
      ownerName:   usersTable.name,
      agentPrice:  bundlesTable.agentPrice,
      dealerPrice: bundlesTable.dealerPrice,
    })
    .from(storeOrdersTable)
    .innerJoin(storesTable,  eq(storeOrdersTable.storeId,  storesTable.id))
    .leftJoin(usersTable,    eq(storesTable.userId,         usersTable.id))
    .leftJoin(bundlesTable,  eq(storeOrdersTable.bundleId,  bundlesTable.id))
    .orderBy(desc(storeOrdersTable.id));
  res.json(rows.map(o => {
    const sellingPrice = parseFloat(o.sellingPrice as any);
    const basePrice    = parseFloat(o.basePrice as any);
    const profit       = parseFloat(o.profit as any);
    // Resolve effective agentCost: stored value first, then current bundle role-price fallback
    let agentCost: number | null = o.agentCost != null ? parseFloat(o.agentCost as any) : null;
    if (agentCost == null) {
      if (o.ownerRole === "dealer" && o.dealerPrice != null) agentCost = parseFloat(o.dealerPrice as any);
      else if (o.ownerRole === "agent" && o.agentPrice != null) agentCost = parseFloat(o.agentPrice as any);
    }
    const systemProfit = agentCost != null ? +(agentCost - basePrice).toFixed(2) : null;
    return { ...o, sellingPrice, basePrice, agentCost, profit, systemProfit, ownerName: o.ownerName ?? null };
  }));
});

router.patch("/admin/store-orders/:id/complete", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const updated = await db.transaction(async (tx) => {
      // Lock the order row to prevent concurrent completions double-crediting profit
      const [locked] = await tx
        .select()
        .from(storeOrdersTable)
        .where(eq(storeOrdersTable.id, id))
        .for("update");

      if (!locked) throw Object.assign(new Error("Order not found"), { status: 404 });
      if (locked.status === "completed") return locked;

      const [completed] = await tx
        .update(storeOrdersTable)
        .set({ status: "completed" })
        .where(eq(storeOrdersTable.id, id))
        .returning();

      // Atomically credit profit to store owner
      const profit = parseFloat(locked.profit);
      await tx
        .update(storesTable)
        .set({ profitBalance: sql`profit_balance + ${profit.toFixed(2)}::numeric` })
        .where(eq(storesTable.id, locked.storeId));

      return completed;
    });

    res.json(formatStoreOrder(updated));
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Completion failed" });
  }
});

router.patch("/admin/store-orders/:id/cancel", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [order] = await db.select().from(storeOrdersTable).where(eq(storeOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  // Get store to find the agent (store owner)
  const [store] = await db.select({ userId: storesTable.userId }).from(storesTable).where(eq(storesTable.id, order.storeId));

  const updated = await db.transaction(async (tx) => {
    await tx.update(storeOrdersTable).set({ status: "cancelled" }).where(eq(storeOrdersTable.id, id));

    const profit = parseFloat(order.profit as string);
    const ref = `cancel-store-order-${id}`;
    const agentNote = `Store order #${id} (${order.bundleData}) cancelled — GH₵${profit.toFixed(2)} profit voided`;
    const adminNote = `Cancelled store order #${id} for store #${order.storeId} — GH₵${profit.toFixed(2)} profit voided`;

    // Log for the agent (store owner)
    if (store?.userId) {
      await insertLedgerEntry(tx, store.userId, profit, "debit", "order_cancelled", ref, agentNote);
    }

    // Log for the admin performing the cancellation
    const adminId = req.session.userId!;
    await insertLedgerEntry(tx, adminId, profit, "debit", "order_cancelled", `${ref}-admin`, adminNote);

    const [u] = await tx.select().from(storeOrdersTable).where(eq(storeOrdersTable.id, id));
    return u;
  });

  res.json(formatStoreOrder(updated));
});

router.post("/admin/store-orders/bulk-status", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const { ids, status } = req.body as { ids?: unknown; status?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || typeof status !== "string") {
    res.status(400).json({ error: "ids (array) and status (string) are required" }); return;
  }
  const numIds = ids.map(Number).filter(n => !isNaN(n));
  if (numIds.length === 0) { res.status(400).json({ error: "No valid IDs" }); return; }
  const VALID = ["pending", "processing", "completed", "failed", "cancelled"];
  if (!VALID.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }

  if (status === "completed") {
    // Must credit profit per-order atomically — cannot use a single bulk UPDATE
    let updatedCount = 0;
    for (const id of numIds) {
      try {
        await db.transaction(async (tx) => {
          const [locked] = await tx
            .select()
            .from(storeOrdersTable)
            .where(eq(storeOrdersTable.id, id))
            .for("update");
          if (!locked || locked.status === "completed") return;
          await tx.update(storeOrdersTable).set({ status: "completed" }).where(eq(storeOrdersTable.id, id));
          const profit = parseFloat(locked.profit);
          await tx.update(storesTable)
            .set({ profitBalance: sql`profit_balance + ${profit.toFixed(2)}::numeric` })
            .where(eq(storesTable.id, locked.storeId));
          updatedCount++;
        });
      } catch { /* skip failed rows */ }
    }
    res.json({ updated: updatedCount });
    return;
  }

  await db.update(storeOrdersTable).set({ status }).where(inArray(storeOrdersTable.id, numIds));
  res.json({ updated: numIds.length });
});

// ─── ADMIN: WITHDRAWAL APPROVE / REJECT ──────────────────────────────────────

router.patch("/admin/stores/withdrawals/:id/approve", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updated = await approveWithdrawalById(id);
  if ("error" in updated) { res.status(updated.status).json({ error: updated.error }); return; }
  res.json({ ...updated.row, amount: parseFloat(updated.row.amount as any) });
});

/**
 * Shared admin-approve logic used by the single-approve and bulk-approve routes.
 * Re-runs the Paystack transfer flow for a pending withdrawal. The amount was
 * already deducted at request time, so success/processing need no balance change
 * and a later failure is refunded by the webhook/reconciler.
 */
async function approveWithdrawalById(
  id: number,
): Promise<{ row: typeof storeWithdrawalsTable.$inferSelect } | { error: string; status: number }> {
  // Atomically reserve the row (pending -> processing). Only one approver wins,
  // so concurrent approve clicks / bulk + single can't both initiate a transfer.
  const [reserved] = await db.update(storeWithdrawalsTable)
    .set({ status: "processing" })
    .where(and(eq(storeWithdrawalsTable.id, id), eq(storeWithdrawalsTable.status, "pending")))
    .returning();

  if (!reserved) {
    const [cur] = await db.select().from(storeWithdrawalsTable).where(eq(storeWithdrawalsTable.id, id));
    if (!cur) return { error: "Withdrawal not found", status: 404 };
    return { error: `Cannot approve a withdrawal with status: ${cur.status}`, status: 400 };
  }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, reserved.storeId));
  if (!store) {
    // Release the reservation so it can be retried; only if still untouched
    await db.update(storeWithdrawalsTable)
      .set({ status: "pending" })
      .where(and(eq(storeWithdrawalsTable.id, id), eq(storeWithdrawalsTable.status, "processing")));
    return { error: "Store not found", status: 404 };
  }

  // Ensure a reference exists so transfer webhooks can correlate (legacy rows)
  let row = reserved;
  if (!row.reference) {
    [row] = await db.update(storeWithdrawalsTable)
      .set({ reference: genWithdrawalReference() })
      .where(eq(storeWithdrawalsTable.id, id))
      .returning();
  }

  const result = await processWithdrawalTransfer(row, store);
  // Guard every write on status='processing' so a transfer webhook that already
  // settled this row (completed / failed+refund) is never clobbered.
  if (result.status === "completed") {
    await db.update(storeWithdrawalsTable)
      .set({ status: "completed", transferCode: result.transferCode || row.transferCode })
      .where(and(eq(storeWithdrawalsTable.id, id), eq(storeWithdrawalsTable.status, "processing")));
  } else if (result.status === "processing") {
    // Transfer is in flight — leave as processing; webhook/reconciler settles it
    await db.update(storeWithdrawalsTable)
      .set({ transferCode: result.transferCode || row.transferCode })
      .where(and(eq(storeWithdrawalsTable.id, id), eq(storeWithdrawalsTable.status, "processing")));
  } else {
    // Could NOT auto-send (no Paystack balance / OTP required / API error).
    // Funds were NOT moved, so return the row to the pending queue rather than
    // falsely marking it completed (which would burn the agent's deducted funds).
    await db.update(storeWithdrawalsTable)
      .set({ status: "pending", transferCode: result.transferCode || row.transferCode })
      .where(and(eq(storeWithdrawalsTable.id, id), eq(storeWithdrawalsTable.status, "processing")));
  }

  const [out] = await db.select().from(storeWithdrawalsTable).where(eq(storeWithdrawalsTable.id, id));
  return { row: out };
}

router.post("/admin/stores/withdrawals/bulk-approve", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const pending = await db.select({ id: storeWithdrawalsTable.id })
    .from(storeWithdrawalsTable)
    .where(eq(storeWithdrawalsTable.status, "pending"));

  let approved = 0;
  let failed = 0;
  for (const { id } of pending) {
    const result = await approveWithdrawalById(id);
    if ("error" in result) failed++; else approved++;
  }
  res.json({ approved, failed, total: pending.length });
});

router.patch("/admin/stores/withdrawals/:id/complete", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  let updated: typeof storeWithdrawalsTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      // Lock the row so completion can't race a concurrent failure-refund path
      // (webhook / reconciler / force-cancel). Terminal states are monotonic:
      // a row that was already failed+refunded or cancelled+refunded must never
      // be flipped to completed, or the agent would be both refunded and "paid".
      const [locked] = await tx.select().from(storeWithdrawalsTable)
        .where(eq(storeWithdrawalsTable.id, id)).for("update");
      if (!locked) throw Object.assign(new Error("Withdrawal not found"), { status: 404 });
      if (locked.status === "completed") {
        throw Object.assign(new Error("Withdrawal already completed"), { status: 400 });
      }
      if (locked.status !== "pending" && locked.status !== "processing") {
        // failed (already refunded) or cancelled (already refunded) — refusing
        // keeps the refund and the "paid" state mutually exclusive.
        throw Object.assign(new Error(`Cannot complete a withdrawal that is ${locked.status}`), { status: 400 });
      }

      // A manually-paid withdrawal still needs a reference so it can be traced and
      // so the UI never shows a blank Ref. Keep any existing reference (e.g. from an
      // earlier auto-transfer attempt); only mint one when the row has none.
      const [done] = await tx.update(storeWithdrawalsTable)
        .set({ status: "completed", reference: locked.reference || genWithdrawalReference() })
        .where(eq(storeWithdrawalsTable.id, id))
        .returning();
      return done;
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Completion failed" });
    return;
  }
  res.json({ ...updated, amount: parseFloat(updated.amount as any) });
});

router.patch("/admin/stores/withdrawals/:id/reject", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  let updated: typeof storeWithdrawalsTable.$inferSelect;

  try {
    updated = await db.transaction(async (tx) => {
      // Lock the withdrawal row to prevent concurrent approve/reject races
      const [locked] = await tx
        .select()
        .from(storeWithdrawalsTable)
        .where(eq(storeWithdrawalsTable.id, id))
        .for("update");

      if (!locked) throw Object.assign(new Error("Withdrawal not found"), { status: 404 });
      // Only pending withdrawals can be rejected+refunded. A "processing" row has
      // a transfer in flight (rejecting risks a double payout) and "failed" rows
      // were already refunded by the webhook/reconciler (rejecting double-refunds).
      if (locked.status !== "pending") {
        throw Object.assign(
          new Error("Cannot reject a withdrawal that is " + locked.status),
          { status: 400 }
        );
      }

      // Record the admin's reason (if any) so the agent and audit trail can see
      // why the request was turned down.
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";

      // Mark as cancelled
      const [cancelled] = await tx
        .update(storeWithdrawalsTable)
        .set({ status: "cancelled", failureReason: reason || "Rejected by admin" })
        .where(eq(storeWithdrawalsTable.id, id))
        .returning();

      // Atomically refund the deducted amount + fee back to the store's profit balance
      const WITHDRAWAL_FEE = 1;
      const refundAmount = parseFloat(locked.amount as any) + WITHDRAWAL_FEE;
      await tx
        .update(storesTable)
        .set({ profitBalance: sql`profit_balance + ${refundAmount.toFixed(2)}::numeric` })
        .where(eq(storesTable.id, locked.storeId));

      return cancelled;
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Rejection failed" });
    return;
  }

  res.json({ ...updated, amount: parseFloat(updated.amount as any) });
});

/**
 * Force-cancel a withdrawal that is stuck in "processing" — i.e. a transfer that
 * genuinely failed but never got a Paystack webhook/reconciler resolution. Refunds
 * amount + fee back to the agent so they can request again. Reuses the shared
 * row-locked, status-guarded helper, so it is idempotent with the webhook and the
 * reconciler (whichever settles the row first wins; the others become no-ops).
 *
 * Only use when Paystack confirms the money did NOT go out — otherwise this would
 * refund an agent who was actually paid (double payout).
 */
router.patch("/admin/stores/withdrawals/:id/force-cancel", requireAuth, async (req, res) => {
  if (req.session.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [w] = await db.select().from(storeWithdrawalsTable).where(eq(storeWithdrawalsTable.id, id));
  if (!w) { res.status(404).json({ error: "Withdrawal not found" }); return; }
  if (w.status !== "processing") {
    res.status(400).json({ error: `Only a processing withdrawal can be force-cancelled (this one is ${w.status})` });
    return;
  }

  const reason = typeof req.body?.reason === "string" && req.body.reason.trim()
    ? req.body.reason.trim()
    : "Force-cancelled by admin (transfer failed)";
  await markWithdrawalFailedAndRefund(id, reason);

  const [updated] = await db.select().from(storeWithdrawalsTable).where(eq(storeWithdrawalsTable.id, id));
  res.json({ ...updated, amount: parseFloat(updated.amount as any) });
});

export { router as storesRouter };
