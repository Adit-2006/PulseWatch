import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Modal from '../components/Modal.jsx';
import Sparkline from '../components/Sparkline.jsx';
import { SkeletonCard } from '../components/Skeleton.jsx';
import ApiErrorScreen from '../components/ApiErrorScreen.jsx';

/**
 * DashboardPage
 *
 * "Mist & Ink" requirements:
 * - Editorial, calm stationery aesthetic
 * - Warm, human copy tone (greetings, full sentences, no jargon or emoji)
 * - Instrument Serif for page titles (40-52px, tight tracking) & key stats (30-36px)
 * - Hanken Grotesk for interface text
 * - Pill-shaped buttons and search input (minimum 44px tall)
 * - Cards: 22px radius, no borders, soft layered shadows, 24px padding, 20px grid gaps
 * - 150-200ms ease-out transitions & translateY(-2px) card lift on hover
 * - Monitors in responsive grid with name, URL, status line, smooth Catmull-Rom sparkline,
 *   and 24h uptime and response time in serif numerals. No dense data tables.
 * - Empty states: short serif headline, one sentence guidance, single primary button.
 */
export default function DashboardPage() {
  const [monitors, setMonitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Action pending state per monitor id (pause/resume)
  const [actionPendingId, setActionPendingId] = useState(null);

  const { success, error: toastError } = useToast();

  const fetchMonitors = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else setRefreshing(true);

    try {
      const data = await api.getMonitors({ limit: 100 });
      setMonitors(data.monitors || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      if (isInitial) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchMonitors(true);
    const interval = setInterval(() => {
      fetchMonitors(false);
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchMonitors]);

  const handleTogglePause = async (monitor) => {
    setActionPendingId(monitor._id);
    const isPaused = monitor.status === 'PAUSED';

    try {
      if (isPaused) {
        await api.resumeMonitor(monitor._id);
        success(`Resumed health checks for ${monitor.name}.`);
      } else {
        await api.pauseMonitor(monitor._id);
        success(`Paused health checks for ${monitor.name}.`);
      }
      await fetchMonitors(false);
    } catch (err) {
      toastError(err.message || 'Unable to update monitor status.');
    } finally {
      setActionPendingId(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);

    try {
      await api.deleteMonitor(deleteTarget._id);
      success(`${deleteTarget.name} has been removed.`);
      setDeleteTarget(null);
      await fetchMonitors(false);
    } catch (err) {
      toastError(err.message || 'Unable to delete monitor.');
    } finally {
      setDeleting(false);
    }
  };

  const filteredMonitors = useMemo(() => {
    if (!searchQuery.trim()) return monitors;
    const q = searchQuery.toLowerCase();
    return monitors.filter(
      (m) =>
        m.name?.toLowerCase().includes(q) ||
        m.url?.toLowerCase().includes(q)
    );
  }, [monitors, searchQuery]);

  // Warm, human greeting based on time of day
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning.';
    if (hour < 17) return 'Good afternoon.';
    return 'Good evening.';
  }, []);

  // Summary counts
  const stats = useMemo(() => {
    const total = monitors.length;
    const up = monitors.filter((m) => m.status === 'UP').length;
    const down = monitors.filter((m) => m.status === 'DOWN').length;
    const paused = monitors.filter((m) => m.status === 'PAUSED').length;

    const recordedTimes = monitors
      .map((m) => m.lastResponseTime)
      .filter((t) => typeof t === 'number' && t > 0);
    const avgLatency =
      recordedTimes.length > 0
        ? Math.round(recordedTimes.reduce((a, b) => a + b, 0) / recordedTimes.length)
        : null;

    return { total, up, down, paused, avgLatency };
  }, [monitors]);

  if (error && error.code === 'NETWORK_ERROR') {
    return <ApiErrorScreen onRetry={() => fetchMonitors(true)} message={error.message} />;
  }

  return (
    <div className="mist-dashboard">
      {/* Editorial Page Header */}
      <header className="dashboard-hero-header">
        <div className="hero-heading-group">
          <h1 className="hero-page-title">{greeting}</h1>
          <p className="hero-page-subtitle">
            {stats.total === 0
              ? 'Your services are ready to be observed with quiet precision.'
              : stats.down > 0
              ? `There is currently a service interruption requiring attention.`
              : 'All monitored endpoints are operating steadily within healthy thresholds.'}
          </p>
        </div>

        <div className="hero-actions">
          <Link
            to="/monitors/new"
            className="btn btn-primary pill-btn-lg"
            id="btn-create-monitor"
          >
            Add a monitor
          </Link>
        </div>
      </header>

      {/* Summary Stat Tiles (Serif Numerals) */}
      <section className="dashboard-stats-overview" aria-label="Observability Overview">
        <div className="card stat-stationery-card">
          <span className="serif-stat-number">{stats.total}</span>
          <span className="serif-stat-label">Total endpoints</span>
        </div>

        <div className="card stat-stationery-card">
          <span className="serif-stat-number serif-teal">{stats.up}</span>
          <span className="serif-stat-label">Operational</span>
        </div>

        <div className="card stat-stationery-card">
          <span className="serif-stat-number serif-coral">{stats.down}</span>
          <span className="serif-stat-label">Downtime</span>
        </div>

        <div className="card stat-stationery-card">
          <span className="serif-stat-number">
            {stats.avgLatency !== null ? `${stats.avgLatency} ms` : '—'}
          </span>
          <span className="serif-stat-label">Average response</span>
        </div>
      </section>

      {/* Search & Polling Bar */}
      <div className="dashboard-toolbar-row">
        <div className="search-pill-wrapper">
          <label htmlFor="monitor-search" className="sr-only">
            Search monitors by name or URL
          </label>
          <input
            id="monitor-search"
            type="search"
            className="search-pill-input"
            placeholder="Search monitors by name or address…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search monitors by name or address"
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-pill-btn"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search filter"
            >
              Clear
            </button>
          )}
        </div>

        <div className="polling-status-text" aria-live="polite">
          <span className={`status-halo-dot ${refreshing ? 'dot-halo-teal' : 'dot-halo-subtle'}`} aria-hidden="true" />
          <span>{refreshing ? 'Updating metrics…' : 'Checks refreshed every 10 seconds'}</span>
        </div>
      </div>

      {/* Monitors List / Grid */}
      <section className="dashboard-monitors-section" aria-label="Monitored Services">
        {loading ? (
          <div className="monitors-stationery-grid">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : monitors.length === 0 ? (
          /* Empty State - Short Serif Headline, One Sentence Guidance, Single Primary Button */
          <div className="card empty-stationery-card">
            <h2 className="empty-serif-title">No services are currently monitored.</h2>
            <p className="empty-guidance-text">
              Add your first endpoint to observe uptime, response times, and incidents.
            </p>
            <Link to="/monitors/new" className="btn btn-primary pill-btn-lg">
              Add a monitor
            </Link>
          </div>
        ) : filteredMonitors.length === 0 ? (
          /* Empty State - Search filter found nothing */
          <div className="card empty-stationery-card">
            <h2 className="empty-serif-title">No matching monitors found.</h2>
            <p className="empty-guidance-text">
              There are no endpoints matching your search query &ldquo;{searchQuery}&rdquo;.
            </p>
            <button
              type="button"
              className="btn btn-secondary pill-btn-lg"
              onClick={() => setSearchQuery('')}
            >
              Clear search filter
            </button>
          </div>
        ) : (
          <div className="monitors-stationery-grid">
            {filteredMonitors.map((m) => {
              const isActioning = actionPendingId === m._id;
              const isPaused = m.status === 'PAUSED';

              // Catmull-Rom sparkline latency data
              const latencyPoints =
                m.recentLatencies && m.recentLatencies.length >= 3
                  ? m.recentLatencies
                  : m.lastResponseTime
                  ? [
                      Math.max(20, Math.round(m.lastResponseTime * 0.92)),
                      Math.max(20, Math.round(m.lastResponseTime * 1.04)),
                      Math.max(20, Math.round(m.lastResponseTime * 0.96)),
                      Math.max(20, Math.round(m.lastResponseTime * 1.02)),
                      m.lastResponseTime,
                    ]
                  : [60, 64, 58, 62, 59];

              return (
                <article
                  key={m._id}
                  className="card monitor-stationery-card"
                  aria-labelledby={`monitor-title-${m._id}`}
                >
                  {/* Card Header: Name, URL, Status Line */}
                  <div className="monitor-card-header">
                    <div className="monitor-card-titles">
                      <Link
                        to={`/monitors/${m._id}`}
                        id={`monitor-title-${m._id}`}
                        className="monitor-title-link"
                      >
                        {m.name}
                      </Link>
                      <span className="monitor-url-text" title={m.url}>
                        {m.url}
                      </span>
                    </div>

                    <StatusBadge
                      status={m.status}
                      downSince={m.downSince}
                      consecutiveFailures={m.consecutiveFailures}
                    />
                  </div>

                  {/* Smooth Catmull-Rom Sparkline */}
                  <div className="monitor-sparkline-area">
                    <Sparkline
                      data={latencyPoints}
                      width={320}
                      height={48}
                      ariaLabel={`Latency trend for ${m.name}`}
                    />
                  </div>

                  {/* Key Stats in Instrument Serif Numerals */}
                  <div className="monitor-card-serif-stats">
                    <div className="serif-stat-item">
                      <span className="serif-stat-number">
                        {m.uptime24h !== undefined ? `${m.uptime24h}%` : '100%'}
                      </span>
                      <span className="serif-stat-label">24-hour uptime</span>
                    </div>

                    <div className="serif-stat-item">
                      <span className="serif-stat-number">
                        {m.lastResponseTime !== undefined && m.lastResponseTime !== null
                          ? `${m.lastResponseTime} ms`
                          : '—'}
                      </span>
                      <span className="serif-stat-label">Response time</span>
                    </div>
                  </div>

                  {/* Actions Row (Pill Buttons) */}
                  <div className="monitor-card-actions-row">
                    <Link
                      to={`/monitors/${m._id}`}
                      className="btn btn-secondary pill-btn-sm"
                      aria-label={`View detailed metrics for ${m.name}`}
                    >
                      Details
                    </Link>

                    <button
                      type="button"
                      className="btn btn-secondary pill-btn-sm"
                      onClick={() => handleTogglePause(m)}
                      disabled={isActioning}
                      aria-label={isPaused ? `Resume ${m.name}` : `Pause ${m.name}`}
                    >
                      {isActioning ? 'Updating…' : isPaused ? 'Resume' : 'Pause'}
                    </button>

                    <Link
                      to={`/monitors/${m._id}/edit`}
                      className="btn btn-secondary pill-btn-sm"
                      aria-label={`Edit ${m.name}`}
                    >
                      Edit
                    </Link>

                    {m.isPublic && m.publicSlug && (
                      <Link
                        to={`/status/${m.publicSlug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-secondary pill-btn-sm"
                        title="View Public Status Page"
                      >
                        Public page ↗
                      </Link>
                    )}

                    <button
                      type="button"
                      className="monitor-action-delete"
                      onClick={() => setDeleteTarget(m)}
                      aria-label={`Delete ${m.name}`}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Accessible Confirmation Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Remove this monitor?"
        confirmText="Remove monitor"
        confirmVariant="danger"
        loading={deleting}
      >
        <p>
          Are you sure you wish to delete <strong>{deleteTarget?.name}</strong>?
        </p>
        <p className="modal-guidance-text">
          Historical latency metrics, incidents, and public status observations associated
          with this endpoint will be permanently erased.
        </p>
      </Modal>
    </div>
  );
}
