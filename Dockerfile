# syntax=docker/dockerfile:1
#
# Lease Loop — single-image deployment for Coolify (Dockerfile build pack).
#
# Coolify setup:
#   1. Build pack: Dockerfile.  Port: 3000.  Run ONE instance only (SQLite, see README).
#   2. Persistent storage: add a volume mounted at /data (holds the SQLite database).
#   3. Environment variables (Runtime only):
#        BETTER_AUTH_URL     = https://your-public-domain   (exact HTTPS origin, no path)
#        BETTER_AUTH_SECRET  = output of `openssl rand -base64 32`
#      Optional overrides (defaults below):
#        AUTH_TRUSTED_IP_HEADER, AUTH_SINGLE_INSTANCE, DATABASE_URL, RUN_SEED, CRON_SECRET
#
# On every start the container applies pending Prisma migrations and (unless RUN_SEED=false)
# runs the idempotent seed, which loads the data pack and creates two demo accounts
# (customer@example.com, supplier@example.com) with the fixed password from
# prisma/seed-accounts.ts. Change those passwords, or delete the accounts, on a public host.

# ---- build stage -----------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain only used if better-sqlite3 has no prebuilt binary for the platform.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1 CI=1

# Install all dependencies: the runtime still needs the Prisma CLI (migrate deploy)
# and tsx (seed), which are devDependencies. `postinstall` runs `prisma generate`.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# `prepare` runs this; it exits at once because the image has no .git folder.
COPY .husky/install.mjs ./.husky/install.mjs
RUN npm ci

COPY . .
# Next imports the DB module while collecting page data, so DATABASE_URL must exist at build
# time. This throwaway value is build-stage only; the runtime stage sets the real one.
RUN DATABASE_URL=file:/tmp/build.db npm run build

# ---- runtime stage ---------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/lease-loop.db \
    AUTH_SINGLE_INSTANCE=true \
    AUTH_TRUSTED_IP_HEADER=x-real-ip \
    RUN_SEED=true

COPY --from=build --chown=node:node /app /app

# /data is the volume mount point for the SQLite file.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000

# Starts as root only to fix ownership of a freshly mounted /data volume, then drops to the
# unprivileged `node` user for migrations, seeding and the server (exec => proper signals).
CMD ["sh", "-c", "\
chown -R node:node /data && \
exec setpriv --reuid=node --regid=node --init-groups sh -c '\
set -e; \
npx prisma migrate deploy; \
if [ \"$RUN_SEED\" != \"false\" ]; then npx prisma db seed; fi; \
exec npm start' \
"]
