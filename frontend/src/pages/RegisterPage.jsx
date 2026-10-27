import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const { register } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();

  const validate = () => {
    const errs = {};
    if (!email.trim()) {
      errs.email = 'Please provide an email address.';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      errs.email = 'Please provide a valid email address.';
    }

    if (!password) {
      errs.password = 'Please choose a password.';
    } else if (password.length < 8) {
      errs.password = 'Password must be at least 8 characters in length.';
    }

    if (password !== confirmPassword) {
      errs.confirmPassword = 'The entered passwords do not match.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      await register(email, password);
      success('Your account is ready. Welcome to PulseWatch.');
      navigate('/', { replace: true });
    } catch (err) {
      toastError(err.message || 'We could not register this account.');
      setErrors((prev) => ({
        ...prev,
        form: err.message || 'This email address may already be in use.',
      }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-canvas">
      <div className="card auth-card">
        <header className="auth-header">
          <span className="auth-wordmark">PulseWatch</span>
          <h1 className="auth-title">Create your account.</h1>
          <p className="auth-subtitle">
            Begin observing your services with calm, reliable monitoring.
          </p>
        </header>

        {errors.form && (
          <div className="alert-message alert-coral" role="alert">
            <span>{errors.form}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="editorial-form">
          <div className="form-field">
            <label htmlFor="reg-email" className="field-label">
              Email address
            </label>
            <input
              id="reg-email"
              type="email"
              className={`field-input ${errors.email ? 'field-input-error' : ''}`}
              placeholder="name@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'reg-email-error' : undefined}
            />
            {errors.email && (
              <span id="reg-email-error" className="field-error-text">
                {errors.email}
              </span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="reg-password" className="field-label">
              Password
            </label>
            <input
              id="reg-password"
              type="password"
              className={`field-input ${errors.password ? 'field-input-error' : ''}`}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'reg-password-error' : undefined}
            />
            {errors.password && (
              <span id="reg-password-error" className="field-error-text">
                {errors.password}
              </span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="reg-confirm-password" className="field-label">
              Confirm password
            </label>
            <input
              id="reg-confirm-password"
              type="password"
              className={`field-input ${errors.confirmPassword ? 'field-input-error' : ''}`}
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              aria-invalid={!!errors.confirmPassword}
              aria-describedby={errors.confirmPassword ? 'reg-confirm-error' : undefined}
            />
            {errors.confirmPassword && (
              <span id="reg-confirm-error" className="field-error-text">
                {errors.confirmPassword}
              </span>
            )}
          </div>

          <div className="auth-actions-stack">
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </div>
        </form>

        <footer className="auth-card-footer">
          <span>Already have an account? </span>
          <Link to="/login" className="editorial-link">
            Sign in
          </Link>
        </footer>
      </div>
    </div>
  );
}
