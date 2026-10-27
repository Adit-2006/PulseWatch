import Monitor from '../models/Monitor.js';
import Incident from '../models/Incident.js';

/**
 * Handle a DOWN check result:
 * - Atomically increments consecutiveFailures on the monitor with $inc.
 * - When consecutiveFailures reaches failureThreshold and no OPEN incident exists, creates one.
 * - If an OPEN incident already exists, updates its failure count and latest error message.
 * - Relies on the partial unique index and catches code 11000 gracefully to guarantee idempotency.
 *
 * @param {string|import('mongoose').Types.ObjectId} monitorId
 * @param {Object} checkResult - Check result data ({ status, errorMessage, checkedAt, ... })
 * @returns {Promise<Object>}
 */
export async function handleFailure(monitorId, checkResult = {}) {
  // 1. Atomically increment consecutiveFailures with $inc
  const monitor = await Monitor.findByIdAndUpdate(
    monitorId,
    { $inc: { consecutiveFailures: 1 } },
    { new: true }
  );

  if (!monitor) {
    return null;
  }

  const failureThreshold = monitor.failureThreshold ?? 3;

  // 2. Threshold not yet reached: do not open an incident
  if (monitor.consecutiveFailures < failureThreshold) {
    return {
      action: 'INCREMENT_FAILURES',
      consecutiveFailures: monitor.consecutiveFailures,
      failureThreshold,
      incident: null,
    };
  }

  // 3. Threshold reached: check for an existing OPEN incident
  const existingIncident = await Incident.findOne({
    monitorId: monitor._id,
    status: 'OPEN',
  });

  if (existingIncident) {
    // Repeated failure during an existing open incident
    const updatedIncident = await Incident.findOneAndUpdate(
      { _id: existingIncident._id, status: 'OPEN' },
      {
        $inc: { failureCount: 1 },
        $set: {
          ...(checkResult.errorMessage ? { lastErrorMessage: checkResult.errorMessage } : {}),
        },
      },
      { new: true }
    );

    return {
      action: 'UPDATE_OPEN_INCIDENT',
      consecutiveFailures: monitor.consecutiveFailures,
      incident: updatedIncident || existingIncident,
    };
  }

  // 4. No OPEN incident exists: create one atomically
  const startedAt = checkResult.checkedAt ? new Date(checkResult.checkedAt) : new Date();

  try {
    const newIncident = await Incident.create({
      monitorId: monitor._id,
      status: 'OPEN',
      startedAt,
      failureCount: monitor.consecutiveFailures,
      lastErrorMessage: checkResult.errorMessage || null,
    });

    return {
      action: 'OPEN_INCIDENT',
      consecutiveFailures: monitor.consecutiveFailures,
      incident: newIncident,
    };
  } catch (err) {
    // 5. Handle duplicate key error (11000) gracefully
    // Enforced by the partial unique index: unique_open_incident_per_monitor
    if (err.code === 11000) {
      const existing = await Incident.findOne({
        monitorId: monitor._id,
        status: 'OPEN',
      });
      return {
        action: 'INCIDENT_ALREADY_OPEN',
        consecutiveFailures: monitor.consecutiveFailures,
        incident: existing,
      };
    }
    throw err;
  }
}

/**
 * Handle an UP check result:
 * - Atomically resets consecutiveFailures to 0.
 * - If an OPEN incident exists, resolves it atomically using findOneAndUpdate with resolvedAt and duration.
 * - If no OPEN incident exists (e.g. single success before threshold), only resets counter.
 *
 * @param {string|import('mongoose').Types.ObjectId} monitorId
 * @param {Object} checkResult - Check result data ({ status, checkedAt, ... })
 * @returns {Promise<Object>}
 */
export async function handleRecovery(monitorId, checkResult = {}) {
  // 1. Atomically reset consecutiveFailures to 0
  const monitor = await Monitor.findByIdAndUpdate(
    monitorId,
    { $set: { consecutiveFailures: 0 } },
    { new: true }
  );

  if (!monitor) {
    return null;
  }

  // 2. Check if an OPEN incident exists
  const openIncident = await Incident.findOne({
    monitorId: monitor._id,
    status: 'OPEN',
  });

  if (!openIncident) {
    // A single success before threshold only resets the counter
    return {
      action: 'RESET_COUNTER',
      consecutiveFailures: 0,
      incident: null,
    };
  }

  // 3. Resolve the OPEN incident atomically using findOneAndUpdate
  // Prevents an incident from being resolved twice in concurrent scenarios
  const resolvedAt = checkResult.checkedAt ? new Date(checkResult.checkedAt) : new Date();
  const startedAtMs = new Date(openIncident.startedAt).getTime();
  const duration = Math.max(0, resolvedAt.getTime() - startedAtMs);

  const resolvedIncident = await Incident.findOneAndUpdate(
    { _id: openIncident._id, status: 'OPEN' },
    {
      $set: {
        status: 'RESOLVED',
        resolvedAt,
        duration,
      },
    },
    { new: true }
  );

  if (!resolvedIncident) {
    // Another concurrent process already resolved this incident
    const alreadyResolved = await Incident.findById(openIncident._id);
    return {
      action: 'ALREADY_RESOLVED',
      consecutiveFailures: 0,
      incident: alreadyResolved,
    };
  }

  return {
    action: 'RESOLVE_INCIDENT',
    consecutiveFailures: 0,
    incident: resolvedIncident,
  };
}

/**
 * Main entrypoint for processing incident lifecycle after a CheckResult.
 * Accepts either:
 *   - (checkResult)
 *   - (monitorId, checkResult)
 *   - (monitor, checkResult)
 *
 * @param {Object|string|import('mongoose').Types.ObjectId} arg1
 * @param {Object} [arg2]
 * @returns {Promise<Object>}
 */
export async function processCheckResult(arg1, arg2) {
  let monitorId;
  let checkResult;

  if (arg2 !== undefined) {
    monitorId = arg1?._id || arg1;
    checkResult = arg2;
  } else {
    checkResult = arg1;
    monitorId = checkResult?.monitorId?._id || checkResult?.monitorId;
  }

  if (!monitorId) {
    throw new Error('monitorId is required to process check result incident lifecycle');
  }

  if (checkResult?.status === 'DOWN') {
    return handleFailure(monitorId, checkResult);
  }

  if (checkResult?.status === 'UP') {
    return handleRecovery(monitorId, checkResult);
  }

  throw new Error(`Unsupported check status: '${checkResult?.status}'`);
}

export default {
  processCheckResult,
  handleFailure,
  handleRecovery,
};
