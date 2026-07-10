use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct DomainItem {
    pub name: String,
    pub id: Option<u32>,
    pub state: u8,
    pub max_mem: u64,
    pub memory: u64,
    pub vcpu_count: u32,
    pub os_type: String,
    pub cpu_time: u64,
    pub disk_rd_req: i64,
    pub disk_rd_bytes: i64,
    pub disk_wr_req: i64,
    pub disk_wr_bytes: i64,
    pub net_rx_bytes: i64,
    pub net_rx_packets: i64,
    pub net_tx_bytes: i64,
    pub net_tx_packets: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DiskInfo {
    pub target_dev: String, // vda, sda, hdc...
    pub path: String,
    pub capacity_gb: u64,
    pub bus: String,
    pub device: String, // disk / cdrom
}

#[derive(Serialize, Deserialize, Clone)]
pub struct NicInfo {
    pub mac: String,
    pub source: String,
    pub source_type: String, // network / bridge
    pub model: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FilesystemInfo {
    pub source_dir: String,
    pub target_dir: String,
    pub readonly: bool,
    pub driver: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VmSettings {
    pub name: String,
    pub vcpu: u32,
    pub current_mem_kb: u64,
    pub max_mem_kb: u64,
    pub cpu_sockets: u32,
    pub cpu_cores: u32,
    pub cpu_threads: u32,
    pub os_label: String,   // friendly guest OS (from libosinfo metadata) or empty
    pub os_arch: String,    // e.g. x86_64
    pub os_machine: String, // e.g. pc-q35-7.2
    pub os_type: String,    // VirtManager-Flash OS family: linux / windows / other
    pub boot_devices: Vec<String>,
    pub boot_menu: bool,
    pub graphics_type: String,
    pub video_model: String,
    pub autostart: bool,
    pub disks: Vec<DiskInfo>,
    pub nics: Vec<NicInfo>,
    pub secure_boot: bool,
    pub tpm: bool,
    pub filesystems: Vec<FilesystemInfo>,
    pub shared_memory: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SnapshotItem {
    pub name: String,
    pub description: String,
    pub creation_time: i64,
    pub state: String,
    pub parent: Option<String>,
    pub is_current: bool,
}
