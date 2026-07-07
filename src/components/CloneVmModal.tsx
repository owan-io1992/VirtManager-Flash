import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TranslationKey } from "../translations";

interface CloneVmModalProps {
  sourceVmName: string;
  initialSnapshotName?: string;
  onClose: () => void;
  onSuccess: () => void;
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
  showGlobalToast?: (message: string, type: "success" | "error") => void;
}

export const CloneVmModal = ({
  sourceVmName,
  initialSnapshotName,
  onClose,
  onSuccess,
  t,
  showGlobalToast,
}: CloneVmModalProps) => {
  const [newName, setNewName] = useState(`${sourceVmName}-clone`);
  const [cloneType, setCloneType] = useState<"full" | "linked">("full");
  const [snapshots, setSnapshots] = useState<{ name: string }[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string>(initialSnapshotName || "");
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    invoke<any[]>("list_snapshots", { name: sourceVmName })
      .then((list) => {
        setSnapshots(list || []);
      })
      .catch((err) => console.error("Failed to list snapshots for clone modal:", err));
  }, [sourceVmName]);

  const activeCloneType = selectedSnapshot ? "full" : cloneType;

  const handleClone = async () => {
    if (!newName.trim()) return;
    setCloning(true);
    try {
      await invoke("clone_vm", {
        sourceName: sourceVmName,
        newName: newName.trim(),
        cloneType: activeCloneType,
        snapshotName: selectedSnapshot || null,
      });
      if (showGlobalToast) {
        showGlobalToast(t("clone_success", { name: newName.trim() }), "success");
      } else {
        alert(t("clone_success", { name: newName.trim() }));
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      const errMsg = err?.toString() || "Unknown error";
      if (showGlobalToast) {
        showGlobalToast(t("clone_failed", { error: errMsg }), "error");
      } else {
        alert(t("clone_failed", { error: errMsg }));
      }
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="preferences-modal-overlay">
      <div className="preferences-modal preferences-modal-small">
        <div className="preferences-modal-header">
          <span className="preferences-modal-title">{t("clone_title")}</span>
          <button className="btn-close-modal" onClick={onClose} style={{ fontSize: "1.5rem" }} disabled={cloning}>&times;</button>
        </div>

        <div className="preferences-modal-body" style={{ padding: "1.5rem" }}>
          <div className="settings-group" style={{ width: "100%" }}>
            <div className="form-row">
              <span className="form-label">{t("clone_new_name")}</span>
              <input
                type="text"
                className="form-input"
                style={{
                  width: "100%",
                  padding: "0.4rem",
                  borderRadius: "4px",
                  border: "1px solid var(--border-color, #ccc)",
                  backgroundColor: "var(--bg-input, #fff)",
                  color: "var(--text-color, #000)"
                }}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={cloning}
              />
            </div>

            <div className="form-row" style={{ marginTop: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span className="form-label">{t("clone_snapshot_select")}</span>
              <select
                className="form-input"
                style={{
                  width: "100%",
                  padding: "0.4rem",
                  borderRadius: "4px",
                  border: "1px solid var(--border-color, #ccc)",
                  backgroundColor: "var(--bg-input, #fff)",
                  color: "var(--text-color, #000)"
                }}
                value={selectedSnapshot}
                onChange={(e) => {
                  setSelectedSnapshot(e.target.value);
                  if (e.target.value) {
                    setCloneType("full");
                  }
                }}
                disabled={cloning}
              >
                <option value="">{t("clone_snapshot_none")}</option>
                {snapshots.map((snap) => (
                  <option key={snap.name} value={snap.name}>
                    {snap.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row" style={{ marginTop: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span className="form-label">{t("clone_type")}</span>
              <div style={{ display: "flex", gap: "1.5rem", flexDirection: "column" }}>
                <div style={{ display: "flex", gap: "1.5rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="cloneType"
                      checked={activeCloneType === "full"}
                      onChange={() => setCloneType("full")}
                      disabled={cloning}
                    />
                    {t("clone_type_full")}
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", opacity: selectedSnapshot ? 0.5 : 1 }}>
                    <input
                      type="radio"
                      name="cloneType"
                      checked={activeCloneType === "linked"}
                      onChange={() => setCloneType("linked")}
                      disabled={cloning || !!selectedSnapshot}
                    />
                    {t("clone_type_linked")}
                  </label>
                </div>
                {selectedSnapshot && (
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)", marginTop: "0.25rem" }}>
                    ⚠️ {t("clone_linked_snapshot_warning")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="preferences-modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button className="btn-secondary" onClick={onClose} disabled={cloning}>
            {t("btn_close")}
          </button>
          <button
            className="btn-primary"
            onClick={handleClone}
            disabled={cloning || !newName.trim()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {cloning ? t("clone_in_progress") : t("btn_clone")}
          </button>
        </div>
      </div>
    </div>
  );
};
