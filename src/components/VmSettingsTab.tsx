import { useState, useEffect, ReactNode, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DomainItem, NetworkItem, SystemResources, VmSettings, DiskInfo, NicInfo, StoragePoolItem, parseSizeToGb, parseSizeAndUnit, FilesystemInfo } from "../types";
import { TranslationKey } from "../translations";

interface VmSettingsTabProps {
  selectedVm: DomainItem;
  networks: NetworkItem[];
  storagePools: StoragePoolItem[];
  systemResources: SystemResources | null;
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
  onSaveSuccess?: (newName?: string) => void;
}

type EditorMode = "form" | "xml";
type Category = "general" | "system" | "storage" | "network" | "sharing";
type SystemSubtab = "motherboard" | "processor";

// Inline stroke icons matching the project's SidebarHeader style
const icons: Record<Category, ReactNode> = {
  general: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  ),
  storage: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="12" x2="2" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <line x1="6" y1="16" x2="6.01" y2="16" /><line x1="10" y1="16" x2="10.01" y2="16" />
    </svg>
  ),
  network: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  sharing: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="14" r="3" />
      <path d="M12 11v6" />
      <path d="M9 14h6" />
    </svg>
  ),
};

const categoryLabel: Record<Category, TranslationKey> = {
  general: "vm_cat_general",
  system: "vm_cat_system",
  storage: "vm_settings_storage",
  network: "vm_settings_network",
  sharing: "vm_settings_sharing",
};

const CATEGORIES: Category[] = ["general", "system", "storage", "network", "sharing"];

// A labelled settings row with optional hint.
// Defined at module scope so its identity is stable across renders — otherwise
// React remounts the inputs on every keystroke and they lose focus.
const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="form-row">
    <div className="form-label-group">
      <span className="form-label">{label}</span>
      {hint && <span className="form-hint">{hint}</span>}
    </div>
    <div className="form-control">{children}</div>
  </div>
);

const VmSettingsTabComponent = ({
  selectedVm,
  networks,
  storagePools,
  systemResources,
  t,
  onSaveSuccess,
}: VmSettingsTabProps) => {
  const [editorMode, setEditorMode] = useState<EditorMode>("form");
  const [category, setCategory] = useState<Category>("general");
  const [systemSubtab, setSystemSubtab] = useState<SystemSubtab>("motherboard");

  // Helper for memory units conversion
  const kbToValueAndUnit = (kb: number): { value: number; unit: "MB" | "GB" | "TB" } => {
    const mb = kb / 1024;
    if (mb >= 1024 * 1024 && mb % (1024 * 1024) === 0) {
      return { value: mb / (1024 * 1024), unit: "TB" };
    } else if (mb >= 1024 && mb % 1024 === 0) {
      return { value: mb / 1024, unit: "GB" };
    }
    return { value: Math.round(mb), unit: "MB" };
  };

  const valueToKb = (value: number, unit: "MB" | "GB" | "TB"): number => {
    let mb = value;
    if (unit === "GB") {
      mb = value * 1024;
    } else if (unit === "TB") {
      mb = value * 1024 * 1024;
    }
    return mb * 1024; // MB -> KB
  };

  const handleMemoryUnitChange = (
    currentVal: number,
    fromUnit: "MB" | "GB" | "TB",
    toUnit: "MB" | "GB" | "TB",
    valSetter: (v: number) => void,
    unitSetter: (u: "MB" | "GB" | "TB") => void
  ) => {
    let kb = 0;
    if (fromUnit === "MB") kb = currentVal * 1024;
    else if (fromUnit === "GB") kb = currentVal * 1024 * 1024;
    else if (fromUnit === "TB") kb = currentVal * 1024 * 1024 * 1024;

    let newVal = 0;
    if (toUnit === "MB") newVal = kb / 1024;
    else if (toUnit === "GB") newVal = kb / (1024 * 1024);
    else if (toUnit === "TB") newVal = kb / (1024 * 1024 * 1024);

    newVal = Math.round(newVal * 1000) / 1000;
    valSetter(newVal);
    unitSetter(toUnit);
    setDirty(true);
  };

  const getMinMaxStep = (unit: "MB" | "GB" | "TB") => {
    const totalMb = systemResources ? Math.round(systemResources.mem_total_kb / 1024) : 131072;
    if (unit === "GB") {
      return { min: 0.25, max: Math.round((totalMb / 1024) * 100) / 100, step: 0.25 };
    }
    if (unit === "TB") {
      return { min: 0.001, max: Math.round((totalMb / (1024 * 1024)) * 1000) / 1000, step: 0.001 };
    }
    return { min: 256, max: totalMb, step: 256 };
  };

  // Form state
  const [vmCpuCores, setVmCpuCores] = useState(2);
  const [vmMemoryVal, setVmMemoryVal] = useState(4);
  const [vmMemoryUnit, setVmMemoryUnit] = useState<"MB" | "GB" | "TB">("GB");
  const [vmMaxMemoryVal, setVmMaxMemoryVal] = useState(4);
  const [vmMaxMemoryUnit, setVmMaxMemoryUnit] = useState<"MB" | "GB" | "TB">("GB");
  const [topologyEnabled, setTopologyEnabled] = useState(false);
  const [vmSockets, setVmSockets] = useState(1);
  const [vmTopoCores, setVmTopoCores] = useState(2);
  const [vmThreads, setVmThreads] = useState(1);
  const [vmAutostart, setVmAutostart] = useState(false);
  const [vmBootDevices, setVmBootDevices] = useState<string[]>([]);
  const [vmBootMenu, setVmBootMenu] = useState(false);
  const [vmGraphicsType, setVmGraphicsType] = useState("spice");
  const [vmVideoModel, setVmVideoModel] = useState("qxl");
  const [_osLabel, setOsLabel] = useState("");
  const [osArch, setOsArch] = useState("");
  const [osMachine, setOsMachine] = useState("");
  const [osType, setOsType] = useState("other");
  const [vmName, setVmName] = useState("");
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [initialDisks, setInitialDisks] = useState<DiskInfo[]>([]);
  const [nics, setNics] = useState<NicInfo[]>([]);
  const [secureBoot, setSecureBoot] = useState(false);
  const [tpm, setTpm] = useState(false);
  const [sharedMemory, setSharedMemory] = useState(false);
  const [filesystems, setFilesystems] = useState<FilesystemInfo[]>([]);
  const [instructionsTab, setInstructionsTab] = useState<"linux" | "windows">("linux");

  // XML editor state
  const [xmlText, setXmlText] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToastMessage = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev && prev.message === message ? null : prev));
    }, 3000);
  };

  const maxVcpu = systemResources?.cpu_threads || 128;

  // Push a fetched VmSettings payload into local editable state
  const applySettings = (s: VmSettings) => {
    const memInfo = kbToValueAndUnit(s.current_mem_kb || 2048 * 1024);
    const maxMemInfo = kbToValueAndUnit(s.max_mem_kb || s.current_mem_kb || 2048 * 1024);
    setVmCpuCores(s.vcpu || 1);
    setVmMemoryVal(memInfo.value);
    setVmMemoryUnit(memInfo.unit);
    setVmMaxMemoryVal(maxMemInfo.value);
    setVmMaxMemoryUnit(maxMemInfo.unit);

    const hasTopology = s.cpu_sockets > 0 && s.cpu_cores > 0 && s.cpu_threads > 0;
    setTopologyEnabled(hasTopology);
    setVmSockets(s.cpu_sockets || 1);
    setVmTopoCores(s.cpu_cores || s.vcpu || 1);
    setVmThreads(s.cpu_threads || 1);

    setVmAutostart(s.autostart);
    setVmBootDevices(s.boot_devices || []);
    setVmBootMenu(s.boot_menu || false);
    setVmGraphicsType(s.graphics_type || "none");
    setVmVideoModel(s.video_model || "qxl");
    setOsLabel(s.os_label);
    setOsArch(s.os_arch);
    setOsMachine(s.os_machine);
    setOsType(s.os_type || "other");
    setVmName(s.name);
    setDisks(s.disks);
    setInitialDisks(s.disks);
    setNics(s.nics);
    setSecureBoot(s.secure_boot || false);
    setTpm(s.tpm || false);
    setFilesystems(s.filesystems || []);
    setSharedMemory(s.shared_memory || false);
    setDirty(false);
  };

  // Load whenever the selected VM or editor mode changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    if (editorMode === "form") {
      invoke<VmSettings>("get_vm_settings", { name: selectedVm.name })
        .then((s) => !cancelled && applySettings(s))
        .catch((err: any) => !cancelled && setLoadError(err?.toString() ?? "Unknown error"))
        .finally(() => !cancelled && setLoading(false));
    } else {
      invoke<string>("get_vm_xml", { name: selectedVm.name })
        .then((x) => {
          if (!cancelled) {
            setXmlText(x);
            setDirty(false);
          }
        })
        .catch((err: any) => !cancelled && setLoadError(err?.toString() ?? "Unknown error"))
        .finally(() => !cancelled && setLoading(false));
    }

    return () => {
      cancelled = true;
    };
  }, [selectedVm.name, editorMode]);

  // Status gating: only a powered-off VM can have most settings changed.
  // A whitelist allows a few fields to be edited while the VM is running.
  // libvirt domain state 5 == VIR_DOMAIN_SHUTOFF.
  const isStopped = selectedVm.state === 5;
  const RUNNING_WHITELIST = new Set(["autostart", "net-source"]);
  const canEdit = (key: string) => isStopped || RUNNING_WHITELIST.has(key);

  // Curated common machine types; the VM's current value is always included
  const machineOptions = Array.from(new Set([osMachine, "q35", "pc"].filter(Boolean)));

  // Wrap a setter so any edit flags the form as dirty
  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const updateDisk = (index: number, patch: Partial<DiskInfo>) => {
    setDisks((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
    setDirty(true);
  };

  const getNextTargetDev = () => {
    const existing = new Set(disks.map((d) => d.target_dev));
    for (let i = 0; i < 26; i++) {
      const dev = "vd" + String.fromCharCode(97 + i);
      if (!existing.has(dev)) return dev;
    }
    return "vda";
  };

  const getNextDiskPath = (nextDev: string) => {
    if (disks.length > 0 && disks[0].path) {
      const firstPath = disks[0].path;
      const lastSlash = firstPath.lastIndexOf("/");
      if (lastSlash !== -1) {
        const dir = firstPath.substring(0, lastSlash);
        const extIndex = firstPath.lastIndexOf(".");
        const ext = extIndex !== -1 && extIndex > lastSlash ? firstPath.substring(extIndex) : ".qcow2";
        return `${dir}/${selectedVm.name}-${nextDev}${ext}`;
      }
    }
    return `/var/lib/libvirt/images/${selectedVm.name}-${nextDev}.qcow2`;
  };

  const addDisk = () => {
    const nextDev = getNextTargetDev();
    const nextPath = getNextDiskPath(nextDev);
    const newDisk: DiskInfo = {
      target_dev: nextDev,
      path: nextPath,
      capacity_gb: 20,
      bus: "virtio",
      device: "disk"
    };
    setDisks([...disks, newDisk]);
    setDirty(true);
  };

  const removeDisk = (index: number) => {
    setDisks(disks.filter((_, i) => i !== index));
    setDirty(true);
  };

  const generateRandomMac = () => {
    const hex = "0123456789abcdef";
    let mac = "52:54:00";
    for (let i = 0; i < 3; i++) {
      mac += ":" + hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)];
    }
    return mac;
  };

  const addNic = () => {
    const newMac = generateRandomMac();
    const newNic: NicInfo = {
      mac: newMac,
      source: networks[0]?.name || "default",
      source_type: "network",
      model: "virtio",
    };
    setNics([...nics, newNic]);
    setDirty(true);
  };

  const removeNic = (index: number) => {
    setNics(nics.filter((_, i) => i !== index));
    setDirty(true);
  };

  const updateNic = (index: number, patch: Partial<NicInfo>) => {
    setNics((prev) => prev.map((n, i) => (i === index ? { ...n, ...patch } : n)));
    setDirty(true);
  };

  const addFilesystem = () => {
    const newFs: FilesystemInfo = {
      source_dir: "",
      target_dir: `shared_folder_${filesystems.length + 1}`,
      readonly: false,
      driver: "9p",
    };
    setFilesystems([...filesystems, newFs]);
    setDirty(true);
  };

  const removeFilesystem = (index: number) => {
    setFilesystems(filesystems.filter((_, i) => i !== index));
    setDirty(true);
  };

  const updateFilesystem = (index: number, patch: Partial<FilesystemInfo>) => {
    setFilesystems((prev) => {
      const next = prev.map((fs, i) => (i === index ? { ...fs, ...patch } : fs));
      if (next.some((fs) => fs.driver === "virtiofs")) {
        setSharedMemory(true);
      }
      return next;
    });
    setDirty(true);
  };

  const reload = () => {
    setLoading(true);
    setLoadError(null);
    if (editorMode === "form") {
      invoke<VmSettings>("get_vm_settings", { name: selectedVm.name })
        .then(applySettings)
        .catch((err: any) => setLoadError(err?.toString() ?? "Unknown error"))
        .finally(() => setLoading(false));
    } else {
      invoke<string>("get_vm_xml", { name: selectedVm.name })
        .then((x) => {
          setXmlText(x);
          setDirty(false);
        })
        .catch((err: any) => setLoadError(err?.toString() ?? "Unknown error"))
        .finally(() => setLoading(false));
    }
  };

  const handleSaveForm = async () => {
    // Disallow shrinking any disk
    for (const d of disks) {
      const orig = initialDisks.find((o) => o.target_dev === d.target_dev);
      if (orig && d.capacity_gb < orig.capacity_gb) {
        showToastMessage(t("vm_shrink_err", { dev: d.target_dev, gb: orig.capacity_gb }), "error");
        return;
      }
    }

    setSaving(true);
    try {
      await invoke("update_vm_settings", {
        name: selectedVm.name,
        newName: vmName.trim(),
        cpu: vmCpuCores,
        memory: valueToKb(vmMemoryVal, vmMemoryUnit),
        maxMemory: valueToKb(vmMaxMemoryVal, vmMaxMemoryUnit),
        autostart: vmAutostart,
        bootDevices: vmBootDevices,
        bootMenu: vmBootMenu,
        graphicsType: vmGraphicsType,
        videoModel: vmVideoModel,
        machine: osMachine,
        osType,
        cpuSockets: topologyEnabled ? vmSockets : 0,
        cpuCores: topologyEnabled ? vmTopoCores : 0,
        cpuThreads: topologyEnabled ? vmThreads : 0,
        disks,
        nics,
        secureBoot,
        tpm,
        filesystems,
        sharedMemory,
      });
      const renamed = isStopped && vmName.trim() && vmName.trim() !== selectedVm.name;
      if (!renamed) {
        showToastMessage(t("vm_settings_saved"), "success");
      }
      setInitialDisks(disks);
      setDirty(false);
      if (onSaveSuccess) onSaveSuccess(renamed ? vmName.trim() : undefined);
    } catch (err: any) {
      console.error(err);
      showToastMessage(t("vm_settings_save_err") + err.toString(), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleOptimize = async () => {
    setOptimizing(true);
    try {
      const result = await invoke<string>("optimize_vm_for_app", { name: selectedVm.name });
      showToastMessage(
        result === "RESTART_REQUIRED" ? t("vm_optimize_done_restart") : t("vm_optimize_done"),
        "success"
      );
      reload();
    } catch (err: any) {
      console.error(err);
      showToastMessage(t("vm_optimize_err") + err.toString(), "error");
    } finally {
      setOptimizing(false);
    }
  };

  const handleSaveXml = async () => {
    setSaving(true);
    try {
      await invoke("save_vm_xml", { xml: xmlText });
      showToastMessage(t("vm_xml_applied"), "success");
      setDirty(false);
      if (onSaveSuccess) onSaveSuccess();
    } catch (err: any) {
      console.error(err);
      showToastMessage(t("vm_xml_apply_err") + err.toString(), "error");
    } finally {
      setSaving(false);
    }
  };

  const renderGeneral = () => (
    <div className="settings-group">
      <Field label={t("vm_f_name")}>
        <input
          type="text"
          className="form-input"
          value={vmName}
          disabled={!canEdit("name")}
          onChange={(e) => edit(setVmName)(e.target.value)}
        />
      </Field>
      <Field label={t("vm_f_arch")}>
        <input type="text" className="form-input" value={osArch || "—"} disabled />
      </Field>
      <Field label={t("vm_f_machine")}>
        <select
          className="form-select"
          value={osMachine}
          disabled={!canEdit("machine")}
          onChange={(e) => edit(setOsMachine)(e.target.value)}
        >
          {machineOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("vm_settings_autoconstart")}>
        <input
          type="checkbox"
          className="form-checkbox"
          checked={vmAutostart}
          disabled={!canEdit("autostart")}
          onChange={(e) => edit(setVmAutostart)(e.target.checked)}
        />
      </Field>
      <Field label={t("wizard_secure_boot")} hint={t("wizard_secure_boot_hint")}>
        <input
          type="checkbox"
          className="form-checkbox"
          checked={secureBoot}
          disabled={!canEdit("secure_boot")}
          onChange={(e) => edit(setSecureBoot)(e.target.checked)}
        />
      </Field>
      <Field label={t("wizard_tpm")} hint={t("wizard_tpm_hint")}>
        <input
          type="checkbox"
          className="form-checkbox"
          checked={tpm}
          disabled={!canEdit("tpm")}
          onChange={(e) => edit(setTpm)(e.target.checked)}
        />
      </Field>
      <Field label={t("vm_shared_memory")} hint={t("vm_shared_memory_hint")}>
        <input
          type="checkbox"
          className="form-checkbox"
          checked={sharedMemory}
          disabled={!canEdit("shared_memory")}
          onChange={(e) => edit(setSharedMemory)(e.target.checked)}
        />
      </Field>
      <Field label={t("vm_optimize_btn")} hint={t("vm_optimize_hint")}>
        <button
          className="btn-secondary"
          disabled={optimizing}
          onClick={handleOptimize}
          style={{
            padding: "0.5rem 1.25rem",
            background: "linear-gradient(135deg, #24C6DC, #514A9D)",
            border: "none",
            borderRadius: "8px",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.9rem",
            cursor: optimizing ? "wait" : "pointer",
            opacity: optimizing ? 0.6 : 1,
          }}
        >
          {t("vm_optimize_btn")}
        </button>
      </Field>
    </div>
  );

  const renderSystem = () => (
    <div className="settings-group">
      <div className="settings-subtabs">
        <button
          className={`settings-subtab ${systemSubtab === "motherboard" ? "active" : ""}`}
          onClick={() => setSystemSubtab("motherboard")}
        >
          {t("vm_sub_motherboard")}
        </button>
        <button
          className={`settings-subtab ${systemSubtab === "processor" ? "active" : ""}`}
          onClick={() => setSystemSubtab("processor")}
        >
          {t("vm_sub_processor")}
        </button>
      </div>

      {systemSubtab === "motherboard" && (
        <>
          <Field label={t("vm_f_base_mem")} hint={t("vm_h_base_mem")}>
            <div style={{ display: "flex", gap: "8px", width: "240px" }}>
              <input
                type="number"
                className="form-input"
                style={{ flex: 1, height: "38px", boxSizing: "border-box" }}
                value={vmMemoryVal}
                min={getMinMaxStep(vmMemoryUnit).min}
                max={getMinMaxStep(vmMemoryUnit).max}
                step={getMinMaxStep(vmMemoryUnit).step}
                disabled={!isStopped}
                onChange={(e) => edit(setVmMemoryVal)(Number(e.target.value))}
              />
              <select
                className="form-select"
                style={{ width: "65px", height: "38px", boxSizing: "border-box", paddingTop: 0, paddingBottom: 0, paddingRight: "1.25rem", backgroundPosition: "right 0.35rem center" }}
                value={vmMemoryUnit}
                disabled={!isStopped}
                onChange={(e) => handleMemoryUnitChange(
                  vmMemoryVal,
                  vmMemoryUnit,
                  e.target.value as "MB" | "GB" | "TB",
                  setVmMemoryVal,
                  setVmMemoryUnit
                )}
              >
                <option value="MB">MB</option>
                <option value="GB">GB</option>
                <option value="TB">TB</option>
              </select>
            </div>
          </Field>
          <Field label={t("vm_settings_max_mem")} hint={t("vm_h_max_mem")}>
            <div style={{ display: "flex", gap: "8px", width: "240px" }}>
              <input
                type="number"
                className="form-input"
                style={{ flex: 1, height: "38px", boxSizing: "border-box" }}
                value={vmMaxMemoryVal}
                min={getMinMaxStep(vmMaxMemoryUnit).min}
                max={getMinMaxStep(vmMaxMemoryUnit).max}
                step={getMinMaxStep(vmMaxMemoryUnit).step}
                disabled={!isStopped}
                onChange={(e) => edit(setVmMaxMemoryVal)(Number(e.target.value))}
              />
              <select
                className="form-select"
                style={{ width: "65px", height: "38px", boxSizing: "border-box", paddingTop: 0, paddingBottom: 0, paddingRight: "1.25rem", backgroundPosition: "right 0.35rem center" }}
                value={vmMaxMemoryUnit}
                disabled={!isStopped}
                onChange={(e) => handleMemoryUnitChange(
                  vmMaxMemoryVal,
                  vmMaxMemoryUnit,
                  e.target.value as "MB" | "GB" | "TB",
                  setVmMaxMemoryVal,
                  setVmMaxMemoryUnit
                )}
              >
                <option value="MB">MB</option>
                <option value="GB">GB</option>
                <option value="TB">TB</option>
              </select>
            </div>
          </Field>
          <Field label={t("vm_settings_boot_device")}>
            {(() => {
              const allDevices = [
                ...disks.map((d) => ({
                  id: `disk:${d.target_dev}`,
                  label: d.device === "cdrom"
                    ? `${d.bus.toUpperCase()} CDROM (${d.target_dev})`
                    : `${d.bus === "virtio" ? "VirtIO" : d.bus.toUpperCase()} Disk (${d.target_dev})`,
                })),
                ...nics.map((n) => ({
                  id: `nic:${n.mac}`,
                  label: `NIC (${n.mac})`,
                }))
              ];

              const orderedList = [...allDevices].sort((a, b) => {
                const aIdx = vmBootDevices.indexOf(a.id);
                const bIdx = vmBootDevices.indexOf(b.id);
                const aEnabled = aIdx !== -1;
                const bEnabled = bIdx !== -1;

                if (aEnabled && bEnabled) return aIdx - bIdx;
                if (aEnabled && !bEnabled) return -1;
                if (!aEnabled && bEnabled) return 1;
                return 0;
              });

              return (
                <div className="boot-order-container" style={{ border: "1px solid #E5E7EB", borderRadius: "0.375rem", padding: "0.5rem", width: "100%", maxWidth: "350px" }}>
                  {orderedList.map((item, idx) => {
                    const isEnabled = vmBootDevices.includes(item.id);
                    const pos = vmBootDevices.indexOf(item.id);
                    return (
                      <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.25rem 0.5rem", borderBottom: idx < orderedList.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: isStopped ? "pointer" : "default" }}>
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            disabled={!isStopped}
                            onChange={(e) => {
                              let newDevs = [...vmBootDevices];
                              if (e.target.checked) {
                                newDevs.push(item.id);
                              } else {
                                newDevs = newDevs.filter(id => id !== item.id);
                              }
                              edit(setVmBootDevices)(newDevs);
                            }}
                          />
                          <span style={{ fontSize: "14px", color: isEnabled ? "#111827" : "#6B7280" }}>
                            {item.label}
                          </span>
                        </label>
                        {isEnabled && isStopped && (
                          <div style={{ display: "flex", gap: "0.25rem" }}>
                            <button
                              type="button"
                              className="btn-order"
                              style={{ padding: "1px 6px", fontSize: "12px", border: "1px solid #D1D5DB", borderRadius: "4px", background: "#FFF", cursor: "pointer" }}
                              disabled={pos === 0}
                              onClick={() => {
                                if (pos > 0) {
                                  const newDevs = [...vmBootDevices];
                                  const temp = newDevs[pos - 1];
                                  newDevs[pos - 1] = newDevs[pos];
                                  newDevs[pos] = temp;
                                  edit(setVmBootDevices)(newDevs);
                                }
                              }}
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              className="btn-order"
                              style={{ padding: "1px 6px", fontSize: "12px", border: "1px solid #D1D5DB", borderRadius: "4px", background: "#FFF", cursor: "pointer" }}
                              disabled={pos === vmBootDevices.length - 1}
                              onClick={() => {
                                if (pos < vmBootDevices.length - 1) {
                                  const newDevs = [...vmBootDevices];
                                  const temp = newDevs[pos + 1];
                                  newDevs[pos + 1] = newDevs[pos];
                                  newDevs[pos] = temp;
                                  edit(setVmBootDevices)(newDevs);
                                }
                              }}
                            >
                              ▼
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {orderedList.length === 0 && (
                    <div style={{ padding: "0.5rem", color: "#9CA3AF", fontSize: "14px", textAlign: "center" }}>
                      No bootable devices available.
                    </div>
                  )}
                </div>
              );
            })()}
          </Field>
          <Field label={t("vm_settings_bootmenu")}>
            <input
              type="checkbox"
              className="form-checkbox"
              checked={vmBootMenu}
              disabled={!isStopped}
              onChange={(e) => edit(setVmBootMenu)(e.target.checked)}
            />
          </Field>
          <Field label={t("vm_settings_video")} hint={t("vm_h_video")}>
            <select
              className="form-select"
              style={{ width: "240px", height: "38px", boxSizing: "border-box", paddingTop: 0, paddingBottom: 0 }}
              value={vmVideoModel}
              disabled={!isStopped}
              onChange={(e) => edit(setVmVideoModel)(e.target.value)}
            >
              <option value="virtio">Virtio</option>
              <option value="qxl">QXL</option>
              <option value="vga">VGA</option>
              <option value="bochs">Bochs</option>
              <option value="ramfb">Ramfb</option>
              <option value="none">None</option>
            </select>
          </Field>
        </>
      )}

      {systemSubtab === "processor" && (
        <>
          <Field label={t("vm_settings_vcpu")} hint={t("vm_h_vcpu")}>
            <input
              type="number"
              className="form-input"
              value={vmCpuCores}
              min={1}
              max={maxVcpu}
              disabled={!isStopped}
              onChange={(e) => edit(setVmCpuCores)(Number(e.target.value))}
            />
          </Field>
          <Field label={t("vm_f_topology")} hint={t("vm_h_topology")}>
            <input
              type="checkbox"
              className="form-checkbox"
              checked={topologyEnabled}
              disabled={!isStopped}
              onChange={(e) => edit(setTopologyEnabled)(e.target.checked)}
            />
          </Field>
          {topologyEnabled && (
            <>
              <Field label={t("vm_f_sockets")}>
                <input
                  type="number"
                  className="form-input"
                  value={vmSockets}
                  min={1}
                  disabled={!isStopped}
                  onChange={(e) => edit(setVmSockets)(Number(e.target.value))}
                />
              </Field>
              <Field label={t("vm_f_cores")}>
                <input
                  type="number"
                  className="form-input"
                  value={vmTopoCores}
                  min={1}
                  disabled={!isStopped}
                  onChange={(e) => edit(setVmTopoCores)(Number(e.target.value))}
                />
              </Field>
              <Field label={t("vm_f_threads")}>
                <input
                  type="number"
                  className="form-input"
                  value={vmThreads}
                  min={1}
                  disabled={!isStopped}
                  onChange={(e) => edit(setVmThreads)(Number(e.target.value))}
                />
              </Field>
            </>
          )}
        </>
      )}
    </div>
  );

  const renderStorage = () => (
    <div className="settings-group">
      {disks.length === 0 && <div className="settings-empty">{t("vm_disk_empty")}</div>}
      {disks.map((disk, i) => {
        const orig = initialDisks.find((o) => o.target_dev === disk.target_dev);
        const isCdrom = disk.device === "cdrom";
        const activePool = storagePools.find(p => disk.path.startsWith(p.location)) || storagePools[0] || { name: "", location: "/var/lib/libvirt/images", volumes: [] };
        const filename = disk.path.startsWith(activePool.location)
          ? disk.path.substring(activePool.location.length).replace(/^\//, "")
          : disk.path.substring(disk.path.lastIndexOf("/") + 1);
        const isExistingVol = activePool.volumes.some(v => v.name === filename);

        return (
          <div className="device-card" key={`disk-${i}`}>
            <div className="device-card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                {t("vm_disk")} {i + 1}
                <span className="device-card-badge" style={{ marginLeft: "8px" }}>
                  {disk.target_dev || "?"} · {disk.device || "disk"}
                </span>
              </div>
              {isStopped && (
                <button
                  type="button"
                  className="btn-reset-settings"
                  style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#EF4444" }}
                  onClick={() => removeDisk(i)}
                >
                  {t("vm_remove")}
                </button>
              )}
            </div>

            {!orig && (
              <>
                <Field label={t("vm_f_target")}>
                  <input
                    type="text"
                    className="form-input"
                    value={disk.target_dev}
                    disabled={!isStopped}
                    onChange={(e) => updateDisk(i, { target_dev: e.target.value })}
                  />
                </Field>
                <Field label={t("vm_f_device_type")}>
                  <select
                    className="form-select"
                    value={disk.device}
                    disabled={!isStopped}
                    onChange={(e) => {
                      const newDevice = e.target.value;
                      const isNewCdrom = newDevice === "cdrom";
                      const filteredVols = activePool.volumes.filter(v => {
                        const isIso = v.name.toLowerCase().endsWith(".iso");
                        return isNewCdrom ? isIso : !isIso;
                      });
                      const defaultVol = filteredVols[0];
                      const newPath = defaultVol
                        ? activePool.location + "/" + defaultVol.name
                        : "";
                      const newBus = isNewCdrom ? "sata" : "virtio";
                      updateDisk(i, { device: newDevice, path: newPath, bus: newBus });
                    }}
                  >
                    <option value="disk">disk</option>
                    <option value="cdrom">cdrom</option>
                  </select>
                </Field>
              </>
            )}

            <Field label={t("vm_disk_pool")}>
              <select
                className="form-select"
                disabled={!isStopped && !isCdrom}
                value={activePool.name}
                onChange={(e) => {
                  const newPool = storagePools.find(p => p.name === e.target.value);
                  if (newPool) {
                    const newPath = newPool.location + "/" + (filename || `${selectedVm.name}-data-${i}.qcow2`);
                    updateDisk(i, { path: newPath });
                  }
                }}
              >
                {storagePools.map(p => (
                  <option key={p.id} value={p.name}>
                    {p.name} ({p.location})
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("vm_disk_volume")}>
              <select
                className="form-select"
                disabled={!isStopped && !isCdrom}
                value={isExistingVol ? filename : "__custom__"}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    // Keep filename as-is, let user type it
                  } else {
                    const newPath = activePool.location + "/" + e.target.value;
                    const selectedVolObj = activePool.volumes.find(v => v.name === e.target.value);
                    if (selectedVolObj) {
                      const rawGb = parseSizeToGb(selectedVolObj.size);
                      const sizeGb = rawGb > 0 ? Math.max(1, Math.round(rawGb)) : disk.capacity_gb;
                      updateDisk(i, { path: newPath, capacity_gb: sizeGb });
                    } else {
                      updateDisk(i, { path: newPath });
                    }
                  }
                }}
              >
                {activePool.volumes
                  .filter(v => {
                    const isIso = v.name.toLowerCase().endsWith(".iso");
                    return isCdrom ? isIso : !isIso;
                  })
                  .map(v => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.size})
                    </option>
                  ))
                }
                <option value="__custom__">
                  {t("vm_custom_vol")}
                </option>
              </select>
            </Field>

            {(!isExistingVol || filename === "" || disk.path === "") && (
              <Field label={t("vm_custom_filename")}>
                <input
                  type="text"
                  className="form-input"
                  value={filename}
                  disabled={!isStopped && !isCdrom}
                  placeholder="e.g. volume-name.qcow2"
                  onChange={(e) => {
                    const newPath = activePool.location + "/" + e.target.value;
                    updateDisk(i, { path: newPath });
                  }}
                />
              </Field>
            )}

            {(() => {
              const volSizeInfo = isExistingVol
                ? parseSizeAndUnit(activePool.volumes.find(v => v.name === filename)?.size || "")
                : { value: disk.capacity_gb, unit: "GB" };
              return (
                <Field label={`${t("vm_settings_disk_size")} (${volSizeInfo.unit})`} hint={t("vm_h_disk_size")}>
                  <input
                    type="number"
                    className="form-input"
                    value={isCdrom ? volSizeInfo.value : disk.capacity_gb}
                    min={Math.max(1, orig?.capacity_gb ?? 1)}
                    disabled={!isStopped || isCdrom}
                    onChange={(e) => updateDisk(i, { capacity_gb: Number(e.target.value) })}
                  />
                </Field>
              );
            })()}
            <Field label={t("vm_f_disk_bus")} hint={t("vm_h_disk_bus")}>
              <select
                className="form-select"
                value={disk.bus}
                disabled={!isStopped}
                onChange={(e) => updateDisk(i, { bus: e.target.value })}
              >
                <option value="virtio">VirtIO</option>
                <option value="sata">SATA</option>
                <option value="scsi">SCSI</option>
                <option value="ide">IDE</option>
              </select>
            </Field>
          </div>
        );
      })}

    </div>
  );

  const renderNetwork = () => (
    <div className="settings-group">
      {nics.length === 0 && <div className="settings-empty">{t("vm_nic_empty")}</div>}
      {nics.map((nic, i) => (
        <div className="device-card" key={nic.mac || i}>
          <div className="device-card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              {t("vm_nic")} {i + 1}
              <span className="device-card-badge" style={{ marginLeft: "8px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                {nic.mac || "—"}
                {nic.mac && (
                  <button
                    type="button"
                    className="mac-copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(nic.mac);
                      showToastMessage(t("vm_mac_copied"), "success");
                    }}
                    title={t("vm_copy_mac")}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      margin: 0,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "11px", height: "11px" }}>
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                )}
              </span>
            </div>
            {isStopped && (
              <button
                type="button"
                className="btn-reset-settings"
                style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#EF4444" }}
                onClick={() => removeNic(i)}
              >
                {t("vm_remove")}
              </button>
            )}
          </div>
          <Field label={t("vm_settings_net_source")} hint={t("vm_h_net")}>
            <select
              className="form-select"
              value={nic.source}
              disabled={!canEdit("net-source")}
              onChange={(e) => updateNic(i, { source: e.target.value })}
            >
              {!networks.some((n) => n.name === nic.source) && nic.source && (
                <option value={nic.source}>{nic.source}</option>
              )}
              {networks.map((net) => (
                <option key={net.id} value={net.name}>
                  {net.name} ({net.device} - {net.forwarding.toUpperCase()})
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("vm_settings_net_model")}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", position: "relative" }}>
              <select
                className="form-select"
                value={nic.model}
                disabled={!isStopped}
                onChange={(e) => updateNic(i, { model: e.target.value })}
                style={{ flexGrow: 1 }}
              >
                <option value="virtio">virtio</option>
                <option value="e1000">e1000</option>
                <option value="rtl8139">rtl8139</option>
              </select>
              <div
                className="nic-info-trigger"
                style={{
                  cursor: "help",
                  fontSize: "1.1rem",
                  color: "#24C6DC",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "4px"
                }}
              >
                ℹ️
                <div className="nic-info-tooltip">
                  {nic.model === "virtio" && (
                    <span>{t("nic_virtio_desc")}</span>
                  )}
                  {nic.model === "e1000" && (
                    <span>{t("nic_e1000_desc")}</span>
                  )}
                  {nic.model === "rtl8139" && (
                    <span>{t("nic_rtl_desc")}</span>
                  )}
                </div>
              </div>
            </div>
          </Field>
        </div>
      ))}

    </div>
  );

  const renderSharing = () => (
    <div className="settings-group">
      <div className="settings-info-banner" style={{ display: "flex", gap: "8px", alignItems: "center", padding: "10px 14px", backgroundColor: "rgba(36, 198, 220, 0.1)", borderLeft: "3px solid #24C6DC", borderRadius: "4px", marginBottom: "1rem", fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#24C6DC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: "16px", height: "16px", flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>{t("vm_sharing_desc")}</span>
      </div>
      {filesystems.length === 0 && <div className="settings-empty">{t("vm_sharing_empty")}</div>}
      {filesystems.map((fs, i) => (
        <div className="device-card" key={`fs-${i}`}>
          <div className="device-card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              {t("vm_settings_sharing")} {i + 1}
              <span className="device-card-badge" style={{ marginLeft: "8px" }}>
                {fs.target_dir || "?"}
              </span>
            </div>
            {isStopped && (
              <button
                type="button"
                className="btn-reset-settings"
                style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#EF4444" }}
                onClick={() => removeFilesystem(i)}
              >
                {t("vm_remove")}
              </button>
            )}
          </div>

          <Field label={t("vm_f_source_dir")}>
            <div style={{ display: "flex", gap: "0.5rem", width: "100%" }}>
              <input
                type="text"
                className="form-input"
                value={fs.source_dir}
                placeholder={t("vm_f_source_dir_placeholder")}
                disabled={!isStopped}
                onChange={(e) => updateFilesystem(i, { source_dir: e.target.value })}
                style={{ flexGrow: 1 }}
              />
              <button
                type="button"
                className="btn-reset-settings"
                style={{ padding: "0 0.75rem", display: "flex", alignItems: "center", gap: "4px" }}
                disabled={!isStopped}
                onClick={async () => {
                  try {
                    const selected = await invoke<string | null>("select_directory");
                    if (selected) {
                      updateFilesystem(i, { source_dir: selected });
                    }
                  } catch (err: any) {
                    console.error("Failed to select directory:", err);
                    showToastMessage(err.toString(), "error");
                  }
                }}
              >
                📁 {t("vm_btn_browse")}
              </button>
            </div>
          </Field>

          <Field label={t("vm_f_target_dir")}>
            <input
              type="text"
              className="form-input"
              value={fs.target_dir}
              placeholder={t("vm_f_target_dir_placeholder")}
              disabled={!isStopped}
              onChange={(e) => updateFilesystem(i, { target_dir: e.target.value })}
            />
          </Field>

          <Field label={t("vm_f_driver")}>
            <select
              className="form-select"
              value={fs.driver || "9p"}
              disabled={!isStopped}
              onChange={(e) => updateFilesystem(i, { driver: e.target.value })}
            >
              <option value="9p">{t("vm_driver_9p")}</option>
              <option value="virtiofs">{t("vm_driver_virtiofs")}</option>
            </select>
          </Field>

          <Field label={t("vm_f_readonly")}>
            <input
              type="checkbox"
              className="form-checkbox"
              checked={fs.readonly}
              disabled={!isStopped}
              onChange={(e) => updateFilesystem(i, { readonly: e.target.checked })}
            />
          </Field>
        </div>
      ))}

      {/* Mount Instructions Section */}
      <div className="device-card" style={{ marginTop: "2rem", borderTop: "2px solid #24C6DC", background: "var(--color-bg-card-alt, rgba(36, 198, 220, 0.03))" }}>
        <div className="device-card-title" style={{ color: "#24C6DC", borderBottom: "1px solid rgba(36, 198, 220, 0.15)", paddingBottom: "0.5rem", marginBottom: "1rem" }}>
          📖 {t("vm_sharing_instructions")}
        </div>

        {/* Tab buttons */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <button
            type="button"
            className={`settings-subtab ${instructionsTab === "linux" ? "active" : ""}`}
            onClick={() => setInstructionsTab("linux")}
            style={{ padding: "0.4rem 1rem", fontSize: "0.85rem", border: "1px solid rgba(36, 198, 220, 0.3)", borderRadius: "4px" }}
          >
            🐧 {t("vm_sharing_linux")}
          </button>
          <button
            type="button"
            className={`settings-subtab ${instructionsTab === "windows" ? "active" : ""}`}
            onClick={() => setInstructionsTab("windows")}
            style={{ padding: "0.4rem 1rem", fontSize: "0.85rem", border: "1px solid rgba(36, 198, 220, 0.3)", borderRadius: "4px" }}
          >
            🪟 {t("vm_sharing_windows")}
          </button>
        </div>

        {instructionsTab === "linux" ? (
          <div>
            <p style={{ fontSize: "0.875rem", marginBottom: "0.75rem", color: "var(--color-text-secondary)" }}>
              {t("vm_sharing_linux_mount_desc")}
            </p>
            {filesystems.length === 0 ? (
              <div style={{ fontStyle: "italic", fontSize: "0.85rem", color: "var(--color-text-hint)" }}>
                ({t("vm_sharing_empty")})
              </div>
            ) : (
              filesystems.map((fs, idx) => {
                const tag = fs.target_dir || `shared_folder_${idx + 1}`;
                const cmd = fs.driver === "virtiofs"
                  ? `sudo mount -t virtiofs ${tag} /mnt/shared`
                  : `sudo mount -t 9p -o trans=virtio,version=9p2000.L,msize=262144 ${tag} /mnt/shared`;
                return (
                  <div key={`inst-${idx}`} style={{ marginBottom: "1rem" }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: "bold", marginBottom: "0.25rem", color: "var(--color-text-secondary)" }}>
                      📂 {tag} ({fs.driver}) :
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", background: "rgba(0,0,0,0.2)", padding: "0.5rem 0.75rem", borderRadius: "4px", fontFamily: "monospace", fontSize: "0.85rem", border: "1px solid rgba(255,255,255,0.05)", overflowX: "auto" }}>
                      <span style={{ flexGrow: 1, whiteSpace: "nowrap", color: "#f8f8f2", lineHeight: "1.4", paddingBottom: "2px" }}>{cmd}</span>
                      <button
                        type="button"
                        className="mac-copy-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(cmd);
                          showToastMessage(t("vm_mac_copied"), "success");
                        }}
                        style={{ border: "none", background: "none", color: "#24C6DC", cursor: "pointer", display: "flex", padding: "4px" }}
                        title="Copy"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "14px", height: "14px" }}>
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)", lineHeight: "1.6" }}>
            <p style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
              {t("vm_sharing_windows_mount_desc")}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", background: "rgba(0,0,0,0.1)", padding: "1rem", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div>
                {t("vm_sharing_windows_step1")}{" "}
                <a
                  href="https://winfsp.dev/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#24C6DC", textDecoration: "underline", fontWeight: "bold" }}
                >
                  WinFSP
                </a>
              </div>
              <div>
                {t("vm_sharing_windows_step2_prefix")}{" "}
                <a
                  href="https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#24C6DC", textDecoration: "underline", fontWeight: "bold" }}
                >
                  {t("vm_sharing_windows_step2_link")}
                </a>
                {t("vm_sharing_windows_step2_suffix")}
              </div>
              <div>{t("vm_sharing_windows_step3")}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderFormContent = () => {
    switch (category) {
      case "general":
        return renderGeneral();
      case "system":
        return renderSystem();
      case "storage":
        return renderStorage();
      case "network":
        return renderNetwork();
      case "sharing":
        return renderSharing();
    }
  };

  return (
    <div className="vm-settings-panel">
      {toast && (
        <div className={`footer-toast ${toast.type}`}>
          <span className="toast-icon">{toast.type === "success" ? "✓" : "✕"}</span>
          <span>{toast.message}</span>
        </div>
      )}
      <div className="vm-settings-header">
        <span className="details-name">{t("tab_settings")}</span>
        <div className="vm-settings-toggle-group">
          <button
            className={`btn-toggle-mode ${editorMode === "form" ? "active" : ""}`}
            onClick={() => setEditorMode("form")}
          >
            {t("vm_mode_form")}
          </button>
          <button
            className={`btn-toggle-mode ${editorMode === "xml" ? "active" : ""}`}
            onClick={() => setEditorMode("xml")}
          >
            {t("vm_mode_xml")}
          </button>
        </div>
      </div>

      {editorMode === "form" ? (
        <div className="vm-settings-body">
          {/* Left icon navigation */}
          <div className="vm-settings-menu">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={`vm-settings-nav-item ${category === cat ? "active" : ""}`}
                onClick={() => setCategory(cat)}
              >
                <span className="vm-settings-nav-icon">{icons[cat]}</span>
                <span>{t(categoryLabel[cat])}</span>
              </button>
            ))}
          </div>

          {/* Right content panel */}
          <div className="vm-settings-content">
            {loading ? (
              <div className="vm-settings-state">{t("vm_settings_loading")}</div>
            ) : loadError ? (
              <div className="vm-settings-state error">
                {t("vm_settings_load_error")}
                {loadError}
              </div>
            ) : (
              <div className="vm-settings-scroll">
                {!isStopped && <div className="vm-status-banner">{t("vm_status_locked")}</div>}
                {renderFormContent()}
              </div>
            )}

            <div className="vm-settings-footer">
              <span className={`vm-settings-dirty ${dirty ? "visible" : ""}`}>
                ● {t("vm_settings_unsaved")}
              </span>
              <div className="vm-settings-footer-actions">
                {isStopped && category === "storage" && (
                  <button
                    type="button"
                    className="btn-reset-settings"
                    style={{ borderColor: "rgba(36, 198, 220, 0.4)", color: "#24C6DC", marginRight: "0.25rem" }}
                    onClick={addDisk}
                  >
                    + {t("vm_add_volume")}
                  </button>
                )}
                {isStopped && category === "network" && (
                  <button
                    type="button"
                    className="btn-reset-settings"
                    style={{ borderColor: "rgba(36, 198, 220, 0.4)", color: "#24C6DC", marginRight: "0.25rem" }}
                    onClick={addNic}
                  >
                    + {t("vm_add_interface")}
                  </button>
                )}
                {isStopped && category === "sharing" && (
                  <button
                    type="button"
                    className="btn-reset-settings"
                    style={{ borderColor: "rgba(36, 198, 220, 0.4)", color: "#24C6DC", marginRight: "0.25rem" }}
                    onClick={addFilesystem}
                  >
                    {t("vm_add_sharing")}
                  </button>
                )}
                <button
                  className="btn-reset-settings"
                  onClick={reload}
                  disabled={!dirty || saving || loading}
                >
                  {t("vm_settings_reset")}
                </button>
                <button
                  className="btn-save-settings"
                  onClick={handleSaveForm}
                  disabled={!dirty || saving || loading || !!loadError}
                >
                  {saving ? t("vm_saving") : t("vm_settings_save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="vm-settings-content xml-mode">
          <div className="xml-hint">{t("vm_xml_hint")}</div>
          {loading ? (
            <div className="vm-settings-state">{t("vm_settings_loading")}</div>
          ) : loadError ? (
            <div className="vm-settings-state error">
              {t("vm_settings_load_error")}
              {loadError}
            </div>
          ) : (
            <textarea
              className="xml-editor"
              spellCheck={false}
              value={xmlText}
              onChange={(e) => {
                setXmlText(e.target.value);
                setDirty(true);
              }}
            />
          )}

          <div className="vm-settings-footer">
            <span className={`vm-settings-dirty ${dirty ? "visible" : ""}`}>
              ● {t("vm_settings_unsaved")}
            </span>
            <div className="vm-settings-footer-actions">
              <button
                className="btn-reset-settings"
                onClick={reload}
                disabled={!dirty || saving || loading}
              >
                {t("vm_settings_reset")}
              </button>
              <button
                className="btn-save-settings"
                onClick={handleSaveXml}
                disabled={!dirty || saving || loading || !!loadError}
              >
                {saving ? t("vm_saving") : t("vm_settings_save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const vmSettingsTabPropsAreEqual = (prev: VmSettingsTabProps, next: VmSettingsTabProps) => {
  return (
    prev.selectedVm.name === next.selectedVm.name &&
    prev.selectedVm.state === next.selectedVm.state &&
    prev.networks === next.networks &&
    prev.storagePools === next.storagePools &&
    prev.systemResources === next.systemResources &&
    prev.t === next.t &&
    prev.onSaveSuccess === next.onSaveSuccess
  );
};

export const VmSettingsTab = memo(VmSettingsTabComponent, vmSettingsTabPropsAreEqual);
