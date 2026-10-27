import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { SkeletonCard } from '../components/Skeleton.jsx';

export default function AddEditMonitorPage() {
  const { id } = useParams();
  const isEditMode = Boolean(id);
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [loading, setLoading] = useState(isEditMode);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    url: '',
    method: 'GET',
    interval: 60,
    timeout: 5000,
    expectedStatus: 200,
    failureThreshold: 3,
    isPublic: false,
    publicSlug: '',
  });

  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!isEditMode) return;

    let mounted = true;
    const fetchMonitor = async () => {
      try {
        setLoading(true);
        const data = await api.getMonitor(id);
        const m = data.monitor;
        if (mounted) {
          setFormData({
            name: m.name || '',
            url: m.url || '',
            method: m.method || 'GET',
            interval: m.interval || 60,
            timeout: m.timeout || 5000,
            expectedStatus: m.expectedStatus || 200,
            failureThreshold: m.failureThreshold || 3,
            isPublic: Boolean(m.isPublic),
            publicSlug: m.publicSlug || '',
          });
        }
      } catch (err) {
        toastError(err.message || 'Unable to load monitor details.');
        navigate('/');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchMonitor();
    return () => {
      mounted = false;
    };
  }, [id, isEditMode, navigate, toastError]);

  const validate = () => {
    const errs = {};

    if (!formData.name.trim()) {
      errs.name = 'Please provide a name for this monitor.';
    } else if (formData.name.trim().length > 100) {
      errs.name = 'The name must not exceed 100 characters.';
    }

    if (!formData.url.trim()) {
      errs.url = 'Please provide an endpoint URL.';
    } else {
      try {
        const parsed = new URL(formData.url.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          errs.url = 'The address must begin with http:// or https://';
        }
      } catch {
        errs.url = 'Please enter a valid web address, such as https://api.domain.com/health';
      }
    }

    const intervalNum = Number(formData.interval);
    if (isNaN(intervalNum) || intervalNum < 30 || intervalNum > 3600) {
      errs.interval = 'The interval must be between 30 and 3600 seconds.';
    }

    const timeoutNum = Number(formData.timeout);
    if (isNaN(timeoutNum) || timeoutNum < 1000 || timeoutNum > 30000) {
      errs.timeout = 'Timeout must be between 1,000 and 30,000 milliseconds.';
    }

    const statusNum = Number(formData.expectedStatus);
    if (isNaN(statusNum) || statusNum < 100 || statusNum > 599) {
      errs.expectedStatus = 'Expected HTTP status must be between 100 and 599.';
    }

    const thresholdNum = Number(formData.failureThreshold);
    if (isNaN(thresholdNum) || thresholdNum < 1 || thresholdNum > 10) {
      errs.failureThreshold = 'Failure threshold must be between 1 and 10.';
    }

    if (formData.isPublic) {
      if (!formData.publicSlug.trim()) {
        errs.publicSlug = 'A slug is required when the status page is published.';
      } else if (!/^[a-z0-9-]+$/.test(formData.publicSlug.trim())) {
        errs.publicSlug = 'Use only lowercase letters, numbers, and hyphens.';
      } else if (formData.publicSlug.trim().length > 50) {
        errs.publicSlug = 'The slug cannot exceed 50 characters.';
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const handleGenerateSlug = () => {
    const slug = formData.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setFormData((prev) => ({ ...prev, publicSlug: slug }));
    if (errors.publicSlug) {
      setErrors((prev) => ({ ...prev, publicSlug: null }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    const payload = {
      name: formData.name.trim(),
      url: formData.url.trim(),
      method: formData.method,
      interval: Number(formData.interval),
      timeout: Number(formData.timeout),
      expectedStatus: Number(formData.expectedStatus),
      failureThreshold: Number(formData.failureThreshold),
      isPublic: Boolean(formData.isPublic),
      publicSlug: formData.isPublic ? formData.publicSlug.trim().toLowerCase() : undefined,
    };

    try {
      if (isEditMode) {
        await api.updateMonitor(id, payload);
        success(`Changes saved for ${payload.name}.`);
        navigate(`/monitors/${id}`);
      } else {
        const created = await api.createMonitor(payload);
        success(`${payload.name} created. Health checks have begun.`);
        navigate(`/monitors/${created.monitor._id}`);
      }
    } catch (err) {
      toastError(err.message || 'Unable to save monitor configuration.');
      if (err.details && Array.isArray(err.details)) {
        const fieldErrors = {};
        err.details.forEach((d) => {
          if (d.field) fieldErrors[d.field] = d.message;
        });
        setErrors(fieldErrors);
      } else if (err.code === 'SLUG_IN_USE' || err.message?.includes('slug')) {
        setErrors((prev) => ({ ...prev, publicSlug: 'This public address is already taken.' }));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page-wrapper form-narrow-wrapper">
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="page-wrapper form-narrow-wrapper">
      <div className="page-header">
        <div className="page-header-text">
          <Link to={isEditMode ? `/monitors/${id}` : '/'} className="editorial-back-link">
            &larr; Back to {isEditMode ? 'monitor details' : 'overview'}
          </Link>
          <h1 className="page-display-title">{isEditMode ? 'Edit monitor.' : 'New monitor.'}</h1>
          <p className="page-display-subtitle">
            Configure automated health checks, threshold rules, and public availability.
          </p>
        </div>
      </div>

      <div className="card form-stationery-card">
        <form onSubmit={handleSubmit} noValidate className="editorial-form">
          {/* Section: Endpoint */}
          <div className="form-section-block">
            <h2 className="form-section-title">Endpoint</h2>

            <div className="form-field">
              <label htmlFor="name" className="field-label">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                className={`field-input ${errors.name ? 'field-input-error' : ''}`}
                placeholder="e.g. Primary API, Marketing site"
                value={formData.name}
                onChange={handleChange}
                maxLength={100}
                required
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'name-error' : undefined}
              />
              {errors.name && (
                <span id="name-error" className="field-error-text">
                  {errors.name}
                </span>
              )}
            </div>

            <div className="form-two-column">
              <div className="form-field" style={{ flex: '0 0 130px' }}>
                <label htmlFor="method" className="field-label">
                  Method
                </label>
                <select
                  id="method"
                  name="method"
                  className="field-select"
                  value={formData.method}
                  onChange={handleChange}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                  <option value="HEAD">HEAD</option>
                  <option value="OPTIONS">OPTIONS</option>
                </select>
              </div>

              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="url" className="field-label">
                  Web address
                </label>
                <input
                  id="url"
                  name="url"
                  type="url"
                  className={`field-input ${errors.url ? 'field-input-error' : ''}`}
                  placeholder="https://example.com/health"
                  value={formData.url}
                  onChange={handleChange}
                  required
                  aria-invalid={!!errors.url}
                  aria-describedby={errors.url ? 'url-error' : 'url-help'}
                />
                <span id="url-help" className="field-help-text">
                  Must start with http:// or https://. Private IP ranges are protected.
                </span>
                {errors.url && (
                  <span id="url-error" className="field-error-text">
                    {errors.url}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Section: Cadence & Rules */}
          <div className="form-section-block">
            <h2 className="form-section-title">Schedule and thresholds</h2>

            <div className="form-three-column">
              <div className="form-field">
                <label htmlFor="interval" className="field-label">
                  Interval (seconds)
                </label>
                <input
                  id="interval"
                  name="interval"
                  type="number"
                  min="30"
                  max="3600"
                  className={`field-input ${errors.interval ? 'field-input-error' : ''}`}
                  value={formData.interval}
                  onChange={handleChange}
                  aria-invalid={!!errors.interval}
                  aria-describedby={errors.interval ? 'interval-error' : undefined}
                />
                <span className="field-help-text">Between 30 and 3,600s</span>
                {errors.interval && (
                  <span id="interval-error" className="field-error-text">
                    {errors.interval}
                  </span>
                )}
              </div>

              <div className="form-field">
                <label htmlFor="timeout" className="field-label">
                  Timeout (ms)
                </label>
                <input
                  id="timeout"
                  name="timeout"
                  type="number"
                  min="1000"
                  max="30000"
                  step="500"
                  className={`field-input ${errors.timeout ? 'field-input-error' : ''}`}
                  value={formData.timeout}
                  onChange={handleChange}
                  aria-invalid={!!errors.timeout}
                  aria-describedby={errors.timeout ? 'timeout-error' : undefined}
                />
                <span className="field-help-text">Between 1,000 and 30,000ms</span>
                {errors.timeout && (
                  <span id="timeout-error" className="field-error-text">
                    {errors.timeout}
                  </span>
                )}
              </div>

              <div className="form-field">
                <label htmlFor="expectedStatus" className="field-label">
                  Expected HTTP code
                </label>
                <input
                  id="expectedStatus"
                  name="expectedStatus"
                  type="number"
                  min="100"
                  max="599"
                  className={`field-input ${errors.expectedStatus ? 'field-input-error' : ''}`}
                  value={formData.expectedStatus}
                  onChange={handleChange}
                  aria-invalid={!!errors.expectedStatus}
                  aria-describedby={errors.expectedStatus ? 'expected-error' : undefined}
                />
                <span className="field-help-text">Typically 200</span>
                {errors.expectedStatus && (
                  <span id="expected-error" className="field-error-text">
                    {errors.expectedStatus}
                  </span>
                )}
              </div>
            </div>

            <div className="form-field" style={{ maxWidth: '340px', marginTop: '16px' }}>
              <label htmlFor="failureThreshold" className="field-label">
                Failure threshold
              </label>
              <input
                id="failureThreshold"
                name="failureThreshold"
                type="number"
                min="1"
                max="10"
                className={`field-input ${errors.failureThreshold ? 'field-input-error' : ''}`}
                value={formData.failureThreshold}
                onChange={handleChange}
                aria-invalid={!!errors.failureThreshold}
                aria-describedby={errors.failureThreshold ? 'threshold-error' : undefined}
              />
              <span className="field-help-text">
                Consecutive failed checks required before an incident opens (1 to 10).
              </span>
              {errors.failureThreshold && (
                <span id="threshold-error" className="field-error-text">
                  {errors.failureThreshold}
                </span>
              )}
            </div>
          </div>

          {/* Section: Public Status Page */}
          <div className="form-section-block">
            <h2 className="form-section-title">Public status page</h2>

            <label className="checkbox-tile">
              <input
                type="checkbox"
                name="isPublic"
                checked={formData.isPublic}
                onChange={handleChange}
              />
              <span className="checkbox-custom-box" aria-hidden="true" />
              <div className="checkbox-content">
                <span className="checkbox-heading">Publish a public status page</span>
                <span className="checkbox-subtext">
                  Creates an open, read-only status page accessible at /status/:slug. No private
                  alert settings or internal identifiers are ever exposed.
                </span>
              </div>
            </label>

            {formData.isPublic && (
              <div className="form-field" style={{ marginTop: '20px' }}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <label htmlFor="publicSlug" className="field-label">
                    Page slug
                  </label>
                  {formData.name && (
                    <button type="button" className="text-action-link" onClick={handleGenerateSlug}>
                      Fill from name
                    </button>
                  )}
                </div>

                <div className="slug-input-row">
                  <span className="slug-lead">/status/</span>
                  <input
                    id="publicSlug"
                    name="publicSlug"
                    type="text"
                    className={`field-input slug-tail ${errors.publicSlug ? 'field-input-error' : ''}`}
                    placeholder="my-service"
                    value={formData.publicSlug}
                    onChange={handleChange}
                    maxLength={50}
                    required={formData.isPublic}
                    aria-invalid={!!errors.publicSlug}
                    aria-describedby={errors.publicSlug ? 'slug-error' : undefined}
                  />
                </div>
                <span className="field-help-text">
                  Lowercase letters, numbers, and hyphens only.
                </span>
                {errors.publicSlug && (
                  <span id="slug-error" className="field-error-text">
                    {errors.publicSlug}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="form-actions-row">
            <Link to={isEditMode ? `/monitors/${id}` : '/'} className="btn btn-secondary">
              Cancel
            </Link>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : isEditMode ? 'Save changes' : 'Create monitor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
