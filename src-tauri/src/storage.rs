use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct VolumeItem {
    pub name: String,
    pub size: String,
    pub format: String,
    pub used_by: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StoragePoolItem {
    pub id: String,
    pub name: String,
    pub pool_type: String,
    pub size_gb: u64,
    pub used_gb: u64,
    pub location: String,
    pub state: String,
    pub autostart: bool,
    pub volumes: Vec<VolumeItem>,
}

#[tauri::command]
pub fn list_storage_pools() -> Result<Vec<StoragePoolItem>, String> {
    let conn = crate::connect_libvirt()?;
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
        
        if let Some(t) = crate::extract_xml_tag_attr(&xml, "<pool type='", "type") {
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
                        if let Some(f) = crate::extract_xml_tag_attr(&vol_xml, "<format type='", "type") {
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
