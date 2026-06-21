import app from "./app";
import { logger } from "./lib/logger";
import { ensureSchema, recoverStuckTopupghBatches } from "./lib/ensureSchema";
import { startMcbisPoller } from "./lib/mcbis";
import { startCkgodswayPoller } from "./lib/ckgodsway";
import { startTopupghPoller } from "./lib/topupgh";
import { startWithdrawalReconciler } from "./lib/storeWithdrawals";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Ensure required columns exist before any poller queries them. The prod DB is
  // external (Render) and not covered by publish-time migrations, so this guards
  // against schema drift breaking dispatch.
  await ensureSchema();

  // Requeue orders stranded on stuck (never-dispatched) TopUpGH batches.
  await recoverStuckTopupghBatches();

  // Start McbisSolution background poller (polls processing orders every 30 s)
  startMcbisPoller();
  startCkgodswayPoller();

  // Start TopUpGH background poller (dispatches queued MTN orders every 2 min)
  startTopupghPoller();

  // Settle agent withdrawals stuck in "processing" if a transfer webhook is missed
  startWithdrawalReconciler();
});
