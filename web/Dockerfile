# The web app on our VPS (deploy/compose.yaml), or any Docker host: Next's standalone server on port 3000.
# NEXT_PUBLIC_ values are baked into the browser code at build time, so they're build arguments.
# Everything else (AUTH0_*, APP_BASE_URL) is read when the server runs.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Our API's public URL, such as https://api.example.com, and tldraw's license key.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TLDRAW_LICENSE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_TLDRAW_LICENSE_KEY=$NEXT_PUBLIC_TLDRAW_LICENSE_KEY \
    NEXT_TELEMETRY_DISABLED=1
# Without it the browser would call localhost, so the build stops here instead.
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "Set NEXT_PUBLIC_API_URL as a build argument." && exit 1)
RUN npm run build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
