import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file if present
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z
    .string({
      required_error: 'MONGODB_URI environment variable is required',
    })
    .min(1, 'MONGODB_URI cannot be empty'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MAX_MONITORS_PER_USER: z.coerce.number().int().positive().default(50),
  JWT_SECRET: z
    .string({ required_error: 'JWT_SECRET environment variable is required' })
    .min(32, 'JWT_SECRET must be at least 32 characters for security'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  START_WORKER_IN_PROCESS: z.coerce.boolean().default(false),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WORKER_LEASE_DURATION_MS: z.coerce.number().int().positive().default(30000),
  EMAIL_PROVIDER: z.enum(['resend', 'smtp']).default('resend'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('alerts@pulsewatch.dev'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  ENABLE_DEMO_ROUTES: z.coerce.boolean().default(false),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  const formattedErrors = parseResult.error.issues
    .map((issue) => `  - [${issue.path.join('.')}]: ${issue.message}`)
    .join('\n');

  console.error('\n❌ Environment Variable Validation Failed:');
  console.error(formattedErrors);
  console.error('\nPlease check your .env file or environment configuration.\n');

  // In test environment, throw Error instead of process.exit so tests can assert fail-fast behavior
  if (process.env.NODE_ENV === 'test') {
    throw new Error(`Environment validation failed:\n${formattedErrors}`);
  }

  process.exit(1);
}

export const env = parseResult.data;
export { envSchema };
