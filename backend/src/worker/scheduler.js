import Monitor from '../models/Monitor.js';

const DEFAULT_LEASE_DURATION_MS = 30000;

/**
 * Atomically claim a single due monitor using findOneAndUpdate.
 *
 * Conditions for claiming:
 * - isPaused: false
 * - nextCheckAt <= now
 * - lockedUntil is null, does not exist, or has expired (lockedUntil <= now)
 *
 * Updates:
 * - Sets lockedUntil to now + leaseDurationMs (a short lease)
 *
 * This atomic operation guarantees that even across multiple distributed worker processes,
 * no monitor is ever checked concurrently twice.
 *
 * @param {number} [leaseDurationMs=30000] - Duration of the lock lease in milliseconds
 * @returns {Promise<import('mongoose').Document | null>} The claimed monitor or null
 */
export async function claimDueMonitor(leaseDurationMs = DEFAULT_LEASE_DURATION_MS) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

  return await Monitor.findOneAndUpdate(
    {
      isPaused: false,
      nextCheckAt: { $lte: now },
      $or: [
        { lockedUntil: null },
        { lockedUntil: { $exists: false } },
        { lockedUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        lockedUntil: leaseExpiresAt,
      },
    },
    {
      new: true,
      sort: { nextCheckAt: 1 }, // Prioritize most overdue monitors first
    }
  );
}

/**
 * Claim up to `maxCount` due monitors atomically.
 *
 * @param {number} maxCount - Maximum number of monitors to claim
 * @param {number} [leaseDurationMs=30000] - Lease duration in milliseconds
 * @returns {Promise<Array<import('mongoose').Document>>} List of claimed monitors
 */
export async function claimDueMonitors(maxCount, leaseDurationMs = DEFAULT_LEASE_DURATION_MS) {
  if (maxCount <= 0) return [];

  const claimed = [];
  for (let i = 0; i < maxCount; i++) {
    const monitor = await claimDueMonitor(leaseDurationMs);
    if (!monitor) break;
    claimed.push(monitor);
  }

  return claimed;
}

/**
 * Release a monitor's lock and schedule its next check.
 *
 * @param {string | import('mongoose').Types.ObjectId} monitorId
 * @param {number} [intervalSeconds=60]
 * @returns {Promise<import('mongoose').Document | null>}
 */
export async function releaseMonitorLock(monitorId, intervalSeconds = 60) {
  const nextCheckAt = new Date(Date.now() + intervalSeconds * 1000);
  return await Monitor.findByIdAndUpdate(
    monitorId,
    {
      $set: {
        lockedUntil: null,
        nextCheckAt,
      },
    },
    { new: true }
  );
}
