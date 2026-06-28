import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NetworkItem, StoragePoolItem, SystemResources } from "../types";
import { TranslationKey } from "../translations";

interface ResourceManagerModalProps {
  showResModal: boolean;
  setShowResModal: (show: boolean) => void;
  lang: "zh" | "en";
  libvirtUri: string;
  setLibvirtUri: (uri: string) => void;
  systemResources: SystemResources | null;
  networks: NetworkItem[];
  storagePools: StoragePoolItem[];
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
  onRefresh: () => void;
}

export const ResourceManagerModal = ({
  showResModal,
  setShowResModal,
  lang,
  libvirtUri,
  setLibvirtUri,
  systemResources,
  networks,
  storagePools,
  t,
  onRefresh,
}: ResourceManagerModalProps) => {
  const [resCategory, setResCategory] = useState<"connection" | "networks" | "storage" | "system">("connection");
  const [selectedNetworkId, setSelectedNetworkId] = useState("");
  const [selectedStorageId, setSelectedStorageId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [volSearchQuery, setVolSearchQuery] = useState("");

  useEffect(() => {
    setVolSearchQuery("");
  }, [selectedStorageId, showResModal]);

  // Create network form
  const [showCreateNet, setShowCreateNet] = useState(false);
  const [newNetName, setNewNetName] = useState("");
  const [newNetSubnet, setNewNetSubnet] = useState("192.168.100.0/24");
  const [newNetDhcpStart, setNewNetDhcpStart] = useState("192.168.100.100");
  const [newNetDhcpEnd, setNewNetDhcpEnd] = useState("192.168.100.200");
  const [newNetForward, setNewNetForward] = useState("nat");

  // Create pool form
  const [showCreatePool, setShowCreatePool] = useState(false);
  const [newPoolName, setNewPoolName] = useState("");
  const [newPoolPath, setNewPoolPath] = useState("/var/lib/libvirt/images");

  // Create volume form
  const [showCreateVol, setShowCreateVol] = useState(false);
  const [newVolName, setNewVolName] = useState("");
  const [newVolSize, setNewVolSize] = useState("10");
  const [newVolFormat, setNewVolFormat] = useState("qcow2");

  // URI switching
  const [uriInput, setUriInput] = useState(libvirtUri);
  const [uriSwitching, setUriSwitching] = useState(false);

  // Volume editing state
  const [editingVolumeName, setEditingVolumeName] = useState<string | null>(null);
  const [editingVolumeSize, setEditingVolumeSize] = useState("");

  useEffect(() => {
    setUriInput(libvirtUri);
  }, [libvirtUri, showResModal]);

  if (!showResModal) return null;

  // Initialize selected item IDs if empty
  if (networks.length > 0 && !selectedNetworkId) {
    setSelectedNetworkId(networks[0].id);
  }
  if (storagePools.length > 0 && !selectedStorageId) {
    setSelectedStorageId(storagePools[0].id);
  }

  const activeNetwork = networks.find((n) => n.id === selectedNetworkId) || networks[0];
  const activeStorage = storagePools.find((p) => p.id === selectedStorageId) || storagePools[0];

  const handleSwitchUri = async () => {
    setUriSwitching(true);
    setActionError(null);
    try {
      await invoke("set_libvirt_uri", { uri: uriInput });
      setLibvirtUri(uriInput);
      onRefresh();
    } catch (err: any) {
      setActionError(err?.toString() || "Failed to switch URI");
    } finally {
      setUriSwitching(false);
    }
  };

  const handleNetworkAction = async (action: string, name: string) => {
    setActionError(null);
    try {
      await invoke(action, { name });
      onRefresh();
    } catch (err: any) {
      setActionError(err?.toString() || "Network action failed");
    }
  };

  const handleCreateNetwork = async () => {
    setActionError(null);
    try {
      await invoke("create_network", {
        name: newNetName,
        subnet: newNetSubnet,
        dhcpStart: newNetDhcpStart,
        dhcpEnd: newNetDhcpEnd,
        forwardMode: newNetForward,
      });
      setShowCreateNet(false);
      setNewNetName("");
      onRefresh();
    } catch (err: any) {
      setActionError(err?.toString() || "Failed to create network");
    }
  };

  const handleDeleteNetwork = async (name: string) => {
    if (!confirm(t("net_confirm_delete"))) return;
    setActionError(null);
    try {
      await invoke("delete_network", { name });
      setSelectedNetworkId("");
      onRefresh();
    } catch (err: any) {
      setActionError(err?.toString() || "Failed to delete network");
    }
  };

  const handlePoolAction = async (action: string, name: string) => {
    setActionError(null);
    try {
      await invoke(action, { name });
      onRefresh();
    } catch (err: any) {
      setActionError(err?.toString() || "Storage pool action failed");
    }
  };

  const handleCreatePool = async () => {
    setActionError(null);
    try {
      await invoke("create_storage_pool", { name: newPoolName, path: newPoolPath });
      setShowCreatePool(false);
      setNewPoolName("");
      onRefresh();
    } catch (err: any) {
      setActionError(err?.toString() || "Failed to create storage pool");
    }
  };

  const handleDeletePool = async (name: string) => {
    if (!confirm(t("store_confirm_delete"))) return;
    setActionError(null);
    try {
      await invoke("delete_storage_pool", { name });
      setSelectedStorageId("");
      onRefresh();
    } catch (err: any) {
      setActionError(err?.toString() || "Failed to delete storage pool");
    }
  };

  const handleCreateVolume = async () => {
    if (!activeStorage) return;
    setActionError(null);
    try {
      await invoke("create_volume", {
        poolName: activeStorage.name,
        volName: newVolName,
        sizeGb: parseInt(newVolSize) || 10,
        format: newVolFormat,
      });
      setShowCreateVol(false);
      setNewVolName("");
      onRefresh();
    } catch (err: any) {
      setActionError(err?.toString() || "Failed to create volume");
    }
  };

  const handleDeleteVolume = async (volName: string) => {
    if (!activeStorage) return;
    if (!confirm(t("vol_confirm_delete"))) return;
    setActionError(null);
    try {
      await invoke("delete_volume", { poolName: activeStorage.name, volName });
      onRefresh();
    } catch (err: any) {
      setActionError(err?.toString() || "Failed to delete volume");
    }
  };

  const handleResizeVolume = async (volName: string) => {
    if (!activeStorage) return;
    setActionError(null);
    try {
      const sizeGb = parseInt(editingVolumeSize);
      if (isNaN(sizeGb) || sizeGb <= 0) {
        setActionError("Invalid volume size");
        return;
      }
      await invoke("resize_volume", { poolName: activeStorage.name, volName, newSizeGb: sizeGb });
      setEditingVolumeName(null);
      onRefresh();
    } catch (err: any) {
      setActionError(err?.toString() || "Failed to resize volume");
    }
  };

  return (
    <div className="preferences-modal-overlay">
      <div className="preferences-modal">
        <div className="preferences-modal-header">
          <span className="preferences-modal-title">{t("modal_res_title")}</span>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button
              onClick={onRefresh}
              title={lang === "zh" ? "立即重新整理" : "Refresh Now"}
              className="btn-refresh"
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
            <button className="btn-close-modal" onClick={() => setShowResModal(false)} style={{ fontSize: "1.5rem" }}>&times;</button>
          </div>
        </div>

        <div className="preferences-modal-body">
          {/* Modal left sidebar categories */}
          <div className="preferences-modal-sidebar">
            <button
              className={`preferences-menu-item ${resCategory === "connection" ? "active" : ""}`}
              onClick={() => setResCategory("connection")}
            >
              {t("modal_conn")}
            </button>
            <button
              className={`preferences-menu-item ${resCategory === "networks" ? "active" : ""}`}
              onClick={() => setResCategory("networks")}
            >
              {t("modal_networks")}
            </button>
            <button
              className={`preferences-menu-item ${resCategory === "storage" ? "active" : ""}`}
              onClick={() => setResCategory("storage")}
            >
              {t("modal_storage")}
            </button>
            <button
              className={`preferences-menu-item ${resCategory === "system" ? "active" : ""}`}
              onClick={() => setResCategory("system")}
            >
              {t("modal_system")}
            </button>
          </div>

          {/* Modal right content display */}
          <div className="preferences-modal-content">
            {actionError && (
              <div className="notification-banner" style={{ marginBottom: "1rem" }}>
                <span>{actionError}</span>
                <button className="btn-close-banner" onClick={() => setActionError(null)}>&times;</button>
              </div>
            )}

            {resCategory === "connection" && (
              <div className="settings-group">
                <div className="settings-group-title">{t("modal_conn")}</div>
                <div className="form-row">
                  <span className="form-label">{t("pref_libvirt_uri")}</span>
                  <div style={{ display: "flex", gap: "0.5rem", flex: 1 }}>
                    <input
                      type="text"
                      className="form-input"
                      value={uriInput}
                      onChange={(e) => setUriInput(e.target.value)}
                      placeholder={t("conn_uri_placeholder")}
                    />
                    <button
                      className="btn-save-settings"
                      style={{ margin: 0, whiteSpace: "nowrap" }}
                      onClick={handleSwitchUri}
                      disabled={uriSwitching || uriInput === libvirtUri}
                    >
                      {uriSwitching ? "..." : t("conn_switch_uri")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {resCategory === "system" && (
              <div className="settings-group">
                <div className="settings-group-title">
                  {t("pref_system_resources")}
                </div>
                <div className="spec-list">
                  <div className="spec-item">
                    <span className="spec-label">{lang === "zh" ? "OS 平台" : "OS Platform"}</span>
                    <span className="spec-value">
                      {systemResources?.os_platform || "Linux (x86_64)"}
                    </span>
                  </div>
                  <div className="spec-item">
                    <span className="spec-label">{lang === "zh" ? "處理器" : "Processor"}</span>
                    <span className="spec-value">
                      {systemResources
                        ? `${systemResources.cpu_cores} Core / ${systemResources.cpu_threads} Thread`
                        : `${navigator.hardwareConcurrency || 8} Threads`}
                    </span>
                  </div>
                  <div className="spec-item">
                    <span className="spec-label">{lang === "zh" ? "記憶體 (可用 / 總共)" : "Memory (Available / Total)"}</span>
                    <span className="spec-value">
                      {systemResources
                        ? `${((systemResources.mem_available_kb) / 1024 / 1024).toFixed(2)} GB / ${((systemResources.mem_total_kb) / 1024 / 1024).toFixed(2)} GB`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="spec-item">
                    <span className="spec-label">Tauri API Version</span>
                    <span className="spec-value">2.x</span>
                  </div>
                </div>
              </div>
            )}

            {resCategory === "networks" && (
              <div className="settings-two-column">
                <div className="settings-sub-list">
                  {networks.map((net) => (
                    <div
                      key={net.id}
                      className={`settings-sub-item ${selectedNetworkId === net.id ? "active" : ""}`}
                      onClick={() => setSelectedNetworkId(net.id)}
                    >
                      <span style={{ color: net.state === "active" ? "#10B981" : "#EF4444", marginRight: "0.4rem" }}>●</span>
                      {net.name}
                    </div>
                  ))}
                  <button
                    className="btn-save-settings"
                    style={{ margin: "0.5rem", fontSize: "0.8rem" }}
                    onClick={() => setShowCreateNet(true)}
                  >
                    + {t("net_create")}
                  </button>
                </div>
                <div className="settings-sub-details">
                  {showCreateNet ? (
                    <div className="settings-group">
                      <div className="settings-group-title">{t("net_create_title")}</div>
                      <div className="form-row">
                        <span className="form-label">{t("net_name")}</span>
                        <input type="text" className="form-input" value={newNetName} onChange={(e) => setNewNetName(e.target.value)} placeholder="my-network" />
                      </div>
                      <div className="form-row">
                        <span className="form-label">{t("net_subnet")}</span>
                        <input type="text" className="form-input" value={newNetSubnet} onChange={(e) => setNewNetSubnet(e.target.value)} />
                      </div>
                      <div className="form-row">
                        <span className="form-label">{t("net_dhcp")} (Start)</span>
                        <input type="text" className="form-input" value={newNetDhcpStart} onChange={(e) => setNewNetDhcpStart(e.target.value)} />
                      </div>
                      <div className="form-row">
                        <span className="form-label">{t("net_dhcp")} (End)</span>
                        <input type="text" className="form-input" value={newNetDhcpEnd} onChange={(e) => setNewNetDhcpEnd(e.target.value)} />
                      </div>
                      <div className="form-row">
                        <span className="form-label">{t("net_forward_mode")}</span>
                        <select className="form-select" value={newNetForward} onChange={(e) => setNewNetForward(e.target.value)}>
                          <option value="nat">NAT</option>
                          <option value="bridge">Bridge</option>
                          <option value="route">Route</option>
                          <option value="isolated">Isolated</option>
                        </select>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                        <button className="btn-save-settings" style={{ margin: 0 }} onClick={handleCreateNetwork} disabled={!newNetName.trim()}>
                          {t("net_create")}
                        </button>
                        <button className="btn-save-settings" style={{ margin: 0, opacity: 0.7 }} onClick={() => setShowCreateNet(false)}>
                          {t("btn_close")}
                        </button>
                      </div>
                    </div>
                  ) : activeNetwork ? (
                    <div className="settings-group">
                      <div className="settings-group-title">{t("net_ipv4")}</div>
                      <div className="spec-list">
                        <div className="spec-item">
                          <span className="spec-label">{t("net_name")}</span>
                          <span className="spec-value">{activeNetwork.name}</span>
                        </div>
                        <div className="spec-item">
                          <span className="spec-label">{t("net_device")}</span>
                          <span className="spec-value">{activeNetwork.device}</span>
                        </div>
                        <div className="spec-item">
                          <span className="spec-label">{t("net_state")}</span>
                          <span className="spec-value status-indicator" style={{ color: activeNetwork.state === "active" ? "#10B981" : "#EF4444" }}>
                            ● {activeNetwork.state === "active" ? t("net_active") : t("net_inactive")}
                          </span>
                        </div>
                        <div className="spec-item">
                          <span className="spec-label">{t("net_autostart")}</span>
                          <span className="spec-value" style={{ color: activeNetwork.autostart ? "#10B981" : "#64748B" }}>
                            {activeNetwork.autostart ? (lang === "zh" ? "已啟用" : "Enabled") : (lang === "zh" ? "已停用" : "Disabled")}
                          </span>
                        </div>
                        <div className="spec-item">
                          <span className="spec-label">{t("net_subnet")}</span>
                          <span className="spec-value">{activeNetwork.subnet}</span>
                        </div>
                        <div className="spec-item">
                          <span className="spec-label">{t("net_dhcp")}</span>
                          <span className="spec-value">{`${activeNetwork.dhcp_start} - ${activeNetwork.dhcp_end}`}</span>
                        </div>
                        <div className="spec-item">
                          <span className="spec-label">{t("net_forwarding")}</span>
                          <span className="spec-value">{activeNetwork.forwarding}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                        {activeNetwork.state === "active" ? (
                          <button className="btn-save-settings" style={{ margin: 0 }} onClick={() => handleNetworkAction("stop_network", activeNetwork.name)}>
                            {t("net_stop")}
                          </button>
                        ) : (
                          <button className="btn-save-settings" style={{ margin: 0 }} onClick={() => handleNetworkAction("start_network", activeNetwork.name)}>
                            {t("net_start")}
                          </button>
                        )}
                        <button className="btn-save-settings" style={{ margin: 0, background: "#EF4444" }} onClick={() => handleDeleteNetwork(activeNetwork.name)}>
                          {t("net_delete")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {resCategory === "storage" && (
              <div className="settings-two-column">
                <div className="settings-sub-list">
                  {storagePools.map((pool) => (
                    <div
                      key={pool.id}
                      className={`settings-sub-item ${selectedStorageId === pool.id ? "active" : ""}`}
                      onClick={() => { setSelectedStorageId(pool.id); setShowCreatePool(false); setShowCreateVol(false); }}
                    >
                      <span style={{ color: pool.state === "active" ? "#10B981" : "#EF4444", marginRight: "0.4rem" }}>●</span>
                      {pool.name}
                    </div>
                  ))}
                  <button
                    className="btn-save-settings"
                    style={{ margin: "0.5rem", fontSize: "0.8rem" }}
                    onClick={() => setShowCreatePool(true)}
                  >
                    + {t("store_create")}
                  </button>
                </div>
                <div className="settings-sub-details">
                  {showCreatePool ? (
                    <div className="settings-group">
                      <div className="settings-group-title">{t("store_create_title")}</div>
                      <div className="form-row">
                        <span className="form-label">{t("store_pool_name")}</span>
                        <input type="text" className="form-input" value={newPoolName} onChange={(e) => setNewPoolName(e.target.value)} placeholder="my-pool" />
                      </div>
                      <div className="form-row">
                        <span className="form-label">{t("store_pool_path")}</span>
                        <input type="text" className="form-input" value={newPoolPath} onChange={(e) => setNewPoolPath(e.target.value)} />
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                        <button className="btn-save-settings" style={{ margin: 0 }} onClick={handleCreatePool} disabled={!newPoolName.trim()}>
                          {t("store_create")}
                        </button>
                        <button className="btn-save-settings" style={{ margin: 0, opacity: 0.7 }} onClick={() => setShowCreatePool(false)}>
                          {t("btn_close")}
                        </button>
                      </div>
                    </div>
                  ) : activeStorage ? (
                    <>
                      <div className="settings-group">
                        <div className="settings-group-title">{lang === "zh" ? "儲存池詳細資訊" : "Storage Pool Details"}</div>
                        <div className="spec-list">
                          <div className="spec-item">
                            <span className="spec-label">{t("store_pool_name")}</span>
                            <span className="spec-value">{activeStorage.name}</span>
                          </div>
                          <div className="spec-item">
                            <span className="spec-label">{t("store_pool_location")}</span>
                            <span className="spec-value">{activeStorage.location}</span>
                          </div>
                          <div className="spec-item">
                            <span className="spec-label">{t("store_pool_size")}</span>
                            <span className="spec-value">
                              {activeStorage.used_gb} GB {lang === "zh" ? "已使用" : "In Use"} / {activeStorage.size_gb - activeStorage.used_gb} GB {lang === "zh" ? "可用" : "Free"}
                            </span>
                          </div>
                          <div className="spec-item">
                            <span className="spec-label">{t("store_pool_autostart")}</span>
                            <span className="spec-value" style={{ color: activeStorage.autostart ? "#10B981" : "#64748B" }}>
                              {activeStorage.autostart ? (lang === "zh" ? "已啟用" : "Enabled") : (lang === "zh" ? "已停用" : "Disabled")}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                          {activeStorage.state === "active" ? (
                            <button className="btn-save-settings" style={{ margin: 0 }} onClick={() => handlePoolAction("stop_storage_pool", activeStorage.name)}>
                              {t("store_stop")}
                            </button>
                          ) : (
                            <button className="btn-save-settings" style={{ margin: 0 }} onClick={() => handlePoolAction("start_storage_pool", activeStorage.name)}>
                              {t("store_start")}
                            </button>
                          )}
                          <button className="btn-save-settings" style={{ margin: 0, background: "#EF4444" }} onClick={() => handleDeletePool(activeStorage.name)}>
                            {t("store_delete")}
                          </button>
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "1.25rem 0 0.5rem 0" }}>
                        <div className="settings-volumes-title" style={{ margin: 0 }}>{t("store_volumes")}</div>
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                          <input
                            type="text"
                            placeholder={lang === "zh" ? "搜尋硬碟..." : "Search..."}
                            value={volSearchQuery}
                            onChange={(e) => setVolSearchQuery(e.target.value)}
                            className="volume-search-input"
                          />
                          {activeStorage.state === "active" && (
                            <button
                              className="btn-save-settings"
                              style={{ margin: 0, fontSize: "0.75rem", padding: "0.25rem 0.75rem" }}
                              onClick={() => setShowCreateVol(true)}
                            >
                              + {t("vol_create")}
                            </button>
                          )}
                        </div>
                      </div>

                      {showCreateVol && (
                        <div className="settings-group" style={{ marginBottom: "1rem" }}>
                          <div className="settings-group-title">{t("vol_create_title")}</div>
                          <div className="form-row">
                            <span className="form-label">{t("vol_name_label")}</span>
                            <input type="text" className="form-input" value={newVolName} onChange={(e) => setNewVolName(e.target.value)} placeholder="disk.qcow2" />
                          </div>
                          <div className="form-row">
                            <span className="form-label">{t("vol_size_label")}</span>
                            <input type="number" className="form-input" value={newVolSize} onChange={(e) => setNewVolSize(e.target.value)} min="1" />
                          </div>
                          <div className="form-row">
                            <span className="form-label">{t("vol_format_label")}</span>
                            <select className="form-select" value={newVolFormat} onChange={(e) => setNewVolFormat(e.target.value)}>
                              <option value="qcow2">qcow2</option>
                              <option value="raw">raw</option>
                            </select>
                          </div>
                          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                            <button className="btn-save-settings" style={{ margin: 0 }} onClick={handleCreateVolume} disabled={!newVolName.trim()}>
                              {t("vol_create")}
                            </button>
                            <button className="btn-save-settings" style={{ margin: 0, opacity: 0.7 }} onClick={() => setShowCreateVol(false)}>
                              {t("btn_close")}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="settings-table-wrapper">
                        <table className="settings-table">
                          <thead>
                            <tr>
                              <th>{t("store_volume_name")}</th>
                              <th>{t("store_volume_size")}</th>
                              <th>{t("store_volume_format")}</th>
                              <th>{t("store_volume_used_by")}</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeStorage.volumes
                              .filter((vol) =>
                                vol.name.toLowerCase().includes(volSearchQuery.toLowerCase()) ||
                                vol.used_by.toLowerCase().includes(volSearchQuery.toLowerCase())
                              )
                              .map((vol) => (
                                <tr key={vol.name}>
                                  <td>{vol.name}</td>
                                  <td>
                                    {editingVolumeName === vol.name ? (
                                      <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                                        <input
                                          type="number"
                                          className="form-input"
                                          style={{ width: "70px", padding: "0.15rem 0.25rem", fontSize: "0.85rem", height: "auto", margin: 0 }}
                                          value={editingVolumeSize}
                                          onChange={(e) => setEditingVolumeSize(e.target.value)}
                                          min="1"
                                        />
                                        <span style={{ fontSize: "0.85rem" }}>GB</span>
                                      </div>
                                    ) : (
                                      vol.size
                                    )}
                                  </td>
                                  <td>{vol.format}</td>
                                  <td>{vol.used_by}</td>
                                  <td>
                                    {editingVolumeName === vol.name ? (
                                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                                        <button
                                          style={{ background: "none", border: "none", color: "#10B981", cursor: "pointer", fontSize: "0.95rem", padding: 0 }}
                                          onClick={() => handleResizeVolume(vol.name)}
                                          title={lang === "zh" ? "儲存" : "Save"}
                                        >
                                          ✓
                                        </button>
                                        <button
                                          style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: "0.95rem", padding: 0 }}
                                          onClick={() => setEditingVolumeName(null)}
                                          title={lang === "zh" ? "取消" : "Cancel"}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    ) : (
                                      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                                        <button
                                          style={{ background: "none", border: "none", color: "#3B82F6", cursor: "pointer", fontSize: "0.85rem", padding: 0, display: "flex", alignItems: "center" }}
                                          onClick={() => {
                                            setEditingVolumeName(vol.name);
                                            const currentGb = parseFloat(vol.size) || 10;
                                            setEditingVolumeSize(Math.round(currentGb).toString());
                                          }}
                                          title={lang === "zh" ? "編輯大小" : "Edit Size"}
                                        >
                                          ✏️
                                        </button>
                                        <button
                                          style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", display: "flex", alignItems: "center", padding: 0 }}
                                          onClick={() => handleDeleteVolume(vol.name)}
                                          title={t("vol_delete")}
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
                                            <polyline points="3 6 5 6 21 6"></polyline>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                            <line x1="10" y1="11" x2="10" y2="17"></line>
                                            <line x1="14" y1="11" x2="14" y2="17"></line>
                                          </svg>
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="preferences-modal-footer">
          <button className="btn-save-settings" style={{ margin: 0 }} onClick={() => setShowResModal(false)}>
            {t("btn_close")}
          </button>
        </div>
      </div>
    </div>
  );
};
