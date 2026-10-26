import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Bootstrap: We need to set env vars BEFORE the app module loads, because
// env.js validates at import time. We do this via process.env overrides.
// ---------------------------------------------------------------------------
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder'; // overridden by MongoMemoryServer
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-characters-long';
process.env.JWT_EXPIRES_IN = '1h';

// Now import the app (env.js runs its validation on import)
const { createApp } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');
import User from '../src/models/User.js';

let mongoServer;
let app;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  app = createApp();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  // Clean all collections before each test for isolation
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validUser = {
  email: 'test@pulsewatch.dev',
  password: 'SecureP@ss1',
};

/** Register a user and return the supertest response (includes cookies). */
const registerUser = (overrides = {}) =>
  request(app)
    .post('/api/auth/register')
    .send({ ...validUser, ...overrides });

/** Login a user and return the supertest response (includes cookies). */
const loginUser = (overrides = {}) =>
  request(app)
    .post('/api/auth/login')
    .send({ ...validUser, ...overrides });

/** Extract the `token` cookie value from a supertest response. */
const extractTokenCookie = (res) => {
  const cookies = res.headers['set-cookie'];
  if (!cookies) return null;
  const tokenCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((c) =>
    c.startsWith('token=')
  );
  if (!tokenCookie) return null;
  return tokenCookie.split(';')[0].split('=')[1];
};

// ===========================================================================
// Registration Tests
// ===========================================================================

describe('POST /api/auth/register', () => {
  it('should register a new user and return 201 with user data and httpOnly cookie', async () => {
    const res = await registerUser();

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user).toHaveProperty('email', validUser.email);
    expect(res.body.user).toHaveProperty('createdAt');
    // passwordHash should never be returned
    expect(res.body.user).not.toHaveProperty('passwordHash');

    // Cookie should be set and httpOnly
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const tokenCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((c) =>
      c.startsWith('token=')
    );
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie).toContain('HttpOnly');
  });

  it('should store email as lowercase', async () => {
    const res = await registerUser({ email: 'UPPER@PULSEWATCH.DEV' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('upper@pulsewatch.dev');
  });

  it('should return 409 when registering with a duplicate email', async () => {
    // First registration — should succeed
    await registerUser();

    // Second registration with same email — should fail
    const res = await registerUser();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toContain('email already exists');
  });

  it('should return 400 for invalid email format', async () => {
    const res = await registerUser({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for weak password (no uppercase)', async () => {
    const res = await registerUser({ password: 'weakpass1!' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('uppercase');
  });

  it('should return 400 for weak password (too short)', async () => {
    const res = await registerUser({ password: 'Ab1!' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('8 characters');
  });

  it('should return 400 for weak password (no special character)', async () => {
    const res = await registerUser({ password: 'SecurePass1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('special character');
  });

  it('should not store the password in plaintext', async () => {
    await registerUser();

    const user = await User.findOne({ email: validUser.email });
    expect(user.passwordHash).toBeDefined();
    expect(user.passwordHash).not.toBe(validUser.password);
    // bcrypt hashes always start with $2a$ or $2b$
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
  });
});

// ===========================================================================
// Login Tests
// ===========================================================================

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    // Seed a user for login tests
    await registerUser();
  });

  it('should login with valid credentials and return user + cookie', async () => {
    const res = await loginUser();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('email', validUser.email);
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const token = extractTokenCookie(res);
    expect(token).toBeTruthy();
  });

  it('should return 401 with generic message for wrong password (no user enumeration)', async () => {
    const res = await loginUser({ password: 'WrongP@ss1' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('should return 401 with generic message for non-existent email (no user enumeration)', async () => {
    const res = await loginUser({ email: 'nobody@pulsewatch.dev' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    // Same message as wrong password — prevents enumeration
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('should return 400 for missing email', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'Something1!' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
// Logout Tests
// ===========================================================================

describe('POST /api/auth/logout', () => {
  it('should clear the token cookie', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'Logged out successfully');

    // The cookie should be cleared (max-age=0 or expires in the past)
    const cookies = res.headers['set-cookie'];
    const tokenCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((c) =>
      c.startsWith('token=')
    );
    expect(tokenCookie).toBeDefined();
    // Cookie value should be empty or have expired
    expect(tokenCookie).toMatch(/token=;|token=\s*;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});

// ===========================================================================
// GET /api/auth/me — Protected Route Tests
// ===========================================================================

describe('GET /api/auth/me', () => {
  it('should return 401 when no token is provided', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.message).toBe('Authentication required');
  });

  it('should return 401 for an invalid/malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'token=this-is-not-a-valid-jwt');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.message).toBe('Invalid or expired token');
  });

  it('should return 401 for a token signed with the wrong secret', async () => {
    const fakeToken = jwt.sign({ sub: new mongoose.Types.ObjectId() }, 'wrong-secret-key');

    const res = await request(app).get('/api/auth/me').set('Cookie', `token=${fakeToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 401 when the user in the token no longer exists', async () => {
    const deletedUserId = new mongoose.Types.ObjectId();
    const token = jwt.sign({ sub: deletedUserId }, env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app).get('/api/auth/me').set('Cookie', `token=${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('User no longer exists');
  });

  it('should return the authenticated user when a valid token is provided', async () => {
    // Register to get a valid cookie
    const registerRes = await registerUser();
    const token = extractTokenCookie(registerRes);

    const res = await request(app).get('/api/auth/me').set('Cookie', `token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('email', validUser.email);
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user).toHaveProperty('createdAt');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });
});
