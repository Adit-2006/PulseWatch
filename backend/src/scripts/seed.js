/**
 * Seed Script — Populates the database with a demo user, sample monitors,
 * realistic historical check results, and a resolved past incident.
 *
 * Usage:
 *   node backend/src/scripts/seed.js          # uses MONGODB_URI from .env
 *   MONGODB_URI=<uri> node backend/src/scripts/seed.js
 *
 * The script is idempotent — it drops existing data before re-seeding.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve dotenv relative to the backend directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ---------------------------------------------------------------------------
// Import models — ensure all schemas and indexes are registered
// ---------------------------------------------------------------------------
import User from '../models/User.js';
import Monitor from '../models/Monitor.js';
import CheckResult from '../models/CheckResult.js';
import Incident from '../models/Incident.js';
import AlertLog from '../models/AlertLog.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a random integer between min (inclusive) and max (inclusive). */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Generate a slug-safe random hex string. */
const randomSlug = () => crypto.randomBytes(6).toString('hex');

/** Create a Date offset by `ms` milliseconds from `base`. */
const offsetDate = (base, ms) => new Date(base.getTime() + ms);

// ---------------------------------------------------------------------------
// Seed Data Definitions
// ---------------------------------------------------------------------------

const DEMO_USER = {
  email: 'demo@pulsewatch.dev',
  password: 'PulseWatch2026!',
};

const MONITOR_TEMPLATES = [
  {
    name: 'PulseWatch Marketing Site',
    url: 'https://pulsewatch.dev',
    method: 'GET',
    intervalSeconds: 60,
    timeoutMs: 5000,
    expectedStatus: 200,
    failureThreshold: 3,
    isPublic: true,
  },
  {
    name: 'REST API Health',
    url: 'https://api.pulsewatch.dev/health',
    method: 'GET',
    intervalSeconds: 30,
    timeoutMs: 3000,
    expectedStatus: 200,
    failureThreshold: 3,
    isPublic: true,
  },
  {
    name: 'User Auth Service',
    url: 'https://auth.pulsewatch.dev/status',
    method: 'GET',
    intervalSeconds: 45,
    timeoutMs: 4000,
    expectedStatus: 200,
    failureThreshold: 5,
    isPublic: false,
  },
  {
    name: 'Webhook Delivery Endpoint',
    url: 'https://hooks.pulsewatch.dev/ping',
    method: 'POST',
    intervalSeconds: 120,
    timeoutMs: 8000,
    expectedStatus: 202,
    failureThreshold: 4,
    isPublic: false,
  },
  {
    name: 'CDN Edge Probe',
    url: 'https://cdn.pulsewatch.dev/healthz',
    method: 'HEAD',
    intervalSeconds: 30,
    timeoutMs: 2000,
    expectedStatus: 200,
    failureThreshold: 2,
    isPublic: true,
  },
];

// ---------------------------------------------------------------------------
// Generate realistic check results for a monitor over the last 24 hours
// ---------------------------------------------------------------------------

function generateCheckResults(monitorId, monitor, now) {
  const results = [];
  const intervalMs = monitor.intervalSeconds * 1000;
  const totalChecks = Math.floor((24 * 60 * 60 * 1000) / intervalMs);
  const startTime = offsetDate(now, -(totalChecks * intervalMs));

  for (let i = 0; i < totalChecks; i++) {
    const checkedAt = offsetDate(startTime, i * intervalMs);

    // ~3% chance of a DOWN check to simulate real-world flakiness
    const isDown = Math.random() < 0.03;

    results.push({
      monitorId,
      status: isDown ? 'DOWN' : 'UP',
      statusCode: isDown ? (Math.random() < 0.5 ? 500 : 0) : monitor.expectedStatus,
      responseTimeMs: isDown ? null : randInt(40, 650),
      errorMessage: isDown
        ? ['ETIMEDOUT', 'ECONNREFUSED', 'HTTP 500 Internal Server Error'][randInt(0, 2)]
        : null,
      checkedAt,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Generate a realistic past incident (already resolved)
// ---------------------------------------------------------------------------

function generatePastIncident(monitorId, monitor, now) {
  // Incident happened ~6 hours ago, lasted ~12 minutes
  const startedAt = offsetDate(now, -(6 * 60 * 60 * 1000));
  const resolvedAt = offsetDate(startedAt, 12 * 60 * 1000);

  const incident = {
    monitorId,
    status: 'RESOLVED',
    startedAt,
    resolvedAt,
    failureCount: monitor.failureThreshold,
    lastErrorMessage: 'HTTP 503 Service Unavailable — upstream gateway timed out',
  };

  const alertLogs = [
    {
      type: 'OPENED',
      channel: 'email',
      status: 'SENT',
      errorMessage: null,
      sentAt: offsetDate(startedAt, 2000),
    },
    {
      type: 'OPENED',
      channel: 'webhook',
      status: 'SENT',
      errorMessage: null,
      sentAt: offsetDate(startedAt, 2500),
    },
    {
      type: 'RESOLVED',
      channel: 'email',
      status: 'SENT',
      errorMessage: null,
      sentAt: offsetDate(resolvedAt, 1500),
    },
    {
      type: 'RESOLVED',
      channel: 'webhook',
      status: 'FAILED',
      errorMessage: 'Webhook endpoint returned HTTP 502',
      sentAt: offsetDate(resolvedAt, 1800),
    },
  ];

  return { incident, alertLogs };
}

// ---------------------------------------------------------------------------
// Main Seed Logic
// ---------------------------------------------------------------------------

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not set. Provide it in backend/.env or as an env variable.');
    process.exit(1);
  }

  console.log('🌱 Connecting to MongoDB...');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log('✅ Connected.\n');

  // ------ Drop existing data ------
  console.log('🗑️  Clearing existing data...');
  await Promise.all([
    User.deleteMany({}),
    Monitor.deleteMany({}),
    CheckResult.deleteMany({}),
    Incident.deleteMany({}),
    AlertLog.deleteMany({}),
  ]);

  // ------ Create demo user ------
  const passwordHash = await bcrypt.hash(DEMO_USER.password, 12);
  const user = await User.create({
    email: DEMO_USER.email,
    passwordHash,
  });
  console.log(`👤 Demo user created: ${user.email}`);
  console.log(`   Password: ${DEMO_USER.password}\n`);

  // ------ Create monitors ------
  const now = new Date();
  const monitors = [];

  for (const template of MONITOR_TEMPLATES) {
    const monitor = await Monitor.create({
      ...template,
      userId: user._id,
      publicSlug: template.isPublic
        ? `${template.name.toLowerCase().replace(/\s+/g, '-')}-${randomSlug()}`
        : undefined,
      consecutiveFailures: 0,
      nextCheckAt: offsetDate(now, randInt(5000, 30000)),
    });
    monitors.push(monitor);
    console.log(`📡 Monitor created: ${monitor.name} (${monitor.url})`);
  }

  // ------ Generate check results ------
  console.log('\n⏳ Generating historical check results...');
  let totalChecks = 0;

  for (const monitor of monitors) {
    const results = generateCheckResults(monitor._id, monitor, now);
    if (results.length > 0) {
      await CheckResult.insertMany(results, { ordered: false });
      totalChecks += results.length;
    }
  }
  console.log(
    `✅ Inserted ${totalChecks.toLocaleString()} check results across ${monitors.length} monitors.`
  );

  // ------ Generate a past incident on the first monitor ------
  console.log('\n🚨 Creating past incident...');
  const targetMonitor = monitors[0];
  const { incident: incidentData, alertLogs: alertLogData } = generatePastIncident(
    targetMonitor._id,
    targetMonitor,
    now
  );

  const incident = await Incident.create(incidentData);
  console.log(
    `   Incident on "${targetMonitor.name}" — ` +
      `${incident.status} (${incident.startedAt.toISOString()} → ${incident.resolvedAt.toISOString()})`
  );

  const alertLogs = alertLogData.map((log) => ({ ...log, incidentId: incident._id }));
  await AlertLog.insertMany(alertLogs);
  console.log(`   📬 ${alertLogs.length} alert logs recorded.\n`);

  // ------ Done ------
  console.log('━'.repeat(50));
  console.log('🎉 Seed completed successfully!');
  console.log(`   • 1 demo user (${DEMO_USER.email})`);
  console.log(`   • ${monitors.length} monitors`);
  console.log(`   • ${totalChecks.toLocaleString()} check results`);
  console.log(`   • 1 resolved incident with ${alertLogs.length} alert logs`);
  console.log('━'.repeat(50));

  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
