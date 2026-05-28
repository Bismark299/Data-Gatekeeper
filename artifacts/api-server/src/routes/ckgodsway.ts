import { Router } from "express";
import {
  verifyCkgodswayWebhookSignature,
  handleCkgodswayWebhook,
  type CkgodswayWebhookPayload,
} from "../lib/ckgodsway";
import { logger } from "../lib/logger";

const router = Router();

// ─── Webhook (public — no auth, signature-verified) ──────────────────────────
//
// Configure CK Godsway to POST status updates to:
//   POST https://<your-domain>/api/ckgodsway/webhook
//
// Header: X-Webhook-Signature = HMAC-SHA256(rawBody, CKGODSWAY_WEBHOOK_SECRET) hex.
// This webhook is optional — the poller acts as a fallback if the webhook
// is misconfigured or delayed. Both paths are idempotent.

router.post("/ckgodsway/webhook", async (req, res): Promise<void> => {
  const sig = req.headers["x-webhook-signature"];
  const raw = req.rawBody;

  if (!sig || typeof sig !== "string" || !raw) {
    res.sendStatus(401);
    return;
  }

  let valid = false;
  try {
    valid = verifyCkgodswayWebhookSignature(sig, raw);
  } catch {
    res.sendStatus(401);
    return;
  }

  if (!valid) {
    logger.warn("CK Godsway webhook: invalid signature — request rejected");
    res.sendStatus(401);
    return;
  }

  res.sendStatus(200); // ack immediately before processing
  try {
    await handleCkgodswayWebhook(req.body as CkgodswayWebhookPayload);
  } catch (e) {
    logger.error({ err: e }, "CK Godsway webhook processing error");
  }
});

export { router as ckgodswayRouter };
