use virt::domain::Domain;
use super::types::SnapshotItem;
use super::utils::{xml_escape, extract_xml_tag_content};

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn create_snapshot(vm_name: String, snapshot_name: String, description: Option<String>) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &vm_name)
        .map_err(|e| format!("VM not found: {}", e))?;
        
    let escaped_name = xml_escape(&snapshot_name);
    let desc_xml = match description {
        Some(d) if !d.trim().is_empty() => format!("<description>{}</description>", xml_escape(&d)),
        _ => "".to_string(),
    };
    
    let xml = format!(
        r#"<domainsnapshot>
  <name>{}</name>
  {}
</domainsnapshot>"#,
        escaped_name, desc_xml
    );
    
    virt::domain_snapshot::DomainSnapshot::create_xml(&dom, &xml, 0)
        .map(|_| ())
        .map_err(|e| format!("Failed to create snapshot: {}", e))
}

#[tauri::command(async)]
pub fn revert_to_snapshot(vm_name: String, snapshot_name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &vm_name)
        .map_err(|e| format!("VM not found: {}", e))?;
        
    let snap = virt::domain_snapshot::DomainSnapshot::lookup_by_name(&dom, &snapshot_name, 0)
        .map_err(|e| format!("Snapshot not found: {}", e))?;
        
    snap.revert(0)
        .map_err(|e| format!("Failed to revert to snapshot: {}", e))
}

#[tauri::command(async)]
pub fn delete_snapshot(vm_name: String, snapshot_name: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &vm_name)
        .map_err(|e| format!("VM not found: {}", e))?;
        
    let snap = virt::domain_snapshot::DomainSnapshot::lookup_by_name(&dom, &snapshot_name, 0)
        .map_err(|e| format!("Snapshot not found: {}", e))?;
        
    snap.delete(0)
        .map_err(|e| format!("Failed to delete snapshot: {}", e))
}
