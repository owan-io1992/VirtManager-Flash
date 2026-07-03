import { useMemo } from "react";
import { MiniLineChart } from "./MiniLineChart";
import { DomainItem } from "../types";
import { TranslationKey } from "../translations";

interface VmStatusTabProps {
  selectedVm: DomainItem;
  formatMemory: (kb: number) => string;
  metricsHistory: {
    [vmName: string]: {
      cpu: number;
      memoryPercent: number;
      memoryUsedKb: number;
      memoryMaxKb: number;
      diskReadSpeed: number;
      diskWriteSpeed: number;
      diskReadIops: number;
      diskWriteIops: number;
      netRxSpeed: number;
      netTxSpeed: number;
      netRxPackets: number;
      netTxPackets: number;
      timestamp: number;
    }[];
  };
  cpuUsage: { [name: string]: number };
  theme: "dark" | "light" | "sketch";
  lang: "zh" | "en";
  guestAgentAvailable: boolean;
  metricsEnabled: boolean;
  t: (key: TranslationKey) => string;
}

const getStateKey = (stateNum: number): TranslationKey => {
  switch (stateNum) {
    case 1: return "state_running";
    case 3: return "state_paused";
    case 5: return "state_stopped";
    default: return "state_offline";
  }
};

const getStateClass = (stateNum: number) => {
  switch (stateNum) {
    case 1: return "running";
    case 3: return "paused";
    default: return "stopped";
  }
};

const formatSpeed = (bytesPerSec: number): string => {
  if (bytesPerSec >= 1024 * 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
  }
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSec >= 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  }
  return `${bytesPerSec.toFixed(0)} B/s`;
};

const formatIops = (val: number): string => {
  if (val >= 1000) {
    return `${(val / 1000).toFixed(1)}k`;
  }
  return val.toFixed(1);
};

const EMPTY_HISTORY: never[] = [];

export const VmStatusTab = ({
  selectedVm,
  formatMemory,
  metricsHistory,
  cpuUsage,
  theme,
  lang: _lang,
  guestAgentAvailable,
  metricsEnabled,
  t,
}: VmStatusTabProps) => {
  const history = metricsHistory[selectedVm.name] || EMPTY_HISTORY;
  const lastPoint = history[history.length - 1];

  // Derived chart series, recomputed only when a new sample arrives —
  // not on unrelated re-renders (theme/selection/hover)
  const timestamps = useMemo(() => history.map((p) => p.timestamp), [history]);
  const cpuData = useMemo(() => history.map((p) => p.cpu), [history]);
  const memData = useMemo(() => history.map((p) => p.memoryPercent), [history]);
  const diskSpeedData = useMemo(() => history.map((p) => p.diskReadSpeed + p.diskWriteSpeed), [history]);
  const diskIopsData = useMemo(() => history.map((p) => p.diskReadIops + p.diskWriteIops), [history]);
  const netSpeedData = useMemo(() => history.map((p) => p.netRxSpeed + p.netTxSpeed), [history]);
  const netPacketsData = useMemo(() => history.map((p) => p.netRxPackets + p.netTxPackets), [history]);

  const currentDiskRead = lastPoint ? lastPoint.diskReadSpeed : 0;
  const currentDiskWrite = lastPoint ? lastPoint.diskWriteSpeed : 0;
  const currentDiskReadIops = lastPoint ? lastPoint.diskReadIops : 0;
  const currentDiskWriteIops = lastPoint ? lastPoint.diskWriteIops : 0;

  const currentNetRx = lastPoint ? lastPoint.netRxSpeed : 0;
  const currentNetTx = lastPoint ? lastPoint.netTxSpeed : 0;
  const currentNetRxPackets = lastPoint ? lastPoint.netRxPackets : 0;
  const currentNetTxPackets = lastPoint ? lastPoint.netTxPackets : 0;

  return (
    <>
      <div className="details-header">
        <div className="details-title-area">
          <span className="details-name">{selectedVm.name}</span>
          <span className="details-type">
            {selectedVm.os_type.toLowerCase().includes("hvm")
              ? t("vm_type_kvm_full")
              : t("vm_type_lxc_full")}
          </span>
        </div>
        <span className={`state-badge ${getStateClass(selectedVm.state)}`}>
          <span className="badge-dot"></span>
          {t(getStateKey(selectedVm.state))}
        </span>
      </div>

      {/* Resources Section */}
      <div className="resources-grid">
        <div className="resource-card">
          <span className="resource-card-label">{t("vcpu_cores")}</span>
          <span className="resource-card-val">{selectedVm.vcpu_count} {t("cores")}</span>
        </div>
        <div className="resource-card">
          <span className="resource-card-label">{t("max_memory")}</span>
          <span className="resource-card-val">{formatMemory(selectedVm.max_mem)}</span>
        </div>
      </div>

      {/* Guest agent warning — only shown when VM is running but agent is unavailable */}
      {selectedVm.state === 1 && !guestAgentAvailable && (
        <div className="guest-agent-warning">
          <span className="guest-agent-warning-icon">⚠</span>
          <span>{t("guest_agent_warning")}</span>
        </div>
      )}

      {/* Real-Time Metrics */}
      {metricsEnabled ? (
        <div className="metrics-section">
          <div className="metric-card">
            <MiniLineChart
              data={cpuData}
              timestamps={timestamps}
              color={theme === "dark" ? "#24C6DC" : "#0891B2"}
              gradientId="cpuHistoryGrad"
              label={t("cpu_usage")}
              currentValue={`${(cpuUsage[selectedVm.name] || 0).toFixed(1)}%`}
              lang={_lang}
            />
          </div>

          <div className="metric-card">
            <MiniLineChart
              data={memData}
              timestamps={timestamps}
              getHoverLabel={(i) => {
                const p = history[i];
                return p.memoryUsedKb > 0
                  ? `${formatMemory(p.memoryUsedKb)} / ${formatMemory(p.memoryMaxKb)} (${p.memoryPercent.toFixed(1)}%)`
                  : `0 MB / ${formatMemory(p.memoryMaxKb)} (0.0%)`;
              }}
              color={theme === "dark" ? "#A855F7" : "#C084FC"}
              gradientId="memHistoryGrad"
              label={t("memory_usage")}
              currentValue={`${formatMemory(selectedVm.memory)} / ${formatMemory(selectedVm.max_mem)} (${selectedVm.max_mem > 0 ? ((selectedVm.memory / selectedVm.max_mem) * 100).toFixed(1) : "0.0"}%)`}
              lang={_lang}
            />
          </div>

          <div className="metric-card">
            <MiniLineChart
              data={diskSpeedData}
              timestamps={timestamps}
              getHoverLabel={(i) =>
                `R: ${formatSpeed(history[i].diskReadSpeed)} | W: ${formatSpeed(history[i].diskWriteSpeed)}`
              }
              color={theme === "dark" ? "#10B981" : "#059669"}
              gradientId="diskSpeedHistoryGrad"
              label={t("disk_io_throughput")}
              currentValue={`R: ${formatSpeed(currentDiskRead)} | W: ${formatSpeed(currentDiskWrite)}`}
              lang={_lang}
              yLabelFormatter={formatSpeed}
            />
          </div>

          <div className="metric-card">
            <MiniLineChart
              data={diskIopsData}
              timestamps={timestamps}
              getHoverLabel={(i) =>
                `R: ${formatIops(history[i].diskReadIops)} | W: ${formatIops(history[i].diskWriteIops)} IOPS`
              }
              color={theme === "dark" ? "#F59E0B" : "#D97706"}
              gradientId="diskIopsHistoryGrad"
              label={t("disk_io_iops")}
              currentValue={`R: ${formatIops(currentDiskReadIops)} | W: ${formatIops(currentDiskWriteIops)} IOPS`}
              lang={_lang}
              yLabelFormatter={formatIops}
            />
          </div>

          <div className="metric-card">
            <MiniLineChart
              data={netSpeedData}
              timestamps={timestamps}
              getHoverLabel={(i) =>
                `RX: ${formatSpeed(history[i].netRxSpeed)} | TX: ${formatSpeed(history[i].netTxSpeed)}`
              }
              color={theme === "dark" ? "#3B82F6" : "#2563EB"}
              gradientId="netSpeedHistoryGrad"
              label={t("net_io_throughput")}
              currentValue={`RX: ${formatSpeed(currentNetRx)} | TX: ${formatSpeed(currentNetTx)}`}
              lang={_lang}
              yLabelFormatter={formatSpeed}
            />
          </div>

          <div className="metric-card">
            <MiniLineChart
              data={netPacketsData}
              timestamps={timestamps}
              getHoverLabel={(i) =>
                `RX: ${formatIops(history[i].netRxPackets)} | TX: ${formatIops(history[i].netTxPackets)} Pkts/s`
              }
              color={theme === "dark" ? "#EC4899" : "#DB2777"}
              gradientId="netPacketsHistoryGrad"
              label={t("net_io_packets")}
              currentValue={`RX: ${formatIops(currentNetRxPackets)} | TX: ${formatIops(currentNetTxPackets)} Pkts/s`}
              lang={_lang}
              yLabelFormatter={formatIops}
            />
          </div>
        </div>
      ) : (
        <div className="metrics-disabled-card" style={{
          marginTop: "1.5rem",
          padding: "2rem",
          textAlign: "center",
          background: "var(--bg-card, rgba(30, 41, 59, 0.5))",
          border: "1px dashed var(--border-color, rgba(148, 163, 184, 0.3))",
          borderRadius: "12px",
          color: "var(--text-muted, #94A3B8)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.75rem"
        }}>
          <div style={{ fontSize: "2.5rem" }}>📊</div>
          <p style={{ margin: 0, fontSize: "0.95rem", maxWidth: "450px", lineHeight: "1.5" }}>
            {t("metrics_disabled_msg")}
          </p>
        </div>
      )}
    </>
  );
};
