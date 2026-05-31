---
name: Orval client body shapes
description: Generated direct API functions vs React Query mutation hooks take different argument shapes; mixing them silently 400s.
---

# Orval generated client: direct fn vs mutation hook body shape

In `lib/api-client-react` (orval + custom-fetch), the **direct async function** and the
**React Query mutation hook** take DIFFERENT argument shapes for the same endpoint:

- Direct function (e.g. `verifyPaystackDeposit(body)`) takes the request body **directly**
  (e.g. `{ reference }`). The custom-fetch mutator does `JSON.stringify(body)` as-is.
- Mutation hook (e.g. `useVerifyPaystackDeposit().mutate({ data: body })`) wraps the body
  in `{ data: ... }`.

**Why this matters:** Calling the *direct* function with the *hook* shape
`verifyPaystackDeposit({ data: { reference } })` serializes to `{"data":{"reference":...}}`,
which fails the server's zod `z.object({ reference })` and returns 400 — silently, with no
type error in some cases. This caused every Paystack wallet auto-verify to fail and dump
users into the manual "payment may still be processing" dialog after every payment.

**How to apply:** When calling a generated `*` function directly (not via its hook), pass the
plain body object. Only use `{ data: ... }` when calling `.mutate()` / `.mutateAsync()` on the
generated mutation hook.
