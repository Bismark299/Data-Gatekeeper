/**
 * Unified order dispatcher. Routes an order to the correct fulfillment provider
 * based on its network:
 *   - MTN              → McBIS
 *   - Telecel, AT-*    → CK Godsway
 *
 * Each provider has its own dedicated reference column on the order row
 * (`mcbis_reference`, `ckgodsway_reference`), so the caller knows which column
 * to write when the dispatch is accepted.
 */

import { dispatchToMcbis } from "./mcbis";
import { dispatchToCkgodsway } from "./ckgodsway";
import { triggerTopupghDispatch } from "./topupgh";

export type Provider = "mcbis" | "ckgodsway";

export type DispatchResult =
  | { dispatched: true;  provider: Provider; reference: string }
  | { dispatched: false; provider: Provider; reason: string };

const MCBIS_NETWORKS = new Set(["mtn"]);
const CKG_NETWORKS   = new Set(["telecel", "at-ishare", "at-bigtime", "atpremium", "atbigtime"]);

export function providerForNetwork(network: string): Provider | null {
  const n = network.toLowerCase();
  if (MCBIS_NETWORKS.has(n)) return "mcbis";
  if (CKG_NETWORKS.has(n))   return "ckgodsway";
  return null;
}

export async function dispatchOrder(opts: {
  orderId: number;
  network: string;
  phone: string;
  bundleData: string;
  isStoreOrder?: boolean;
}): Promise<DispatchResult> {
  const provider = providerForNetwork(opts.network);
  if (!provider) return { dispatched: false, provider: "mcbis", reason: "wrong_network" };

  if (provider === "mcbis") {
    const out = await dispatchToMcbis(opts);
    if (!out.dispatched) {
      // McBIS declined — either it's off because TopUpGH is the active MTN
      // provider, or it couldn't take this order. Nudge the TopUpGH batch
      // dispatcher so the order goes out instantly instead of waiting for the
      // 2-minute backup poller. Self-gates on topupgh_enabled + min_batch, so
      // it's a harmless no-op when McBIS is the active provider.
      triggerTopupghDispatch();
    }
    return out.dispatched
      ? { dispatched: true, provider, reference: out.reference }
      : { dispatched: false, provider, reason: out.reason };
  }

  const out = await dispatchToCkgodsway(opts);
  return out.dispatched
    ? { dispatched: true, provider, reference: out.reference }
    : { dispatched: false, provider, reason: out.reason };
}
