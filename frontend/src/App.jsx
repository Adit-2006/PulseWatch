import { useState, useEffect } from 'react';
import './App.css';

export function App() {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:5000/api/health');
      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson?.error?.message || `HTTP error ${res.status}`);
      }
      const data = await res.json();
      setHealthData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = () => {
    if (error) return 'error';
    if (!healthData) return 'disconnected';
    if (healthData.database?.status === 'connected') return '';
    return 'disconnected';
  };

  return (
    <div className="app-shell">
      <header className="navbar">
        <div className="brand">
          <div className="brand-icon">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <span className="brand-title">PulseWatch</span>
          <span className="brand-badge">Dev Ops Engine</span>
        </div>
        <div className="nav-status">
          <span className={`status-dot ${getStatusColor()}`}></span>
          <span>
            {loading && !healthData
              ? 'Checking...'
              : error
                ? 'Backend Offline'
                : `DB: ${healthData?.database?.status || 'unknown'}`}
          </span>
        </div>
      </header>

      <main className="main-content">
        <section className="hero-section">
          <span className="hero-tag">Real-Time Infrastructure Monitoring</span>
          <h1 className="hero-title">Developer-First Uptime &amp; Incident Observability</h1>
          <p className="hero-subtitle">
            Reliable scheduled HTTP probes, atomic incident state machines, deduplicated alerts, and
            automated public status pages.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button className="btn-primary" onClick={fetchHealth} disabled={loading}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              {loading ? 'Probing...' : 'Refresh Health'}
            </button>
            <a
              href="http://localhost:5000/api/health"
              target="_blank"
              rel="noreferrer"
              className="btn-outline"
            >
              Open Raw Health Endpoint ↗
            </a>
          </div>
        </section>

        <section className="grid-cards">
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Backend Health Diagnostics</h2>
              <span className="card-pill">GET /api/health</span>
            </div>
            {error ? (
              <div
                style={{ color: 'var(--accent-rose)', fontSize: '0.9rem', marginBottom: '1rem' }}
              >
                ⚠️ Unable to reach backend at http://localhost:5000: {error}
              </div>
            ) : healthData ? (
              <div className="health-metrics">
                <div className="metric-row">
                  <span className="metric-label">API Status</span>
                  <span className="metric-value" style={{ color: 'var(--accent-emerald)' }}>
                    ● {healthData.status}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Uptime</span>
                  <span className="metric-value">{healthData.uptime} seconds</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Database Connection</span>
                  <span className="metric-value" style={{ textTransform: 'capitalize' }}>
                    {healthData.database?.status}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Heartbeat Timestamp</span>
                  <span className="metric-value">
                    {new Date(healthData.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)' }}>Probing server...</p>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Live Response Payload</h2>
              <span className="card-pill">JSON</span>
            </div>
            <pre className="json-viewer">
              {JSON.stringify(healthData || { error: error || 'Probing...' }, null, 2)}
            </pre>
          </div>
        </section>

        <section className="grid-cards">
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Proactive Probing</h2>
              <span className="card-pill">Scheduler</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Configurable interval HTTP/HTTPS checks measuring DNS, TCP, and response latency with
              timeout detection.
            </p>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Incident State Machine</h2>
              <span className="card-pill">Atomic DB</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Deterministic state transitions across OPERATIONAL, DEGRADED, and DOWN without race
              conditions.
            </p>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Deduplicated Alerts</h2>
              <span className="card-pill">Notifications</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Smart throttling and deduplication prevent alert fatigue during flapping endpoint
              outages.
            </p>
          </div>
        </section>
      </main>

      <footer className="footer">
        PulseWatch &bull; Monorepo Architecture &bull; Node.js + Express (ESM) &bull; React + Vite
      </footer>
    </div>
  );
}

export default App;
