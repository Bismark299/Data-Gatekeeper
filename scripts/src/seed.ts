import bcrypt from "bcryptjs";
import { db, usersTable, bundlesTable, ordersTable } from "@workspace/db";

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
    phone: "+1234567890",
    role: "admin",
    isActive: true,
  }).returning();

  const [user1] = await db.insert(usersTable).values({
    name: "John Okafor",
    email: "john@example.com",
    passwordHash: userHash,
    phone: "+2348012345678",
    role: "user",
    isActive: true,
  }).returning();

  const [user2] = await db.insert(usersTable).values({
    name: "Amina Hassan",
    email: "amina@example.com",
    passwordHash: userHash,
    phone: "+2347098765432",
    role: "user",
    isActive: true,
  }).returning();

  console.log("Users seeded:", admin.email, user1.email, user2.email);

  const bundles = await db.insert(bundlesTable).values([
    { name: "Daily Lite", description: "Perfect for light daily browsing and social media", dataAmount: "500MB", validityDays: 1, price: "0.99", category: "daily", isActive: true },
    { name: "Daily Plus", description: "All-day browsing with video streaming support", dataAmount: "2GB", validityDays: 1, price: "1.99", category: "daily", isActive: true },
    { name: "Weekly Basic", description: "Stay connected all week with unlimited social", dataAmount: "5GB", validityDays: 7, price: "4.99", category: "weekly", isActive: true },
    { name: "Weekly Pro", description: "Power through your week with high-speed data", dataAmount: "15GB", validityDays: 7, price: "9.99", category: "weekly", isActive: true },
    { name: "Monthly Starter", description: "Great value monthly plan for moderate users", dataAmount: "20GB", validityDays: 30, price: "14.99", category: "monthly", isActive: true },
    { name: "Monthly Unlimited", description: "No limits. Full speed. All month long.", dataAmount: "Unlimited", validityDays: 30, price: "29.99", category: "monthly", isActive: true },
    { name: "Social Pack", description: "WhatsApp, Facebook, Twitter & Instagram included", dataAmount: "3GB Social", validityDays: 7, price: "3.49", category: "social", isActive: true },
    { name: "Night Owl", description: "Discounted data from midnight to 6am", dataAmount: "10GB Night", validityDays: 30, price: "6.99", category: "monthly", isActive: true },
  ]).returning();

  console.log("Bundles seeded:", bundles.length);

  await db.insert(ordersTable).values([
    { userId: user1.id, bundleId: bundles[2].id, bundleName: bundles[2].name, bundleData: bundles[2].dataAmount, price: bundles[2].price, status: "completed", phoneNumber: "+2348012345678" },
    { userId: user1.id, bundleId: bundles[4].id, bundleName: bundles[4].name, bundleData: bundles[4].dataAmount, price: bundles[4].price, status: "completed", phoneNumber: "+2348012345678" },
    { userId: user1.id, bundleId: bundles[0].id, bundleName: bundles[0].name, bundleData: bundles[0].dataAmount, price: bundles[0].price, status: "pending", phoneNumber: "+2348012345678" },
    { userId: user2.id, bundleId: bundles[5].id, bundleName: bundles[5].name, bundleData: bundles[5].dataAmount, price: bundles[5].price, status: "completed", phoneNumber: "+2347098765432" },
    { userId: user2.id, bundleId: bundles[6].id, bundleName: bundles[6].name, bundleData: bundles[6].dataAmount, price: bundles[6].price, status: "processing", phoneNumber: "+2347098765432" },
  ]);

  console.log("Orders seeded!");
  console.log("\n=== Login credentials ===");
  console.log("Admin: admin@databundle.com / Admin@123");
  console.log("User1: john@example.com / User@123");
  console.log("User2: amina@example.com / User@123");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
