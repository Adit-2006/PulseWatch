import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { NotFoundError } from './utils/errors.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';

export const createApp = () => {
  const app = express();

  // 1. CORS configuration from environment
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS origin '${origin}' is not allowed by policy`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // 2. Request body parsing & cookies
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // 3. Request Logging
  app.use(requestLogger);

  // 4. API Routes
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);

  // 5. Catch-all 404 for undefined routes
  app.use((req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
  });

  // 6. Centralized Error Handling
  app.use(errorHandler);

  return app;
};

export const app = createApp();
