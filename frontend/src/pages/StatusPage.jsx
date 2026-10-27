import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { SkeletonCard } from '../components/Skeleton.jsx';

/**
 * Public Status Page
 *
 * "Mist & Ink" design specifications:
 * - Centered single column layout
 * - Large Instrument Serif headline ("All systems operating normally.")
 * - 90 slim rounded bars for daily uptime
 * - Dot with soft halo status indicator (no colored badge pills)
 * - Warm and human copy tone, full sentences, no jargon or emoji
 */
export default function StatusPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredDay, setHoveredDay] = useState(null);

  const fetchStatus = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const res = await api.getPublicStatus(slug);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchStatus(true);
    const interval = setInterval(() => {
      fetchStatus(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Overall 90-day uptime average
  const avg90DayUptime = useMemo(() => {
    if (!data?.dailyUptime || data.dailyUptime.length === 0) return '100.0';
    const sum = data.dailyUptime.reduce((acc, d) => acc + (d.uptimePercentage ?? 100), 0);
    return (sum / data.dailyUptime.length).toFixed(1);
  }, [data]);

  const getBarColor = (uptime) => {
    if (uptime === null || uptime === undefined) return '#ECEFEE'; // hairline subtle
    if (uptime >= 99) return '#2A8C7B'; // operational teal
    if (uptime >= 95) return '#C98A1E'; // degraded amber
    return '#C4533F'; // downtime coral
  };

  if (loading) {
    return (
      <div className="status-centered-column">
        <SkeletonCard />
      </div>
    );
  }

  if (error) {
    const isNotFound = error.status === 404;
    return (
      <div className="status-centered-column">
        <div className="card status-error-stationery-card">
          <h1 className="error-serif-headline">
            {isNotFound ? 'Status page not found.' : 'Service information unavailable.'}
          </h1>
          <p className="error-plain-explanation">
            {isNotFound
              ? 'This public status page does not exist or has been made private.'
              : 'We were unable to load the latest status information for this service.'}
          </p>
          <div style={{ marginTop: '24px' }}>
            {isNotFound ? (
              <Link to="/" className="btn btn-primary pill-btn-lg">
                Return home
              </Link>
            ) : (
              <button
                type="button"
                className="btn btn-primary pill-btn-lg"
                onClick={() => fetchStatus(true)}
              >
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isOperational = data.status === 'UP';

  return (
    <div className="status-centered-column">
      {/* Top Header with Wordmark and Service Name */}
      <header className="status-page-header">
        <div className="status-brand-line">
          <span className="status-brand-title">PulseWatch</span>
          <span className="status-brand-divider" aria-hidden="true">&bull;</span>
          <span className="status-page-kicker">Public status report</span>
        </div>
        <h1 className="status-service-name">{data.name}</h1>
      </header>

      {/* Large Serif Headline */}
      <section className="status-headline-section" aria-label="Current system status">
        <h2 className="status-serif-headline">
          {isOperational
            ? 'All systems operating normally.'
            : 'Service disruption reported.'}
        </h2>

        <div className="status-headline-meta">
          <StatusBadge status={data.status} />
          <span className="status-meta-separator" aria-hidden="true">&bull;</span>
          <span className="status-refresh-note">
            Refreshed automatically every 30 seconds
          </span>
        </div>
      </section>

      {/* 90 Slim Rounded Bars for Daily Uptime */}
      <section className="card status-stationery-card" aria-labelledby="ninety-day-title">
        <div className="uptime-section-top">
          <div>
            <h3 id="ninety-day-title" className="card-section-title">
              Ninety-day reliability
            </h3>
            <p className="card-section-subtitle">
              Daily availability recorded over the past 90 consecutive calendar days.
            </p>
          </div>

          <div className="uptime-serif-metric">
            <span className="serif-stat-number">{avg90DayUptime}%</span>
            <span className="serif-stat-label">Average uptime</span>
          </div>
        </div>

        {/* 90 Slim Rounded Bars */}
        <div className="uptime-bars-wrapper" style={{ position: 'relative' }}>
          <div
            className="uptime-bars-row"
            role="img"
            aria-label={`90 day uptime history. Average uptime is ${avg90DayUptime} percent.`}
          >
            {(data.dailyUptime || []).map((day, idx) => (
              <div
                key={day.date || idx}
                className="uptime-slim-rounded-bar"
                style={{
                  backgroundColor: getBarColor(day.uptimePercentage),
                }}
                onMouseEnter={() => setHoveredDay(day)}
                onMouseLeave={() => setHoveredDay(null)}
                onFocus={() => setHoveredDay(day)}
                tabIndex="0"
                role="button"
                aria-label={`${day.date}: ${day.uptimePercentage ?? 100}% uptime`}
              />
            ))}
          </div>

          {/* Interactive Tooltip on Hover */}
          {hoveredDay && (
            <div className="bar-stationery-tooltip">
              <span className="tooltip-date-text">{hoveredDay.date}</span>
              <span className="tooltip-uptime-text">
                {hoveredDay.uptimePercentage !== undefined && hoveredDay.uptimePercentage !== null
                  ? `${hoveredDay.uptimePercentage}% uptime`
                  : 'No checks recorded'}
              </span>
            </div>
          )}
        </div>

        <div className="uptime-legend-row">
          <span>90 days ago</span>
          <div className="uptime-legend-indicators">
            <span className="legend-sample-operational" aria-hidden="true" />
            <span className="legend-label">Operational</span>
            <span className="legend-sample-amber" aria-hidden="true" />
            <span className="legend-label">Degraded</span>
            <span className="legend-sample-coral" aria-hidden="true" />
            <span className="legend-label">Downtime</span>
          </div>
          <span>Today</span>
        </div>
      </section>

      {/* Recent Incidents Section */}
      <section className="card status-stationery-card" aria-labelledby="recent-incidents-title">
        <h3 id="recent-incidents-title" className="card-section-title">
          Past incidents &amp; events
        </h3>

        {!data.recentIncidents || data.recentIncidents.length === 0 ? (
          <p className="no-incidents-text">
            No service incidents or downtime were reported during the past 90 days.
          </p>
        ) : (
          <div className="status-incidents-list">
            {data.recentIncidents.map((inc, i) => (
              <article key={i} className="status-incident-entry">
                <div className="incident-date-column">
                  <span className="incident-calendar-date">
                    {new Date(inc.startedAt).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                  <span className="incident-time-stamp">
                    {new Date(inc.startedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <div className="incident-narrative-column">
                  <div className="incident-status-row">
                    <StatusBadge status={inc.resolvedAt ? 'UP' : 'DOWN'} />
                    {inc.duration !== undefined && (
                      <span className="incident-duration-text">
                        Duration: {Math.max(1, Math.round(inc.duration / 60000))} min
                      </span>
                    )}
                  </div>
                  <p className="incident-explanation">
                    {inc.error || 'Health probes failed consecutive check thresholds.'}
                  </p>
                  {inc.resolvedAt && (
                    <span className="incident-resolution-text">
                      Resolved on {new Date(inc.resolvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Minimal Editorial Footer */}
      <footer className="status-page-centered-footer">
        <span>Powered by </span>
        <Link to="/" className="footer-ink-link">
          PulseWatch
        </Link>
        <span> &mdash; Quiet, reliable uptime observation.</span>
      </footer>
    </div>
  );
}
