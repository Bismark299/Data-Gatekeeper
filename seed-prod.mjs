/**
 * Seed script — mirrors key Replit production data locally.
 * Run: node seed-prod.mjs
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const { Client } = pg;
const client = new Client({
  connectionString: "postgresql://postgres:299Calvart%40@localhost:5432/data_gatekeeper",
});

await client.connect();

// ── 1. BUNDLES ────────────────────────────────────────────────────────────────
// Clear old test rows first
await client.query(`DELETE FROM bundles`);
await client.query(`ALTER SEQUENCE bundles_id_seq RESTART WITH 1`);

const bundles = [
  // MTN — full pricing
  { name: "MTN 1GB",  dataAmount: "1GB",  validityDays: 30, price: "3.80",  dealerPrice: "4.20",  agentPrice: "4.30",  network: "mtn" },
  { name: "MTN 2GB",  dataAmount: "2GB",  validityDays: 30, price: "7.40",  dealerPrice: "8.30",  agentPrice: "8.40",  network: "mtn" },
  { name: "MTN 3GB",  dataAmount: "3GB",  validityDays: 30, price: "11.40", dealerPrice: "12.30", agentPrice: "12.40", network: "mtn" },
  { name: "MTN 4GB",  dataAmount: "4GB",  validityDays: 30, price: "15.20", dealerPrice: "16.30", agentPrice: "16.40", network: "mtn" },
  { name: "MTN 5GB",  dataAmount: "5GB",  validityDays: 30, price: "19.00", dealerPrice: "20.40", agentPrice: "20.50", network: "mtn" },
  { name: "MTN 6GB",  dataAmount: "6GB",  validityDays: 30, price: "24.00", dealerPrice: "25.00", agentPrice: "26.00", network: "mtn" },
  { name: "MTN 8GB",  dataAmount: "8GB",  validityDays: 30, price: "32.00", dealerPrice: "33.00", agentPrice: "34.00", network: "mtn" },
  { name: "MTN 10GB", dataAmount: "10GB", validityDays: 30, price: "37.50", dealerPrice: "40.00", agentPrice: "41.00", network: "mtn" },
  // MTN — cost price only (no dealer/agent tiers)
  { name: "MTN 15GB", dataAmount: "15GB", validityDays: 30, price: "56.00", dealerPrice: null, agentPrice: null, network: "mtn" },
  { name: "MTN 20GB", dataAmount: "20GB", validityDays: 30, price: "75.00", dealerPrice: null, agentPrice: null, network: "mtn" },
  { name: "MTN 25GB", dataAmount: "25GB", validityDays: 30, price: "93.00", dealerPrice: null, agentPrice: null, network: "mtn" },
  { name: "MTN 30GB", dataAmount: "30GB", validityDays: 30, price: "112.00",dealerPrice: null, agentPrice: null, network: "mtn" },
  { name: "MTN 40GB", dataAmount: "40GB", validityDays: 30, price: "150.00",dealerPrice: null, agentPrice: null, network: "mtn" },
  { name: "MTN 50GB", dataAmount: "50GB", validityDays: 30, price: "187.00",dealerPrice: null, agentPrice: null, network: "mtn" },
  // AT iShare
  { name: "AT iShare 1.5GB", dataAmount: "1.5GB",  validityDays: 30, price: "5.00",  dealerPrice: null, agentPrice: null, network: "at" },
  { name: "AT iShare 2GB",   dataAmount: "2GB",    validityDays: 30, price: "7.00",  dealerPrice: null, agentPrice: null, network: "at" },
  { name: "AT iShare 6GB",   dataAmount: "6GB",    validityDays: 30, price: "20.00", dealerPrice: null, agentPrice: null, network: "at" },
  { name: "AT iShare 18GB",  dataAmount: "18GB",   validityDays: 30, price: "60.00", dealerPrice: null, agentPrice: null, network: "at" },
  // AT Big-Time
  { name: "AT Big-Time 2GB",       dataAmount: "2GB",       validityDays: 30, price: "6.00",  dealerPrice: null, agentPrice: null, network: "at" },
  { name: "AT Big-Time 10GB",      dataAmount: "10GB",      validityDays: 30, price: "30.00", dealerPrice: null, agentPrice: null, network: "at" },
  { name: "AT Big-Time 30GB",      dataAmount: "30GB",      validityDays: 30, price: "90.00", dealerPrice: null, agentPrice: null, network: "at" },
  { name: "AT Big-Time Unlimited", dataAmount: "Unlimited", validityDays: 30, price: "150.00",dealerPrice: null, agentPrice: null, network: "at" },
  // Telecel
  { name: "Telecel 4GB",  dataAmount: "4GB",  validityDays: 30, price: "14.00", dealerPrice: null, agentPrice: null, network: "telecel" },
  { name: "Telecel 5GB",  dataAmount: "5GB",  validityDays: 30, price: "17.00", dealerPrice: null, agentPrice: null, network: "telecel" },
  { name: "Telecel 7GB",  dataAmount: "7GB",  validityDays: 30, price: "24.00", dealerPrice: null, agentPrice: null, network: "telecel" },
  { name: "Telecel 20GB", dataAmount: "20GB", validityDays: 30, price: "68.00", dealerPrice: null, agentPrice: null, network: "telecel" },
];

for (const b of bundles) {
  await client.query(
    `INSERT INTO bundles (name, description, data_amount, validity_days, price, dealer_price, agent_price, category, network, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
    [b.name, `${b.name} Data Bundle`, b.dataAmount, b.validityDays, b.price, b.dealerPrice, b.agentPrice, "data", b.network]
  );
}
console.log(`✅ Inserted ${bundles.length} bundles`);

// ── 2. USERS ──────────────────────────────────────────────────────────────────
const defaultPassword = await bcrypt.hash("Password@1234", 12);

const users = [
  { name: "Kris",           email: "kris@datagatekeeper.com",   role: "dealer", depositCode: "DEP-KRIS-001" },
  { name: "Akosua Asante",  email: "akosua@datagatekeeper.com", role: "agent",  depositCode: "DEP-AKOSUA-002" },
  { name: "Kwame Mensah",   email: "kwame@datagatekeeper.com",  role: "agent",  depositCode: "DEP-KWAME-003" },
];

const userIds = {};
for (const u of users) {
  // Skip if already exists
  const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [u.email]);
  if (existing.rows.length > 0) {
    userIds[u.name] = existing.rows[0].id;
    console.log(`⏭  User ${u.name} already exists (id=${userIds[u.name]})`);
    continue;
  }
  const res = await client.query(
    `INSERT INTO users (name, email, password_hash, role, is_active, deposit_code)
     VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
    [u.name, u.email, defaultPassword, u.role, u.depositCode]
  );
  userIds[u.name] = res.rows[0].id;
  console.log(`✅ Created user ${u.name} (id=${userIds[u.name]})`);
}

// ── 3. WALLETS ────────────────────────────────────────────────────────────────
const walletBalances = {
  "Kris":          "474.00",
  "Akosua Asante": "30.00",
  "Kwame Mensah":  "0.00",
};

for (const [name, balance] of Object.entries(walletBalances)) {
  const userId = userIds[name];
  if (!userId) continue;
  await client.query(
    `INSERT INTO wallets (user_id, balance)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance`,
    [userId, balance]
  );
  console.log(`✅ Wallet for ${name}: GH₵${balance}`);
}

// ── 4. STORES ─────────────────────────────────────────────────────────────────
const stores = [
  { userId: userIds["Kris"],         name: "kem+",           slug: "kem-plus",       profitBalance: "11.20" },
  { userId: userIds["Kwame Mensah"], name: "Kwame Data Hub", slug: "kwame-data-hub", profitBalance: "0.00"  },
];

for (const s of stores) {
  if (!s.userId) continue;
  await client.query(
    `INSERT INTO stores (user_id, name, slug, description, profit_balance, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, profit_balance = EXCLUDED.profit_balance`,
    [s.userId, s.name, s.slug, `${s.name} data store`, s.profitBalance]
  );
  console.log(`✅ Store: ${s.name}`);
}

await client.end();
console.log("\n🎉 Seed complete!");
console.log("   Logins (all with password: Password@1234):");
users.forEach(u => console.log(`   ${u.role.padEnd(8)} ${u.email}`));
