import { Router } from 'express';
import { getPublicStatus } from '../controllers/status.controller.js';

const router = Router();

// Unauthenticated public route
router.get('/:publicSlug', getPublicStatus);

export default router;
