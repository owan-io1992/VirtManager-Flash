use serde::{Serialize, Deserialize};
use virt::storage_pool::StoragePool;
use virt::storage_vol::StorageVol;

#[derive(Serialize, Deserialize, Clone)]
pub struct IsoFile {
    pub path: String,
    pub name: String,
    pub pool_name: String,
}

#[tauri::command(async)]
pub fn list_iso_files() -> Result<Vec<IsoFile>, String> {
    let conn = crate::connect_libvirt()?;
    let pools = conn.list_all_storage_pools(0)
        .map_err(|e| format!("Failed to list storage pools: {}", e))?;

    let mut isos = Vec::new();
    for pool in pools {
        if !pool.is_active().unwrap_or(false) {
            continue;
        }
        let _ = pool.refresh(0);
        let pool_name = pool.get_name().unwrap_or_default();
        if let Ok(vols) = pool.list_all_volumes(0) {
            for vol in vols {
                let vol_name = vol.get_name().unwrap_or_default();
                if vol_name.to_lowercase().ends_with(".iso") {
                    let path = vol.get_path().unwrap_or_default();
                    isos.push(IsoFile {
                        name: vol_name,
                        path,
                        pool_name: pool_name.clone(),
                    });
                }
            }
        }
    }

    // Also scan common non-pool ISO locations
    let extra_dirs = ["/var/lib/libvirt/boot", "/home"];
    for dir in &extra_dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase() == "iso").unwrap_or(false) {
                    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let path_str = path.to_string_lossy().to_string();
                    if !isos.iter().any(|i: &IsoFile| i.path == path_str) {
                        isos.push(IsoFile { name, path: path_str, pool_name: String::new() });
                    }
                }
            }
        }
    }

    Ok(isos)
}

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

#[tauri::command(async)]
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
            let _ = pool.refresh(0);
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

#[tauri::command(async)]
pub fn start_storage_pool(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let pool = StoragePool::lookup_by_name(&conn, &name)
        .map_err(|e| format!("Storage pool not found: {}", e))?;
    pool.create(0)
        .map(|_| ())
        .map_err(|e| format!("Failed to start storage pool: {}", e))
}

#[tauri::command(async)]
pub fn stop_storage_pool(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let pool = StoragePool::lookup_by_name(&conn, &name)
        .map_err(|e| format!("Storage pool not found: {}", e))?;
    pool.destroy()
        .map(|_| ())
        .map_err(|e| format!("Failed to stop storage pool: {}", e))
}

#[tauri::command(async)]
pub fn delete_storage_pool(name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let pool = StoragePool::lookup_by_name(&conn, &name)
        .map_err(|e| format!("Storage pool not found: {}", e))?;
    if pool.is_active().unwrap_or(false) {
        let _ = pool.destroy();
    }
    pool.undefine()
        .map(|_| ())
        .map_err(|e| format!("Failed to delete storage pool: {}", e))
}

#[tauri::command(async)]
pub fn create_storage_pool(name: String, path: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;

    let xml = format!(
        "<pool type='dir'>\n  <name>{}</name>\n  <target>\n    <path>{}</path>\n  </target>\n</pool>",
        name, path
    );

    let pool = StoragePool::define_xml(&conn, &xml, 0)
        .map_err(|e| format!("Failed to define storage pool: {}", e))?;

    // Try to build the pool directory
    pool.build(0).ok();
    pool.set_autostart(true).ok();
    pool.create(0)
        .map(|_| ())
        .map_err(|e| format!("Pool defined but failed to start: {}", e))
}

#[tauri::command(async)]
pub fn create_volume(pool_name: String, vol_name: String, size_gb: u64, format: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let pool = StoragePool::lookup_by_name(&conn, &pool_name)
        .map_err(|e| format!("Storage pool not found: {}", e))?;

    let size_bytes = size_gb * 1024 * 1024 * 1024;
    let fmt = if format.is_empty() { "qcow2" } else { &format };

    let xml = format!(
        "<volume>\n  <name>{}</name>\n  <capacity>{}</capacity>\n  <target>\n    <format type='{}'/>\n  </target>\n</volume>",
        vol_name, size_bytes, fmt
    );

    StorageVol::create_xml(&pool, &xml, 0)
        .map(|_| ())
        .map_err(|e| format!("Failed to create volume: {}", e))
}

#[tauri::command(async)]
pub fn delete_volume(pool_name: String, vol_name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let pool = StoragePool::lookup_by_name(&conn, &pool_name)
        .map_err(|e| format!("Storage pool not found: {}", e))?;

    let vol = StorageVol::lookup_by_name(&pool, &vol_name)
        .map_err(|e| format!("Volume not found: {}", e))?;

    vol.delete(0)
        .map(|_| ())
        .map_err(|e| format!("Failed to delete volume: {}", e))
}

#[tauri::command(async)]
pub fn resize_volume(pool_name: String, vol_name: String, new_size_gb: u64) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let pool = StoragePool::lookup_by_name(&conn, &pool_name)
        .map_err(|e| format!("Storage pool not found: {}", e))?;

    let vol = StorageVol::lookup_by_name(&pool, &vol_name)
        .map_err(|e| format!("Volume not found: {}", e))?;

    let size_bytes = new_size_gb * 1024 * 1024 * 1024;
    vol.resize(size_bytes, 0)
        .map(|_| ())
        .map_err(|e| format!("Failed to resize volume: {}", e))
}

