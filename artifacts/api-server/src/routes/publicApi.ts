/**
 * DataBundle Partner API — Public routes
 *
 * Mounted at /api/v1  (registered in routes/index.ts)
 *
 * Endpoints:
 *   GET  /api/v1/docs              — Swagger UI (interactive docs)
 *   GET  /api/v1/openapi.json      — Raw OpenAPI 3.0 spec
 *   GET  /api/v1/account           — API client info + credit balance   [requires key]
 *   GET  /api/v1/bundles           — List active bundles                [public]
 *   POST /api/v1/orders            — Place an order                     [requires key]
 *   GET  /api/v1/orders/:reference — Get order status                   [requires key]
 */

import { Router, type IRouter } from "express";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, apiClientsTable, apiOrdersTable, bundlesTable } from "@workspace/db";
import { requireApiKey } from "../lib/apiKeyAuth";
import { logger } from "../lib/logger";
import { dispatchToMcbis } from "../lib/mcbis";
import { z } from "zod";
import crypto from "crypto";

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

## Credits
Orders are charged against your **credit balance**. Add credit by contacting the admin team.
A \`402 Payment Required\` response means your balance is insufficient.

## Order Fulfillment
Orders are typically fulfilled within **2–15 minutes** after placement.
Poll \`GET /orders/{reference}\` to track progress.

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
          error: { type: "string", example: "Insufficient credit balance" },
        },
      },
      Account: {
        type: "object",
        properties: {
          id:            { type: "integer",  example: 1 },
          name:          { type: "string",   example: "Acme Corp" },
          email:         { type: "string",   example: "acme@example.com" },
          creditBalance: { type: "string",   example: "150.00", description: "Available credit in GH₵" },
          isActive:      { type: "boolean",  example: true },
          lastUsedAt:    { type: "string",   format: "date-time", nullable: true },
          createdAt:     { type: "string",   format: "date-time" },
        },
      },
      Bundle: {
        type: "object",
        properties: {
          id:           { type: "integer", example: 3 },
          name:         { type: "string",  example: "MTN 5GB Monthly" },
          description:  { type: "string",  example: "5GB data valid for 30 days" },
          dataAmount:   { type: "string",  example: "5GB" },
          validityDays: { type: "integer", example: 30 },
          price:        { type: "string",  example: "15.00", description: "Price in GH₵" },
          network:      { type: "string",  example: "mtn", enum: ["mtn", "telecel", "at-ishare", "at-bigtime"] },
          category:     { type: "string",  example: "Monthly" },
        },
      },
      OrderRequest: {
        type: "object",
        required: ["bundleId", "phoneNumber"],
        properties: {
          bundleId:    { type: "integer", example: 3, description: "Bundle ID from GET /bundles" },
          phoneNumber: { type: "string",  example: "0241234567", description: "Recipient's Ghana phone number (10 digits, no country code)" },
        },
      },
      Order: {
        type: "object",
        properties: {
          reference:    { type: "string",  example: "AO-12-1716210000000" },
          bundleName:   { type: "string",  example: "MTN 5GB Monthly" },
          bundleData:   { type: "string",  example: "5GB" },
          bundleNetwork: { type: "string", example: "mtn" },
          phoneNumber:  { type: "string",  example: "0241234567" },
          price:        { type: "string",  example: "15.00" },
          status:       { type: "string",  example: "pending", enum: ["pending", "processing", "completed", "failed"] },
          createdAt:    { type: "string",  format: "date-time" },
          updatedAt:    { type: "string",  format: "date-time" },
        },
      },
    },
  },
  paths: {
    "/account": {
      get: {
        summary: "Get account info",
        description: "Returns your API client profile and current credit balance.",
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
        description: "Returns all active bundles, optionally filtered by network. No authentication required.",
        operationId: "listBundles",
        security: [],
        parameters: [
          {
            name: "network",
            in: "query",
            required: false,
            description: "Filter by network",
            schema: { type: "string", enum: ["mtn", "telecel", "at-ishare", "at-bigtime"] },
          },
          {
            name: "category",
            in: "query",
            required: false,
            description: "Filter by category (e.g. Daily, Weekly, Monthly)",
            schema: { type: "string" },
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

- The bundle price is deducted from your **credit balance** immediately.
- Returns \`402\` if your balance is insufficient.
- The order is fulfilled asynchronously. Poll \`GET /orders/{reference}\` for status.
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
                    reference:     { type: "string",  example: "AO-12-1716210000000" },
                    status:        { type: "string",  example: "pending" },
                    price:         { type: "string",  example: "15.00" },
                    creditBalance: { type: "string",  example: "135.00", description: "Remaining credit after deduction" },
                    message:       { type: "string",  example: "Order placed. Poll /orders/{reference} for status." },
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
            description: "Insufficient credit balance",
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
    "/orders/{reference}": {
      get: {
        summary: "Get order status",
        description: "Returns the current status of an order placed by this API client.",
        operationId: "getOrder",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: "reference",
            in: "path",
            required: true,
            description: "Order reference returned by POST /orders",
            schema: { type: "string", example: "AO-12-1716210000000" },
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

// Raw OpenAPI spec (used by Swagger UI and integrations)
router.get("/openapi.json", (_req, res) => {
  res.json(OPENAPI_SPEC);
});

// Account info
router.get("/account", requireApiKey, (req, res) => {
  const c = req.apiClient!;
  res.json({
    id:            c.id,
    name:          c.name,
    email:         c.email,
    creditBalance: c.creditBalance,
    isActive:      c.isActive,
    lastUsedAt:    c.lastUsedAt?.toISOString() ?? null,
    createdAt:     c.createdAt.toISOString(),
  });
});

// List active bundles — public, no auth required
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
        validityDays: bundlesTable.validityDays,
        price:        bundlesTable.dealerPrice,
        network:      bundlesTable.network,
        category:     bundlesTable.category,
      })
      .from(bundlesTable)
      .where(and(...conditions as [typeof conditions[0], ...typeof conditions]))
      .orderBy(bundlesTable.network, bundlesTable.category, bundlesTable.price);

    res.json({
      bundles: bundles.map(b => ({
        ...b,
        price: b.price ?? "0.00",
      })),
      total: bundles.length,
    });
  } catch (err) {
    req.log.error({ err }, "publicApi: list bundles");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Place an order
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
  const client = req.apiClient!;

  try {
    // Fetch the bundle
    const [bundle] = await db.select().from(bundlesTable).where(
      and(eq(bundlesTable.id, bundleId), eq(bundlesTable.isActive, true)),
    );
    if (!bundle) {
      res.status(404).json({ error: "Bundle not found or no longer available" });
      return;
    }

    // Use dealerPrice if available, else regular price
    const price = parseFloat(bundle.dealerPrice ?? bundle.price);
    const currentBalance = parseFloat(client.creditBalance);

    if (currentBalance < price) {
      res.status(402).json({
        error: "Insufficient credit balance",
        required: price.toFixed(2),
        available: currentBalance.toFixed(2),
      });
      return;
    }

    // Atomic: deduct credit + insert order
    const reference = `AO-${client.id}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const [order] = await db.transaction(async (tx) => {
      // Re-check + lock balance
      const [locked] = await tx
        .select({ creditBalance: apiClientsTable.creditBalance })
        .from(apiClientsTable)
        .where(eq(apiClientsTable.id, client.id))
        .for("update");

      const balance = parseFloat(locked.creditBalance);
      if (balance < price) throw new Error("INSUFFICIENT");

      await tx.update(apiClientsTable)
        .set({ creditBalance: sql`credit_balance - ${price.toFixed(2)}::numeric` })
        .where(eq(apiClientsTable.id, client.id));

      return tx.insert(apiOrdersTable)
        .values({
          apiClientId:   client.id,
          reference,
          bundleId:      bundle.id,
          bundleName:    bundle.name,
          bundleData:    bundle.dataAmount,
          bundleNetwork: bundle.network,
          price:         price.toFixed(2),
          phoneNumber,
          status:        "pending",
        })
        .returning();
    });

    // Attempt immediate dispatch via McBIS (fire-and-forget — poller handles retries)
    dispatchToMcbis({
      orderId:     order.id,
      network:     bundle.network,
      phone:       phoneNumber,
      bundleData:  bundle.dataAmount,
      isApiOrder:  true,
    }).then(async (outcome) => {
      if (outcome.dispatched) {
        await db.update(apiOrdersTable)
          .set({ status: "processing", mcbisReference: outcome.reference })
          .where(eq(apiOrdersTable.id, order.id));
      }
    }).catch(() => {});

    const newBalance = currentBalance - price;

    res.status(201).json({
      reference,
      status:        "pending",
      price:         price.toFixed(2),
      creditBalance: newBalance.toFixed(2),
      message:       `Order placed. Poll GET /api/v1/orders/${reference} for status.`,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "INSUFFICIENT") {
      res.status(402).json({ error: "Insufficient credit balance" });
      return;
    }
    logger.error({ err, clientId: client.id }, "publicApi: place order");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get order by reference
router.get("/orders/:reference", requireApiKey, async (req, res) => {
  const { reference } = req.params;
  const client = req.apiClient!;

  try {
    const [order] = await db
      .select()
      .from(apiOrdersTable)
      .where(and(
        eq(apiOrdersTable.reference, reference),
        eq(apiOrdersTable.apiClientId, client.id),
      ));

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    res.json({
      reference:     order.reference,
      bundleName:    order.bundleName,
      bundleData:    order.bundleData,
      bundleNetwork: order.bundleNetwork,
      phoneNumber:   order.phoneNumber,
      price:         order.price,
      status:        order.status,
      createdAt:     order.createdAt.toISOString(),
      updatedAt:     order.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "publicApi: get order");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { router as publicApiRouter };
export { isNull, isNotNull, desc }; // re-export for mcbis poller usage
