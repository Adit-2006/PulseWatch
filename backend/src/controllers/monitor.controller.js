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
  ALLOWED_UPDATE_FIELDS,
} from '../validators/monitor.validators.js';
import { validateUrlAgainstSSRF } from '../utils/ssrf.js';
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';

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
      throw new BadRequestError('At least one field must be provided for update', 'VALIDATION_ERROR');
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
