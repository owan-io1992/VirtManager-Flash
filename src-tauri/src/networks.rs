use serde::{Serialize, Deserialize};

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
        
        let dhcp_start = crate::extract_xml_tag_attr(&xml, "<range start='", "start")
            .or_else(|| crate::extract_xml_tag_attr(&xml, "<range start=\"", "start"));
            
        let dhcp_end = crate::extract_xml_tag_attr(&xml, "end='", "end")
            .or_else(|| crate::extract_xml_tag_attr(&xml, "end=\"", "end"));
            
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
