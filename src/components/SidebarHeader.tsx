import React from "react";
import { TranslationKey } from "../translations";

interface SidebarHeaderProps {
  t: (key: TranslationKey) => string;
  loading: boolean;
  runningCount: number;
  stoppedCount: number;
  totalCount: number;
  isAnyActionLoading: boolean;
  canStart: boolean;
  canShutdown: boolean;
  handleBatchAction: (action: string) => Promise<void>;
  setShowPrefModal: (show: boolean) => void;
  setShowResModal: (show: boolean) => void;
  fetchDomains: () => Promise<void>;
  setIsCreatingFolder: React.Dispatch<React.SetStateAction<boolean>>;
  onCreateVm: () => void;
}

export const SidebarHeader = ({
  t,
  loading,
  runningCount,
  stoppedCount,
  totalCount,
  isAnyActionLoading,
  canStart,
  canShutdown,
  handleBatchAction,
  setShowPrefModal,
  setShowResModal,
  fetchDomains,
  setIsCreatingFolder,
  onCreateVm,
}: SidebarHeaderProps) => {
  return (
    <>
      <div className="sidebar-header">
        <div className="brand-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="brand">
            <span className="logo-icon">🚢</span>
            <div>
              <h1>Vessel</h1>
              <p className="subtitle">{t("brand_subtitle")}</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button
              className="btn-theme"
              onClick={() => {
                setShowResModal(true);
              }}
              title={t("btn_resources")}
            >
              🔌
            </button>
            <button
              className="btn-theme"
              onClick={() => {
                setShowPrefModal(true);
              }}
              title={t("btn_settings")}
            >
              ⚙️
            </button>
          </div>
        </div>
        <div className="status-badge">
          <span className="status-dot"></span>
          <span>{t("conn_connected")}</span>
        </div>

        {/* Batch Actions Bar under connection status */}
        <div className="batch-actions-bar">
          <button
            className="btn-batch btn-start"
            onClick={() => handleBatchAction("start_domain")}
            disabled={isAnyActionLoading || !canStart}
            title={t("btn_start")}
          >
            <span className="btn-icon">▶</span> {t("btn_start")}
          </button>
          <button
            className="btn-batch btn-stop"
            onClick={() => handleBatchAction("shutdown_domain")}
            disabled={isAnyActionLoading || !canShutdown}
            title={t("btn_stop")}
          >
            <span className="btn-icon">■</span> {t("btn_stop")}
          </button>
        </div>
      </div>

      {/* Mini Stats Summary */}
      <div className="stats-summary">
        <div className="stat-item">
          <span className="stat-val">{totalCount}</span>
          <span className="stat-lbl">{t("stats_total")}</span>
        </div>
        <div className="stat-item">
          <span className="stat-val" style={{ color: "#10B981" }}>
            {runningCount}
          </span>
          <span className="stat-lbl">{t("stats_active")}</span>
        </div>
        <div className="stat-item">
          <span className="stat-val" style={{ color: "#EF4444" }}>
            {stoppedCount}
          </span>
          <span className="stat-lbl">{t("stats_stopped")}</span>
        </div>
      </div>

      {/* List Controls */}
      <div className="list-controls">
        <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
          <button
            className="btn-create-vm-list"
            onClick={onCreateVm}
            title={t("btn_create_vm")}
          >
            + VM
          </button>
          <button
            className="btn-add-folder-trigger"
            onClick={() => setIsCreatingFolder((prev) => !prev)}
            title={t("btn_add_folder")}
          >
            📁⁺
          </button>
          <button
            className={`btn-refresh ${loading ? "loading" : ""}`}
            onClick={() => fetchDomains()}
            disabled={loading}
            title="Refresh list"
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
        </div>
      </div>
    </>
  );
};
