import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-characters-long';
process.env.JWT_EXPIRES_IN = '1h';

import User from '../src/models/User.js';
import Monitor from '../src/models/Monitor.js';
import CheckResult from '../src/models/CheckResult.js';
import {
  claimDueMonitor,
  claimDueMonitors,
  releaseMonitorLock,
} from '../src/worker/scheduler.js';
import { executeCheck } from '../src/worker/checker.js';
import { MonitoringWorker } from '../src/worker/engine.js';

let mongoServer;
let testUser;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
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
    email: 'worker-test@pulsewatch.dev',
    passwordHash: '$2b$12$eXampleHashedPasswordForTest',
  });
});

// ===========================================================================
// 1. Due Monitor Claiming Tests
// ===========================================================================

describe('Due Monitor Claiming (Atomic findOneAndUpdate)', () => {
  it('should claim an overdue monitor and set lockedUntil lease', async () => {
    const pastTime = new Date(Date.now() - 60000); // 1 minute ago
    const monitor = await Monitor.create({
      name: 'Overdue Monitor',
      url: 'https://example.com/due',
      userId: testUser._id,
      intervalSeconds: 60,
      nextCheckAt: pastTime,
      isPaused: false,
    });

    const leaseMs = 20000;
    const beforeClaim = Date.now();
    const claimed = await claimDueMonitor(leaseMs);

    expect(claimed).toBeDefined();
    expect(claimed._id.toString()).toBe(monitor._id.toString());
    expect(claimed.lockedUntil).toBeDefined();

    const lockTime = new Date(claimed.lockedUntil).getTime();
    expect(lockTime).toBeGreaterThanOrEqual(beforeClaim + 19000);
    expect(lockTime).toBeLessThanOrEqual(beforeClaim + 21000);
  });

  it('should NOT claim a paused monitor', async () => {
    await Monitor.create({
      name: 'Paused Monitor',
      url: 'https://example.com/paused',
      userId: testUser._id,
      nextCheckAt: new Date(Date.now() - 60000),
      isPaused: true,
    });

    const claimed = await claimDueMonitor();
    expect(claimed).toBeNull();
  });

  it('should NOT claim a monitor whose nextCheckAt is in the future', async () => {
    await Monitor.create({
      name: 'Future Monitor',
      url: 'https://example.com/future',
      userId: testUser._id,
      nextCheckAt: new Date(Date.now() + 60000), // 1 minute in the future
      isPaused: false,
    });

    const claimed = await claimDueMonitor();
    expect(claimed).toBeNull();
  });

  it('should NOT claim a monitor with an active (unexpired) lockedUntil lease', async () => {
    await Monitor.create({
      name: 'Locked Monitor',
      url: 'https://example.com/locked',
      userId: testUser._id,
      nextCheckAt: new Date(Date.now() - 60000),
      lockedUntil: new Date(Date.now() + 30000), // locked for next 30s
      isPaused: false,
    });

    const claimed = await claimDueMonitor();
    expect(claimed).toBeNull();
  });

  it('should claim a monitor whose lockedUntil lease has expired', async () => {
    const monitor = await Monitor.create({
      name: 'Expired Lease Monitor',
      url: 'https://example.com/expired-lease',
      userId: testUser._id,
      nextCheckAt: new Date(Date.now() - 60000),
      lockedUntil: new Date(Date.now() - 5000), // lease expired 5s ago
      isPaused: false,
    });

    const claimed = await claimDueMonitor();
    expect(claimed).toBeDefined();
    expect(claimed._id.toString()).toBe(monitor._id.toString());
  });

  it('should prioritize the most overdue monitor first (sort by nextCheckAt ascending)', async () => {
    const older = await Monitor.create({
      name: 'Very Old Check',
      url: 'https://example.com/old',
      userId: testUser._id,
      nextCheckAt: new Date(Date.now() - 120000), // 2 min ago
      isPaused: false,
    });

    await Monitor.create({
      name: 'Recent Check',
      url: 'https://example.com/recent',
      userId: testUser._id,
      nextCheckAt: new Date(Date.now() - 30000), // 30 sec ago
      isPaused: false,
    });

    const claimed = await claimDueMonitor();
    expect(claimed._id.toString()).toBe(older._id.toString());
  });

  it('should prevent double-claiming under concurrent worker attempts (race condition safety)', async () => {
    await Monitor.create({
      name: 'Contested Monitor',
      url: 'https://example.com/contested',
      userId: testUser._id,
      nextCheckAt: new Date(Date.now() - 60000),
      isPaused: false,
    });

    // Simulate 5 simultaneous worker calls trying to claim the single due monitor
    const results = await Promise.all([
      claimDueMonitor(),
      claimDueMonitor(),
      claimDueMonitor(),
      claimDueMonitor(),
      claimDueMonitor(),
    ]);

    const successfulClaims = results.filter((res) => res !== null);
    expect(successfulClaims).toHaveLength(1);
  });

  it('should claim up to maxCount monitors using claimDueMonitors', async () => {
    for (let i = 1; i <= 4; i++) {
      await Monitor.create({
        name: `Batch Monitor ${i}`,
        url: `https://example.com/batch-${i}`,
        userId: testUser._id,
        nextCheckAt: new Date(Date.now() - 10000 * i),
        isPaused: false,
      });
    }

    const claimedBatch = await claimDueMonitors(2);
    expect(claimedBatch).toHaveLength(2);

    // Remaining 2 can be claimed subsequently
    const secondBatch = await claimDueMonitors(5);
    expect(secondBatch).toHaveLength(2);

    // No more due monitors
    const emptyBatch = await claimDueMonitors(5);
    expect(emptyBatch).toHaveLength(0);
  });

  it('should release lock and advance nextCheckAt with releaseMonitorLock', async () => {
    const monitor = await Monitor.create({
      name: 'Release Lock Monitor',
      url: 'https://example.com/release',
      userId: testUser._id,
      nextCheckAt: new Date(Date.now() - 60000),
      lockedUntil: new Date(Date.now() + 30000),
    });

    const updated = await releaseMonitorLock(monitor._id, 120);
    expect(updated.lockedUntil).toBeNull();
    expect(new Date(updated.nextCheckAt).getTime()).toBeGreaterThan(Date.now() + 110000);
  });
});

// ===========================================================================
// 2. HTTP Check Execution & UP/DOWN Classification (Mocked HTTP)
// ===========================================================================

describe('HTTP Check Execution & UP/DOWN Classification (Mocked HTTP)', () => {
  it('should classify exact expectedStatus match as UP', async () => {
    const mockFetch = async () => ({
      status: 200,
      headers: new Headers(),
    });

    const result = await executeCheck(
      { url: 'https://example.com', expectedStatus: 200, timeoutMs: 5000 },
      { fetchFn: mockFetch }
    );

    expect(result.status).toBe('UP');
    expect(result.statusCode).toBe(200);
    expect(result.errorMessage).toBeNull();
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should classify status code mismatch as DOWN with descriptive message', async () => {
    const mockFetch = async () => ({
      status: 503,
      headers: new Headers(),
    });

    const result = await executeCheck(
      { url: 'https://example.com', expectedStatus: 200, timeoutMs: 5000 },
      { fetchFn: mockFetch }
    );

    expect(result.status).toBe('DOWN');
    expect(result.statusCode).toBe(503);
    expect(result.errorMessage).toBe('Expected status 200 but received 503');
  });

  it('should treat any 2xx as UP when expectedStatus is not specified (default)', async () => {
    const mockFetch204 = async () => ({
      status: 204,
      headers: new Headers(),
    });

    const result = await executeCheck(
      { url: 'https://example.com', expectedStatus: null, timeoutMs: 5000 },
      { fetchFn: mockFetch204 }
    );

    expect(result.status).toBe('UP');
    expect(result.statusCode).toBe(204);
  });

  it('should record timeouts as DOWN with readable error message', async () => {
    const mockTimeoutFetch = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'AbortError';
      throw err;
    };

    const result = await executeCheck(
      { url: 'https://example.com', timeoutMs: 3000 },
      { fetchFn: mockTimeoutFetch }
    );

    expect(result.status).toBe('DOWN');
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toBe('Request timed out after 3000ms');
  });

  it('should record DNS failures as DOWN with readable error message', async () => {
    const mockDnsFailFetch = async () => {
      const err = new Error('getaddrinfo ENOTFOUND invalid-domain.test');
      err.code = 'ENOTFOUND';
      throw err;
    };

    const result = await executeCheck(
      { url: 'https://invalid-domain.test' },
      { fetchFn: mockDnsFailFetch }
    );

    expect(result.status).toBe('DOWN');
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toContain('DNS resolution failed');
  });

  it('should record connection refused as DOWN with readable error message', async () => {
    const mockRefusedFetch = async () => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:80');
      err.code = 'ECONNREFUSED';
      throw err;
    };

    const result = await executeCheck(
      { url: 'http://example.com' },
      { fetchFn: mockRefusedFetch }
    );

    expect(result.status).toBe('DOWN');
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toBe('Connection refused by server');
  });

  it('should record connection reset as DOWN with readable error message', async () => {
    const mockResetFetch = async () => {
      const err = new Error('read ECONNRESET');
      err.code = 'ECONNRESET';
      throw err;
    };

    const result = await executeCheck(
      { url: 'https://example.com' },
      { fetchFn: mockResetFetch }
    );

    expect(result.status).toBe('DOWN');
    expect(result.errorMessage).toBe('Connection reset by peer');
  });

  it('should follow redirects up to maxRedirects and record final status', async () => {
    let callCount = 0;
    const mockRedirectFetch = async (url) => {
      callCount++;
      if (url === 'https://example.com/step1') {
        const headers = new Headers();
        headers.set('location', 'https://example.com/step2');
        return { status: 301, headers };
      }
      if (url === 'https://example.com/step2') {
        const headers = new Headers();
        headers.set('location', 'https://example.com/final');
        return { status: 302, headers };
      }
      return { status: 200, headers: new Headers() };
    };

    const result = await executeCheck(
      { url: 'https://example.com/step1', expectedStatus: 200 },
      { fetchFn: mockRedirectFetch }
    );

    expect(result.status).toBe('UP');
    expect(result.statusCode).toBe(200);
    expect(callCount).toBe(3);
  });

  it('should record excessive redirects (> 5) as DOWN', async () => {
    const mockInfiniteRedirectFetch = async () => {
      const headers = new Headers();
      headers.set('location', 'https://example.com/loop');
      return { status: 302, headers };
    };

    const result = await executeCheck(
      { url: 'https://example.com/loop' },
      { fetchFn: mockInfiniteRedirectFetch, maxRedirects: 5 }
    );

    expect(result.status).toBe('DOWN');
    expect(result.errorMessage).toBe('Maximum redirect limit (5) exceeded');
  });
});

// ===========================================================================
// 3. Worker Engine Lifecycle & CheckResult Storage
// ===========================================================================

describe('MonitoringWorker Engine Lifecycle', () => {
  it('should process a claimed monitor, store CheckResult, update nextCheckAt, and release lock', async () => {
    const monitor = await Monitor.create({
      name: 'Engine Test Target',
      url: 'https://example.com/check',
      userId: testUser._id,
      intervalSeconds: 90,
      nextCheckAt: new Date(Date.now() - 10000),
      lockedUntil: new Date(Date.now() + 30000),
      consecutiveFailures: 2,
    });

    const mockFetch = async () => ({
      status: 200,
      headers: new Headers(),
    });

    const worker = new MonitoringWorker({ fetchFn: mockFetch });
    await worker.processMonitor(monitor);

    // Verify CheckResult created
    const results = await CheckResult.find({ monitorId: monitor._id });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('UP');
    expect(results[0].statusCode).toBe(200);

    // Verify Monitor updated
    const updatedMonitor = await Monitor.findById(monitor._id);
    expect(updatedMonitor.lockedUntil).toBeNull();
    expect(updatedMonitor.consecutiveFailures).toBe(0); // Reset on UP
    expect(new Date(updatedMonitor.nextCheckAt).getTime()).toBeGreaterThan(Date.now() + 85000);
  });

  it('should increment consecutiveFailures on DOWN result', async () => {
    const monitor = await Monitor.create({
      name: 'Failing Monitor',
      url: 'https://example.com/failing',
      userId: testUser._id,
      intervalSeconds: 60,
      consecutiveFailures: 1,
    });

    const mockFailFetch = async () => ({
      status: 500,
      headers: new Headers(),
    });

    const worker = new MonitoringWorker({ fetchFn: mockFailFetch });
    await worker.processMonitor(monitor);

    const updatedMonitor = await Monitor.findById(monitor._id);
    expect(updatedMonitor.consecutiveFailures).toBe(2);
    expect(updatedMonitor.lockedUntil).toBeNull();

    const results = await CheckResult.find({ monitorId: monitor._id });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('DOWN');
  });

  it('should never crash the loop if an unexpected error occurs during check processing', async () => {
    const monitor = await Monitor.create({
      name: 'Throwing Target',
      url: 'https://example.com/throws',
      userId: testUser._id,
      lockedUntil: new Date(Date.now() + 30000),
    });

    const mockErrorFetch = () => {
      throw new Error('Fatal simulator error');
    };

    const worker = new MonitoringWorker({ fetchFn: mockErrorFetch });

    // Should not throw or crash
    await expect(worker.processMonitor(monitor)).resolves.not.toThrow();

    // Lock must still be released
    const updated = await Monitor.findById(monitor._id);
    expect(updated.lockedUntil).toBeNull();
  });

  it('should gracefully stop worker loop and wait for active checks', async () => {
    let checkFinished = false;

    const mockSlowFetch = async () => {
      await new Promise((r) => setTimeout(r, 50));
      checkFinished = true;
      return { status: 200, headers: new Headers() };
    };

    const monitor = await Monitor.create({
      name: 'Slow Check Monitor',
      url: 'https://example.com/slow',
      userId: testUser._id,
      nextCheckAt: new Date(Date.now() - 5000),
    });

    const worker = new MonitoringWorker({
      pollIntervalMs: 50,
      concurrency: 2,
      fetchFn: mockSlowFetch,
    });

    worker.start();
    expect(worker.isRunning).toBe(true);

    // Give time for tick to claim and start processing
    await new Promise((r) => setTimeout(r, 20));

    await worker.stop(500);
    expect(worker.isRunning).toBe(false);
    expect(checkFinished).toBe(true);
  });
});
