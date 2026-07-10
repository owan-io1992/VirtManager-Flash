use virt::domain::Domain;

/// Send an arbitrary QEMU guest agent command and return the raw response.
#[tauri::command(async)]
pub fn qemu_agent_command(name: String, cmd: String) -> Result<String, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.qemu_agent_command(&cmd, 10, 0)
        .map_err(|e| format!("Agent command failed: {}", e))
}

/// Return raw memory stats tags and values for debugging.
#[tauri::command(async)]
pub fn debug_memory_stats(name: String) -> Result<Vec<(i32, u64)>, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    let stats = dom.memory_stats(0)
        .map_err(|e| format!("Failed to get memory stats: {}", e))?;
    Ok(stats.iter().map(|s| (s.tag as i32, s.val)).collect())
}

/// Check whether the QEMU guest agent is actively running in the VM.
/// Sends guest-ping with a short timeout; retries once on failure. A missing
/// agent fails immediately; the timeout only bounds a stuck agent, so keep it
/// small — this command holds the shared libvirt connection while it waits.
#[tauri::command(async)]
pub fn check_guest_agent(name: String) -> Result<bool, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;

    for _ in 0..2 {
        if dom.qemu_agent_command(r#"{"execute":"guest-ping"}"#, 2, 0).is_ok() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Query the IP addresses of a running VM.
#[tauri::command(async)]
pub fn get_vm_ip_addresses(name: String) -> Result<Vec<String>, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;

    let mut ips = Vec::new();

    // 1. Try Guest Agent
    if let Ok(interfaces) = dom.interface_addresses(virt::sys::VIR_DOMAIN_INTERFACE_ADDRESSES_SRC_AGENT, 0) {
        for iface in interfaces {
            for addr in iface.addrs {
                if addr.addr != "127.0.0.1" && addr.addr != "::1" {
                    ips.push(addr.addr);
                }
            }
        }
    }

    // 2. Try DHCP Leases
    if ips.is_empty() {
        if let Ok(interfaces) = dom.interface_addresses(virt::sys::VIR_DOMAIN_INTERFACE_ADDRESSES_SRC_LEASE, 0) {
            for iface in interfaces {
                for addr in iface.addrs {
                    if addr.addr != "127.0.0.1" && addr.addr != "::1" {
                        ips.push(addr.addr);
                    }
                }
            }
        }
    }

    // 3. Try ARP Tables
    if ips.is_empty() {
        if let Ok(interfaces) = dom.interface_addresses(virt::sys::VIR_DOMAIN_INTERFACE_ADDRESSES_SRC_ARP, 0) {
            for iface in interfaces {
                for addr in iface.addrs {
                    if addr.addr != "127.0.0.1" && addr.addr != "::1" {
                        ips.push(addr.addr);
                    }
                }
            }
        }
    }

    ips.sort();
    ips.dedup();
    Ok(ips)
}
