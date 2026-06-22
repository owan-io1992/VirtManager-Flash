use serde::{Serialize, Deserialize};
use virt::domain::Domain;
use virt::storage_vol::StorageVol;

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
}

#[tauri::command]
pub fn list_domains() -> Result<Vec<DomainItem>, String> {
    let conn = crate::connect_libvirt()?;
    let domains = conn.list_all_domains(0)
        .map_err(|e| format!("Failed to list domains: {}", e))?;
    
    let mut list = Vec::new();
    for dom in domains {
        let name = dom.get_name().unwrap_or_else(|_| "unknown".to_string());
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
pub fn start_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.create()
        .map(|_| ())
        .map_err(|e| format!("Failed to start VM: {}", e))
}

#[tauri::command]
pub fn shutdown_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.shutdown()
        .map(|_| ())
        .map_err(|e| format!("Failed to shutdown VM: {}", e))
}

#[tauri::command]
pub fn stop_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.destroy()
        .map(|_| ())
        .map_err(|e| format!("Failed to force stop VM: {}", e))
}

#[tauri::command]
pub fn suspend_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.suspend()
        .map(|_| ())
        .map_err(|e| format!("Failed to suspend VM: {}", e))
}

#[tauri::command]
pub fn resume_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.resume()
        .map(|_| ())
        .map_err(|e| format!("Failed to resume VM: {}", e))
}

#[tauri::command]
pub fn reboot_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.reboot(0)
        .map(|_| ())
        .map_err(|e| format!("Failed to reboot VM: {}", e))
}

#[tauri::command]
pub fn reset_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.reset()
        .map(|_| ())
        .map_err(|e| format!("Failed to reset VM: {}", e))
}

#[tauri::command]
pub fn open_viewer(name: String) -> Result<(), String> {
    std::process::Command::new("virt-viewer")
        .arg("-c")
        .arg("qemu:///system")
        .arg(&name)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch virt-viewer: {}", e))
}

#[tauri::command]
pub fn get_vm_spice_port(name: String) -> Result<u16, String> {
    let conn = crate::connect_libvirt()?;
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

// Helper functions for XML replacement
fn replace_tag_content(xml: &str, tag: &str, new_value: &str) -> String {
    let start_tag = format!("<{}", tag);
    let end_tag = format!("</{}>", tag);
    
    if let Some(start_idx) = xml.find(&start_tag) {
        if let Some(tag_end_idx) = xml[start_idx..].find('>') {
            let val_start = start_idx + tag_end_idx + 1;
            if let Some(end_idx) = xml[val_start..].find(&end_tag) {
                let val_end = val_start + end_idx;
                let mut new_xml = String::new();
                new_xml.push_str(&xml[..val_start]);
                new_xml.push_str(new_value);
                new_xml.push_str(&xml[val_end..]);
                return new_xml;
            }
        }
    }
    xml.to_string()
}

fn replace_attr_in_block(block: &str, tag_prefix: &str, attr: &str, new_val: &str) -> String {
    if let Some(tag_idx) = block.find(tag_prefix) {
        let after_tag = &block[tag_idx..];
        let search_single = format!("{}='", attr);
        let search_double = format!("{}=\"", attr);
        
        if let Some(attr_idx) = after_tag.find(&search_single) {
            let start = tag_idx + attr_idx + search_single.len();
            if let Some(end_idx) = block[start..].find('\'') {
                let mut new_block = String::new();
                new_block.push_str(&block[..start]);
                new_block.push_str(new_val);
                new_block.push_str(&block[start + end_idx..]);
                return new_block;
            }
        } else if let Some(attr_idx) = after_tag.find(&search_double) {
            let start = tag_idx + attr_idx + search_double.len();
            if let Some(end_idx) = block[start..].find('"') {
                let mut new_block = String::new();
                new_block.push_str(&block[..start]);
                new_block.push_str(new_val);
                new_block.push_str(&block[start + end_idx..]);
                return new_block;
            }
        }
    }
    block.to_string()
}

fn update_interface_xml(xml: &str, net_source: &str, net_model: &str) -> String {
    if let Some(start_idx) = xml.find("<interface") {
        if let Some(end_idx) = xml[start_idx..].find("</interface>") {
            let interface_block_end = start_idx + end_idx + "</interface>".len();
            let mut interface_block = xml[start_idx..interface_block_end].to_string();
            
            if interface_block.contains("network=") {
                interface_block = replace_attr_in_block(&interface_block, "<source", "network", net_source);
            } else if interface_block.contains("bridge=") {
                interface_block = replace_attr_in_block(&interface_block, "<source", "bridge", net_source);
            } else {
                interface_block = replace_attr_in_block(&interface_block, "<source", "network", net_source);
            }
            
            interface_block = replace_attr_in_block(&interface_block, "<model", "type", net_model);
            
            let mut new_xml = String::new();
            new_xml.push_str(&xml[..start_idx]);
            new_xml.push_str(&interface_block);
            new_xml.push_str(&xml[interface_block_end..]);
            return new_xml;
        }
    }
    xml.to_string()
}

fn update_boot_xml(xml: &str, boot_dev: &str) -> String {
    if xml.contains("<boot ") {
        replace_attr_in_block(xml, "<boot", "dev", boot_dev)
    } else {
        xml.to_string()
    }
}

fn update_graphics_xml(xml: &str, graphics_type: &str) -> String {
    if xml.contains("<graphics ") {
        replace_attr_in_block(xml, "<graphics", "type", graphics_type)
    } else {
        xml.to_string()
    }
}

#[tauri::command]
pub fn update_vm_settings(
    name: String,
    cpu: u32,
    memory: u64,
    max_memory: u64,
    disk_path: String,
    disk_size_gb: u64,
    net_source: String,
    net_model: String,
    autostart: bool,
    boot_device: String,
    graphics_type: String,
) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    
    // Set autostart state
    dom.set_autostart(autostart)
        .map_err(|e| format!("Failed to set autostart: {}", e))?;

    // Attempt storage volume resizing if path is valid
    if !disk_path.is_empty() {
        if let Ok(vol) = StorageVol::lookup_by_path(&conn, &disk_path) {
            if let Ok(vol_info) = vol.get_info() {
                let current_size_bytes = vol_info.capacity;
                let new_size_bytes = disk_size_gb * 1024 * 1024 * 1024;
                if new_size_bytes > current_size_bytes {
                    vol.resize(new_size_bytes, 0)
                        .map_err(|e| format!("Failed to resize storage volume {}: {}", disk_path, e))?;
                }
            }
        }
    }

    // Get current XML configuration (inactive / persistent config)
    // 2 is VIR_DOMAIN_XML_INACTIVE, which lets us fetch persistent config
    let mut xml = dom.get_xml_desc(2)
        .or_else(|_| dom.get_xml_desc(0))
        .map_err(|e| format!("Failed to read XML: {}", e))?;

    // Modify CPU, Memory, maxMemory
    xml = replace_tag_content(&xml, "memory", &max_memory.to_string());
    xml = replace_tag_content(&xml, "currentMemory", &memory.to_string());
    xml = replace_tag_content(&xml, "vcpu", &cpu.to_string());

    // Modify boot device
    xml = update_boot_xml(&xml, &boot_device);

    // Modify graphics type
    xml = update_graphics_xml(&xml, &graphics_type);

    // Modify network source and driver model
    xml = update_interface_xml(&xml, &net_source, &net_model);

    // Redefine domain with new XML to persist configurations
    Domain::define_xml(&conn, &xml)
        .map(|_| ())
        .map_err(|e| format!("Failed to save VM configuration XML: {}", e))
}
