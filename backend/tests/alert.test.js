import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-characters-long';
process.env.JWT_EXPIRES_IN = '1h';
process.env.RESEND_API_KEY = 're_test_dummy_key';

import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import Monitor from '../src/models/Monitor.js';
import Incident from '../src/models/Incident.js';
import AlertLog from '../src/models/AlertLog.js';
import {
  dispatchAlerts,
  sendEmailAlert,
  sendWebhookAlert,
  deliverAlertWithRetry,
  computeHmacSignature,
} from '../src/services/alert.service.js';
import { processCheckResult } from '../src/services/incident.service.js';

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
  // Build all indexes (especially unique index on AlertLog and partial unique index on Incident)
  await AlertLog.init();
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
    email: 'alerts-owner@pulsewatch.dev',
    passwordHash: '$2b$12$eXampleHashedPasswordForAlertsOwner',
  });
  testToken = authCookie(testUser._id);

  otherUser = await User.create({
    email: 'other-user@pulsewatch.dev',
    passwordHash: '$2b$12$eXampleHashedPasswordForOtherUser',
  });
  otherToken = authCookie(otherUser._id);
});

// ===========================================================================
// 1. Alerts Triggered Only by Incident State Transitions (Never per check)
// ===========================================================================

describe('Alert Service - Incident State Transition Triggering', () => {
  it('should trigger exactly one OPENED alert when incident opens, and zero alerts on subsequent failures', async () => {
    const monitor = await Monitor.create({
      name: 'Transition Test Target',
      url: 'https://api.example.com/health',
      userId: testUser._id,
      failureThreshold: 2,
      consecutiveFailures: 0,
      alerts: {
        email: { enabled: true, recipient: 'devs@example.com' },
        webhook: { enabled: true, url: 'https://example.com/webhook-alerts' },
      },
    });

    const mockEmailSender = vi.fn().mockResolvedValue({ id: 'email-123' });
    const mockWebhookSender = vi.fn().mockResolvedValue({ status: 200 });

    const alertOptions = {
      sendMailFn: mockEmailSender,
      sendWebhookFn: mockWebhookSender,
    };

    // Check 1: DOWN -> consecutiveFailures = 1 (threshold 2 not reached) -> NO alert
    const r1 = await processCheckResult(
      {
        monitorId: monitor._id,
        status: 'DOWN',
        errorMessage: 'Service down 1',
      },
      alertOptions
    );
    expect(r1.action).toBe('INCREMENT_FAILURES');
    expect(mockEmailSender).not.toHaveBeenCalled();
    expect(mockWebhookSender).not.toHaveBeenCalled();
    expect(await AlertLog.countDocuments({})).toBe(0);

    // Check 2: DOWN -> reaches threshold 2 -> Incident OPENS! -> Alerts triggered!
    const r2 = await processCheckResult(
      {
        monitorId: monitor._id,
        status: 'DOWN',
        errorMessage: 'Service down 2',
      },
      alertOptions
    );
    expect(r2.action).toBe('OPEN_INCIDENT');
    if (r2.alertPromise) await r2.alertPromise;

    // Both email and webhook triggered ONCE
    expect(mockEmailSender).toHaveBeenCalledTimes(1);
    expect(mockWebhookSender).toHaveBeenCalledTimes(1);

    const openLogs = await AlertLog.find({ incidentId: r2.incident._id });
    expect(openLogs).toHaveLength(2);
    expect(openLogs.every((l) => l.type === 'OPENED' && l.status === 'SENT')).toBe(true);

    // Checks 3 to 10: 8 consecutive repeated failures while incident is OPEN
    // Must NEVER trigger any new alerts!
    for (let i = 3; i <= 10; i++) {
      const rRep = await processCheckResult(
        {
          monitorId: monitor._id,
          status: 'DOWN',
          errorMessage: `Service down ${i}`,
        },
        alertOptions
      );
      expect(rRep.action).toBe('UPDATE_OPEN_INCIDENT');
      if (rRep.alertPromise) await rRep.alertPromise;
    }

    // Call counts must NOT have increased!
    expect(mockEmailSender).toHaveBeenCalledTimes(1);
    expect(mockWebhookSender).toHaveBeenCalledTimes(1);

    // Still only the original 2 alert logs in database
    expect(await AlertLog.countDocuments({})).toBe(2);
  });

  it('should trigger exactly one RESOLVED alert when incident resolves, and zero on subsequent successes', async () => {
    const monitor = await Monitor.create({
      name: 'Resolve Alert Target',
      url: 'https://api.example.com/resolve-check',
      userId: testUser._id,
      failureThreshold: 1,
      alerts: {
        email: { enabled: true, recipient: 'devs@example.com' },
        webhook: { enabled: true, url: 'https://example.com/webhook-alerts' },
      },
    });

    const mockEmailSender = vi.fn().mockResolvedValue({ id: 'email-res' });
    const mockWebhookSender = vi.fn().mockResolvedValue({ status: 200 });
    const alertOptions = {
      sendMailFn: mockEmailSender,
      sendWebhookFn: mockWebhookSender,
    };

    // Open incident
    const rOpen = await processCheckResult(
      {
        monitorId: monitor._id,
        status: 'DOWN',
        errorMessage: 'Fatal crash',
      },
      alertOptions
    );
    if (rOpen.alertPromise) await rOpen.alertPromise;

    expect(mockEmailSender).toHaveBeenCalledTimes(1);
    expect(mockWebhookSender).toHaveBeenCalledTimes(1);

    // Recovery check: UP -> Incident resolves -> RESOLVED alert triggered
    const rResolve = await processCheckResult(
      {
        monitorId: monitor._id,
        status: 'UP',
      },
      alertOptions
    );
    expect(rResolve.action).toBe('RESOLVE_INCIDENT');
    if (rResolve.alertPromise) await rResolve.alertPromise;

    expect(mockEmailSender).toHaveBeenCalledTimes(2); // 1 opened + 1 resolved
    expect(mockWebhookSender).toHaveBeenCalledTimes(2);

    const resolveLogs = await AlertLog.find({ incidentId: rOpen.incident._id, type: 'RESOLVED' });
    expect(resolveLogs).toHaveLength(2);
    expect(resolveLogs.every((l) => l.status === 'SENT')).toBe(true);

    // Subsequent UP checks: already resolved -> NO alerts
    for (let i = 0; i < 5; i++) {
      const rUp = await processCheckResult(
        {
          monitorId: monitor._id,
          status: 'UP',
        },
        alertOptions
      );
      expect(rUp.action).toBe('RESET_COUNTER');
      if (rUp.alertPromise) await rUp.alertPromise;
    }

    // Still exactly 2 emails and 2 webhooks sent total
    expect(mockEmailSender).toHaveBeenCalledTimes(2);
    expect(mockWebhookSender).toHaveBeenCalledTimes(2);
    expect(await AlertLog.countDocuments({})).toBe(4);
  });
});

// ===========================================================================
// 2. Database-Level Deduplication via Unique Index on (incidentId, type, channel)
// ===========================================================================

describe('Alert Service - Database-Level Deduplication', () => {
  it('should enforce unique index on (incidentId, type, channel) and deduplicate across repeated calls', async () => {
    const monitor = await Monitor.create({
      name: 'Dedup Monitor',
      url: 'https://api.example.com/dedup',
      userId: testUser._id,
      alerts: {
        email: { enabled: true, recipient: 'dedup@example.com' },
      },
    });

    const incident = await Incident.create({
      monitorId: monitor._id,
      status: 'OPEN',
      failureCount: 1,
    });

    let sendCount = 0;
    const mockSend = vi.fn().mockImplementation(async () => {
      sendCount++;
      return { ok: true };
    });

    // Run 5 simultaneous delivery attempts for the same incident, type, and channel
    const attempts = await Promise.all([
      deliverAlertWithRetry('email', monitor, incident, 'OPENED', mockSend, {
        initialBackoffMs: 5,
      }),
      deliverAlertWithRetry('email', monitor, incident, 'OPENED', mockSend, {
        initialBackoffMs: 5,
      }),
      deliverAlertWithRetry('email', monitor, incident, 'OPENED', mockSend, {
        initialBackoffMs: 5,
      }),
      deliverAlertWithRetry('email', monitor, incident, 'OPENED', mockSend, {
        initialBackoffMs: 5,
      }),
      deliverAlertWithRetry('email', monitor, incident, 'OPENED', mockSend, {
        initialBackoffMs: 5,
      }),
    ]);

    // Only one delivery actually sent the email
    expect(sendCount).toBe(1);

    // Exactly one AlertLog document exists in the collection
    const logs = await AlertLog.find({
      incidentId: incident._id,
      channel: 'email',
      type: 'OPENED',
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('SENT');

    // Others received deduplicated response
    const deduplicatedResults = attempts.filter((r) => r.deduplicated === true);
    expect(deduplicatedResults.length).toBeGreaterThanOrEqual(4);
  });

  it('should send email alert with fallback to user email when recipient is not specified', async () => {
    const monitor = await Monitor.create({
      name: 'Email Fallback Monitor',
      url: 'https://api.example.com/email-fallback',
      userId: testUser._id,
      alerts: {
        email: { enabled: true, recipient: null }, // no custom recipient
      },
    });

    const incident = await Incident.create({
      monitorId: monitor._id,
      status: 'OPEN',
      failureCount: 1,
    });

    let sentTo = null;
    const mockEmailFn = vi.fn().mockImplementation(async ({ to }) => {
      sentTo = to;
      return { id: 'sent-fallback-123' };
    });

    const res = await sendEmailAlert(monitor, incident, 'OPENED', {
      sendMailFn: mockEmailFn,
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('SENT');
    expect(sentTo).toBe(testUser.email); // User fallback email verified!
  });

  it('should dispatch all enabled channels directly via dispatchAlerts', async () => {
    const monitor = await Monitor.create({
      name: 'Dispatch Direct Monitor',
      url: 'https://api.example.com/dispatch-direct',
      userId: testUser._id,
      alerts: {
        email: { enabled: true, recipient: 'team@example.com' },
        webhook: { enabled: true, url: 'https://example.com/dispatch-webhook' },
      },
    });

    const incident = await Incident.create({
      monitorId: monitor._id,
      status: 'RESOLVED',
      startedAt: new Date(Date.now() - 60000),
      resolvedAt: new Date(),
      duration: 60000,
    });

    const mockEmail = vi.fn().mockResolvedValue({ id: 'disp-email' });
    const mockWebhook = vi.fn().mockResolvedValue({ ok: true });

    const results = await dispatchAlerts(monitor, incident, 'RESOLVED', {
      sendMailFn: mockEmail,
      sendWebhookFn: mockWebhook,
    });

    expect(results).toHaveLength(2);
    expect(mockEmail).toHaveBeenCalledTimes(1);
    expect(mockWebhook).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3. Webhook Delivery, SSRF Validation, and HMAC Signatures
// ===========================================================================

describe('Alert Service - Webhook SSRF & HMAC Signatures', () => {
  it('should compute valid HMAC SHA-256 signature when secret is configured', () => {
    const payload = JSON.stringify({ hello: 'pulsewatch' });
    const secret = 'super-secret-hmac-key';
    const sig = computeHmacSignature(payload, secret);

    expect(typeof sig).toBe('string');
    expect(sig).toHaveLength(64); // SHA-256 produces 64 hex characters
  });

  it('should sign webhook request with X-PulseWatch-Signature header when hmacSecret is provided', async () => {
    const monitor = await Monitor.create({
      name: 'HMAC Webhook Monitor',
      url: 'https://api.example.com/test',
      userId: testUser._id,
      alerts: {
        webhook: {
          enabled: true,
          url: 'https://example.com/alerts-endpoint',
          hmacSecret: 'my-custom-webhook-secret-12345',
        },
      },
    });

    const incident = await Incident.create({
      monitorId: monitor._id,
      status: 'OPEN',
      failureCount: 2,
      lastErrorMessage: '502 Bad Gateway',
    });

    let sentHeaders = null;
    let sentPayload = null;

    const mockSendWebhook = async ({ headers, payload }) => {
      sentHeaders = headers;
      sentPayload = payload;
      return { ok: true };
    };

    const res = await sendWebhookAlert(monitor, incident, 'OPENED', {
      sendWebhookFn: mockSendWebhook,
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('SENT');
    expect(sentHeaders).toBeDefined();
    expect(sentHeaders['X-PulseWatch-Event']).toBe('incident.opened');
    expect(sentHeaders['X-PulseWatch-Signature']).toBeDefined();
    expect(sentHeaders['X-PulseWatch-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);

    // Verify signature validity
    const expectedSig = computeHmacSignature(
      JSON.stringify(sentPayload),
      'my-custom-webhook-secret-12345'
    );
    expect(sentHeaders['X-PulseWatch-Signature']).toBe(`sha256=${expectedSig}`);
  });

  it('should block webhook delivery and record FAILED when URL targets private IP (SSRF protection)', async () => {
    const monitor = await Monitor.create({
      name: 'SSRF Attack Monitor',
      url: 'https://api.example.com/public',
      userId: testUser._id,
      alerts: {
        webhook: {
          enabled: true,
          url: 'http://169.254.169.254/latest/meta-data', // AWS instance metadata SSRF target
        },
      },
    });

    const incident = await Incident.create({
      monitorId: monitor._id,
      status: 'OPEN',
      failureCount: 1,
    });

    const mockSender = vi.fn();
    const alertResult = await sendWebhookAlert(monitor, incident, 'OPENED', {
      sendWebhookFn: mockSender,
    });

    // Delivery must have failed due to SSRF validation without invoking sender
    expect(alertResult.success).toBe(false);
    expect(alertResult.status).toBe('FAILED');
    expect(mockSender).not.toHaveBeenCalled();

    // AlertLog records the SSRF failure
    const log = await AlertLog.findOne({ incidentId: incident._id, channel: 'webhook' });
    expect(log).toBeTruthy();
    expect(log.status).toBe('FAILED');
    expect(log.errorMessage).toContain('SSRF protection');
  });
});

// ===========================================================================
// 4. Retry Logic with Exponential Backoff & Non-Blocking Resilience
// ===========================================================================

describe('Alert Service - Retry with Exponential Backoff & Non-blocking Check Loop', () => {
  it('should retry up to 3 times on provider failure, record every attempt, and mark FAILED after final attempt', async () => {
    const monitor = await Monitor.create({
      name: 'Flaky Webhook Target',
      url: 'https://api.example.com/flaky',
      userId: testUser._id,
      alerts: {
        webhook: {
          enabled: true,
          url: 'https://example.com/flaky-receiver',
        },
      },
    });

    const incident = await Incident.create({
      monitorId: monitor._id,
      status: 'OPEN',
      failureCount: 1,
    });

    let attemptCount = 0;
    const failingWebhookFn = vi.fn().mockImplementation(async () => {
      attemptCount++;
      throw new Error(`Upstream connection refused on attempt ${attemptCount}`);
    });

    const res = await sendWebhookAlert(monitor, incident, 'OPENED', {
      sendWebhookFn: failingWebhookFn,
      maxAttempts: 3,
      initialBackoffMs: 5, // Fast for tests
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('FAILED');
    expect(res.attempts).toBe(3);
    expect(failingWebhookFn).toHaveBeenCalledTimes(3);

    const log = await AlertLog.findOne({ incidentId: incident._id, channel: 'webhook' });
    expect(log).toBeTruthy();
    expect(log.status).toBe('FAILED');
    expect(log.attempts).toBe(3);
    expect(log.errorMessage).toContain('Upstream connection refused on attempt 3');

    // Verify all 3 attempts recorded in attemptHistory
    expect(log.attemptHistory).toHaveLength(3);
    expect(log.attemptHistory[0].attempt).toBe(1);
    expect(log.attemptHistory[0].status).toBe('FAILED');
    expect(log.attemptHistory[1].attempt).toBe(2);
    expect(log.attemptHistory[2].attempt).toBe(3);
  });

  it('should succeed on retry if transient error clears, and mark AlertLog as SENT', async () => {
    const monitor = await Monitor.create({
      name: 'Transient Error Monitor',
      url: 'https://api.example.com/transient',
      userId: testUser._id,
      alerts: {
        webhook: {
          enabled: true,
          url: 'https://example.com/eventual-success',
        },
      },
    });

    const incident = await Incident.create({
      monitorId: monitor._id,
      status: 'OPEN',
      failureCount: 1,
    });

    let tries = 0;
    const transientWebhookFn = vi.fn().mockImplementation(async () => {
      tries++;
      if (tries < 2) {
        throw new Error('503 Service Unavailable (try again)');
      }
      return { ok: true };
    });

    const res = await sendWebhookAlert(monitor, incident, 'OPENED', {
      sendWebhookFn: transientWebhookFn,
      maxAttempts: 3,
      initialBackoffMs: 5,
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('SENT');
    expect(res.attempts).toBe(2);
    expect(transientWebhookFn).toHaveBeenCalledTimes(2);

    const log = await AlertLog.findOne({ incidentId: incident._id, channel: 'webhook' });
    expect(log.status).toBe('SENT');
    expect(log.attempts).toBe(2);
    expect(log.errorMessage).toBeNull();
    expect(log.attemptHistory).toHaveLength(2);
    expect(log.attemptHistory[0].status).toBe('FAILED');
    expect(log.attemptHistory[1].status).toBe('SENT');
  });

  it('should ensure failing alert provider never crashes incident creation or check runner', async () => {
    const monitor = await Monitor.create({
      name: 'Resilient Runner Target',
      url: 'https://api.example.com/crash-test',
      userId: testUser._id,
      failureThreshold: 1,
      consecutiveFailures: 0,
      alerts: {
        email: { enabled: true, recipient: 'broken@example.com' },
      },
    });

    const brokenEmailSender = vi.fn().mockRejectedValue(new Error('Fatal SMTP connection reset'));

    // Check processing must complete smoothly and open the incident despite email failure
    const checkResult = {
      monitorId: monitor._id,
      status: 'DOWN',
      errorMessage: 'Service timeout',
      checkedAt: new Date(),
    };

    const processRes = await processCheckResult(checkResult, {
      sendMailFn: brokenEmailSender,
      maxAttempts: 2,
      initialBackoffMs: 5,
    });

    expect(processRes.action).toBe('OPEN_INCIDENT');
    expect(processRes.incident).toBeDefined();
    expect(processRes.incident.status).toBe('OPEN');

    // Await alert background completion to verify AlertLog
    if (processRes.alertPromise) await processRes.alertPromise;

    const incident = await Incident.findOne({ monitorId: monitor._id });
    expect(incident).toBeTruthy();
    expect(incident.status).toBe('OPEN');

    const log = await AlertLog.findOne({ incidentId: incident._id, channel: 'email' });
    expect(log).toBeTruthy();
    expect(log.status).toBe('FAILED');
    expect(log.errorMessage).toContain('Fatal SMTP connection reset');
  });
});

// ===========================================================================
// 5. Alert Settings Configuration Endpoints (GET & PATCH /api/monitors/:id/alerts)
// ===========================================================================

describe('Monitor Alert Settings API', () => {
  let monitor;

  beforeEach(async () => {
    monitor = await Monitor.create({
      name: 'Settings Test Monitor',
      url: 'https://api.example.com/settings',
      userId: testUser._id,
    });
  });

  it('should return 401 when requesting alert settings without authentication', async () => {
    const res = await request(app).get(`/api/monitors/${monitor._id}/alerts`);
    expect(res.status).toBe(401);
  });

  it('should return default alert settings on GET for a monitor without configured alerts', async () => {
    const res = await request(app)
      .get(`/api/monitors/${monitor._id}/alerts`)
      .set('Cookie', testToken);

    expect(res.status).toBe(200);
    expect(res.body.alerts).toBeDefined();
    expect(res.body.alerts.email.enabled).toBe(false);
    expect(res.body.alerts.webhook.enabled).toBe(false);
  });

  it('should update alert settings via PATCH /api/monitors/:id/alerts', async () => {
    const updatePayload = {
      email: {
        enabled: true,
        recipient: 'oncall-team@pulsewatch.dev',
      },
      webhook: {
        enabled: true,
        url: 'https://webhook.site/my-endpoint',
        hmacSecret: 'test-hmac-secret-string',
      },
    };

    const res = await request(app)
      .patch(`/api/monitors/${monitor._id}/alerts`)
      .set('Cookie', testToken)
      .send(updatePayload);

    expect(res.status).toBe(200);
    expect(res.body.alerts.email.enabled).toBe(true);
    expect(res.body.alerts.email.recipient).toBe('oncall-team@pulsewatch.dev');
    expect(res.body.alerts.webhook.enabled).toBe(true);
    expect(res.body.alerts.webhook.url).toBe('https://webhook.site/my-endpoint');
    expect(res.body.alerts.webhook.hmacSecret).toBe('test-hmac-secret-string');

    // Confirm persisted in MongoDB
    const persisted = await Monitor.findById(monitor._id);
    expect(persisted.alerts.email.enabled).toBe(true);
    expect(persisted.alerts.webhook.hmacSecret).toBe('test-hmac-secret-string');
  });

  it('should reject webhook URLs pointing to private/internal IPs with 400 (SSRF Protection)', async () => {
    const ssrfPayload = {
      webhook: {
        enabled: true,
        url: 'http://127.0.0.1:9000/internal-admin',
      },
    };

    const res = await request(app)
      .patch(`/api/monitors/${monitor._id}/alerts`)
      .set('Cookie', testToken)
      .send(ssrfPayload);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('SSRF protection');
  });

  it('should isolate alert settings across tenants (404 when user B accesses user A monitor)', async () => {
    const res = await request(app)
      .get(`/api/monitors/${monitor._id}/alerts`)
      .set('Cookie', otherToken); // otherUser accessing testUser's monitor

    expect(res.status).toBe(404);
  });
});
