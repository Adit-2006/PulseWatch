import mongoose from 'mongoose';
import Monitor from '../models/Monitor.js';
import CheckResult from '../models/CheckResult.js';
import Incident from '../models/Incident.js';
import AlertLog from '../models/AlertLog.js';
import { env } from '../config/env.js';
import {
  createMonitorSchema,
  updateMonitorSchema,
  queryMonitorsSchema,
  queryIncidentsSchema,
  updateAlertsSchema,
  queryResponseTimesSchema,
  togglePublicPageSchema,
  ALLOWED_UPDATE_FIELDS,
} from '../validators/monitor.validators.js';
import { getMonitorStats, getMonitorResponseTimes } from '../services/analytics.service.js';
import { validateUrlAgainstSSRF } from '../utils/ssrf.js';
import { BadRequestError, NotFoundError, ConflictError } from '../utils/errors.js';

/**
 * Helper to escape special characters in user input for safe RegExp usage.
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate that an ID parameter is a valid MongoDB ObjectId.
 */
function assertValidObjectId(id) {
  if (!id || !mongoose.isValidObjectId(id)) {
    throw new BadRequestError(`Invalid monitor ID format: '${id}'`, 'INVALID_ID');
  }
}

/**
 * POST /api/monitors
 * Create a new monitor belonging to the authenticated user.
 */
export const createMonitor = async (req, res, next) => {
  try {
    // 1. Check user monitor limit (configurable via env)
    const maxMonitors = process.env.MAX_MONITORS_PER_USER
      ? Number(process.env.MAX_MONITORS_PER_USER)
      : env.MAX_MONITORS_PER_USER;

    const currentCount = await Monitor.countDocuments({ userId: req.user._id });
    if (currentCount >= maxMonitors) {
      throw new BadRequestError(
        `Monitor limit reached. Maximum allowed: ${maxMonitors}`,
        'MONITOR_LIMIT_REACHED'
      );
    }

    // 2. Validate input schema with Zod
    const validatedData = createMonitorSchema.parse(req.body);

    // 3. SSRF Protection: verify target URL does not resolve to private/local/link-local IP
    await validateUrlAgainstSSRF(validatedData.url);

    // 4. Set nextCheckAt on creation
    const nextCheckAt = new Date(Date.now() + validatedData.intervalSeconds * 1000);

    // 5. Create monitor
    const monitor = await Monitor.create({
      ...validatedData,
      userId: req.user._id,
      nextCheckAt,
    });

    res.status(201).json({ monitor });
  } catch (err) {
    // Duplicate URL for the same user (compound unique index: userId, url)
    if (err.code === 11000) {
      return next(new ConflictError('A monitor with this URL already exists for your account'));
    }
    next(err);
  }
};

/**
 * GET /api/monitors
 * List monitors belonging to the authenticated user with pagination and search filter.
 */
export const getMonitors = async (req, res, next) => {
  try {
    const { page, limit, search } = queryMonitorsSchema.parse(req.query);

    const filter = { userId: req.user._id };

    if (search && search.length > 0) {
      const escaped = escapeRegex(search);
      const searchRegex = new RegExp(escaped, 'i');
      filter.$or = [{ name: searchRegex }, { url: searchRegex }];
    }

    const total = await Monitor.countDocuments(filter);
    const monitors = await Monitor.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.status(200).json({
      monitors,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/monitors/:id
 * Retrieve a single monitor by ID, enforcing user ownership.
 */
export const getMonitorById = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const monitor = await Monitor.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    res.status(200).json({ monitor });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/monitors/:id
 * Update monitor fields with strict whitelisting and NoSQL operator rejection.
 */
export const updateMonitor = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const keys = Object.keys(req.body);
    if (keys.length === 0) {
      throw new BadRequestError(
        'At least one field must be provided for update',
        'VALIDATION_ERROR'
      );
    }

    // Whitelist updatable fields and reject NoSQL operator injection ($)
    for (const key of keys) {
      if (key.startsWith('$')) {
        throw new BadRequestError(
          'Invalid field name: operator keys starting with $ are not permitted',
          'INVALID_FIELD'
        );
      }
      if (!ALLOWED_UPDATE_FIELDS.includes(key)) {
        throw new BadRequestError(`Field '${key}' is not allowed for update`, 'INVALID_FIELD');
      }
    }

    const validatedData = updateMonitorSchema.parse(req.body);

    // If URL is being updated, perform SSRF validation
    if (validatedData.url) {
      await validateUrlAgainstSSRF(validatedData.url);
    }

    const monitor = await Monitor.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: validatedData },
      { new: true, runValidators: true }
    );

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    res.status(200).json({ monitor });
  } catch (err) {
    if (err.code === 11000) {
      return next(new ConflictError('A monitor with this URL already exists for your account'));
    }
    next(err);
  }
};

/**
 * DELETE /api/monitors/:id
 * Delete a monitor and cascade delete all associated check results, incidents, and alert logs.
 */
export const deleteMonitor = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const monitor = await Monitor.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    // 1. Find all incidents for this monitor to cascade delete their AlertLogs
    const incidents = await Incident.find({ monitorId: monitor._id }).select('_id');
    const incidentIds = incidents.map((inc) => inc._id);

    if (incidentIds.length > 0) {
      await AlertLog.deleteMany({ incidentId: { $in: incidentIds } });
    }

    // 2. Cascade delete Incidents
    await Incident.deleteMany({ monitorId: monitor._id });

    // 3. Cascade delete CheckResults
    await CheckResult.deleteMany({ monitorId: monitor._id });

    // 4. Delete the Monitor
    await Monitor.deleteOne({ _id: monitor._id });

    res.status(200).json({ message: 'Monitor deleted successfully' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/monitors/:id/pause
 * Pause an active monitor.
 */
export const pauseMonitor = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const monitor = await Monitor.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    monitor.isPaused = true;
    await monitor.save();

    res.status(200).json({ monitor });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/monitors/:id/resume
 * Resume a paused monitor and update nextCheckAt.
 */
export const resumeMonitor = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const monitor = await Monitor.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    // Set nextCheckAt on resume
    monitor.isPaused = false;
    monitor.nextCheckAt = new Date(Date.now() + monitor.intervalSeconds * 1000);
    await monitor.save();

    res.status(200).json({ monitor });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/monitors/:id/incidents
 * Retrieve paginated incidents for a monitor belonging to the authenticated user.
 */
export const getMonitorIncidents = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const monitor = await Monitor.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    const { page, limit, status } = queryIncidentsSchema.parse(req.query);

    const filter = { monitorId: monitor._id };
    if (status) {
      filter.status = status;
    }

    const total = await Incident.countDocuments(filter);
    const incidents = await Incident.find(filter)
      .sort({ startedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.status(200).json({
      incidents,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/monitors/:id/checks
 * Retrieve paginated recent check results for a monitor belonging to the authenticated user.
 */
export const getMonitorChecks = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const monitor = await Monitor.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const total = await CheckResult.countDocuments({ monitorId: monitor._id });
    const checks = await CheckResult.find({ monitorId: monitor._id })
      .sort({ checkedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.status(200).json({
      checks,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/monitors/:id/alerts
 * Retrieve alert settings for a monitor.
 */
export const getMonitorAlerts = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const monitor = await Monitor.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    const defaultAlerts = {
      email: { enabled: false, recipient: null },
      webhook: { enabled: false, url: null, hmacSecret: null },
    };

    res.status(200).json({
      alerts: monitor.alerts || defaultAlerts,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH / PUT /api/monitors/:id/alerts
 * Configure alert settings for a monitor.
 */
export const updateMonitorAlerts = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const monitor = await Monitor.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    const validatedAlerts = updateAlertsSchema.parse(req.body);

    // SSRF validation if webhook URL is provided
    if (validatedAlerts.webhook?.url) {
      await validateUrlAgainstSSRF(validatedAlerts.webhook.url);
    }

    const existingAlerts = monitor.alerts || {};
    const newEmail = validatedAlerts.email
      ? {
          enabled: validatedAlerts.email.enabled ?? existingAlerts.email?.enabled ?? false,
          recipient:
            validatedAlerts.email.recipient !== undefined
              ? validatedAlerts.email.recipient || null
              : (existingAlerts.email?.recipient ?? null),
        }
      : existingAlerts.email || { enabled: false, recipient: null };

    const newWebhook = validatedAlerts.webhook
      ? {
          enabled: validatedAlerts.webhook.enabled ?? existingAlerts.webhook?.enabled ?? false,
          url:
            validatedAlerts.webhook.url !== undefined
              ? validatedAlerts.webhook.url || null
              : (existingAlerts.webhook?.url ?? null),
          hmacSecret:
            validatedAlerts.webhook.hmacSecret !== undefined
              ? validatedAlerts.webhook.hmacSecret || null
              : (existingAlerts.webhook?.hmacSecret ?? null),
        }
      : existingAlerts.webhook || { enabled: false, url: null, hmacSecret: null };

    monitor.alerts = {
      email: newEmail,
      webhook: newWebhook,
    };

    await monitor.save();

    res.status(200).json({
      alerts: monitor.alerts,
      message: 'Alert settings updated successfully',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/monitors/:id/stats
 * Return uptime percentage for 24h, 7d, 30d, avg & p95 response time, and total incidents.
 */
export const getMonitorStatsController = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const monitor = await Monitor.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    const stats = await getMonitorStats(monitor._id);

    res.status(200).json({
      stats,
      uptime: stats.uptime,
      avgResponseTimeMs: stats.avgResponseTimeMs,
      p95ResponseTimeMs: stats.p95ResponseTimeMs,
      totalIncidents: stats.totalIncidents,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/monitors/:id/response-times
 * Return time-bucketed series for chart rendering using MongoDB aggregation pipelines.
 */
export const getMonitorResponseTimesController = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const monitor = await Monitor.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    const { range } = queryResponseTimesSchema.parse(req.query);
    const data = await getMonitorResponseTimes(monitor._id, range);

    res.status(200).json({
      range: data.range,
      bucketUnit: data.bucketUnit,
      binSize: data.binSize,
      series: data.series,
      responseTimes: data.series,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST / PATCH /api/monitors/:id/public
 * Allow owners to toggle a monitor's public status page on or off.
 */
export const togglePublicPageController = async (req, res, next) => {
  try {
    assertValidObjectId(req.params.id);

    const monitor = await Monitor.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!monitor) {
      throw new NotFoundError('Monitor not found');
    }

    const { isPublic, publicSlug } = togglePublicPageSchema.parse(req.body);

    monitor.isPublic = isPublic;

    if (publicSlug) {
      monitor.publicSlug = publicSlug;
    } else if (isPublic && !monitor.publicSlug) {
      const baseSlug = monitor.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const suffix = Math.random().toString(36).substring(2, 7);
      monitor.publicSlug = `${baseSlug || 'monitor'}-${suffix}`;
    }

    await monitor.save();

    res.status(200).json({
      monitor,
      isPublic: monitor.isPublic,
      publicSlug: monitor.publicSlug,
      message: monitor.isPublic ? 'Public status page enabled' : 'Public status page disabled',
    });
  } catch (err) {
    if (err.code === 11000) {
      return next(new ConflictError('A monitor with this public slug already exists'));
    }
    next(err);
  }
};
