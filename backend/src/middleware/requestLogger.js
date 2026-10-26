import morgan from 'morgan';
import { env } from '../config/env.js';

export const requestLogger =
  env.NODE_ENV === 'test'
    ? (req, res, next) => next()
    : morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev');
