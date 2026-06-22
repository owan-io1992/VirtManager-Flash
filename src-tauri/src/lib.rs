use serde::{Serialize, Deserialize};
use virt::connect::Connect;
use virt::domain::Domain;
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader};

use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;

#[derive(Serialize, Deserialize, Clone)]
struct DomainItem {
    name: String,
    id: Option<u32>,
    state: u8,
    max_mem: u64,
    memory: u64,
    vcpu_count: u32,
    os_type: String,
    cpu_time: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct SystemResources {
    cpu_cores: u32,
    cpu_threads: u32,
    mem_total_kb: u64,
    mem_available_kb: u64,
    os_platform: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct NetworkItem {
    id: String,
    name: String,
    device: String,
    state: String,
    autostart: bool,
    subnet: String,
    dhcp_start: String,
    dhcp_end: String,
    forwarding: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct VolumeItem {
    name: String,
    size: String,
    format: String,
    used_by: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct StoragePoolItem {
    id: String,
    name: String,
    pool_type: String,
    size_gb: u64,
    used_gb: u64,
    location: String,
    state: String,
    autostart: bool,
    volumes: Vec<VolumeItem>,
}

fn extract_xml_tag_attr(xml: &str, tag_prefix: &str, attr: &str) -> Option<String> {
    if let Some(idx) = xml.find(tag_prefix) {
        let tag_block = &xml[idx..];
        let search_str = format!("{}='", attr);
        if let Some(attr_idx) = tag_block.find(&search_str) {
            let start = attr_idx + search_str.len();
            if let Some(end_idx) = tag_block[start..].find("'") {
                return Some(tag_block[start..start + end_idx].to_string());
            }
        }
        let search_str_double = format!("{}=\"", attr);
        if let Some(attr_idx) = tag_block.find(&search_str_double) {
            let start = attr_idx + search_str_double.len();
            if let Some(end_idx) = tag_block[start..].find("\"") {
                return Some(tag_block[start..start + end_idx].to_string());
            }
        }
    }
    None
}

#[tauri::command]
fn list_networks() -> Result<Vec<NetworkItem>, String> {
    let conn = connect_libvirt()?;
    let nets = conn.list_all_networks(0)
        .map_err(|e| format!("Failed to list networks: {}", e))?;
    
    let mut list = Vec::new();
    for net in nets {
        let name = net.get_name().unwrap_or_else(|_| "unknown".to_string());
        let device = net.get_bridge_name().unwrap_or_else(|_| "unknown".to_string());
        let is_active = net.is_active().unwrap_or(false);
        let autostart = net.get_autostart().unwrap_or(false);
        
        let state = if is_active { "active".to_string() } else { "inactive".to_string() };
        
        let xml = net.get_xml_desc(0).unwrap_or_default();
        
        let ip_addr = extract_xml_tag_attr(&xml, "<ip address='", "address")
            .or_else(|| extract_xml_tag_attr(&xml, "<ip address=\"", "address"));
            
        let prefix = extract_xml_tag_attr(&xml, "prefix='", "prefix")
            .or_else(|| extract_xml_tag_attr(&xml, "prefix=\"", "prefix"))
            .unwrap_or_else(|| "24".to_string());
            
        let subnet = if let Some(ip) = ip_addr {
            if let Some(last_dot) = ip.rfind('.') {
                format!("{}.0/{}", &ip[..last_dot], prefix)
            } else {
                format!("{}/{}", ip, prefix)
            }
        } else {
            "Disabled".to_string()
        };
        
        let dhcp_start = extract_xml_tag_attr(&xml, "<range start='", "start")
            .or_else(|| extract_xml_tag_attr(&xml, "<range start=\"", "start"));
            
        let dhcp_end = extract_xml_tag_attr(&xml, "end='", "end")
            .or_else(|| extract_xml_tag_attr(&xml, "end=\"", "end"));
            
        let (start, end) = match (dhcp_start, dhcp_end) {
            (Some(s), Some(e)) => (s, e),
            _ => ("Disabled".to_string(), "Disabled".to_string()),
        };
        
        let fwd_mode = extract_xml_tag_attr(&xml, "<forward mode='", "mode")
            .or_else(|| extract_xml_tag_attr(&xml, "<forward mode=\"", "mode"))
            .map(|m| m.to_uppercase())
            .unwrap_or_else(|| "Isolated".to_string());
            
        list.push(NetworkItem {
            id: name.clone(),
            name,
            device,
            state,
            autostart,
            subnet,
            dhcp_start: start,
            dhcp_end: end,
            forwarding: fwd_mode,
        });
    }
    
    Ok(list)
}

#[tauri::command]
fn list_storage_pools() -> Result<Vec<StoragePoolItem>, String> {
    let conn = connect_libvirt()?;
    let pools = conn.list_all_storage_pools(0)
        .map_err(|e| format!("Failed to list storage pools: {}", e))?;
        
    let mut vm_disks = Vec::new();
    if let Ok(domains) = conn.list_all_domains(0) {
        for dom in domains {
            let vm_name = dom.get_name().unwrap_or_default();
            if let Ok(xml) = dom.get_xml_desc(0) {
                let mut start = 0;
                while let Some(idx) = xml[start..].find("<source file='") {
                    let abs_idx = start + idx;
                    let tag_block = &xml[abs_idx..];
                    if let Some(end_quote) = tag_block["<source file='".len()..].find("'") {
                        let path = &tag_block["<source file='".len().."<source file='".len() + end_quote];
                        vm_disks.push((path.to_string(), vm_name.clone()));
                    }
                    start = abs_idx + 1;
                }
                
                start = 0;
                while let Some(idx) = xml[start..].find("<source dev='") {
                    let abs_idx = start + idx;
                    let tag_block = &xml[abs_idx..];
                    if let Some(end_quote) = tag_block["<source dev='".len()..].find("'") {
                        let path = &tag_block["<source dev='".len().."<source dev='".len() + end_quote];
                        vm_disks.push((path.to_string(), vm_name.clone()));
                    }
                    start = abs_idx + 1;
                }
            }
        }
    }
    
    let mut list = Vec::new();
    for pool in pools {
        let name = pool.get_name().unwrap_or_else(|_| "unknown".to_string());
        let is_active = pool.is_active().unwrap_or(false);
        let autostart = pool.get_autostart().unwrap_or(false);
        let state = if is_active { "active".to_string() } else { "inactive".to_string() };
        
        let mut pool_type = "Filesystem Directory".to_string();
        let mut location = "/var/lib/libvirt/images".to_string();
        let xml = pool.get_xml_desc(0).unwrap_or_default();
        
        if let Some(t) = extract_xml_tag_attr(&xml, "<pool type='", "type") {
            pool_type = t;
        }
        
        if let Some(target_idx) = xml.find("<path>") {
            let path_block = &xml[target_idx + 6..];
            if let Some(end_idx) = path_block.find("</path>") {
                location = path_block[..end_idx].to_string();
            }
        }
        
        let mut size_gb = 0;
        let mut used_gb = 0;
        
        if is_active {
            if let Ok(info) = pool.get_info() {
                size_gb = info.capacity / 1024 / 1024 / 1024;
                let free_gb = info.available / 1024 / 1024 / 1024;
                used_gb = size_gb.saturating_sub(free_gb);
            }
        }
        
        let mut volumes = Vec::new();
        if is_active {
            if let Ok(vols) = pool.list_all_volumes(0) {
                for vol in vols {
                    let vol_name = vol.get_name().unwrap_or_else(|_| "unknown".to_string());
                    let vol_path = vol.get_path().unwrap_or_default();
                    
                    let mut cap_str = "0 GiB".to_string();
                    if let Ok(vol_info) = vol.get_info() {
                        let cap_gb = vol_info.capacity as f64 / 1024.0 / 1024.0 / 1024.0;
                        if cap_gb >= 1.0 {
                            cap_str = format!("{:.2} GiB", cap_gb);
                        } else {
                            cap_str = format!("{:.2} MiB", vol_info.capacity as f64 / 1024.0 / 1024.0);
                        }
                    }
                    
                    let mut format = "raw".to_string();
                    let vol_xml_res = vol.get_xml_desc(0);
                    if let Ok(vol_xml) = vol_xml_res {
                        if let Some(f) = extract_xml_tag_attr(&vol_xml, "<format type='", "type") {
                            format = f;
                        }
                    }
                    
                    let mut used_by = "None".to_string();
                    for (disk_path, vm_name) in &vm_disks {
                        if disk_path == &vol_path || disk_path.ends_with(&format!("/{}", vol_name)) {
                            used_by = vm_name.clone();
                            break;
                        }
                    }
                    
                    volumes.push(VolumeItem {
                        name: vol_name,
                        size: cap_str,
                        format,
                        used_by,
                    });
                }
            }
        }
        
        list.push(StoragePoolItem {
            id: name.clone(),
            name,
            pool_type,
            size_gb,
            used_gb,
            location,
            state,
            autostart,
            volumes,
        });
    }
    
    Ok(list)
}

fn parse_cpu_info() -> (u32, u32) {
    let mut threads = 0;
    
    if let Ok(val) = std::thread::available_parallelism() {
        threads = val.get() as u32;
    }
    
    let physical_cores;
    
    if let Ok(file) = File::open("/proc/cpuinfo") {
        let reader = BufReader::new(file);
        let mut physical_ids = HashSet::new();
        let mut cores_per_socket = 0;
        let mut processor_count = 0;
        
        for line in reader.lines().map_while(Result::ok) {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() == 2 {
                let key = parts[0].trim();
                let val = parts[1].trim();
                if key == "processor" {
                    processor_count += 1;
                } else if key == "physical id" {
                    if let Ok(pid) = val.parse::<u32>() {
                        physical_ids.insert(pid);
                    }
                } else if key == "cpu cores" {
                    if let Ok(cores) = val.parse::<u32>() {
                        cores_per_socket = cores;
                    }
                }
            }
        }
        
        if processor_count > 0 {
            threads = processor_count;
        }
        
        let socket_count = if physical_ids.is_empty() { 1 } else { physical_ids.len() as u32 };
        if cores_per_socket > 0 {
            physical_cores = cores_per_socket * socket_count;
        } else {
            physical_cores = (threads / 2).max(1);
        }
    } else {
        physical_cores = (threads / 2).max(1);
    }
    
    (physical_cores, threads)
}

fn parse_mem_info() -> (u64, u64) {
    let mut total_kb = 0;
    let mut available_kb = 0;
    let mut free_kb = 0;
    let mut buffers_kb = 0;
    let mut cached_kb = 0;
    
    if let Ok(file) = File::open("/proc/meminfo") {
        let reader = BufReader::new(file);
        for line in reader.lines().map_while(Result::ok) {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() == 2 {
                let key = parts[0].trim();
                let val_str = parts[1].trim();
                let val = val_str.split_whitespace().next()
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(0);
                    
                if key == "MemTotal" {
                    total_kb = val;
                } else if key == "MemAvailable" {
                    available_kb = val;
                } else if key == "MemFree" {
                    free_kb = val;
                } else if key == "Buffers" {
                    buffers_kb = val;
                } else if key == "Cached" {
                    cached_kb = val;
                }
            }
        }
    }
    
    if available_kb == 0 {
        available_kb = free_kb + buffers_kb + cached_kb;
    }
    
    (total_kb, available_kb)
}

#[tauri::command]
fn get_system_resources() -> Result<SystemResources, String> {
    let (cpu_cores, cpu_threads) = parse_cpu_info();
    let (mem_total_kb, mem_available_kb) = parse_mem_info();
    let os_platform = "Linux (x86_64)".to_string();
    
    Ok(SystemResources {
        cpu_cores,
        cpu_threads,
        mem_total_kb,
        mem_available_kb,
        os_platform,
    })
}

fn connect_libvirt() -> Result<Connect, String> {
    // Try system connection first, then session connection
    Connect::open(Some("qemu:///system"))
        .or_else(|_| Connect::open(Some("qemu:///session")))
        .map_err(|e| format!("Failed to connect to libvirt: {}", e))
}

#[tauri::command]
fn list_domains() -> Result<Vec<DomainItem>, String> {
    let conn = connect_libvirt()?;
    let domains = conn.list_all_domains(0)
        .map_err(|e| format!("Failed to list domains: {}", e))?;
    
    let mut list = Vec::new();
    for dom in domains {
        let name = dom.get_name().unwrap_or_else(|_| "unknown".to_string());
        // get_id returns u32 (active) or standard u32::MAX for inactive. Or it returns Result.
        // Let's check how the crate maps it. If it returns u32 directly or Result.
        // Let's use `dom.get_id()` and check compilation.
        let id = dom.get_id().and_then(|val| {
            if val == 4294967295 {
                None
            } else {
                Some(val)
            }
        });
        
        let os_type = dom.get_os_type().unwrap_or_else(|_| "unknown".to_string());
        
        let mut state = 5u32; // Default shutoff
        let mut max_mem = 0;
        let mut memory = 0;
        let mut vcpu_count = 0;
        let mut cpu_time = 0;
        
        if let Ok(info) = dom.get_info() {
            state = info.state;
            max_mem = info.max_mem;
            memory = info.memory;
            vcpu_count = info.nr_virt_cpu as u32;
            cpu_time = info.cpu_time;
        }

        if max_mem == 0 {
            if let Ok(max_mem_fallback) = dom.get_max_memory() {
                max_mem = max_mem_fallback;
            }
        }

        if state == 1 || state == 3 {
            if let Ok(stats) = dom.memory_stats(0) {
                let mut unused = 0;
                let mut available = 0;
                for stat in stats {
                    if stat.tag == 4 || stat.tag == 8 {
                        unused = stat.val;
                    } else if stat.tag == 5 {
                        available = stat.val;
                    } else if stat.tag == 6 {
                        if available == 0 {
                            available = stat.val;
                        }
                    }
                }
                if available > 0 && available >= unused {
                    memory = available - unused;
                }
            }
        }

        list.push(DomainItem {
            name,
            id,
            state: state as u8,
            max_mem,
            memory,
            vcpu_count,
            os_type,
            cpu_time,
        });
    }
    
    Ok(list)
}

#[tauri::command]
fn start_domain(name: String) -> Result<(), String> {
    let conn = connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.create()
        .map(|_| ())
        .map_err(|e| format!("Failed to start VM: {}", e))
}

#[tauri::command]
fn shutdown_domain(name: String) -> Result<(), String> {
    let conn = connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.shutdown()
        .map(|_| ())
        .map_err(|e| format!("Failed to shutdown VM: {}", e))
}

#[tauri::command]
fn stop_domain(name: String) -> Result<(), String> {
    let conn = connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.destroy()
        .map(|_| ())
        .map_err(|e| format!("Failed to force stop VM: {}", e))
}

#[tauri::command]
fn suspend_domain(name: String) -> Result<(), String> {
    let conn = connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.suspend()
        .map(|_| ())
        .map_err(|e| format!("Failed to suspend VM: {}", e))
}

#[tauri::command]
fn resume_domain(name: String) -> Result<(), String> {
    let conn = connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.resume()
        .map(|_| ())
        .map_err(|e| format!("Failed to resume VM: {}", e))
}

#[tauri::command]
fn reboot_domain(name: String) -> Result<(), String> {
    let conn = connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.reboot(0)
        .map(|_| ())
        .map_err(|e| format!("Failed to reboot VM: {}", e))
}

#[tauri::command]
fn reset_domain(name: String) -> Result<(), String> {
    let conn = connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.reset()
        .map(|_| ())
        .map_err(|e| format!("Failed to reset VM: {}", e))
}

#[tauri::command]
fn open_viewer(name: String) -> Result<(), String> {
    std::process::Command::new("virt-viewer")
        .arg("-c")
        .arg("qemu:///system")
        .arg(&name)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch virt-viewer: {}", e))
}

#[tauri::command]
fn get_vm_spice_port(name: String) -> Result<u16, String> {
    let conn = connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    
    let xml = dom.get_xml_desc(0)
        .map_err(|e| format!("Failed to get VM XML: {}", e))?;
    
    // Check for SPICE graphics port
    if let Some(idx) = xml.find("type='spice'") {
        if let Some(port_start) = xml[idx..].find("port='") {
            let start = idx + port_start + 6;
            if let Some(port_end) = xml[start..].find("'") {
                let port_str = &xml[start..start + port_end];
                if let Ok(p) = port_str.parse::<u16>() {
                    return Ok(p);
                }
            }
        }
    }
    
    // Fallback: check for VNC graphics port
    if let Some(idx) = xml.find("type='vnc'") {
        if let Some(port_start) = xml[idx..].find("port='") {
            let start = idx + port_start + 6;
            if let Some(port_end) = xml[start..].find("'") {
                let port_str = &xml[start..start + port_end];
                if let Ok(p) = port_str.parse::<u16>() {
                    return Ok(p);
                }
            }
        }
    }
    
    Err("No graphics display (SPICE or VNC) found for this VM".to_string())
}

async fn run_proxy_server() {
    let listener = match TcpListener::bind("127.0.0.1:5959").await {
        Ok(l) => l,
        Err(_) => return,
    };
    
    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(async move {
            let target_port = std::sync::Arc::new(std::sync::atomic::AtomicU16::new(5900));
            let port_clone = target_port.clone();
            let callback = move |req: &Request, response: Response| {
                let uri = req.uri();
                let path = uri.path();
                if let Some(port_str) = path.strip_prefix('/') {
                    if let Ok(p) = port_str.parse::<u16>() {
                        port_clone.store(p, std::sync::atomic::Ordering::SeqCst);
                    }
                }
                Ok(response)
            };
            
            let ws_stream = match accept_hdr_async(stream, callback).await {
                Ok(ws) => ws,
                Err(_) => return,
            };
            
            let resolved_port = target_port.load(std::sync::atomic::Ordering::SeqCst);
            let tcp_stream = match TcpStream::connect(format!("127.0.0.1:{}", resolved_port)).await {
                Ok(s) => s,
                Err(_) => return,
            };
            let _ = tcp_stream.set_nodelay(true);
            
            let (mut tcp_read, mut tcp_write) = tcp_stream.into_split();
            let (mut ws_write, mut ws_read) = ws_stream.split();
            
            let ws_to_tcp = async {
                while let Some(Ok(msg)) = ws_read.next().await {
                    if msg.is_binary() || msg.is_text() {
                        let data = msg.into_data();
                        if tcp_write.write_all(&data).await.is_err() {
                            break;
                        }
                    } else if msg.is_close() {
                        break;
                    }
                }
                let _ = tcp_write.shutdown().await;
            };
            
            let tcp_to_ws = async {
                let mut buf = vec![0u8; 8192];
                loop {
                    match tcp_read.read(&mut buf).await {
                        Ok(0) => break,
                        Ok(n) => {
                            let msg = Message::Binary(buf[..n].to_vec());
                            if ws_write.send(msg).await.is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            };
            
            tokio::join!(ws_to_tcp, tcp_to_ws);
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::async_runtime::spawn(run_proxy_server());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_domains,
            start_domain,
            shutdown_domain,
            stop_domain,
            suspend_domain,
            resume_domain,
            reboot_domain,
            reset_domain,
            open_viewer,
            get_vm_spice_port,
            get_system_resources,
            list_networks,
            list_storage_pools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
