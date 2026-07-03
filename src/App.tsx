import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import "./App.css";

// Modular components
import { PreferencesModal } from "./components/PreferencesModal";
import { ResourceManagerModal } from "./components/ResourceManagerModal";
import { AboutModal } from "./components/AboutModal";
import { VmSettingsTab } from "./components/VmSettingsTab";
import { VmList } from "./components/VmList";
import { SidebarHeader } from "./components/SidebarHeader";
import { VmStatusTab } from "./components/VmStatusTab";
import { VmConsoleTab } from "./components/VmConsoleTab";
import { VmSnapshotsTab } from "./components/VmSnapshotsTab";
import { VmBatchView } from "./components/VmBatchView";
import { VmContextMenu } from "./components/VmContextMenu";
import { CreateVmWizard } from "./components/CreateVmWizard";

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
  const [globalToast, setGlobalToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  
  const showGlobalToast = (message: string, type: "success" | "error") => {
    setGlobalToast({ message, type });
    setTimeout(() => {
      setGlobalToast((prev) => (prev && prev.message === message ? null : prev));
    }, 5000);
  };
  
  const [theme, setTheme] = useState<"dark" | "light" | "sketch">(() => {
    return (localStorage.getItem("virtmanager-flash-theme") as "dark" | "light" | "sketch") || "sketch";
  });

  const [lang, setLang] = useState<"zh" | "en">(() => {
    return (localStorage.getItem("virtmanager-flash-lang") as "zh" | "en") || "zh";
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
    const saved = localStorage.getItem("virtmanager-flash-folders");
    return saved ? JSON.parse(saved) : [];
  });

  const [topLevelOrder, setTopLevelOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem("virtmanager-flash-top-level-order");
    return saved ? JSON.parse(saved) : [];
  });

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // App Preferences states
  const [systemResources, setSystemResources] = useState<SystemResources | null>(null);
  const [showPrefModal, setShowPrefModal] = useState(false);
  const [showResModal, setShowResModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [libvirtUri, setLibvirtUri] = useState("qemu:///system");
  const [autoconnect, setAutoconnect] = useState(true);
  const [metricsEnabled, setMetricsEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("virtmanager-flash-metrics-enabled");
    return saved !== null ? saved === "true" : true;
  });

  const [networks, setNetworks] = useState<NetworkItem[]>([]);
  const [storagePools, setStoragePools] = useState<StoragePoolItem[]>([]);
  const [showCreateVmWizard, setShowCreateVmWizard] = useState(false);

  // Sync state changes with localStorage
  useEffect(() => {
    localStorage.setItem("virtmanager-flash-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("virtmanager-flash-lang", lang);
    const updateTitle = async () => {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setTitle(`VirtManager-Flash - ${t("brand_subtitle")}`);
      } catch (err) {
        console.error("Failed to update window title:", err);
      }
    };
    updateTitle();
  }, [lang]);

  useEffect(() => {
    localStorage.setItem("virtmanager-flash-folders", JSON.stringify(folders));
  }, [folders]);

  const metricsEnabledRef = useRef(metricsEnabled);

  useEffect(() => {
    localStorage.setItem("virtmanager-flash-metrics-enabled", String(metricsEnabled));
    metricsEnabledRef.current = metricsEnabled;
  }, [metricsEnabled]);

  useEffect(() => {
    localStorage.setItem("virtmanager-flash-top-level-order", JSON.stringify(topLevelOrder));
  }, [topLevelOrder]);

  // Tabs & Console States
  const [activeTab, setActiveTab] = useState<"status" | "console" | "settings" | "snapshots">("status");
  const [spicePort, setSpicePort] = useState<number | null>(null);
  const [spiceError, setSpiceError] = useState<string | null>(null);
  const [spiceLoading, setSpiceLoading] = useState(false);
  const [proxyToken, setProxyToken] = useState<string>("");

  useEffect(() => {
    invoke<string>("get_proxy_token")
      .then((token) => setProxyToken(token))
      .catch((err) => console.error("Failed to fetch proxy token:", err));
  }, []);

  // CPU usage tracking state & ref
  const [cpuUsage, setCpuUsage] = useState<{ [name: string]: number }>({});
  const prevCpuTimeRef = useRef<{ [name: string]: { cpuTime: number; timestamp: number } }>({});
  const prevDiskNetRef = useRef<{
    [name: string]: {
      diskRdReq: number;
      diskRdBytes: number;
      diskWrReq: number;
      diskWrBytes: number;
      netRxBytes: number;
      netRxPackets: number;
      netTxBytes: number;
      netTxPackets: number;
      timestamp: number;
    }
  }>({});

  // Guest agent availability per VM name
  const [guestAgentAvailable, setGuestAgentAvailable] = useState<{ [name: string]: boolean }>({});

  // 10 mins metrics history (300 points at 2s interval)
  const [metricsHistory, setMetricsHistory] = useState<{
    [vmName: string]: { 
      cpu: number; 
      memoryPercent: number; 
      memoryUsedKb: number; 
      memoryMaxKb: number; 
      diskReadSpeed: number;
      diskWriteSpeed: number;
      diskReadIops: number;
      diskWriteIops: number;
      netRxSpeed: number;
      netTxSpeed: number;
      netRxPackets: number;
      netTxPackets: number;
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
    if (!silent) {
      setLoading(true);
      setError(null);
      fetchSystemResources();
      fetchNetworks();
      fetchStoragePools();
    }
    try {
      const list = await invoke<DomainItem[]>("list_domains", { includeStats: metricsEnabledRef.current });
      
      const now = Date.now();
      const nextCpuUsage: { [name: string]: number } = {};
      
      // Compute CPU usage synchronously (outside state updater) 
      // so nextCpuUsage is populated before setCpuUsage reads it
      const vmMetrics: {
        [name: string]: {
          cpuPercent: number;
          memPercent: number;
          memUsed: number;
          memMax: number;
          diskReadSpeed: number;
          diskWriteSpeed: number;
          diskReadIops: number;
          diskWriteIops: number;
          netRxSpeed: number;
          netTxSpeed: number;
          netRxPackets: number;
          netTxPackets: number;
        };
      } = {};

      list.forEach((vm) => {
        let cpuPercent = 0;
        let memPercent = 0;
        let memUsed = 0;
        let memMax = vm.max_mem;
        let diskReadSpeed = 0;
        let diskWriteSpeed = 0;
        let diskReadIops = 0;
        let diskWriteIops = 0;
        let netRxSpeed = 0;
        let netTxSpeed = 0;
        let netRxPackets = 0;
        let netTxPackets = 0;
        
        if (vm.state === 1) { // Running
          const prev = prevCpuTimeRef.current[vm.name];
          if (prev) {
            const cpuDiff = vm.cpu_time - prev.cpuTime;
            const timeDiff = now - prev.timestamp;
            if (timeDiff > 0 && cpuDiff >= 0) {
              // cpu_time is total ns summed across all vCPUs.
              // Divide by (wall_ns * vcpu_count) to get 0-100% matching guest OS task manager.
              const wallNs = timeDiff * 1000000;
              const percentage = (cpuDiff / (wallNs * vm.vcpu_count)) * 100;
              cpuPercent = Math.min(Math.max(percentage, 0), 100);
            }
          }
          prevCpuTimeRef.current[vm.name] = { cpuTime: vm.cpu_time, timestamp: now };
          
          memUsed = vm.memory;
          if (vm.max_mem > 0) {
            memPercent = (vm.memory / vm.max_mem) * 100;
          }

          // Disk & Net metrics deltas
          const prevDiskNet = prevDiskNetRef.current[vm.name];
          if (prevDiskNet) {
            const timeDiffSec = (now - prevDiskNet.timestamp) / 1000;
            if (timeDiffSec > 0) {
              diskReadSpeed = Math.max(0, (vm.disk_rd_bytes - prevDiskNet.diskRdBytes) / timeDiffSec);
              diskWriteSpeed = Math.max(0, (vm.disk_wr_bytes - prevDiskNet.diskWrBytes) / timeDiffSec);
              diskReadIops = Math.max(0, (vm.disk_rd_req - prevDiskNet.diskRdReq) / timeDiffSec);
              diskWriteIops = Math.max(0, (vm.disk_wr_req - prevDiskNet.diskWrReq) / timeDiffSec);

              netRxSpeed = Math.max(0, (vm.net_rx_bytes - prevDiskNet.netRxBytes) / timeDiffSec);
              netTxSpeed = Math.max(0, (vm.net_tx_bytes - prevDiskNet.netTxBytes) / timeDiffSec);
              netRxPackets = Math.max(0, (vm.net_rx_packets - prevDiskNet.netRxPackets) / timeDiffSec);
              netTxPackets = Math.max(0, (vm.net_tx_packets - prevDiskNet.netTxPackets) / timeDiffSec);
            }
          }
          prevDiskNetRef.current[vm.name] = {
            diskRdReq: vm.disk_rd_req,
            diskRdBytes: vm.disk_rd_bytes,
            diskWrReq: vm.disk_wr_req,
            diskWrBytes: vm.disk_wr_bytes,
            netRxBytes: vm.net_rx_bytes,
            netRxPackets: vm.net_rx_packets,
            netTxBytes: vm.net_tx_bytes,
            netTxPackets: vm.net_tx_packets,
            timestamp: now,
          };
        } else {
          delete prevCpuTimeRef.current[vm.name];
          delete prevDiskNetRef.current[vm.name];
        }
        
        nextCpuUsage[vm.name] = cpuPercent;
        vmMetrics[vm.name] = { 
          cpuPercent, 
          memPercent, 
          memUsed, 
          memMax,
          diskReadSpeed,
          diskWriteSpeed,
          diskReadIops,
          diskWriteIops,
          netRxSpeed,
          netTxSpeed,
          netRxPackets,
          netTxPackets,
        };
      });

      if (metricsEnabledRef.current) {
        setMetricsHistory((prevHistory) => {
          const nextHistory = { ...prevHistory };
          
          list.forEach((vm) => {
            if (vm.state !== 1) {
              // VM is not running — clear history so chart starts fresh on next boot
              delete nextHistory[vm.name];
              return;
            }
            const m = vmMetrics[vm.name];
            const vmHist = nextHistory[vm.name] || [];
            const updated = [...vmHist, { 
              cpu: m.cpuPercent, 
              memoryPercent: m.memPercent, 
              memoryUsedKb: m.memUsed, 
              memoryMaxKb: m.memMax, 
              diskReadSpeed: m.diskReadSpeed,
              diskWriteSpeed: m.diskWriteSpeed,
              diskReadIops: m.diskReadIops,
              diskWriteIops: m.diskWriteIops,
              netRxSpeed: m.netRxSpeed,
              netTxSpeed: m.netTxSpeed,
              netRxPackets: m.netRxPackets,
              netTxPackets: m.netTxPackets,
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
      } else {
        setMetricsHistory({});
      }

      setCpuUsage((prev) => ({ ...prev, ...nextCpuUsage }));
      setDomains(list);
      
      // Filter out any selected names that no longer exist
      setSelectedVmNames((prev) => {
        const next = prev.filter((name) => list.some((d) => d.name === name));
        // Only auto-reselect when a previously selected VM disappeared from the
        // list (e.g. deleted) - not when the user intentionally cleared the
        // selection down to zero.
        if (prev.length > 0 && next.length === 0 && list.length > 0) {
          return [list[0].name];
        }
        if (prev.length === next.length && prev.every((val, index) => val === next[index])) {
          return prev;
        }
        return next;
      });
    } catch (err: any) {
      console.error(err);
      setError(err?.toString() || t("err_fetch_vms"));
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
        const savedSize = localStorage.getItem("virtmanager-flash-window-size");
        if (savedSize) {
          const { width, height } = JSON.parse(savedSize);
          await appWindow.setSize(new LogicalSize(width, height));
        }

        // Listen for resize events
        const unsubscribe = await appWindow.onResized(async () => {
          const size = await appWindow.innerSize();
          const factor = await appWindow.scaleFactor();
          const logical = size.toLogical(factor);
          localStorage.setItem("virtmanager-flash-window-size", JSON.stringify({
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

  // Track selected VM's state to avoid re-running guest agent check on every domain refresh
  const selectedVmState = domains.find((d) => d.name === selectedVmNames[0])?.state;

  // Check guest agent when selected VM changes, its running state changes, or user switches to status tab
  useEffect(() => {
    const selectedVmName = selectedVmNames[0];
    if (!selectedVmName || activeTab !== "status") return;
    if (selectedVmState !== 1) {
      setGuestAgentAvailable((prev) => ({ ...prev, [selectedVmName]: false }));
      return;
    }
    invoke<boolean>("check_guest_agent", { name: selectedVmName })
      .then((available) => {
        setGuestAgentAvailable((prev) => ({ ...prev, [selectedVmName]: available }));
      })
      .catch(() => {
        setGuestAgentAvailable((prev) => ({ ...prev, [selectedVmName]: false }));
      });
  }, [selectedVmNames, selectedVmState, activeTab]);

  useEffect(() => {
    const selectedVmName = selectedVmNames[0];
    if (activeTab !== "console" || !selectedVmName || selectedVmState !== 1) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 10;

    setSpiceLoading(true);
    setSpiceError(null);
    setSpicePort(null);

    const tryFetch = () => {
      invoke<number>("get_vm_spice_port", { name: selectedVmName })
        .then((port) => {
          if (cancelled) return;
          setSpicePort(port);
          setSpiceLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          const message = err?.toString() || "";
          // Port not yet allocated by qemu right after start — retry briefly instead of erroring out
          if (message.includes("SPICE_PORT_NOT_READY") && attempts < maxAttempts) {
            attempts += 1;
            setTimeout(tryFetch, 800);
            return;
          }
          console.error(err);
          setSpiceError(message || t("err_spice"));
          setSpiceLoading(false);
        });
    };

    tryFetch();

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedVmNames, selectedVmState]);

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
        const fullMsg = t("err_batch_partial") + errorMsgs;
        setError(fullMsg);
        showGlobalToast(fullMsg, "error");
      }
    } catch (err: any) {
      const fullMsg = t("err_batch_failed") + (err?.toString() || "Unknown error");
      setError(fullMsg);
      showGlobalToast(fullMsg, "error");
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
  const canDelete = selectedDoms.length > 0 && selectedDoms.every((d) => d.state !== 1 && d.state !== 3);

  return (
    <div className={`app-layout ${theme}-theme`}>
      {globalToast && (
        <div className={`footer-toast ${globalToast.type}`} style={{ zIndex: 99999 }}>
          <span className="toast-icon">{globalToast.type === "success" ? "✓" : "✕"}</span>
          <span>{globalToast.message}</span>
        </div>
      )}
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
          setShowResModal={setShowResModal}
          fetchDomains={fetchDomains}
          setIsCreatingFolder={setIsCreatingFolder}
          onCreateVm={() => setShowCreateVmWizard(true)}
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
        <div 
          onClick={() => setShowAboutModal(true)}
          className="sidebar-version-clickable"
          style={{
            marginTop: "auto",
            paddingTop: "0.5rem",
            fontSize: "0.75rem",
            color: "rgba(100, 116, 139, 0.7)",
            textAlign: "center",
            fontFamily: "monospace",
            borderTop: "1px solid rgba(255, 255, 255, 0.05)",
            cursor: "pointer",
            userSelect: "none"
          }}
        >
          v{__APP_VERSION__} (About)
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
                <button
                  className={`tab-item ${activeTab === "snapshots" ? "active" : ""}`}
                  onClick={() => setActiveTab("snapshots")}
                >
                  {t("tab_snapshots")}
                </button>
                {activeTab === "console" &&
                  selectedVm?.state === 1 &&
                  spicePort &&
                  spiceError !== "SPICE_GL_NO_PORT" && (
                    <button
                      className="tab-item"
                      style={{ marginLeft: "auto" }}
                      onClick={() => invoke("open_viewer", { name: selectedVm.name })}
                    >
                      {t("console_open_viewer")}
                    </button>
                  )}
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
                t={t}
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
                      guestAgentAvailable={guestAgentAvailable[selectedVm.name] ?? false}
                      metricsEnabled={metricsEnabled}
                      t={t}
                    />
                  ) : activeTab === "console" ? (
                    // Console Tab (Modular Component)
                    <VmConsoleTab
                      selectedVm={selectedVm}
                      spiceLoading={spiceLoading}
                      spiceError={spiceError}
                      spicePort={spicePort}
                      proxyToken={proxyToken}
                      onOpenViewer={() => invoke("open_viewer", { name: selectedVm.name })}
                      t={t}
                    />
                  ) : activeTab === "settings" ? (
                    // VM Settings Tab (Modular Component)
                    <VmSettingsTab
                      selectedVm={selectedVm}
                      networks={networks}
                      storagePools={storagePools}
                      systemResources={systemResources}
                      t={t}
                      onSaveSuccess={(newName?: string) => {
                        // If the VM was renamed, follow the selection to the new name
                        if (newName && newName !== selectedVm.name) {
                          const nextNames = selectedVmNames.map((n) => (n === selectedVm.name ? newName : n));
                          prevSelectedRef.current = nextNames;
                          setSelectedVmNames(nextNames);
                        }
                        fetchDomains();
                      }}
                    />
                  ) : (
                    // Snapshots Tab (Modular Component)
                    <VmSnapshotsTab
                      selectedVm={selectedVm}
                      theme={theme}
                      lang={lang}
                      t={t}
                    />
                  )}
                </div>
              )
            )}
          </div>
        ) : (
          <div className="details-placeholder">
            <h2>{t("select_env_title")}</h2>
            <p>{t("select_env_desc")}</p>
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
        canDelete={canDelete}
        selectedVmNames={selectedVmNames}
        t={t}
        handleBatchAction={handleBatchAction}
        moveSelectedVmsToFolder={moveSelectedVmsToFolder}
        onDeleted={() => { setSelectedVmNames([]); fetchDomains(true); }}
      />

      {/* App Preferences Modal */}
      <PreferencesModal
        showPrefModal={showPrefModal}
        setShowPrefModal={setShowPrefModal}
        theme={theme}
        setTheme={setTheme}
        lang={lang}
        setLang={setLang}
        autoconnect={autoconnect}
        setAutoconnect={setAutoconnect}
        metricsEnabled={metricsEnabled}
        setMetricsEnabled={setMetricsEnabled}
        t={t}
      />

      {/* Create VM Wizard */}
      <CreateVmWizard
        show={showCreateVmWizard}
        onClose={() => setShowCreateVmWizard(false)}
        storagePools={storagePools}
        t={t}
        onCreated={() => fetchDomains()}
      />

      {/* App Resource Manager Modal */}
      <ResourceManagerModal
        showResModal={showResModal}
        setShowResModal={setShowResModal}
        lang={lang}
        libvirtUri={libvirtUri}
        setLibvirtUri={setLibvirtUri}
        systemResources={systemResources}
        networks={networks}
        storagePools={storagePools}
        t={t}
        onRefresh={() => { fetchNetworks(); fetchStoragePools(); fetchDomains(); }}
      />

      {/* About Application Modal */}
      <AboutModal
        showAboutModal={showAboutModal}
        setShowAboutModal={setShowAboutModal}
        lang={lang}
        t={t}
      />
    </div>
  );
}

export default App;
