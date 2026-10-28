import React, { useState, useMemo, useId } from 'react';
import { getCatmullRomPath } from '../utils/catmullRom.js';

/**
 * ResponseTimeChart
 *
 * "Mist & Ink" design specifications:
 * - Smooth curves using Catmull-Rom interpolation
 * - Round line caps and joins
 * - Deep teal #1F6F66 accent line
 * - Very subtle teal gradient fill beneath (rgba(31, 111, 102, 0.08) to transparent)
 * - No gridline clutter
 * - Accessible aria-label
 * - Instrument Serif numerals for key stats
 * - Pill-shaped range buttons
 */
export default function ResponseTimeChart({
  series = [],
  range = '24h',
  onRangeChange,
  loading = false,
}) {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const gradientId = useId();

  // Compute stats and SVG coordinates
  const { points, maxVal, minVal, avgOverall } = useMemo(() => {
    if (!series || series.length === 0) {
      return { points: [], maxVal: 0, minVal: 0, avgOverall: 0 };
    }

    const values = series.map((s) => s.avgResponseTimeMs ?? s.avgResponseTime ?? 0);
    const max = Math.max(...values, 40);
    const min = 0;
    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = values.length > 0 ? Math.round(sum / values.length) : 0;

    // SVG dimensions
    const width = 800;
    const height = 240;
    const paddingLeft = 52;
    const paddingRight = 24;
    const paddingTop = 20;
    const paddingBottom = 36;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const computedPoints = series.map((item, index) => {
      const respTime = item.avgResponseTimeMs ?? item.avgResponseTime ?? 0;
      const x =
        series.length === 1
          ? paddingLeft + chartWidth / 2
          : paddingLeft + (index / (series.length - 1)) * chartWidth;
      const normalizedY = (respTime - min) / (max - min || 1);
      const y = height - paddingBottom - normalizedY * chartHeight;

      return {
        ...item,
        x,
        y,
        val: respTime,
        avgResponseTime: respTime,
      };
    });

    return {
      points: computedPoints,
      maxVal: Math.round(max),
      minVal: 0,
      avgOverall: avg,
    };
  }, [series]);

  // Smooth Catmull-Rom spline path
  const curvePath = useMemo(() => {
    if (points.length === 0) return '';
    return getCatmullRomPath(points);
  }, [points]);

  const areaPath = useMemo(() => {
    if (points.length === 0) return '';
    const first = points[0];
    const last = points[points.length - 1];
    const bottomY = 204;
    return `${curvePath} L ${last.x} ${bottomY} L ${first.x} ${bottomY} Z`;
  }, [points, curvePath]);

  const ranges = [
    { label: 'Past hour', value: '1h' },
    { label: 'Past 24 hours', value: '24h' },
    { label: 'Past 7 days', value: '7d' },
    { label: 'Past 30 days', value: '30d' },
  ];

  const formatTime = (ts) => {
    const d = new Date(ts);
    if (range === '1h' || range === '24h') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const ariaDescription = `Response time chart over ${
    range === '1h'
      ? 'the past hour'
      : range === '24h'
        ? 'the past 24 hours'
        : range === '7d'
          ? 'the past 7 days'
          : 'the past 30 days'
  }. Average response latency is ${avgOverall} milliseconds, peaking at ${maxVal} milliseconds.`;

  return (
    <div className="card chart-stationery-card">
      <div className="chart-header-row">
        <div>
          <h2 className="chart-title-text">Response time trends</h2>
          <div className="chart-stats-summary">
            <span className="serif-stat-number">{avgOverall} ms</span>
            <span className="serif-stat-label">Average latency</span>
            {points.length > 0 && (
              <>
                <span className="stat-separator" aria-hidden="true">
                  &bull;
                </span>
                <span className="serif-stat-number">{maxVal} ms</span>
                <span className="serif-stat-label">Peak</span>
              </>
            )}
          </div>
        </div>

        <div className="pill-group" role="group" aria-label="Select observation time window">
          {ranges.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`pill-btn ${range === r.value ? 'pill-btn-active' : ''}`}
              onClick={() => onRangeChange(r.value)}
              disabled={loading}
              aria-pressed={range === r.value}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-canvas-wrapper" style={{ position: 'relative' }}>
        {loading && (
          <div className="chart-loading-overlay">
            <span className="spinner-ink" aria-hidden="true" />
            <span>Gathering probe data…</span>
          </div>
        )}

        {points.length === 0 && !loading ? (
          <div className="chart-empty-state">
            <h3 className="empty-serif-title">No checks in this window.</h3>
            <p className="empty-guidance-text">
              Observations will populate automatically as health probes complete.
            </p>
          </div>
        ) : (
          <svg
            className="chart-svg-editorial"
            viewBox="0 0 800 240"
            preserveAspectRatio="none"
            role="img"
            aria-label={ariaDescription}
            onMouseLeave={() => setHoveredPoint(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1F6F66" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#1F6F66" stopOpacity="0.00" />
              </linearGradient>
            </defs>

            {/* Subtle baseline without gridline clutter */}
            <line x1="52" y1="204" x2="776" y2="204" stroke="#ECEFEE" strokeWidth="1" />

            {/* Baseline y-axis label */}
            <text
              x="44"
              y="208"
              textAnchor="end"
              fill="#5E6B6E"
              fontSize="12"
              fontFamily="var(--font-sans)"
            >
              0ms
            </text>

            {/* Peak y-axis label */}
            <text
              x="44"
              y="26"
              textAnchor="end"
              fill="#5E6B6E"
              fontSize="12"
              fontFamily="var(--font-sans)"
            >
              {maxVal}ms
            </text>

            {/* Faint teal gradient fill beneath */}
            <path d={areaPath} fill={`url(#${gradientId})`} />

            {/* Smooth curve with deep teal accent line and round caps */}
            <path
              d={curvePath}
              fill="none"
              stroke="#1F6F66"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* When only 1 check has occurred, render an initial reference baseline */}
            {points.length === 1 && (
              <g>
                <line
                  x1={52}
                  y1={points[0].y}
                  x2={776}
                  y2={points[0].y}
                  stroke="#1F6F66"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  opacity="0.35"
                />
                <text
                  x={52 + 724 / 2}
                  y={Math.max(35, points[0].y - 12)}
                  textAnchor="middle"
                  fill="#1F6F66"
                  fontSize="12"
                  fontFamily="var(--font-sans)"
                  fontWeight="500"
                >
                  Initial probe: {points[0].avgResponseTime} ms (trend curve connects as checks continue)
                </text>
              </g>
            )}

            {/* Interactive hover points */}
            {points.map((pt, idx) => (
              <circle
                key={idx}
                cx={pt.x}
                cy={pt.y}
                r={hoveredPoint === idx ? 5 : 3}
                fill={hoveredPoint === idx ? '#1F6F66' : '#FFFFFF'}
                stroke="#1F6F66"
                strokeWidth="2"
                className="chart-dot-interactive"
                onMouseEnter={() => setHoveredPoint(idx)}
                onFocus={() => setHoveredPoint(idx)}
                tabIndex="0"
                role="button"
                aria-label={`${formatTime(pt.timestamp)}: ${pt.avgResponseTime} milliseconds`}
              />
            ))}

            {/* X-Axis Time Labels */}
            {points.length > 0 && (
              <>
                <text x="52" y="226" fill="#5E6B6E" fontSize="12" fontFamily="var(--font-sans)">
                  {formatTime(points[0].timestamp)}
                </text>
                {points.length > 2 && (
                  <text
                    x="414"
                    y="226"
                    textAnchor="middle"
                    fill="#5E6B6E"
                    fontSize="12"
                    fontFamily="var(--font-sans)"
                  >
                    {formatTime(points[Math.floor(points.length / 2)].timestamp)}
                  </text>
                )}
                <text
                  x="776"
                  y="226"
                  textAnchor="end"
                  fill="#5E6B6E"
                  fontSize="12"
                  fontFamily="var(--font-sans)"
                >
                  {formatTime(points[points.length - 1].timestamp)}
                </text>
              </>
            )}
          </svg>
        )}

        {/* Floating Tooltip */}
        {hoveredPoint !== null && points[hoveredPoint] && (
          <div
            className="chart-tooltip-stationery"
            style={{
              position: 'absolute',
              left: `${(points[hoveredPoint].x / 800) * 100}%`,
              top: `${(points[hoveredPoint].y / 240) * 100}%`,
              transform: 'translate(-50%, -120%)',
              pointerEvents: 'none',
            }}
          >
            <div className="tooltip-time-text">
              {new Date(points[hoveredPoint].timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
            <div className="tooltip-value-line">
              <strong>{points[hoveredPoint].avgResponseTime} ms</strong> average
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
