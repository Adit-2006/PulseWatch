import React from 'react';

/**
 * ApiErrorScreen
 *
 * "Mist & Ink" requirements:
 * - Short serif headline
 * - Coral text with a plain explanation and a retry action, never raw error codes
 * - Single primary pill button
 */
export default function ApiErrorScreen({ onRetry, message }) {
  return (
    <div className="api-error-editorial-canvas" role="alert">
      <div className="card api-error-stationery-card">
        <h1 className="error-serif-headline">We could not reach the server.</h1>
        <p className="error-coral-explanation">
          {message && !message.includes('HTTP') && !message.includes('500')
            ? message
            : 'The connection to our observation service was interrupted. Please ensure your connection is active and try again.'}
        </p>

        <div className="error-action-row">
          <button
            type="button"
            className="btn btn-primary pill-btn-lg"
            onClick={onRetry || (() => window.location.reload())}
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
