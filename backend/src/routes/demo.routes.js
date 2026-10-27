import express from 'express';

const router = express.Router();

/**
 * In-memory state for the demo outage trigger.
 * Default: healthy (200).
 */
let demoState = {
  failing: false,
  statusCode: 500,
  message: 'Simulated endpoint outage triggered for demonstration',
  lastToggledAt: null,
};

/**
 * Reset demo state helper (useful for automated tests).
 */
export const resetDemoState = () => {
  demoState = {
    failing: false,
    statusCode: 500,
    message: 'Simulated endpoint outage triggered for demonstration',
    lastToggledAt: null,
  };
};

/**
 * GET /api/demo/probe
 * Probe target endpoint that monitors can target.
 * Returns 200 (healthy) by default, or 500 (outage) when toggled.
 */
router.get('/probe', (_req, res) => {
  if (demoState.failing) {
    return res.status(demoState.statusCode).json({
      status: 'DOWN',
      statusCode: demoState.statusCode,
      message: demoState.message,
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(200).json({
    status: 'OPERATIONAL',
    statusCode: 200,
    message: 'Demo probe endpoint is operational and healthy.',
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/demo/toggle
 * Toggle or explicitly set the probe endpoint failure state.
 * Body (optional): { failing?: boolean, statusCode?: number, message?: string }
 */
router.post('/toggle', (req, res) => {
  const { failing, statusCode, message } = req.body || {};

  if (typeof failing === 'boolean') {
    demoState.failing = failing;
  } else {
    demoState.failing = !demoState.failing;
  }

  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 599) {
    demoState.statusCode = statusCode;
  } else if (!demoState.failing) {
    demoState.statusCode = 200;
  } else if (demoState.failing && demoState.statusCode === 200) {
    demoState.statusCode = 500;
  }

  if (typeof message === 'string' && message.trim()) {
    demoState.message = message.trim();
  }

  demoState.lastToggledAt = new Date().toISOString();

  return res.status(200).json({
    success: true,
    failing: demoState.failing,
    probeStatus: demoState.failing ? demoState.statusCode : 200,
    message: demoState.failing
      ? `Outage active: /api/demo/probe will now respond with HTTP ${demoState.statusCode}`
      : 'Service restored: /api/demo/probe will now respond with HTTP 200',
    lastToggledAt: demoState.lastToggledAt,
  });
});

/**
 * GET /api/demo/status
 * Get the current toggle status without affecting the probe.
 */
router.get('/status', (_req, res) => {
  return res.status(200).json({
    enabled: true,
    failing: demoState.failing,
    probeStatus: demoState.failing ? demoState.statusCode : 200,
    message: demoState.message,
    lastToggledAt: demoState.lastToggledAt,
  });
});

export default router;
