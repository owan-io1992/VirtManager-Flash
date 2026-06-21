import { useState, useEffect } from "react";
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

function App() {
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<{ [name: string]: boolean }>({});
  const [selectedVmNames, setSelectedVmNames] = useState<string[]>([]);
  const [lastSelectedName, setLastSelectedName] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; vmName: string } | null>(null);

  const fetchDomains = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<DomainItem[]>("list_domains");
      setDomains(list);
      
      // Filter out any selected names that no longer exist
      setSelectedVmNames((prev) => {
        const next = prev.filter((name) => list.some((d) => d.name === name));
        if (next.length === 0 && list.length > 0) {
          return [list[0].name];
        }
        return next;
      });
    } catch (err: any) {
      console.error(err);
      setError(err?.toString() || "Failed to fetch virtual machines from libvirt.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDomains();

    // Close context menu on click elsewhere
    const handleWindowClick = () => {
      setContextMenu(null);
    };
    window.addEventListener("click", handleWindowClick);
    return () => {
      window.removeEventListener("click", handleWindowClick);
    };
  }, []);

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
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <span className="logo-icon">🚢</span>
            <div>
              <h1>Vessel</h1>
              <p className="subtitle">KVM & LXC Manager</p>
            </div>
          </div>
          <div className="status-badge">
            <span className="status-dot"></span>
            <span>Hypervisor Connected</span>
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
            onClick={fetchDomains}
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
            {/* Top Batch Actions Bar */}
            <div className="batch-actions-bar">
              <button
                className="btn-batch btn-start"
                onClick={() => handleBatchAction("start_domain")}
                disabled={isAnyActionLoading || !canStart}
              >
                <span className="btn-icon">▶</span> 開機
              </button>
              <button
                className="btn-batch btn-stop"
                onClick={() => handleBatchAction("shutdown_domain")}
                disabled={isAnyActionLoading || !canShutdown}
              >
                <span className="btn-icon">■</span> 關機
              </button>
              <button
                className="btn-batch btn-settings"
                disabled={isMultiSelect || isAnyActionLoading}
                title={isMultiSelect ? "設定不支援多選操作" : "編輯設定"}
              >
                <span className="btn-icon">⚙</span> 設定
              </button>
            </div>

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
                <div className="single-select-view">
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
                      <span className="resource-card-label">Allocated Memory</span>
                      <span className="resource-card-val">{formatMemory(selectedVm.max_mem)}</span>
                    </div>
                  </div>

                  {/* Extra actions for single VM */}
                  <div className="single-vm-extra-actions">
                    <button
                      className="btn-action btn-danger"
                      onClick={() => handleBatchAction("stop_domain")}
                      disabled={selectedVm.state !== 1 || isAnyActionLoading}
                      style={{ width: "100%" }}
                    >
                      強制停止 (Force Stop)
                    </button>
                  </div>
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
