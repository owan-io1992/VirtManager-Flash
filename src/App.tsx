import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import "./App.css";

// Modular components
import { PreferencesModal } from "./components/PreferencesModal";
import { VmSettingsTab } from "./components/VmSettingsTab";
import { VmList } from "./components/VmList";
import { SidebarHeader } from "./components/SidebarHeader";
import { VmStatusTab } from "./components/VmStatusTab";
import { VmConsoleTab } from "./components/VmConsoleTab";
import { VmBatchView } from "./components/VmBatchView";
import { VmContextMenu } from "./components/VmContextMenu";

// Common types & translations
import { DomainItem, Folder, NetworkItem, StoragePoolItem, SystemResources } from "./types";
import { translations, TranslationKey } from "./translations";

// Memory formatter helper
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
  
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("vessel-theme") as "dark" | "light") || "dark";
  });

  const [lang, setLang] = useState<"zh" | "en">(() => {
    return (localStorage.getItem("vessel-lang") as "zh" | "en") || "zh";
  });

  const t = (key: TranslationKey, replaceMap?: Record<string, string | number>) => {
    let text = translations[lang][key] || translations.zh[key] || "";
    if (replaceMap) {
      Object.keys(replaceMap).forEach((k) => {
        text = text.replace(`{${k}}`, String(replaceMap[k]));
      });
    }
    return text;
  };

  const [folders, setFolders] = useState<Folder[]>(() => {
    const saved = localStorage.getItem("vessel-folders");
    return saved ? JSON.parse(saved) : [];
  });

  const [topLevelOrder, setTopLevelOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem("vessel-top-level-order");
    return saved ? JSON.parse(saved) : [];
  });

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // App Preferences states
  const [systemResources, setSystemResources] = useState<SystemResources | null>(null);
  const [showPrefModal, setShowPrefModal] = useState(false);
  const [libvirtUri, setLibvirtUri] = useState("qemu:///system");
  const [autoconnect, setAutoconnect] = useState(true);

  const [networks, setNetworks] = useState<NetworkItem[]>([]);
  const [storagePools, setStoragePools] = useState<StoragePoolItem[]>([]);

  // Sync state changes with localStorage
  useEffect(() => {
    localStorage.setItem("vessel-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("vessel-lang", lang);
  }, [lang]);

  useEffect(() => {
    localStorage.setItem("vessel-folders", JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    localStorage.setItem("vessel-top-level-order", JSON.stringify(topLevelOrder));
  }, [topLevelOrder]);

  // Tabs & Console States
  const [activeTab, setActiveTab] = useState<"status" | "console" | "settings">("status");
  const [spicePort, setSpicePort] = useState<number | null>(null);
  const [spiceError, setSpiceError] = useState<string | null>(null);
  const [spiceLoading, setSpiceLoading] = useState(false);

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

  const fetchSystemResources = async () => {
    try {
      const res = await invoke<SystemResources>("get_system_resources");
      setSystemResources(res);
    } catch (err) {
      console.error("Failed to fetch system resources:", err);
    }
  };

  const fetchNetworks = async () => {
    try {
      const list = await invoke<NetworkItem[]>("list_networks");
      setNetworks(list);
    } catch (err) {
      console.error("Failed to fetch networks:", err);
    }
  };

  const fetchStoragePools = async () => {
    try {
      const list = await invoke<StoragePoolItem[]>("list_storage_pools");
      setStoragePools(list);
    } catch (err) {
      console.error("Failed to fetch storage pools:", err);
    }
  };

  const fetchDomains = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    fetchSystemResources();
    fetchNetworks();
    fetchStoragePools();
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

  // Synchronize topLevelOrder and folders with active domains
  useEffect(() => {
    if (domains.length === 0) return;
    const activeVmNames = new Set(domains.map((d) => d.name));

    // 1. Clean folders: remove VMs that no longer exist
    let folderChanged = false;
    const nextFolders = folders.map((f) => {
      const filteredVms = f.vmNames.filter((name) => activeVmNames.has(name));
      if (filteredVms.length !== f.vmNames.length) {
        folderChanged = true;
      }
      return { ...f, vmNames: filteredVms };
    });

    if (folderChanged) {
      setFolders(nextFolders);
      return;
    }

    // 2. Clean topLevelOrder
    const vmsInFolders = new Set<string>();
    folders.forEach((f) => {
      f.vmNames.forEach((name) => {
        if (activeVmNames.has(name)) {
          vmsInFolders.add(name);
        }
      });
    });

    setTopLevelOrder((prevOrder) => {
      let nextOrder = prevOrder.filter((item) => {
        if (item.startsWith("folder_")) {
          return folders.some((f) => f.id === item);
        }
        return activeVmNames.has(item) && !vmsInFolders.has(item);
      });

      folders.forEach((f) => {
        if (!nextOrder.includes(f.id)) {
          nextOrder.push(f.id);
        }
      });

      domains.forEach((vm) => {
        if (!nextOrder.includes(vm.name) && !vmsInFolders.has(vm.name)) {
          nextOrder.push(vm.name);
        }
      });

      if (JSON.stringify(prevOrder) === JSON.stringify(nextOrder)) {
        return prevOrder;
      }
      return nextOrder;
    });
  }, [folders, domains]);

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

  // Restore and persist window size
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const restoreWindowSize = async () => {
      try {
        const appWindow = getCurrentWindow();
        
        // Restore size
        const savedSize = localStorage.getItem("vessel-window-size");
        if (savedSize) {
          const { width, height } = JSON.parse(savedSize);
          await appWindow.setSize(new LogicalSize(width, height));
        }

        // Listen for resize events
        const unsubscribe = await appWindow.onResized(async () => {
          const size = await appWindow.innerSize();
          const factor = await appWindow.scaleFactor();
          const logical = size.toLogical(factor);
          localStorage.setItem("vessel-window-size", JSON.stringify({
            width: logical.width,
            height: logical.height
          }));
        });

        unlisten = unsubscribe;
      } catch (err) {
        console.error("Failed to restore/save window size:", err);
      }
    };

    restoreWindowSize();

    return () => {
      if (unlisten) {
        unlisten();
      }
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

  useEffect(() => {
    const selectedVmName = selectedVmNames[0];
    if (activeTab === "console" && selectedVmName) {
      setSpiceLoading(true);
      setSpiceError(null);
      setSpicePort(null);
      invoke<number>("get_vm_spice_port", { name: selectedVmName })
        .then((port) => {
          setSpicePort(port);
        })
        .catch((err) => {
          console.error(err);
          setSpiceError(err?.toString() || "Failed to get SPICE port for VM.");
        })
        .finally(() => {
          setSpiceLoading(false);
        });
    }
  }, [activeTab, selectedVmNames]);

  // Drag and drop event handlers inside App (context menu folder updates)
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const folderId = `folder_${Date.now()}`;
    const newFolder: Folder = {
      id: folderId,
      name: newFolderName.trim(),
      collapsed: false,
      vmNames: [],
    };
    setFolders((prev) => [...prev, newFolder]);
    setTopLevelOrder((prev) => [...prev, folderId]);
    setNewFolderName("");
    setIsCreatingFolder(false);
  };

  const handleDeleteFolder = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const targetFolder = folders.find((f) => f.id === folderId);
    if (!targetFolder) return;

    const vmsToReturn = targetFolder.vmNames;

    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setTopLevelOrder((prevOrder) => {
      const idx = prevOrder.indexOf(folderId);
      const nextOrder = prevOrder.filter((x) => x !== folderId);
      if (idx !== -1) {
        nextOrder.splice(idx, 0, ...vmsToReturn);
      } else {
        nextOrder.push(...vmsToReturn);
      }
      return nextOrder;
    });
  };

  const toggleFolderCollapse = (folderId: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, collapsed: !f.collapsed } : f))
    );
  };

  const moveSelectedVmsToFolder = (folderId: string | null) => {
    selectedVmNames.forEach((vmName) => {
      setFolders((prev) =>
        prev.map((f) => ({
          ...f,
          vmNames: f.vmNames.filter((name) => name !== vmName),
        }))
      );

      if (folderId) {
        setTopLevelOrder((prev) => prev.filter((name) => name !== vmName));
      } else {
        setTopLevelOrder((prev) => {
          if (prev.includes(vmName)) return prev;
          return [...prev, vmName];
        });
      }
    });

    if (folderId) {
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, vmNames: [...f.vmNames, ...selectedVmNames] } : f))
      );
    }
    setContextMenu(null);
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
    <div className={`app-layout ${theme}-theme`}>
      {/* Sidebar */}
      <aside className="sidebar">
        {/* Sidebar Header (Modular Component) */}
        <SidebarHeader
          t={t}
          loading={loading}
          runningCount={runningCount}
          stoppedCount={stoppedCount}
          totalCount={domains.length}
          isAnyActionLoading={isAnyActionLoading}
          canStart={canStart}
          canShutdown={canShutdown}
          handleBatchAction={handleBatchAction}
          setShowPrefModal={setShowPrefModal}
          fetchDomains={fetchDomains}
          setIsCreatingFolder={setIsCreatingFolder}
        />

        {/* Modularized VM Sidebar List */}
        <VmList
          domains={domains}
          folders={folders}
          setFolders={setFolders}
          topLevelOrder={topLevelOrder}
          setTopLevelOrder={setTopLevelOrder}
          selectedVmNames={selectedVmNames}
          setSelectedVmNames={setSelectedVmNames}
          lastSelectedName={lastSelectedName}
          setLastSelectedName={setLastSelectedName}
          lang={lang}
          t={t}
          loading={loading}
          newFolderName={newFolderName}
          setNewFolderName={setNewFolderName}
          isCreatingFolder={isCreatingFolder}
          setIsCreatingFolder={setIsCreatingFolder}
          handleCreateFolder={handleCreateFolder}
          handleDeleteFolder={handleDeleteFolder}
          toggleFolderCollapse={toggleFolderCollapse}
          handleContextMenu={handleContextMenu}
        />
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
                  {t("tab_status")}
                </button>
                <button
                  className={`tab-item ${activeTab === "console" ? "active" : ""}`}
                  onClick={() => setActiveTab("console")}
                >
                  {t("tab_console")}
                </button>
                <button
                  className={`tab-item ${activeTab === "settings" ? "active" : ""}`}
                  onClick={() => setActiveTab("settings")}
                >
                  {t("tab_settings")}
                </button>
              </div>
            )}

            {/* Selection Info */}
            {isMultiSelect ? (
              // Multi VM Selection View (Modular Component)
              <VmBatchView
                selectedVmNames={selectedVmNames}
                selectedDoms={selectedDoms}
                totalCores={totalCores}
                totalMemory={totalMemory}
                formatMemory={formatMemory}
              />
            ) : (
              // Single VM View
              selectedVm && (
                <div className="single-select-view" style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
                  {activeTab === "status" ? (
                    // Status Tab (Modular Component)
                    <VmStatusTab
                      selectedVm={selectedVm}
                      formatMemory={formatMemory}
                      metricsHistory={metricsHistory}
                      cpuUsage={cpuUsage}
                      theme={theme}
                      lang={lang}
                    />
                  ) : activeTab === "console" ? (
                    // Console Tab (Modular Component)
                    <VmConsoleTab
                      selectedVm={selectedVm}
                      spiceLoading={spiceLoading}
                      spiceError={spiceError}
                      spicePort={spicePort}
                      t={t}
                    />
                  ) : (
                    // VM Settings Tab (Modular Component)
                    <VmSettingsTab
                      selectedVm={selectedVm}
                      networks={networks}
                      lang={lang}
                      t={t}
                      onSaveSuccess={fetchDomains}
                    />
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

      {/* Context Menu (Modular Component) */}
      <VmContextMenu
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        folders={folders}
        canStart={canStart}
        canPause={canPause}
        canResume={canResume}
        canReboot={canReboot}
        canShutdown={canShutdown}
        canForceStop={canForceStop}
        canReset={canReset}
        selectedVmNames={selectedVmNames}
        t={t}
        handleBatchAction={handleBatchAction}
        moveSelectedVmsToFolder={moveSelectedVmsToFolder}
      />

      {/* App Preferences Modal */}
      <PreferencesModal
        showPrefModal={showPrefModal}
        setShowPrefModal={setShowPrefModal}
        theme={theme}
        setTheme={setTheme}
        lang={lang}
        setLang={setLang}
        libvirtUri={libvirtUri}
        setLibvirtUri={setLibvirtUri}
        autoconnect={autoconnect}
        setAutoconnect={setAutoconnect}
        systemResources={systemResources}
        networks={networks}
        storagePools={storagePools}
        t={t}
      />
    </div>
  );
}

export default App;
