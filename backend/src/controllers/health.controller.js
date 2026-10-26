import { getConnectionState } from '../config/db.js';

/**
 * Controller for health check endpoint
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const getHealth = (req, res) => {
  const dbState = getConnectionState();

  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      status: dbState,
    },
  });
};
