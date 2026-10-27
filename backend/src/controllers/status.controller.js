import { getPublicStatusBySlug } from '../services/analytics.service.js';
import { NotFoundError } from '../utils/errors.js';

/**
 * GET /api/status/:publicSlug
 * Public read-only status page for a monitor.
 * Exposes NO private fields (no user info, alert settings, or internal ids).
 * Returns 404 for unknown or disabled slugs.
 */
export const getPublicStatus = async (req, res, next) => {
  try {
    const { publicSlug } = req.params;

    const statusPage = await getPublicStatusBySlug(publicSlug);

    if (!statusPage) {
      throw new NotFoundError(`Status page '${publicSlug}' not found or is disabled`);
    }

    res.status(200).json(statusPage);
  } catch (err) {
    next(err);
  }
};

export default {
  getPublicStatus,
};
