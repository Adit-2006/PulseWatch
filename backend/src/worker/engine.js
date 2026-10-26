import Monitor from '../models/Monitor.js';
import CheckResult from '../models/CheckResult.js';
import { executeCheck } from './checker.js';
import { claimDueMonitors } from './scheduler.js';
import { env } from '../config/env.js';

export class MonitoringWorker {
  /**
   * @param {Object} [options]
   * @param {number} [options.pollIntervalMs] - Polling interval in ms (default: 3000)
   * @param {number} [options.concurrency] - Maximum concurrent checks (default: 5)
   * @param {number} [options.leaseDurationMs] - Lock lease duration in ms (default: 30000)
   * @param {Function} [options.fetchFn] - Custom fetch function for mocking/testing
   */
  constructor(options = {}) {
    this.pollIntervalMs =
      options.pollIntervalMs ?? env.WORKER_POLL_INTERVAL_MS ?? 3000;
    this.concurrency =
      options.concurrency ?? env.WORKER_CONCURRENCY ?? 5;
    this.leaseDurationMs =
      options.leaseDurationMs ?? env.WORKER_LEASE_DURATION_MS ?? 30000;
    this.fetchFn = options.fetchFn;

    this.isRunning = false;
    this.activeChecks = new Set();
    this.pollTimeout = null;
  }

  /**
   * Start the scheduler loop.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(
      `⚡ MonitoringWorker started (concurrency: ${this.concurrency}, poll: ${this.pollIntervalMs}ms, lease: ${this.leaseDurationMs}ms)`
    );
    this.tick();
  }

  /**
   * Single poll cycle: claims due monitors and executes checks within bounded concurrency.
   */
  async tick() {
    if (!this.isRunning) return;

    try {
      const availableCapacity = this.concurrency - this.activeChecks.size;

      if (availableCapacity > 0) {
        const monitors = await claimDueMonitors(availableCapacity, this.leaseDurationMs);

        for (const monitor of monitors) {
          const checkPromise = this.processMonitor(monitor);
          this.activeChecks.add(checkPromise);

          // Remove promise from active set when finished
          checkPromise.finally(() => {
            this.activeChecks.delete(checkPromise);
          });
        }
      }
    } catch (err) {
      // Loop cycle error should never crash the process
      console.error('⚠️ Error during worker tick cycle:', err.message);
    } finally {
      if (this.isRunning) {
        this.pollTimeout = setTimeout(() => this.tick(), this.pollIntervalMs);
      }
    }
  }

  /**
   * Process a single monitor check: performs HTTP check, saves CheckResult,
   * updates nextCheckAt and consecutiveFailures, and releases the lock.
   *
   * @param {import('mongoose').Document} monitor
   * @returns {Promise<void>}
   */
  async processMonitor(monitor) {
    try {
      // 1. Execute the HTTP check
      const result = await executeCheck(monitor, { fetchFn: this.fetchFn });

      // 2. Store the result in CheckResult collection
      await CheckResult.create({
        monitorId: monitor._id,
        status: result.status,
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
        errorMessage: result.errorMessage,
        checkedAt: new Date(),
      });

      // 3. Compute consecutive failures
      const consecutiveFailures =
        result.status === 'UP' ? 0 : (monitor.consecutiveFailures || 0) + 1;

      // 4. Update monitor: schedule next check, clear lock, update failures
      const nextCheckAt = new Date(Date.now() + (monitor.intervalSeconds || 60) * 1000);

      await Monitor.updateOne(
        { _id: monitor._id },
        {
          $set: {
            lockedUntil: null,
            nextCheckAt,
            consecutiveFailures,
          },
        }
      );
    } catch (err) {
      // One failing check must NEVER crash the loop
      console.error(`❌ Check failed for monitor ${monitor._id} (${monitor.name || monitor.url}):`, err.message);

      // Always release lock and schedule next check even on unexpected error
      try {
        const nextCheckAt = new Date(Date.now() + (monitor.intervalSeconds || 60) * 1000);
        await Monitor.updateOne(
          { _id: monitor._id },
          {
            $set: {
              lockedUntil: null,
              nextCheckAt,
            },
          }
        );
      } catch (lockErr) {
        console.error(`⚠️ Failed to release lock for monitor ${monitor._id}:`, lockErr.message);
      }
    }
  }

  /**
   * Gracefully stop the worker loop and wait for active checks to drain.
   *
   * @param {number} [timeoutMs=10000] - Maximum time to wait for in-flight checks
   * @returns {Promise<void>}
   */
  async stop(timeoutMs = 10000) {
    if (!this.isRunning && this.activeChecks.size === 0) return;

    this.isRunning = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }

    console.log(`⏳ MonitoringWorker stopping... Waiting for ${this.activeChecks.size} active check(s) to finish.`);

    if (this.activeChecks.size > 0) {
      const drainPromise = Promise.allSettled([...this.activeChecks]);
      let timeoutId;
      const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn('⚠️ Worker shutdown timeout exceeded while waiting for active checks');
          resolve();
        }, timeoutMs);
      });

      await Promise.race([drainPromise, timeoutPromise]);
      clearTimeout(timeoutId);
    }

    console.log('✅ MonitoringWorker stopped cleanly.');
  }
}
