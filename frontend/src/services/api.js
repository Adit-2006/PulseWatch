/**
 * Centralized API client helper for PulseWatch backend.
 * Automatically handles credentials (httpOnly cookies), JSON parsing,
 * 401 redirects, and network unreachable errors.
 */

const BASE_URL = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Core fetch wrapper with timeout and standardized error handling.
 */
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const config = {
    ...options,
    headers,
    credentials: 'include', // Include httpOnly JWT cookies
  };

  try {
    const response = await fetch(url, config);

    // 401 Unauthorized handling on protected routes
    if (response.status === 401 && !endpoint.includes('/api/auth/login') && !endpoint.includes('/api/auth/register') && !endpoint.includes('/api/auth/me')) {
      // Dispatch custom event so AuthContext can handle redirect cleanly
      window.dispatchEvent(new CustomEvent('pulsewatch:unauthorized'));
    }

    let data = null;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    }

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ||
        data?.message ||
        `Request failed with HTTP ${response.status}`;
      const errorCode = data?.error?.code || data?.code || 'API_ERROR';
      const details = data?.error?.details || data?.details || null;
      throw new ApiError(errorMessage, response.status, errorCode, details);
    }

    return data;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }

    // Network / connection / server unreachable errors
    throw new ApiError(
      'Unable to connect to PulseWatch server. Please check your network connection.',
      0,
      'NETWORK_ERROR',
      err.message
    );
  }
}

export const api = {
  // Auth
  register: (email, password) =>
    request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email, password) =>
    request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () =>
    request('/api/auth/logout', {
      method: 'POST',
    }),

  getMe: () => request('/api/auth/me'),

  // Monitors
  getMonitors: (params = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page);
    if (params.limit) query.append('limit', params.limit);
    if (params.search) query.append('search', params.search);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/monitors${qs}`);
  },

  getMonitor: (id) => request(`/api/monitors/${id}`),

  createMonitor: (monitorData) =>
    request('/api/monitors', {
      method: 'POST',
      body: JSON.stringify(monitorData),
    }),

  updateMonitor: (id, monitorData) =>
    request(`/api/monitors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(monitorData),
    }),

  deleteMonitor: (id) =>
    request(`/api/monitors/${id}`, {
      method: 'DELETE',
    }),

  pauseMonitor: (id) =>
    request(`/api/monitors/${id}/pause`, {
      method: 'POST',
    }),

  resumeMonitor: (id) =>
    request(`/api/monitors/${id}/resume`, {
      method: 'POST',
    }),

  // Analytics & Detail
  getMonitorStats: (id) => request(`/api/monitors/${id}/stats`),

  getMonitorResponseTimes: (id, range = '24h') =>
    request(`/api/monitors/${id}/response-times?range=${range}`),

  getMonitorChecks: (id, params = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page);
    if (params.limit) query.append('limit', params.limit);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/monitors/${id}/checks${qs}`);
  },

  getMonitorIncidents: (id, params = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page);
    if (params.limit) query.append('limit', params.limit);
    if (params.status) query.append('status', params.status);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/monitors/${id}/incidents${qs}`);
  },

  // Alert Settings
  getMonitorAlerts: (id) => request(`/api/monitors/${id}/alerts`),

  updateMonitorAlerts: (id, alertsData) =>
    request(`/api/monitors/${id}/alerts`, {
      method: 'PATCH',
      body: JSON.stringify(alertsData),
    }),

  // Public Status Toggle
  togglePublicPage: (id, { isPublic, publicSlug }) =>
    request(`/api/monitors/${id}/public`, {
      method: 'POST',
      body: JSON.stringify({ isPublic, publicSlug }),
    }),

  // Public Status Page (Unauthenticated)
  getPublicStatus: (publicSlug) => request(`/api/status/${publicSlug}`),
};

export default api;
