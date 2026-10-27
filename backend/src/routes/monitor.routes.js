import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import {
  createMonitor,
  getMonitors,
  getMonitorById,
  updateMonitor,
  deleteMonitor,
  pauseMonitor,
  resumeMonitor,
  getMonitorIncidents,
} from '../controllers/monitor.controller.js';

const router = Router();

// All monitor endpoints are protected behind authentication
router.use(authenticate);

router.post('/', createMonitor);
router.get('/', getMonitors);
router.get('/:id', getMonitorById);
router.get('/:id/incidents', getMonitorIncidents);
router.patch('/:id', updateMonitor);
router.delete('/:id', deleteMonitor);
router.post('/:id/pause', pauseMonitor);
router.post('/:id/resume', resumeMonitor);

export default router;
