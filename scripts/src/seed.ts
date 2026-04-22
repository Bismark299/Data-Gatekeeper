import bcrypt from "bcryptjs";
import { db, usersTable, bundlesTable, ordersTable, walletsTable, depositsTable } from "@workspace/db";

async function seed() {
  console.log("Seeding database...");

  const adminHash = await bcrypt.hash("Admin@123", 12);
  const userHash = await bcrypt.hash("User@123", 12);

  const existingAdmin = await db.select().from(usersTable);
  if (existingAdmin.length > 0) {
    console.log("Database already seeded, skipping.");
    process.exit(0);
  }

  const [admin] = await db.insert(usersTable).values({
    name: "System Admin",
    email: "admin@databundle.com",
    passwordHash: adminHash,
    phone: "+233244000000",
    role: "admin",
    isActive: true,
  }).returning();

  const [user1] = await db.insert(usersTable).values({
    name: "Kwame Mensah",
    email: "kwame@example.com",
    passwordHash: userHash,
    phone: "+233244123456",
    role: "user",
    isActive: true,
  }).returning();

  const [user2] = await db.insert(usersTable).values({
    name: "Akosua Asante",
    email: "akosua@example.com",
    passwordHash: userHash,
    phone: "+233207654321",
    role: "user",
    isActive: true,
  }).returning();

  console.log("Users seeded:", admin.email, user1.email, user2.email);

  const bundles = await db.insert(bundlesTable).values([
    // MTN bundles
    { name: "MTN Daily 1GB", description: "Browse all day with 1GB of MTN data", dataAmount: "1GB", validityDays: 1, price: "2.00", category: "daily", network: "mtn", isActive: true },
    { name: "MTN Weekly 5GB", description: "Stay connected all week on MTN network", dataAmount: "5GB", validityDays: 7, price: "8.00", category: "weekly", network: "mtn", isActive: true },
    { name: "MTN Monthly 15GB", description: "Enjoy 15GB of MTN data valid for 30 days", dataAmount: "15GB", validityDays: 30, price: "25.00", category: "monthly", network: "mtn", isActive: true },
    { name: "MTN XtraTime 3GB", description: "3GB validity for your extended browsing needs", dataAmount: "3GB", validityDays: 3, price: "5.00", category: "daily", network: "mtn", isActive: true },

    // Telecel bundles
    { name: "Telecel Daily 500MB", description: "Half a gig to power through your day on Telecel", dataAmount: "500MB", validityDays: 1, price: "1.50", category: "daily", network: "telecel", isActive: true },
    { name: "Telecel Weekly 7GB", description: "Full week of high-speed Telecel data", dataAmount: "7GB", validityDays: 7, price: "10.00", category: "weekly", network: "telecel", isActive: true },
    { name: "Telecel Monthly 20GB", description: "Generous monthly Telecel plan for heavy users", dataAmount: "20GB", validityDays: 30, price: "30.00", category: "monthly", network: "telecel", isActive: true },
    { name: "Telecel Night 4GB", description: "4GB of data active from midnight to 6AM", dataAmount: "4GB Night", validityDays: 7, price: "4.00", category: "weekly", network: "telecel", isActive: true },

    // AT iShare bundles
    { name: "iShare Daily 1.5GB", description: "Power your day with 1.5GB AirtelTigo data", dataAmount: "1.5GB", validityDays: 1, price: "2.50", category: "daily", network: "at-ishare", isActive: true },
    { name: "iShare Weekly 6GB", description: "A week of reliable AirtelTigo browsing", dataAmount: "6GB", validityDays: 7, price: "9.00", category: "weekly", network: "at-ishare", isActive: true },
    { name: "iShare Monthly 18GB", description: "Full month of AirtelTigo iShare data", dataAmount: "18GB", validityDays: 30, price: "28.00", category: "monthly", network: "at-ishare", isActive: true },
    { name: "iShare Social 2GB", description: "Social media data — WhatsApp, Facebook, TikTok", dataAmount: "2GB Social", validityDays: 7, price: "3.50", category: "weekly", network: "at-ishare", isActive: true },

    // AT Big-Time bundles
    { name: "Big-Time Starter 2GB", description: "Kick off big with 2GB of AirtelTigo Big-Time data", dataAmount: "2GB", validityDays: 2, price: "3.00", category: "daily", network: "at-bigtime", isActive: true },
    { name: "Big-Time Weekly 10GB", description: "Go big all week with 10GB AirtelTigo data", dataAmount: "10GB", validityDays: 7, price: "14.00", category: "weekly", network: "at-bigtime", isActive: true },
    { name: "Big-Time Unlimited", description: "No limits, full speed — AirtelTigo unlimited monthly", dataAmount: "Unlimited", validityDays: 30, price: "45.00", category: "monthly", network: "at-bigtime", isActive: true },
    { name: "Big-Time Plus 30GB", description: "30GB of premium AirtelTigo data for power users", dataAmount: "30GB", validityDays: 30, price: "38.00", category: "monthly", network: "at-bigtime", isActive: true },
  ]).returning();

  console.log("Bundles seeded:", bundles.length);

  await db.insert(walletsTable).values([
    { userId: user1.id, balance: "50.00" },
    { userId: user2.id, balance: "30.00" },
  ]);

  await db.insert(depositsTable).values([
    { userId: user1.id, amount: "50.00", status: "completed", method: "mobile_money", reference: "DEP-001", note: "Initial deposit" },
    { userId: user2.id, amount: "30.00", status: "completed", method: "mobile_money", reference: "DEP-002", note: "Initial deposit" },
  ]);

  await db.insert(ordersTable).values([
    { userId: user1.id, bundleId: bundles[1].id, bundleName: bundles[1].name, bundleData: bundles[1].dataAmount, price: bundles[1].price, status: "completed", phoneNumber: "+233244123456" },
    { userId: user1.id, bundleId: bundles[6].id, bundleName: bundles[6].name, bundleData: bundles[6].dataAmount, price: bundles[6].price, status: "completed", phoneNumber: "+233244123456" },
    { userId: user1.id, bundleId: bundles[0].id, bundleName: bundles[0].name, bundleData: bundles[0].dataAmount, price: bundles[0].price, status: "pending", phoneNumber: "+233244123456" },
    { userId: user2.id, bundleId: bundles[10].id, bundleName: bundles[10].name, bundleData: bundles[10].dataAmount, price: bundles[10].price, status: "completed", phoneNumber: "+233207654321" },
    { userId: user2.id, bundleId: bundles[13].id, bundleName: bundles[13].name, bundleData: bundles[13].dataAmount, price: bundles[13].price, status: "processing", phoneNumber: "+233207654321" },
  ]);

  console.log("Orders + wallets seeded!");
  console.log("\n=== Login credentials ===");
  console.log("Admin: admin@databundle.com / Admin@123");
  console.log("User1: kwame@example.com / User@123");
  console.log("User2: akosua@example.com / User@123");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
