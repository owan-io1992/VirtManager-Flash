use serde::{Serialize, Deserialize};
use virt::network::Network;

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

#[tauri::command]
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
            
        let subnet = if let Some(ip) = ip_addr {
            if let Some(last_dot) = ip.rfind('.') {
                format!("{}.0/{}", &ip[..last_dot], prefix)
            } else {
                format!("{}/{}", ip, prefix)
            }
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

#[tauri::command]
pub fn start_network(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let net = Network::lookup_by_name(&conn, &name)
        .map_err(|e| format!("Network not found: {}", e))?;
    net.create()
        .map(|_| ())
        .map_err(|e| format!("Failed to start network: {}", e))
}

#[tauri::command]
pub fn stop_network(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let net = Network::lookup_by_name(&conn, &name)
        .map_err(|e| format!("Network not found: {}", e))?;
    net.destroy()
        .map(|_| ())
        .map_err(|e| format!("Failed to stop network: {}", e))
}

#[tauri::command]
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

#[tauri::command]
pub fn create_network(name: String, subnet: String, dhcp_start: String, dhcp_end: String, forward_mode: String) -> Result<(), String> {
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

    let forward_xml = if forward_mode.is_empty() || forward_mode.to_lowercase() == "isolated" {
        String::new()
    } else {
        format!("  <forward mode='{}'/>\n", forward_mode.to_lowercase())
    };

    let dhcp_xml = if dhcp_start.is_empty() || dhcp_end.is_empty() {
        String::new()
    } else {
        format!("    <dhcp>\n      <range start='{}' end='{}'/>\n    </dhcp>\n", dhcp_start, dhcp_end)
    };

    let xml = format!(
        "<network>\n  <name>{}</name>\n{}\
         <bridge name='virbr-{}' stp='on' delay='0'/>\n  \
         <ip address='{}' prefix='{}'>\n{}\
         </ip>\n</network>",
        name, forward_xml, name, gateway, prefix, dhcp_xml
    );

    let net = Network::define_xml(&conn, &xml)
        .map_err(|e| format!("Failed to define network: {}", e))?;
    net.set_autostart(true).ok();
    net.create()
        .map(|_| ())
        .map_err(|e| format!("Network defined but failed to start: {}", e))
}
