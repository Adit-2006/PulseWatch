import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import User from '../models/User.js';
import { UnauthorizedError } from '../utils/errors.js';

/**
 * Authentication middleware.
 * Extracts the JWT from the `token` cookie, verifies it, and attaches
 * the user document to `req.user`. Returns 401 if the token is missing,
 * expired, or belongs to a non-existent user.
 */
export const authenticate = async (req, _res, next) => {
  try {
    const token = req.cookies?.token;

    if (!token) {
      return next(new UnauthorizedError('Authentication required'));
    }

    let payload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET);
    } catch {
      return next(new UnauthorizedError('Invalid or expired token'));
    }

    const user = await User.findById(payload.sub).select('-passwordHash');
    if (!user) {
      return next(new UnauthorizedError('User no longer exists'));
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
