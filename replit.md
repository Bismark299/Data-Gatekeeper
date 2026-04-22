# DataBundle Platform

## Overview

A full-stack data bundle sales platform with a modern client interface and admin dashboard. The backend acts as a gatekeeper — all business logic, validation, and access control runs server-side. The frontend only handles presentation.

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
- Session cookies (httpOnly, secure in production)
- `requireAuth` middleware for all protected routes
- `requireAdmin` middleware for admin-only routes
- Frontend never trusts its own role checks — server re-validates

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
