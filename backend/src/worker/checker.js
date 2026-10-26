import { performance } from 'perf_hooks';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;

/**
 * Format a human-readable error message from network errors.
 *
 * @param {Error} err
 * @param {number} timeoutMs
 * @returns {string}
 */
export function formatErrorMessage(err, timeoutMs) {
  if (!err) return 'Unknown error occurred';

  // Timeout / Abort errors
  if (
    err.name === 'AbortError' ||
    err.name === 'TimeoutError' ||
    err.code === 'ETIMEDOUT' ||
    err.message?.toLowerCase().includes('timeout') ||
    err.message?.toLowerCase().includes('abort')
  ) {
    return `Request timed out after ${timeoutMs}ms`;
  }

  // DNS failures
  if (
    err.code === 'ENOTFOUND' ||
    err.code === 'EAI_AGAIN' ||
    err.message?.includes('ENOTFOUND') ||
    err.message?.includes('getaddrinfo')
  ) {
    return 'DNS resolution failed: hostname could not be resolved';
  }

  // Connection refused
  if (
    err.code === 'ECONNREFUSED' ||
    err.message?.includes('ECONNREFUSED')
  ) {
    return 'Connection refused by server';
  }

  // Connection reset
  if (
    err.code === 'ECONNRESET' ||
    err.message?.includes('ECONNRESET')
  ) {
    return 'Connection reset by peer';
  }

  // SSL / TLS errors
  if (
    err.code?.startsWith('CERT_') ||
    err.message?.includes('certificate') ||
    err.message?.includes('SSL') ||
    err.message?.includes('TLS')
  ) {
    return `SSL/TLS error: ${err.message}`;
  }

  // Redirect limit
  if (err.message?.includes('Maximum redirect limit')) {
    return err.message;
  }

  return err.message || 'Network error';
}

/**
 * Perform an HTTP/HTTPS health check on a monitor.
 *
 * @param {Object} monitor - Monitor document or plain object
 * @param {Object} [options]
 * @param {Function} [options.fetchFn] - Custom fetch function for mocking/testing
 * @param {number} [options.maxRedirects=5] - Maximum redirects to follow
 * @returns {Promise<{
 *   status: 'UP' | 'DOWN',
 *   statusCode: number | null,
 *   responseTimeMs: number,
 *   errorMessage: string | null
 * }>}
 */
export async function executeCheck(monitor, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const timeoutMs = monitor.timeoutMs || DEFAULT_TIMEOUT_MS;
  const method = (monitor.method || 'GET').toUpperCase();
  const startTime = performance.now();

  let currentUrl = monitor.url;
  let redirectCount = 0;
  let finalResponse = null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Timeout of ${timeoutMs}ms exceeded`));
  }, timeoutMs);

  try {
    while (true) {
      const response = await fetchFn(currentUrl, {
        method: redirectCount === 0 ? method : 'GET', // RFC standards: redirect with GET unless 307/308
        signal: controller.signal,
        redirect: 'manual', // Manually control redirect limits
        headers: {
          'User-Agent': 'PulseWatch-Monitor/1.0 (+https://pulsewatch.dev)',
          Accept: '*/*',
        },
      });

      // Check if response is a redirect (301, 302, 303, 307, 308)
      const isRedirect =
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.get('location');

      if (isRedirect) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          throw new Error(`Maximum redirect limit (${maxRedirects}) exceeded`);
        }

        const location = response.headers.get('location');
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      finalResponse = response;
      break;
    }

    const duration = Math.round(performance.now() - startTime);
    const statusCode = finalResponse.status;

    // Up / Down classification
    const expected = monitor.expectedStatus;
    const isUp = expected ? statusCode === expected : statusCode >= 200 && statusCode < 300;

    let errorMessage = null;
    if (!isUp) {
      errorMessage = expected
        ? `Expected status ${expected} but received ${statusCode}`
        : `Expected 2xx status code but received ${statusCode}`;
    }

    return {
      status: isUp ? 'UP' : 'DOWN',
      statusCode,
      responseTimeMs: duration,
      errorMessage,
    };
  } catch (err) {
    const duration = Math.round(performance.now() - startTime);
    const errorMessage = formatErrorMessage(err, timeoutMs);

    return {
      status: 'DOWN',
      statusCode: null,
      responseTimeMs: duration,
      errorMessage,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
