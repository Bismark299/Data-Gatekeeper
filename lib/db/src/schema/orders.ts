import { pgTable, text, serial, timestamp, integer, numeric, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { bundlesTable } from "./bundles";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  bundleId: integer("bundle_id").notNull().references(() => bundlesTable.id),
  bundleName: text("bundle_name").notNull(),
  bundleData: text("bundle_data").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  buyingCost: numeric("buying_cost", { precision: 10, scale: 2 }),
  // Payment status only: pending | paid | failed | refunded
  status: text("status").notNull().default("pending"),
  // Fulfillment status: NULL (not dispatched) | processing | delivered | failed
  delivered: text("delivered"),
  phoneNumber: text("phone_number").notNull(),
  mcbisReference: text("mcbis_reference"),
  ckgodswayReference: text("ckgodsway_reference"),
  topupghBatchId: integer("topupgh_batch_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  check("orders_payment_status_check", sql`${t.status} IN ('pending', 'paid', 'failed', 'refunded')`),
  check("orders_delivered_check", sql`${t.delivered} IS NULL OR ${t.delivered} IN ('processing', 'delivered', 'failed')`),
]);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
