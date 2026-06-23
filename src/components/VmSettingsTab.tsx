import { useState, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DomainItem, NetworkItem, SystemResources, VmSettings, DiskInfo, NicInfo } from "../types";
import { TranslationKey } from "../translations";

interface VmSettingsTabProps {
  selectedVm: DomainItem;
  networks: NetworkItem[];
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
  systemResources,
  lang,
  t,
  onSaveSuccess,
}: VmSettingsTabProps) => {
  const [editorMode, setEditorMode] = useState<EditorMode>("form");
  const [category, setCategory] = useState<Category>("general");
  const [systemSubtab, setSystemSubtab] = useState<SystemSubtab>("motherboard");

  // Form state
  const [vmCpuCores, setVmCpuCores] = useState(2);
  const [vmMemoryMb, setVmMemoryMb] = useState(4096);
  const [vmMaxMemoryMb, setVmMaxMemoryMb] = useState(4096);
  const [topologyEnabled, setTopologyEnabled] = useState(false);
  const [vmSockets, setVmSockets] = useState(1);
  const [vmTopoCores, setVmTopoCores] = useState(2);
  const [vmThreads, setVmThreads] = useState(1);
  const [vmAutostart, setVmAutostart] = useState(false);
  const [vmBootDevice, setVmBootDevice] = useState("hd");
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

  const maxVcpu = systemResources?.cpu_threads || 128;
  const maxMemMb = systemResources ? Math.round(systemResources.mem_total_kb / 1024) : 131072;

  // Push a fetched VmSettings payload into local editable state
  const applySettings = (s: VmSettings) => {
    const curMemMb = Math.round(s.current_mem_kb / 1024) || 2048;
    setVmCpuCores(s.vcpu || 1);
    setVmMemoryMb(curMemMb);
    setVmMaxMemoryMb(Math.round(s.max_mem_kb / 1024) || curMemMb);

    const hasTopology = s.cpu_sockets > 0 && s.cpu_cores > 0 && s.cpu_threads > 0;
    setTopologyEnabled(hasTopology);
    setVmSockets(s.cpu_sockets || 1);
    setVmTopoCores(s.cpu_cores || s.vcpu || 1);
    setVmThreads(s.cpu_threads || 1);

    setVmAutostart(s.autostart);
    setVmBootDevice(s.boot_device || "hd");
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
        alert(
          lang === "zh"
            ? `不支援縮小虛擬硬碟 ${d.target_dev}！當前容量: ${orig.capacity_gb} GB`
            : `Shrinking disk ${d.target_dev} is not supported! Current capacity: ${orig.capacity_gb} GB`
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
        memory: vmMemoryMb * 1024, // MB -> KB
        maxMemory: vmMaxMemoryMb * 1024,
        autostart: vmAutostart,
        bootDevice: vmBootDevice,
        graphicsType: vmGraphicsType,
        machine: osMachine,
        osType,
        cpuSockets: topologyEnabled ? vmSockets : 0,
        cpuCores: topologyEnabled ? vmTopoCores : 0,
        cpuThreads: topologyEnabled ? vmThreads : 0,
        disks,
        nics,
      });
      alert(lang === "zh" ? "設定變更已成功套用至虛擬機！" : "VM settings saved successfully!");
      setInitialDisks(disks);
      setDirty(false);
      const renamed = isStopped && vmName.trim() && vmName.trim() !== selectedVm.name;
      if (onSaveSuccess) onSaveSuccess(renamed ? vmName.trim() : undefined);
    } catch (err: any) {
      console.error(err);
      alert((lang === "zh" ? "儲存設定失敗：" : "Failed to save settings: ") + err.toString());
    } finally {
      setSaving(false);
    }
  };

  const handleSaveXml = async () => {
    setSaving(true);
    try {
      await invoke("save_vm_xml", { xml: xmlText });
      alert(lang === "zh" ? "XML 已成功套用至虛擬機！" : "XML applied successfully!");
      setDirty(false);
      if (onSaveSuccess) onSaveSuccess();
    } catch (err: any) {
      console.error(err);
      alert((lang === "zh" ? "套用 XML 失敗：" : "Failed to apply XML: ") + err.toString());
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
          <Field label={`${t("vm_f_base_mem")} (MB)`} hint={t("vm_h_base_mem")}>
            <input
              type="number"
              className="form-input"
              value={vmMemoryMb}
              min={256}
              max={maxMemMb}
              step={256}
              disabled={!isStopped}
              onChange={(e) => edit(setVmMemoryMb)(Number(e.target.value))}
            />
          </Field>
          <Field label={`${t("vm_settings_max_mem")} (MB)`} hint={t("vm_h_max_mem")}>
            <input
              type="number"
              className="form-input"
              value={vmMaxMemoryMb}
              min={256}
              max={maxMemMb}
              step={256}
              disabled={!isStopped}
              onChange={(e) => edit(setVmMaxMemoryMb)(Number(e.target.value))}
            />
          </Field>
          <Field label={t("vm_settings_boot_device")}>
            <select
              className="form-select"
              value={vmBootDevice}
              disabled={!isStopped}
              onChange={(e) => edit(setVmBootDevice)(e.target.value)}
            >
              <option value="hd">Hard Disk</option>
              <option value="cdrom">CD-ROM</option>
              <option value="network">PXE Network</option>
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
      <div className="settings-group-title">{t("vm_settings_storage")}</div>
      {disks.length === 0 && <div className="settings-empty">{t("vm_disk_empty")}</div>}
      {disks.map((disk, i) => {
        const orig = initialDisks.find((o) => o.target_dev === disk.target_dev);
        return (
          <div className="device-card" key={disk.target_dev || i}>
            <div className="device-card-title">
              {t("vm_disk")} {i + 1}
              <span className="device-card-badge">
                {disk.target_dev || "?"} · {disk.device || "disk"}
              </span>
            </div>
            <Field label={t("vm_settings_disk_path")}>
              <input
                type="text"
                className="form-input"
                value={disk.path}
                disabled={!isStopped}
                onChange={(e) => updateDisk(i, { path: e.target.value })}
              />
            </Field>
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
      <div className="settings-group-title">{t("vm_settings_network")}</div>
      {nics.length === 0 && <div className="settings-empty">{t("vm_nic_empty")}</div>}
      {nics.map((nic, i) => (
        <div className="device-card" key={nic.mac || i}>
          <div className="device-card-title">
            {t("vm_nic")} {i + 1}
            <span className="device-card-badge">{nic.mac || "—"}</span>
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
                  {net.name} ({net.device})
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("vm_settings_net_model")}>
            <select
              className="form-select"
              value={nic.model}
              disabled={!isStopped}
              onChange={(e) => updateNic(i, { model: e.target.value })}
            >
              <option value="virtio">virtio</option>
              <option value="e1000">e1000</option>
              <option value="rtl8139">rtl8139</option>
            </select>
          </Field>
          <Field label={t("vm_f_mac")}>
            <input type="text" className="form-input" value={nic.mac} disabled />
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
                  onClick={handleSaveForm}
                  disabled={saving || loading || !!loadError}
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
                disabled={saving || loading || !!loadError}
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
