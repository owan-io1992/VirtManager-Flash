import { useState, useEffect, useRef, useMemo } from "react";

export interface ChartSeries {
  name: string;
  color: string;
  data: number[];
  timestamps: number[];
  currentValue: string;
}

interface MultiLineChartProps {
  series: ChartSeries[];
  label: string;
  headerValue: string;
  lang?: "zh" | "en";
  maxVal?: number;
  yLabelFormatter?: (val: number) => string;
}

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes in ms

const paddingLeft = 45;
const paddingRight = 15;
const paddingTop = 15;
const paddingBottom = 25;

const formatTime = (ts: number) => {
  const date = new Date(ts);
  const mins = String(date.getMinutes()).padStart(2, '0');
  const secs = String(date.getSeconds()).padStart(2, '0');
  return `${mins}:${secs}`;
};

// Per-series variant of MiniLineChart: draws one line per VM instead of a single
// aggregated series, so a multi-VM selection can still tell which VM is which.
export const MultiLineChart = ({
  series,
  label,
  headerValue,
  lang,
  maxVal,
  yLabelFormatter,
}: MultiLineChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 500, height: 150 });
  const [hoveredPct, setHoveredPct] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const { width, height } = dimensions;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const { seriesCoords, maxLimit, windowStart } = useMemo(() => {
    const lastTimestamps = series
      .map((s) => s.timestamps[s.timestamps.length - 1])
      .filter((t): t is number => t !== undefined);
    const windowEnd = lastTimestamps.length > 0 ? Math.max(...lastTimestamps) : Date.now();
    const windowStart = windowEnd - WINDOW_MS;

    const tsToX = (ts: number) => {
      const pct = (ts - windowStart) / WINDOW_MS;
      return paddingLeft + pct * chartWidth;
    };

    let dataMax = 0;
    const perSeriesVisible = series.map((s) => {
      const visibleIndices: number[] = [];
      for (let i = 0; i < s.timestamps.length; i++) {
        if (s.timestamps[i] >= windowStart && s.timestamps[i] <= windowEnd) {
          visibleIndices.push(i);
        }
      }
      visibleIndices.forEach((i) => {
        if (s.data[i] > dataMax) dataMax = s.data[i];
      });
      return visibleIndices;
    });

    const maxLimit = maxVal !== undefined ? maxVal : (dataMax > 0 ? Math.max(dataMax * 1.1, 1) : 100);

    const seriesCoords = series.map((s, idx) => {
      const visibleIndices = perSeriesVisible[idx];
      const coords = visibleIndices.map((i) => ({
        x: tsToX(s.timestamps[i]),
        y: paddingTop + chartHeight - (Math.min(maxLimit, Math.max(0, s.data[i])) / maxLimit) * chartHeight,
        ts: s.timestamps[i],
        val: s.data[i],
      }));
      const pathD = coords.reduce((acc, c, i) => acc + `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`, "");
      return { name: s.name, color: s.color, coords, pathD };
    });

    return { seriesCoords, maxLimit, windowStart, windowEnd };
  }, [series, maxVal, chartWidth, chartHeight]);

  const xAxisLabels = useMemo(() => {
    const labels: { label: string; pct: number }[] = [];
    const labelCount = 5;
    for (let i = 0; i < labelCount; i++) {
      const ts = windowStart + (i / (labelCount - 1)) * WINDOW_MS;
      labels.push({ label: formatTime(ts), pct: (i / (labelCount - 1)) * 100 });
    }
    return labels;
  }, [windowStart]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * width;
    const pct = Math.min(1, Math.max(0, (svgX - paddingLeft) / chartWidth));
    setHoveredPct(pct);
  };

  const handleMouseLeave = () => setHoveredPct(null);

  const hoveredTs = hoveredPct !== null ? windowStart + hoveredPct * WINDOW_MS : null;
  const hoveredX = hoveredPct !== null ? paddingLeft + hoveredPct * chartWidth : null;

  // Nearest point per series to the hovered timestamp, used for the tooltip breakdown
  const hoveredEntries = useMemo(() => {
    if (hoveredTs === null) return [];
    return seriesCoords
      .filter((s) => s.coords.length > 0)
      .map((s) => {
        let closest = s.coords[0];
        let closestDist = Math.abs(closest.ts - hoveredTs);
        for (const c of s.coords) {
          const dist = Math.abs(c.ts - hoveredTs);
          if (dist < closestDist) {
            closestDist = dist;
            closest = c;
          }
        }
        return { name: s.name, color: s.color, point: closest };
      });
  }, [seriesCoords, hoveredTs]);

  const formatYLabel = (val: number) => {
    if (yLabelFormatter) return yLabelFormatter(val);
    if (maxVal !== undefined) return `${val.toFixed(0)}%`;
    return val.toFixed(0);
  };

  return (
    <div className="line-chart-card">
      <div className="chart-info">
        <span className="chart-label">{label} ({lang === "zh" || !lang ? "10分歷史紀錄" : "10m History"})</span>
        <span className="chart-current-value">{headerValue}</span>
      </div>
      <div className="svg-wrapper" ref={containerRef}>
        <div
          className="chart-y-axis"
          style={{
            position: "absolute",
            left: "5px",
            top: `${paddingTop}px`,
            bottom: `${paddingBottom}px`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            alignItems: "flex-end",
            pointerEvents: "none"
          }}
        >
          <span className="chart-axis-text">{formatYLabel(maxLimit)}</span>
          <span className="chart-axis-text">{formatYLabel(maxLimit / 2)}</span>
          <span className="chart-axis-text">{formatYLabel(0)}</span>
        </div>

        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height="100%"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: "crosshair", display: "block" }}
        >
          {/* Grid lines */}
          <line x1={paddingLeft} y1={paddingTop} x2={width - paddingRight} y2={paddingTop} className="chart-grid-line" />
          <line x1={paddingLeft} y1={paddingTop + chartHeight / 2} x2={width - paddingRight} y2={paddingTop + chartHeight / 2} className="chart-grid-line text-dashed" />
          <line x1={paddingLeft} y1={height - paddingBottom} x2={width - paddingRight} y2={height - paddingBottom} className="chart-grid-line" />

          {/* One trendline per VM */}
          {seriesCoords.map((s) => (
            s.pathD && <path key={s.name} d={s.pathD} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          ))}

          {/* Current point indicator dot per VM */}
          {hoveredPct === null && seriesCoords.map((s) => (
            s.coords.length > 0 && (
              <circle
                key={s.name}
                cx={s.coords[s.coords.length - 1].x}
                cy={s.coords[s.coords.length - 1].y}
                r="3.5"
                fill={s.color}
                className="chart-pulse-dot"
              />
            )
          ))}

          {/* Hover crosshair + per-series highlight dots */}
          {hoveredX !== null && (
            <>
              <line
                x1={hoveredX}
                y1={paddingTop}
                x2={hoveredX}
                y2={height - paddingBottom}
                stroke="#94A3B8"
                strokeOpacity="0.4"
                strokeWidth="1.5"
                strokeDasharray="2, 2"
              />
              {hoveredEntries.map((e) => (
                <circle
                  key={e.name}
                  cx={e.point.x}
                  cy={e.point.y}
                  r="4.5"
                  fill={e.color}
                  stroke="#FFF"
                  strokeWidth="1.5"
                />
              ))}
            </>
          )}
        </svg>

        {/* HTML X-axis labels — fixed 10-minute markers */}
        <div
          className="chart-x-axis"
          style={{
            position: "absolute",
            left: `${paddingLeft}px`,
            right: `${paddingRight}px`,
            bottom: "4px",
            display: "flex",
            justifyContent: "space-between",
            pointerEvents: "none"
          }}
        >
          {xAxisLabels.map((lbl, i) => (
            <span key={i} className="chart-axis-text" style={{ transform: "translateX(-50%)", whiteSpace: "nowrap" }}>
              {lbl.label}
            </span>
          ))}
        </div>

        {/* HTML Hover Tooltip — breaks the point down per VM */}
        {hoveredTs !== null && hoveredX !== null && hoveredEntries.length > 0 && (
          <div
            className="chart-tooltip"
            style={{
              left: `${hoveredX}px`,
              top: `${paddingTop}px`,
              transform: hoveredX > width / 2 ? "translate(-110%, 0)" : "translate(10px, 0)"
            }}
          >
            <div className="tooltip-row time">{lang === "zh" || !lang ? "時間" : "Time"}: {formatTime(hoveredTs)}</div>
            {hoveredEntries.map((e) => (
              <div key={e.name} className="tooltip-row value" style={{ color: e.color }}>
                {e.name}: {yLabelFormatter ? yLabelFormatter(e.point.val) : `${e.point.val.toFixed(1)}%`}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend — one chip per VM so it's clear which line belongs to which */}
      <div className="chart-legend">
        {series.map((s) => (
          <div key={s.name} className="chart-legend-item">
            <span className="chart-legend-dot" style={{ background: s.color }} />
            <span className="chart-legend-name">{s.name}</span>
            <span className="chart-legend-value">{s.currentValue}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
