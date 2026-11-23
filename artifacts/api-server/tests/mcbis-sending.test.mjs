// Runs the real dispatcher against in-memory DB/HTTP doubles. Never calls a provider.
// Run: node --test artifacts/api-server/tests/mcbis-sending.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const mocks = {
  "@workspace/db": `
    export const db = globalThis.fixture.db;
    const table = name => new Proxy({name}, {get: (t,k) => k === "name" ? name : String(k)});
    export const ordersTable=table("platform"), storeOrdersTable=table("store"),
      settingsTable=table("settings"), bundlesTable=table("bundles"), storesTable=table("stores");
  `,
  "drizzle-orm": `
    export const eq=(k,v)=>r=>r[k]===v;
    export const isNull=k=>r=>r[k]==null;
    export const isNotNull=k=>r=>r[k]!=null;
    export const and=(...checks)=>r=>checks.every(c=>c(r));
    export const or=(...checks)=>r=>checks.some(c=>c(r));
    export const sql=()=>{};
  `,
  "axios": `export default {
    create:()=>globalThis.fixture.http,
    isAxiosError:e=>e.isAxiosError===true
  };`,
  "./logger": `export const logger={warn(){},info(){},error(){}};`,
  "./refunds": `export const refundOrderInTx=()=>{}, cancelStoreOrderInTx=()=>{};`,
};
const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/mcbis.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{
    name: "isolated-fixtures",
    setup(b) {
      b.onResolve({ filter: /.*/ }, args =>
        Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js" }));
    },
  }],
});

function setup({ store = false, response = "accepted", initial = {}, balance = "100" } = {}) {
  const row = { id: 1, status: "paid", delivered: null, mcbisReference: null, mcbisAttemptReference: null, mcbisAcceptedReference: null, topupghBatchId: null, ...initial };
  let posts = 0;
  const fixture = {
    db: {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ value: "true" }]) }) }),
      update: table => ({
        set: values => ({
          where: predicate => ({
            returning: async () => {
              assert.equal(table.name, store ? "store" : "platform");
              if (!predicate(row)) return [];
              Object.assign(row, values);
              return [{ id: row.id }];
            },
          }),
        }),
      }),
    },
    http: {
      post: async (_url, body, config) => {
        posts++;
        assert.equal(body.reference, row.mcbisAttemptReference, "attempt must be durable before POST");
        assert.equal(row.mcbisReference, null, "no sent-order reference before acceptance");
        assert.equal(row.delivered, null, "processing must wait for provider acceptance");
        assert.equal(body.network, "MTN");
        assert.equal(config.maxRedirects, 0);
        if (response === "timeout" || response === "reset" || response === "http500") {
          throw { isAxiosError: true, code: response === "timeout" ? "ECONNABORTED" : "ECONNRESET",
            response: response === "http500" ? { status: 500 } : undefined };
        }
        if (response === "malformed") return { status: 200, data: null };
        if (response === "no-funds" || response === "no-funds-402" || response === "funds-text-500" || response === "balance-warning") {
          return { status: response === "no-funds-402" ? 402 : response === "funds-text-500" ? 500 : 200,
            data: { status: "error", message: response === "balance-warning" ? "Wallet balance check failed" : "Insufficient balance" } };
        }
        return { status: 200, data: { data: {
          reference: response === "missing-reference" ? undefined : response === "wrong-reference" ? "different" : body.reference,
          status: ["accepted", "missing-reference", "wrong-reference"].includes(response) ? "pending" : "error" },
          message: response === "rejected" ? "Insufficient balance" : "" } };
      },
      get: async url => {
        if (url.endsWith("/walletBalance")) {
          if (balance === "unavailable") throw new Error("Balance unavailable");
          return { data: { data: { walletBalance: balance } } };
        }
        const ref = row.mcbisReference ?? row.mcbisAttemptReference;
        assert.ok(url.endsWith(encodeURIComponent(ref)));
        return { data: { data: { order: { status: "success", reference: ref } } } };
      },
    },
  };
  const context = vm.createContext({
    fixture, module: { exports: {} }, process: { env: { DATAHUB_API_TOKEN: "test-only" } },
    setTimeout, clearTimeout, setInterval,
  });
  vm.runInContext(bundled.outputFiles[0].text, context);
  const api = context.module.exports;
  const send = () => api.dispatchToMcbis({ orderId: 1, network: "mtn", phone: "0000000000",
    bundleData: "1GB", isStoreOrder: store });
  return { row, send, api, posts: () => posts, setResponse: value => { response = value; }, setBalance: value => { balance = value; } };
}

for (const store of [false, true]) {
  for (const response of ["accepted", "timeout", "reset", "http500", "malformed", "rejected", "missing-reference", "wrong-reference", "funds-text-500", "balance-warning"]) {
    test(`${store ? "store" : "platform"}: ${response} keeps one durable send`, async () => {
      const f = setup({ store, response });
      const results = await Promise.all([f.send(), f.send()]);
      assert.equal(f.posts(), 1, "concurrent callers must not both send");
      assert.equal(results[0].dispatched, response === "accepted");
      if (response !== "accepted") assert.equal(results[0].reason, "awaiting_confirmation");
      assert.equal(results[1].reason, "already_dispatched");
      const ref = f.row.mcbisReference ?? f.row.mcbisAttemptReference;
      assert.equal((await f.send()).reason, "already_dispatched", "later retry must also skip");
      assert.equal(f.row.mcbisReference, response === "accepted" ? ref : null);
      assert.equal(f.row.delivered, response === "accepted" ? "processing" : null);
      assert.equal(f.row.mcbisAcceptedReference, response === "accepted" ? ref : null);
      assert.equal(f.posts(), 1);
      assert.equal(await f.api.mcbisCheckStatus("test-only", ref), "success");
      await f.api.confirmMcbisAcceptance(1, ref, store);
      assert.equal(f.row.delivered, "processing", "verified provider order enables processing");
      assert.equal(f.row.mcbisAcceptedReference, ref);
      assert.equal(f.row.mcbisAttemptReference, null);
    });
  }
  for (const initial of [
    { mcbisReference: "LOCK-legacy" }, { mcbisReference: "existing-reference" },
    { mcbisAttemptReference: "uncertain" }, { mcbisAcceptedReference: "accepted" },
    { topupghBatchId: 123 }, { status: "refunded" }, { delivered: "delivered" },
  ]) {
    test(`${store ? "store" : "platform"}: skips protected ${JSON.stringify(initial)}`, async () => {
      const f = setup({ store, initial });
      assert.equal((await f.send()).reason, "already_dispatched");
      assert.equal(f.posts(), 0);
    });
  }
  for (const response of ["no-funds", "no-funds-402"]) {
    test(`${store ? "store" : "platform"}: ${response} retries after funding without re-sending accepted order`, async () => {
      const f = setup({ store, response });
      const outcomes = await Promise.all([f.send(), f.send()]);
      assert.equal(f.posts(), 1);
      assert.ok(outcomes.some(o => o.reason === "insufficient_funds"));
      assert.equal(f.row.mcbisReference, null);
      assert.equal(f.row.mcbisAttemptReference, null);
      assert.equal(f.row.delivered, null);
      f.setBalance("0");
      assert.equal((await f.send()).reason, "insufficient_funds");
      assert.equal(f.posts(), 1);
      f.setBalance("100");
      f.setResponse("accepted");
      const retry = await Promise.all([f.send(), f.send()]);
      assert.equal(retry.filter(o => o.dispatched).length, 1);
      assert.equal(f.posts(), 2);
      assert.equal(f.row.delivered, "processing");
      assert.equal(f.row.mcbisAcceptedReference, f.row.mcbisReference);
      assert.equal((await f.send()).reason, "already_dispatched");
      assert.equal(f.posts(), 2);
    });
  }
  for (const balance of ["0", "-1", "invalid", "", null, "unavailable"]) {
    test(`${store ? "store" : "platform"}: balance ${balance} blocks sending without claiming`, async () => {
      const f = setup({ store, balance });
      assert.equal((await f.send()).dispatched, false);
      assert.equal(f.posts(), 0);
      assert.equal(f.row.delivered, null);
      assert.equal(f.row.mcbisReference, null);
    });
  }
  test(`${store ? "store" : "platform"}: confirmation does not resurrect refunded order`, async () => {
    const f = setup({ store, initial: { status: "refunded", mcbisReference: "ref" } });
    await f.api.confirmMcbisAcceptance(1, "ref", store);
    assert.equal(f.row.delivered, null);
  });
}
