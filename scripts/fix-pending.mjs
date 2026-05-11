import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: "postgresql://eli_urqo_user:dn5zy2bDr6AnHdrV4lEOgnSnlsZFvC7i@dpg-d7rtf3i8qa3s73don430-a.oregon-postgres.render.com/eli_urqo",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const r = await c.query("UPDATE store_orders SET status='cancelled' WHERE status='pending'");
console.log("Cancelled rows:", r.rowCount);
await c.end();
