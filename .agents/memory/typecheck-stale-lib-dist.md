---
name: Typecheck needs lib rebuild
description: Frontend typecheck resolves api-client-react via its compiled dist; stale dist causes phantom type errors.
---
The data-bundle typecheck uses TS project references to `lib/api-client-react`, which emits declarations to `dist/`. If the lib's `dist` is stale (e.g. after API schema regeneration), the frontend typecheck fails with "property does not exist" errors even though `src/generated` is correct.

**Why:** package.json exports point to `src`, but tsc project references resolve the composite project's `dist` declarations.

**How to apply:** always run `pnpm --filter @workspace/api-client-react exec tsc -b` before the frontend typecheck — the registered `typecheck-web` validation command already chains this.
