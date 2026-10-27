import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const { login } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/';

  const validate = () => {
    const errs = {};
    if (!email.trim()) {
      errs.email = 'Please provide your email address.';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      errs.email = 'Please provide a valid email address.';
    }

    if (!password) {
      errs.password = 'Please enter your password.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      await login(email, password);
      success('Welcome back.');
      navigate(from, { replace: true });
    } catch (err) {
      toastError(err.message || 'We could not sign you in with those details.');
      setErrors((prev) => ({
        ...prev,
        form: err.message || 'Invalid email or password.',
      }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleFillDemo = () => {
    setEmail('demo@pulsewatch.dev');
    setPassword('PulseWatch2026!');
    setErrors({});
  };

  return (
    <div className="auth-canvas">
      <div className="card auth-card">
        <header className="auth-header">
          <span className="auth-wordmark">PulseWatch</span>
          <h1 className="auth-title">Welcome back.</h1>
          <p className="auth-subtitle">Sign in to review and manage your monitored services.</p>
        </header>

        {errors.form && (
          <div className="alert-message alert-coral" role="alert">
            <span>{errors.form}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="editorial-form">
          <div className="form-field">
            <label htmlFor="login-email" className="field-label">
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              className={`field-input ${errors.email ? 'field-input-error' : ''}`}
              placeholder="name@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
            />
            {errors.email && (
              <span id="email-error" className="field-error-text">
                {errors.email}
              </span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="login-password" className="field-label">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              className={`field-input ${errors.password ? 'field-input-error' : ''}`}
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
            />
            {errors.password && (
              <span id="password-error" className="field-error-text">
                {errors.password}
              </span>
            )}
          </div>

          <div className="auth-actions-stack">
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            <button type="button" className="btn btn-secondary btn-block" onClick={handleFillDemo}>
              Fill demo credentials
            </button>
          </div>
        </form>

        <footer className="auth-card-footer">
          <span>Need an account? </span>
          <Link to="/register" className="editorial-link">
            Create an account
          </Link>
        </footer>
      </div>
    </div>
  );
}
