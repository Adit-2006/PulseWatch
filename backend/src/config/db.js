import mongoose from 'mongoose';
import { env } from './env.js';

const CONNECTION_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * Returns human-readable state of MongoDB connection
 * @returns {string} Connection state name
 */
export const getConnectionState = () => {
  return CONNECTION_STATES[mongoose.connection.readyState] || 'unknown';
};

/**
 * Connect to MongoDB with retry logic and error logging
 * @param {string} [uri] - Optional MongoDB connection URI override
 * @returns {Promise<typeof mongoose>}
 */
export const connectDB = async (uri = env.MONGODB_URI) => {
  try {
    mongoose.connection.on('connected', () => {
      console.log('✅ MongoDB connected successfully');
    });

    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected');
    });

    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });

    return conn;
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
    if (env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    throw error;
  }
};

/**
 * Gracefully close MongoDB connection
 * @returns {Promise<void>}
 */
export const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
    console.log('🔒 MongoDB connection closed cleanly');
  }
};

/**
 * Setup graceful shutdown handlers for process termination signals
 * @param {import('http').Server} [server] - Optional HTTP server instance to close
 */
export const setupGracefulShutdown = (server) => {
  const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          console.log('🔌 HTTP server stopped accepting connections');
          resolve();
        });
      });
    }

    try {
      await disconnectDB();
      console.log('✨ Graceful shutdown completed. Exiting process.');
      process.exit(0);
    } catch (err) {
      console.error('❌ Error during graceful shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};
