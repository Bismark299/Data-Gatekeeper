import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query("SELECT * FROM settings ORDER BY key");
console.log(JSON.stringify(r.rows, null, 2));
await pool.end();
