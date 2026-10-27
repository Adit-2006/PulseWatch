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
  getMonitorAlerts,
  updateMonitorAlerts,
  getMonitorStatsController,
  getMonitorResponseTimesController,
  togglePublicPageController,
} from '../controllers/monitor.controller.js';

const router = Router();

// All monitor endpoints are protected behind authentication
router.use(authenticate);

router.post('/', createMonitor);
router.get('/', getMonitors);
router.get('/:id', getMonitorById);
router.get('/:id/stats', getMonitorStatsController);
router.get('/:id/response-times', getMonitorResponseTimesController);
router.get('/:id/incidents', getMonitorIncidents);
router.get('/:id/alerts', getMonitorAlerts);
router.patch('/:id/alerts', updateMonitorAlerts);
router.put('/:id/alerts', updateMonitorAlerts);
router.post('/:id/public', togglePublicPageController);
router.patch('/:id/public', togglePublicPageController);
router.patch('/:id', updateMonitor);
router.delete('/:id', deleteMonitor);
router.post('/:id/pause', pauseMonitor);
router.post('/:id/resume', resumeMonitor);

export default router;
