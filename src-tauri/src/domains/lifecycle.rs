use virt::domain::Domain;
use super::types::DomainItem;
use super::utils::{collect_blocks, get_attr_in_block};

#[tauri::command(async)]
pub fn list_domains(include_stats: Option<bool>) -> Result<Vec<DomainItem>, String> {
    static CONFIGURED_DOMAINS: std::sync::Mutex<Option<std::collections::HashMap<String, u32>>> = std::sync::Mutex::new(None);
    static DEVICE_CACHE: std::sync::Mutex<Option<std::collections::HashMap<String, (u32, Vec<String>, Vec<String>)>>> = std::sync::Mutex::new(None);

    let include_stats = include_stats.unwrap_or(true);
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
            if include_stats {
                // Enable balloon memory stats collection (once per VM session/execution)
                if let Some(dom_id) = id {
                    let mut lock = CONFIGURED_DOMAINS.lock().unwrap();
                    let map = lock.get_or_insert_with(std::collections::HashMap::new);
                    let needs_setup = match map.get(&name) {
                        Some(&cached_id) => cached_id != dom_id,
                        None => true,
                    };
                    if needs_setup {
                        if dom.set_memory_stats_period(2, 0).is_ok() {
                            map.insert(name.clone(), dom_id);
                        }
                    }
                }
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
                
                // Get disk and network stats with device cache
                let mut disks = Vec::new();
                let mut interfaces = Vec::new();
                let mut cache_hit = false;

                if let Some(dom_id) = id {
                    let mut lock = DEVICE_CACHE.lock().unwrap();
                    let cache = lock.get_or_insert_with(std::collections::HashMap::new);
                    if let Some((cached_id, cached_disks, cached_interfaces)) = cache.get(&name) {
                        if *cached_id == dom_id {
                            disks = cached_disks.clone();
                            interfaces = cached_interfaces.clone();
                            cache_hit = true;
                        }
                    }
                }

                if !cache_hit {
                    if let Ok(xml) = dom.get_xml_desc(0) {
                        for block in collect_blocks(&xml, "<disk", "</disk>") {
                            if let Some(target_dev) = get_attr_in_block(&block, "<target", "dev") {
                                disks.push(target_dev);
                            }
                        }
                        for block in collect_blocks(&xml, "<interface", "</interface>") {
                            if let Some(target_dev) = get_attr_in_block(&block, "<target", "dev") {
                                interfaces.push(target_dev);
                            }
                        }
                        if let Some(dom_id) = id {
                            let mut lock = DEVICE_CACHE.lock().unwrap();
                            let cache = lock.get_or_insert_with(std::collections::HashMap::new);
                            cache.insert(name.clone(), (dom_id, disks.clone(), interfaces.clone()));
                        }
                    }
                }

                for target_dev in &disks {
                    if let Ok(stats) = dom.get_block_stats(target_dev) {
                        disk_rd_req += stats.rd_req;
                        disk_rd_bytes += stats.rd_bytes;
                        disk_wr_req += stats.wr_req;
                        disk_wr_bytes += stats.wr_bytes;
                    }
                }

                for target_dev in &interfaces {
                    if let Ok(stats) = dom.interface_stats(target_dev) {
                        net_rx_bytes += stats.rx_bytes;
                        net_rx_packets += stats.rx_packets;
                        net_tx_bytes += stats.tx_bytes;
                        net_tx_packets += stats.tx_packets;
                    }
                }
            }
        } else {
            // Remove name from CONFIGURED_DOMAINS if present so it will be re-set when restarted
            if let Ok(mut lock) = CONFIGURED_DOMAINS.lock() {
                if let Some(map) = lock.as_mut() {
                    map.remove(&name);
                }
            }
            // Clear DEVICE_CACHE for this domain name
            if let Ok(mut lock) = DEVICE_CACHE.lock() {
                if let Some(cache) = lock.as_mut() {
                    cache.remove(&name);
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

    // Clean up caches for deleted/renamed VMs that are no longer in the list
    let active_names: std::collections::HashSet<String> = list.iter().map(|item| item.name.clone()).collect();
    if let Ok(mut lock) = CONFIGURED_DOMAINS.lock() {
        if let Some(map) = lock.as_mut() {
            map.retain(|name, _| active_names.contains(name));
        }
    }
    if let Ok(mut lock) = DEVICE_CACHE.lock() {
        if let Some(cache) = lock.as_mut() {
            cache.retain(|name, _| active_names.contains(name));
        }
    }

    Ok(list)
}

#[tauri::command(async)]
pub fn start_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.create()
        .map(|_| ())
        .map_err(|e| format!("Failed to start VM: {}", e))
}

#[tauri::command(async)]
pub fn shutdown_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.shutdown()
        .map(|_| ())
        .map_err(|e| format!("Failed to shutdown VM: {}", e))
}

#[tauri::command(async)]
pub fn stop_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.destroy()
        .map(|_| ())
        .map_err(|e| format!("Failed to force stop VM: {}", e))
}

#[tauri::command(async)]
pub fn suspend_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.suspend()
        .map(|_| ())
        .map_err(|e| format!("Failed to suspend VM: {}", e))
}

#[tauri::command(async)]
pub fn resume_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.resume()
        .map(|_| ())
        .map_err(|e| format!("Failed to resume VM: {}", e))
}

#[tauri::command(async)]
pub fn reboot_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.reboot(0)
        .map(|_| ())
        .map_err(|e| format!("Failed to reboot VM: {}", e))
}

#[tauri::command(async)]
pub fn reset_domain(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.reset()
        .map(|_| ())
        .map_err(|e| format!("Failed to reset VM: {}", e))
}
