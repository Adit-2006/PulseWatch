import { z } from 'zod';

/** Allowed HTTP methods for monitors */
export const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Whitelisted fields allowed on PATCH /api/monitors/:id */
export const ALLOWED_UPDATE_FIELDS = [
  'name',
  'url',
  'method',
  'intervalSeconds',
  'timeoutMs',
  'expectedStatus',
  'failureThreshold',
  'isPublic',
];

/** Base URL schema: must be http or https */
const urlSchema = z
  .string({ required_error: 'URL is required' })
  .trim()
  .min(1, 'URL cannot be empty')
  .max(2048, 'URL cannot exceed 2048 characters')
  .refine(
    (val) => {
      try {
        const u = new URL(val);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'URL must start with http:// or https:// and be a valid URL' }
  );

/** Schema for creating a new monitor */
export const createMonitorSchema = z.object({
  name: z
    .string({ required_error: 'Monitor name is required' })
    .trim()
    .min(1, 'Monitor name cannot be empty')
    .max(100, 'Monitor name cannot exceed 100 characters'),
  url: urlSchema,
  method: z.enum(ALLOWED_METHODS, {
    errorMap: () => ({ message: `Method must be one of: ${ALLOWED_METHODS.join(', ')}` }),
  }).default('GET'),
  intervalSeconds: z.coerce
    .number({ invalid_type_error: 'Interval must be a number' })
    .int('Interval must be an integer')
    .min(30, 'Interval must be between 30 and 3600 seconds')
    .max(3600, 'Interval must be between 30 and 3600 seconds')
    .default(60),
  timeoutMs: z.coerce
    .number({ invalid_type_error: 'Timeout must be a number' })
    .int('Timeout must be an integer')
    .min(1000, 'Timeout must be between 1000 and 30000 ms')
    .max(30000, 'Timeout must be between 1000 and 30000 ms')
    .default(5000),
  expectedStatus: z.coerce
    .number({ invalid_type_error: 'Expected status must be a number' })
    .int('Expected status must be an integer')
    .min(100, 'Expected status must be between 100 and 599')
    .max(599, 'Expected status must be between 100 and 599')
    .default(200),
  failureThreshold: z.coerce
    .number({ invalid_type_error: 'Failure threshold must be a number' })
    .int('Failure threshold must be an integer')
    .min(1, 'Failure threshold must be between 1 and 10')
    .max(10, 'Failure threshold must be between 1 and 10')
    .default(3),
  isPublic: z.boolean().default(false),
});

/** Schema for updating an existing monitor (PATCH) */
export const updateMonitorSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Monitor name cannot be empty')
      .max(100, 'Monitor name cannot exceed 100 characters')
      .optional(),
    url: urlSchema.optional(),
    method: z.enum(ALLOWED_METHODS).optional(),
    intervalSeconds: z.coerce
      .number()
      .int('Interval must be an integer')
      .min(30, 'Interval must be between 30 and 3600 seconds')
      .max(3600, 'Interval must be between 30 and 3600 seconds')
      .optional(),
    timeoutMs: z.coerce
      .number()
      .int('Timeout must be an integer')
      .min(1000, 'Timeout must be between 1000 and 30000 ms')
      .max(30000, 'Timeout must be between 1000 and 30000 ms')
      .optional(),
    expectedStatus: z.coerce
      .number()
      .int('Expected status must be an integer')
      .min(100, 'Expected status must be between 100 and 599')
      .max(599, 'Expected status must be between 100 and 599')
      .optional(),
    failureThreshold: z.coerce
      .number()
      .int('Failure threshold must be an integer')
      .min(1, 'Failure threshold must be between 1 and 10')
      .max(10, 'Failure threshold must be between 1 and 10')
      .optional(),
    isPublic: z.boolean().optional(),
  })
  .strict();

/** Schema for query parameters on GET /api/monitors */
export const queryMonitorsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
});

/** Schema for query parameters on GET /api/monitors/:id/incidents */
export const queryIncidentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(['OPEN', 'RESOLVED']).optional(),
});
