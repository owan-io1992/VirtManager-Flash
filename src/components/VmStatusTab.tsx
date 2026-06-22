import { MiniLineChart } from "./MiniLineChart";
import { DomainItem } from "../types";

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
}

// Libvirt states mapping helper
const getStateInfo = (stateNum: number) => {
  switch (stateNum) {
    case 1:
      return { label: "Running", className: "running" };
    case 3:
      return { label: "Paused", className: "paused" };
    case 5:
      return { label: "Stopped", className: "stopped" };
    default:
      return { label: "Offline", className: "stopped" };
  }
};

export const VmStatusTab = ({
  selectedVm,
  formatMemory,
  metricsHistory,
  cpuUsage,
  theme,
  lang,
}: VmStatusTabProps) => {
  const stateInfo = getStateInfo(selectedVm.state);

  return (
    <>
      <div className="details-header">
        <div className="details-title-area">
          <span className="details-name">{selectedVm.name}</span>
          <span className="details-type">
            {selectedVm.os_type.toLowerCase().includes("hvm")
              ? "KVM Virtual Machine"
              : "LXC Linux Container"}
          </span>
        </div>
        <span className={`state-badge ${stateInfo.className}`}>
          <span className="badge-dot"></span>
          {stateInfo.label}
        </span>
      </div>

      {/* Resources Section */}
      <div className="resources-grid">
        <div className="resource-card">
          <span className="resource-card-label">vCPU Cores</span>
          <span className="resource-card-val">{selectedVm.vcpu_count} Cores</span>
        </div>
        <div className="resource-card">
          <span className="resource-card-label">Max Memory</span>
          <span className="resource-card-val">{formatMemory(selectedVm.max_mem)}</span>
        </div>
      </div>

      {/* Real-Time Metrics */}
      <div className="metrics-section">
        <div className="metric-card">
          <MiniLineChart 
            data={(metricsHistory[selectedVm.name] || []).map(p => p.cpu)}
            timestamps={(metricsHistory[selectedVm.name] || []).map(p => p.timestamp)}
            color={theme === "dark" ? "#24C6DC" : "#0891B2"}
            gradientId="cpuHistoryGrad"
            label="CPU"
            currentValue={selectedVm.state === 1 ? `${(cpuUsage[selectedVm.name] || 0).toFixed(1)}%` : "0.0%"}
            lang={lang}
          />
        </div>

        <div className="metric-card">
          <MiniLineChart 
            data={(metricsHistory[selectedVm.name] || []).map(p => p.memoryPercent)}
            timestamps={(metricsHistory[selectedVm.name] || []).map(p => p.timestamp)}
            hoverLabels={(metricsHistory[selectedVm.name] || []).map(p => 
              selectedVm.state === 1 && p.memoryUsedKb > 0
                ? `${formatMemory(p.memoryUsedKb)} / ${formatMemory(p.memoryMaxKb)} (${p.memoryPercent.toFixed(1)}%)`
                : `0 MB / ${formatMemory(p.memoryMaxKb)} (0.0%)`
            )}
            color={theme === "dark" ? "#A855F7" : "#C084FC"}
            gradientId="memHistoryGrad"
            label="Memory"
            currentValue={selectedVm.state === 1 
              ? `${formatMemory(selectedVm.memory)} / ${formatMemory(selectedVm.max_mem)} (${selectedVm.max_mem > 0 ? ((selectedVm.memory / selectedVm.max_mem) * 100).toFixed(1) : "0.0"}%)`
              : `0 MB / ${formatMemory(selectedVm.max_mem)} (0.0%)`
            }
            lang={lang}
          />
        </div>
      </div>
    </>
  );
};
