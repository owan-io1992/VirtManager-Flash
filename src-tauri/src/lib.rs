// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Serialize, Deserialize};
use virt::connect::Connect;
use virt::domain::Domain;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            reset_domain
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
