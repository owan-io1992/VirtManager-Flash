use serde::{Serialize, Deserialize};
use virt::network::Network;
use crate::domains::xml_escape;

#[derive(Serialize, Deserialize, Clone)]
pub struct NetworkItem {
    pub id: String,
    pub name: String,
    pub device: String,
    pub state: String,
    pub autostart: bool,
    pub subnet: String,
    pub dhcp_start: String,
    pub dhcp_end: String,
    pub forwarding: String,
}

fn get_subnet_address(ip_str: &str, prefix_str: &str) -> String {
    let prefix = prefix_str.parse::<u8>().unwrap_or(24);
    let ip_parts: Vec<u8> = ip_str.split('.')
        .map(|p| p.parse::<u8>().unwrap_or(0))
        .collect();
    if ip_parts.len() != 4 {
        return format!("{}/{}", ip_str, prefix_str);
    }
    let ip_num = ((ip_parts[0] as u32) << 24) |
                 ((ip_parts[1] as u32) << 16) |
                 ((ip_parts[2] as u32) << 8)  |
                 (ip_parts[3] as u32);
    let mask = if prefix == 0 { 0 } else { !0u32 << (32 - prefix) };
    let net_num = ip_num & mask;
    let net_parts = [
        ((net_num >> 24) & 0xFF) as u8,
        ((net_num >> 16) & 0xFF) as u8,
        ((net_num >> 8) & 0xFF) as u8,
        (net_num & 0xFF) as u8,
    ];
    format!("{}.{}.{}.{}/{}", net_parts[0], net_parts[1], net_parts[2], net_parts[3], prefix)
}

#[tauri::command(async)]
pub fn list_networks() -> Result<Vec<NetworkItem>, String> {
    let conn = crate::connect_libvirt()?;
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
        
        let ip_addr = crate::extract_xml_tag_attr(&xml, "<ip address='", "address")
            .or_else(|| crate::extract_xml_tag_attr(&xml, "<ip address=\"", "address"));
            
        let prefix = crate::extract_xml_tag_attr(&xml, "prefix='", "prefix")
            .or_else(|| crate::extract_xml_tag_attr(&xml, "prefix=\"", "prefix"))
            .unwrap_or_else(|| "24".to_string());
            
        let subnet = if let Some(ref ip) = ip_addr {
            get_subnet_address(ip, &prefix)
        } else {
            "Disabled".to_string()
        };
        
        let dhcp_start = crate::extract_xml_tag_attr(&xml, "<range", "start");
        let dhcp_end = crate::extract_xml_tag_attr(&xml, "<range", "end");
            
        let (start, end) = match (dhcp_start, dhcp_end) {
            (Some(s), Some(e)) => (s, e),
            _ => ("Disabled".to_string(), "Disabled".to_string()),
        };
        
        let fwd_mode = crate::extract_xml_tag_attr(&xml, "<forward mode='", "mode")
            .or_else(|| crate::extract_xml_tag_attr(&xml, "<forward mode=\"", "mode"))
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

#[tauri::command(async)]
pub fn start_network(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let net = Network::lookup_by_name(&conn, &name)
        .map_err(|e| format!("Network not found: {}", e))?;
    net.create()
        .map(|_| ())
        .map_err(|e| format!("Failed to start network: {}", e))
}

#[tauri::command(async)]
pub fn stop_network(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let net = Network::lookup_by_name(&conn, &name)
        .map_err(|e| format!("Network not found: {}", e))?;
    net.destroy()
        .map(|_| ())
        .map_err(|e| format!("Failed to stop network: {}", e))
}

#[tauri::command(async)]
pub fn delete_network(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let net = Network::lookup_by_name(&conn, &name)
        .map_err(|e| format!("Network not found: {}", e))?;
    // Stop if active before undefining
    if net.is_active().unwrap_or(false) {
        let _ = net.destroy();
    }
    net.undefine()
        .map(|_| ())
        .map_err(|e| format!("Failed to delete network: {}", e))
}

#[tauri::command(async)]
pub fn create_network(name: String, subnet: String, dhcp_start: String, dhcp_end: String, forward_mode: String) -> Result<(), String> {
    // Linux bridge interface name limit is 15 chars. "virbr-" is 6 chars, so name can be at most 9 chars.
    if name.len() > 9 {
        return Err("Network name is too long. To fit Linux bridge limits (15 characters), it must not exceed 9 characters.".to_string());
    }

    let conn = crate::connect_libvirt()?;

    // Parse subnet like "192.168.100.0/24"
    let parts: Vec<&str> = subnet.split('/').collect();
    let ip_addr = parts.first().unwrap_or(&"192.168.100.0");
    let prefix = parts.get(1).unwrap_or(&"24");

    // Derive gateway from subnet (replace last octet with 1)
    let gateway = if let Some(last_dot) = ip_addr.rfind('.') {
        format!("{}1", &ip_addr[..=last_dot])
    } else {
        ip_addr.to_string()
    };

    let escaped_name = xml_escape(&name);
    let escaped_forward_mode = xml_escape(&forward_mode.to_lowercase());
    let escaped_gateway = xml_escape(&gateway);
    let escaped_prefix = xml_escape(prefix);
    let escaped_dhcp_start = xml_escape(&dhcp_start);
    let escaped_dhcp_end = xml_escape(&dhcp_end);

    let forward_xml = if forward_mode.is_empty() || forward_mode.to_lowercase() == "isolated" {
        String::new()
    } else {
        format!("  <forward mode='{}'/>\n", escaped_forward_mode)
    };

    let dhcp_xml = if dhcp_start.is_empty() || dhcp_end.is_empty() {
        String::new()
    } else {
        format!("    <dhcp>\n      <range start='{}' end='{}'/>\n    </dhcp>\n", escaped_dhcp_start, escaped_dhcp_end)
    };

    let xml = format!(
        "<network>\n  <name>{}</name>\n{}\
         <bridge name='virbr-{}' stp='on' delay='0'/>\n  \
         <ip address='{}' prefix='{}'>\n{}\
         </ip>\n</network>",
        escaped_name, forward_xml, escaped_name, escaped_gateway, escaped_prefix, dhcp_xml
    );

    let net = Network::define_xml(&conn, &xml)
        .map_err(|e| format!("Failed to define network: {}", e))?;
    net.set_autostart(true).ok();
    net.create()
        .map(|_| ())
        .map_err(|e| format!("Network defined but failed to start: {}", e))
}
