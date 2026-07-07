import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TranslationKey } from "../translations";

interface CloneVmModalProps {
  sourceVmName: string;
  onClose: () => void;
  onSuccess: () => void;
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
  showGlobalToast?: (message: string, type: "success" | "error") => void;
}

export const CloneVmModal = ({
  sourceVmName,
  onClose,
  onSuccess,
  t,
  showGlobalToast,
}: CloneVmModalProps) => {
  const [newName, setNewName] = useState(`${sourceVmName}-clone`);
  const [cloneType, setCloneType] = useState<"full" | "linked">("full");
  const [cloning, setCloning] = useState(false);

  const handleClone = async () => {
    if (!newName.trim()) return;
    setCloning(true);
    try {
      await invoke("clone_vm", {
        sourceName: sourceVmName,
        newName: newName.trim(),
        cloneType: cloneType,
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
              <span className="form-label">{t("clone_type")}</span>
              <div style={{ display: "flex", gap: "1.5rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="cloneType"
                    checked={cloneType === "full"}
                    onChange={() => setCloneType("full")}
                    disabled={cloning}
                  />
                  {t("clone_type_full")}
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="cloneType"
                    checked={cloneType === "linked"}
                    onChange={() => setCloneType("linked")}
                    disabled={cloning}
                  />
                  {t("clone_type_linked")}
                </label>
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
            {cloning ? t("clone_in_progress") : t("clone_title")}
          </button>
        </div>
      </div>
    </div>
  );
};
