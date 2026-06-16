# Agent Store Page — Documentation

**File:** `artifacts/data-bundle/src/pages/store-manager.tsx` (~1,150 lines)
**Route:** `/store` (agent-facing; wrapped in `ProtectedRoute`, any logged-in user)
**API layer:** `artifacts/data-bundle/src/lib/storeApi.ts`
**Public counterpart:** `artifacts/data-bundle/src/pages/public-store.tsx` (the customer-facing storefront at `/s/:slug`)

This is the page an agent uses to **create, brand, stock, and run their own data-bundle store**, track sales, and withdraw the profit they earn. The backend is the gatekeeper — this page only presents data and sends requests; all pricing rules, money movement, and validation happen server-side.

---

## 1. Top-level flow (`StoreManager` default export)

On load it calls `storeApi.getMyStore()`:

- **Loading** → spinner.
- **No store yet** → renders `CreateStoreForm` (onboarding).
- **Has a store** → renders `StoreDashboard`.

A locally-created store (`created` state) is shown immediately after creation without waiting for a refetch.

---

## 2. Create Store form (`CreateStoreForm`)

First-run onboarding for an agent with no store.

| Field | Notes |
|---|---|
| **Store Name** | Required, min 2 chars. |
| **Store Link (slug)** | Auto-generated from the name (lowercased, spaces→dashes, stripped of symbols, max 40 chars). Editable, but **cannot be changed after creation**. Becomes `/s/<slug>`. |
| **Description** | Optional tagline. |
| **Store Color** | One of 7 themes (MTN Gold, Telecel Red, Ocean Blue, Forest Green, Royal Purple, Sunset, Teal). |

Submits via `storeApi.createStore()`; on success invalidates the `myStore` query and drops the agent into the dashboard.

---

## 3. Dashboard shell (`StoreDashboard`)

**Header** shows the store icon (in the chosen theme color), name, description, the `/s/<slug>` link, a **Copy Link** button, and a **View Store** link (opens the public store in a new tab). A dark pill below shows the live **Profit Balance** and the number of bundles listed.

**Live data** (React Query, all auto-refetching every 30s):
- `myStore` — the store record
- `myStoreStats` — sales/revenue/profit/balance
- `myStoreBundles` — bundles the agent has priced
- `myStoreOrders` — store sales
- `myStoreWithdrawals` — payout history

**Five tabs:** Overview · Bundles · Orders · **Earnings** (withdrawals) · Settings.

---

## 4. Overview tab (`OverviewTab`)

Four stat cards:
- **Total Sales** (count)
- **Total Revenue** (GH₵, what customers paid)
- **Total Profit** (GH₵, agent's cumulative earnings)
- **Withdrawable** (current profit balance available to cash out)

Below: the **5 most recent orders** with network badge, data size, customer phone, amount, profit, and status — or an empty state prompting the agent to share their link.

---

## 5. Bundles tab (`BundlesTab`)

Where the agent sets **their own selling price** per bundle.

- Loads **all system bundles** (`useListBundles`) and groups them by the 4 networks (MTN, Telecel, AT iShare, AT Big-Time), sorted by data size.
- Each row shows: bundle name, data amount, **Cost** (the agent's buying cost, already role-resolved by the server — agent vs dealer pricing), **Sell Price** (editable), and **Profit** (`Sell Price − Cost`, shown live as they type).
- Editing a price either **adds** the bundle to the store (`addBundle`) or **updates** it (`updateBundle`). The Save button is disabled unless the price is **≥ cost** (no selling at a loss).
- A per-network header shows how many bundles are priced (e.g. "5/12 priced").

### Bulk Order modal (`BulkOrderModal`)
Launched per network. The agent pastes lines of `phone  GB` (one per line). The modal:
- Parses and **validates each line** live (valid phone format, GB size exists in their store), showing a green/red preview row with a reason for any skip.
- Shows a running **total cost** before submitting.
- Submits via `storeApi.bulkOrder()`; cost is **deducted from the agent's wallet/profit balance** server-side. On success it optimistically subtracts the cost from the cached wallet balance and reports how many orders were processed vs skipped (with reasons).

---

## 6. Orders tab (`OrdersTab`)

A filterable table of **store sales** (customers buying from the public store page).

- **Filters:** customer phone, status (all/pending/processing/completed/cancelled/failed), and a date range that **defaults to today**. "Today" and "Clear" shortcuts reset filters.
- **Columns:** # · Data · Network · Phone · Revenue · Profit · Payment (always "Paid" — these come from completed Paystack checkouts) · Status · Date.
- Empty states differentiate "no orders yet" from "no orders match your filters".

---

## 7. Earnings / Withdrawals tab (`WithdrawalsTab`)

Two panels: a **withdraw form** and **withdrawal history**.

### Constants
- `MIN_WITHDRAWAL = GH₵10`
- `WITHDRAWAL_FEE = GH₵1` (charged per withdrawal)

### Saved MoMo account
- If the store has saved MoMo details, they're shown as a verified card with **Edit** / **Remove** actions.
- Otherwise the agent picks a **method** (Mobile Money or Bank Transfer):
  - **Mobile Money:** choose network (MTN MoMo / Vodafone Cash / AirtelTigo Money), enter a 10-digit number, then **Verify** — calls `POST /api/stores/resolve-momo` to resolve the real account name via Paystack, then saves it (`saveMomoDetails`). Withdrawal is blocked until the account is verified.
  - **Bank Transfer:** enter a Paystack bank code + account number.

### Amount & fee
- Enter amount (≥ GH₵10). The form shows the **GH₵1 fee** and the **total deducted from balance** (`amount + 1`).
- `canWithdraw` requires: amount ≥ min, `amount + fee ≤ profit balance`, an account number, a bank code, and a verified account.

### Submitting
- Calls `storeApi.withdraw()`. The server deducts `amount + fee` from the profit balance at request time and attempts an automatic Paystack transfer. The response's `autoMessage` drives the success copy:
  - `sent` → "sent successfully! It's on its way to your MoMo."
  - `processing` → "is being processed — you'll receive it shortly."
  - otherwise → "queued — awaiting admin approval."

### History
List of past withdrawals with a status icon (completed/pending/failed), account, amount, method, and date.

> Money-safety note: failed/cancelled transfers refund `amount + fee` server-side, and all terminal transitions are row-locked and status-guarded so a withdrawal can never be both refunded and marked paid. (See admin Withdrawals + `lib/storeWithdrawals.ts`.)

---

## 8. Settings tab (`SettingsTab`)

- Edit **store name, description, and color theme** (`updateStore`); shows a "Saved!" confirmation.
- **Your Store Link** card with Copy and Open actions.
- The slug is **not** editable here (permanent).

---

## 9. API surface used (`storeApi`)

All requests go to `/api`, send cookies (`credentials: "include"`), and on a `401` dispatch an `auth:unauthorized` event so the app can log the user out.

**Agent (owner) endpoints**
| Method | Path | Purpose |
|---|---|---|
| GET | `/stores/my` | Get the logged-in user's store (or null) |
| POST | `/stores` | Create a store |
| PUT | `/stores/my` | Update name/description/colorTheme/isActive |
| GET | `/stores/my/bundles` | List priced bundles |
| POST | `/stores/my/bundles` | Add a bundle with a selling price |
| PUT | `/stores/my/bundles/:id` | Update selling price / active |
| DELETE | `/stores/my/bundles/:id` | Remove a bundle |
| GET | `/stores/my/orders` | Store sales |
| GET | `/stores/my/stats` | Sales/revenue/profit/balance |
| GET | `/stores/my/withdrawals` | Payout history |
| POST | `/stores/my/withdraw` | Request a withdrawal |
| POST | `/stores/my/momo-details` | Save MoMo payout account |
| DELETE | `/stores/my/momo-details` | Remove saved MoMo account |
| POST | `/stores/resolve-momo` | Resolve/verify MoMo account name (Paystack) |
| GET | `/orders` | Agent's own platform orders |
| POST | `/orders/bulk` | Bulk order from store bundles |

**Public (customer) endpoints** — used by the public store page, defined in the same `storeApi`:
| Method | Path | Purpose |
|---|---|---|
| GET | `/s/:slug` | Public store + bundles |
| POST | `/s/:slug/checkout` | Start a Paystack checkout |
| POST | `/s/:slug/verify` | Verify a payment by reference |
| GET | `/s/:slug/orders?phone=` | Customer order tracking |

---

## 10. Key data shapes (`storeApi.ts`)

- **`Store`** — id, userId, name, slug, description, colorTheme, isActive, profitBalance, momoNetwork/Number/Name, timestamps.
- **`StoreBundle`** — id, storeId, bundleId, sellingPrice, isActive, plus joined bundle info (name, dataAmount, validityDays, basePrice, network, category).
- **`StoreOrder`** — bundle info, customerPhone/Email, sellingPrice, basePrice, profit, paystackReference, status, timestamps.
- **`StoreStats`** — totalSales, totalRevenue, totalProfit, profitBalance, totalPending.
- **`StoreWithdrawal`** — amount, status, method, account fields, note, createdAt, optional `autoMessage`.

---

## 11. Money model (as reflected on this page)

- **Cost** = the agent's buying price (server resolves agent vs dealer pricing).
- **Sell Price** = what the agent charges the customer (must be ≥ cost).
- **Profit** = Sell Price − Cost, accumulated into `profitBalance`.
- **Withdrawals** deduct `amount + GH₵1 fee` from `profitBalance`; failures refund it.
- **Bulk orders** deduct cost from the agent's wallet/profit balance at submission.
