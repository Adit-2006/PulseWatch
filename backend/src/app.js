import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { NotFoundError } from './utils/errors.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import monitorRoutes from './routes/monitor.routes.js';
import statusRoutes from './routes/status.routes.js';
import demoRoutes from './routes/demo.routes.js';

export const createApp = () => {
  const app = express();

  // 1. Security Headers via Helmet
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    })
  );

  // 2. Strict CORS policy from environment
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server health probes)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        if (env.NODE_ENV !== 'production' && allowedOrigins.includes('*')) {
          return callback(null, true);
        }
        return callback(new Error(`CORS origin '${origin}' is not permitted by policy`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      maxAge: 86400,
    })
  );

  // 3. Request body parsing with strict size limits (100kb DoS mitigation)
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(cookieParser());

  // 4. NoSQL injection sanitizer (strips keys containing $ or .)
  app.use(
    mongoSanitize({
      replaceWith: '_',
    })
  );

  // 5. Request Logging
  app.use(requestLogger);

  // 6. API Routes
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/monitors', monitorRoutes);
  app.use('/api/status', statusRoutes);

  // 7. Demo Outage Helper Route (enabled only when ENABLE_DEMO_ROUTES=true)
  if (env.ENABLE_DEMO_ROUTES) {
    app.use('/api/demo', demoRoutes);
  }

  // 8. Catch-all 404 for undefined routes
  app.use((req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
  });

  // 9. Centralized Error Handling
  app.use(errorHandler);

  return app;
};

export const app = createApp();
