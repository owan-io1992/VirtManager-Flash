import { useState, useEffect, useRef, useMemo } from "react";

interface MiniLineChartProps {
  data: number[];
  timestamps: number[];
  // Called only for the hovered point, so parents don't have to pre-format
  // a label for every point on every render
  getHoverLabel?: (dataIdx: number) => string;
  color: string;
  gradientId: string;
  label: string;
  currentValue: string;
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

export const MiniLineChart = ({
  data,
  timestamps,
  getHoverLabel,
  color,
  gradientId,
  label,
  currentValue,
  lang,
  maxVal,
  yLabelFormatter
}: MiniLineChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 500, height: 150 });
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

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

  // Geometry is memoized so hover-driven re-renders (mousemove state updates)
  // only redraw the overlay instead of recomputing every path point
  const { coords, pathD, areaD, dataMax, maxLimit, windowStart } = useMemo(() => {
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

    // Find max value in visible indices to auto-scale, fallback to 100 or a minimum ceiling
    const visibleVals = visibleIndices.map(i => data[i]);
    const dataMax = visibleVals.length > 0 ? Math.max(...visibleVals) : 0;
    const maxLimit = maxVal !== undefined ? maxVal : (dataMax > 0 ? Math.max(dataMax * 1.1, 1) : 100);

    // Map timestamp to X position within the fixed window
    const tsToX = (ts: number) => {
      const pct = (ts - windowStart) / WINDOW_MS;
      return paddingLeft + pct * chartWidth;
    };

    // Build coordinates for visible points
    const coords = visibleIndices.map((i) => ({
      x: tsToX(timestamps[i]),
      y: paddingTop + chartHeight - (Math.min(maxLimit, Math.max(0, data[i])) / maxLimit) * chartHeight,
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

    return { coords, pathD, areaD, dataMax, maxLimit, windowStart };
  }, [data, timestamps, maxVal, width, height, chartWidth, chartHeight]);

  // Generate 5 evenly-spaced X-axis labels across the 10-minute window
  const xAxisLabels = useMemo(() => {
    const labels: { label: string; pct: number }[] = [];
    const labelCount = 5;
    for (let i = 0; i < labelCount; i++) {
      const ts = windowStart + (i / (labelCount - 1)) * WINDOW_MS;
      labels.push({
        label: formatTime(ts),
        pct: (i / (labelCount - 1)) * 100,
      });
    }
    return labels;
  }, [windowStart]);

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
    if (getHoverLabel) {
      return getHoverLabel(dataIdx);
    }
    return `${data[dataIdx].toFixed(1)}%`;
  };

  const displayVal = hoveredIdx !== null
    ? `${getHoveredValueString(hoveredIdx)} (@ ${formatTime(timestamps[coords[hoveredIdx].dataIdx])})`
    : currentValue;

  const formatYLabel = (val: number) => {
    if (yLabelFormatter) {
      return yLabelFormatter(val);
    }
    if (maxVal !== undefined) {
      return `${val.toFixed(0)}%`;
    }
    if (dataMax > 0) {
      return val.toFixed(0);
    }
    return `${val.toFixed(0)}%`;
  };

  return (
    <div className="line-chart-card">
      <div className="chart-info">
        <span className="chart-label">{label} ({lang === "zh" || !lang ? "10\u5206\u6b77\u53f2\u7d00\u9304" : "10m History"})</span>
        <span className="chart-current-value">{displayVal}</span>
      </div>
      <div className="svg-wrapper" ref={containerRef}>
        {/* HTML Y-axis labels */}
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
            <span
              key={i}
              className="chart-axis-text"
              style={{
                transform: "translateX(-50%)",
                whiteSpace: "nowrap"
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
              left: `${coords[hoveredIdx].x}px`,
              top: `${coords[hoveredIdx].y}px`,
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
