import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, logout, getMe } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { env } from '../config/env.js';

const router = Router();

// ---------------------------------------------------------------------------
// Rate Limiting — protects auth endpoints from brute-force and credential
// stuffing attacks. Separate limiters for registration vs login allow
// different thresholds. Disabled in test environment (max: 0 = unlimited).
// ---------------------------------------------------------------------------

const noopMiddleware = (_req, _res, next) => next();

const registerLimiter =
  env.NODE_ENV === 'test'
    ? noopMiddleware
    : rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 10, // 10 registrations per window
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many registration attempts. Please try again later.',
          },
        },
      });

const loginLimiter =
  env.NODE_ENV === 'test'
    ? noopMiddleware
    : rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 20, // 20 login attempts per window
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many login attempts. Please try again later.',
          },
        },
      });

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.get('/me', authenticate, getMe);

export default router;

