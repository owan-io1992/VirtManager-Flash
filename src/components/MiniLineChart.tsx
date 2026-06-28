import { useState } from "react";

interface MiniLineChartProps {
  data: number[];
  timestamps: number[];
  hoverLabels?: string[];
  color: string;
  gradientId: string;
  label: string;
  currentValue: string;
  lang?: "zh" | "en";
}

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes in ms

export const MiniLineChart = ({
  data,
  timestamps,
  hoverLabels,
  color,
  gradientId,
  label,
  currentValue,
  lang
}: MiniLineChartProps) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const width = 500;
  const height = 180;
  const paddingLeft = 45;
  const paddingRight = 15;
  const paddingTop = 15;
  const paddingBottom = 25;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Fixed 10-minute window: [windowStart, windowEnd]
  const now = timestamps.length > 0 ? timestamps[timestamps.length - 1] : Date.now();
  const windowEnd = now;
  const windowStart = windowEnd - WINDOW_MS;

  // Filter data points within the 10-minute window
  const visibleIndices: number[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] >= windowStart && timestamps[i] <= windowEnd) {
      visibleIndices.push(i);
    }
  }

  // Map timestamp to X position within the fixed window
  const tsToX = (ts: number) => {
    const pct = (ts - windowStart) / WINDOW_MS;
    return paddingLeft + pct * chartWidth;
  };

  // Build coordinates for visible points
  const coords = visibleIndices.map((i) => ({
    x: tsToX(timestamps[i]),
    y: paddingTop + chartHeight - (data[i] / 100) * chartHeight,
    dataIdx: i,
  }));

  // Line path
  const pathD = coords.reduce((acc, coord, idx) => {
    return acc + `${idx === 0 ? "M" : "L"} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`;
  }, "");

  // Area path (closed at the bottom)
  const areaD = coords.length > 0
    ? `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${(height - paddingBottom).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(height - paddingBottom).toFixed(1)} Z`
    : "";

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    const mins = String(date.getMinutes()).padStart(2, '0');
    const secs = String(date.getSeconds()).padStart(2, '0');
    return `${mins}:${secs}`;
  };

  // Generate 5 evenly-spaced X-axis labels across the 10-minute window
  const xAxisLabels: { label: string; pct: number }[] = [];
  const labelCount = 5;
  for (let i = 0; i < labelCount; i++) {
    const ts = windowStart + (i / (labelCount - 1)) * WINDOW_MS;
    xAxisLabels.push({
      label: formatTime(ts),
      pct: (i / (labelCount - 1)) * 100,
    });
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (coords.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * width;

    // Find closest visible point
    let closestIdx = 0;
    let closestDist = Infinity;
    coords.forEach((c, i) => {
      const dist = Math.abs(c.x - svgX);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    });
    setHoveredIdx(closestIdx);
  };

  const handleMouseLeave = () => {
    setHoveredIdx(null);
  };

  const getHoveredValueString = (coordIdx: number) => {
    const dataIdx = coords[coordIdx].dataIdx;
    if (hoverLabels && hoverLabels[dataIdx] !== undefined) {
      return hoverLabels[dataIdx];
    }
    return `${data[dataIdx].toFixed(1)}%`;
  };

  const displayVal = hoveredIdx !== null
    ? `${getHoveredValueString(hoveredIdx)} (@ ${formatTime(timestamps[coords[hoveredIdx].dataIdx])})`
    : currentValue;

  return (
    <div className="line-chart-card">
      <div className="chart-info">
        <span className="chart-label">{label} ({lang === "zh" || !lang ? "10\u5206\u6b77\u53f2\u7d00\u9304" : "10m History"})</span>
        <span className="chart-current-value">{displayVal}</span>
      </div>
      <div className="svg-wrapper">
        {/* HTML Y-axis labels */}
        <div className="chart-y-axis">
          <span className="chart-axis-text">100%</span>
          <span className="chart-axis-text">50%</span>
          <span className="chart-axis-text">0%</span>
        </div>

        <svg 
          viewBox={`0 0 ${width} ${height}`} 
          width="100%" 
          height="100%" 
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: "crosshair" }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          
          {/* Grid lines */}
          <line x1={paddingLeft} y1={paddingTop} x2={width - paddingRight} y2={paddingTop} className="chart-grid-line" />
          <line x1={paddingLeft} y1={paddingTop + chartHeight / 2} x2={width - paddingRight} y2={paddingTop + chartHeight / 2} className="chart-grid-line text-dashed" />
          <line x1={paddingLeft} y1={height - paddingBottom} x2={width - paddingRight} y2={height - paddingBottom} className="chart-grid-line" />

          {/* Area fill */}
          {areaD && <path d={areaD} fill={`url(#${gradientId})`} />}
          
          {/* Trendline */}
          {pathD && <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
          
          {/* Current point indicator dot */}
          {coords.length > 0 && hoveredIdx === null && (
            <circle 
              cx={coords[coords.length - 1].x} 
              cy={coords[coords.length - 1].y} 
              r="4" 
              fill={color} 
              className="chart-pulse-dot" 
            />
          )}

          {/* Hover interactive helpers */}
          {hoveredIdx !== null && coords[hoveredIdx] && (
            <>
              {/* Vertical line indicator */}
              <line 
                x1={coords[hoveredIdx].x} 
                y1={paddingTop} 
                x2={coords[hoveredIdx].x} 
                y2={height - paddingBottom} 
                stroke={color} 
                strokeOpacity="0.4"
                strokeWidth="1.5"
                strokeDasharray="2, 2"
              />
              
              {/* Highlight circle */}
              <circle 
                cx={coords[hoveredIdx].x} 
                cy={coords[hoveredIdx].y} 
                r="5" 
                fill={color} 
                stroke="#FFF"
                strokeWidth="1.5"
              />
            </>
          )}
        </svg>

        {/* HTML X-axis labels — fixed 10-minute markers */}
        <div className="chart-x-axis" style={{ position: "relative" }}>
          {xAxisLabels.map((lbl, i) => (
            <span
              key={i}
              className="chart-axis-text"
              style={{
                position: "absolute",
                left: `${lbl.pct}%`,
                transform: "translateX(-50%)",
              }}
            >
              {lbl.label}
            </span>
          ))}
        </div>

        {/* HTML Hover Tooltip */}
        {hoveredIdx !== null && coords[hoveredIdx] && (
          <div 
            className="chart-tooltip"
            style={{
              left: `${(coords[hoveredIdx].x / width) * 100}%`,
              top: `${(coords[hoveredIdx].y / height) * 100}%`,
              transform: coords[hoveredIdx].x > width / 2 ? "translate(-110%, -50%)" : "translate(10px, -50%)"
            }}
          >
            <div className="tooltip-row time">{lang === "zh" || !lang ? "\u6642\u9593" : "Time"}: {formatTime(timestamps[coords[hoveredIdx].dataIdx])}</div>
            <div className="tooltip-row value" style={{ color }}>{lang === "zh" || !lang ? "\u7528\u91cf" : "Usage"}: {getHoveredValueString(hoveredIdx)}</div>
          </div>
        )}
      </div>
    </div>
  );
};
