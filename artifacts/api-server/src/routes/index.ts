import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import bundlesRouter from "./bundles";
import ordersRouter from "./orders";
import adminRouter from "./admin";
import { walletRouter, handlePaystackWebhook } from "./wallet";
import { cartRouter } from "./cart";
import { storesRouter, handleStorePaystackWebhook } from "./stores";
import { topupghRouter } from "./topupgh";
import { publicApiRouter } from "./publicApi";
import crypto from "crypto";

const router: IRouter = Router();

// ─── Unified Paystack webhook ─────────────────────────────────────────────────
// Paystack only supports ONE webhook URL. This endpoint verifies the signature
// once, then delegates to the correct handler based on the reference prefix:
//   STORE-*  → store order payment
//   DB-PS-*  → wallet top-up
router.post("/paystack/webhook", async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
  if (!secret) { res.status(503).send("Webhook not configured"); return; }

  const sig = req.headers["x-paystack-signature"] as string | undefined;
  if (!sig) { res.status(401).send("Missing signature"); return; }

  const hash = crypto
    .createHmac("sha512", secret)
    .update(req.rawBody ?? Buffer.from(JSON.stringify(req.body)))
    .digest("hex");
  if (hash !== sig) { res.status(401).send("Invalid signature"); return; }

  // Always acknowledge immediately — Paystack retries for hours on any non-200
  res.sendStatus(200);

  const { event, data } = req.body as { event: string; data?: { reference?: string } };
  if (event === "charge.success" && data?.reference) {
    const handler = data.reference.startsWith("STORE-")
      ? handleStorePaystackWebhook(req.body)
      : handlePaystackWebhook(req.body);
    handler.catch((err: unknown) => {
      req.log.error({ err, reference: data.reference }, "Paystack webhook processing error");
    });
  }
});

router.use(healthRouter);
router.use(authRouter);
router.use(bundlesRouter);
router.use(ordersRouter);
router.use(adminRouter);
router.use("/wallet", walletRouter);
router.use("/cart", cartRouter);
router.use(storesRouter);
router.use(topupghRouter);
router.use("/v1", publicApiRouter);

export default router;
