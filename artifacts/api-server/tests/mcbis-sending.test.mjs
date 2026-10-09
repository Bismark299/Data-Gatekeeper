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

function setup({ store = false, response = "accepted", initial = {} } = {}) {
  const row = { id: 1, status: "paid", delivered: null, mcbisReference: null, topupghBatchId: null, ...initial };
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
        assert.equal(body.reference, row.mcbisReference, "reference must be durable before POST");
        assert.equal(row.delivered, "processing", "tracking must be enabled before POST");
        assert.equal(body.network, "MTN");
        assert.equal(config.maxRedirects, 0);
        if (response === "timeout" || response === "reset" || response === "http500") {
          throw { isAxiosError: true, code: response === "timeout" ? "ECONNABORTED" : "ECONNRESET",
            response: response === "http500" ? { status: 500 } : undefined };
        }
        if (response === "malformed") return { status: 200, data: null };
        return { status: 200, data: { status: response === "accepted" ? "success" : "error",
          message: response === "rejected" ? "Insufficient balance" : "" } };
      },
      get: async url => {
        assert.ok(url.endsWith(encodeURIComponent(row.mcbisReference)));
        return { data: { data: { order: { status: "success" } } } };
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
  return { row, send, api, posts: () => posts };
}

for (const store of [false, true]) {
  for (const response of ["accepted", "timeout", "reset", "http500", "malformed", "rejected"]) {
    test(`${store ? "store" : "platform"}: ${response} keeps one durable send`, async () => {
      const f = setup({ store, response });
      const results = await Promise.all([f.send(), f.send()]);
      assert.equal(f.posts(), 1, "concurrent callers must not both send");
      assert.equal(results[0].dispatched, response === "accepted");
      if (response !== "accepted") assert.equal(results[0].reason, "awaiting_confirmation");
      assert.equal(results[1].reason, "already_dispatched");
      const ref = f.row.mcbisReference;
      assert.equal((await f.send()).reason, "already_dispatched", "later retry must also skip");
      assert.equal(f.row.mcbisReference, ref);
      assert.equal(f.row.delivered, "processing");
      assert.equal(f.posts(), 1);
      assert.equal(await f.api.mcbisCheckStatus("test-only", ref), "success");
    });
  }
  for (const initial of [
    { mcbisReference: "LOCK-legacy" }, { mcbisReference: "existing-reference" },
    { topupghBatchId: 123 }, { status: "refunded" }, { delivered: "delivered" },
  ]) {
    test(`${store ? "store" : "platform"}: skips protected ${JSON.stringify(initial)}`, async () => {
      const f = setup({ store, initial });
      assert.equal((await f.send()).reason, "already_dispatched");
      assert.equal(f.posts(), 0);
    });
  }
}
