import React, { useId } from 'react';
import { getCatmullRomPath } from '../utils/catmullRom.js';

/**
 * Catmull-Rom Sparkline
 *
 * "Mist & Ink" requirements:
 * - Smooth Catmull-Rom curve
 * - Deep teal #1F6F66 accent line
 * - Round line caps and joins
 * - Very subtle teal fade beneath (rgba(31, 111, 102, 0.08) to transparent)
 * - No gridline clutter
 * - Accessible aria-label
 */
export default function Sparkline({
  data = [],
  width = 300,
  height = 48,
  ariaLabel = 'Response latency trend over recent checks',
}) {
  const gradientId = useId();

  const values = data && data.length > 0 ? data : [50, 50, 50];
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const spread = maxVal - minVal;
  const range = spread === 0 ? 1 : spread;

  const paddingY = 8;
  const usableHeight = height - paddingY * 2;

  const points = values.map((val, idx) => {
    const x = values.length === 1 ? width / 2 : (idx / (values.length - 1)) * width;
    const normalized = spread === 0 ? 0.5 : (val - minVal) / range;
    const y = height - paddingY - normalized * usableHeight;
    return { x, y };
  });

  const curvePath = getCatmullRomPath(points);
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const areaPath = `${curvePath} L ${lastPoint.x} ${height} L ${firstPoint.x} ${height} Z`;

  return (
    <svg
      className="catmull-sparkline-svg"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1F6F66" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#1F6F66" stopOpacity="0.00" />
        </linearGradient>
      </defs>

      {/* Very subtle teal fade beneath */}
      <path d={areaPath} fill={`url(#${gradientId})`} />

      {/* Smooth Catmull-Rom stroke with round caps */}
      <path
        d={curvePath}
        fill="none"
        stroke="#1F6F66"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
