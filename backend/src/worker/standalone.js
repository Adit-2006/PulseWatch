import { connectDB, disconnectDB } from '../config/db.js';
import { MonitoringWorker } from './engine.js';
import { env } from '../config/env.js';

const startStandaloneWorker = async () => {
  try {
    console.log(`🚀 Starting PulseWatch Standalone Worker in [${env.NODE_ENV}] mode...`);

    // 1. Connect to MongoDB
    await connectDB();

    // 2. Initialize and start worker
    const worker = new MonitoringWorker();
    worker.start();

    // 3. Graceful shutdown handler
    const shutdown = async (signal) => {
      console.log(`\n🛑 Received ${signal}. Shutting down worker...`);
      try {
        await worker.stop();
        await disconnectDB();
        console.log('✨ Standalone worker shutdown completed.');
        process.exit(0);
      } catch (err) {
        console.error('❌ Error during worker shutdown:', err);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('❌ Failed to start standalone worker:', err);
    process.exit(1);
  }
};

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception in worker:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection in worker:', reason);
  process.exit(1);
});

startStandaloneWorker();
