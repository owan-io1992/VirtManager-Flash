import { useRef, useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Folder } from "../types";
import { TranslationKey } from "../translations";

interface VmContextMenuProps {
  contextMenu: { x: number; y: number; vmName: string } | null;
  setContextMenu: (menu: { x: number; y: number; vmName: string } | null) => void;
  folders: Folder[];
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canReboot: boolean;
  canShutdown: boolean;
  canForceStop: boolean;
  canReset: boolean;
  canDelete: boolean;
  selectedVmNames: string[];
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
  handleBatchAction: (action: string) => Promise<void>;
  moveSelectedVmsToFolder: (folderId: string | null) => void;
  onDeleted: () => void;
  onClone?: (vmName: string) => void;
  showGlobalToast?: (message: string, type: "success" | "error") => void;
}

export const VmContextMenu = ({
  contextMenu,
  setContextMenu,
  folders,
  canStart,
  canPause,
  canResume,
  canReboot,
  canShutdown,
  canForceStop,
  canReset,
  canDelete,
  selectedVmNames,
  t,
  handleBatchAction,
  moveSelectedVmsToFolder,
  onDeleted,
  onClone,
  showGlobalToast,
}: VmContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: contextMenu?.x ?? 0, y: contextMenu?.y ?? 0 });
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteStorage, setDeleteStorage] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;
    setDeleting(true);
    try {
      await invoke("delete_vm", { name: contextMenu.vmName, deleteStorage });
      setContextMenu(null);
      onDeleted();
    } catch (err: any) {
      const errMsg = err?.toString() || "Unknown error";
      if (showGlobalToast) {
        showGlobalToast(t("delete_vm_failed", { error: errMsg }), "error");
      } else {
        alert(t("delete_vm_failed", { error: errMsg }));
      }
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }, [contextMenu, deleteStorage, onDeleted]);

  useEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const el = menuRef.current;
    const { innerWidth, innerHeight } = window;
    const rect = el.getBoundingClientRect();
    const x = contextMenu.x + rect.width > innerWidth ? contextMenu.x - rect.width : contextMenu.x;
    const y = contextMenu.y + rect.height > innerHeight ? contextMenu.y - rect.height : contextMenu.y;
    setPos({ x, y });
  }, [contextMenu]);

  if (!contextMenu) return null;

  return (
    <>
    <div
      ref={menuRef}
      className="context-menu"
      style={{ top: pos.y, left: pos.x }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="context-menu-title">{contextMenu.vmName}</div>
      <button
        className="context-menu-item"
        onClick={async () => {
          setContextMenu(null);
          await handleBatchAction("start_domain");
        }}
        disabled={!canStart}
      >
        <span className="menu-icon" style={{ color: "#10B981" }}>▶</span> {t("ctx_start")}
      </button>
      <button
        className="context-menu-item"
        onClick={async () => {
          setContextMenu(null);
          await handleBatchAction("suspend_domain");
        }}
        disabled={!canPause}
      >
        <span className="menu-icon" style={{ color: "#F59E0B" }}>Ⅱ</span> {t("ctx_pause")}
      </button>
      <button
        className="context-menu-item"
        onClick={async () => {
          setContextMenu(null);
          await handleBatchAction("resume_domain");
        }}
        disabled={!canResume}
      >
        <span className="menu-icon" style={{ color: "#10B981" }}>▶</span> {t("ctx_resume")}
      </button>
      <button
        className="context-menu-item"
        onClick={async () => {
          setContextMenu(null);
          await handleBatchAction("reboot_domain");
        }}
        disabled={!canReboot}
      >
        <span className="menu-icon" style={{ color: "#3B82F6" }}>↻</span> {t("ctx_reboot")}
      </button>
      <button
        className="context-menu-item"
        onClick={async () => {
          setContextMenu(null);
          await handleBatchAction("shutdown_domain");
        }}
        disabled={!canShutdown}
      >
        <span className="menu-icon" style={{ color: "#EF4444" }}>■</span> {t("ctx_shutdown")}
      </button>
      <button
        className="context-menu-item"
        onClick={async () => {
          setContextMenu(null);
          await handleBatchAction("stop_domain");
        }}
        disabled={!canForceStop}
      >
        <span className="menu-icon" style={{ color: "#EF4444" }}>☠</span> {t("ctx_force_stop")}
      </button>
      <button
        className="context-menu-item"
        onClick={async () => {
          setContextMenu(null);
          await handleBatchAction("reset_domain");
        }}
        disabled={!canReset}
      >
        <span className="menu-icon" style={{ color: "#EF4444" }}>⚠</span> {t("ctx_reset")}
      </button>
      
      <button
        className="context-menu-item"
        onClick={() => {
          setContextMenu(null);
          if (onClone) {
            onClone(contextMenu.vmName);
          }
        }}
      >
        <span className="menu-icon" style={{ color: "#3B82F6" }}>🐑</span> {t("ctx_clone")}
      </button>
      
      <div className="context-menu-divider"></div>
      <button
        className="context-menu-item"
        style={canDelete ? { color: "#EF4444" } : undefined}
        onClick={() => { setDeleteConfirm(true); setDeleteStorage(false); }}
        disabled={!canDelete}
      >
        <span className="menu-icon" style={{ color: canDelete ? "#EF4444" : "var(--text-muted)" }}>🗑</span> {t("ctx_delete")}
      </button>

      <div className="context-menu-divider"></div>
      {folders.map((f) => {
        const hasVm = f.vmNames.includes(contextMenu.vmName);
        return (
          <button
            key={f.id}
            className="context-menu-item"
            onClick={() => moveSelectedVmsToFolder(hasVm ? null : f.id)}
          >
            <span className="menu-icon">{hasVm ? "📤" : "📥"}</span>
            {hasVm 
              ? t("ctx_move_out") 
              : t("ctx_move_to", { name: f.name })}
          </button>
        );
      })}
      {selectedVmNames.some((name) => folders.some((f) => f.vmNames.includes(name))) && (
        <button
          className="context-menu-item"
          onClick={() => moveSelectedVmsToFolder(null)}
        >
          <span className="menu-icon">📤</span> {t("ctx_move_out")}
        </button>
      )}
    </div>

    {deleteConfirm && contextMenu && (
      <div className="wizard-overlay" onClick={() => setDeleteConfirm(false)}>
        <div className="wizard-modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
          <div className="wizard-header">
            <h2 className="wizard-title" style={{ color: "#EF4444" }}>{t("ctx_delete")}</h2>
          </div>
          <div className="wizard-body">
            <p style={{ marginBottom: "1rem" }}>{t("ctx_delete_confirm", { name: contextMenu.vmName })}</p>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={deleteStorage}
                onChange={(e) => setDeleteStorage(e.target.checked)}
              />
              {t("ctx_delete_storage")}
            </label>
          </div>
          <div className="wizard-footer">
            <button className="btn-secondary" onClick={() => setDeleteConfirm(false)}>{t("btn_close")}</button>
            <button
              className="btn-primary"
              style={{ background: "#EF4444", borderColor: "#EF4444" }}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "..." : t("ctx_delete")}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};
