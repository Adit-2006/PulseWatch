# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

# Install security updates
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

# Install dependencies (utilizing Docker layer caching)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci --omit=dev

# Copy application source code
COPY backend ./backend

# Set production environment variables
ENV NODE_ENV=production \
    PORT=5000 \
    START_WORKER_IN_PROCESS=true

# Create unprivileged user for security
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

CMD ["node", "backend/src/server.js"]
