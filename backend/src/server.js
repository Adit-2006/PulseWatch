import { env } from './config/env.js';
import { app } from './app.js';
import { connectDB, setupGracefulShutdown } from './config/db.js';
import { MonitoringWorker } from './worker/index.js';

const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Start in-process monitoring worker if configured
    let worker = null;
    if (env.START_WORKER_IN_PROCESS) {
      console.log('⚡ START_WORKER_IN_PROCESS is enabled: launching monitoring worker in-process');
      worker = new MonitoringWorker();
      worker.start();
    }

    // 3. Start HTTP server
    const server = app.listen(env.PORT, () => {
      console.log(`🚀 PulseWatch Backend running in [${env.NODE_ENV}] mode on port ${env.PORT}`);
      console.log(`📡 Health Check: http://localhost:${env.PORT}/api/health`);
    });

    // 4. Register graceful shutdown
    setupGracefulShutdown(server, worker);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
  process.exit(1);
});

startServer();
