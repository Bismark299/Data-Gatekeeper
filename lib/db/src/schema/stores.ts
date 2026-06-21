import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { bundlesTable } from "./bundles";

export const storesTable = pgTable("stores", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull().default(""),
  colorTheme: text("color_theme").notNull().default("blue"),
  isActive: boolean("is_active").notNull().default(true),
  profitBalance: numeric("profit_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  momoNetwork: text("momo_network"),
  momoNumber: text("momo_number"),
  momoName: text("momo_name"),
  paystackRecipientCode: text("paystack_recipient_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const storeBundlesTable = pgTable("store_bundles", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().references(() => storesTable.id, { onDelete: "cascade" }),
  bundleId: integer("bundle_id").notNull().references(() => bundlesTable.id, { onDelete: "cascade" }),
  sellingPrice: numeric("selling_price", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const storeOrdersTable = pgTable("store_orders", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().references(() => storesTable.id, { onDelete: "cascade" }),
  storeBundleId: integer("store_bundle_id").notNull(),
  bundleId: integer("bundle_id").notNull(),
  bundleName: text("bundle_name").notNull(),
  bundleData: text("bundle_data").notNull(),
  bundleNetwork: text("bundle_network").notNull(),
  bundleValidityDays: integer("bundle_validity_days").notNull().default(0),
  customerPhone: text("customer_phone").notNull(),
  customerEmail: text("customer_email").notNull().default(""),
  sellingPrice: numeric("selling_price", { precision: 10, scale: 2 }).notNull(),
  basePrice: numeric("base_price", { precision: 10, scale: 2 }).notNull(),
  agentCost: numeric("agent_cost", { precision: 10, scale: 2 }),
  profit: numeric("profit", { precision: 10, scale: 2 }).notNull(),
  paystackReference: text("paystack_reference").notNull().default(""),
  mcbisReference: text("mcbis_reference"),
  ckgodswayReference: text("ckgodsway_reference"),
  topupghBatchId: integer("topupgh_batch_id"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const storeWithdrawalsTable = pgTable("store_withdrawals", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().references(() => storesTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  method: text("method").notNull().default("mobile_money"),
  accountNumber: text("account_number").notNull().default(""),
  accountName: text("account_name").notNull().default(""),
  bankCode: text("bank_code").notNull().default("MTN"),
  note: text("note").notNull().default(""),
  reference: text("reference").notNull().default(""),
  transferCode: text("transfer_code").notNull().default(""),
  failureReason: text("failure_reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Store = typeof storesTable.$inferSelect;
export type StoreBundle = typeof storeBundlesTable.$inferSelect;
export type StoreOrder = typeof storeOrdersTable.$inferSelect;
export type StoreWithdrawal = typeof storeWithdrawalsTable.$inferSelect;
