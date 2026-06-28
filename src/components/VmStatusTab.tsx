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
      timestamp: number;
    }[];
  };
  cpuUsage: { [name: string]: number };
  theme: "dark" | "light";
  lang: "zh" | "en";
  guestAgentAvailable: boolean;
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

export const VmStatusTab = ({
  selectedVm,
  formatMemory,
  metricsHistory,
  cpuUsage,
  theme,
  lang: _lang,
  guestAgentAvailable,
  t,
}: VmStatusTabProps) => {
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
      <div className="metrics-section">
        <div className="metric-card">
          <MiniLineChart
            data={(metricsHistory[selectedVm.name] || []).map(p => p.cpu)}
            timestamps={(metricsHistory[selectedVm.name] || []).map(p => p.timestamp)}
            color={theme === "dark" ? "#24C6DC" : "#0891B2"}
            gradientId="cpuHistoryGrad"
            label={t("cpu_usage")}
            currentValue={`${(cpuUsage[selectedVm.name] || 0).toFixed(1)}%`}
            lang={_lang}
          />
        </div>

        <div className="metric-card">
          <MiniLineChart
            data={(metricsHistory[selectedVm.name] || []).map(p => p.memoryPercent)}
            timestamps={(metricsHistory[selectedVm.name] || []).map(p => p.timestamp)}
            hoverLabels={(metricsHistory[selectedVm.name] || []).map(p =>
              p.memoryUsedKb > 0
                ? `${formatMemory(p.memoryUsedKb)} / ${formatMemory(p.memoryMaxKb)} (${p.memoryPercent.toFixed(1)}%)`
                : `0 MB / ${formatMemory(p.memoryMaxKb)} (0.0%)`
            )}
            color={theme === "dark" ? "#A855F7" : "#C084FC"}
            gradientId="memHistoryGrad"
            label={t("memory_usage")}
            currentValue={`${formatMemory(selectedVm.memory)} / ${formatMemory(selectedVm.max_mem)} (${selectedVm.max_mem > 0 ? ((selectedVm.memory / selectedVm.max_mem) * 100).toFixed(1) : "0.0"}%)`}
            lang={_lang}
          />
        </div>
      </div>
    </>
  );
};
