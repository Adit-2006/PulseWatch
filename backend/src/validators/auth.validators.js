import { z } from 'zod';

/**
 * Password must be at least 8 characters and contain:
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one special character
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password cannot exceed 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

export const registerSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Please provide a valid email address')
    .max(255, 'Email cannot exceed 255 characters')
    .transform((val) => val.toLowerCase().trim()),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Please provide a valid email address')
    .transform((val) => val.toLowerCase().trim()),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});
