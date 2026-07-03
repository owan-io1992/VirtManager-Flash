import { useState, useEffect, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DomainItem, SnapshotItem } from "../types";
import { TranslationKey } from "../translations";

interface VmSnapshotsTabProps {
  selectedVm: DomainItem;
  theme: "dark" | "light" | "sketch";
  lang: "zh" | "en";
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
}

const VmSnapshotsTabComponent = ({
  selectedVm,
  theme: _theme,
  lang: _lang,
  t,
}: VmSnapshotsTabProps) => {
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Snapshot Creation Modal state
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newSnapshotName, setNewSnapshotName] = useState<string>("");
  const [newSnapshotDesc, setNewSnapshotDesc] = useState<string>("");
  const [creating, setCreating] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Success/error messages
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const fetchSnapshots = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<SnapshotItem[]>("list_snapshots", { name: selectedVm.name });
      setSnapshots(list);
    } catch (err) {
      console.error(err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSnapshots();
    setMessage(null);
  }, [selectedVm.name]);

  const showNotification = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => {
      setMessage(null);
    }, 5000);
  };

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSnapshotName.trim()) return;

    setCreating(true);
    setModalError(null);
    try {
      await invoke("create_snapshot", {
        vmName: selectedVm.name,
        snapshotName: newSnapshotName.trim(),
        description: newSnapshotDesc.trim() || null,
      });
      showNotification(t("snapshot_created_success"), "success");
      setNewSnapshotName("");
      setNewSnapshotDesc("");
      setShowCreateModal(false);
      fetchSnapshots();
    } catch (err) {
      console.error(err);
      setModalError(String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleRevertSnapshot = async (snapshotName: string) => {
    const confirmMsg = t("confirm_revert_snapshot", { name: snapshotName });
    if (!window.confirm(confirmMsg)) return;

    try {
      await invoke("revert_to_snapshot", {
        vmName: selectedVm.name,
        snapshotName,
      });
      showNotification(t("snapshot_reverted_success"), "success");
      fetchSnapshots();
    } catch (err) {
      console.error(err);
      showNotification(String(err), "error");
    }
  };

  const handleDeleteSnapshot = async (snapshotName: string) => {
    const confirmMsg = t("confirm_delete_snapshot", { name: snapshotName });
    if (!window.confirm(confirmMsg)) return;

    try {
      await invoke("delete_snapshot", {
        vmName: selectedVm.name,
        snapshotName,
      });
      showNotification(t("snapshot_deleted_success"), "success");
      fetchSnapshots();
    } catch (err) {
      console.error(err);
      showNotification(String(err), "error");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "1rem" }}>
      {/* Tab Header & Action */}
      <div className="details-header" style={{ marginBottom: "0.5rem" }}>
        <div className="details-title-area">
          <span className="details-name">{t("tab_snapshots")}</span>
          <span className="details-type">{selectedVm.name}</span>
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            setModalError(null);
            setShowCreateModal(true);
          }}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1rem" }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("btn_create_snapshot")}
        </button>
      </div>

      {/* Notifications */}
      {message && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            fontSize: "0.9rem",
            fontWeight: 500,
            background: message.type === "success" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
            border: message.type === "success" ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(239, 68, 68, 0.3)",
            color: message.type === "success" ? "#34D399" : "#F87171",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span>{message.type === "success" ? "✓" : "⚠"}</span>
          <span>{message.text}</span>
        </div>
      )}

      {/* Content Area */}
      {loading ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "#94A3B8" }}>
          {t("vm_settings_loading")}
        </div>
      ) : error ? (
        <div style={{ padding: "2rem", background: "rgba(239, 68, 68, 0.1)", borderRadius: "12px", border: "1px solid rgba(239, 68, 68, 0.2)", color: "#F87171" }}>
          {t("vm_settings_load_error")} {error}
        </div>
      ) : snapshots.length === 0 ? (
        <div style={{ padding: "4rem 2rem", textAlign: "center", background: "rgba(30, 41, 59, 0.2)", borderRadius: "12px", border: "1px dashed rgba(255, 255, 255, 0.1)" }}>
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>📸</div>
          <div style={{ color: "#94A3B8" }}>{t("no_snapshots")}</div>
        </div>
      ) : (
        <div className="settings-table-wrapper" style={{ flex: 1, overflowY: "auto" }}>
          <table className="settings-table">
            <thead>
              <tr>
                <th style={{ width: "20%" }}>{t("snapshot_name")}</th>
                <th style={{ width: "15%" }}>{t("snapshot_state")}</th>
                <th style={{ width: "20%" }}>{t("snapshot_creation_time")}</th>
                <th style={{ width: "30%" }}>{t("snapshot_description")}</th>
                <th style={{ width: "15%", textAlign: "right" }}>{t("snapshot_actions")}</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snap) => (
                <tr key={snap.name} style={{ background: snap.is_current ? "rgba(37, 99, 235, 0.08)" : undefined }}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 600, color: snap.is_current ? "#3B82F6" : undefined }}>{snap.name}</span>
                      {snap.is_current && (
                        <span
                          style={{
                            fontSize: "0.75rem",
                            background: "#2563EB",
                            color: "#FFFFFF",
                            padding: "0.1rem 0.4rem",
                            borderRadius: "4px",
                            fontWeight: 700,
                          }}
                        >
                          {t("snapshot_current")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: "0.8rem",
                        padding: "0.15rem 0.4rem",
                        borderRadius: "4px",
                        background: snap.state === "running" ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.15)",
                        color: snap.state === "running" ? "#34D399" : "#94A3B8",
                        fontWeight: 600,
                      }}
                    >
                      {snap.state}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.85rem", color: "#94A3B8" }}>
                    {new Date(snap.creation_time * 1000).toLocaleString()}
                  </td>
                  <td style={{ fontSize: "0.85rem", color: "#E2E8F0" }}>
                    {snap.description || <span style={{ color: "#475569", fontStyle: "italic" }}>-</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: "0.5rem" }}>
                      <button
                        className="btn-primary"
                        style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
                        onClick={() => handleRevertSnapshot(snap.name)}
                        title={t("btn_revert")}
                      >
                        {t("btn_revert")}
                      </button>
                      <button
                        className="btn-primary"
                        style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem", background: "#DC2626" }}
                        onClick={() => handleDeleteSnapshot(snap.name)}
                        title={t("btn_delete")}
                      >
                        {t("btn_delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Snapshot Creation Modal */}
      {showCreateModal && (
        <div className="preferences-modal-overlay">
          <form className="preferences-modal preferences-modal-small" onSubmit={handleCreateSnapshot} style={{ height: "auto", maxHeight: "90vh", width: "90vw", maxWidth: "420px" }}>
            <div className="preferences-modal-header">
              <span className="preferences-modal-title">{t("btn_create_snapshot")}</span>
              <button type="button" className="btn-close-modal" onClick={() => setShowCreateModal(false)} style={{ fontSize: "1.5rem" }}>
                &times;
              </button>
            </div>

            <div className="preferences-modal-body" style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem", width: "100%", boxSizing: "border-box" }}>
              {modalError && (
                <div
                  style={{
                    padding: "0.75rem 1rem",
                    borderRadius: "8px",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#F87171",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    wordBreak: "break-word",
                  }}
                >
                  <span>⚠</span>
                  <span>{modalError}</span>
                </div>
              )}
              <div className="settings-group" style={{ width: "100%", display: "flex", flexDirection: "column", gap: "1.25rem", margin: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", width: "100%" }}>
                  <label className="form-label" style={{ margin: 0 }}>{t("snapshot_name")}</label>
                  <input
                    type="text"
                    className="form-input"
                    style={{ width: "100%", boxSizing: "border-box" }}
                    value={newSnapshotName}
                    onChange={(e) => setNewSnapshotName(e.target.value.replace(/[^a-zA-Z0-9_.-]/g, ""))}
                    placeholder={t("placeholder_snapshot_name")}
                    required
                    disabled={creating}
                    autoFocus
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", width: "100%" }}>
                  <label className="form-label" style={{ margin: 0 }}>{t("snapshot_description")}</label>
                  <textarea
                    className="form-input"
                    style={{ width: "100%", height: "80px", resize: "none", padding: "0.5rem", boxSizing: "border-box" }}
                    value={newSnapshotDesc}
                    onChange={(e) => setNewSnapshotDesc(e.target.value)}
                    placeholder={t("placeholder_snapshot_desc")}
                    disabled={creating}
                  />
                </div>
              </div>
            </div>

            <div className="preferences-modal-footer">
              <button
                type="button"
                className="btn-primary"
                style={{ background: "#475569" }}
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
              >
                {t("btn_close")}
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={creating || !newSnapshotName.trim()}
              >
                {creating ? t("wizard_creating") : t("btn_apply")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const vmSnapshotsTabPropsAreEqual = (prev: VmSnapshotsTabProps, next: VmSnapshotsTabProps) => {
  return (
    prev.selectedVm.name === next.selectedVm.name &&
    prev.theme === next.theme &&
    prev.lang === next.lang &&
    prev.t === next.t
  );
};

export const VmSnapshotsTab = memo(VmSnapshotsTabComponent, vmSnapshotsTabPropsAreEqual);
