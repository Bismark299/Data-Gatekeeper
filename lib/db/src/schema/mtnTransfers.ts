import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

// Self-contained log of MTN Customer Transfer attempts (airtime / data sent from a
// sender MSISDN to a receiver MSISDN via the MTN MADAPI Customer Transfer endpoint).
// Intentionally isolated from the bundle-selling tables.
export const mtnTransfersTable = pgTable("mtn_transfers", {
  id: serial("id").primaryKey(),
  senderMsisdn: text("sender_msisdn").notNull(),
  receiverMsisdn: text("receiver_msisdn").notNull(),
  transferType: text("transfer_type").notNull().default("data"), // "data" | "airtime"
  amount: text("amount").notNull(),                               // MTN expects a string
  productCode: text("product_code").notNull().default(""),
  status: text("status").notNull().default("pending"),           // pending | success | failed
  transactionId: text("transaction_id").notNull().default(""),    // our correlation id (sent to MTN)
  mtnTransactionId: text("mtn_transaction_id").notNull().default(""), // id returned by MTN
  statusCode: text("status_code").notNull().default(""),
  statusMessage: text("status_message").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type MtnTransfer = typeof mtnTransfersTable.$inferSelect;
