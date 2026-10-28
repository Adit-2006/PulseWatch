import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import User from '../models/User.js';
import { registerSchema, loginSchema } from '../validators/auth.validators.js';
import { ConflictError, UnauthorizedError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SALT_ROUNDS = 12;

/** Cookie options for the JWT token. */
const cookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: parseDurationToMs(env.JWT_EXPIRES_IN),
  path: '/',
});

/**
 * Parse a duration string like "7d", "24h", "60m" into milliseconds.
 * Falls back to 7 days if the format is not recognized.
 */
function parseDurationToMs(duration) {
  const match = duration.match(/^(\d+)(d|h|m|s)$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (multipliers[unit] || 86_400_000);
}

/** Sign a JWT for the given user ID. */
const signToken = (userId) =>
  jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });

/** Attach JWT cookie to response and send user data. */
const sendAuthResponse = (res, user, statusCode = 200) => {
  const token = signToken(user._id);

  res.cookie('token', token, cookieOptions());

  res.status(statusCode).json({
    user: {
      id: user._id,
      email: user.email,
      createdAt: user.createdAt,
    },
  });
};

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/register
 * Create a new user account with hashed password.
 */
export const register = async (req, res, next) => {
  try {
    const { email, password } = registerSchema.parse(req.body);

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await User.create({ email, passwordHash });

    sendAuthResponse(res, user, 201);
  } catch (err) {
    // Catch MongoDB duplicate key error for email uniqueness
    if (err.code === 11000) {
      return next(new ConflictError('An account with this email already exists'));
    }
    next(err);
  }
};

/**
 * POST /api/auth/login
 * Authenticate with email + password and issue a JWT cookie.
 * Returns a generic error message to prevent user enumeration.
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    // Use a generic message for all auth failures to prevent user enumeration
    const GENERIC_AUTH_ERROR = 'Invalid email or password';

    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) {
      return next(new UnauthorizedError(GENERIC_AUTH_ERROR));
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return next(new UnauthorizedError(GENERIC_AUTH_ERROR));
    }

    sendAuthResponse(res, user);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/logout
 * Clear the JWT cookie.
 */
export const logout = (_req, res) => {
  res.cookie('token', '', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 0,
    path: '/',
  });

  res.status(200).json({ message: 'Logged out successfully' });
};

/**
 * GET /api/auth/me
 * Return the currently authenticated user's profile.
 * Requires the `authenticate` middleware to have run first.
 */
export const getMe = (req, res) => {
  res.status(200).json({
    user: {
      id: req.user._id,
      email: req.user.email,
      createdAt: req.user.createdAt,
    },
  });
};
