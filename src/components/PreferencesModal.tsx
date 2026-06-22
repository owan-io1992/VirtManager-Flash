import { useState } from "react";
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
  t
}: PreferencesModalProps) => {
  const [prefCategory, setPrefCategory] = useState<"connection" | "networks" | "storage" | "theme" | "language">("connection");
  const [selectedNetworkId, setSelectedNetworkId] = useState("");
  const [selectedStorageId, setSelectedStorageId] = useState("");

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

  return (
    <div className="preferences-modal-overlay" onClick={() => setShowPrefModal(false)}>
      <div className="preferences-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preferences-modal-header">
          <span className="preferences-modal-title">{t("modal_title")}</span>
          <button className="btn-close-modal" onClick={() => setShowPrefModal(false)}>&times;</button>
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
            {prefCategory === "connection" && (
              <div className="settings-group">
                <div className="settings-group-title">{t("modal_conn")}</div>
                <div className="form-row">
                  <span className="form-label">{t("pref_libvirt_uri")}</span>
                  <input
                    type="text"
                    className="form-input"
                    value={libvirtUri}
                    onChange={(e) => setLibvirtUri(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <span className="form-label">{t("pref_autoconconnect" as any) || t("pref_autoconnect")}</span>
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
                      🌐 {net.name}
                    </div>
                  ))}
                </div>
                {activeNetwork && (
                  <div className="settings-sub-details">
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
                    </div>
                  </div>
                )}
              </div>
            )}

            {prefCategory === "storage" && (
              <div className="settings-two-column">
                <div className="settings-sub-list">
                  {storagePools.map((pool) => (
                    <div
                      key={pool.id}
                      className={`settings-sub-item ${selectedStorageId === pool.id ? "active" : ""}`}
                      onClick={() => setSelectedStorageId(pool.id)}
                    >
                      💾 {pool.name}
                    </div>
                  ))}
                </div>
                {activeStorage && (
                  <div className="settings-sub-details">
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
                    </div>

                    <div className="settings-volumes-title">{t("store_volumes")}</div>
                    <div className="settings-table-wrapper">
                      <table className="settings-table">
                        <thead>
                          <tr>
                            <th>{t("store_volume_name")}</th>
                            <th>{t("store_volume_size")}</th>
                            <th>{t("store_volume_format")}</th>
                            <th>{t("store_volume_used_by")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeStorage.volumes.map((vol) => (
                            <tr key={vol.name}>
                              <td>{vol.name}</td>
                              <td>{vol.size}</td>
                              <td>{vol.format}</td>
                              <td>{vol.used_by}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
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
