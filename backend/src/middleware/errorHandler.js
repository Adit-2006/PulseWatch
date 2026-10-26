import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';

/**
 * Centralized error handling middleware.
 * Ensures all responses adhere to the standard JSON error schema:
 * { error: { code: string, message: string } }
 */
export const errorHandler = (err, req, res, _next) => {
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred';

  // 1. Custom Application Errors
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
  }
  // 2. Zod Validation Errors
  else if (err instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = err.issues
      .map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`)
      .join('; ');
  }
  // 3. Mongoose Validation Errors
  else if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join('; ');
  }
  // 4. Mongoose Cast Error (invalid ObjectId)
  else if (err.name === 'CastError') {
    statusCode = 400;
    code = 'INVALID_ID';
    message = `Invalid format for field '${err.path}'`;
  }
  // 5. MongoDB Duplicate Key (Code 11000)
  else if (err.code === 11000) {
    statusCode = 409;
    code = 'DUPLICATE_RESOURCE';
    const fields = Object.keys(err.keyValue || {}).join(', ');
    message = `A resource with this ${fields || 'key'} already exists`;
  }
  // 6. JSON Parse Error (malformed body)
  else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Request body contains invalid JSON';
  }
  // 7. CORS origin rejection
  else if (err.message && err.message.includes('CORS')) {
    statusCode = 403;
    code = 'CORS_NOT_ALLOWED';
    message = err.message;
  }
  // 8. Unhandled Operational / System Errors
  else {
    if (env.NODE_ENV !== 'test') {
      console.error('💥 Unhandled Exception:', err);
    }
    if (env.NODE_ENV === 'development') {
      message = err.message || message;
    }
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
    },
  });
};
