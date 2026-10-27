import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoSanitize from 'express-mongo-sanitize';
import demoRouter, { resetDemoState } from '../src/routes/demo.routes.js';
import { createApp } from '../src/app.js';

describe('Security & Demo Outage Helper Suite', () => {
  beforeEach(() => {
    resetDemoState();
    vi.restoreAllMocks();
  });

  describe('Demo Helper Routes (/api/demo)', () => {
    let demoApp;

    beforeEach(() => {
      demoApp = express();
      demoApp.use(express.json());
      demoApp.use('/api/demo', demoRouter);
    });

    it('should return 200 by default on GET /api/demo/probe', async () => {
      const res = await request(demoApp).get('/api/demo/probe');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OPERATIONAL');
      expect(res.body.statusCode).toBe(200);
      expect(res.body.message).toContain('operational and healthy');
    });

    it('should toggle to 500 failure state when POST /api/demo/toggle is called', async () => {
      const toggleRes = await request(demoApp).post('/api/demo/toggle').send();
      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.failing).toBe(true);
      expect(toggleRes.body.probeStatus).toBe(500);

      // Now probe should return 500
      const probeRes = await request(demoApp).get('/api/demo/probe');
      expect(probeRes.status).toBe(500);
      expect(probeRes.body.status).toBe('DOWN');
      expect(probeRes.body.statusCode).toBe(500);
    });

    it('should restore to 200 operational state on second toggle', async () => {
      // Toggle to fail
      await request(demoApp).post('/api/demo/toggle').send();

      // Toggle back to operational
      const toggleBackRes = await request(demoApp).post('/api/demo/toggle').send();
      expect(toggleBackRes.status).toBe(200);
      expect(toggleBackRes.body.failing).toBe(false);
      expect(toggleBackRes.body.probeStatus).toBe(200);

      const probeRes = await request(demoApp).get('/api/demo/probe');
      expect(probeRes.status).toBe(200);
      expect(probeRes.body.status).toBe('OPERATIONAL');
    });

    it('should support explicit status code and message override', async () => {
      const toggleRes = await request(demoApp).post('/api/demo/toggle').send({
        failing: true,
        statusCode: 503,
        message: 'Database connection pool exhausted',
      });

      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.failing).toBe(true);
      expect(toggleRes.body.probeStatus).toBe(503);

      const probeRes = await request(demoApp).get('/api/demo/probe');
      expect(probeRes.status).toBe(503);
      expect(probeRes.body.message).toBe('Database connection pool exhausted');
    });

    it('should report status via GET /api/demo/status', async () => {
      const res = await request(demoApp).get('/api/demo/status');
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.failing).toBe(false);
      expect(res.body.probeStatus).toBe(200);
    });
  });

  describe('Security Hardening Middleware', () => {
    it('should include Helmet security headers in responses', async () => {
      const app = createApp();
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      // Helmet standard headers
      expect(res.headers['x-dns-prefetch-control']).toBe('off');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('should sanitize NoSQL query injection characters like $ and . from body', async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.use(mongoSanitize({ replaceWith: '_' }));
      testApp.post('/test-sanitize', (req, res) => {
        res.json({ body: req.body });
      });

      const res = await request(testApp)
        .post('/test-sanitize')
        .send({
          email: { $gt: '' },
          'user.name': 'admin',
        });

      expect(res.status).toBe(200);
      // $ should be sanitized to _
      expect(res.body.body.email._gt).toBe('');
      expect(res.body.body.email['$gt']).toBeUndefined();
    });

    it('should reject request bodies exceeding the 100kb limit', async () => {
      const testApp = express();
      testApp.use(express.json({ limit: '100kb' }));
      testApp.post('/test-limit', (req, res) => {
        res.json({ ok: true });
      });

      // Construct payload larger than 100kb (~120kb)
      const oversizedPayload = { data: 'x'.repeat(125 * 1024) };

      const res = await request(testApp).post('/test-limit').send(oversizedPayload);

      expect(res.status).toBe(413);
    });

    it('should block disallowed CORS origins with strict policy error', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://malicious-site.attacker.com');

      // Rejected CORS returns error or omits Access-Control-Allow-Origin
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
