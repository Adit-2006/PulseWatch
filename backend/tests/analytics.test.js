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
  calculateUptimePercentage,
  getMonitorStats,
  getMonitorResponseTimes,
  getPublicStatusBySlug,
} from '../src/services/analytics.service.js';

let mongoServer;
let app;
let testUser;
let testToken;
let otherUser;
let otherToken;

const authCookie = (userId) => {
  const token = jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: '1h' });
  return `token=${token}`;
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await CheckResult.init();
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

  testUser = await User.create({
    email: 'analytics-owner@pulsewatch.dev',
    passwordHash: '$2b$12$eXampleHashedPasswordForAnalytics',
  });
  testToken = authCookie(testUser._id);

  otherUser = await User.create({
    email: 'analytics-other@pulsewatch.dev',
    passwordHash: '$2b$12$eXampleHashedPasswordForOtherUser',
  });
  otherToken = authCookie(otherUser._id);
});

// ===========================================================================
// 1. Uptime Calculation Logic (Including Periods with No Data)
// ===========================================================================

describe('Uptime Calculation Helper', () => {
  it('should return 100% uptime when there are no checks (period with no data)', () => {
    expect(calculateUptimePercentage(0, 0)).toBe(100);
    expect(calculateUptimePercentage(0, undefined)).toBe(100);
  });

  it('should calculate accurate uptime percentage for mixed checks', () => {
    // 9 out of 10 checks UP -> 90%
    expect(calculateUptimePercentage(9, 10)).toBe(90);

    // 99 out of 100 checks UP -> 99%
    expect(calculateUptimePercentage(99, 100)).toBe(99);

    // 199 out of 200 checks UP -> 99.5%
    expect(calculateUptimePercentage(199, 200)).toBe(99.5);

    // 0 out of 5 checks UP -> 0%
    expect(calculateUptimePercentage(0, 5)).toBe(0);

    // 33 out of 34 -> 97.06%
    expect(calculateUptimePercentage(33, 34)).toBe(97.06);
  });
});

// ===========================================================================
// 2. GET /api/monitors/:id/stats Endpoint & Aggregation Pipeline
// ===========================================================================

describe('GET /api/monitors/:id/stats', () => {
  it('should return 100% uptime and null response times for a monitor with no data', async () => {
    const monitor = await Monitor.create({
      name: 'Fresh Monitor Without Checks',
      url: 'https://api.example.com/fresh',
      userId: testUser._id,
    });

    const res = await request(app)
      .get(`/api/monitors/${monitor._id}/stats`)
      .set('Cookie', testToken);

    expect(res.status).toBe(200);
    expect(res.body.uptime).toEqual({
      '24h': 100,
      '7d': 100,
      '30d': 100,
    });
    expect(res.body.avgResponseTimeMs).toBeNull();
    expect(res.body.p95ResponseTimeMs).toBeNull();
    expect(res.body.totalIncidents).toBe(0);
  });

  it('should calculate uptime for 24h, 7d, 30d, avg and p95 response times accurately', async () => {
    const monitor = await Monitor.create({
      name: 'Stats Test Target',
      url: 'https://api.example.com/stats-test',
      userId: testUser._id,
    });

    const now = Date.now();
    const checks = [];

    // 1. Within last 24h: 9 UP checks (100ms each) and 1 DOWN check (500ms)
    // 24h uptime = 9/10 = 90%
    for (let i = 1; i <= 9; i++) {
      checks.push({
        monitorId: monitor._id,
        status: 'UP',
        statusCode: 200,
        responseTimeMs: 100 + i * 10, // 110, 120, ..., 190
        checkedAt: new Date(now - i * 60 * 60 * 1000), // within 10 hours
      });
    }
    checks.push({
      monitorId: monitor._id,
      status: 'DOWN',
      statusCode: 500,
      responseTimeMs: 500,
      checkedAt: new Date(now - 30 * 60 * 1000), // 30 mins ago
    });

    // 2. Between 24h and 7d: 10 UP checks (all UP)
    for (let i = 2; i <= 5; i++) {
      checks.push({
        monitorId: monitor._id,
        status: 'UP',
        statusCode: 200,
        responseTimeMs: 150,
        checkedAt: new Date(now - i * 24 * 60 * 60 * 1000),
      });
    }

    // 3. Between 7d and 30d: 5 UP checks
    for (let i = 10; i <= 14; i++) {
      checks.push({
        monitorId: monitor._id,
        status: 'UP',
        statusCode: 200,
        responseTimeMs: 160,
        checkedAt: new Date(now - i * 24 * 60 * 60 * 1000),
      });
    }

    await CheckResult.insertMany(checks);

    // Create 2 incidents for this monitor
    await Incident.create([
      {
        monitorId: monitor._id,
        status: 'RESOLVED',
        failureCount: 3,
        startedAt: new Date(now - 86400000),
      },
      {
        monitorId: monitor._id,
        status: 'RESOLVED',
        failureCount: 2,
        startedAt: new Date(now - 172800000),
      },
    ]);

    const res = await request(app)
      .get(`/api/monitors/${monitor._id}/stats`)
      .set('Cookie', testToken);

    expect(res.status).toBe(200);

    // 24h: 9 up / 10 total = 90%
    expect(res.body.uptime['24h']).toBe(90);

    // 7d: 13 up / 14 total = 92.86%
    expect(res.body.uptime['7d']).toBe(92.86);

    // 30d: 18 up / 19 total = 94.74%
    expect(res.body.uptime['30d']).toBe(94.74);

    expect(res.body.avgResponseTimeMs).toBeGreaterThan(0);
    expect(res.body.p95ResponseTimeMs).toBeGreaterThan(0);
    expect(res.body.totalIncidents).toBe(2);
  });

  it('should enforce authentication and tenant isolation on stats endpoint', async () => {
    const monitor = await Monitor.create({
      name: 'Tenant Isolation Monitor',
      url: 'https://api.example.com/isolated',
      userId: testUser._id,
    });

    // 401 without auth
    const unauthRes = await request(app).get(`/api/monitors/${monitor._id}/stats`);
    expect(unauthRes.status).toBe(401);

    // 404 for other user
    const otherRes = await request(app)
      .get(`/api/monitors/${monitor._id}/stats`)
      .set('Cookie', otherToken);
    expect(otherRes.status).toBe(404);
  });
});

// ===========================================================================
// 3. GET /api/monitors/:id/response-times Time-Bucketed Series
// ===========================================================================

describe('GET /api/monitors/:id/response-times', () => {
  it('should return time-bucketed series for chart rendering using MongoDB aggregation', async () => {
    const monitor = await Monitor.create({
      name: 'Response Times Monitor',
      url: 'https://api.example.com/rt',
      userId: testUser._id,
    });

    const now = Date.now();
    const checks = [];

    // Seed 20 checks over the last 12 hours
    for (let h = 0; h < 12; h++) {
      checks.push(
        {
          monitorId: monitor._id,
          status: 'UP',
          responseTimeMs: 120 + h * 5,
          checkedAt: new Date(now - h * 60 * 60 * 1000 + 10000),
        },
        {
          monitorId: monitor._id,
          status: 'UP',
          responseTimeMs: 180 + h * 5,
          checkedAt: new Date(now - h * 60 * 60 * 1000 + 30000),
        }
      );
    }

    await CheckResult.insertMany(checks);

    // 1. Default range: 24h (1-hour buckets)
    const res24h = await request(app)
      .get(`/api/monitors/${monitor._id}/response-times?range=24h`)
      .set('Cookie', testToken);

    expect(res24h.status).toBe(200);
    expect(res24h.body.range).toBe('24h');
    expect(res24h.body.bucketUnit).toBe('hour');
    expect(res24h.body.binSize).toBe(1);
    expect(Array.isArray(res24h.body.series)).toBe(true);
    expect(res24h.body.series.length).toBeGreaterThan(0);

    const firstPoint = res24h.body.series[0];
    expect(firstPoint).toHaveProperty('timestamp');
    expect(firstPoint).toHaveProperty('avgResponseTimeMs');
    expect(firstPoint).toHaveProperty('p95ResponseTimeMs');
    expect(firstPoint).toHaveProperty('minResponseTimeMs');
    expect(firstPoint).toHaveProperty('maxResponseTimeMs');
    expect(firstPoint).toHaveProperty('count');

    // 2. 7d range (6-hour buckets)
    const res7d = await request(app)
      .get(`/api/monitors/${monitor._id}/response-times?range=7d`)
      .set('Cookie', testToken);

    expect(res7d.status).toBe(200);
    expect(res7d.body.range).toBe('7d');
    expect(res7d.body.bucketUnit).toBe('hour');
    expect(res7d.body.binSize).toBe(6);

    // 3. 30d range (1-day buckets)
    const res30d = await request(app)
      .get(`/api/monitors/${monitor._id}/response-times?range=30d`)
      .set('Cookie', testToken);

    expect(res30d.status).toBe(200);
    expect(res30d.body.range).toBe('30d');
    expect(res30d.body.bucketUnit).toBe('day');
  });

  it('should return empty series when no response time data exists within the window', async () => {
    const monitor = await Monitor.create({
      name: 'Empty Chart Monitor',
      url: 'https://api.example.com/empty-chart',
      userId: testUser._id,
    });

    const res = await request(app)
      .get(`/api/monitors/${monitor._id}/response-times?range=24h`)
      .set('Cookie', testToken);

    expect(res.status).toBe(200);
    expect(res.body.series).toEqual([]);
  });
});

// ===========================================================================
// 4. Public Status Page (GET /api/status/:publicSlug) & Toggle Management
// ===========================================================================

describe('Public Status Page & Toggle Management', () => {
  it('should return 404 for unknown slug or when public page is disabled (isPublic = false)', async () => {
    // 1. Unknown slug
    const unknownRes = await request(app).get('/api/status/definitely-nonexistent-slug');
    expect(unknownRes.status).toBe(404);

    // 2. Existing monitor but isPublic is false
    const privateMonitor = await Monitor.create({
      name: 'Private Internal API',
      url: 'https://internal.example.com/health',
      userId: testUser._id,
      publicSlug: 'private-internal-api',
      isPublic: false, // DISABLED
    });

    const disabledRes = await request(app).get(`/api/status/${privateMonitor.publicSlug}`);
    expect(disabledRes.status).toBe(404);
  });

  it('should allow owner to toggle public status page on and off via API', async () => {
    const monitor = await Monitor.create({
      name: 'Toggleable Service',
      url: 'https://api.example.com/toggle',
      userId: testUser._id,
      isPublic: false,
    });

    // 1. Toggle ON and assign public slug
    const enableRes = await request(app)
      .post(`/api/monitors/${monitor._id}/public`)
      .set('Cookie', testToken)
      .send({
        isPublic: true,
        publicSlug: 'toggleable-service-status',
      });

    expect(enableRes.status).toBe(200);
    expect(enableRes.body.isPublic).toBe(true);
    expect(enableRes.body.publicSlug).toBe('toggleable-service-status');

    // Public endpoint is now accessible unauthenticated
    const publicRes = await request(app).get('/api/status/toggleable-service-status');
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.name).toBe('Toggleable Service');

    // 2. Toggle OFF
    const disableRes = await request(app)
      .post(`/api/monitors/${monitor._id}/public`)
      .set('Cookie', testToken)
      .send({
        isPublic: false,
      });

    expect(disableRes.status).toBe(200);
    expect(disableRes.body.isPublic).toBe(false);

    // Public endpoint immediately returns 404 once disabled
    const turnedOffRes = await request(app).get('/api/status/toggleable-service-status');
    expect(turnedOffRes.status).toBe(404);
  });

  it('should return unauthenticated status page exposing strictly NO private fields', async () => {
    const monitor = await Monitor.create({
      name: 'Production Gateway',
      url: 'https://gateway.example.com/status',
      userId: testUser._id,
      publicSlug: 'production-gateway',
      isPublic: true,
      alerts: {
        email: { enabled: true, recipient: 'secret-oncall@pulsewatch.dev' },
        webhook: {
          enabled: true,
          url: 'https://internal-slack.corp/hook',
          hmacSecret: 'super-secret-key-999',
        },
      },
    });

    // Seed check results
    await CheckResult.create([
      { monitorId: monitor._id, status: 'UP', responseTimeMs: 120, checkedAt: new Date() },
      {
        monitorId: monitor._id,
        status: 'UP',
        responseTimeMs: 140,
        checkedAt: new Date(Date.now() - 3600000),
      },
    ]);

    // Seed an incident
    await Incident.create({
      monitorId: monitor._id,
      status: 'RESOLVED',
      startedAt: new Date(Date.now() - 7200000),
      resolvedAt: new Date(Date.now() - 6600000),
      duration: 600000,
      failureCount: 3,
      lastErrorMessage: 'Upstream connection reset',
    });

    const res = await request(app).get('/api/status/production-gateway');

    expect(res.status).toBe(200);

    // Public expected fields
    expect(res.body.name).toBe('Production Gateway');
    expect(res.body.status).toBe('UP');
    expect(res.body.publicSlug).toBe('production-gateway');
    expect(res.body.uptime90d).toBe(100);
    expect(Array.isArray(res.body.dailyUptime)).toBe(true);
    expect(res.body.dailyUptime).toHaveLength(90);
    expect(res.body.recentIncidents).toHaveLength(1);
    expect(res.body.recentIncidents[0].status).toBe('RESOLVED');

    // CRITICAL: Verify NO private fields are exposed
    const responseJson = JSON.stringify(res.body);

    // No user info
    expect(res.body).not.toHaveProperty('userId');
    expect(res.body).not.toHaveProperty('user');
    expect(responseJson).not.toContain(testUser._id.toString());
    expect(responseJson).not.toContain('alerts-owner@pulsewatch.dev');

    // No internal database ID of monitor
    expect(res.body).not.toHaveProperty('_id');
    expect(responseJson).not.toContain(monitor._id.toString());

    // No alert settings or secrets
    expect(res.body).not.toHaveProperty('alerts');
    expect(responseJson).not.toContain('secret-oncall@pulsewatch.dev');
    expect(responseJson).not.toContain('https://internal-slack.corp/hook');
    expect(responseJson).not.toContain('super-secret-key-999');

    // No worker scheduling or locking internals
    expect(res.body).not.toHaveProperty('lockedUntil');
    expect(res.body).not.toHaveProperty('nextCheckAt');
  });

  it('should accurately report status as DOWN when an OPEN incident exists', async () => {
    const monitor = await Monitor.create({
      name: 'Down Production Service',
      url: 'https://down.example.com/health',
      userId: testUser._id,
      publicSlug: 'down-production-service',
      isPublic: true,
    });

    // Create an OPEN incident
    await Incident.create({
      monitorId: monitor._id,
      status: 'OPEN',
      startedAt: new Date(),
      failureCount: 4,
      lastErrorMessage: '503 Service Unavailable',
    });

    const res = await request(app).get('/api/status/down-production-service');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DOWN');
    expect(res.body.recentIncidents).toHaveLength(1);
    expect(res.body.recentIncidents[0].status).toBe('OPEN');
  });
});

// ===========================================================================
// 5. Analytics Service Direct Function Calls
// ===========================================================================

describe('Analytics Service Direct Functions', () => {
  it('should compute stats directly via getMonitorStats', async () => {
    const monitor = await Monitor.create({
      name: 'Direct Stats Monitor',
      url: 'https://api.example.com/direct-stats',
      userId: testUser._id,
    });

    const stats = await getMonitorStats(monitor._id);
    expect(stats.uptime['24h']).toBe(100);
    expect(stats.totalIncidents).toBe(0);
  });

  it('should compute response times directly via getMonitorResponseTimes', async () => {
    const monitor = await Monitor.create({
      name: 'Direct RT Monitor',
      url: 'https://api.example.com/direct-rt',
      userId: testUser._id,
    });

    const rt = await getMonitorResponseTimes(monitor._id, '1h');
    expect(rt.range).toBe('1h');
    expect(rt.bucketUnit).toBe('minute');
    expect(Array.isArray(rt.series)).toBe(true);
  });

  it('should fetch public status directly via getPublicStatusBySlug', async () => {
    const monitor = await Monitor.create({
      name: 'Direct Public Slug Monitor',
      url: 'https://api.example.com/direct-public',
      userId: testUser._id,
      publicSlug: 'direct-slug-test',
      isPublic: true,
    });

    const status = await getPublicStatusBySlug(monitor.publicSlug);
    expect(status).toBeTruthy();
    expect(status.name).toBe('Direct Public Slug Monitor');
    expect(status.publicSlug).toBe('direct-slug-test');

    // Should return null for non-public slug
    const nonExistent = await getPublicStatusBySlug('nonexistent-slug');
    expect(nonExistent).toBeNull();
  });
});
