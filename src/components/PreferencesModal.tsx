import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NetworkItem, StoragePoolItem, SystemResources } from "../types";
import { TranslationKey } from "../translations";

interface PreferencesModalProps {
  showPrefModal: boolean;
  setShowPrefModal: (show: boolean) => void;
  theme: "dark" | "light";
  setTheme: (theme: "dark" | "light") => void;
  lang: "zh" | "en";
  setLang: (lang: "zh" | "en") => void;
  libvirtUri: string;
  setLibvirtUri: (uri: string) => void;
  autoconnect: boolean;
  setAutoconnect: (auto: boolean) => void;
  systemResources: SystemResources | null;
  networks: NetworkItem[];
  storagePools: StoragePoolItem[];
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
  onRefresh: () => void;
}

export const PreferencesModal = ({
  showPrefModal,
  setShowPrefModal,
  theme,
  setTheme,
  lang,
  setLang,
  libvirtUri,
  setLibvirtUri,
  autoconnect,
  setAutoconnect,
  systemResources,
  networks,
  storagePools,
  t,
  onRefresh
}: PreferencesModalProps) => {
  const [prefCategory, setPrefCategory] = useState<"connection" | "networks" | "storage" | "theme" | "language">("connection");
  const [selectedNetworkId, setSelectedNetworkId] = useState("");
  const [selectedStorageId, setSelectedStorageId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [volSearchQuery, setVolSearchQuery] = useState("");

  useEffect(() => {
    setVolSearchQuery("");
  }, [selectedStorageId, showPrefModal]);


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

  if (!showPrefModal) return null;

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

  return (
    <div className="preferences-modal-overlay" onClick={() => setShowPrefModal(false)}>
      <div className="preferences-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preferences-modal-header">
          <span className="preferences-modal-title">{t("modal_title")}</span>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button
              onClick={onRefresh}
              title={lang === "zh" ? "立即重新整理" : "Refresh Now"}
              style={{
                background: "none",
                border: "none",
                color: "#64748B",
                fontSize: "1.1rem",
                cursor: "pointer",
                padding: "0.25rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "color 0.15s ease",
              }}
              className="btn-close-modal"
            >
              🔄
            </button>
            <button className="btn-close-modal" onClick={() => setShowPrefModal(false)} style={{ fontSize: "1.5rem" }}>&times;</button>
          </div>
        </div>

        <div className="preferences-modal-body">
          {/* Modal left sidebar categories */}
          <div className="preferences-modal-sidebar">
            <button
              className={`preferences-menu-item ${prefCategory === "connection" ? "active" : ""}`}
              onClick={() => setPrefCategory("connection")}
            >
              {t("modal_conn")}
            </button>
            <button
              className={`preferences-menu-item ${prefCategory === "networks" ? "active" : ""}`}
              onClick={() => setPrefCategory("networks")}
            >
              {t("modal_networks")}
            </button>
            <button
              className={`preferences-menu-item ${prefCategory === "storage" ? "active" : ""}`}
              onClick={() => setPrefCategory("storage")}
            >
              {t("modal_storage")}
            </button>
            <button
              className={`preferences-menu-item ${prefCategory === "theme" ? "active" : ""}`}
              onClick={() => setPrefCategory("theme")}
            >
              {t("modal_theme")}
            </button>
            <button
              className={`preferences-menu-item ${prefCategory === "language" ? "active" : ""}`}
              onClick={() => setPrefCategory("language")}
            >
              {t("modal_lang")}
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

            {prefCategory === "connection" && (
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
                <div className="form-row">
                  <span className="form-label">{t("pref_autoconnect")}</span>
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={autoconnect}
                    onChange={(e) => setAutoconnect(e.target.checked)}
                  />
                </div>

                <div className="settings-group-title" style={{ marginTop: "2rem" }}>
                  {t("pref_system_resources")}
                </div>
                <div className="preferences-info-text">
                  <div>
                    {lang === "zh" ? "OS 平台" : "OS Platform"}:{" "}
                    <span className="system-resource-val">
                      {systemResources?.os_platform || "Linux (x86_64)"}
                    </span>
                  </div>
                  <div>
                    {lang === "zh" ? "處理器" : "Processor"}:{" "}
                    <span className="system-resource-val">
                      {systemResources
                        ? `${systemResources.cpu_cores} Core / ${systemResources.cpu_threads} Thread`
                        : `${navigator.hardwareConcurrency || 8} Threads`}
                    </span>
                  </div>
                  <div>
                    {lang === "zh" ? "記憶體 (可用 / 總共)" : "Memory (Available / Total)"}:{" "}
                    <span className="system-resource-val">
                      {systemResources
                        ? `${((systemResources.mem_available_kb) / 1024 / 1024).toFixed(2)} GB / ${((systemResources.mem_total_kb) / 1024 / 1024).toFixed(2)} GB`
                        : "N/A"}
                    </span>
                  </div>
                  <div>
                    Tauri API Version: <span className="system-resource-val">2.x</span>
                  </div>
                </div>
              </div>
            )}

            {prefCategory === "networks" && (
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
                      <div className="form-row">
                        <span className="form-label">{t("net_name")}</span>
                        <input type="text" className="form-input" value={activeNetwork.name} disabled />
                      </div>
                      <div className="form-row">
                        <span className="form-label">{t("net_device")}</span>
                        <input type="text" className="form-input" value={activeNetwork.device} disabled />
                      </div>
                      <div className="form-row">
                        <span className="form-label">{t("net_state")}</span>
                        <span style={{ fontSize: "0.85rem", color: activeNetwork.state === "active" ? "#10B981" : "#EF4444" }}>
                          {activeNetwork.state === "active" ? t("net_active") : t("net_inactive")}
                        </span>
                      </div>
                      <div className="form-row">
                        <span className="form-label">{t("net_autostart")}</span>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", color: "#94A3B8" }}>
                          <input type="checkbox" className="form-checkbox" checked={activeNetwork.autostart} disabled />
                          {t("net_on_boot")}
                        </label>
                      </div>
                      <div className="form-row">
                        <span className="form-label">{t("net_subnet")}</span>
                        <input type="text" className="form-input" value={activeNetwork.subnet} disabled />
                      </div>
                      <div className="form-row">
                        <span className="form-label">{t("net_dhcp")}</span>
                        <input type="text" className="form-input" value={`${activeNetwork.dhcp_start} - ${activeNetwork.dhcp_end}`} disabled />
                      </div>
                      <div className="form-row">
                        <span className="form-label">{t("net_forwarding")}</span>
                        <input type="text" className="form-input" value={activeNetwork.forwarding} disabled />
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

            {prefCategory === "storage" && (
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
                        <div className="settings-group-title">Storage Pool Detail</div>
                        <div className="form-row">
                          <span className="form-label">{t("store_pool_name")}</span>
                          <input type="text" className="form-input" value={activeStorage.name} disabled />
                        </div>
                        <div className="form-row">
                          <span className="form-label">{t("store_pool_location")}</span>
                          <input type="text" className="form-input" value={activeStorage.location} disabled />
                        </div>
                        <div className="form-row">
                          <span className="form-label">{t("store_pool_size")}</span>
                          <span className="form-value-text">
                            {activeStorage.used_gb} GB In Use / {activeStorage.size_gb - activeStorage.used_gb} GB Free
                          </span>
                        </div>
                        <div className="form-row">
                          <span className="form-label">{t("store_pool_autostart")}</span>
                          <input type="checkbox" className="form-checkbox" checked={activeStorage.autostart} disabled />
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
                                  <td>{vol.size}</td>
                                  <td>{vol.format}</td>
                                  <td>{vol.used_by}</td>
                                  <td>
                                    <button
                                      style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: "0.8rem" }}
                                      onClick={() => handleDeleteVolume(vol.name)}
                                      title={t("vol_delete")}
                                    >
                                      ✕
                                    </button>
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

            {prefCategory === "theme" && (
              <div className="settings-group">
                <div className="settings-group-title">{t("modal_theme")}</div>
                <div className="form-row">
                  <span className="form-label">{t("modal_theme")}</span>
                  <select
                    className="form-select"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as "dark" | "light")}
                  >
                    <option value="dark">{t("pref_theme_dark")}</option>
                    <option value="light">{t("pref_theme_light")}</option>
                  </select>
                </div>
              </div>
            )}

            {prefCategory === "language" && (
              <div className="settings-group">
                <div className="settings-group-title">{t("modal_lang")}</div>
                <div className="form-row">
                  <span className="form-label">{t("modal_lang")}</span>
                  <select
                    className="form-select"
                    value={lang}
                    onChange={(e) => setLang(e.target.value as "zh" | "en")}
                  >
                    <option value="zh">{t("pref_lang_zh")}</option>
                    <option value="en">{t("pref_lang_en")}</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="preferences-modal-header" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", borderBottom: "none", justifyContent: "flex-end", padding: "1rem" }}>
          <button className="btn-save-settings" style={{ margin: 0 }} onClick={() => setShowPrefModal(false)}>
            {t("btn_close")}
          </button>
        </div>
      </div>
    </div>
  );
};
