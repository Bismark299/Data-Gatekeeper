#!/usr/bin/env bash
set -e

npm install --prefix "$HOME" pnpm@10.33.2
export PATH="$HOME/bin:$PATH"

pnpm install
pnpm --filter data-bundle run build
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/db run push-force
