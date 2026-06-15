# Cinepals — development commands (https://github.com/casey/just)
#
# Usage:  just <recipe>      |     just --list for the full list
#
# The variables from .env.local are loaded automatically in every recipe
# (so Prisma and the app see DATABASE_URL, JWT_SECRET, TMDB_API_KEY, ...).

set dotenv-load := true
set dotenv-filename := ".env.local"

# Show the list of recipes
default:
    @just --list

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

# Full setup: dependencies + .env.local + database + schema
setup: install env db-up
    @echo "⏳ Waiting for the database to be ready..."
    @sleep 3
    @just push
    @echo "✅ All set. Start with:  just dev"

# Install the dependencies
install:
    pnpm install

# Create .env.local from .env.example if it does not exist
env:
    @[ -f .env.local ] && echo ".env.local already present" || (cp .env.example .env.local && echo "created .env.local — remember to set TMDB_API_KEY")

# ---------------------------------------------------------------------------
# Database (Postgres via Docker)
# ---------------------------------------------------------------------------

# Start only the Postgres container
db-up:
    docker compose up -d db

# Stop the containers
db-down:
    docker compose down

# Reset the database (deletes the data and recreates it)
db-reset:
    docker compose down -v
    docker compose up -d db
    @sleep 3
    @just push

# Open Prisma Studio (database UI)
studio:
    pnpm exec prisma studio

# Seed fake friends + recommendations for a user (default: demo@example.com)
#   just seed                 |  just seed someone@example.com
seed email="":
    pnpm exec tsx scripts/seed-fake.ts {{email}}

# ---------------------------------------------------------------------------
# Mail trap (Mailpit — catches dev emails, inbox at http://127.0.0.1:8025)
# ---------------------------------------------------------------------------

# Start the Mailpit mail trap
mail-up:
    docker compose up -d mailpit

# Stop the Mailpit mail trap
mail-down:
    docker compose stop mailpit

# Open the Mailpit inbox in the browser
mail-open:
    open http://127.0.0.1:8025

# ---------------------------------------------------------------------------
# Prisma
# ---------------------------------------------------------------------------

# Generate the Prisma client
generate:
    pnpm exec prisma generate

# Sync the schema to the DB without migration files (rapid development)
push:
    pnpm exec prisma db push

# Create a new migration, e.g.:  just migrate init
migrate name:
    pnpm exec prisma migrate dev --name {{name}}

# ---------------------------------------------------------------------------
# Development and build
# ---------------------------------------------------------------------------

# Start in development with hot-reload (also starts the database + mail trap)
dev: db-up mail-up
    @sleep 2
    pnpm exec tsx watch src/server.ts

# Type-check without emitting files
typecheck:
    pnpm exec tsc -p tsconfig.json --noEmit

# Production build (prisma generate + tsc)
build:
    pnpm run build

# Start the production build
start:
    pnpm start

# ---------------------------------------------------------------------------
# Docker (stack completo: db + app + adminer)
# ---------------------------------------------------------------------------

# Start everything in Docker
up:
    docker compose up

# Rebuild the images and start
up-build:
    docker compose up --build

# Stop everything
down:
    docker compose down

# Follow the app's logs
logs:
    docker compose logs -f app

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

# Verify build and types before deploying
predeploy: typecheck build

# Deploy: push to Git (Render deploys automatically from the linked repo)
deploy: predeploy
    git push origin main
