#!/usr/bin/env bash
# dev.sh — clean start for hackathon-platform
# Usage: ./dev.sh
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${CYAN}[dev]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC}  $*"; }
warn() { echo -e "${RED}[!]${NC}   $*"; }

cd "$(dirname "$0")"

# ── 0. Ensure Colima (Docker) is running ───────────────────────────────────
docker context use colima &>/dev/null
if ! docker ps &>/dev/null; then
  log "Starting Colima..."
  colima start
fi
ok "Docker is running"

# ── 1. Kill anything on ports used by this project ─────────────────────────
for PORT in 4000 8000 5555 6381; do
  if lsof -ti :$PORT &>/dev/null; then
    warn "Port $PORT in use — killing..."
    lsof -ti :$PORT | xargs kill -9 2>/dev/null || true
    ok "Cleared port $PORT"
  else
    ok "Port $PORT is free"
  fi
done

# ── 2. Stop + remove Docker containers cleanly ─────────────────────────────
log "Stopping Docker services..."
docker compose down --remove-orphans 2>/dev/null || true
ok "Docker services stopped"

# ── 3. Start infrastructure (postgres + redis + scheduler) ─────────────────
log "Starting Docker services..."
docker compose up -d --wait
ok "Docker services healthy"

# ── 4. Install / sync API dependencies ─────────────────────────────────────
log "Installing API dependencies..."
cd apps/api
npm install --silent
ok "Dependencies installed"

# ── 5. Prisma generate + migrate ───────────────────────────────────────────
log "Running Prisma generate..."
npx prisma generate

log "Running Prisma migrations..."
npx prisma migrate dev --skip-seed 2>/dev/null || npx prisma migrate deploy
ok "Database schema up to date"

cd ../..

# ── 6. Start API ───────────────────────────────────────────────────────────
log "Starting API on http://localhost:4000/graphql"
echo ""
cd apps/api
exec npm run start:dev
