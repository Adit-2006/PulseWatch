import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-characters-long';
process.env.JWT_EXPIRES_IN = '1h';
process.env.MAX_MONITORS_PER_USER = '5';

const { createApp } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');
import User from '../src/models/User.js';
import Monitor from '../src/models/Monitor.js';
import CheckResult from '../src/models/CheckResult.js';
import Incident from '../src/models/Incident.js';
import AlertLog from '../src/models/AlertLog.js';

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
  // Ensure compound unique indexes are built
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

  // Seed two distinct users for ownership tests
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

describe('Monitors API - Authentication Guard', () => {
  it('should return 401 when accessing monitor endpoints without token', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const getRes = await request(app).get('/api/monitors');
    expect(getRes.status).toBe(401);

    const postRes = await request(app).post('/api/monitors').send({
      name: 'Test',
      url: 'https://example.com',
    });
    expect(postRes.status).toBe(401);

    const getByIdRes = await request(app).get(`/api/monitors/${fakeId}`);
    expect(getByIdRes.status).toBe(401);

    const patchRes = await request(app).patch(`/api/monitors/${fakeId}`).send({ name: 'New' });
    expect(patchRes.status).toBe(401);

    const deleteRes = await request(app).delete(`/api/monitors/${fakeId}`);
    expect(deleteRes.status).toBe(401);

    const pauseRes = await request(app).post(`/api/monitors/${fakeId}/pause`);
    expect(pauseRes.status).toBe(401);

    const resumeRes = await request(app).post(`/api/monitors/${fakeId}/resume`);
    expect(resumeRes.status).toBe(401);
  });
});

describe('POST /api/monitors', () => {
  it('should successfully create a monitor and set nextCheckAt', async () => {
    const beforeTime = Date.now();
    const res = await request(app).post('/api/monitors').set('Cookie', tokenA).send({
      name: 'Production Gateway',
      url: 'https://example.com/api/v1',
      method: 'GET',
      intervalSeconds: 60,
      timeoutMs: 5000,
      expectedStatus: 200,
      failureThreshold: 3,
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('monitor');
    expect(res.body.monitor.name).toBe('Production Gateway');
    expect(res.body.monitor.url).toBe('https://example.com/api/v1');
    expect(res.body.monitor.userId).toBe(userA._id.toString());
    expect(res.body.monitor.isPaused).toBe(false);

    // nextCheckAt should be approximately beforeTime + 60s
    const nextCheck = new Date(res.body.monitor.nextCheckAt).getTime();
    expect(nextCheck).toBeGreaterThanOrEqual(beforeTime + 58000);
    expect(nextCheck).toBeLessThanOrEqual(beforeTime + 62000);
  });

  it('should reject duplicate URLs for the same user with 409 Conflict', async () => {
    const payload = {
      name: 'Service 1',
      url: 'https://example.com/health',
    };

    const first = await request(app).post('/api/monitors').set('Cookie', tokenA).send(payload);
    expect(first.status).toBe(201);

    const duplicate = await request(app).post('/api/monitors').set('Cookie', tokenA).send({
      name: 'Service 1 Duplicate',
      url: 'https://example.com/health',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
  });

  it('should allow the same URL for different users', async () => {
    const payload = {
      name: 'Shared Domain Monitor',
      url: 'https://example.com/shared',
    };

    const resA = await request(app).post('/api/monitors').set('Cookie', tokenA).send(payload);
    expect(resA.status).toBe(201);

    const resB = await request(app).post('/api/monitors').set('Cookie', tokenB).send(payload);
    expect(resB.status).toBe(201);
  });

  it('should enforce user monitor limits (MAX_MONITORS_PER_USER)', async () => {
    // MAX_MONITORS_PER_USER is set to 5
    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post('/api/monitors')
        .set('Cookie', tokenA)
        .send({
          name: `Monitor ${i}`,
          url: `https://example.com/service-${i}`,
        });
      expect(res.status).toBe(201);
    }

    // 6th monitor should fail
    const overLimit = await request(app).post('/api/monitors').set('Cookie', tokenA).send({
      name: 'Monitor 6 (Over limit)',
      url: 'https://example.com/service-6',
    });

    expect(overLimit.status).toBe(400);
    expect(overLimit.body.error.code).toBe('MONITOR_LIMIT_REACHED');
  });
});

describe('Zod Validation for Monitor Inputs', () => {
  it('should reject URLs with non-http/https protocol', async () => {
    const res = await request(app).post('/api/monitors').set('Cookie', tokenA).send({
      name: 'FTP Monitor',
      url: 'ftp://example.com/file',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should reject intervalSeconds outside 30..3600', async () => {
    const tooLow = await request(app).post('/api/monitors').set('Cookie', tokenA).send({
      name: 'Too Fast',
      url: 'https://example.com',
      intervalSeconds: 15,
    });
    expect(tooLow.status).toBe(400);
    expect(tooLow.body.error.message).toContain('30 and 3600');

    const tooHigh = await request(app).post('/api/monitors').set('Cookie', tokenA).send({
      name: 'Too Slow',
      url: 'https://example.com',
      intervalSeconds: 7200,
    });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error.message).toContain('30 and 3600');
  });

  it('should reject timeoutMs outside 1000..30000', async () => {
    const tooLow = await request(app).post('/api/monitors').set('Cookie', tokenA).send({
      name: 'Fast Timeout',
      url: 'https://example.com',
      timeoutMs: 500,
    });
    expect(tooLow.status).toBe(400);
    expect(tooLow.body.error.message).toContain('1000 and 30000');

    const tooHigh = await request(app).post('/api/monitors').set('Cookie', tokenA).send({
      name: 'Slow Timeout',
      url: 'https://example.com',
      timeoutMs: 40000,
    });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error.message).toContain('1000 and 30000');
  });

  it('should reject failureThreshold outside 1..10', async () => {
    const tooLow = await request(app).post('/api/monitors').set('Cookie', tokenA).send({
      name: 'Zero Threshold',
      url: 'https://example.com',
      failureThreshold: 0,
    });
    expect(tooLow.status).toBe(400);
    expect(tooLow.body.error.message).toContain('1 and 10');

    const tooHigh = await request(app).post('/api/monitors').set('Cookie', tokenA).send({
      name: 'Huge Threshold',
      url: 'https://example.com',
      failureThreshold: 15,
    });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error.message).toContain('1 and 10');
  });
});

describe('SSRF Protection', () => {
  const ssrfUrls = [
    { url: 'http://localhost:3000', desc: 'localhost' },
    { url: 'http://127.0.0.1:8080', desc: '127.0.0.1' },
    { url: 'http://127.0.0.2', desc: 'loopback 127.0.0.2' },
    { url: 'http://169.254.169.254/latest/meta-data', desc: 'cloud metadata (169.254.169.254)' },
    { url: 'http://10.0.0.1/admin', desc: 'private 10.0.0.0/8' },
    { url: 'http://172.16.0.1', desc: 'private 172.16.0.0/12' },
    { url: 'http://192.168.1.1', desc: 'private 192.168.0.0/16' },
    { url: 'http://[::1]:8080', desc: 'IPv6 localhost [::1]' },
    { url: 'http://metadata.google.internal', desc: 'GCP metadata internal' },
    { url: 'http://service.local', desc: '.local domain' },
    { url: 'http://database.internal', desc: '.internal domain' },
  ];

  for (const { url, desc } of ssrfUrls) {
    it(`should reject SSRF target: ${desc} (${url})`, async () => {
      const res = await request(app)
        .post('/api/monitors')
        .set('Cookie', tokenA)
        .send({
          name: `SSRF Test ${desc}`,
          url,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SSRF_REJECTED');
    });
  }
});

describe('ID Validation & Ownership Enforcement', () => {
  let monitorA;

  beforeEach(async () => {
    monitorA = await Monitor.create({
      name: 'User A Monitor',
      url: 'https://example.com/user-a',
      userId: userA._id,
      intervalSeconds: 60,
    });
  });

  it('should return 400 for malformed monitor IDs', async () => {
    const malformedId = 'not-a-valid-object-id';

    const getRes = await request(app).get(`/api/monitors/${malformedId}`).set('Cookie', tokenA);
    expect(getRes.status).toBe(400);
    expect(getRes.body.error.code).toBe('INVALID_ID');

    const patchRes = await request(app)
      .patch(`/api/monitors/${malformedId}`)
      .set('Cookie', tokenA)
      .send({ name: 'New' });
    expect(patchRes.status).toBe(400);
    expect(patchRes.body.error.code).toBe('INVALID_ID');

    const deleteRes = await request(app)
      .delete(`/api/monitors/${malformedId}`)
      .set('Cookie', tokenA);
    expect(deleteRes.status).toBe(400);
    expect(deleteRes.body.error.code).toBe('INVALID_ID');

    const pauseRes = await request(app)
      .post(`/api/monitors/${malformedId}/pause`)
      .set('Cookie', tokenA);
    expect(pauseRes.status).toBe(400);
    expect(pauseRes.body.error.code).toBe('INVALID_ID');

    const resumeRes = await request(app)
      .post(`/api/monitors/${malformedId}/resume`)
      .set('Cookie', tokenA);
    expect(resumeRes.status).toBe(400);
    expect(resumeRes.body.error.code).toBe('INVALID_ID');
  });

  it('should return 404 when User B attempts to access User A monitor (ownership enforcement)', async () => {
    const id = monitorA._id;

    const getRes = await request(app).get(`/api/monitors/${id}`).set('Cookie', tokenB);
    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('NOT_FOUND');

    const patchRes = await request(app)
      .patch(`/api/monitors/${id}`)
      .set('Cookie', tokenB)
      .send({ name: 'Hijacked' });
    expect(patchRes.status).toBe(404);

    const deleteRes = await request(app).delete(`/api/monitors/${id}`).set('Cookie', tokenB);
    expect(deleteRes.status).toBe(404);

    const pauseRes = await request(app).post(`/api/monitors/${id}/pause`).set('Cookie', tokenB);
    expect(pauseRes.status).toBe(404);

    const resumeRes = await request(app).post(`/api/monitors/${id}/resume`).set('Cookie', tokenB);
    expect(resumeRes.status).toBe(404);
  });

  it('should allow User A to retrieve their own monitor by ID', async () => {
    const res = await request(app).get(`/api/monitors/${monitorA._id}`).set('Cookie', tokenA);

    expect(res.status).toBe(200);
    expect(res.body.monitor._id).toBe(monitorA._id.toString());
    expect(res.body.monitor.name).toBe('User A Monitor');
  });
});

describe('PATCH /api/monitors/:id - Whitelisting & NoSQL Protection', () => {
  let monitor;

  beforeEach(async () => {
    monitor = await Monitor.create({
      name: 'Initial Monitor',
      url: 'https://example.com/initial',
      userId: userA._id,
      intervalSeconds: 60,
    });
  });

  it('should successfully update whitelisted fields', async () => {
    const res = await request(app)
      .patch(`/api/monitors/${monitor._id}`)
      .set('Cookie', tokenA)
      .send({
        name: 'Updated Monitor Name',
        intervalSeconds: 120,
        expectedStatus: 201,
      });

    expect(res.status).toBe(200);
    expect(res.body.monitor.name).toBe('Updated Monitor Name');
    expect(res.body.monitor.intervalSeconds).toBe(120);
    expect(res.body.monitor.expectedStatus).toBe(201);
  });

  it('should reject keys starting with $ (NoSQL operator injection prevention)', async () => {
    const res = await request(app)
      .patch(`/api/monitors/${monitor._id}`)
      .set('Cookie', tokenA)
      .send({
        $set: { name: 'Injected' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FIELD');
  });

  it('should reject non-whitelisted fields to prevent mass assignment', async () => {
    const res = await request(app)
      .patch(`/api/monitors/${monitor._id}`)
      .set('Cookie', tokenA)
      .send({
        userId: userB._id.toString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FIELD');
  });

  it('should validate SSRF if URL is updated', async () => {
    const res = await request(app)
      .patch(`/api/monitors/${monitor._id}`)
      .set('Cookie', tokenA)
      .send({
        url: 'http://127.0.0.1:9000/internal',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SSRF_REJECTED');
  });
});

describe('POST /api/monitors/:id/pause and /resume', () => {
  let monitor;

  beforeEach(async () => {
    monitor = await Monitor.create({
      name: 'Pause Resume Target',
      url: 'https://example.com/target',
      userId: userA._id,
      intervalSeconds: 90,
      isPaused: false,
    });
  });

  it('should pause an active monitor', async () => {
    const res = await request(app).post(`/api/monitors/${monitor._id}/pause`).set('Cookie', tokenA);

    expect(res.status).toBe(200);
    expect(res.body.monitor.isPaused).toBe(true);

    const saved = await Monitor.findById(monitor._id);
    expect(saved.isPaused).toBe(true);
  });

  it('should resume a paused monitor and update nextCheckAt', async () => {
    monitor.isPaused = true;
    await monitor.save();

    const beforeResume = Date.now();
    const res = await request(app)
      .post(`/api/monitors/${monitor._id}/resume`)
      .set('Cookie', tokenA);

    expect(res.status).toBe(200);
    expect(res.body.monitor.isPaused).toBe(false);

    // nextCheckAt should be updated to future (intervalSeconds is 90)
    const nextCheck = new Date(res.body.monitor.nextCheckAt).getTime();
    expect(nextCheck).toBeGreaterThanOrEqual(beforeResume + 88000);
    expect(nextCheck).toBeLessThanOrEqual(beforeResume + 92000);
  });
});

describe('GET /api/monitors - Pagination & Search Filter', () => {
  beforeEach(async () => {
    // Create monitors for User A
    await Monitor.create([
      { name: 'Alpha Service [API]', url: 'https://example.com/alpha', userId: userA._id },
      { name: 'Beta Service + Worker', url: 'https://example.com/beta', userId: userA._id },
      { name: 'Gamma (Billing)', url: 'https://example.com/gamma', userId: userA._id },
      { name: 'Delta DB', url: 'https://example.com/delta', userId: userA._id },
    ]);

    // Create monitor for User B (must not leak to User A)
    await Monitor.create({
      name: 'User B Secret Monitor',
      url: 'https://example.com/user-b-secret',
      userId: userB._id,
    });
  });

  it('should list monitors for authenticated user with pagination metadata', async () => {
    const res = await request(app).get('/api/monitors?page=1&limit=2').set('Cookie', tokenA);

    expect(res.status).toBe(200);
    expect(res.body.monitors).toHaveLength(2);
    expect(res.body.pagination).toEqual({
      total: 4,
      page: 1,
      limit: 2,
      totalPages: 2,
    });
  });

  it('should safely escape user regex input when searching', async () => {
    // Search with regex metacharacters: '[API]'
    const resBracket = await request(app).get('/api/monitors?search=[API]').set('Cookie', tokenA);

    expect(resBracket.status).toBe(200);
    expect(resBracket.body.monitors).toHaveLength(1);
    expect(resBracket.body.monitors[0].name).toBe('Alpha Service [API]');

    // Search with '+'
    const resPlus = await request(app).get('/api/monitors?search=+ Worker').set('Cookie', tokenA);

    expect(resPlus.status).toBe(200);
    expect(resPlus.body.monitors).toHaveLength(1);
    expect(resPlus.body.monitors[0].name).toBe('Beta Service + Worker');

    // Search by URL substring
    const resUrl = await request(app).get('/api/monitors?search=gamma').set('Cookie', tokenA);

    expect(resUrl.status).toBe(200);
    expect(resUrl.body.monitors).toHaveLength(1);
    expect(resUrl.body.monitors[0].name).toBe('Gamma (Billing)');
  });
});

describe('DELETE /api/monitors/:id - Cascade Delete', () => {
  it('should delete the monitor and cascade delete its check results, incidents, and alert logs', async () => {
    // 1. Create a monitor
    const monitor = await Monitor.create({
      name: 'Cascade Target',
      url: 'https://example.com/cascade',
      userId: userA._id,
    });

    // 2. Create associated CheckResult
    await CheckResult.create({
      monitorId: monitor._id,
      status: 'UP',
      statusCode: 200,
      responseTimeMs: 120,
    });

    // 3. Create associated Incident
    const incident = await Incident.create({
      monitorId: monitor._id,
      status: 'OPEN',
      failureCount: 3,
      lastErrorMessage: 'Connection timeout',
    });

    // 4. Create associated AlertLog
    await AlertLog.create({
      incidentId: incident._id,
      type: 'OPENED',
      channel: 'email',
      status: 'SENT',
    });

    // 5. Issue DELETE
    const res = await request(app).delete(`/api/monitors/${monitor._id}`).set('Cookie', tokenA);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('deleted successfully');

    // 6. Verify cascade deletion
    const remainingMonitor = await Monitor.findById(monitor._id);
    expect(remainingMonitor).toBeNull();

    const remainingChecks = await CheckResult.find({ monitorId: monitor._id });
    expect(remainingChecks).toHaveLength(0);

    const remainingIncidents = await Incident.find({ monitorId: monitor._id });
    expect(remainingIncidents).toHaveLength(0);

    const remainingAlerts = await AlertLog.find({ incidentId: incident._id });
    expect(remainingAlerts).toHaveLength(0);
  });
});
