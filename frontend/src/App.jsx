import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Navbar from './components/Navbar.jsx';

import DashboardPage from './pages/DashboardPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import AddEditMonitorPage from './pages/AddEditMonitorPage.jsx';
import MonitorDetailPage from './pages/MonitorDetailPage.jsx';
import StatusPage from './pages/StatusPage.jsx';

import './App.css';

/**
 * AppLayout
 *
 * "Mist & Ink" requirements:
 * - Layout: slim left sidebar with wordmark in serif and text-only nav links; content on the right.
 * - Public status page: centered single column (no sidebar).
 * - Generous whitespace: 40-48px page margins.
 */
function AppLayout({ children }) {
  const location = useLocation();
  const isStatusPage = location.pathname.startsWith('/status/');

  if (isStatusPage) {
    return (
      <div className="mist-status-shell">
        <main className="mist-status-main">{children}</main>
      </div>
    );
  }

  return (
    <div className="mist-app-shell">
      <Navbar />
      <div className="mist-content-container">
        <main className="mist-main-content">{children}</main>
        <footer className="mist-page-footer">
          PulseWatch &mdash; Thoughtful uptime and incident observation.
        </footer>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppLayout>
            <Routes>
              {/* Public Auth Routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Public Status Page (unauthenticated, centered single column) */}
              <Route path="/status/:slug" element={<StatusPage />} />

              {/* Protected App Routes */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/monitors/new"
                element={
                  <ProtectedRoute>
                    <AddEditMonitorPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/monitors/:id"
                element={
                  <ProtectedRoute>
                    <MonitorDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/monitors/:id/edit"
                element={
                  <ProtectedRoute>
                    <AddEditMonitorPage />
                  </ProtectedRoute>
                }
              />

              {/* Catch-all fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppLayout>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
