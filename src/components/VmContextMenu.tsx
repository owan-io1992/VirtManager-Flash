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
  selectedVmNames: string[];
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
  handleBatchAction: (action: string) => Promise<void>;
  moveSelectedVmsToFolder: (folderId: string | null) => void;
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
  selectedVmNames,
  t,
  handleBatchAction,
  moveSelectedVmsToFolder,
}: VmContextMenuProps) => {
  if (!contextMenu) return null;

  return (
    <div 
      className="context-menu"
      style={{ top: contextMenu.y, left: contextMenu.x }}
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
  );
};
