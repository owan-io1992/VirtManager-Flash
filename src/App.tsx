import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface DomainItem {
  name: string;
  id: number | null;
  state: number;
  max_mem: number;
  memory: number;
  vcpu_count: number;
  os_type: string;
  cpu_time: number;
}

// Libvirt states mapping
const getStateInfo = (stateNum: number) => {
  switch (stateNum) {
    case 1:
      return { label: "Running", className: "running" };
    case 3:
      return { label: "Paused", className: "paused" };
    case 5:
      return { label: "Stopped", className: "stopped" };
    default:
      return { label: "Offline", className: "stopped" };
  }
};

// Memory formatter
const formatMemory = (kb: number) => {
  if (!kb) return "0 MB";
  const mb = kb / 1024;
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
};

// Initial Console Boot Logs
const getInitialLogs = (vmName: string) => [
  `Vessel Virtual Console v1.0.0`,
  `Connecting to serial console for ${vmName}...`,
  `Connected. Type 'help' for a list of available commands.`,
  ``,
  `Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0-generic x86_64)`,
  ` * Documentation:  https://help.ubuntu.com`,
  ` * Management:     https://landscape.canonical.com`,
  ` * Support:        https://ubuntu.com/pro`,
  ``,
  `System information as of Mon Jun 22 12:00:00 UTC 2026`,
  ``,
  `  System load:  0.02               Processes:             98`,
  `  Usage of /:   11.5% of 19.56GB   Users logged in:       0`,
  `  Memory usage: 7%                 IPv4 address for eth0: 192.168.122.42`,
  ``,
];

interface MiniLineChartProps {
  data: number[];
  timestamps: number[];
  hoverLabels?: string[];
  color: string;
  gradientId: string;
  label: string;
  currentValue: string;
}

const MiniLineChart = ({ data, timestamps, hoverLabels, color, gradientId, label, currentValue }: MiniLineChartProps) => {
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
        <span className="chart-label">{label} (10分歷史紀錄)</span>
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
            <div className="tooltip-row time">時間: {formatTime(times[hoveredIdx])}</div>
            <div className="tooltip-row value" style={{ color }}>用量: {getHoveredValueString(hoveredIdx)}</div>
          </div>
        )}
      </div>
    </div>
  );
};

function App() {
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<{ [name: string]: boolean }>({});
  const [selectedVmNames, setSelectedVmNames] = useState<string[]>([]);
  const [lastSelectedName, setLastSelectedName] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; vmName: string } | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  
  // Tabs & Console States
  const [activeTab, setActiveTab] = useState<"status" | "console">("status");
  const [consoleInput, setConsoleInput] = useState("");
  const [consoleLogs, setConsoleLogs] = useState<{ [vmName: string]: string[] }>({});
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // CPU usage tracking state & ref
  const [cpuUsage, setCpuUsage] = useState<{ [name: string]: number }>({});
  const prevCpuTimeRef = useRef<{ [name: string]: { cpuTime: number; timestamp: number } }>({});

  // 10 mins metrics history (300 points at 2s interval)
  const [metricsHistory, setMetricsHistory] = useState<{
    [vmName: string]: { 
      cpu: number; 
      memoryPercent: number; 
      memoryUsedKb: number; 
      memoryMaxKb: number; 
      timestamp: number; 
    }[];
  }>({});

  const fetchDomains = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const list = await invoke<DomainItem[]>("list_domains");
      
      const now = Date.now();
      const nextCpuUsage: { [name: string]: number } = {};
      
      setMetricsHistory((prevHistory) => {
        const nextHistory = { ...prevHistory };
        
        list.forEach((vm) => {
          let cpuPercent = 0;
          let memPercent = 0;
          let memUsed = 0;
          let memMax = vm.max_mem;
          
          if (vm.state === 1) { // Running
            const prev = prevCpuTimeRef.current[vm.name];
            if (prev) {
              const cpuDiff = vm.cpu_time - prev.cpuTime;
              const timeDiff = now - prev.timestamp;
              if (timeDiff > 0 && cpuDiff >= 0) {
                const vcpus = vm.vcpu_count || 1;
                const percentage = (cpuDiff / (timeDiff * 1000000 * vcpus)) * 100;
                cpuPercent = Math.min(Math.max(percentage, 0), 100);
              }
            }
            prevCpuTimeRef.current[vm.name] = { cpuTime: vm.cpu_time, timestamp: now };
            
            memUsed = vm.memory;
            if (vm.max_mem > 0) {
              memPercent = (vm.memory / vm.max_mem) * 100;
            }
          } else {
            delete prevCpuTimeRef.current[vm.name];
          }
          
          nextCpuUsage[vm.name] = cpuPercent;
          
          const vmHist = nextHistory[vm.name] || [];
          const updated = [...vmHist, { 
            cpu: cpuPercent, 
            memoryPercent: memPercent, 
            memoryUsedKb: memUsed, 
            memoryMaxKb: memMax, 
            timestamp: now 
          }];
          if (updated.length > 300) {
            nextHistory[vm.name] = updated.slice(updated.length - 300);
          } else {
            nextHistory[vm.name] = updated;
          }
        });
        
        return nextHistory;
      });

      setCpuUsage((prev) => ({ ...prev, ...nextCpuUsage }));
      setDomains(list);
      
      // Filter out any selected names that no longer exist
      setSelectedVmNames((prev) => {
        const next = prev.filter((name) => list.some((d) => d.name === name));
        if (next.length === 0 && list.length > 0) {
          return [list[0].name];
        }
        if (prev.length === next.length && prev.every((val, index) => val === next[index])) {
          return prev;
        }
        return next;
      });
    } catch (err: any) {
      console.error(err);
      setError(err?.toString() || "Failed to fetch virtual machines from libvirt.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDomains();

    // Setup polling every 2 seconds
    const interval = setInterval(() => {
      fetchDomains(true);
    }, 2000);

    // Close context menu on click elsewhere
    const handleWindowClick = () => {
      setContextMenu(null);
    };
    window.addEventListener("click", handleWindowClick);
    return () => {
      clearInterval(interval);
      window.removeEventListener("click", handleWindowClick);
    };
  }, []);

  const prevSelectedRef = useRef<string[]>([]);

  // Reset tab and scroll console when selected VM changes
  useEffect(() => {
    const prev = prevSelectedRef.current;
    const current = selectedVmNames;
    const isSame = prev.length === current.length && prev.every((val, idx) => val === current[idx]);
    if (!isSame) {
      setActiveTab("status");
      prevSelectedRef.current = current;
    }
  }, [selectedVmNames]);

  // Auto scroll terminal
  useEffect(() => {
    if (activeTab === "console") {
      terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [consoleLogs, activeTab]);

  // Multi-select Click Handler
  const handleItemClick = (e: React.MouseEvent, name: string) => {
    if (e.shiftKey && lastSelectedName && lastSelectedName !== name) {
      const lastIndex = domains.findIndex((d) => d.name === lastSelectedName);
      const currentIndex = domains.findIndex((d) => d.name === name);
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeNames = domains.slice(start, end + 1).map((d) => d.name);
        setSelectedVmNames(rangeNames);
      }
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedVmNames((prev) => {
        if (prev.includes(name)) {
          return prev.filter((n) => n !== name);
        } else {
          return [...prev, name];
        }
      });
      setLastSelectedName(name);
    } else {
      setSelectedVmNames([name]);
      setLastSelectedName(name);
    }
  };

  // Checkbox Toggle Handler
  const handleCheckboxChange = (name: string) => {
    setSelectedVmNames((prev) => {
      if (prev.includes(name)) {
        return prev.filter((n) => n !== name);
      } else {
        return [...prev, name];
      }
    });
    setLastSelectedName(name);
  };

  // Context Menu Trigger Handler
  const handleContextMenu = (e: React.MouseEvent, name: string) => {
    e.preventDefault();
    
    // If right-clicked item is not selected, make it the single selection
    if (!selectedVmNames.includes(name)) {
      setSelectedVmNames([name]);
      setLastSelectedName(name);
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      vmName: name,
    });
  };

  // Batch Action Handler
  const handleBatchAction = async (action: string) => {
    setError(null);
    
    // Set loading state for all selected VMs
    setActionLoading((prev) => {
      const next = { ...prev };
      selectedVmNames.forEach((name) => {
        next[name] = true;
      });
      return next;
    });

    try {
      const promises = selectedVmNames.map(async (name) => {
        try {
          await invoke(action, { name });
          return { name, success: true, error: null };
        } catch (err: any) {
          return { name, success: false, error: err?.toString() || "Unknown error" };
        }
      });

      const results = await Promise.all(promises);
      const failures = results.filter((r) => !r.success);

      if (failures.length > 0) {
        const errorMsgs = failures.map((f) => `${f.name}: ${f.error}`).join("; ");
        setError(`Batch execution completed with errors: ${errorMsgs}`);
      }
    } catch (err: any) {
      setError(`Batch action failed: ${err?.toString() || "Unknown error"}`);
    } finally {
      // Clear loading state for all selected VMs
      setActionLoading((prev) => {
        const next = { ...prev };
        selectedVmNames.forEach((name) => {
          next[name] = false;
        });
        return next;
      });
      await fetchDomains();
    }
  };

  // Console Command Interpreter
  const handleConsoleSubmit = async (e: React.FormEvent, vmName: string, vm: DomainItem) => {
    e.preventDefault();
    const cmd = consoleInput.trim();
    if (!cmd) return;

    setConsoleInput("");
    const currentLogs = consoleLogs[vmName] || getInitialLogs(vmName);
    const updatedLogs = [...currentLogs, `root@${vmName}:~# ${cmd}`];

    let output: string[] = [];
    const commandLower = cmd.toLowerCase();

    if (commandLower === "help") {
      output = [
        "Available commands:",
        "  help      - Show this help summary",
        "  status    - Print KVM/LXC status and system allocation",
        "  neofetch  - Print system parameters and logo",
        "  restart   - Reboot the virtual machine",
        "  shutdown  - Gracefully shutdown the virtual machine",
        "  clear     - Clear the terminal console log screen"
      ];
    } else if (commandLower === "clear") {
      setConsoleLogs((prev) => ({ ...prev, [vmName]: [] }));
      return;
    } else if (commandLower === "status") {
      output = [
        `Domain: ${vm.name}`,
        `OS Type: ${vm.os_type}`,
        `vCPUs: ${vm.vcpu_count}`,
        `Memory: ${formatMemory(vm.max_mem)}`,
        `State Code: ${vm.state} (${getStateInfo(vm.state).label})`
      ];
    } else if (commandLower === "neofetch") {
      output = [
        "            .-.          root@" + vmName,
        "            oo|          --------------",
        "           /`'\\          OS: Vessel OS Linux x86_64",
        "          (/\\/\\)         Kernel: 6.8.0-35-generic",
        "          ====           Uptime: 2 days, 4 hours",
        "         /     \\         Shell: bash 5.2.21",
        "        |       |        CPU: QEMU Virtual CPU (" + vm.vcpu_count + ")",
        "        |  ___  |        Memory: " + formatMemory(vm.max_mem) + " / 32 GB",
        "        /_/   \\_\\"
      ];
    } else if (commandLower === "restart") {
      output = [`Sending ACPI reboot command to guest...`];
      try {
        await invoke("reboot_domain", { name: vmName });
        output.push(`Reboot command acknowledged by libvirt.`);
      } catch (err: any) {
        output.push(`Error: ${err?.toString() || "Reboot failed"}`);
      }
    } else if (commandLower === "shutdown") {
      output = [`Sending graceful ACPI shutdown signal to guest...`];
      try {
        await invoke("shutdown_domain", { name: vmName });
        output.push(`Shutdown signal acknowledged by libvirt.`);
      } catch (err: any) {
        output.push(`Error: ${err?.toString() || "Shutdown failed"}`);
      }
    } else {
      output = [`bash: command not found: ${cmd}`];
    }

    setConsoleLogs((prev) => ({
      ...prev,
      [vmName]: [...updatedLogs, ...output, ""],
    }));
  };

  const runningCount = domains.filter((d) => d.state === 1).length;
  const stoppedCount = domains.filter((d) => d.state !== 1).length;

  const isMultiSelect = selectedVmNames.length > 1;
  const selectedVm = domains.find((d) => d.name === selectedVmNames[0]);
  const selectedDoms = domains.filter((d) => selectedVmNames.includes(d.name));

  // Compute resource totals for selection
  const totalCores = selectedDoms.reduce((acc, d) => acc + d.vcpu_count, 0);
  const totalMemory = selectedDoms.reduce((acc, d) => acc + d.max_mem, 0);

  // Check if active operations are running
  const isAnyActionLoading = selectedVmNames.some((name) => actionLoading[name]);

  // Context Menu Lifecycle States Enablement
  const canStart = selectedDoms.some((d) => d.state !== 1 && d.state !== 3); // some stopped
  const canPause = selectedDoms.some((d) => d.state === 1); // some running
  const canResume = selectedDoms.some((d) => d.state === 3); // some paused
  const canReboot = selectedDoms.some((d) => d.state === 1); // some running
  const canShutdown = selectedDoms.some((d) => d.state === 1); // some running
  const canForceStop = selectedDoms.some((d) => d.state === 1 || d.state === 3); // some running/paused
  const canReset = selectedDoms.some((d) => d.state === 1 || d.state === 3); // some running/paused

  return (
    <div className={`app-layout ${theme}-theme`}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="brand">
              <span className="logo-icon">🚢</span>
              <div>
                <h1>Vessel</h1>
                <p className="subtitle">KVM & LXC Manager</p>
              </div>
            </div>
            <button
              className="btn-theme"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "切換至淺色主題" : "切換至深色主題"}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
          <div className="status-badge">
            <span className="status-dot"></span>
            <span>Hypervisor Connected</span>
          </div>

          {/* Batch Actions Bar under connection status */}
          <div className="batch-actions-bar">
            <button
              className="btn-batch btn-start"
              onClick={() => handleBatchAction("start_domain")}
              disabled={isAnyActionLoading || !canStart}
              title="開機"
            >
              <span className="btn-icon">▶</span> 開機
            </button>
            <button
              className="btn-batch btn-stop"
              onClick={() => handleBatchAction("shutdown_domain")}
              disabled={isAnyActionLoading || !canShutdown}
              title="關機"
            >
              <span className="btn-icon">■</span> 關機
            </button>
            <button
              className="btn-batch btn-settings"
              disabled={isMultiSelect || selectedVmNames.length === 0 || isAnyActionLoading}
              title={isMultiSelect ? "設定不支援多選操作" : "編輯設定"}
            >
              <span className="btn-icon">⚙</span> 設定
            </button>
          </div>
        </div>

        {/* Mini Stats Summary */}
        <div className="stats-summary">
          <div className="stat-item">
            <span className="stat-val">{domains.length}</span>
            <span className="stat-lbl">Total</span>
          </div>
          <div className="stat-item">
            <span className="stat-val" style={{ color: "#10B981" }}>
              {runningCount}
            </span>
            <span className="stat-lbl">Active</span>
          </div>
          <div className="stat-item">
            <span className="stat-val" style={{ color: "#EF4444" }}>
              {stoppedCount}
            </span>
            <span className="stat-lbl">Stopped</span>
          </div>
        </div>

        {/* List Controls */}
        <div className="list-controls">
          <span className="list-title">Environments</span>
          <button
            className={`btn-refresh ${loading ? "loading" : ""}`}
            onClick={() => fetchDomains()}
            disabled={loading}
            title="Refresh list"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        </div>

        {/* VM Vertical List */}
        <div className="vm-list">
          {domains.map((vm) => {
            const isSelected = selectedVmNames.includes(vm.name);
            const stateInfo = getStateInfo(vm.state);

            return (
              <div
                key={vm.name}
                className={`vm-list-item ${isSelected ? "selected" : ""}`}
                onClick={(e) => handleItemClick(e, vm.name)}
                onContextMenu={(e) => handleContextMenu(e, vm.name)}
              >
                <div className="vm-item-checkbox-container" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="vm-item-checkbox"
                    checked={isSelected}
                    onChange={() => handleCheckboxChange(vm.name)}
                  />
                </div>
                <div className="vm-item-details">
                  <span className="vm-item-name">{vm.name}</span>
                  <span className="vm-item-type">
                    {vm.os_type.toLowerCase().includes("hvm") ? "KVM VM" : "LXC Container"}
                  </span>
                </div>
                <div className="vm-item-status">
                  <span className={`status-dot-mini ${stateInfo.className}`}></span>
                </div>
              </div>
            );
          })}

          {domains.length === 0 && !loading && (
            <div style={{ textAlign: "center", color: "#64748B", padding: "2rem 0", fontSize: "0.85rem" }}>
              No VMs found.
            </div>
          )}
        </div>
      </aside>

      {/* Main Details Area */}
      <main className="main-content">
        {error && (
          <div className="notification-banner">
            <span>{error}</span>
            <button className="btn-close-banner" onClick={() => setError(null)}>
              &times;
            </button>
          </div>
        )}

        {selectedVmNames.length > 0 ? (
          <div className="details-pane">
            {/* Tabs Bar for Single VM */}
            {!isMultiSelect && (
              <div className="details-tabs">
                <button
                  className={`tab-item ${activeTab === "status" ? "active" : ""}`}
                  onClick={() => setActiveTab("status")}
                >
                  狀態 (Status)
                </button>
                <button
                  className={`tab-item ${activeTab === "console" ? "active" : ""}`}
                  onClick={() => setActiveTab("console")}
                >
                  Console 介面
                </button>
              </div>
            )}

            {/* Selection Info */}
            {isMultiSelect ? (
              <div className="multi-select-view">
                <div className="details-header">
                  <div className="details-title-area">
                    <span className="details-name">批次選取 ({selectedVmNames.length} 台環境)</span>
                    <span className="details-type">Batch Control Mode</span>
                  </div>
                </div>

                {/* Resource Totals */}
                <div className="resources-grid">
                  <div className="resource-card">
                    <span className="resource-card-label">總計 vCPU 核心</span>
                    <span className="resource-card-val">{totalCores} Cores</span>
                  </div>
                  <div className="resource-card">
                    <span className="resource-card-label">總計配置記憶體</span>
                    <span className="resource-card-val">{formatMemory(totalMemory)}</span>
                  </div>
                </div>

                {/* List of Selected VMs */}
                <div className="selected-vms-list-header">已選取的虛擬機：</div>
                <div className="selected-vms-list">
                  {selectedDoms.map((d) => {
                    const stateInfo = getStateInfo(d.state);
                    return (
                      <div key={d.name} className="selected-vm-row">
                        <span>{d.name}</span>
                        <span className={`state-badge ${stateInfo.className}`} style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}>
                          <span className="badge-dot"></span>
                          {stateInfo.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              // Single VM View
              selectedVm && (
                <div className="single-select-view" style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
                  {activeTab === "status" ? (
                    <>
                      <div className="details-header">
                        <div className="details-title-area">
                          <span className="details-name">{selectedVm.name}</span>
                          <span className="details-type">
                            {selectedVm.os_type.toLowerCase().includes("hvm")
                              ? "KVM Virtual Machine"
                              : "LXC Linux Container"}
                          </span>
                        </div>
                        <span className={`state-badge ${getStateInfo(selectedVm.state).className}`}>
                          <span className="badge-dot"></span>
                          {getStateInfo(selectedVm.state).label}
                        </span>
                      </div>

                      {/* Resources Section */}
                      <div className="resources-grid">
                        <div className="resource-card">
                          <span className="resource-card-label">vCPU Cores</span>
                          <span className="resource-card-val">{selectedVm.vcpu_count} Cores</span>
                        </div>
                        <div className="resource-card">
                          <span className="resource-card-label">Max Memory</span>
                          <span className="resource-card-val">{formatMemory(selectedVm.max_mem)}</span>
                        </div>
                      </div>

                      {/* Real-Time Metrics */}
                      <div className="metrics-section">
                        <div className="metric-card">
                          <MiniLineChart 
                            data={(metricsHistory[selectedVm.name] || []).map(p => p.cpu)}
                            timestamps={(metricsHistory[selectedVm.name] || []).map(p => p.timestamp)}
                            color={theme === "dark" ? "#24C6DC" : "#0891B2"}
                            gradientId="cpuHistoryGrad"
                            label="CPU"
                            currentValue={selectedVm.state === 1 ? `${(cpuUsage[selectedVm.name] || 0).toFixed(1)}%` : "0.0%"}
                          />
                        </div>

                        <div className="metric-card">
                          <MiniLineChart 
                            data={(metricsHistory[selectedVm.name] || []).map(p => p.memoryPercent)}
                            timestamps={(metricsHistory[selectedVm.name] || []).map(p => p.timestamp)}
                            hoverLabels={(metricsHistory[selectedVm.name] || []).map(p => 
                              selectedVm.state === 1 && p.memoryUsedKb > 0
                                ? `${formatMemory(p.memoryUsedKb)} / ${formatMemory(p.memoryMaxKb)} (${p.memoryPercent.toFixed(1)}%)`
                                : `0 MB / ${formatMemory(p.memoryMaxKb)} (0.0%)`
                            )}
                            color={theme === "dark" ? "#A855F7" : "#C084FC"}
                            gradientId="memHistoryGrad"
                            label="Memory"
                            currentValue={selectedVm.state === 1 
                              ? `${formatMemory(selectedVm.memory)} / ${formatMemory(selectedVm.max_mem)} (${selectedVm.max_mem > 0 ? ((selectedVm.memory / selectedVm.max_mem) * 100).toFixed(1) : "0.0"}%)`
                              : `0 MB / ${formatMemory(selectedVm.max_mem)} (0.0%)`
                            }
                          />
                        </div>
                      </div>

                    </>
                  ) : (
                    // Console Terminal Tab
                    <div className="console-panel">
                      {selectedVm.state === 1 ? (
                        <div className="terminal-screen">
                          <div className="terminal-history">
                            {(consoleLogs[selectedVm.name] || getInitialLogs(selectedVm.name)).map((line, idx) => (
                              <div key={idx} className="terminal-line">
                                {line}
                              </div>
                            ))}
                            <div ref={terminalEndRef} />
                          </div>
                          <form
                            className="terminal-input-row"
                            onSubmit={(e) => handleConsoleSubmit(e, selectedVm.name, selectedVm)}
                          >
                            <span className="terminal-prompt">root@{selectedVm.name}:~#</span>
                            <input
                              type="text"
                              className="terminal-input"
                              value={consoleInput}
                              onChange={(e) => setConsoleInput(e.target.value)}
                              autoFocus
                            />
                            <span className="blinking-cursor"></span>
                          </form>
                        </div>
                      ) : (
                        <div className="terminal-offline-screen">
                          <span className="terminal-offline-icon">🔌</span>
                          <p>Connection closed. VM is offline.</p>
                          <p className="terminal-subtext">Please start the virtual machine to open the serial console.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        ) : (
          <div className="details-placeholder">
            <div className="placeholder-icon">🚢</div>
            <h2>Select an Environment</h2>
            <p>Choose a KVM virtual machine or LXC container from the sidebar to view details and control actions.</p>
          </div>
        )}
      </main>

      {/* Right-click Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              handleBatchAction("start_domain");
              setContextMenu(null);
            }}
            disabled={!canStart || isAnyActionLoading}
          >
            <span className="menu-icon">▶</span> 開機 (Start)
          </button>
          
          <button
            className="context-menu-item"
            onClick={() => {
              handleBatchAction("suspend_domain");
              setContextMenu(null);
            }}
            disabled={!canPause || isAnyActionLoading}
          >
            <span className="menu-icon">⏸</span> 暫停 (Pause)
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              handleBatchAction("resume_domain");
              setContextMenu(null);
            }}
            disabled={!canResume || isAnyActionLoading}
          >
            <span className="menu-icon">▶</span> 恢復 (Resume)
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              handleBatchAction("reboot_domain");
              setContextMenu(null);
            }}
            disabled={!canReboot || isAnyActionLoading}
          >
            <span className="menu-icon">↻</span> 重新啟動 (Reboot)
          </button>

          <button
            className="context-menu-item"
            onClick={() => {
              handleBatchAction("shutdown_domain");
              setContextMenu(null);
            }}
            disabled={!canShutdown || isAnyActionLoading}
          >
            <span className="menu-icon">■</span> 關機 (Shutdown)
          </button>

          <div className="context-menu-separator"></div>

          <button
            className="context-menu-item danger"
            onClick={() => {
              handleBatchAction("stop_domain");
              setContextMenu(null);
            }}
            disabled={!canForceStop || isAnyActionLoading}
          >
            <span className="menu-icon">⚡</span> 強制關機 (Force Stop)
          </button>

          <button
            className="context-menu-item danger"
            onClick={() => {
              handleBatchAction("reset_domain");
              setContextMenu(null);
            }}
            disabled={!canReset || isAnyActionLoading}
          >
            <span className="menu-icon">⟳</span> Reset (重設)
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
