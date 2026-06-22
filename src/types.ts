export interface DomainItem {
  name: string;
  id: number | null;
  state: number;
  max_mem: number;
  memory: number;
  vcpu_count: number;
  os_type: string;
  cpu_time: number;
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
