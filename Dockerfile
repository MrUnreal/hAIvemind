# ─── Stage 1: Build the Vue client ───────────────────────────────────────────
FROM node:20-alpine AS client-build

WORKDIR /build/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci --ignore-scripts

COPY client/ ./
RUN npx vite build

# ─── Stage 2: Production server ─────────────────────────────────────────────
FROM node:20-alpine

LABEL org.opencontainers.image.title="hAIvemind"
LABEL org.opencontainers.image.description="Massively parallel AI coding orchestrator"
LABEL org.opencontainers.image.source="https://github.com/MrUnreal/hAIvemind"

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# Copy server, shared, templates, CLI
COPY server/ server/
COPY shared/ shared/
COPY templates/ templates/
COPY bin/ bin/

# Copy built client from stage 1
COPY --from=client-build /build/client/dist client/dist/

# Create workspace directories
RUN mkdir -p .haivemind-workspace .haivemind projects

# Non-root user for security
RUN addgroup -S haivemind && adduser -S haivemind -G haivemind
RUN chown -R haivemind:haivemind /app
USER haivemind

# Default env vars
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/projects || exit 1

CMD ["node", "server/index.js"]
