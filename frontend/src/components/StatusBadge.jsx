import React from 'react';

/**
 * StatusBadge component
 *
 * "Mist & Ink" design specifications:
 * - 8px dot with a soft 4px halo (teal when up, coral when down)
 * - Next to a plain-language label ("Operational", "Down for 12 min")
 * - Never use colored badge pills (no pill container, no background capsule)
 * - Color is never the only indicator of status
 */
export default function StatusBadge({
  status = 'PENDING',
  downSince,
  consecutiveFailures,
  className = '',
}) {
  const normalized = (status || 'PENDING').toUpperCase();

  const getFormat = () => {
    switch (normalized) {
      case 'UP':
      case 'OPERATIONAL':
        return {
          dotClass: 'dot-halo-teal',
          label: 'Operational',
          aria: 'Status: Operational',
        };

      case 'DOWN':
      case 'CRITICAL': {
        let label = 'Down';
        if (downSince) {
          const diffMinutes = Math.max(
            1,
            Math.floor((Date.now() - new Date(downSince).getTime()) / 60000)
          );
          label = `Down for ${diffMinutes} min`;
        } else if (consecutiveFailures && consecutiveFailures > 1) {
          label = `Down (${consecutiveFailures} probe failures)`;
        }
        return {
          dotClass: 'dot-halo-coral',
          label,
          aria: `Status: ${label}`,
        };
      }

      case 'DEGRADED':
        return {
          dotClass: 'dot-halo-amber',
          label: 'Degraded',
          aria: 'Status: Degraded performance',
        };

      case 'PAUSED':
        return {
          dotClass: 'dot-halo-slate',
          label: 'Paused',
          aria: 'Status: Health checks paused',
        };

      default:
        return {
          dotClass: 'dot-halo-subtle',
          label: 'Pending check',
          aria: 'Status: Pending initial health check',
        };
    }
  };

  const { dotClass, label, aria } = getFormat();

  return (
    <span className={`stationery-status-line ${className}`} role="status" aria-label={aria}>
      <span className={`status-halo-dot ${dotClass}`} aria-hidden="true" />
      <span className="status-plain-text">{label}</span>
    </span>
  );
}
