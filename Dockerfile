# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# QuadForge image.
#
# Two stages, because a Vite build needs node and the result needs none of it:
# the runtime layer carries only static files and nginx.
#
# The runtime is `nginx-unprivileged`, which listens on 8080 and runs as uid
# 101. That is deliberate: the deployment runs with runAsNonRoot, and a stock
# nginx image would need root to bind :80, which would mean either weakening
# the pod security context or switching to a port-forward hack.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Dependencies first, so a source-only change reuses the npm layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The test suite is the gate: a build that cannot pass its own geometry tests
# should not become an image. It runs before `vite build` so a failure costs
# seconds rather than the whole bundle.
RUN npm test

RUN npm run build


# ---------------------------------------------------------------------------
# Runtime.
# ---------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
