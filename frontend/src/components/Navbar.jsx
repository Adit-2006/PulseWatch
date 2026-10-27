import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

/**
 * Slim left sidebar component
 *
 * "Mist & Ink" requirements:
 * - Slim left sidebar
 * - Wordmark in Instrument Serif
 * - Text-only navigation links (no icon clutter)
 * - Active link is a white rounded tile with a soft shadow
 * - Warm, calm editorial tone
 */
export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const { success } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    success('You have signed out.');
    navigate('/login');
  };

  const isCurrent = (path) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <aside className="mist-sidebar" role="navigation" aria-label="Main Navigation">
      <div className="sidebar-top">
        {/* Wordmark in Serif */}
        <Link to="/" className="sidebar-wordmark" aria-label="PulseWatch Home">
          PulseWatch
        </Link>
        <span className="sidebar-tagline">Uptime &amp; Observation</span>
      </div>

      <nav className="sidebar-nav">
        {isAuthenticated ? (
          <>
            <Link to="/" className={`sidebar-link ${isCurrent('/') ? 'sidebar-link-active' : ''}`}>
              Monitors
            </Link>

            <Link
              to="/monitors/new"
              className={`sidebar-link ${isCurrent('/monitors/new') ? 'sidebar-link-active' : ''}`}
            >
              New monitor
            </Link>
          </>
        ) : (
          <>
            <Link
              to="/login"
              className={`sidebar-link ${isCurrent('/login') ? 'sidebar-link-active' : ''}`}
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className={`sidebar-link ${isCurrent('/register') ? 'sidebar-link-active' : ''}`}
            >
              Create account
            </Link>
          </>
        )}
      </nav>

      {isAuthenticated && (
        <div className="sidebar-bottom">
          <div className="sidebar-user-block">
            <span className="sidebar-user-greeting">Signed in as</span>
            <span className="sidebar-user-email" title={user?.email}>
              {user?.email}
            </span>
          </div>

          <button
            type="button"
            className="sidebar-logout-btn"
            onClick={handleLogout}
            aria-label="Sign out of your account"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
