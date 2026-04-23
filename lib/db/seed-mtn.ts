import { db, bundlesTable } from "./src/index";
import { eq } from "drizzle-orm";

const MTN_BUNDLES = [
  { name: "MTN 500MB", description: "MTN 500MB Data Bundle", dataAmount: "500MB", validityDays: 1,  price: "1.00"  },
  { name: "MTN 1GB",   description: "MTN 1GB Data Bundle",   dataAmount: "1GB",   validityDays: 1,  price: "2.00"  },
  { name: "MTN 2GB",   description: "MTN 2GB Data Bundle",   dataAmount: "2GB",   validityDays: 3,  price: "3.50"  },
  { name: "MTN 4GB",   description: "MTN 4GB Data Bundle",   dataAmount: "4GB",   validityDays: 3,  price: "6.00"  },
  { name: "MTN 6GB",   description: "MTN 6GB Data Bundle",   dataAmount: "6GB",   validityDays: 7,  price: "10.00" },
  { name: "MTN 8GB",   description: "MTN 8GB Data Bundle",   dataAmount: "8GB",   validityDays: 7,  price: "13.00" },
  { name: "MTN 10GB",  description: "MTN 10GB Data Bundle",  dataAmount: "10GB",  validityDays: 14, price: "16.00" },
  { name: "MTN 12GB",  description: "MTN 12GB Data Bundle",  dataAmount: "12GB",  validityDays: 14, price: "20.00" },
  { name: "MTN 20GB",  description: "MTN 20GB Data Bundle",  dataAmount: "20GB",  validityDays: 30, price: "32.00" },
  { name: "MTN 30GB",  description: "MTN 30GB Data Bundle",  dataAmount: "30GB",  validityDays: 30, price: "48.00" },
  { name: "MTN 50GB",  description: "MTN 50GB Data Bundle",  dataAmount: "50GB",  validityDays: 30, price: "75.00" },
];

async function main() {
  for (const b of MTN_BUNDLES) {
    const existing = await db.select({ id: bundlesTable.id }).from(bundlesTable)
      .where(eq(bundlesTable.dataAmount, b.dataAmount));
    // Only add if not a duplicate
    if (existing.length === 0 || (b.dataAmount !== "3GB" && b.dataAmount !== "5GB" && b.dataAmount !== "15GB")) {
      await db.insert(bundlesTable).values({ ...b, category: "standard", network: "mtn", isActive: true });
      console.log("Added:", b.dataAmount);
    } else {
      console.log("Skip (exists):", b.dataAmount);
    }
  }
  const all = await db.select().from(bundlesTable).where(eq(bundlesTable.network, "mtn"));
  console.log("MTN total:", all.length);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
