# PulseWatch

> Developer-first uptime, incident orchestration, and status page platform.

PulseWatch monitors critical HTTP/HTTPS endpoints on configurable schedules, tracks DNS & network latency, deterministically opens and resolves incidents through an atomic state machine, deduplicates alerts, and generates transparent public status pages.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Setup](#setup)
- [Environment Variables](#environment-variables)
- [Testing](#testing)
- [Deployment](#deployment)
- [Demo](#demo)

---

## Overview

PulseWatch provides developers with reliable, high-resolution observability for their web services and APIs. Built with a modern Node.js and Express backend alongside a responsive React + Vite frontend, the service eliminates false positives and alert fatigue through consecutive threshold verification and concurrency-safe database operations.

---

## Features

- **Scheduled HTTP Health Probes**: Active polling of HTTP/HTTPS endpoints with timeout detection and latency recording.
- **Atomic Incident State Machine**: Prevents race conditions during transitions (`OPERATIONAL` ↔ `DEGRADED` ↔ `DOWN`) using atomic MongoDB updates.
- **Alert Deduplication & Throttling**: Cooldown-based notification dispatch across webhooks and email channels to minimize alert storms.
- **Fail-Fast Environment Validation**: Zod-powered schema validation at server startup ensuring all required credentials exist before accepting traffic.
- **Centralized Error Envelope**: Standardized `{ error: { code, message } }` JSON responses mapped to standard HTTP status codes.
- **Public & Private Status Pages**: Real-time aggregated system health and incident timelines.
- **Graceful Process Shutdown**: Seamless drain of in-flight HTTP requests and clean MongoDB connection termination on `SIGINT`/`SIGTERM`.

---

## Architecture

PulseWatch is structured as a clean monorepo:

```
PulseWatch/
├── backend/                  # Node.js + Express (ES Modules)
│   ├── src/
│   │   ├── config/           # Zod env schema (env.js) & Mongoose lifecycle (db.js)
│   │   ├── controllers/      # Route request/response handlers
│   │   ├── middleware/       # Centralized error handler & request logging
│   │   ├── models/           # Mongoose schemas with atomic indexes
│   │   ├── routes/           # Express routers (e.g., /api/health)
│   │   ├── services/         # Business logic & incident state machine
│   │   ├── utils/            # AppError classes and response envelopes
│   │   ├── app.js            # Express app factory with CORS and middleware
│   │   └── server.js         # HTTP server entrypoint
│   ├── tests/                # Vitest integration and unit tests
│   └── package.json
├── frontend/                 # React + Vite (Vanilla CSS, Dark Mode)
│   ├── src/
│   │   ├── components/       # Status pills, charts, metric cards
│   │   ├── App.jsx           # Live health monitor dashboard
│   │   └── index.css         # Global design tokens and aesthetics
│   └── package.json
├── .env.example              # Canonical environment template
├── eslint.config.js          # ESLint 9 flat configuration
├── .prettierrc               # Prettier code formatting rules
└── package.json              # Monorepo workspaces and unified orchestration
```

---

## Setup

### Prerequisites

- **Node.js**: `v20.x` or higher
- **npm**: `v9.x` or higher
- **MongoDB**: `v6.x` or higher (local instance or MongoDB Atlas URI)

### Installation

1. Clone the repository and install root and workspace dependencies:

   ```bash
   git clone https://github.com/Adit-2006/PulseWatch.git
   cd PulseWatch
   npm install
   ```

2. Configure environment variables:

   ```bash
   cp .env.example backend/.env
   ```

3. Start development servers:
   ```bash
   # Run both backend and frontend concurrently
   npm run dev

   # Or run individually:
   npm run dev:backend   # Express API on port 5000
   npm run dev:frontend  # Vite React App on http://localhost:5173
   ```

---

## Environment Variables

The server validates all environment variables at startup using Zod. If any required variables are missing or misconfigured, the application aborts immediately with a descriptive diagnosis.

| Variable      | Type                                       | Default                 | Description                                   |
| :------------ | :----------------------------------------- | :---------------------- | :-------------------------------------------- |
| `PORT`        | Number                                     | `5000`                  | Port for the Express backend HTTP server      |
| `NODE_ENV`    | Enum (`development`, `production`, `test`) | `development`           | Runtime environment profile                   |
| `MONGODB_URI` | String                                     | _Required_              | MongoDB connection connection string          |
| `CORS_ORIGIN` | String                                     | `http://localhost:5173` | Allowed CORS origins (comma-separated or `*`) |
| `LOG_LEVEL`   | Enum (`debug`, `info`, `warn`, `error`)    | `info`                  | Logging verbosity                             |

---

## Testing

Vitest is configured for unit and integration testing across the backend:

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm --workspace=pulsewatch-backend run test:watch
```

### Linting and Code Formatting

```bash
# Check code style with ESLint
npm run lint

# Format code with Prettier
npm run format
```

---

## Deployment

### Backend

1. Ensure `NODE_ENV=production` and valid `MONGODB_URI` are set in the deployment environment.
2. Start the production server:
   ```bash
   npm --workspace=pulsewatch-backend start
   ```

### Frontend

1. Build static production assets:
   ```bash
   npm run build:frontend
   ```
2. Serve the generated `frontend/dist` directory using any static host (Nginx, Vercel, Netlify, or Express static middleware).

---

## Demo

- **Backend Health Check**: `GET http://localhost:5000/api/health`
  ```json
  {
    "status": "ok",
    "uptime": 124,
    "timestamp": "2026-10-26T13:45:00.000Z",
    "database": {
      "status": "connected"
    }
  }
  ```
- **Consistent Error Response**:
  ```json
  {
    "error": {
      "code": "NOT_FOUND",
      "message": "Route GET /api/nonexistent not found"
    }
  }
  ```
