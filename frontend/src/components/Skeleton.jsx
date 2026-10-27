import React from 'react';

/**
 * Skeleton loaders
 *
 * "Mist & Ink" requirements:
 * - Slow, soft shimmer
 * - 22px radius for cards
 * - Respects prefers-reduced-motion
 */
export function SkeletonLine({ width = '100%', height = '16px', className = '', style = {} }) {
  return (
    <div
      className={`skeleton-soft-shimmer skeleton-line ${className}`}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="card skeleton-card-stationery" aria-hidden="true">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <SkeletonLine width="55%" height="22px" />
        <SkeletonLine width="25%" height="18px" />
      </div>
      <SkeletonLine width="75%" height="14px" style={{ marginBottom: '20px' }} />
      <SkeletonLine width="100%" height="48px" style={{ marginBottom: '20px', borderRadius: '12px' }} />
      <div style={{ display: 'flex', gap: '20px', marginTop: '16px' }}>
        <SkeletonLine width="45%" height="32px" />
        <SkeletonLine width="45%" height="32px" />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 5 }) {
  return (
    <div className="skeleton-stationery-table" aria-hidden="true">
      <div className="skeleton-table-head">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonLine key={i} width={`${80 / cols}%`} height="16px" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-table-row">
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonLine key={c} width={`${70 / cols}%`} height="14px" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default {
  SkeletonLine,
  SkeletonCard,
  SkeletonTable,
};
