import { DomainItem } from "../types";
import { TranslationKey } from "../translations";

interface VmBatchViewProps {
  selectedVmNames: string[];
  selectedDoms: DomainItem[];
  totalCores: number;
  totalMemory: number;
  formatMemory: (kb: number) => string;
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
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

export const VmBatchView = ({
  selectedVmNames,
  selectedDoms,
  totalCores,
  totalMemory,
  formatMemory,
  t,
}: VmBatchViewProps) => {
  return (
    <div className="multi-select-view">
      <div className="details-header">
        <div className="details-title-area">
          <span className="details-name">{t("selected_envs", { count: selectedVmNames.length })}</span>
          <span className="details-type">{t("batch_mode")}</span>
        </div>
      </div>

      {/* Resource Totals */}
      <div className="resources-grid">
        <div className="resource-card">
          <span className="resource-card-label">{t("total_vcpu")}</span>
          <span className="resource-card-val">{totalCores} {t("cores")}</span>
        </div>
        <div className="resource-card">
          <span className="resource-card-label">{t("total_mem")}</span>
          <span className="resource-card-val">{formatMemory(totalMemory)}</span>
        </div>
      </div>

      {/* List of Selected VMs */}
      <div className="selected-vms-list-header">{t("selected_vms")}</div>
      <div className="selected-vms-list">
        {selectedDoms.map((d) => (
          <div key={d.name} className="selected-vm-row">
            <span>{d.name}</span>
            <span className={`state-badge ${getStateClass(d.state)}`} style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}>
              <span className="badge-dot"></span>
              {t(getStateKey(d.state))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
