#!/usr/bin/env bash
# Per-boot Cloud Agent bootstrap: make the app runnable end-to-end.
#
# Idempotent. Safe to run on every start:
#   1. Ensure .env.local exists with a database connection + session secret.
#      - If DATABASE_URL is already provided (secret / existing .env.local), reuse it.
#      - Otherwise provision an isolated Neon branch from NEON_API_KEY and pull
#        its pooled + direct connection strings.
#   2. Apply migrations, seed the demo chain, and ensure a super-admin account.
#
# Nothing here starts a long-running process; the dev server lives in `terminals`.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env.local"

# Neon target (overridable). The project + database were provisioned for this
# app inside the team's Vercel-managed Neon org, where new projects cannot be
# created via API — so agents share one project and get their own branch.
NEON_PROJECT_ID="${NEON_PROJECT_ID:-summer-tooth-40230322}"
NEON_BRANCH="${NEON_BRANCH:-creperie-saas-dev}"
NEON_DATABASE="${NEON_DATABASE:-creperie_saas}"
NEON_ROLE="${NEON_ROLE:-neondb_owner}"

# Demo super-admin (editor). Dev-only credentials, mirrors the seed script's
# hardcoded director login; override via env if needed.
SUPERADMIN_NAME="${SUPERADMIN_NAME:-Éditeur Dev}"
SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:-editeur@creperie.local}"
SUPERADMIN_PASSWORD="${SUPERADMIN_PASSWORD:-MotDePasseEditeur2026}"

neon() { npx -y neonctl@latest "$@"; }

env_has() { [ -f "$ENV_FILE" ] && grep -q "^$1=" "$ENV_FILE"; }

upsert_env() {
  local key="$1" value="$2"
  touch "$ENV_FILE"
  if grep -q "^${key}=" "$ENV_FILE"; then return 0; fi
  printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
}

provision_neon() {
  if [ -z "${NEON_API_KEY:-}" ]; then
    echo "ERROR: no DATABASE_URL and no NEON_API_KEY — cannot provision a database." >&2
    echo "       Add NEON_API_KEY (or DATABASE_URL / DATABASE_URL_UNPOOLED) as a secret." >&2
    exit 1
  fi
  export NEON_API_KEY

  echo "→ Ensuring Neon branch '${NEON_BRANCH}' in project '${NEON_PROJECT_ID}'…"
  if ! neon branches get "$NEON_BRANCH" --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1; then
    neon branches create --project-id "$NEON_PROJECT_ID" --name "$NEON_BRANCH" >/dev/null
  fi

  echo "→ Ensuring database '${NEON_DATABASE}'…"
  if ! neon databases list --project-id "$NEON_PROJECT_ID" --branch "$NEON_BRANCH" 2>/dev/null | grep -qw "$NEON_DATABASE"; then
    neon databases create --project-id "$NEON_PROJECT_ID" --branch "$NEON_BRANCH" \
      --name "$NEON_DATABASE" --owner-name "$NEON_ROLE" >/dev/null
  fi

  local common="--project-id $NEON_PROJECT_ID --branch $NEON_BRANCH --role-name $NEON_ROLE --database-name $NEON_DATABASE"
  local pooled direct
  pooled="$(neon connection-string $common --pooled 2>/dev/null | tail -1)"
  direct="$(neon connection-string $common 2>/dev/null | tail -1)"
  if [ -z "$pooled" ] || [ -z "$direct" ]; then
    echo "ERROR: could not obtain Neon connection strings." >&2
    exit 1
  fi
  upsert_env DATABASE_URL "$pooled"
  upsert_env DATABASE_URL_UNPOOLED "$direct"
}

# 1. Database connection ------------------------------------------------------
if [ -n "${DATABASE_URL:-}" ]; then
  upsert_env DATABASE_URL "$DATABASE_URL"
  [ -n "${DATABASE_URL_UNPOOLED:-}" ] && upsert_env DATABASE_URL_UNPOOLED "$DATABASE_URL_UNPOOLED"
elif ! env_has DATABASE_URL; then
  provision_neon
fi

# 2. Remaining app configuration ---------------------------------------------
env_has SESSION_SECRET || upsert_env SESSION_SECRET "$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
upsert_env APP_URL "${APP_URL:-http://localhost:3000}"
upsert_env APP_TIMEZONE "${APP_TIMEZONE:-Europe/Zurich}"
upsert_env NEXT_PUBLIC_EDITOR_NAME "Crêpo (dev)"
upsert_env NEXT_PUBLIC_EDITOR_ADDRESS "Rue de Test 1, 1200 Genève"
upsert_env NEXT_PUBLIC_EDITOR_EMAIL "dev@creperie.local"
upsert_env NEXT_PUBLIC_EDITOR_COUNTRY "Suisse"

# 3. Schema + demo data (all idempotent) -------------------------------------
echo "→ Applying migrations…"
npm run db:migrate
echo "→ Seeding demo chain…"
npm run seed:chain
echo "→ Ensuring super-admin (${SUPERADMIN_EMAIL})…"
npm run superadmin -- "$SUPERADMIN_NAME" "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASSWORD"

echo "✓ Cloud Agent setup complete."
