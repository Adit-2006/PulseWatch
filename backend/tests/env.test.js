import { describe, it, expect } from 'vitest';
import { envSchema } from '../src/config/env.js';

describe('Environment Configuration Validation', () => {
  it('should validate valid environment configuration successfully', () => {
    const validEnv = {
      PORT: '5000',
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://localhost:27017/pulsewatch_test',
      CORS_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: 'info',
    };

    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(5000);
      expect(result.data.NODE_ENV).toBe('test');
      expect(result.data.MONGODB_URI).toBe('mongodb://localhost:27017/pulsewatch_test');
    }
  });

  it('should fail fast if MONGODB_URI is missing or empty', () => {
    const invalidEnv = {
      PORT: '5000',
      NODE_ENV: 'test',
      MONGODB_URI: '',
    };

    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('MONGODB_URI'));
      expect(issue).toBeDefined();
    }
  });

  it('should fail if NODE_ENV has an invalid value', () => {
    const invalidEnv = {
      MONGODB_URI: 'mongodb://localhost:27017/pulsewatch_test',
      NODE_ENV: 'invalid_mode',
    };

    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
  });
});
