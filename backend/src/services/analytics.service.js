import mongoose from 'mongoose';
import CheckResult from '../models/CheckResult.js';
import Incident from '../models/Incident.js';
import Monitor from '../models/Monitor.js';

/**
 * Format uptime percentage to 2 decimal places.
 * If totalChecks is 0 (period with no data), returns 100.
 *
 * @param {number} upChecks
 * @param {number} totalChecks
 * @returns {number}
 */
export function calculateUptimePercentage(upChecks = 0, totalChecks = 0) {
  if (totalChecks === 0) {
    return 100;
  }
  return Number(((upChecks / totalChecks) * 100).toFixed(2));
}

/**
 * Compute uptime percentage for 24h, 7d, and 30d, average and p95 response time,
 * and total incidents using MongoDB aggregation pipeline.
 *
 * The pipeline utilizes the compound index { monitorId: 1, checkedAt: -1 }.
 *
 * @param {string|import('mongoose').Types.ObjectId} monitorId
 * @returns {Promise<Object>}
 */
export async function getMonitorStats(monitorId) {
  const monitorObjectId =
    typeof monitorId === 'string' ? new mongoose.Types.ObjectId(monitorId) : monitorId;

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [aggResult, totalIncidents] = await Promise.all([
    CheckResult.aggregate([
      // Uses compound index { monitorId: 1, checkedAt: -1 }
      {
        $match: {
          monitorId: monitorObjectId,
          checkedAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $facet: {
          stats24h: [
            { $match: { checkedAt: { $gte: oneDayAgo } } },
            {
              $group: {
                _id: null,
                totalChecks: { $sum: 1 },
                upChecks: { $sum: { $cond: [{ $eq: ['$status', 'UP'] }, 1, 0] } },
                avgResponseTime: { $avg: '$responseTimeMs' },
                p95ResponseTime: {
                  $percentile: {
                    input: '$responseTimeMs',
                    p: [0.95],
                    method: 'approximate',
                  },
                },
              },
            },
          ],
          stats7d: [
            { $match: { checkedAt: { $gte: sevenDaysAgo } } },
            {
              $group: {
                _id: null,
                totalChecks: { $sum: 1 },
                upChecks: { $sum: { $cond: [{ $eq: ['$status', 'UP'] }, 1, 0] } },
              },
            },
          ],
          stats30d: [
            {
              $group: {
                _id: null,
                totalChecks: { $sum: 1 },
                upChecks: { $sum: { $cond: [{ $eq: ['$status', 'UP'] }, 1, 0] } },
              },
            },
          ],
          overallTimes: [
            { $match: { responseTimeMs: { $ne: null } } },
            {
              $group: {
                _id: null,
                avgResponseTime: { $avg: '$responseTimeMs' },
                p95ResponseTime: {
                  $percentile: {
                    input: '$responseTimeMs',
                    p: [0.95],
                    method: 'approximate',
                  },
                },
              },
            },
          ],
        },
      },
    ]),
    Incident.countDocuments({ monitorId: monitorObjectId }),
  ]);

  const facet = aggResult[0] || {};

  const s24 = facet.stats24h?.[0];
  const s7 = facet.stats7d?.[0];
  const s30 = facet.stats30d?.[0];
  const ot = facet.overallTimes?.[0];

  const uptime24h = calculateUptimePercentage(s24?.upChecks ?? 0, s24?.totalChecks ?? 0);
  const uptime7d = calculateUptimePercentage(s7?.upChecks ?? 0, s7?.totalChecks ?? 0);
  const uptime30d = calculateUptimePercentage(s30?.upChecks ?? 0, s30?.totalChecks ?? 0);

  // Response time: prioritize 24h, fallback to overall, or null if no checks
  const avgRaw = s24?.avgResponseTime ?? ot?.avgResponseTime ?? null;
  const avgResponseTimeMs = avgRaw !== null ? Number(avgRaw.toFixed(1)) : null;

  const p95Raw = s24?.p95ResponseTime?.[0] ?? ot?.p95ResponseTime?.[0] ?? null;
  const p95ResponseTimeMs = p95Raw !== null ? Number(p95Raw.toFixed(1)) : null;

  return {
    uptime: {
      '24h': uptime24h,
      '7d': uptime7d,
      '30d': uptime30d,
    },
    avgResponseTimeMs,
    p95ResponseTimeMs,
    totalIncidents,
  };
}

/**
 * Return time-bucketed series for chart rendering using MongoDB aggregation.
 * Bucket size is automatically selected based on requested range.
 *
 * Range options:
 *   - '1h':  1-minute buckets
 *   - '24h': 1-hour buckets
 *   - '7d':  6-hour buckets
 *   - '30d': 1-day buckets
 *
 * The pipeline utilizes the compound index { monitorId: 1, checkedAt: -1 }.
 *
 * @param {string|import('mongoose').Types.ObjectId} monitorId
 * @param {string} [range='24h']
 * @returns {Promise<Object>}
 */
export async function getMonitorResponseTimes(monitorId, range = '24h') {
  const monitorObjectId =
    typeof monitorId === 'string' ? new mongoose.Types.ObjectId(monitorId) : monitorId;

  const now = new Date();
  let startTime;
  let bucketUnit;
  let binSize = 1;

  switch (range) {
    case '1h':
      startTime = new Date(now.getTime() - 60 * 60 * 1000);
      bucketUnit = 'minute';
      binSize = 1;
      break;
    case '7d':
      startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      bucketUnit = 'hour';
      binSize = 6;
      break;
    case '30d':
      startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      bucketUnit = 'day';
      binSize = 1;
      break;
    case '24h':
    default:
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      bucketUnit = 'hour';
      binSize = 1;
      break;
  }

  const pipeline = [
    // Uses compound index { monitorId: 1, checkedAt: -1 }
    {
      $match: {
        monitorId: monitorObjectId,
        checkedAt: { $gte: startTime },
        responseTimeMs: { $ne: null },
      },
    },
    {
      $group: {
        _id: {
          $dateTrunc: {
            date: '$checkedAt',
            unit: bucketUnit,
            ...(binSize > 1 ? { binSize } : {}),
          },
        },
        avgResponseTimeMs: { $avg: '$responseTimeMs' },
        p95ResponseTimeMs: {
          $percentile: {
            input: '$responseTimeMs',
            p: [0.95],
            method: 'approximate',
          },
        },
        minResponseTimeMs: { $min: '$responseTimeMs' },
        maxResponseTimeMs: { $max: '$responseTimeMs' },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { _id: 1 },
    },
    {
      $project: {
        _id: 0,
        timestamp: '$_id',
        avgResponseTimeMs: { $round: ['$avgResponseTimeMs', 1] },
        p95ResponseTimeMs: {
          $ifNull: [
            { $round: [{ $arrayElemAt: ['$p95ResponseTimeMs', 0] }, 1] },
            { $round: ['$avgResponseTimeMs', 1] },
          ],
        },
        minResponseTimeMs: '$minResponseTimeMs',
        maxResponseTimeMs: '$maxResponseTimeMs',
        count: '$count',
      },
    },
  ];

  const series = await CheckResult.aggregate(pipeline);

  return {
    range,
    bucketUnit,
    binSize,
    series,
  };
}

/**
 * Get public status page data by publicSlug.
 * Exposes NO private fields (no user info, alert settings, or internal ids).
 * Returns null if the monitor is not found or isPublic is false.
 *
 * @param {string} publicSlug
 * @returns {Promise<Object|null>}
 */
export async function getPublicStatusBySlug(publicSlug) {
  if (!publicSlug) return null;

  const monitor = await Monitor.findOne({ publicSlug }).lean();

  if (!monitor || !monitor.isPublic) {
    return null;
  }

  // 1. Current status: if OPEN incident exists -> DOWN, otherwise latest check or UP
  const openIncident = await Incident.findOne({
    monitorId: monitor._id,
    status: 'OPEN',
  }).lean();

  let currentStatus = 'UP';
  if (openIncident) {
    currentStatus = 'DOWN';
  } else {
    const latestCheck = await CheckResult.findOne({ monitorId: monitor._id })
      .sort({ checkedAt: -1 })
      .lean();
    if (latestCheck) {
      currentStatus = latestCheck.status;
    }
  }

  // 2. 90-day daily uptime using aggregation pipeline
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const dailyAgg = await CheckResult.aggregate([
    {
      $match: {
        monitorId: monitor._id,
        checkedAt: { $gte: ninetyDaysAgo },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$checkedAt' } },
        totalChecks: { $sum: 1 },
        upChecks: { $sum: { $cond: [{ $eq: ['$status', 'UP'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const dailyMap = new Map();
  let total90dChecks = 0;
  let total90dUpChecks = 0;

  for (const entry of dailyAgg) {
    dailyMap.set(entry._id, entry);
    total90dChecks += entry.totalChecks;
    total90dUpChecks += entry.upChecks;
  }

  // Build contiguous 90-day array (oldest to newest)
  const dailyUptime = [];
  for (let d = 89; d >= 0; d--) {
    const dayDate = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
    const dateStr = dayDate.toISOString().split('T')[0];
    const data = dailyMap.get(dateStr);

    if (data) {
      dailyUptime.push({
        date: dateStr,
        uptimePercentage: calculateUptimePercentage(data.upChecks, data.totalChecks),
        totalChecks: data.totalChecks,
        upChecks: data.upChecks,
      });
    } else {
      // Period with no data defaults to 100% uptime with 0 checks
      dailyUptime.push({
        date: dateStr,
        uptimePercentage: 100,
        totalChecks: 0,
        upChecks: 0,
      });
    }
  }

  const uptime90d = calculateUptimePercentage(total90dUpChecks, total90dChecks);

  // 3. Recent incidents (public sanitized data, no internal IDs or user data)
  const incidents = await Incident.find({ monitorId: monitor._id })
    .sort({ startedAt: -1 })
    .limit(10)
    .lean();

  const recentIncidents = incidents.map((inc) => ({
    status: inc.status,
    startedAt: inc.startedAt,
    resolvedAt: inc.resolvedAt,
    duration: inc.duration,
    failureCount: inc.failureCount,
    lastErrorMessage: inc.lastErrorMessage,
  }));

  // Clean public response: strictly no private fields (no userId, no alerts, no internal id)
  return {
    name: monitor.name,
    status: currentStatus,
    publicSlug: monitor.publicSlug,
    uptime90d,
    dailyUptime,
    recentIncidents,
    incidents: recentIncidents,
  };
}

export default {
  calculateUptimePercentage,
  getMonitorStats,
  getMonitorResponseTimes,
  getPublicStatusBySlug,
};
