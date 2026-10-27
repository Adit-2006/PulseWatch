import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

/**
 * Mist & Ink Sidebar
 * Slim left sidebar with wordmark in serif, text-only nav links,
 * and active link rendered as a white rounded tile with a soft shadow.
 */
export default function Sidebar() {
  const { user, isAuthenticated, logout } = useAuth();
  const { success } = useToast();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    success('You have signed out.');
    navigate('/login');
  };

  if (!isAuthenticated) return null;

  return (
    <aside className="app-sidebar" aria-label="Main sidebar navigation">
      <div className="sidebar-inner">
        {/* Wordmark in Instrument Serif */}
        <div className="sidebar-header">
          <NavLink to="/" className="sidebar-wordmark" aria-label="PulseWatch home">
            PulseWatch
          </NavLink>
          <div className="sidebar-submark">Infrastructure observation</div>
        </div>

        {/* Text-only Navigation Links */}
        <nav className="sidebar-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}
          >
            Monitors
          </NavLink>

          <NavLink
            to="/monitors/new"
            className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}
          >
            New monitor
          </NavLink>
        </nav>

        {/* Footer info & sign out */}
        <div className="sidebar-footer">
          <div className="sidebar-user-block">
            <span className="sidebar-user-label">Signed in as</span>
            <span className="sidebar-user-email" title={user?.email}>
              {user?.email}
            </span>
          </div>

          <button type="button" className="sidebar-signout-btn" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
