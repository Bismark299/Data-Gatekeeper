/**
 * DataBundle Partner API — Public routes
 *
 * Mounted at /api/v1  (registered in routes/index.ts)
 *
 * Endpoints:
 *   GET  /api/v1/docs         — Swagger UI (interactive docs)
 *   GET  /api/v1/openapi.json — Raw OpenAPI 3.0 spec
 *   GET  /api/v1/account      — User info + wallet balance   [requires key]
 *   GET  /api/v1/bundles      — List active bundles          [public]
 *   POST /api/v1/orders       — Place an order               [requires key]
 *   GET  /api/v1/orders/:id   — Get order status             [requires key]
 */

import { Router, type IRouter } from "express";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";
import {
  db, usersTable, walletsTable, walletLedgerTable, ordersTable, bundlesTable,
} from "@workspace/db";
import { requireApiKey } from "../lib/apiKeyAuth";
import { logger } from "../lib/logger";
import { dispatchOrder } from "../lib/dispatch";
import { getOrCreateWallet, insertLedgerEntry } from "./wallet";
import { z } from "zod";

const router: IRouter = Router();

// ─── OpenAPI 3.0 Spec ────────────────────────────────────────────────────────

const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "DataBundle Partner API",
    version: "1.0.0",
    description: `
## Overview
The DataBundle Partner API lets you integrate data bundle purchases directly into your own applications.

## Authentication
All protected endpoints require an **API key** sent in the \`X-API-Key\` header:
\`\`\`
X-API-Key: dk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
\`\`\`
API keys are issued and managed by the DataBundle admin team. Contact support to get your key.

## Wallet Balance
Orders are charged against your **wallet balance**. Top up your wallet via the DataBundle platform.
A \`402 Payment Required\` response means your balance is insufficient.

## Order Fulfillment
Orders are typically fulfilled within **2–15 minutes** after placement.
Poll \`GET /orders/{id}\` to track progress.

## Rate Limits
60 requests per minute per API key. Exceeding this returns \`429 Too Many Requests\`.

## Support
Contact your account manager or email **support@databundle.com**.
    `.trim(),
    contact: { email: "support@databundle.com" },
  },
  servers: [
    { url: "/api/v1", description: "Production" },
  ],
  security: [{ ApiKeyAuth: [] }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "API key issued by the DataBundle admin team.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string", example: "Insufficient wallet balance" },
        },
      },
      Account: {
        type: "object",
        properties: {
          id:            { type: "integer",  example: 42 },
          name:          { type: "string",   example: "Kwame Mensah" },
          email:         { type: "string",   example: "kwame@example.com" },
          role:          { type: "string",   example: "dealer" },
          walletBalance: { type: "string",   example: "150.00", description: "Available wallet balance in GH₵" },
          lastUsedAt:    { type: "string",   format: "date-time", nullable: true },
        },
      },
      Bundle: {
        type: "object",
        properties: {
          id:          { type: "integer", example: 3 },
          name:        { type: "string",  example: "MTN 5GB" },
          description: { type: "string",  example: "5GB data bundle" },
          dataAmount:  { type: "string",  example: "5GB" },
          price:       { type: "string",  example: "15.00", description: "Price in GH₵ (based on your account role)" },
          network:     { type: "string",  example: "mtn", enum: ["mtn", "telecel", "at-ishare", "at-bigtime"], description: "MTN · Telecel · AT iShare · AT Big-Time" },
        },
      },
      OrderRequest: {
        type: "object",
        required: ["bundleId", "phoneNumber"],
        properties: {
          bundleId:    { type: "integer", example: 3, description: "Bundle ID from GET /bundles" },
          phoneNumber: { type: "string",  example: "0241234567", description: "Recipient's Ghana phone number (10 digits)" },
        },
      },
      Order: {
        type: "object",
        properties: {
          id:          { type: "integer", example: 101 },
          bundleName:  { type: "string",  example: "MTN 5GB Monthly" },
          bundleData:  { type: "string",  example: "5GB" },
          network:     { type: "string",  example: "mtn" },
          phoneNumber: { type: "string",  example: "0241234567" },
          price:       { type: "string",  example: "15.00" },
          status:      { type: "string",  example: "pending", enum: ["pending", "processing", "completed", "failed"] },
          createdAt:   { type: "string",  format: "date-time" },
        },
      },
    },
  },
  paths: {
    "/account": {
      get: {
        summary: "Get account info",
        description: "Returns your user profile and current wallet balance.",
        operationId: "getAccount",
        security: [{ ApiKeyAuth: [] }],
        responses: {
          200: {
            description: "Account details",
            content: { "application/json": { schema: { "$ref": "#/components/schemas/Account" } } },
          },
          401: {
            description: "Missing or invalid API key",
            content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/bundles": {
      get: {
        summary: "List available bundles",
        description: "Returns all active bundles, optionally filtered by network. No authentication required. Prices reflect your account role.",
        operationId: "listBundles",
        security: [],
        parameters: [
          {
            name: "network",
            in: "query",
            required: false,
            description: "Filter by network: MTN, Telecel, AT iShare, AT Big-Time",
            schema: { type: "string", enum: ["mtn", "telecel", "at-ishare", "at-bigtime"] },
          },
        ],
        responses: {
          200: {
            description: "List of active bundles",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    bundles: { type: "array", items: { "$ref": "#/components/schemas/Bundle" } },
                    total:   { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/orders": {
      post: {
        summary: "Place an order",
        description: `
Place a data bundle order for a phone number.

- The bundle price is deducted from your **wallet balance** immediately.
- Returns \`402\` if your balance is insufficient.
- The order is fulfilled asynchronously. Poll \`GET /orders/{id}\` for status.
        `.trim(),
        operationId: "createOrder",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { "$ref": "#/components/schemas/OrderRequest" } } },
        },
        responses: {
          201: {
            description: "Order placed successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    orderId:       { type: "integer", example: 101 },
                    status:        { type: "string",  example: "pending" },
                    price:         { type: "string",  example: "15.00" },
                    walletBalance: { type: "string",  example: "135.00", description: "Remaining wallet balance" },
                    message:       { type: "string",  example: "Order placed. Poll GET /api/v1/orders/101 for status." },
                  },
                },
              },
            },
          },
          400: {
            description: "Invalid request body",
            content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } },
          },
          402: {
            description: "Insufficient wallet balance",
            content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } },
          },
          401: {
            description: "Missing or invalid API key",
            content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } },
          },
          404: {
            description: "Bundle not found or inactive",
            content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/orders/{id}": {
      get: {
        summary: "Get order status",
        description: "Returns the current status of an order placed by your account.",
        operationId: "getOrder",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Order ID returned by POST /orders",
            schema: { type: "integer", example: 101 },
          },
        ],
        responses: {
          200: {
            description: "Order details",
            content: { "application/json": { schema: { "$ref": "#/components/schemas/Order" } } },
          },
          401: {
            description: "Missing or invalid API key",
            content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } },
          },
          404: {
            description: "Order not found",
            content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } },
          },
        },
      },
    },
  },
};

// ─── Swagger UI HTML ──────────────────────────────────────────────────────────

const SWAGGER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DataBundle Partner API — Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { background: #1a1a2e; }
    .swagger-ui .topbar .download-url-wrapper .select-label select { border: 2px solid #e3e3e3; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: "./openapi.json",
        dom_id: "#swagger-ui",
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: "BaseLayout",
        deepLinking: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        tryItOutEnabled: true,
      });
    };
  </script>
</body>
</html>`;

// ─── Routes ───────────────────────────────────────────────────────────────────

// Swagger UI — relaxed CSP so CDN scripts/styles can load
router.get("/docs", (_req, res) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; " +
    "style-src 'self' 'unsafe-inline' https://unpkg.com; " +
    "img-src 'self' data: https:; font-src 'self' data: https://unpkg.com;",
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(SWAGGER_HTML);
});

// Raw OpenAPI spec
router.get("/openapi.json", (_req, res) => {
  res.json(OPENAPI_SPEC);
});

// Account info — returns user profile + wallet balance
router.get("/account", requireApiKey, async (req, res) => {
  const user = req.apiUser!;
  try {
    const wallet = await getOrCreateWallet(user.id);
    res.json({
      id:            user.id,
      name:          user.name,
      email:         user.email,
      role:          user.role,
      walletBalance: wallet.balance,
      lastUsedAt:    user.apiKeyLastUsedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "publicApi: get account");
    res.status(500).json({ error: "Internal server error" });
  }
});

// List active bundles — public, no auth required
// Price shown is the caller's role rate (requires key) or dealer rate (no key)
router.get("/bundles", async (req, res) => {
  try {
    const { network, category } = req.query as { network?: string; category?: string };

    const conditions = [eq(bundlesTable.isActive, true)];
    if (network) conditions.push(eq(bundlesTable.network, network));
    if (category) conditions.push(eq(bundlesTable.category, category));

    const bundles = await db
      .select({
        id:           bundlesTable.id,
        name:         bundlesTable.name,
        description:  bundlesTable.description,
        dataAmount:   bundlesTable.dataAmount,
        price:        bundlesTable.price,
        dealerPrice:  bundlesTable.dealerPrice,
        agentPrice:   bundlesTable.agentPrice,
        network:      bundlesTable.network,
        category:     bundlesTable.category,
      })
      .from(bundlesTable)
      .where(and(
        eq(bundlesTable.isActive, true),
        ...(network  ? [eq(bundlesTable.network,  network)]  : []),
        ...(category ? [eq(bundlesTable.category, category)] : []),
      ))
      .orderBy(bundlesTable.network, bundlesTable.category, bundlesTable.price);

    const role = req.apiUser?.role ?? "dealer";

    res.json({
      bundles: bundles.map(b => {
        const effectivePrice =
          role === "dealer" ? b.dealerPrice :
          role === "agent"  ? b.agentPrice  :
          b.price;
        return {
          id:          b.id,
          name:        b.name,
          description: b.description,
          dataAmount:  b.dataAmount,
          price:       effectivePrice ?? b.price,
          network:     b.network,
        };
      }),
      total: bundles.length,
    });
  } catch (err) {
    req.log.error({ err }, "publicApi: list bundles");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Place an order — deducts from user's wallet, writes to ordersTable
const placeOrderSchema = z.object({
  bundleId:    z.number().int().positive(),
  phoneNumber: z.string().min(10).max(15).regex(/^\d+$/, "Phone number must be digits only"),
});

router.post("/orders", requireApiKey, async (req, res) => {
  const parsed = placeOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join("; ") });
    return;
  }

  const { bundleId, phoneNumber } = parsed.data;
  const user = req.apiUser!;

  try {
    const [bundle] = await db.select().from(bundlesTable).where(
      and(eq(bundlesTable.id, bundleId), eq(bundlesTable.isActive, true)),
    );
    if (!bundle) {
      res.status(404).json({ error: "Bundle not found or no longer available" });
      return;
    }

    const rawPrice =
      user.role === "dealer" ? bundle.dealerPrice :
      user.role === "agent"  ? bundle.agentPrice  :
      bundle.price;

    if (rawPrice == null) {
      res.status(400).json({ error: `This bundle is not priced for ${user.role} accounts. Contact admin.` });
      return;
    }

    const price = parseFloat(rawPrice);

    await getOrCreateWallet(user.id);

    let order: typeof ordersTable.$inferSelect;
    let newWalletBalance: string;

    order = await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.userId, user.id))
        .for("update");

      if (!wallet) throw Object.assign(new Error("Wallet not found"), { status: 404 });

      const balance = parseFloat(wallet.balance);
      if (balance < price) {
        throw Object.assign(
          new Error(`Insufficient balance. Need GH₵${price.toFixed(2)}, have GH₵${balance.toFixed(2)}`),
          { status: 402 },
        );
      }

      newWalletBalance = (balance - price).toFixed(2);
      await tx
        .update(walletsTable)
        .set({ balance: newWalletBalance })
        .where(eq(walletsTable.userId, user.id));

      const [created] = await tx
        .insert(ordersTable)
        .values({
          userId:      user.id,
          bundleId:    bundle.id,
          bundleName:  bundle.name,
          bundleData:  bundle.dataAmount,
          price:       rawPrice,
          buyingCost:  bundle.price,
          status:      "pending",
          phoneNumber: phoneNumber.trim(),
        })
        .returning();

      await insertLedgerEntry(
        tx,
        user.id,
        -price,
        "debit",
        "api_order",
        `order-${created.id}`,
        `${bundle.name} → ${phoneNumber.trim()} (API)`,
      );

      return created;
    });

    // Fire-and-forget dispatch (routed by network)
    dispatchOrder({
      orderId:    order.id,
      network:    bundle.network,
      phone:      order.phoneNumber,
      bundleData: order.bundleData,
    }).then(async (outcome) => {
      if (outcome.dispatched) {
        const refCol = outcome.provider === "mcbis"
          ? { mcbisReference: outcome.reference }
          : { ckgodswayReference: outcome.reference };
        await db.update(ordersTable)
          .set({ status: "processing", ...refCol })
          .where(eq(ordersTable.id, order.id));
      }
    }).catch(() => {});

    res.status(201).json({
      orderId:       order.id,
      status:        "pending",
      price:         price.toFixed(2),
      walletBalance: newWalletBalance!,
      message:       `Order placed. Poll GET /api/v1/orders/${order.id} for status.`,
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    if (e.status === 402 || e.status === 404) {
      res.status(e.status).json({ error: e.message ?? "Order failed" });
      return;
    }
    logger.error({ err, userId: user.id }, "publicApi: place order");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get order by ID — must belong to the authenticated user
router.get("/orders/:id", requireApiKey, async (req, res) => {
  const orderId = parseInt(req.params.id as string, 10);
  if (isNaN(orderId)) {
    res.status(400).json({ error: "Invalid order ID" });
    return;
  }

  const user = req.apiUser!;

  try {
    const [row] = await db
      .select({ order: ordersTable, network: bundlesTable.network })
      .from(ordersTable)
      .leftJoin(bundlesTable, eq(bundlesTable.id, ordersTable.bundleId))
      .where(and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.userId, user.id),
      ));

    if (!row) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const o = row.order;
    res.json({
      id:          o.id,
      bundleName:  o.bundleName,
      bundleData:  o.bundleData,
      network:     row.network ?? null,
      phoneNumber: o.phoneNumber,
      price:       o.price,
      status:      o.status,
      createdAt:   o.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "publicApi: get order");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { router as publicApiRouter };
export { isNull, isNotNull, desc };
