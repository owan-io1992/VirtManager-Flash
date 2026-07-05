export interface DomainItem {
  name: string;
  id: number | null;
  state: number;
  max_mem: number;
  memory: number;
  vcpu_count: number;
  os_type: string;
  cpu_time: number;
  disk_rd_req: number;
  disk_rd_bytes: number;
  disk_wr_req: number;
  disk_wr_bytes: number;
  net_rx_bytes: number;
  net_rx_packets: number;
  net_tx_bytes: number;
  net_tx_packets: number;
}

export interface DiskInfo {
  target_dev: string;
  path: string;
  capacity_gb: number;
  bus: string;
  device: string;
}

export interface NicInfo {
  mac: string;
  source: string;
  source_type: string;
  model: string;
}

export interface VmSettings {
  name: string;
  vcpu: number;
  current_mem_kb: number;
  max_mem_kb: number;
  cpu_sockets: number;
  cpu_cores: number;
  cpu_threads: number;
  os_label: string;
  os_arch: string;
  os_machine: string;
  os_type: string;
  boot_devices: string[];
  boot_menu: boolean;
  graphics_type: string;
  video_model: string;
  autostart: boolean;
  disks: DiskInfo[];
  nics: NicInfo[];
  secure_boot: boolean;
  tpm: boolean;
  filesystems: FilesystemInfo[];
}

export interface FilesystemInfo {
  source_dir: string;
  target_dir: string;
  readonly: boolean;
  driver: string; // "9p" | "virtiofs"
}

export interface Folder {
  id: string;
  name: string;
  collapsed: boolean;
  vmNames: string[];
}

export interface SystemResources {
  cpu_cores: number;
  cpu_threads: number;
  mem_total_kb: number;
  mem_available_kb: number;
  os_platform: string;
}

export interface NetworkItem {
  id: string;
  name: string;
  device: string;
  state: string;
  autostart: boolean;
  subnet: string;
  dhcp_start: string;
  dhcp_end: string;
  forwarding: string;
}

export interface VolumeItem {
  name: string;
  size: string;
  format: string;
  used_by: string;
}

export interface StoragePoolItem {
  id: string;
  name: string;
  pool_type: string;
  size_gb: number;
  used_gb: number;
  location: string;
  state: string;
  autostart: boolean;
  volumes: VolumeItem[];
}

export interface SnapshotItem {
  name: string;
  description: string;
  creation_time: number;
  state: string;
  parent: string | null;
  is_current: boolean;
}

export const parseSizeToGb = (sizeStr: string): number => {
  if (!sizeStr) return 0;
  const match = sizeStr.trim().match(/^([\d.]+)\s*([a-zA-Z]+)$/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "gib" || unit === "gb") {
    return val;
  } else if (unit === "mib" || unit === "mb") {
    return val / 1024;
  } else if (unit === "kib" || unit === "kb") {
    return val / (1024 * 1024);
  } else if (unit === "b") {
    return val / (1024 * 1024 * 1024);
  }
  return val;
};

export const parseSizeAndUnit = (sizeStr: string): { value: number; unit: string } => {
  if (!sizeStr) return { value: 0, unit: "GB" };
  const match = sizeStr.trim().match(/^([\d.]+)\s*([a-zA-Z]+)$/);
  if (!match) return { value: 0, unit: "GB" };
  const val = parseFloat(match[1]);
  const unit = match[2];
  return { value: val, unit };
};



