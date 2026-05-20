import { pgTable, text, serial, timestamp, boolean, integer, numeric, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bundlesTable } from "./bundles";

export const apiClientsTable = pgTable("api_clients", {
  id:            serial("id").primaryKey(),
  name:          text("name").notNull(),
  email:         text("email").notNull(),
  keyHash:       text("key_hash").notNull().unique(),
  keyPrefix:     text("key_prefix").notNull(),
  creditBalance: numeric("credit_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  isActive:      boolean("is_active").notNull().default(true),
  notes:         text("notes"),
  lastUsedAt:    timestamp("last_used_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const apiOrdersTable = pgTable("api_orders", {
  id:            serial("id").primaryKey(),
  apiClientId:   integer("api_client_id").notNull().references(() => apiClientsTable.id, { onDelete: "cascade" }),
  reference:     text("reference").notNull().unique(),
  bundleId:      integer("bundle_id").notNull().references(() => bundlesTable.id),
  bundleName:    text("bundle_name").notNull(),
  bundleData:    text("bundle_data").notNull(),
  bundleNetwork: text("bundle_network").notNull(),
  price:         numeric("price", { precision: 10, scale: 2 }).notNull(),
  status:        text("status").notNull().default("pending"),
  phoneNumber:   text("phone_number").notNull(),
  mcbisReference: text("mcbis_reference"),
  topupghBatchId: integer("topupgh_batch_id"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  check("api_orders_status_check", sql`${t.status} IN ('pending', 'processing', 'completed', 'failed')`),
]);

export type ApiClient = typeof apiClientsTable.$inferSelect;
export type ApiOrder  = typeof apiOrdersTable.$inferSelect;
