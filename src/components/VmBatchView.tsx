import { DomainItem } from "../types";

interface VmBatchViewProps {
  selectedVmNames: string[];
  selectedDoms: DomainItem[];
  totalCores: number;
  totalMemory: number;
  formatMemory: (kb: number) => string;
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

export const VmBatchView = ({
  selectedVmNames,
  selectedDoms,
  totalCores,
  totalMemory,
  formatMemory,
}: VmBatchViewProps) => {
  return (
    <div className="multi-select-view">
      <div className="details-header">
        <div className="details-title-area">
          <span className="details-name">批次選取 ({selectedVmNames.length} 台環境)</span>
          <span className="details-type">Batch Control Mode</span>
        </div>
      </div>

      {/* Resource Totals */}
      <div className="resources-grid">
        <div className="resource-card">
          <span className="resource-card-label">總計 vCPU 核心</span>
          <span className="resource-card-val">{totalCores} Cores</span>
        </div>
        <div className="resource-card">
          <span className="resource-card-label">總計配置記憶體</span>
          <span className="resource-card-val">{formatMemory(totalMemory)}</span>
        </div>
      </div>

      {/* List of Selected VMs */}
      <div className="selected-vms-list-header">已選取的虛擬機：</div>
      <div className="selected-vms-list">
        {selectedDoms.map((d) => {
          const stateInfo = getStateInfo(d.state);
          return (
            <div key={d.name} className="selected-vm-row">
              <span>{d.name}</span>
              <span className={`state-badge ${stateInfo.className}`} style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}>
                <span className="badge-dot"></span>
                {stateInfo.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
