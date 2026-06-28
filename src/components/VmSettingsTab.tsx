import { useState, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DomainItem, NetworkItem, SystemResources, VmSettings, DiskInfo, NicInfo, StoragePoolItem } from "../types";
import { TranslationKey } from "../translations";

interface VmSettingsTabProps {
  selectedVm: DomainItem;
  networks: NetworkItem[];
  storagePools: StoragePoolItem[];
  systemResources: SystemResources | null;
  lang: "zh" | "en";
  t: (key: TranslationKey) => string;
  onSaveSuccess?: (newName?: string) => void;
}

type EditorMode = "form" | "xml";
type Category = "general" | "system" | "display" | "storage" | "network";
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
  display: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
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
};

const categoryLabel: Record<Category, TranslationKey> = {
  general: "vm_cat_general",
  system: "vm_cat_system",
  display: "vm_cat_display",
  storage: "vm_settings_storage",
  network: "vm_settings_network",
};

const CATEGORIES: Category[] = ["general", "system", "display", "storage", "network"];

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

export const VmSettingsTab = ({
  selectedVm,
  networks,
  storagePools,
  systemResources,
  lang,
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
  const [vmBootDevice, setVmBootDevice] = useState("hd");
  const [vmBootMenu, setVmBootMenu] = useState(false);
  const [vmGraphicsType, setVmGraphicsType] = useState("spice");
  const [osLabel, setOsLabel] = useState("");
  const [osArch, setOsArch] = useState("");
  const [osMachine, setOsMachine] = useState("");
  const [osType, setOsType] = useState("other");
  const [vmName, setVmName] = useState("");
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [initialDisks, setInitialDisks] = useState<DiskInfo[]>([]);
  const [nics, setNics] = useState<NicInfo[]>([]);

  // XML editor state
  const [xmlText, setXmlText] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
    setVmBootDevice(s.boot_device || "hd");
    setVmBootMenu(s.boot_menu || false);
    setVmGraphicsType(s.graphics_type || "none");
    setOsLabel(s.os_label);
    setOsArch(s.os_arch);
    setOsMachine(s.os_machine);
    setOsType(s.os_type || "other");
    setVmName(s.name);
    setDisks(s.disks);
    setInitialDisks(s.disks);
    setNics(s.nics);
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
        showToastMessage(
          lang === "zh"
            ? `不支援縮小虛擬硬碟 ${d.target_dev}！當前容量: ${orig.capacity_gb} GB`
            : `Shrinking disk ${d.target_dev} is not supported! Current capacity: ${orig.capacity_gb} GB`,
          "error"
        );
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
        bootDevice: vmBootDevice,
        bootMenu: vmBootMenu,
        graphicsType: vmGraphicsType,
        machine: osMachine,
        osType,
        cpuSockets: topologyEnabled ? vmSockets : 0,
        cpuCores: topologyEnabled ? vmTopoCores : 0,
        cpuThreads: topologyEnabled ? vmThreads : 0,
        disks,
        nics,
      });
      const renamed = isStopped && vmName.trim() && vmName.trim() !== selectedVm.name;
      if (!renamed) {
        showToastMessage(lang === "zh" ? "設定變更已成功套用至虛擬機！" : "VM settings saved successfully!", "success");
      }
      setInitialDisks(disks);
      setDirty(false);
      if (onSaveSuccess) onSaveSuccess(renamed ? vmName.trim() : undefined);
    } catch (err: any) {
      console.error(err);
      showToastMessage((lang === "zh" ? "儲存設定失敗：" : "Failed to save settings: ") + err.toString(), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveXml = async () => {
    setSaving(true);
    try {
      await invoke("save_vm_xml", { xml: xmlText });
      showToastMessage(lang === "zh" ? "XML 已成功套用至虛擬機！" : "XML applied successfully!", "success");
      setDirty(false);
      if (onSaveSuccess) onSaveSuccess();
    } catch (err: any) {
      console.error(err);
      showToastMessage((lang === "zh" ? "套用 XML 失敗：" : "Failed to apply XML: ") + err.toString(), "error");
    } finally {
      setSaving(false);
    }
  };

  const renderGeneral = () => (
    <div className="settings-group">
      <div className="settings-group-title">{t("vm_cat_general")}</div>
      <Field label={t("vm_f_name")}>
        <input
          type="text"
          className="form-input"
          value={vmName}
          disabled={!canEdit("name")}
          onChange={(e) => edit(setVmName)(e.target.value)}
        />
      </Field>
      <Field label={t("vm_f_os")} hint={osLabel || undefined}>
        <select
          className="form-select"
          value={osType}
          disabled={!canEdit("os")}
          onChange={(e) => edit(setOsType)(e.target.value)}
        >
          <option value="linux">Linux</option>
          <option value="windows">Windows</option>
          <option value="other">{lang === "zh" ? "其他" : "Other"}</option>
        </select>
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
            <select
              className="form-select"
              style={{ width: "240px", height: "38px", boxSizing: "border-box", paddingTop: 0, paddingBottom: 0 }}
              value={vmBootDevice}
              disabled={!isStopped}
              onChange={(e) => edit(setVmBootDevice)(e.target.value)}
            >
              <option value="hd">{t("boot_device_hd")}</option>
              <option value="cdrom">{t("boot_device_cdrom")}</option>
              <option value="network">{t("boot_device_network")}</option>
              {disks.map((d, index) => (
                <option key={d.target_dev} value={`disk:${d.target_dev}`}>
                  {lang === "zh" ? `儲存磁碟區 ${index + 1} (${d.target_dev})` : `Volume ${index + 1} (${d.target_dev})`}
                </option>
              ))}
              {nics.map((n, index) => (
                <option key={n.mac} value={`nic:${n.mac}`}>
                  {lang === "zh" ? `網路介面 ${index + 1} (${n.mac})` : `Interface ${index + 1} (${n.mac})`}
                </option>
              ))}
            </select>
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

  const renderDisplay = () => (
    <div className="settings-group">
      <div className="settings-group-title">{t("vm_cat_display")}</div>
      <Field label={t("vm_settings_graphics")} hint={t("vm_h_graphics")}>
        <select
          className="form-select"
          value={vmGraphicsType}
          disabled={!isStopped}
          onChange={(e) => edit(setVmGraphicsType)(e.target.value)}
        >
          <option value="spice">SPICE</option>
          <option value="vnc">VNC</option>
          <option value="none">No Display</option>
        </select>
      </Field>
    </div>
  );

  const renderStorage = () => (
    <div className="settings-group">
      {disks.length === 0 && <div className="settings-empty">{t("vm_disk_empty")}</div>}
      {disks.map((disk, i) => {
        const orig = initialDisks.find((o) => o.target_dev === disk.target_dev);
        return (
          <div className="device-card" key={disk.target_dev || i}>
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
                  {lang === "zh" ? "移除" : "Remove"}
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
                    onChange={(e) => updateDisk(i, { device: e.target.value })}
                  >
                    <option value="disk">disk</option>
                    <option value="cdrom">cdrom</option>
                  </select>
                </Field>
              </>
            )}

            {(() => {
              const activePool = storagePools.find(p => disk.path.startsWith(p.location)) || storagePools[0] || { name: "", location: "/var/lib/libvirt/images", volumes: [] };
              const filename = disk.path.startsWith(activePool.location)
                ? disk.path.substring(activePool.location.length).replace(/^\//, "")
                : disk.path.substring(disk.path.lastIndexOf("/") + 1);
              const isExistingVol = activePool.volumes.some(v => v.name === filename);
              return (
                <>
                  <Field label={lang === "zh" ? "儲存池 (Storage Pool)" : "Storage Pool"}>
                    <select
                      className="form-select"
                      disabled={!isStopped}
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

                  <Field label={lang === "zh" ? "儲存磁碟區 (Storage Volume)" : "Storage Volume"}>
                    <select
                      className="form-select"
                      disabled={!isStopped}
                      value={isExistingVol ? filename : "__custom__"}
                      onChange={(e) => {
                        if (e.target.value === "__custom__") {
                          // Keep filename as-is, let user type it
                        } else {
                          const newPath = activePool.location + "/" + e.target.value;
                          const selectedVolObj = activePool.volumes.find(v => v.name === e.target.value);
                          if (selectedVolObj) {
                            const matched = selectedVolObj.size.match(/(\d+)/);
                            const sizeGb = matched ? Number(matched[1]) : disk.capacity_gb;
                            updateDisk(i, { path: newPath, capacity_gb: sizeGb });
                          } else {
                            updateDisk(i, { path: newPath });
                          }
                        }
                      }}
                    >
                      {activePool.volumes.map(v => (
                        <option key={v.name} value={v.name}>
                          {v.name} ({v.size})
                        </option>
                      ))}
                      <option value="__custom__">
                        {lang === "zh" ? "< 自訂 / 新增磁碟區 >" : "< Custom / New Volume >"}
                      </option>
                    </select>
                  </Field>

                  {(!isExistingVol || filename === "" || disk.path === "") && (
                    <Field label={lang === "zh" ? "自訂檔案名稱" : "Custom Filename"}>
                      <input
                        type="text"
                        className="form-input"
                        value={filename}
                        disabled={!isStopped}
                        placeholder="e.g. volume-name.qcow2"
                        onChange={(e) => {
                          const newPath = activePool.location + "/" + e.target.value;
                          updateDisk(i, { path: newPath });
                        }}
                      />
                    </Field>
                  )}
                </>
              );
            })()}
            <Field label={`${t("vm_settings_disk_size")} (GB)`} hint={t("vm_h_disk_size")}>
              <input
                type="number"
                className="form-input"
                value={disk.capacity_gb}
                min={Math.max(1, orig?.capacity_gb ?? 1)}
                disabled={!isStopped}
                onChange={(e) => updateDisk(i, { capacity_gb: Number(e.target.value) })}
              />
            </Field>
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
                      showToastMessage(lang === "zh" ? "已複製 MAC 位址！" : "MAC Address copied!", "success");
                    }}
                    title={lang === "zh" ? "複製 MAC 位址" : "Copy MAC Address"}
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
                {lang === "zh" ? "移除" : "Remove"}
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
                    <span>
                      {lang === "zh" 
                        ? "virtio: 半虛擬化網卡。效能最佳、CPU 開銷最小。推薦所有 Linux 及已安裝 VirtIO 驅動的 Windows 使用。速度：10 Gbps+ (最佳效能)。" 
                        : "virtio: Paravirtualized card. Best performance and lowest CPU overhead. Recommended for Linux and Windows with VirtIO drivers. Speed: 10 Gbps+ (Max performance)."}
                    </span>
                  )}
                  {nic.model === "e1000" && (
                    <span>
                      {lang === "zh" 
                        ? "e1000: 模擬 Intel 82540EM Gigabit 網卡。相容性極佳，幾乎所有作業系統皆有內建驅動，效能中等。速度：1 Gbps (千兆)。" 
                        : "e1000: Emulates Intel 82540EM Gigabit card. High compatibility, built-in drivers in almost all OSes, moderate performance. Speed: 1 Gbps (Gigabit)."}
                    </span>
                  )}
                  {nic.model === "rtl8139" && (
                    <span>
                      {lang === "zh" 
                        ? "rtl8139: 模擬 Realtek RTL8139 10/100M 舊型網卡。僅用於極古老作業系統相容性測試，效能與速度較差。速度：100 Mbps (百兆)。" 
                        : "rtl8139: Emulates Realtek RTL8139 legacy 10/100M card. Only used for compatibility with very old OSes, lower speed. Speed: 100 Mbps (Fast Ethernet)."}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Field>
        </div>
      ))}

    </div>
  );

  const renderFormContent = () => {
    switch (category) {
      case "general":
        return renderGeneral();
      case "system":
        return renderSystem();
      case "display":
        return renderDisplay();
      case "storage":
        return renderStorage();
      case "network":
        return renderNetwork();
    }
  };

  return (
    <div className="vm-settings-panel">
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
              {toast && (
                <div className={`footer-toast ${toast.type}`}>
                  <span className="toast-icon">{toast.type === "success" ? "✓" : "✕"}</span>
                  <span>{toast.message}</span>
                </div>
              )}
              <div className="vm-settings-footer-actions">
                {isStopped && category === "storage" && (
                  <button
                    type="button"
                    className="btn-reset-settings"
                    style={{ borderColor: "rgba(36, 198, 220, 0.4)", color: "#24C6DC", marginRight: "0.25rem" }}
                    onClick={addDisk}
                  >
                    + {lang === "zh" ? "新增磁碟區" : "Add Volume"}
                  </button>
                )}
                {isStopped && category === "network" && (
                  <button
                    type="button"
                    className="btn-reset-settings"
                    style={{ borderColor: "rgba(36, 198, 220, 0.4)", color: "#24C6DC", marginRight: "0.25rem" }}
                    onClick={addNic}
                  >
                    + {lang === "zh" ? "新增網路介面" : "Add Interface"}
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
                  {saving ? (lang === "zh" ? "儲存中..." : "Saving...") : t("vm_settings_save")}
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
            {toast && (
              <div className={`footer-toast ${toast.type}`}>
                <span className="toast-icon">{toast.type === "success" ? "✓" : "✕"}</span>
                <span>{toast.message}</span>
              </div>
            )}
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
                {saving ? (lang === "zh" ? "儲存中..." : "Saving...") : t("vm_settings_save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
