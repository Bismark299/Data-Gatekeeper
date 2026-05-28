import app from "./app";
import { logger } from "./lib/logger";
import { startMcbisPoller } from "./lib/mcbis";
import { startCkgodswayPoller } from "./lib/ckgodsway";
import { startTopupghPoller } from "./lib/topupgh";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start McbisSolution background poller (polls processing orders every 30 s)
  startMcbisPoller();
  startCkgodswayPoller();

  // Start TopUpGH background poller (dispatches queued MTN orders every 2 min)
  startTopupghPoller();
});
