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
  
  // Fill data to at least 2 points if empty
  const points = data.length > 1 ? data : (data.length === 1 ? [data[0], data[0]] : [0, 0]);
  const times = timestamps.length > 1 ? timestamps : (timestamps.length === 1 ? [timestamps[0], timestamps[0]] : [Date.now(), Date.now()]);
  
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  
  const coords = points.map((val, idx) => {
    const x = paddingLeft + (idx / (points.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - (val / 100) * chartHeight;
    return { x, y };
  });
  
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

  const startTime = formatTime(times[0]);
  const midTime = formatTime(times[Math.floor(times.length / 2)]);
  const endTime = formatTime(times[times.length - 1]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * width;
    
    const pct = (svgX - paddingLeft) / chartWidth;
    const rawIdx = pct * (points.length - 1);
    const idx = Math.min(Math.max(Math.round(rawIdx), 0), points.length - 1);
    setHoveredIdx(idx);
  };

  const handleMouseLeave = () => {
    setHoveredIdx(null);
  };

  const getHoveredValueString = (idx: number) => {
    if (hoverLabels && hoverLabels[idx] !== undefined) {
      return hoverLabels[idx];
    }
    return `${points[idx].toFixed(1)}%`;
  };

  const displayVal = hoveredIdx !== null 
    ? `${getHoveredValueString(hoveredIdx)} (@ ${formatTime(times[hoveredIdx])})`
    : currentValue;

  return (
    <div className="line-chart-card">
      <div className="chart-info">
        <span className="chart-label">{label} ({lang === "zh" || !lang ? "10分歷史紀錄" : "10m History"})</span>
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

        {/* HTML X-axis labels */}
        <div className="chart-x-axis">
          <span className="chart-axis-text">{startTime}</span>
          <span className="chart-axis-text">{midTime}</span>
          <span className="chart-axis-text">{endTime}</span>
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
            <div className="tooltip-row time">{lang === "zh" || !lang ? "時間" : "Time"}: {formatTime(times[hoveredIdx])}</div>
            <div className="tooltip-row value" style={{ color }}>{lang === "zh" || !lang ? "用量" : "Usage"}: {getHoveredValueString(hoveredIdx)}</div>
          </div>
        )}
      </div>
    </div>
  );
};
