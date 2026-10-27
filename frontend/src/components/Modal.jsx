import React, { useEffect, useRef } from 'react';

/**
 * Accessible Modal Component
 *
 * "Mist & Ink" requirements:
 * - 22px border radius, no borders, soft layered shadows
 * - Pill-shaped buttons (min 44px tall)
 * - Instrument Serif title
 * - Calm, editorial tone
 */
export default function Modal({
  isOpen,
  onClose,
  onConfirm,
  title,
  children,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmVariant = 'danger', // 'danger' | 'primary'
  loading = false,
}) {
  const modalRef = useRef(null);
  const confirmBtnRef = useRef(null);

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, loading]);

  // Focus modal confirm button on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        confirmBtnRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="mist-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        className="card mist-modal-content"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="mist-modal-header">
          <h2 id="modal-title" className="mist-modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="mist-modal-close-btn"
            onClick={onClose}
            disabled={loading}
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>

        <div className="mist-modal-body">{children}</div>

        <div className="mist-modal-footer">
          <button
            type="button"
            className="btn btn-secondary pill-btn-md"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`btn ${
              confirmVariant === 'danger' ? 'btn-coral' : 'btn-primary'
            } pill-btn-md`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Please wait…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
