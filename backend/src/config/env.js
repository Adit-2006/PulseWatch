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
