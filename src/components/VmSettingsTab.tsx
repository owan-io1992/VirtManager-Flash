import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DomainItem, NetworkItem } from "../types";
import { TranslationKey } from "../translations";

interface VmSettingsTabProps {
  selectedVm: DomainItem;
  networks: NetworkItem[];
  lang: "zh" | "en";
  t: (key: TranslationKey) => string;
  onSaveSuccess?: () => void;
}

export const VmSettingsTab = ({
  selectedVm,
  networks,
  lang,
  t,
  onSaveSuccess
}: VmSettingsTabProps) => {
  const [vmSettingsMode, setVmSettingsMode] = useState<"simple" | "advanced">("simple");
  const [vmSettingsCategory, setVmSettingsCategory] = useState<"cpu" | "memory" | "storage" | "network" | "other">("cpu");

  // Editable states
  const [vmCpuCores, setVmCpuCores] = useState(2);
  const [vmMemoryMb, setVmMemoryMb] = useState(4096);
  const [vmMaxMemoryMb, setVmMaxMemoryMb] = useState(4096);
  const [vmDiskPath, setVmDiskPath] = useState("");
  const [vmDiskSize, setVmDiskSize] = useState(50);
  const [vmNetSource, setVmNetSource] = useState("default");
  const [vmNetModel, setVmNetModel] = useState("virtio");
  const [vmAutostart, setVmAutostart] = useState(false);
  const [vmBootDevice, setVmBootDevice] = useState("hd");
  const [vmGraphicsType, setVmGraphicsType] = useState("spice");
  
  const [saving, setSaving] = useState(false);
  const [initialDiskSize, setInitialDiskSize] = useState(50);

  // Sync edits when selected VM changes
  useEffect(() => {
    if (selectedVm) {
      setVmCpuCores(selectedVm.vcpu_count);
      const currentMemMb = Math.round(selectedVm.memory / 1024) || 2048;
      const maxMemMb = Math.round(selectedVm.max_mem / 1024) || 2048;
      setVmMemoryMb(currentMemMb);
      setVmMaxMemoryMb(maxMemMb);
      setVmDiskPath(`/var/libvirt/images/${selectedVm.name}.qcow2`);
      
      // Heuristic for disk size based on domain max memory or similar if not loaded.
      // But we will fetch from storage pool later, or default to 40/80 based on VM size.
      const calculatedDisk = selectedVm.max_mem > 4194304 ? 80 : 40;
      setVmDiskSize(calculatedDisk);
      setInitialDiskSize(calculatedDisk);
      
      setVmNetSource(selectedVm.name.includes("win") ? "hostOnly" : "default");
      setVmNetModel("virtio");
      setVmAutostart(selectedVm.state === 1); // Mock autostart status from state
      setVmBootDevice("hd");
      setVmGraphicsType("spice");
    }
  }, [selectedVm]);

  const handleSave = async () => {
    if (vmDiskSize < initialDiskSize) {
      alert(
        lang === "zh" 
          ? `不支援縮小虛擬硬碟！當前容量: ${initialDiskSize} GB` 
          : `Shrinking storage disks is not supported! Current capacity: ${initialDiskSize} GB`
      );
      return;
    }

    setSaving(false);
    try {
      await invoke("update_vm_settings", {
        name: selectedVm.name,
        cpu: vmCpuCores,
        memory: vmMemoryMb * 1024, // Convert MB to KB
        maxMemory: vmMaxMemoryMb * 1024,
        diskPath: vmDiskPath,
        diskSizeGb: vmDiskSize,
        netSource: vmNetSource,
        netModel: vmNetModel,
        autostart: vmAutostart,
        bootDevice: vmBootDevice,
        graphicsType: vmGraphicsType
      });
      
      alert(lang === "zh" ? "設定變更已成功套用至虛擬機！" : "VM settings saved successfully!");
      if (onSaveSuccess) onSaveSuccess();
    } catch (err: any) {
      console.error(err);
      alert((lang === "zh" ? "儲存設定失敗：" : "Failed to save settings: ") + err.toString());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="vm-settings-panel">
      <div className="vm-settings-header">
        <span className="details-name">{t("tab_settings")}</span>
        <div className="vm-settings-toggle-group">
          <button
            className={`btn-toggle-mode ${vmSettingsMode === "simple" ? "active" : ""}`}
            onClick={() => setVmSettingsMode("simple")}
          >
            {t("vm_settings_simple")}
          </button>
          <button
            className={`btn-toggle-mode ${vmSettingsMode === "advanced" ? "active" : ""}`}
            onClick={() => setVmSettingsMode("advanced")}
          >
            {t("vm_settings_adv")}
          </button>
        </div>
      </div>

      <div className="vm-settings-body">
        {/* Left sidebar menu */}
        <div className="vm-settings-menu">
          <button
            className={`preferences-menu-item ${vmSettingsCategory === "cpu" ? "active" : ""}`}
            onClick={() => setVmSettingsCategory("cpu")}
          >
            {t("vm_settings_cpu")}
          </button>
          <button
            className={`preferences-menu-item ${vmSettingsCategory === "memory" ? "active" : ""}`}
            onClick={() => setVmSettingsCategory("memory")}
          >
            {t("vm_settings_mem")}
          </button>
          <button
            className={`preferences-menu-item ${vmSettingsCategory === "storage" ? "active" : ""}`}
            onClick={() => setVmSettingsCategory("storage")}
          >
            {t("vm_settings_storage")}
          </button>
          <button
            className={`preferences-menu-item ${vmSettingsCategory === "network" ? "active" : ""}`}
            onClick={() => setVmSettingsCategory("network")}
          >
            {t("vm_settings_network")}
          </button>
          <button
            className={`preferences-menu-item ${vmSettingsCategory === "other" ? "active" : ""}`}
            onClick={() => setVmSettingsCategory("other")}
          >
            {t("vm_settings_other")}
          </button>
        </div>

        {/* Right content panel */}
        <div className="vm-settings-content">
          {vmSettingsCategory === "cpu" && (
            <div className="settings-group">
              <div className="settings-group-title">{t("vm_settings_cpu")}</div>
              <div className="form-row">
                <span className="form-label">{t("vm_settings_vcpu")}</span>
                <input
                  type="number"
                  className="form-input"
                  value={vmCpuCores}
                  onChange={(e) => setVmCpuCores(Number(e.target.value))}
                  min={1}
                  max={128}
                />
              </div>
              {vmSettingsMode === "advanced" && (
                <div className="form-row">
                  <span className="form-label">CPU Topology</span>
                  <select className="form-select">
                    <option value="none">Automatic/Default</option>
                    <option value="custom">Custom Sockets/Cores/Threads</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {vmSettingsCategory === "memory" && (
            <div className="settings-group">
              <div className="settings-group-title">{t("vm_settings_mem")}</div>
              <div className="form-row">
                <span className="form-label">{t("memory_usage")} (MB)</span>
                <input
                  type="number"
                  className="form-input"
                  value={vmMemoryMb}
                  onChange={(e) => setVmMemoryMb(Number(e.target.value))}
                  step={512}
                />
              </div>
              {vmSettingsMode === "advanced" && (
                <div className="form-row">
                  <span className="form-label">{t("vm_settings_max_mem")} (MB)</span>
                  <input
                    type="number"
                    className="form-input"
                    value={vmMaxMemoryMb}
                    onChange={(e) => setVmMaxMemoryMb(Number(e.target.value))}
                    step={512}
                  />
                </div>
              )}
            </div>
          )}

          {vmSettingsCategory === "storage" && (
            <div className="settings-group">
              <div className="settings-group-title">{t("vm_settings_storage")}</div>
              <div className="form-row">
                <span className="form-label">{t("vm_settings_disk_path")}</span>
                <input
                  type="text"
                  className="form-input"
                  value={vmDiskPath}
                  onChange={(e) => setVmDiskPath(e.target.value)}
                  disabled={vmSettingsMode === "simple"}
                />
              </div>
              <div className="form-row">
                <span className="form-label">{t("vm_settings_disk_size")} (GB)</span>
                <input
                  type="number"
                  className="form-input"
                  value={vmDiskSize}
                  onChange={(e) => setVmDiskSize(Number(e.target.value))}
                  min={5}
                />
              </div>
              {vmSettingsMode === "advanced" && (
                <div className="form-row">
                  <span className="form-label">Disk Bus Type</span>
                  <select className="form-select">
                    <option value="virtio">VirtIO</option>
                    <option value="sata">SATA</option>
                    <option value="scsi">SCSI</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {vmSettingsCategory === "network" && (
            <div className="settings-group">
              <div className="settings-group-title">{t("vm_settings_network")}</div>
              <div className="form-row">
                <span className="form-label">{t("vm_settings_net_source")}</span>
                <select
                  className="form-select"
                  value={vmNetSource}
                  onChange={(e) => setVmNetSource(e.target.value)}
                >
                  {networks.map((net) => (
                    <option key={net.id} value={net.id}>
                      {net.name} ({net.device})
                    </option>
                  ))}
                </select>
              </div>
              {vmSettingsMode === "advanced" && (
                <div className="form-row">
                  <span className="form-label">{t("vm_settings_net_model")}</span>
                  <select
                    className="form-select"
                    value={vmNetModel}
                    onChange={(e) => setVmNetModel(e.target.value)}
                  >
                    <option value="virtio">virtio</option>
                    <option value="e1000">e1000</option>
                    <option value="rtl8139">rtl8139</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {vmSettingsCategory === "other" && (
            <div className="settings-group">
              <div className="settings-group-title">{t("vm_settings_other")}</div>
              <div className="form-row">
                <span className="form-label">{t("vm_settings_autoconstart")}</span>
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={vmAutostart}
                  onChange={(e) => setVmAutostart(e.target.checked)}
                />
              </div>
              {vmSettingsMode === "advanced" && (
                <>
                  <div className="form-row">
                    <span className="form-label">{t("vm_settings_boot_device")}</span>
                    <select
                      className="form-select"
                      value={vmBootDevice}
                      onChange={(e) => setVmBootDevice(e.target.value)}
                    >
                      <option value="hd">Hard Disk</option>
                      <option value="cdrom">CDROM</option>
                      <option value="network">PXE Network</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <span className="form-label">{t("vm_settings_graphics")}</span>
                    <select
                      className="form-select"
                      value={vmGraphicsType}
                      onChange={(e) => setVmGraphicsType(e.target.value)}
                    >
                      <option value="spice">SPICE</option>
                      <option value="vnc">VNC</option>
                      <option value="none">No Display</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            className="btn-save-settings"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (lang === "zh" ? "儲存中..." : "Saving...") : t("vm_settings_save")}
          </button>
        </div>
      </div>
    </div>
  );
};
