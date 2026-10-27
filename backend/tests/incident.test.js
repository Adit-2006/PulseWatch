import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-characters-long';
process.env.JWT_EXPIRES_IN = '1h';

import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import Monitor from '../src/models/Monitor.js';
import CheckResult from '../src/models/CheckResult.js';
import Incident from '../src/models/Incident.js';
import {
  processCheckResult,
  handleFailure,
  handleRecovery,
} from '../src/services/incident.service.js';
import { MonitoringWorker } from '../src/worker/engine.js';

let mongoServer;
let app;
let userA;
let tokenA;
let userB;
let tokenB;

/** Sign a JWT for a user ID and return cookie string */
const authCookie = (userId) => {
  const token = jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: '1h' });
  return `token=${token}`;
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  // Ensure partial unique index and monitor indexes are built
  await Incident.init();
  await Monitor.init();
  app = createApp();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }

  userA = await User.create({
    email: 'user-a@pulsewatch.dev',
    passwordHash: '$2b$12$eXampleHashedPasswordForTestA',
  });
  tokenA = authCookie(userA._id);

  userB = await User.create({
    email: 'user-b@pulsewatch.dev',
    passwordHash: '$2b$12$eXampleHashedPasswordForTestB',
  });
  tokenB = authCookie(userB._id);
});

// ===========================================================================
// 1. Threshold Boundaries
// ===========================================================================

describe('Incident Service - Threshold Boundaries', () => {
  it('should immediately create an OPEN incident when failureThreshold is 1 and first DOWN occurs', async () => {
    const monitor = await Monitor.create({
      name: 'Threshold 1 Monitor',
      url: 'https://api.example.com/health',
      userId: userA._id,
      failureThreshold: 1,
      consecutiveFailures: 0,
    });

    const checkResult = {
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: 'Connection refused',
      checkedAt: new Date(),
    };

    const result = await processCheckResult(checkResult);

    expect(result.action).toBe('OPEN_INCIDENT');
    expect(result.incident).toBeDefined();
    expect(result.incident.status).toBe('OPEN');
    expect(result.incident.failureCount).toBe(1);
    expect(result.incident.lastErrorMessage).toBe('Connection refused');
    expect(result.incident.resolvedAt).toBeNull();
    expect(result.incident.duration).toBeNull();

    const updatedMonitor = await Monitor.findById(monitor._id);
    expect(updatedMonitor.consecutiveFailures).toBe(1);

    const incidents = await Incident.find({ monitorId: monitor._id });
    expect(incidents).toHaveLength(1);
  });

  it('should not open an incident until consecutiveFailures reaches failureThreshold = 3', async () => {
    const monitor = await Monitor.create({
      name: 'Threshold 3 Monitor',
      url: 'https://api.example.com/service',
      userId: userA._id,
      failureThreshold: 3,
      consecutiveFailures: 0,
    });

    // Check 1: DOWN -> consecutiveFailures = 1
    const res1 = await processCheckResult({
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: '503 Service Unavailable',
    });
    expect(res1.action).toBe('INCREMENT_FAILURES');
    expect(res1.incident).toBeNull();
    expect(res1.consecutiveFailures).toBe(1);

    let count = await Incident.countDocuments({ monitorId: monitor._id });
    expect(count).toBe(0);

    // Check 2: DOWN -> consecutiveFailures = 2
    const res2 = await processCheckResult({
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: '503 Service Unavailable',
    });
    expect(res2.action).toBe('INCREMENT_FAILURES');
    expect(res2.incident).toBeNull();
    expect(res2.consecutiveFailures).toBe(2);

    count = await Incident.countDocuments({ monitorId: monitor._id });
    expect(count).toBe(0);

    // Check 3: DOWN -> consecutiveFailures = 3 (reaches threshold!)
    const res3 = await processCheckResult({
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: '503 Service Unavailable',
    });
    expect(res3.action).toBe('OPEN_INCIDENT');
    expect(res3.incident).toBeDefined();
    expect(res3.incident.status).toBe('OPEN');
    expect(res3.incident.failureCount).toBe(3);

    count = await Incident.countDocuments({ monitorId: monitor._id });
    expect(count).toBe(1);
  });

  it('should support custom thresholds like failureThreshold = 5', async () => {
    const monitor = await Monitor.create({
      name: 'High Threshold Monitor',
      url: 'https://api.example.com/batch',
      userId: userA._id,
      failureThreshold: 5,
      consecutiveFailures: 0,
    });

    for (let i = 1; i <= 4; i++) {
      const res = await processCheckResult({
        monitorId: monitor._id,
        status: 'DOWN',
        errorMessage: `Timeout on attempt ${i}`,
      });
      expect(res.action).toBe('INCREMENT_FAILURES');
      expect(res.incident).toBeNull();
      expect(res.consecutiveFailures).toBe(i);
    }

    expect(await Incident.countDocuments({ monitorId: monitor._id })).toBe(0);

    // 5th attempt opens the incident
    const res5 = await processCheckResult({
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: 'Timeout on attempt 5',
    });
    expect(res5.action).toBe('OPEN_INCIDENT');
    expect(res5.consecutiveFailures).toBe(5);
    expect(await Incident.countDocuments({ monitorId: monitor._id })).toBe(1);
  });
});

// ===========================================================================
// 2. Flapping (Intermittent Failures & Resets)
// ===========================================================================

describe('Incident Service - Flapping', () => {
  it('should reset consecutiveFailures to 0 on single success before threshold without opening incident', async () => {
    const monitor = await Monitor.create({
      name: 'Flapping Monitor',
      url: 'https://api.example.com/flappy',
      userId: userA._id,
      failureThreshold: 3,
      consecutiveFailures: 0,
    });

    // DOWN 1
    await processCheckResult({ monitorId: monitor._id, status: 'DOWN', errorMessage: 'Error 1' });
    let mon = await Monitor.findById(monitor._id);
    expect(mon.consecutiveFailures).toBe(1);

    // DOWN 2
    await processCheckResult({ monitorId: monitor._id, status: 'DOWN', errorMessage: 'Error 2' });
    mon = await Monitor.findById(monitor._id);
    expect(mon.consecutiveFailures).toBe(2);

    // UP (Recovery before threshold) -> Resets counter
    const recoveryRes = await processCheckResult({ monitorId: monitor._id, status: 'UP' });
    expect(recoveryRes.action).toBe('RESET_COUNTER');
    expect(recoveryRes.incident).toBeNull();

    mon = await Monitor.findById(monitor._id);
    expect(mon.consecutiveFailures).toBe(0);

    // Ensure no incidents were opened
    const incidents = await Incident.find({ monitorId: monitor._id });
    expect(incidents).toHaveLength(0);
  });

  it('should handle repeated flapping (DOWN-UP-DOWN-UP) without opening an incident', async () => {
    const monitor = await Monitor.create({
      name: 'Repeated Flapping Target',
      url: 'https://api.example.com/unstable',
      userId: userA._id,
      failureThreshold: 3,
      consecutiveFailures: 0,
    });

    for (let cycle = 0; cycle < 5; cycle++) {
      // 2 failures
      await processCheckResult({
        monitorId: monitor._id,
        status: 'DOWN',
        errorMessage: 'Unstable err',
      });
      await processCheckResult({
        monitorId: monitor._id,
        status: 'DOWN',
        errorMessage: 'Unstable err',
      });

      let mon = await Monitor.findById(monitor._id);
      expect(mon.consecutiveFailures).toBe(2);

      // 1 recovery
      const rec = await processCheckResult({ monitorId: monitor._id, status: 'UP' });
      expect(rec.action).toBe('RESET_COUNTER');

      mon = await Monitor.findById(monitor._id);
      expect(mon.consecutiveFailures).toBe(0);
    }

    const totalIncidents = await Incident.countDocuments({ monitorId: monitor._id });
    expect(totalIncidents).toBe(0);
  });

  it('should reset counter after a resolved incident and not create a new incident on single failure', async () => {
    const monitor = await Monitor.create({
      name: 'Post-Resolve Flap Target',
      url: 'https://api.example.com/post-resolve',
      userId: userA._id,
      failureThreshold: 2,
      consecutiveFailures: 0,
    });

    // 2 failures -> Incident #1 opened
    await processCheckResult({ monitorId: monitor._id, status: 'DOWN', errorMessage: 'Fail 1' });
    await processCheckResult({ monitorId: monitor._id, status: 'DOWN', errorMessage: 'Fail 2' });
    expect(await Incident.countDocuments({ monitorId: monitor._id, status: 'OPEN' })).toBe(1);

    // UP -> Incident #1 resolved
    await processCheckResult({ monitorId: monitor._id, status: 'UP' });
    expect(await Incident.countDocuments({ monitorId: monitor._id, status: 'OPEN' })).toBe(0);
    expect(await Incident.countDocuments({ monitorId: monitor._id, status: 'RESOLVED' })).toBe(1);

    // Single DOWN after resolution: increments to 1, no new incident
    const downRes = await processCheckResult({
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: 'Minor hiccup',
    });
    expect(downRes.action).toBe('INCREMENT_FAILURES');
    expect(downRes.incident).toBeNull();

    const currentMonitor = await Monitor.findById(monitor._id);
    expect(currentMonitor.consecutiveFailures).toBe(1);

    // UP -> Resets counter back to 0
    await processCheckResult({ monitorId: monitor._id, status: 'UP' });
    const finalMonitor = await Monitor.findById(monitor._id);
    expect(finalMonitor.consecutiveFailures).toBe(0);

    // Still only the 1 original resolved incident
    expect(await Incident.countDocuments({ monitorId: monitor._id })).toBe(1);
  });
});

// ===========================================================================
// 3. Recovery
// ===========================================================================

describe('Incident Service - Recovery', () => {
  it('should resolve an OPEN incident with resolvedAt, duration in ms, and reset consecutiveFailures to 0', async () => {
    const monitor = await Monitor.create({
      name: 'Recovery Test Monitor',
      url: 'https://api.example.com/recovers',
      userId: userA._id,
      failureThreshold: 2,
      consecutiveFailures: 0,
    });

    const startTime = new Date(Date.now() - 15000); // 15 seconds ago
    // Create OPEN incident
    await processCheckResult({
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: 'Gateway Timeout',
      checkedAt: startTime,
    });
    await processCheckResult({
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: 'Gateway Timeout',
      checkedAt: startTime,
    });

    const openIncident = await Incident.findOne({ monitorId: monitor._id, status: 'OPEN' });
    expect(openIncident).toBeTruthy();

    const resolveTime = new Date();
    const recoveryResult = await processCheckResult({
      monitorId: monitor._id,
      status: 'UP',
      checkedAt: resolveTime,
    });

    expect(recoveryResult.action).toBe('RESOLVE_INCIDENT');
    expect(recoveryResult.incident).toBeDefined();
    expect(recoveryResult.incident.status).toBe('RESOLVED');
    expect(new Date(recoveryResult.incident.resolvedAt).getTime()).toBe(resolveTime.getTime());
    expect(recoveryResult.incident.duration).toBeGreaterThanOrEqual(14000);

    // Verify monitor consecutiveFailures reset to 0
    const updatedMonitor = await Monitor.findById(monitor._id);
    expect(updatedMonitor.consecutiveFailures).toBe(0);

    // Verify no OPEN incidents exist
    const remainingOpen = await Incident.find({ monitorId: monitor._id, status: 'OPEN' });
    expect(remainingOpen).toHaveLength(0);
  });

  it('should be safe when multiple UP checks occur consecutively after resolution', async () => {
    const monitor = await Monitor.create({
      name: 'Consecutive UP Monitor',
      url: 'https://api.example.com/healthy-always',
      userId: userA._id,
      failureThreshold: 2,
      consecutiveFailures: 0,
    });

    // 1st UP check: no open incident, resets counter
    const res1 = await processCheckResult({ monitorId: monitor._id, status: 'UP' });
    expect(res1.action).toBe('RESET_COUNTER');
    expect(res1.incident).toBeNull();

    // 2nd UP check
    const res2 = await processCheckResult({ monitorId: monitor._id, status: 'UP' });
    expect(res2.action).toBe('RESET_COUNTER');
    expect(res2.incident).toBeNull();

    const checkMonitor = await Monitor.findById(monitor._id);
    expect(checkMonitor.consecutiveFailures).toBe(0);
  });
});

// ===========================================================================
// 4. Repeated Failures During an Open Incident
// ===========================================================================

describe('Incident Service - Repeated Failures During Open Incident', () => {
  it('should increment monitor consecutiveFailures and incident failureCount without creating duplicate incidents', async () => {
    const monitor = await Monitor.create({
      name: 'Persistent Down Monitor',
      url: 'https://api.example.com/down-hard',
      userId: userA._id,
      failureThreshold: 2,
      consecutiveFailures: 0,
    });

    // Fail 1: count = 1
    await processCheckResult({ monitorId: monitor._id, status: 'DOWN', errorMessage: 'Error 1' });
    // Fail 2: threshold reached, incident opened
    const openRes = await processCheckResult({
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: 'Error 2',
    });
    expect(openRes.action).toBe('OPEN_INCIDENT');
    const incidentId = openRes.incident._id;

    // Fail 3: repeated failure
    const fail3 = await processCheckResult({
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: 'Error 3 - Out of Memory',
    });
    expect(fail3.action).toBe('UPDATE_OPEN_INCIDENT');
    expect(fail3.incident._id.toString()).toBe(incidentId.toString());
    expect(fail3.incident.failureCount).toBe(3);
    expect(fail3.incident.lastErrorMessage).toBe('Error 3 - Out of Memory');

    // Fail 4: repeated failure
    const fail4 = await processCheckResult({
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: 'Error 4 - Deadlock',
    });
    expect(fail4.action).toBe('UPDATE_OPEN_INCIDENT');
    expect(fail4.incident._id.toString()).toBe(incidentId.toString());
    expect(fail4.incident.failureCount).toBe(4);
    expect(fail4.incident.lastErrorMessage).toBe('Error 4 - Deadlock');

    // Verify monitor's consecutiveFailures is 4
    const updatedMonitor = await Monitor.findById(monitor._id);
    expect(updatedMonitor.consecutiveFailures).toBe(4);

    // Verify ONLY ONE incident exists in the entire collection
    const incidents = await Incident.find({ monitorId: monitor._id });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].status).toBe('OPEN');
    expect(incidents[0].failureCount).toBe(4);
  });
});

// ===========================================================================
// 5. Duplicate Processing & Concurrency Idempotency
// ===========================================================================

describe('Incident Service - Duplicate Processing & Concurrency Idempotency', () => {
  it('should gracefully handle 11000 duplicate key error and maintain exactly 1 open incident under concurrent execution', async () => {
    const monitor = await Monitor.create({
      name: 'Concurrent Race Monitor',
      url: 'https://api.example.com/race',
      userId: userA._id,
      failureThreshold: 1,
      consecutiveFailures: 0,
    });

    // Run 5 concurrent check failures simultaneously
    const checkPromises = Array.from({ length: 5 }).map((_, idx) =>
      processCheckResult({
        monitorId: monitor._id,
        status: 'DOWN',
        errorMessage: `Concurrent error probe ${idx}`,
      })
    );

    const results = await Promise.all(checkPromises);

    // All promises must resolve cleanly without uncaught 11000 errors
    expect(results).toHaveLength(5);

    // Exactly ONE OPEN incident must exist in database
    const openIncidents = await Incident.find({ monitorId: monitor._id, status: 'OPEN' });
    expect(openIncidents).toHaveLength(1);
    expect(openIncidents[0].status).toBe('OPEN');
  });

  it('should atomically resolve incident without resolving twice under concurrent UP calls', async () => {
    const monitor = await Monitor.create({
      name: 'Concurrent Recovery Monitor',
      url: 'https://api.example.com/race-recover',
      userId: userA._id,
      failureThreshold: 1,
      consecutiveFailures: 0,
    });

    // Open an incident first
    await processCheckResult({
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: 'Fatal Error',
    });

    const openIncident = await Incident.findOne({ monitorId: monitor._id, status: 'OPEN' });
    expect(openIncident).toBeTruthy();

    // Fire 3 concurrent UP recoveries
    const recoveries = await Promise.all([
      processCheckResult({ monitorId: monitor._id, status: 'UP' }),
      processCheckResult({ monitorId: monitor._id, status: 'UP' }),
      processCheckResult({ monitorId: monitor._id, status: 'UP' }),
    ]);

    // Exactly one call resolves it
    const resolvedActions = recoveries.filter((r) => r.action === 'RESOLVE_INCIDENT');
    expect(resolvedActions).toHaveLength(1);

    // All open incidents are gone, exactly 1 resolved incident exists
    const openAfter = await Incident.find({ monitorId: monitor._id, status: 'OPEN' });
    expect(openAfter).toHaveLength(0);

    const resolvedAfter = await Incident.find({ monitorId: monitor._id, status: 'RESOLVED' });
    expect(resolvedAfter).toHaveLength(1);
  });

  it('should accept different parameter calling conventions (document, plain object, two args)', async () => {
    const monitor = await Monitor.create({
      name: 'Calling Convention Monitor',
      url: 'https://api.example.com/args',
      userId: userA._id,
      failureThreshold: 1,
      consecutiveFailures: 0,
    });

    // 1. Two arguments: (monitorId, checkResult)
    const res1 = await processCheckResult(monitor._id, {
      status: 'DOWN',
      errorMessage: 'Probe 1',
    });
    expect(res1.action).toBe('OPEN_INCIDENT');

    // 2. Two arguments: (monitorDoc, checkResult)
    const res2 = await processCheckResult(monitor, {
      status: 'UP',
    });
    expect(res2.action).toBe('RESOLVE_INCIDENT');

    // 3. Single argument CheckResult document
    const checkDoc = await CheckResult.create({
      monitorId: monitor._id,
      status: 'DOWN',
      statusCode: 500,
      responseTimeMs: 350,
      errorMessage: 'Probe 3',
      checkedAt: new Date(),
    });
    const res3 = await processCheckResult(checkDoc);
    expect(res3.action).toBe('OPEN_INCIDENT');
  });

  it('should support direct calls to handleFailure and handleRecovery', async () => {
    const monitor = await Monitor.create({
      name: 'Direct Methods Monitor',
      url: 'https://api.example.com/direct',
      userId: userA._id,
      failureThreshold: 1,
      consecutiveFailures: 0,
    });

    // Direct handleFailure call
    const failRes = await handleFailure(monitor._id, {
      status: 'DOWN',
      errorMessage: 'Direct failure error',
    });
    expect(failRes.action).toBe('OPEN_INCIDENT');
    expect(failRes.incident.status).toBe('OPEN');

    // Direct handleRecovery call
    const recoverRes = await handleRecovery(monitor._id, {
      status: 'UP',
      checkedAt: new Date(),
    });
    expect(recoverRes.action).toBe('RESOLVE_INCIDENT');
    expect(recoverRes.incident.status).toBe('RESOLVED');
  });
});

// ===========================================================================
// 6. Worker Check Runner Integration
// ===========================================================================

describe('MonitoringWorker Check Runner Incident Integration', () => {
  it('should automatically open and resolve incidents through MonitoringWorker.processMonitor', async () => {
    const monitor = await Monitor.create({
      name: 'Worker Integration Target',
      url: 'https://api.example.com/worker-integrated',
      userId: userA._id,
      intervalSeconds: 60,
      failureThreshold: 2,
      consecutiveFailures: 1, // Already 1 failure
    });

    // Mock fetch returning HTTP 500
    const failFetch = async () => ({
      status: 500,
      headers: new Headers(),
    });

    const worker = new MonitoringWorker({ fetchFn: failFetch });

    // Process failing check -> reaches threshold of 2 -> opens incident
    await worker.processMonitor(monitor);

    const updatedMonitor = await Monitor.findById(monitor._id);
    expect(updatedMonitor.consecutiveFailures).toBe(2);
    expect(updatedMonitor.lockedUntil).toBeNull();

    const openIncident = await Incident.findOne({ monitorId: monitor._id, status: 'OPEN' });
    expect(openIncident).toBeTruthy();
    expect(openIncident.status).toBe('OPEN');
    expect(openIncident.failureCount).toBe(2);

    // Now mock fetch returning HTTP 200 (Recovery)
    const successFetch = async () => ({
      status: 200,
      headers: new Headers(),
    });

    const successWorker = new MonitoringWorker({ fetchFn: successFetch });
    await successWorker.processMonitor(updatedMonitor);

    const recoveredMonitor = await Monitor.findById(monitor._id);
    expect(recoveredMonitor.consecutiveFailures).toBe(0);
    expect(recoveredMonitor.lockedUntil).toBeNull();

    const resolvedIncident = await Incident.findById(openIncident._id);
    expect(resolvedIncident.status).toBe('RESOLVED');
    expect(resolvedIncident.resolvedAt).toBeInstanceOf(Date);
    expect(resolvedIncident.duration).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// 7. GET /api/monitors/:id/incidents API with Pagination
// ===========================================================================

describe('GET /api/monitors/:id/incidents', () => {
  let testMonitor;

  beforeEach(async () => {
    testMonitor = await Monitor.create({
      name: 'API Incident Target',
      url: 'https://api.example.com/status',
      userId: userA._id,
      intervalSeconds: 60,
    });
  });

  it('should return 401 when request is unauthenticated', async () => {
    const res = await request(app).get(`/api/monitors/${testMonitor._id}/incidents`);
    expect(res.status).toBe(401);
  });

  it('should return 400 for an invalid ObjectId format', async () => {
    const res = await request(app)
      .get('/api/monitors/not-a-valid-id/incidents')
      .set('Cookie', tokenA);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
  });

  it('should return 404 if the monitor does not exist', async () => {
    const nonExistentId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/monitors/${nonExistentId}/incidents`)
      .set('Cookie', tokenA);

    expect(res.status).toBe(404);
  });

  it('should return 404 if the monitor belongs to another user (tenant isolation)', async () => {
    const res = await request(app)
      .get(`/api/monitors/${testMonitor._id}/incidents`)
      .set('Cookie', tokenB); // userB attempting to access userA's monitor

    expect(res.status).toBe(404);
  });

  it('should return an empty list with pagination when no incidents exist', async () => {
    const res = await request(app)
      .get(`/api/monitors/${testMonitor._id}/incidents`)
      .set('Cookie', tokenA);

    expect(res.status).toBe(200);
    expect(res.body.incidents).toEqual([]);
    expect(res.body.pagination).toEqual({
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
  });

  it('should return paginated incidents sorted in reverse chronological order', async () => {
    // Seed 15 incidents for userA's monitor
    const now = Date.now();
    for (let i = 1; i <= 15; i++) {
      await Incident.create({
        monitorId: testMonitor._id,
        status: 'RESOLVED',
        startedAt: new Date(now - (20 - i) * 60000),
        resolvedAt: new Date(now - (20 - i) * 60000 + 30000),
        duration: 30000,
        failureCount: 3,
        lastErrorMessage: `Incident probe #${i}`,
      });
    }

    // Page 1 (default limit: 10)
    const page1Res = await request(app)
      .get(`/api/monitors/${testMonitor._id}/incidents?page=1&limit=10`)
      .set('Cookie', tokenA);

    expect(page1Res.status).toBe(200);
    expect(page1Res.body.incidents).toHaveLength(10);
    expect(page1Res.body.pagination).toEqual({
      total: 15,
      page: 1,
      limit: 10,
      totalPages: 2,
    });
    // Newest incident first (#15)
    expect(page1Res.body.incidents[0].lastErrorMessage).toBe('Incident probe #15');

    // Page 2 (remaining 5)
    const page2Res = await request(app)
      .get(`/api/monitors/${testMonitor._id}/incidents?page=2&limit=10`)
      .set('Cookie', tokenA);

    expect(page2Res.status).toBe(200);
    expect(page2Res.body.incidents).toHaveLength(5);
    expect(page2Res.body.pagination).toEqual({
      total: 15,
      page: 2,
      limit: 10,
      totalPages: 2,
    });
    // Oldest on page 2 is #1
    expect(page2Res.body.incidents[4].lastErrorMessage).toBe('Incident probe #1');
  });

  it('should allow filtering incidents by status (OPEN vs RESOLVED)', async () => {
    // 2 resolved incidents and 1 open incident
    await Incident.create({
      monitorId: testMonitor._id,
      status: 'RESOLVED',
      startedAt: new Date(Date.now() - 3600000),
      resolvedAt: new Date(Date.now() - 3000000),
      duration: 600000,
    });
    await Incident.create({
      monitorId: testMonitor._id,
      status: 'RESOLVED',
      startedAt: new Date(Date.now() - 1800000),
      resolvedAt: new Date(Date.now() - 1200000),
      duration: 600000,
    });
    await Incident.create({
      monitorId: testMonitor._id,
      status: 'OPEN',
      startedAt: new Date(),
    });

    // Query status=OPEN
    const openRes = await request(app)
      .get(`/api/monitors/${testMonitor._id}/incidents?status=OPEN`)
      .set('Cookie', tokenA);

    expect(openRes.status).toBe(200);
    expect(openRes.body.incidents).toHaveLength(1);
    expect(openRes.body.incidents[0].status).toBe('OPEN');
    expect(openRes.body.pagination.total).toBe(1);

    // Query status=RESOLVED
    const resolvedRes = await request(app)
      .get(`/api/monitors/${testMonitor._id}/incidents?status=RESOLVED`)
      .set('Cookie', tokenA);

    expect(resolvedRes.status).toBe(200);
    expect(resolvedRes.body.incidents).toHaveLength(2);
    expect(resolvedRes.body.incidents.every((inc) => inc.status === 'RESOLVED')).toBe(true);
    expect(resolvedRes.body.pagination.total).toBe(2);
  });
});
