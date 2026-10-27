import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Modal from '../components/Modal.jsx';
import ResponseTimeChart from '../components/ResponseTimeChart.jsx';
import { SkeletonCard, SkeletonTable } from '../components/Skeleton.jsx';
import ApiErrorScreen from '../components/ApiErrorScreen.jsx';

export default function MonitorDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [monitor, setMonitor] = useState(null);
  const [stats, setStats] = useState(null);
  const [chartRange, setChartRange] = useState('24h');
  const [chartData, setChartData] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);

  const [activeTab, setActiveTab] = useState('checks');

  const [checks, setChecks] = useState([]);
  const [checksPagination, setChecksPagination] = useState({ page: 1, totalPages: 1 });
  const [checksLoading, setChecksLoading] = useState(false);

  const [incidents, setIncidents] = useState([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);

  const [alertSettings, setAlertSettings] = useState({
    email: { enabled: false, recipients: [] },
    webhook: { enabled: false, url: '', secret: '' },
  });
  const [recipientsInput, setRecipientsInput] = useState('');
  const [alertsSaving, setAlertsSaving] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionPending, setActionPending] = useState(false);

  const fetchMonitor = useCallback(
    async (isInitial = false) => {
      if (isInitial) setLoading(true);
      try {
        const [monData, statsData] = await Promise.all([
          api.getMonitor(id),
          api.getMonitorStats(id).catch(() => null),
        ]);
        setMonitor(monData.monitor);
        if (statsData) setStats(statsData);
        setError(null);
      } catch (err) {
        setError(err);
      } finally {
        if (isInitial) setLoading(false);
      }
    },
    [id]
  );

  const fetchChart = useCallback(
    async (range) => {
      setChartLoading(true);
      try {
        const data = await api.getMonitorResponseTimes(id, range);
        setChartData(data.series || []);
      } catch (err) {
        console.warn('Unable to load response times series:', err.message);
      } finally {
        setChartLoading(false);
      }
    },
    [id]
  );

  const fetchChecks = useCallback(
    async (page = 1) => {
      setChecksLoading(true);
      try {
        const data = await api.getMonitorChecks(id, { page, limit: 12 });
        setChecks(data.checks || []);
        setChecksPagination({
          page: data.pagination?.page || 1,
          totalPages: data.pagination?.totalPages || 1,
        });
      } catch (err) {
        console.warn('Unable to load checks:', err.message);
      } finally {
        setChecksLoading(false);
      }
    },
    [id]
  );

  const fetchIncidents = useCallback(async () => {
    setIncidentsLoading(true);
    try {
      const data = await api.getMonitorIncidents(id, { limit: 50 });
      setIncidents(data.incidents || []);
    } catch (err) {
      console.warn('Unable to load incidents:', err.message);
    } finally {
      setIncidentsLoading(false);
    }
  }, [id]);

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await api.getMonitorAlerts(id);
      if (data.alertSettings) {
        setAlertSettings({
          email: {
            enabled: Boolean(data.alertSettings.email?.enabled),
            recipients: data.alertSettings.email?.recipients || [],
          },
          webhook: {
            enabled: Boolean(data.alertSettings.webhook?.enabled),
            url: data.alertSettings.webhook?.url || '',
            secret: data.alertSettings.webhook?.secret || '',
          },
        });
        setRecipientsInput((data.alertSettings.email?.recipients || []).join(', '));
      }
    } catch (err) {
      console.warn('Unable to load alert settings:', err.message);
    }
  }, [id]);

  useEffect(() => {
    fetchMonitor(true);
    fetchChart(chartRange);
    fetchChecks(1);
    fetchIncidents();
    fetchAlerts();

    const interval = setInterval(() => {
      fetchMonitor(false);
      fetchChecks(1);
      fetchIncidents();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchMonitor, fetchChart, chartRange, fetchChecks, fetchIncidents, fetchAlerts]);

  const handleRangeChange = (newRange) => {
    setChartRange(newRange);
    fetchChart(newRange);
  };

  const handleTogglePause = async () => {
    if (!monitor) return;
    setActionPending(true);
    const isPaused = monitor.status === 'PAUSED';

    try {
      if (isPaused) {
        await api.resumeMonitor(monitor._id);
        success(`Resumed health checks for ${monitor.name}.`);
      } else {
        await api.pauseMonitor(monitor._id);
        success(`Paused health checks for ${monitor.name}.`);
      }
      await fetchMonitor(false);
    } catch (err) {
      toastError(err.message || 'Unable to update monitor state.');
    } finally {
      setActionPending(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteMonitor(id);
      success(`${monitor.name} has been removed.`);
      navigate('/');
    } catch (err) {
      toastError(err.message || 'Unable to delete monitor.');
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const handleSaveAlerts = async (e) => {
    e.preventDefault();
    setAlertsSaving(true);

    const emailRecipients = recipientsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const payload = {
      email: {
        enabled: alertSettings.email.enabled,
        recipients: emailRecipients,
      },
      webhook: {
        enabled: alertSettings.webhook.enabled,
        url: alertSettings.webhook.url.trim(),
        secret: alertSettings.webhook.secret.trim(),
      },
    };

    try {
      await api.updateMonitorAlerts(id, payload);
      success('Alert settings updated.');
      await fetchAlerts();
    } catch (err) {
      toastError(err.message || 'Unable to save alert settings.');
    } finally {
      setAlertsSaving(false);
    }
  };

  const formatDuration = (ms) => {
    if (!ms && ms !== 0) return 'Ongoing';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remSeconds}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  if (error && error.code === 'NETWORK_ERROR') {
    return <ApiErrorScreen onRetry={() => fetchMonitor(true)} message={error.message} />;
  }

  if (loading || !monitor) {
    return (
      <div className="page-wrapper">
        <SkeletonCard />
        <div style={{ marginTop: '20px' }}>
          <SkeletonTable rows={4} cols={5} />
        </div>
      </div>
    );
  }

  const isPaused = monitor.status === 'PAUSED';

  return (
    <div className="page-wrapper">
      {/* Back link */}
      <div className="page-top-nav">
        <Link to="/" className="editorial-back-link">
          &larr; Back to all monitors
        </Link>
      </div>

      {/* Monitor Header with Display Serif */}
      <header className="detail-editorial-header">
        <div className="detail-title-block">
          <h1 className="page-display-title">{monitor.name}.</h1>
          <div className="detail-subtitle-row">
            <span className="detail-method-label">{monitor.method || 'GET'}</span>
            <span className="detail-url-text" title={monitor.url}>
              {monitor.url}
            </span>
            <span className="detail-meta-dot">&bull;</span>
            <StatusBadge status={monitor.status} />
          </div>

          {monitor.isPublic && monitor.publicSlug && (
            <div style={{ marginTop: '12px' }}>
              <Link
                to={`/status/${monitor.publicSlug}`}
                target="_blank"
                rel="noreferrer"
                className="public-page-indicator"
              >
                Public status page at /status/{monitor.publicSlug} &rarr;
              </Link>
            </div>
          )}
        </div>

        <div className="detail-actions-cluster">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleTogglePause}
            disabled={actionPending}
          >
            {actionPending
              ? 'Updating…'
              : isPaused
                ? 'Resume health checks'
                : 'Pause health checks'}
          </button>

          <Link to={`/monitors/${id}/edit`} className="btn btn-secondary">
            Settings
          </Link>

          <button
            type="button"
            className="btn btn-coral-outline"
            onClick={() => setShowDeleteModal(true)}
          >
            Delete
          </button>
        </div>
      </header>

      {/* Stats row with Serif Numerals */}
      <section className="detail-stats-row" aria-label="Availability and latency metrics">
        <div className="card stat-tile">
          <span className="serif-stat-number">
            {stats?.uptime?.['24h'] !== undefined ? `${stats.uptime['24h']}%` : '100%'}
          </span>
          <span className="serif-stat-label">24-hour uptime</span>
        </div>

        <div className="card stat-tile">
          <span className="serif-stat-number">
            {stats?.uptime?.['7d'] !== undefined ? `${stats.uptime['7d']}%` : '100%'}
          </span>
          <span className="serif-stat-label">7-day uptime</span>
        </div>

        <div className="card stat-tile">
          <span className="serif-stat-number">
            {stats?.uptime?.['30d'] !== undefined ? `${stats.uptime['30d']}%` : '100%'}
          </span>
          <span className="serif-stat-label">30-day uptime</span>
        </div>

        <div className="card stat-tile">
          <span className="serif-stat-number">
            {stats?.avgResponseTime !== undefined ? `${stats.avgResponseTime} ms` : '—'}
          </span>
          <span className="serif-stat-label">Average latency</span>
        </div>

        <div className="card stat-tile">
          <span className="serif-stat-number">
            {stats?.p95ResponseTime !== undefined ? `${stats.p95ResponseTime} ms` : '—'}
          </span>
          <span className="serif-stat-label">p95 latency</span>
        </div>

        <div className="card stat-tile">
          <span className="serif-stat-number">
            {stats?.totalIncidents !== undefined ? stats.totalIncidents : '0'}
          </span>
          <span className="serif-stat-label">Total incidents</span>
        </div>
      </section>

      {/* Response Time Chart (Catmull-Rom curve, deep teal line) */}
      <ResponseTimeChart
        series={chartData}
        range={chartRange}
        onRangeChange={handleRangeChange}
        loading={chartLoading}
      />

      {/* Tabbed details section */}
      <div className="card detail-content-card">
        <nav className="editorial-tabs" role="tablist" aria-label="Monitor sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'checks'}
            className={`tab-tile ${activeTab === 'checks' ? 'tab-tile-active' : ''}`}
            onClick={() => setActiveTab('checks')}
          >
            Recent checks
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'incidents'}
            className={`tab-tile ${activeTab === 'incidents' ? 'tab-tile-active' : ''}`}
            onClick={() => setActiveTab('incidents')}
          >
            Incidents ({incidents.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'alerts'}
            className={`tab-tile ${activeTab === 'alerts' ? 'tab-tile-active' : ''}`}
            onClick={() => setActiveTab('alerts')}
          >
            Alert settings
          </button>
        </nav>

        {/* Tab: Recent Checks */}
        {activeTab === 'checks' && (
          <div className="tab-pane-content" role="tabpanel">
            {checksLoading ? (
              <SkeletonTable rows={5} cols={5} />
            ) : checks.length === 0 ? (
              <p className="tab-empty-text">
                No checks have been recorded yet. The next probe is scheduled according to your
                interval.
              </p>
            ) : (
              <>
                <div className="table-wrapper">
                  <table className="stationery-table" aria-label="Recent check results">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>HTTP code</th>
                        <th>Latency</th>
                        <th>Observed at</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checks.map((c) => (
                        <tr key={c._id}>
                          <td>
                            <StatusBadge status={c.status} />
                          </td>
                          <td className="font-mono">{c.statusCode || '—'}</td>
                          <td className="font-mono">
                            {c.responseTime !== undefined ? `${c.responseTime} ms` : '—'}
                          </td>
                          <td>{new Date(c.checkedAt).toLocaleTimeString()}</td>
                          <td className="table-details-col">
                            {c.errorMessage || c.error || 'Healthy response received'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {checksPagination.totalPages > 1 && (
                  <div className="table-pagination">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={checksPagination.page <= 1 || checksLoading}
                      onClick={() => fetchChecks(checksPagination.page - 1)}
                    >
                      Previous
                    </button>
                    <span className="pagination-text">
                      Page {checksPagination.page} of {checksPagination.totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={
                        checksPagination.page >= checksPagination.totalPages || checksLoading
                      }
                      onClick={() => fetchChecks(checksPagination.page + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab: Incidents */}
        {activeTab === 'incidents' && (
          <div className="tab-pane-content" role="tabpanel">
            {incidentsLoading ? (
              <SkeletonTable rows={3} cols={4} />
            ) : incidents.length === 0 ? (
              <p className="tab-empty-text">
                No incidents on record. All checks have been operating normally.
              </p>
            ) : (
              <div className="table-wrapper">
                <table className="stationery-table" aria-label="Incident history">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Opened</th>
                      <th>Resolved</th>
                      <th>Duration</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incidents.map((inc) => (
                      <tr key={inc._id}>
                        <td>
                          {inc.status === 'OPEN' ? (
                            <span className="incident-state-coral">Open</span>
                          ) : (
                            <span className="incident-state-resolved">Resolved</span>
                          )}
                        </td>
                        <td>{new Date(inc.startedAt).toLocaleString()}</td>
                        <td>
                          {inc.resolvedAt ? new Date(inc.resolvedAt).toLocaleString() : 'Ongoing'}
                        </td>
                        <td className="font-mono">{formatDuration(inc.duration)}</td>
                        <td className="table-details-col">
                          {inc.error || 'Consecutive check failures reached threshold.'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab: Alerts */}
        {activeTab === 'alerts' && (
          <div className="tab-pane-content" role="tabpanel">
            <form onSubmit={handleSaveAlerts} className="editorial-form">
              {/* Email Notifications */}
              <div className="alert-channel-tile">
                <div className="channel-tile-header">
                  <div>
                    <h3 className="channel-tile-title">Email notifications</h3>
                    <p className="channel-tile-desc">
                      Receive an email when an incident opens or resolves. Alerts are strictly
                      deduplicated per state transition.
                    </p>
                  </div>
                  <label className="switch-control" aria-label="Toggle email notifications">
                    <input
                      type="checkbox"
                      checked={alertSettings.email.enabled}
                      onChange={(e) =>
                        setAlertSettings((prev) => ({
                          ...prev,
                          email: { ...prev.email, enabled: e.target.checked },
                        }))
                      }
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                {alertSettings.email.enabled && (
                  <div className="form-field" style={{ marginTop: '16px' }}>
                    <label htmlFor="email-recipients" className="field-label">
                      Recipient email addresses (separated by commas)
                    </label>
                    <input
                      id="email-recipients"
                      type="text"
                      className="field-input"
                      placeholder="team@domain.com, alerts@domain.com"
                      value={recipientsInput}
                      onChange={(e) => setRecipientsInput(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Webhook Notifications */}
              <div className="alert-channel-tile">
                <div className="channel-tile-header">
                  <div>
                    <h3 className="channel-tile-title">Generic webhook</h3>
                    <p className="channel-tile-desc">
                      Send an HMAC-signed JSON payload to your custom endpoint upon opening and
                      resolving an incident.
                    </p>
                  </div>
                  <label className="switch-control" aria-label="Toggle webhook notifications">
                    <input
                      type="checkbox"
                      checked={alertSettings.webhook.enabled}
                      onChange={(e) =>
                        setAlertSettings((prev) => ({
                          ...prev,
                          webhook: { ...prev.webhook, enabled: e.target.checked },
                        }))
                      }
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                {alertSettings.webhook.enabled && (
                  <div style={{ marginTop: '16px' }}>
                    <div className="form-field">
                      <label htmlFor="webhook-url" className="field-label">
                        Webhook destination address
                      </label>
                      <input
                        id="webhook-url"
                        type="url"
                        className="field-input"
                        placeholder="https://api.domain.com/webhooks/pulsewatch"
                        value={alertSettings.webhook.url}
                        onChange={(e) =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            webhook: { ...prev.webhook, url: e.target.value },
                          }))
                        }
                      />
                    </div>

                    <div className="form-field" style={{ marginTop: '14px' }}>
                      <label htmlFor="webhook-secret" className="field-label">
                        HMAC signature secret (optional)
                      </label>
                      <input
                        id="webhook-secret"
                        type="password"
                        className="field-input"
                        placeholder="Shared secret key"
                        value={alertSettings.webhook.secret}
                        onChange={(e) =>
                          setAlertSettings((prev) => ({
                            ...prev,
                            webhook: { ...prev.webhook, secret: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: '24px' }}>
                <button type="submit" className="btn btn-primary" disabled={alertsSaving}>
                  {alertsSaving ? 'Saving…' : 'Save alert settings'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Remove monitor"
        confirmText="Remove monitor"
        confirmVariant="danger"
        loading={deleting}
      >
        <p>
          Are you sure you wish to delete <strong>{monitor.name}</strong>?
        </p>
        <p className="modal-description-text">
          All latency history, check results, and past incident logs will be permanently deleted.
        </p>
      </Modal>
    </div>
  );
}
