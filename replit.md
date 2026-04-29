# DataBundle Platform

## Overview

A full-stack data bundle sales platform with a modern client interface and admin dashboard. The backend acts as a gatekeeper — all business logic, validation, and access control runs server-side. The frontend only handles presentation.

## Key Features

- Multi-network bundle sales (MTN, Telecel, AT iShare, AT Big-Time)
- Wallet system with Paystack top-up
- Shopping cart + wallet-deducted instant purchase (/shop)
- **Agent Store System**: Users create branded stores, set custom prices, earn profits, withdraw earnings. Public store pages at `/s/:slug` accept Paystack payments directly.
- Admin dashboard (users, bundles, orders, deposits, wallets, stats)
- User dashboard, order history, profile

## Architecture

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Auth**: Session-based (express-session + bcryptjs)
- **Charts**: Recharts

## Stack

- `artifacts/api-server` — Express 5 API server
- `artifacts/data-bundle` — React + Vite frontend (client + admin)
- `lib/db` — PostgreSQL schema (Drizzle ORM)
- `lib/api-spec` — OpenAPI spec + Orval codegen
- `lib/api-client-react` — Generated React Query hooks
- `lib/api-zod` — Generated Zod validation schemas

## Features

### Client Interface
- Landing page with featured bundle plans
- Browse all bundles (filter by category)
- Register / Login / Logout
- Client dashboard with order stats
- My Orders page with status tracking
- Purchase bundles with phone number

### Admin Dashboard
- Overview stats (users, orders, revenue, active bundles)
- Revenue chart (last 30 days)
- Top-selling bundles list
- Manage bundles (create, edit, toggle active, delete)
- Manage users (search, toggle active, change role, delete)
- Manage orders (filter by status, update status)
- Manage wallets (view all user balances, expandable deposit history per user)

### User Features
- User Profile page (`/profile`) — update name, phone number, and change password
- Order Confirmation dialog — shown after successful checkout with order breakdown, amount charged, and remaining balance

## Security Model

- All business logic is server-side
- Session cookies (httpOnly, secure, SameSite=None for Replit cross-origin)
- **PostgreSQL session store** (connect-pg-simple) — sessions persist across restarts, stored in `sessions` table
- `requireAuth` / `requireAdmin` middleware for all protected routes
- **Helmet** security headers on all responses
- **Rate limiting**: auth 20/15min, wallet 30/min, general API 120/min
- **CORS** locked to known Replit domains (REPLIT_DOMAINS + REPLIT_DEV_DOMAIN)
- **Wallet ledger** (`wallet_ledger` table) — immutable append-only record of every balance change; balance on `wallets` is a cached total
- **Soft-delete** for users (`deleted_at` column) — financial records preserved; hard delete removed
- `deposits.reference` has a DB-level UNIQUE constraint
- `orders.status` has a DB-level CHECK constraint (pending/processing/completed/failed only)
- All financial mutations wrapped in `db.transaction()` with `SELECT FOR UPDATE`
- **Reconciliation endpoint** (`GET /admin/reconcile`) — surfaces stuck processing orders and wallet/ledger discrepancies
- **Pagination** on all admin list endpoints (page/pageSize params)
- Store order lookup (`GET /s/:slug/orders`) requires phone + email (two-factor customer identification)
- Store order verify (`POST /s/:slug/verify`) uses SELECT FOR UPDATE to prevent duplicate state transitions
- `POST /wallet/sms-webhook` protected by `SMS_WEBHOOK_SECRET` header with minute-keyed deduplication

## Demo Credentials

- **Admin**: admin@databundle.com / Admin@123
- **User**: kwame@example.com / User@123 (wallet: GH₵50)
- **User**: akosua@example.com / User@123 (wallet: GH₵30)

## 4 Network Brands

| Network | Color | Tagline |
|---|---|---|
| MTN | Yellow (#FFC107) | Everywhere You Go |
| Telecel | Red (#E31837) | Advancing Lives |
| AT iShare | Blue (#1565C0) | Share the Experience |
| AT Big-Time | Green (#2E7D32) | Go Big or Go Home |

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run seed` — seed demo data
