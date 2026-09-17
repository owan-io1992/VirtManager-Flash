import { useMemo } from "react";
import { MultiLineChart, ChartSeries } from "./MultiLineChart";
import { DomainItem } from "../types";
import { TranslationKey } from "../translations";

interface MetricPoint {
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
}

interface VmBatchViewProps {
  selectedVmNames: string[];
  selectedDoms: DomainItem[];
  totalCores: number;
  totalMemory: number;
  formatMemory: (kb: number) => string;
  metricsHistory: { [vmName: string]: MetricPoint[] };
  cpuUsage: { [name: string]: number };
  lang: "zh" | "en";
  metricsEnabled: boolean;
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

// Stable, high-contrast colors cycled per selected VM so the same VM keeps the
// same color across the CPU/memory/disk/network charts.
const VM_COLOR_PALETTE = [
  "#24C6DC", "#A855F7", "#10B981", "#F59E0B",
  "#EC4899", "#6366F1", "#F97316", "#14B8A6",
  "#F43F5E", "#84CC16",
];

const EMPTY_HISTORY: never[] = [];

export const VmBatchView = ({
  selectedVmNames,
  selectedDoms,
  totalCores,
  totalMemory,
  formatMemory,
  metricsHistory,
  cpuUsage,
  lang,
  metricsEnabled,
  t,
}: VmBatchViewProps) => {
  const vmColors = useMemo(() => {
    const map: { [name: string]: string } = {};
    selectedDoms.forEach((d, i) => {
      map[d.name] = VM_COLOR_PALETTE[i % VM_COLOR_PALETTE.length];
    });
    return map;
  }, [selectedDoms]);

  const lastPointByVm = useMemo(() => {
    const map: { [name: string]: MetricPoint | undefined } = {};
    selectedDoms.forEach((d) => {
      const hist = metricsHistory[d.name] || EMPTY_HISTORY;
      map[d.name] = hist[hist.length - 1];
    });
    return map;
  }, [selectedDoms, metricsHistory]);

  const cpuSeries: ChartSeries[] = useMemo(() => selectedDoms.map((d) => {
    const hist = metricsHistory[d.name] || EMPTY_HISTORY;
    return {
      name: d.name,
      color: vmColors[d.name],
      data: hist.map((p) => p.cpu),
      timestamps: hist.map((p) => p.timestamp),
      currentValue: `${(cpuUsage[d.name] || 0).toFixed(1)}%`,
    };
  }), [selectedDoms, metricsHistory, cpuUsage, vmColors]);

  const memSeries: ChartSeries[] = useMemo(() => selectedDoms.map((d) => {
    const hist = metricsHistory[d.name] || EMPTY_HISTORY;
    const pct = d.max_mem > 0 ? (d.memory / d.max_mem) * 100 : 0;
    return {
      name: d.name,
      color: vmColors[d.name],
      data: hist.map((p) => p.memoryPercent),
      timestamps: hist.map((p) => p.timestamp),
      currentValue: `${formatMemory(d.memory)} / ${formatMemory(d.max_mem)} (${pct.toFixed(1)}%)`,
    };
  }), [selectedDoms, metricsHistory, formatMemory, vmColors]);

  const diskSeries: ChartSeries[] = useMemo(() => selectedDoms.map((d) => {
    const hist = metricsHistory[d.name] || EMPTY_HISTORY;
    const last = lastPointByVm[d.name];
    return {
      name: d.name,
      color: vmColors[d.name],
      data: hist.map((p) => p.diskReadSpeed + p.diskWriteSpeed),
      timestamps: hist.map((p) => p.timestamp),
      currentValue: `R: ${formatSpeed(last?.diskReadSpeed || 0)} | W: ${formatSpeed(last?.diskWriteSpeed || 0)}`,
    };
  }), [selectedDoms, metricsHistory, lastPointByVm, vmColors]);

  const netSeries: ChartSeries[] = useMemo(() => selectedDoms.map((d) => {
    const hist = metricsHistory[d.name] || EMPTY_HISTORY;
    const last = lastPointByVm[d.name];
    return {
      name: d.name,
      color: vmColors[d.name],
      data: hist.map((p) => p.netRxSpeed + p.netTxSpeed),
      timestamps: hist.map((p) => p.timestamp),
      currentValue: `RX: ${formatSpeed(last?.netRxSpeed || 0)} | TX: ${formatSpeed(last?.netTxSpeed || 0)}`,
    };
  }), [selectedDoms, metricsHistory, lastPointByVm, vmColors]);

  const runningDoms = selectedDoms.filter((d) => d.state === 1);
  const currentCpuAvg = runningDoms.length > 0
    ? runningDoms.reduce((acc, d) => acc + (cpuUsage[d.name] || 0), 0) / runningDoms.length
    : 0;
  const currentMemUsed = selectedDoms.reduce((acc, d) => acc + d.memory, 0);
  const currentMemMax = selectedDoms.reduce((acc, d) => acc + d.max_mem, 0);
  const currentDiskRead = selectedDoms.reduce((acc, d) => acc + (lastPointByVm[d.name]?.diskReadSpeed || 0), 0);
  const currentDiskWrite = selectedDoms.reduce((acc, d) => acc + (lastPointByVm[d.name]?.diskWriteSpeed || 0), 0);
  const currentNetRx = selectedDoms.reduce((acc, d) => acc + (lastPointByVm[d.name]?.netRxSpeed || 0), 0);
  const currentNetTx = selectedDoms.reduce((acc, d) => acc + (lastPointByVm[d.name]?.netTxSpeed || 0), 0);

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
          <span className="resource-card-val">
            {totalCores} {totalCores === 1 ? "vCPU" : "vCPUs"}
          </span>
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

      {/* Per-VM Real-Time Metrics */}
      {metricsEnabled ? (
        <div className="metrics-section">
          <div className="metric-card">
            <MultiLineChart
              series={cpuSeries}
              label={t("cpu_usage")}
              headerValue={`${currentCpuAvg.toFixed(1)}%`}
              lang={lang}
              maxVal={100}
            />
          </div>

          <div className="metric-card">
            <MultiLineChart
              series={memSeries}
              label={t("memory_usage")}
              headerValue={`${formatMemory(currentMemUsed)} / ${formatMemory(currentMemMax)} (${currentMemMax > 0 ? ((currentMemUsed / currentMemMax) * 100).toFixed(1) : "0.0"}%)`}
              lang={lang}
              maxVal={100}
            />
          </div>

          <div className="metric-card">
            <MultiLineChart
              series={diskSeries}
              label={t("disk_io_throughput")}
              headerValue={`R: ${formatSpeed(currentDiskRead)} | W: ${formatSpeed(currentDiskWrite)}`}
              lang={lang}
              yLabelFormatter={formatSpeed}
            />
          </div>

          <div className="metric-card">
            <MultiLineChart
              series={netSeries}
              label={t("net_io_throughput")}
              headerValue={`RX: ${formatSpeed(currentNetRx)} | TX: ${formatSpeed(currentNetTx)}`}
              lang={lang}
              yLabelFormatter={formatSpeed}
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
    </div>
  );
};
