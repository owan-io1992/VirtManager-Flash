use serde::{Serialize, Deserialize};
use virt::domain::Domain;
use virt::storage_pool::StoragePool;
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
    pub disk_rd_req: i64,
    pub disk_rd_bytes: i64,
    pub disk_wr_req: i64,
    pub disk_wr_bytes: i64,
    pub net_rx_bytes: i64,
    pub net_rx_packets: i64,
    pub net_tx_bytes: i64,
    pub net_tx_packets: i64,
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
        
        let mut disk_rd_req = 0i64;
        let mut disk_rd_bytes = 0i64;
        let mut disk_wr_req = 0i64;
        let mut disk_wr_bytes = 0i64;
        let mut net_rx_bytes = 0i64;
        let mut net_rx_packets = 0i64;
        let mut net_tx_bytes = 0i64;
        let mut net_tx_packets = 0i64;
        
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
            // Enable balloon memory stats collection (no-op if already set)
            let _ = dom.set_memory_stats_period(2, 0);
            if let Ok(stats) = dom.memory_stats(0) {
                let mut unused_balloon = 0u64; // tag 4: balloon driver free (Linux)
                let mut usable_agent = 0u64;   // tag 8: guest agent free (Windows+agent)
                let mut available = 0u64;      // tag 5: total mem from guest OS
                let mut balloon_size = 0u64;   // tag 6: actual balloon size
                let mut rss = 0u64;            // tag 7: host RSS (fallback for Windows without balloon)
                for stat in stats {
                    match stat.tag {
                        4 => unused_balloon = stat.val,
                        5 => available = stat.val,
                        6 => balloon_size = stat.val,
                        7 => rss = stat.val,
                        8 => usable_agent = stat.val,
                        _ => {}
                    }
                }
                // Prefer guest-agent-reported free (tag 8), fall back to balloon driver (tag 4)
                let free = if usable_agent > 0 { usable_agent } else { unused_balloon };
                // Prefer guest OS total (tag 5), fall back to balloon size (tag 6)
                let total = if available > 0 { available } else { balloon_size };

                if free > 0 && total > 0 && total >= free {
                    memory = total - free;
                } else if rss > 0 {
                    // Fallback for Windows without virtio-balloon driver
                    memory = rss;
                }
            }
            
            // Get disk and network stats
            if let Ok(xml) = dom.get_xml_desc(0) {
                for block in collect_blocks(&xml, "<disk", "</disk>") {
                    if let Some(target_dev) = get_attr_in_block(&block, "<target", "dev") {
                        if let Ok(stats) = dom.get_block_stats(&target_dev) {
                            disk_rd_req += stats.rd_req;
                            disk_rd_bytes += stats.rd_bytes;
                            disk_wr_req += stats.wr_req;
                            disk_wr_bytes += stats.wr_bytes;
                        }
                    }
                }
                
                for block in collect_blocks(&xml, "<interface", "</interface>") {
                    if let Some(target_dev) = get_attr_in_block(&block, "<target", "dev") {
                        if let Ok(stats) = dom.interface_stats(&target_dev) {
                            net_rx_bytes += stats.rx_bytes;
                            net_rx_packets += stats.rx_packets;
                            net_tx_bytes += stats.tx_bytes;
                            net_tx_packets += stats.tx_packets;
                        }
                    }
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
            disk_rd_req,
            disk_rd_bytes,
            disk_wr_req,
            disk_wr_bytes,
            net_rx_bytes,
            net_rx_packets,
            net_tx_bytes,
            net_tx_packets,
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
pub fn delete_vm(name: String, delete_storage: bool) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;

    // Deletion is restricted to powered-off VMs
    let state = dom.get_state().map(|(s, _)| s).unwrap_or(0);
    if state == 1 /* VIR_DOMAIN_RUNNING */ || state == 3 /* VIR_DOMAIN_PAUSED */ {
        return Err("Cannot delete VM while it is running or paused. Please power it off first.".to_string());
    }

    if delete_storage {
        // Collect disk paths before undefining
        let xml = dom.get_xml_desc(0).unwrap_or_default();
        let mut paths: Vec<String> = Vec::new();
        let mut search = xml.as_str();
        while let Some(src_idx) = search.find("<source file='") {
            let rest = &search[src_idx + 14..];
            if let Some(end) = rest.find('\'') {
                let path = &rest[..end];
                if path.ends_with(".qcow2") || path.ends_with(".img") || path.ends_with(".raw") {
                    paths.push(path.to_string());
                }
            }
            search = &search[src_idx + 14..];
        }
        if dom.undefine_flags(4).is_err() {
            dom.undefine().map_err(|e| format!("Failed to undefine VM: {}", e))?;
        }
        for path in paths {
            if let Ok(vol) = StorageVol::lookup_by_path(&conn, &path) {
                let _ = vol.delete(0);
            }
        }
    } else {
        if dom.undefine_flags(4).is_err() {
            dom.undefine().map_err(|e| format!("Failed to undefine VM: {}", e))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn open_viewer(name: String) -> Result<(), String> {
    std::process::Command::new("virt-viewer")
        .arg("--attach")
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
    
    // Detect SPICE with GL rendering (listen type='none') — no TCP port available
    if xml.contains("type='spice'") && (xml.contains("<listen type='none'/>") || xml.contains("listen type=\"none\"")) {
        return Err("SPICE_GL_NO_PORT".to_string());
    }

    // Check for SPICE graphics port
    if let Some(idx) = xml.find("type='spice'") {
        // Use graphics element boundary to avoid matching 'port=' inside 'autoport='
        if let Some(elem_end) = xml[idx..].find('>') {
            let elem = &xml[idx..idx + elem_end];
            if let Some(port_start) = elem.find(" port='") {
                let start = idx + port_start + 7;
                if let Some(port_end) = xml[start..].find("'") {
                    let port_str = &xml[start..start + port_end];
                    if let Ok(p) = port_str.parse::<u16>() {
                        return Ok(p);
                    }
                    // port='-1' means libvirt/qemu hasn't allocated the autoport yet
                    if port_str == "-1" {
                        return Err("SPICE_PORT_NOT_READY".to_string());
                    }
                }
            }
        }
    }

    // Fallback: check for VNC graphics port
    if let Some(idx) = xml.find("type='vnc'") {
        if let Some(elem_end) = xml[idx..].find('>') {
            let elem = &xml[idx..idx + elem_end];
            if let Some(port_start) = elem.find(" port='") {
                let start = idx + port_start + 7;
                if let Some(port_end) = xml[start..].find("'") {
                    let port_str = &xml[start..start + port_end];
                    if let Ok(p) = port_str.parse::<u16>() {
                        return Ok(p);
                    }
                    if port_str == "-1" {
                        return Err("SPICE_PORT_NOT_READY".to_string());
                    }
                }
            }
        }
    }

    Err("No graphics display (SPICE or VNC) found for this VM".to_string())
}

// Helper functions for reading values out of domain XML
fn get_tag_content(xml: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{}", tag);
    let end_tag = format!("</{}>", tag);
    let start_idx = xml.find(&start_tag)?;
    let tag_end_idx = xml[start_idx..].find('>')?;
    let val_start = start_idx + tag_end_idx + 1;
    let end_idx = xml[val_start..].find(&end_tag)?;
    Some(xml[val_start..val_start + end_idx].trim().to_string())
}

fn get_attr_in_block(block: &str, tag_prefix: &str, attr: &str) -> Option<String> {
    let tag_idx = block.find(tag_prefix)?;
    let after_tag = &block[tag_idx..];
    let tag_close = after_tag.find('>').unwrap_or(after_tag.len());
    let tag_slice = &after_tag[..tag_close];
    for quote in ['\'', '"'] {
        let search = format!("{}={}", attr, quote);
        if let Some(attr_idx) = tag_slice.find(&search) {
            let start = attr_idx + search.len();
            if let Some(end_idx) = tag_slice[start..].find(quote) {
                return Some(tag_slice[start..start + end_idx].to_string());
            }
        }
    }
    None
}

// Collect every <open ... </close> block in document order
fn collect_blocks(xml: &str, open: &str, close: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(open) {
        let after = &rest[start..];
        match after.find(close) {
            Some(rel_end) => {
                let end = rel_end + close.len();
                blocks.push(after[..end].to_string());
                rest = &after[end..];
            }
            None => break,
        }
    }
    blocks
}

// Rewrite every <open ... </close> block via the provided transform, preserving the rest
fn map_blocks(xml: &str, open: &str, close: &str, f: impl Fn(&str) -> String) -> String {
    let mut result = String::new();
    let mut rest = xml;
    while let Some(start) = rest.find(open) {
        result.push_str(&rest[..start]);
        let after = &rest[start..];
        match after.find(close) {
            Some(rel_end) => {
                let end = rel_end + close.len();
                result.push_str(&f(&after[..end]));
                rest = &after[end..];
            }
            None => {
                result.push_str(after);
                return result;
            }
        }
    }
    result.push_str(rest);
    result
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

fn update_block_boot_order(block: &str, boot_order: Option<u32>) -> String {
    let mut b = block.to_string();
    // Remove existing <boot .../> tags inside the block
    while let Some(boot_start) = b.find("<boot") {
        if let Some(rel_end) = b[boot_start..].find('>') {
            let boot_end = boot_start + rel_end + 1;
            let mut cleaned = String::new();
            cleaned.push_str(&b[..boot_start]);
            cleaned.push_str(&b[boot_end..]);
            b = cleaned;
        } else {
            break;
        }
    }
    
    if let Some(order) = boot_order {
        if let Some(close_idx) = b.rfind("</") {
            let mut inserted = String::new();
            inserted.push_str(&b[..close_idx]);
            inserted.push_str(&format!("  <boot order='{}'/>\n      ", order));
            inserted.push_str(&b[close_idx..]);
            b = inserted;
        }
    }
    b
}

fn update_bootmenu_xml(xml: &str, enable: bool) -> String {
    let enable_str = if enable { "yes" } else { "no" };
    if xml.contains("<bootmenu") {
        replace_attr_in_block(xml, "<bootmenu", "enable", enable_str)
    } else if let Some(os_idx) = xml.find("<os") {
        if let Some(rel_end) = xml[os_idx..].find('>') {
            let insert_at = os_idx + rel_end + 1;
            let mut result = String::new();
            result.push_str(&xml[..insert_at]);
            result.push_str(&format!("<bootmenu enable='{}'/>", enable_str));
            result.push_str(&xml[insert_at..]);
            result
        } else {
            xml.to_string()
        }
    } else {
        xml.to_string()
    }
}

fn update_interfaces_xml(xml: &str, nics: &[NicInfo], boot_devices: &[String]) -> String {
    // 1. Update existing or delete if not in nics
    let updated_xml = map_blocks(xml, "<interface", "</interface>", |block| {
        let mac = match get_attr_in_block(block, "<mac", "address") {
            Some(m) => m,
            None => return block.to_string(),
        };
        match nics.iter().find(|n| n.mac == mac) {
            Some(nic) => {
                let mut b = if block.contains("bridge=") || nic.source_type == "bridge" {
                    replace_attr_in_block(block, "<source", "bridge", &nic.source)
                } else {
                    replace_attr_in_block(block, "<source", "network", &nic.source)
                };
                b = replace_attr_in_block(&b, "<model", "type", &nic.model);
                
                let id = format!("nic:{}", mac);
                let boot_order = boot_devices.iter().position(|x| x == &id).map(|pos| (pos + 1) as u32);
                b = update_block_boot_order(&b, boot_order);
                b
            }
            None => "".to_string(), // Delete this interface block
        }
    });

    // 2. Add new interfaces
    let mut new_interfaces_xml = String::new();
    for nic in nics {
        let search_pattern = format!("address='{}'", nic.mac);
        let search_pattern_double = format!("address=\"{}\"", nic.mac);
        if !updated_xml.contains(&search_pattern) && !updated_xml.contains(&search_pattern_double) {
            let id = format!("nic:{}", nic.mac);
            let boot_order = boot_devices.iter().position(|x| x == &id).map(|pos| (pos + 1) as u32);
            let boot_tag = if let Some(order) = boot_order {
                format!("\n      <boot order='{}'/>", order)
            } else {
                "".to_string()
            };
            let source_attr = if nic.source_type == "bridge" {
                format!("bridge='{}'", nic.source)
            } else {
                format!("network='{}'", nic.source)
            };
            let if_xml = format!(
                "    <interface type='{}'>\n      <mac address='{}'/>\n      <source {}/>\n      <model type='{}'/>{}\n    </interface>\n",
                if nic.source_type.is_empty() { "network" } else { &nic.source_type },
                nic.mac,
                source_attr,
                if nic.model.is_empty() { "virtio" } else { &nic.model },
                boot_tag
            );
            new_interfaces_xml.push_str(&if_xml);
        }
    }

    if !new_interfaces_xml.is_empty() {
        if let Some(devices_idx) = updated_xml.find("</devices>") {
            let mut final_xml = String::new();
            final_xml.push_str(&updated_xml[..devices_idx]);
            final_xml.push_str(&new_interfaces_xml);
            final_xml.push_str(&updated_xml[devices_idx..]);
            return final_xml;
        }
    }

    updated_xml
}

// Update/Add/Remove disk blocks, matching the incoming disk list by target dev
fn update_disks_xml(xml: &str, disks: &[DiskInfo], boot_devices: &[String]) -> String {
    // 1. Update existing disks or remove them if not in the new list
    let updated_xml = map_blocks(xml, "<disk", "</disk>", |block| {
        let dev = match get_attr_in_block(block, "<target", "dev") {
            Some(d) => d,
            None => return block.to_string(),
        };
        match disks.iter().find(|d| d.target_dev == dev) {
            Some(disk) => {
                let is_cdrom = disk.device == "cdrom";
                let mut b = replace_attr_in_block(block, "<target", "bus", &disk.bus);
                b = replace_attr_in_block(&b, "<disk", "device", if is_cdrom { "cdrom" } else { "disk" });
                if b.contains("file=") {
                    b = replace_attr_in_block(&b, "<source", "file", &disk.path);
                } else if b.contains("dev=") {
                    b = replace_attr_in_block(&b, "<source", "dev", &disk.path);
                }
                
                // Update driver type based on device type (cdrom uses raw, disk uses qcow2)
                let expected_driver_type = if is_cdrom { "raw" } else { "qcow2" };
                b = replace_attr_in_block(&b, "<driver", "type", expected_driver_type);
                
                // Ensure <readonly/> is present for cdrom and absent for disk
                if is_cdrom {
                    if !b.contains("<readonly/>") && !b.contains("<readonly />") {
                        b = b.replace("</disk>", "  <readonly/>\n    </disk>");
                    }
                } else {
                    b = b.replace("<readonly/>", "").replace("<readonly />", "");
                }
                
                let id = format!("disk:{}", dev);
                let boot_order = boot_devices.iter().position(|x| x == &id || (is_cdrom && x == "cdrom")).map(|pos| (pos + 1) as u32);
                b = update_block_boot_order(&b, boot_order);
                b
            }
            None => "".to_string(), // Return empty string to delete this disk block
        }
    });

    // 2. Add new disks that do not exist in the XML
    let mut new_disks_xml = String::new();
    for disk in disks {
        let search_pattern = format!("dev='{}'", disk.target_dev);
        let search_pattern_double = format!("dev=\"{}\"", disk.target_dev);
        if !updated_xml.contains(&search_pattern) && !updated_xml.contains(&search_pattern_double) {
            let is_cdrom = disk.device == "cdrom";
            let id = format!("disk:{}", disk.target_dev);
            let boot_order = boot_devices.iter().position(|x| x == &id || (is_cdrom && x == "cdrom")).map(|pos| (pos + 1) as u32);
            let boot_tag = if let Some(order) = boot_order {
                format!("\n      <boot order='{}'/>", order)
            } else {
                "".to_string()
            };
            let driver_type = if is_cdrom { "raw" } else { "qcow2" };
            let readonly_tag = if is_cdrom { "\n      <readonly/>" } else { "" };
            let disk_xml = format!(
                "    <disk type='file' device='{}'>\n      <driver name='qemu' type='{}'/>\n      <source file='{}'/>\n      <target dev='{}' bus='{}'/>{}{}\n    </disk>\n",
                if disk.device.is_empty() { "disk" } else { &disk.device },
                driver_type,
                disk.path,
                disk.target_dev,
                if disk.bus.is_empty() { "virtio" } else { &disk.bus },
                readonly_tag,
                boot_tag
            );
            new_disks_xml.push_str(&disk_xml);
        }
    }

    if !new_disks_xml.is_empty() {
        if let Some(devices_idx) = updated_xml.find("</devices>") {
            let mut final_xml = String::new();
            final_xml.push_str(&updated_xml[..devices_idx]);
            final_xml.push_str(&new_disks_xml);
            final_xml.push_str(&updated_xml[devices_idx..]);
            return final_xml;
        }
    }

    updated_xml
}

fn update_boot_xml(xml: &str, boot_devices: &[String]) -> String {
    let mut b = xml.to_string();
    while let Some(boot_idx) = b.find("<boot ") {
        if let Some(rel_end) = b[boot_idx..].find('>') {
            let boot_end = boot_idx + rel_end + 1;
            let mut cleaned = String::new();
            cleaned.push_str(&b[..boot_idx]);
            cleaned.push_str(&b[boot_end..]);
            b = cleaned;
        } else {
            break;
        }
    }
    
    if boot_devices.is_empty() {
        if let Some(os_idx) = b.find("<os") {
            if let Some(rel_end) = b[os_idx..].find('>') {
                let insert_at = os_idx + rel_end + 1;
                let mut result = String::new();
                result.push_str(&b[..insert_at]);
                result.push_str("<boot dev='hd'/>");
                result.push_str(&b[insert_at..]);
                return result;
            }
        }
    }
    b
}

fn update_graphics_xml(xml: &str, graphics_type: &str) -> String {
    if xml.contains("<graphics ") {
        replace_attr_in_block(xml, "<graphics", "type", graphics_type)
    } else {
        xml.to_string()
    }
}

fn remove_attr_from_tag(block: &str, tag_prefix: &str, attr: &str) -> String {
    if let Some(tag_idx) = block.find(tag_prefix) {
        if let Some(rel_end) = block[tag_idx..].find('>') {
            let tag_end = tag_idx + rel_end + 1;
            let mut tag = block[tag_idx..tag_end].to_string();
            for pat in [format!(" {}='", attr), format!(" {}=\"", attr)] {
                if let Some(attr_idx) = tag.find(&pat) {
                    let quote_char = pat.chars().last().unwrap();
                    let val_start = attr_idx + pat.len();
                    if let Some(end_rel) = tag[val_start..].find(quote_char) {
                        let val_end = val_start + end_rel + 1;
                        tag.replace_range(attr_idx..val_end, "");
                    }
                    break;
                }
            }
            let mut result = String::new();
            result.push_str(&block[..tag_idx]);
            result.push_str(&tag);
            result.push_str(&block[tag_end..]);
            return result;
        }
    }
    block.to_string()
}

fn update_video_xml(xml: &str, video_model: &str) -> String {
    if xml.contains("<video") {
        map_blocks(xml, "<video", "</video>", |block| {
            let mut b = replace_attr_in_block(block, "<model", "type", video_model);
            if video_model != "qxl" {
                // ram/vram/vram64/vgamem are only valid on the qxl video model
                for attr in ["ram", "vram", "vram64", "vgamem"] {
                    b = remove_attr_from_tag(&b, "<model", attr);
                }
            }
            b
        })
    } else {
        xml.to_string()
    }
}

fn update_topology_xml(xml: &str, sockets: u32, cores: u32, threads: u32) -> String {
    if sockets == 0 || cores == 0 || threads == 0 {
        return xml.to_string();
    }
    let topology = format!(
        "<topology sockets='{}' cores='{}' threads='{}'/>",
        sockets, cores, threads
    );

    if xml.contains("<topology") {
        // Replace existing topology attributes in place
        let mut result = replace_attr_in_block(xml, "<topology", "sockets", &sockets.to_string());
        result = replace_attr_in_block(&result, "<topology", "cores", &cores.to_string());
        replace_attr_in_block(&result, "<topology", "threads", &threads.to_string())
    } else if let Some(cpu_idx) = xml.find("<cpu") {
        // Inject topology inside the existing <cpu> element, after its opening tag
        if let Some(rel_end) = xml[cpu_idx..].find('>') {
            let insert_at = cpu_idx + rel_end + 1;
            let mut result = String::new();
            result.push_str(&xml[..insert_at]);
            result.push_str(&topology);
            result.push_str(&xml[insert_at..]);
            return result;
        }
        xml.to_string()
    } else {
        // No <cpu> element: add one right after the </vcpu> line
        let cpu_block = format!("\n  <cpu>{}</cpu>", topology);
        if let Some(vcpu_end) = xml.find("</vcpu>") {
            let insert_at = vcpu_end + "</vcpu>".len();
            let mut result = String::new();
            result.push_str(&xml[..insert_at]);
            result.push_str(&cpu_block);
            result.push_str(&xml[insert_at..]);
            return result;
        }
        xml.to_string()
    }
}

fn update_secure_boot_xml(xml: &str, enable: bool) -> String {
    let mut new_xml = xml.to_string();
    if enable {
        // Ensure <os> tag has firmware='efi' attribute
        if !new_xml.contains("firmware=") {
            if let Some(idx) = new_xml.find("<os>") {
                new_xml.replace_range(idx..idx + 4, "<os firmware='efi'>");
            } else if let Some(idx) = new_xml.find("<os ") {
                new_xml.insert_str(idx + 4, "firmware='efi' ");
            }
        }
        // Ensure <firmware> feature block exists inside <os>
        if !new_xml.contains("<firmware>") {
            if let Some(type_idx) = new_xml.find("<type ") {
                if let Some(end_type_idx) = new_xml[type_idx..].find("</type>") {
                    let insert_idx = type_idx + end_type_idx + 7;
                    new_xml.insert_str(insert_idx, "\n    <firmware>\n      <feature enabled='yes' name='secure-boot'/>\n    </firmware>");
                }
            }
        }
        // Ensure <smm state='on'/> is inside <features>
        if !new_xml.contains("<smm ") && !new_xml.contains("<smm>") {
            if let Some(features_idx) = new_xml.find("<features>") {
                new_xml.insert_str(features_idx + 10, "\n    <smm state='on'/>");
            }
        }
    } else {
        // Disable secure boot: remove firmware attribute from <os>
        new_xml = new_xml.replace(" firmware='efi'", "");
        new_xml = new_xml.replace(" firmware=\"efi\"", "");
        // Remove <firmware> block
        if let Some(start_firmware) = new_xml.find("<firmware>") {
            if let Some(end_firmware) = new_xml[start_firmware..].find("</firmware>") {
                let delete_end = start_firmware + end_firmware + 11;
                new_xml.drain(start_firmware..delete_end);
            }
        }
        // Remove <smm> block
        if let Some(start_smm) = new_xml.find("<smm") {
            if let Some(end_smm) = new_xml[start_smm..].find("/>") {
                let delete_end = start_smm + end_smm + 2;
                new_xml.drain(start_smm..delete_end);
            }
        }
    }
    new_xml
}

fn update_tpm_xml(xml: &str, enable: bool) -> String {
    let mut new_xml = xml.to_string();
    if enable {
        if !new_xml.contains("<tpm") {
            if let Some(devices_end) = new_xml.find("</devices>") {
                new_xml.insert_str(devices_end, "    <tpm model='tpm-tis'>\n      <backend type='emulator' version='2.0'/>\n    </tpm>\n  ");
            }
        }
    } else {
        if let Some(start_tpm) = new_xml.find("<tpm") {
            if let Some(end_tpm) = new_xml[start_tpm..].find("</tpm>") {
                let delete_end = start_tpm + end_tpm + 6;
                new_xml.drain(start_tpm..delete_end);
            }
        }
    }
    new_xml
}

// Change the ISO media for any cdrom devices on a running domain. libvirt supports
// updating cdrom source live via virDomainUpdateDeviceFlags without powering off.
fn apply_cdroms_live(dom: &Domain, disks: &[DiskInfo]) -> Result<(), String> {
    let live_xml = dom.get_xml_desc(0)
        .map_err(|e| format!("Failed to read live XML: {}", e))?;
    for block in collect_blocks(&live_xml, "<disk", "</disk>") {
        // Only handle cdrom devices
        if get_attr_in_block(&block, "<disk", "device").as_deref() != Some("cdrom") {
            continue;
        }
        let dev = match get_attr_in_block(&block, "<target", "dev") {
            Some(d) => d,
            None => continue,
        };
        let disk = match disks.iter().find(|d| d.target_dev == dev) {
            Some(d) => d,
            None => continue,
        };
        // Build the updated block: set or clear the <source file='...'/>
        let edited = if disk.path.is_empty() {
            // Eject: remove <source .../> entirely
            let mut b = block.to_string();
            if let Some(src_start) = b.find("<source") {
                if let Some(rel_end) = b[src_start..].find("/>") {
                    let end = src_start + rel_end + 2;
                    let mut cleaned = String::new();
                    cleaned.push_str(&b[..src_start]);
                    cleaned.push_str(&b[end..]);
                    b = cleaned;
                }
            }
            b
        } else if block.contains("<source") {
            replace_attr_in_block(&block, "<source", "file", &disk.path)
        } else {
            // No <source> yet — insert one before <target>
            if let Some(tgt_idx) = block.find("<target") {
                let mut b = String::new();
                b.push_str(&block[..tgt_idx]);
                b.push_str(&format!("<source file='{}'/>\n      ", disk.path));
                b.push_str(&block[tgt_idx..]);
                b
            } else {
                block.to_string()
            }
        };
        if edited != block {
            dom.update_device_flags(&edited, AFFECT_LIVE_CONFIG)
                .map_err(|e| format!("Failed to update cdrom media live: {}", e))?;
        }
    }
    Ok(())
}

// Apply the source/model edits of the NIC list to a running domain, one device at
// a time, so changes take effect live (and persist to config). Whitelisted because
// libvirt supports hot-updating interfaces while other devices cannot change live.
fn apply_nics_live(dom: &Domain, nics: &[NicInfo]) -> Result<(), String> {
    let live_xml = dom.get_xml_desc(0)
        .map_err(|e| format!("Failed to read live XML: {}", e))?;
    for block in collect_blocks(&live_xml, "<interface", "</interface>") {
        let mac = match get_attr_in_block(&block, "<mac", "address") {
            Some(m) => m,
            None => continue,
        };
        let nic = match nics.iter().find(|n| n.mac == mac) {
            Some(n) => n,
            None => continue,
        };
        let mut edited = if block.contains("bridge=") {
            replace_attr_in_block(&block, "<source", "bridge", &nic.source)
        } else {
            replace_attr_in_block(&block, "<source", "network", &nic.source)
        };
        edited = replace_attr_in_block(&edited, "<model", "type", &nic.model);
        if edited != block {
            dom.update_device_flags(&edited, AFFECT_LIVE_CONFIG)
                .map_err(|e| format!("Failed to update network device live: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn update_vm_settings(
    name: String,
    new_name: String,
    cpu: u32,
    memory: u64,
    max_memory: u64,
    autostart: bool,
    boot_devices: Vec<String>,
    boot_menu: bool,
    graphics_type: String,
    video_model: String,
    machine: String,
    os_type: String,
    cpu_sockets: u32,
    cpu_cores: u32,
    cpu_threads: u32,
    disks: Vec<DiskInfo>,
    nics: Vec<NicInfo>,
    secure_boot: bool,
    tpm: bool,
) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;

    // Autostart is always allowed regardless of run state (whitelisted)
    dom.set_autostart(autostart)
        .map_err(|e| format!("Failed to set autostart: {}", e))?;

    // While the VM is running only whitelisted changes are permitted: live network
    // switching. Everything else requires the VM to be powered off.
    let is_active = dom.is_active().unwrap_or(false);
    if is_active {
        apply_nics_live(&dom, &nics)?;
        apply_cdroms_live(&dom, &disks)?;
    }

    // --- VM is stopped: full edit allowed below ---
    if !is_active {
        // Resize each backing volume that grew, and create new ones if they don't exist
        for disk in &disks {
            if disk.path.is_empty() || disk.device == "cdrom" {
                continue; // CD-ROMs are read-only media and cannot/should not be resized or created as qcow2 files
            }
            if std::path::Path::new(&disk.path).exists() {
                if let Ok(vol) = StorageVol::lookup_by_path(&conn, &disk.path) {
                    if let Ok(vol_info) = vol.get_info() {
                        let new_size_bytes = disk.capacity_gb * 1024 * 1024 * 1024;
                        if new_size_bytes > vol_info.capacity {
                            vol.resize(new_size_bytes, 0)
                                .map_err(|e| format!("Failed to resize storage volume {}: {}", disk.path, e))?;
                        }
                    }
                }
            } else {
                // Try to create the volume through libvirt storage pool first to avoid permission issues
                let mut created_via_libvirt = false;
                if let Ok(pools) = conn.list_all_storage_pools(0) {
                    for pool in pools {
                        if let Ok(pool_xml) = pool.get_xml_desc(0) {
                            let mut pool_path = String::new();
                            if let Some(target_idx) = pool_xml.find("<path>") {
                                let path_block = &pool_xml[target_idx + 6..];
                                if let Some(end_idx) = path_block.find("</path>") {
                                    pool_path = path_block[..end_idx].to_string();
                                }
                            }
                            if !pool_path.is_empty() && disk.path.starts_with(&pool_path) {
                                let filename = disk.path.strip_prefix(&pool_path)
                                    .unwrap_or(&disk.path)
                                    .trim_start_matches('/');
                                
                                let size_bytes = disk.capacity_gb * 1024 * 1024 * 1024;
                                let vol_xml = format!(
                                    "<volume>\n  <name>{}</name>\n  <capacity>{}</capacity>\n  <target>\n    <format type='qcow2'/>\n  </target>\n</volume>",
                                    filename, size_bytes
                                );
                                if StorageVol::create_xml(&pool, &vol_xml, 0).is_ok() {
                                    created_via_libvirt = true;
                                    break;
                                }
                            }
                        }
                    }
                }

                if !created_via_libvirt {
                    // Fallback to running qemu-img locally
                    let size_str = format!("{}G", disk.capacity_gb);
                    let output = std::process::Command::new("qemu-img")
                        .arg("create")
                        .arg("-f")
                        .arg("qcow2")
                        .arg(&disk.path)
                        .arg(&size_str)
                        .output()
                        .map_err(|e| format!("Failed to run qemu-img: {}", e))?;
                    if !output.status.success() {
                        let err_msg = String::from_utf8_lossy(&output.stderr);
                        return Err(format!("Failed to create disk image via qemu-img: {}", err_msg));
                    }
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
    xml = update_boot_xml(&xml, &boot_devices);

    // Modify boot menu
    xml = update_bootmenu_xml(&xml, boot_menu);

    // Modify machine type on the <os><type> element
    if !machine.is_empty() {
        xml = replace_attr_in_block(&xml, "<type", "machine", &machine);
    }

    // Modify graphics type
    xml = update_graphics_xml(&xml, &graphics_type);

    // Modify CPU topology (ignored when any value is 0)
    xml = update_topology_xml(&xml, cpu_sockets, cpu_cores, cpu_threads);

    // Modify every disk and network interface by identity (target dev / MAC)
    xml = update_disks_xml(&xml, &disks, &boot_devices);
    xml = update_interfaces_xml(&xml, &nics, &boot_devices);

    // Modify video model
    xml = update_video_xml(&xml, &video_model);

    // Modify Secure Boot and TPM
    xml = update_secure_boot_xml(&xml, secure_boot);
    xml = update_tpm_xml(&xml, tpm);

    // Redefine domain with new XML to persist configurations
    Domain::define_xml(&conn, &xml)
        .map_err(|e| format!("Failed to save VM configuration XML: {}", e))?;

    // Persist the OS family in VirtManager-Flash metadata (after redefine, which replaces config)
    if !os_type.is_empty() {
        let dom = Domain::lookup_by_name(&conn, &name)
            .map_err(|e| format!("VM not found: {}", e))?;
        dom.set_metadata(
            METADATA_ELEMENT,
            Some(&format!("<virtmanager_flash:os>{}</virtmanager_flash:os>", os_type)),
            Some("virtmanager_flash"),
            Some(VIRTMANAGER_FLASH_OS_NS),
            AFFECT_CONFIG,
        )
        .map_err(|e| format!("Failed to set OS metadata: {}", e))?;
    }

    // Rename last (only valid while inactive, which is guaranteed here)
    let new_name = new_name.trim();
    if !new_name.is_empty() && new_name != name {
        let dom = Domain::lookup_by_name(&conn, &name)
            .map_err(|e| format!("VM not found: {}", e))?;
        dom.rename(new_name, 0)
            .map_err(|e| format!("Failed to rename VM: {}", e))?;
    }

    Ok(())
}

/// Send an arbitrary QEMU guest agent command and return the raw response.
#[tauri::command]
pub fn qemu_agent_command(name: String, cmd: String) -> Result<String, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.qemu_agent_command(&cmd, 10, 0)
        .map_err(|e| format!("Agent command failed: {}", e))
}

/// Return raw memory stats tags and values for debugging.
#[tauri::command]
pub fn debug_memory_stats(name: String) -> Result<Vec<(i32, u64)>, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    let stats = dom.memory_stats(0)
        .map_err(|e| format!("Failed to get memory stats: {}", e))?;
    Ok(stats.iter().map(|s| (s.tag as i32, s.val)).collect())
}

/// Check whether the QEMU guest agent is actively running in the VM.
/// Sends guest-ping with a generous timeout; retries once on failure.
#[tauri::command]
pub fn check_guest_agent(name: String) -> Result<bool, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;

    for _ in 0..2 {
        if dom.qemu_agent_command(r#"{"execute":"guest-ping"}"#, 10, 0).is_ok() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Return the raw persistent XML for the XML editing mode
#[tauri::command]
pub fn get_vm_xml(name: String) -> Result<String, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.get_xml_desc(2)
        .or_else(|_| dom.get_xml_desc(0))
        .map_err(|e| format!("Failed to read XML: {}", e))
}

/// Persist a hand-edited XML definition for the VM
#[tauri::command]
pub fn save_vm_xml(xml: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    Domain::define_xml(&conn, &xml)
        .map(|_| ())
        .map_err(|e| format!("Failed to define VM from XML: {}", e))
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
}

// VirtManager-Flash-owned metadata namespace for tagging a VM's OS family
const VIRTMANAGER_FLASH_OS_NS: &str = "https://virtmanager-flash.app/xmlns/os/1.0";
// VIR_DOMAIN_METADATA_ELEMENT
const METADATA_ELEMENT: i32 = 2;
// VIR_DOMAIN_AFFECT_CONFIG
const AFFECT_CONFIG: u32 = 2;
// VIR_DOMAIN_AFFECT_LIVE | VIR_DOMAIN_AFFECT_CONFIG
const AFFECT_LIVE_CONFIG: u32 = 3;

// Determine the OS family: prefer the VirtManager-Flash metadata, else infer from libosinfo
fn detect_os_type(xml: &str) -> String {
    if let Some(v) = get_tag_content(xml, "virtmanager_flash:os") {
        let v = v.trim().to_lowercase();
        if !v.is_empty() {
            return v;
        }
    }
    if let Some(id) = get_attr_in_block(xml, "<libosinfo:os", "id") {
        let id = id.to_lowercase();
        if id.contains("microsoft") || id.contains("/win") {
            return "windows".to_string();
        }
        return "linux".to_string();
    }
    "other".to_string()
}

// Derive a friendly OS name from a libosinfo id, e.g.
// "http://ubuntu.com/ubuntu/22.04" -> "Ubuntu 22.04"
fn friendly_os(id: &str) -> String {
    let segs: Vec<&str> = id.trim_end_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    let cap = |s: &str| {
        let mut chars = s.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => String::new(),
        }
    };
    match segs.as_slice() {
        [.., name, ver] => format!("{} {}", cap(name), ver),
        [only] => cap(only),
        _ => String::new(),
    }
}

fn parse_disks(xml: &str, conn: &virt::connect::Connect) -> Vec<DiskInfo> {
    let mut disks: Vec<DiskInfo> = collect_blocks(xml, "<disk", "</disk>")
        .iter()
        .map(|block| {
            let path = get_attr_in_block(block, "<source", "file")
                .or_else(|| get_attr_in_block(block, "<source", "dev"))
                .unwrap_or_default();
            let target_dev = get_attr_in_block(block, "<target", "dev").unwrap_or_default();
            let bus = get_attr_in_block(block, "<target", "bus").unwrap_or_default();
            let device = get_attr_in_block(block, "<disk", "device").unwrap_or_else(|| "disk".to_string());

            let mut capacity_gb = 0u64;
            if !path.is_empty() {
                if let Ok(vol) = StorageVol::lookup_by_path(conn, &path) {
                    if let Ok(vol_info) = vol.get_info() {
                        capacity_gb = vol_info.capacity / (1024 * 1024 * 1024);
                    }
                }
            }

            DiskInfo { target_dev, path, capacity_gb, bus, device }
        })
        .collect();

    disks.sort_by(|a, b| {
        let a_is_disk = a.device == "disk";
        let b_is_disk = b.device == "disk";
        match (a_is_disk, b_is_disk) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.target_dev.cmp(&b.target_dev),
        }
    });

    disks
}

fn parse_nics(xml: &str) -> Vec<NicInfo> {
    collect_blocks(xml, "<interface", "</interface>")
        .iter()
        .map(|block| {
            let mac = get_attr_in_block(block, "<mac", "address").unwrap_or_default();
            let (source, source_type) = match get_attr_in_block(block, "<source", "network") {
                Some(net) => (net, "network".to_string()),
                None => (
                    get_attr_in_block(block, "<source", "bridge").unwrap_or_default(),
                    "bridge".to_string(),
                ),
            };
            let model = get_attr_in_block(block, "<model", "type").unwrap_or_default();
            NicInfo { mac, source, source_type, model }
        })
        .collect()
}

#[tauri::command]
pub fn get_vm_settings(name: String) -> Result<VmSettings, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;

    // Read the persistent (inactive) configuration so edits reflect what will be saved
    let xml = dom.get_xml_desc(2)
        .or_else(|_| dom.get_xml_desc(0))
        .map_err(|e| format!("Failed to read XML: {}", e))?;

    let vcpu = get_tag_content(&xml, "vcpu")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);
    let max_mem_kb = get_tag_content(&xml, "memory")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let current_mem_kb = get_tag_content(&xml, "currentMemory")
        .and_then(|v| v.parse().ok())
        .unwrap_or(max_mem_kb);

    let cpu_sockets = get_attr_in_block(&xml, "<topology", "sockets")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let cpu_cores = get_attr_in_block(&xml, "<topology", "cores")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let cpu_threads = get_attr_in_block(&xml, "<topology", "threads")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // Guest OS info: <os><type arch=.. machine=..>hvm</type></os> plus optional libosinfo metadata
    let os_arch = get_attr_in_block(&xml, "<type", "arch").unwrap_or_default();
    let os_machine = get_attr_in_block(&xml, "<type", "machine").unwrap_or_default();
    let os_label = get_attr_in_block(&xml, "<libosinfo:os", "id")
        .map(|id| friendly_os(&id))
        .unwrap_or_default();
    let os_type = detect_os_type(&xml);

    let mut boot_devs_with_order: Vec<(u32, String)> = Vec::new();

    for block in collect_blocks(&xml, "<disk", "</disk>") {
        if let Some(order_str) = get_attr_in_block(&block, "<boot", "order") {
            if let Ok(order) = order_str.parse::<u32>() {
                if let Some(dev) = get_attr_in_block(&block, "<target", "dev") {
                    boot_devs_with_order.push((order, format!("disk:{}", dev)));
                }
            }
        }
    }

    for block in collect_blocks(&xml, "<interface", "</interface>") {
        if let Some(order_str) = get_attr_in_block(&block, "<boot", "order") {
            if let Ok(order) = order_str.parse::<u32>() {
                if let Some(mac) = get_attr_in_block(&block, "<mac", "address") {
                    boot_devs_with_order.push((order, format!("nic:{}", mac)));
                }
            }
        }
    }

    boot_devs_with_order.sort_by_key(|&(order, _)| order);
    let boot_devices_raw: Vec<String> = boot_devs_with_order.into_iter().map(|(_, dev)| dev).collect();

    // Map legacy boot options if there is no granular boot order
    let mut boot_devices = if boot_devices_raw.is_empty() {
        let mut devs = Vec::new();
        if let Some(legacy_dev) = get_attr_in_block(&xml, "<boot", "dev") {
            devs.push(legacy_dev);
        } else {
            devs.push("hd".to_string());
        }
        devs
    } else {
        boot_devices_raw
    };

    // Resolve generic legacy keys to specific devices to make front-end mapping robust
    let parsed_disks = parse_disks(&xml, &conn);
    let parsed_nics = parse_nics(&xml);
    for idx in 0..boot_devices.len() {
        let dev = &boot_devices[idx];
        if dev == "cdrom" {
            if let Some(d) = parsed_disks.iter().find(|d| d.device == "cdrom") {
                boot_devices[idx] = format!("disk:{}", d.target_dev);
            }
        } else if dev == "hd" {
            if let Some(d) = parsed_disks.iter().find(|d| d.device == "disk") {
                boot_devices[idx] = format!("disk:{}", d.target_dev);
            }
        } else if dev == "network" {
            if let Some(n) = parsed_nics.first() {
                boot_devices[idx] = format!("nic:{}", n.mac);
            }
        }
    }

    let boot_menu = if xml.contains("<bootmenu ") || xml.contains("<bootmenu>") {
        get_attr_in_block(&xml, "<bootmenu", "enable")
            .map(|val| val == "yes")
            .unwrap_or(false)
    } else {
        false
    };

    let graphics_type =
        get_attr_in_block(&xml, "<graphics", "type").unwrap_or_else(|| "none".to_string());
    let autostart = dom.get_autostart().unwrap_or(false);
    let secure_boot = xml.contains("secure-boot");
    let tpm = xml.contains("<tpm");

    Ok(VmSettings {
        name,
        vcpu,
        current_mem_kb,
        max_mem_kb,
        cpu_sockets,
        cpu_cores,
        cpu_threads,
        os_label,
        os_arch,
        os_machine,
        os_type,
        boot_devices,
        boot_menu,
        graphics_type,
        video_model: collect_blocks(&xml, "<video", "</video>")
            .first()
            .and_then(|block| get_attr_in_block(block, "<model", "type"))
            .unwrap_or_else(|| "qxl".to_string()),
        autostart,
        disks: parsed_disks,
        nics: parsed_nics,
        secure_boot,
        tpm,
    })
}

#[tauri::command]
pub fn create_vm(
    name: String,
    vcpu: u32,
    memory_mb: u64,
    disk_size_gb: u64,
    storage_pool_name: String,
    iso_path: String,
    secure_boot: bool,
    tpm: bool,
) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;

    // Resolve pool path and create qcow2 disk image
    let pool = StoragePool::lookup_by_name(&conn, &storage_pool_name)
        .map_err(|e| format!("Storage pool '{}' not found: {}", storage_pool_name, e))?;

    let pool_xml = pool.get_xml_desc(0).unwrap_or_default();
    let pool_path = if let Some(idx) = pool_xml.find("<path>") {
        let tail = &pool_xml[idx + 6..];
        tail[..tail.find("</path>").unwrap_or(0)].to_string()
    } else {
        "/var/lib/libvirt/images".to_string()
    };

    let vol_name = format!("{}.qcow2", name);
    let disk_path = format!("{}/{}", pool_path.trim_end_matches('/'), vol_name);
    let size_bytes = disk_size_gb * 1024 * 1024 * 1024;

    let vol_xml = format!(
        "<volume>\n  <name>{}</name>\n  <capacity>{}</capacity>\n  <target>\n    <format type='qcow2'/>\n  </target>\n</volume>",
        vol_name, size_bytes
    );
    StorageVol::create_xml(&pool, &vol_xml, 0)
        .map_err(|e| format!("Failed to create disk volume: {}", e))?;

    let memory_kb = memory_mb * 1024;
    let cdrom_block = if iso_path.is_empty() {
        "    <disk type='file' device='cdrom'>\n      <driver name='qemu' type='raw'/>\n      <target dev='sda' bus='sata'/>\n      <readonly/>\n    </disk>".to_string()
    } else {
        format!(
            "    <disk type='file' device='cdrom'>\n      <driver name='qemu' type='raw'/>\n      <source file='{}'/>\n      <target dev='sda' bus='sata'/>\n      <readonly/>\n      <boot order='1'/>\n    </disk>",
            iso_path
        )
    };
    let disk_boot_order = if iso_path.is_empty() { 1 } else { 2 };

    let os_firmware_attr = if secure_boot {
        " firmware='efi'"
    } else {
        ""
    };

    let firmware_block = if secure_boot {
        "\n    <firmware>\n      <feature enabled='yes' name='secure-boot'/>\n    </firmware>"
    } else {
        ""
    };

    let smm_block = if secure_boot {
        "\n    <smm state='on'/>"
    } else {
        ""
    };

    let tpm_block = if tpm {
        "\n    <tpm model='tpm-tis'>\n      <backend type='emulator' version='2.0'/>\n    </tpm>"
    } else {
        ""
    };

    let domain_xml = format!(
        r#"<domain type='kvm'>
  <name>{name}</name>
  <memory unit='KiB'>{memory_kb}</memory>
  <currentMemory unit='KiB'>{memory_kb}</currentMemory>
  <vcpu placement='static'>{vcpu}</vcpu>
  <os{os_firmware_attr}>
    <type arch='x86_64' machine='q35'>hvm</type>{firmware_block}
    <bootmenu enable='no'/>
  </os>
  <features>
    <acpi/>
    <apic/>{smm_block}
  </features>
  <cpu mode='host-passthrough' check='none' migratable='on'/>
  <clock offset='utc'>
    <timer name='rtc' tickpolicy='catchup'/>
    <timer name='pit' tickpolicy='delay'/>
    <timer name='hpet' present='no'/>
  </clock>
  <on_poweroff>destroy</on_poweroff>
  <on_reboot>restart</on_reboot>
  <on_crash>destroy</on_crash>
  <devices>
    <emulator>/usr/bin/qemu-system-x86_64</emulator>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source file='{disk_path}'/>
      <target dev='vda' bus='virtio'/>
      <boot order='{disk_boot_order}'/>
    </disk>
{cdrom_block}
    <interface type='network'>
      <source network='default'/>
      <model type='virtio'/>
    </interface>
    <graphics type='spice' autoport='yes'>
      <listen type='address'/>
      <image compression='off'/>
    </graphics>
    <video>
      <model type='qxl' ram='65536' vram='65536' vgamem='16384' heads='1' primary='yes'/>
    </video>
    <input type='tablet' bus='usb'/>
    <input type='keyboard' bus='usb'/>
    <channel type='unix'>
      <target type='virtio' name='org.qemu.guest_agent.0'/>
    </channel>
    <channel type='spicevmc'>
      <target type='virtio' name='com.redhat.spice.0'/>
    </channel>{tpm_block}
    <memballoon model='virtio'/>
    <rng model='virtio'>
      <backend model='random'>/dev/urandom</backend>
    </rng>
  </devices>
</domain>"#,
        name = name,
        memory_kb = memory_kb,
        vcpu = vcpu,
        disk_path = disk_path,
        cdrom_block = cdrom_block,
        disk_boot_order = disk_boot_order,
        os_firmware_attr = os_firmware_attr,
        firmware_block = firmware_block,
        smm_block = smm_block,
        tpm_block = tpm_block,
    );

    Domain::define_xml(&conn, &domain_xml)
        .map(|_| ())
        .map_err(|e| format!("Failed to define VM: {}", e))
}

fn extract_xml_tag_content(xml: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    if let Some(start_idx) = xml.find(&start_tag) {
        let content_start = start_idx + start_tag.len();
        if let Some(end_idx) = xml[content_start..].find(&end_tag) {
            return Some(xml[content_start..content_start + end_idx].to_string());
        }
    }
    None
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

#[tauri::command]
pub fn list_snapshots(name: String) -> Result<Vec<SnapshotItem>, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    
    let snapshots = dom.list_all_snapshots(0)
        .map_err(|e| format!("Failed to list snapshots: {}", e))?;
    
    let mut list = Vec::new();
    for snap in snapshots {
        let snap_name = snap.get_name().unwrap_or_else(|_| "unknown".to_string());
        let xml = snap.get_xml_desc(0).unwrap_or_default();
        
        let description = extract_xml_tag_content(&xml, "description").unwrap_or_default();
        let state = extract_xml_tag_content(&xml, "state").unwrap_or_else(|| "unknown".to_string());
        let creation_time = extract_xml_tag_content(&xml, "creationTime")
            .and_then(|t| t.parse::<i64>().ok())
            .unwrap_or(0);
        
        let parent = extract_xml_tag_content(&xml, "parent")
            .and_then(|p_xml| extract_xml_tag_content(&p_xml, "name"));
            
        let is_current = snap.is_current(0).unwrap_or(false);
        
        list.push(SnapshotItem {
            name: snap_name,
            description,
            creation_time,
            state,
            parent,
            is_current,
        });
    }
    
    // Sort by creation time descending (newest first)
    list.sort_by(|a, b| b.creation_time.cmp(&a.creation_time));
    
    Ok(list)
}

#[tauri::command]
pub fn create_snapshot(vm_name: String, snapshot_name: String, description: Option<String>) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &vm_name)
        .map_err(|e| format!("VM not found: {}", e))?;
        
    let desc_xml = match description {
        Some(d) if !d.trim().is_empty() => format!("<description>{}</description>", d),
        _ => "".to_string(),
    };
    
    let xml = format!(
        r#"<domainsnapshot>
  <name>{}</name>
  {}
</domainsnapshot>"#,
        snapshot_name, desc_xml
    );
    
    virt::domain_snapshot::DomainSnapshot::create_xml(&dom, &xml, 0)
        .map(|_| ())
        .map_err(|e| format!("Failed to create snapshot: {}", e))
}

#[tauri::command]
pub fn revert_to_snapshot(vm_name: String, snapshot_name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &vm_name)
        .map_err(|e| format!("VM not found: {}", e))?;
        
    let snap = virt::domain_snapshot::DomainSnapshot::lookup_by_name(&dom, &snapshot_name, 0)
        .map_err(|e| format!("Snapshot not found: {}", e))?;
        
    snap.revert(0)
        .map_err(|e| format!("Failed to revert to snapshot: {}", e))
}

#[tauri::command]
pub fn delete_snapshot(vm_name: String, snapshot_name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &vm_name)
        .map_err(|e| format!("VM not found: {}", e))?;
        
    let snap = virt::domain_snapshot::DomainSnapshot::lookup_by_name(&dom, &snapshot_name, 0)
        .map_err(|e| format!("Snapshot not found: {}", e))?;
        
    snap.delete(0)
        .map_err(|e| format!("Failed to delete snapshot: {}", e))
}

