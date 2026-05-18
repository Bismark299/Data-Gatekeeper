import { pgTable, text, serial, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";

export const topupghBatchesTable = pgTable("topupgh_batches", {
  id: serial("id").primaryKey(),
  topupghOrderId: integer("topupgh_order_id"),
  status: text("status").notNull().default("pending"),
  network: text("network").notNull().default("mtn"),
  itemCount: integer("item_count").notNull().default(0),
  itemsAdded: integer("items_added").notNull().default(0),
  itemsSkipped: integer("items_skipped").notNull().default(0),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }),
  walletDeducted: numeric("wallet_deducted", { precision: 10, scale: 2 }),
  previousBalance: numeric("previous_balance", { precision: 10, scale: 2 }),
  newBalance: numeric("new_balance", { precision: 10, scale: 2 }),
  deliveryData: jsonb("delivery_data"),
  errorMessage: text("error_message"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TopupghBatch = typeof topupghBatchesTable.$inferSelect;
