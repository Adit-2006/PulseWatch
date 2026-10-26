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
│   │   │   ├── User.js       # Email + passwordHash
│   │   │   ├── Monitor.js    # URL monitoring configuration & scheduling
│   │   │   ├── CheckResult.js# Time-series health check results (TTL-indexed)
│   │   │   ├── Incident.js   # State machine with partial unique constraint
│   │   │   ├── AlertLog.js   # Notification dispatch audit trail
│   │   │   └── index.js      # Barrel export
│   │   ├── routes/           # Express routers (e.g., /api/health)
│   │   ├── scripts/          # Utility scripts
│   │   │   └── seed.js       # Database seeding with demo data
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

## Database Setup

PulseWatch uses **MongoDB** for persistence. You can run it locally or connect to a hosted Atlas cluster.

### Option A: Local MongoDB

1. **Install MongoDB Community Edition** (v6.x or higher):

   - **macOS** (Homebrew):
     ```bash
     brew tap mongodb/brew
     brew install mongodb-community@7.0
     brew services start mongodb-community@7.0
     ```
   - **Ubuntu/Debian**:
     ```bash
     # Import the MongoDB public GPG key and add the repository
     # See https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/
     sudo apt-get install -y mongodb-org
     sudo systemctl start mongod
     sudo systemctl enable mongod
     ```
   - **Windows**: Download from [mongodb.com/try/download/community](https://www.mongodb.com/try/download/community) and follow the MSI installer.

2. **Verify it's running**:

   ```bash
   mongosh --eval "db.runCommand({ ping: 1 })"
   ```

3. **Set the connection string** in `backend/.env`:
   ```env
   MONGODB_URI=mongodb://localhost:27017/pulsewatch
   ```

### Option B: MongoDB Atlas (Cloud)

1. **Create a free cluster** at [cloud.mongodb.com](https://cloud.mongodb.com/).
2. Under **Database Access**, create a database user with read/write privileges.
3. Under **Network Access**, add your IP address (or `0.0.0.0/0` for development).
4. Click **Connect → Drivers** and copy the connection string.
5. **Set the connection string** in `backend/.env`:
   ```env
   MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/pulsewatch?retryWrites=true&w=majority
   ```

### Data Retention (TTL)

The `CheckResult` collection uses a MongoDB **TTL index** on the `checkedAt` field. Documents are automatically deleted after the retention period expires. Control this via the `RETENTION_DAYS` environment variable:

```env
RETENTION_DAYS=30   # Default: 30 days
```

> **Note**: Changing `RETENTION_DAYS` after the index is created requires dropping and re-creating the TTL index. MongoDB does not dynamically update `expireAfterSeconds` on schema changes. To force re-creation, use `mongosh`:
>
> ```js
> db.checkresults.dropIndex({ checkedAt: 1 });
> // Then restart the app — Mongoose will recreate the index automatically.
> ```

### Seeding the Database

A seed script populates the database with realistic demo data:

```bash
# From the project root
npm run seed

# Or from the backend directory
cd backend && npm run seed
```

This creates:

- **1 demo user** — `demo@pulsewatch.dev` / `PulseWatch2026!`
- **5 monitors** — simulating a marketing site, API, auth service, webhook endpoint, and CDN probe
- **~24 hours of check results** — with realistic response times and a ~3% failure rate
- **1 resolved incident** — with 4 alert log entries (email + webhook, open + resolve)

The script is **idempotent** — it clears all existing data before re-seeding.

### Database Schema & Indexes

| Collection     | Key Indexes                                                                                              |
| :------------- | :------------------------------------------------------------------------------------------------------- |
| `users`        | Unique on `email`                                                                                        |
| `monitors`     | Compound `(userId, createdAt)` · Scheduler `(nextCheckAt)` · Unique sparse on `publicSlug`               |
| `checkresults` | Compound `(monitorId, checkedAt desc)` · TTL on `checkedAt`                                              |
| `incidents`    | **Partial unique** on `(monitorId)` where `status = "OPEN"` — enforces one open incident per monitor     |
| `alertlogs`    | Compound `(incidentId, sentAt desc)`                                                                     |

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

3. Set up the database (see [Database Setup](#database-setup) above).

4. Seed demo data (optional):

   ```bash
   npm run seed
   ```

5. Start development servers:
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

| Variable         | Type                                       | Default                 | Description                                         |
| :--------------- | :----------------------------------------- | :---------------------- | :-------------------------------------------------- |
| `PORT`           | Number                                     | `5000`                  | Port for the Express backend HTTP server             |
| `NODE_ENV`       | Enum (`development`, `production`, `test`) | `development`           | Runtime environment profile                          |
| `MONGODB_URI`    | String                                     | _Required_              | MongoDB connection string                            |
| `CORS_ORIGIN`    | String                                     | `http://localhost:5173` | Allowed CORS origins (comma-separated or `*`)        |
| `LOG_LEVEL`      | Enum (`debug`, `info`, `warn`, `error`)    | `info`                  | Logging verbosity                                    |
| `RETENTION_DAYS` | Number                                     | `30`                    | Days to retain check results before TTL auto-deletes |

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
- **Seed Demo Data**:
  ```bash
  npm run seed
  # 🌱 Connecting to MongoDB...
  # ✅ Connected.
  # 👤 Demo user created: demo@pulsewatch.dev
  # 📡 Monitor created: PulseWatch Marketing Site
  # ...
  # 🎉 Seed completed successfully!
  ```

