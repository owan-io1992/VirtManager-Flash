// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Serialize, Deserialize};
use virt::connect::Connect;
use virt::domain::Domain;

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
            get_vm_spice_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
