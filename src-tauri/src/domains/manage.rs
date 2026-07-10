use virt::domain::Domain;
use virt::storage_pool::StoragePool;
use virt::storage_vol::StorageVol;
use super::utils::{xml_escape, replace_tag_content};

#[tauri::command(async)]
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
        // 1 | 2 | 4 correspond to MANAGED_SAVE | SNAPSHOTS_METADATA | NVRAM
        if dom.undefine_flags(1 | 2 | 4).is_err() {
            dom.undefine().map_err(|e| format!("Failed to undefine VM: {}", e))?;
        }
        for path in paths {
            if let Ok(vol) = StorageVol::lookup_by_path(&conn, &path) {
                let _ = vol.delete(0);
            }
        }
    } else {
        if dom.undefine_flags(1 | 2 | 4).is_err() {
            dom.undefine().map_err(|e| format!("Failed to undefine VM: {}", e))?;
        }
    }

    Ok(())
}

#[tauri::command(async)]
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

    let escaped_name = xml_escape(&name);
    let escaped_vol_name = xml_escape(&vol_name);
    let escaped_disk_path = xml_escape(&disk_path);
    let escaped_iso_path = xml_escape(&iso_path);

    let vol_xml = format!(
        "<volume>\n  <name>{}</name>\n  <capacity>{}</capacity>\n  <target>\n    <format type='qcow2'/>\n  </target>\n</volume>",
        escaped_vol_name, size_bytes
    );
    StorageVol::create_xml(&pool, &vol_xml, 0)
        .map_err(|e| format!("Failed to create disk volume: {}", e))?;

    let memory_kb = memory_mb * 1024;
    let cdrom_block = if iso_path.is_empty() {
        "    <disk type='file' device='cdrom'>\n      <driver name='qemu' type='raw'/>\n      <target dev='sda' bus='sata'/>\n      <readonly/>\n    </disk>".to_string()
    } else {
        format!(
            "    <disk type='file' device='cdrom'>\n      <driver name='qemu' type='raw'/>\n      <source file='{}'/>\n      <target dev='sda' bus='sata'/>\n      <readonly/>\n      <boot order='1'/>\n    </disk>",
            escaped_iso_path
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
  <memoryBacking>
    <source type='memfd'/>
    <access mode='shared'/>
  </memoryBacking>
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
    <graphics type='vnc' autoport='yes' listen='127.0.0.1'>
      <listen type='address' address='127.0.0.1'/>
    </graphics>
    <video>
      <model type='virtio' heads='1' primary='yes'/>
    </video>
    <audio id='1' type='none'/>
    <input type='tablet' bus='usb'/>
    <input type='keyboard' bus='usb'/>
    <channel type='unix'>
      <target type='virtio' name='org.qemu.guest_agent.0'/>
    </channel>{tpm_block}
    <memballoon model='virtio'/>
    <rng model='virtio'>
      <backend model='random'>/dev/urandom</backend>
    </rng>
  </devices>
</domain>"#,
        name = escaped_name,
        memory_kb = memory_kb,
        vcpu = vcpu,
        disk_path = escaped_disk_path,
        cdrom_block = cdrom_block,
        disk_boot_order = disk_boot_order,
        os_firmware_attr = os_firmware_attr,
        firmware_block = firmware_block,
        smm_block = smm_block,
        tpm_block = tpm_block,
    );

    match Domain::define_xml(&conn, &domain_xml) {
        Ok(_) => Ok(()),
        Err(e) => {
            // Cleanup: delete the created volume since definition failed
            if let Ok(vol) = StorageVol::lookup_by_path(&conn, &disk_path) {
                let _ = vol.delete(0);
            }
            Err(format!("Failed to define VM: {}", e))
        }
    }
}

fn random_mac() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    format!("52:54:00:{:02x}:{:02x}:{:02x}", 
        rng.gen::<u8>(),
        rng.gen::<u8>(),
        rng.gen::<u8>()
    )
}

fn find_pool_for_volume(conn: &virt::connect::Connect, vol_path: &str) -> Result<StoragePool, String> {
    if let Ok(vol) = StorageVol::lookup_by_path(conn, vol_path) {
        if let Ok(pool) = StoragePool::lookup_by_volume(&vol) {
            return Ok(pool);
        }
    }
    
    let pools = conn.list_all_storage_pools(0)
        .map_err(|e| format!("Failed to list storage pools: {}", e))?;
        
    for pool in pools {
        if !pool.is_active().unwrap_or(false) {
            continue;
        }
        if let Ok(xml) = pool.get_xml_desc(0) {
            if let Some(idx) = xml.find("<path>") {
                let tail = &xml[idx + 6..];
                if let Some(end) = tail.find("</path>") {
                    let pool_path = tail[..end].trim().to_string();
                    let canonical_pool = std::fs::canonicalize(&pool_path)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or(pool_path.clone());
                    let canonical_vol = std::fs::canonicalize(vol_path)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or(vol_path.to_string());
                    if canonical_vol.starts_with(&canonical_pool) {
                        return Ok(pool);
                    }
                }
            }
        }
    }
    Err(format!("Could not find storage pool for volume path: {}", vol_path))
}

fn get_domain_xml_from_snapshot(snap_xml: &str) -> Option<String> {
    let start_idx = snap_xml.find("<domain ")
        .or_else(|| snap_xml.find("<domain>"))?;
    let end_idx = snap_xml[start_idx..].find("</domain>")?;
    Some(snap_xml[start_idx..start_idx + end_idx + 9].to_string())
}

#[tauri::command(async)]
pub fn clone_vm(source_name: String, new_name: String, clone_type: String, snapshot_name: Option<String>) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &source_name)
        .map_err(|e| format!("Source VM not found: {}", e))?;

    // Deletion and cloning is restricted to powered-off VMs
    let state = dom.get_state().map(|(s, _)| s).unwrap_or(0);
    if state == 1 /* VIR_DOMAIN_RUNNING */ || state == 3 /* VIR_DOMAIN_PAUSED */ {
        return Err("Source VM must be powered off to clone it.".to_string());
    }

    let snap_name = snapshot_name.as_deref().unwrap_or("");
    let use_snapshot = !snap_name.is_empty();

    // Get XML configuration
    let xml = if use_snapshot {
        let snap = virt::domain_snapshot::DomainSnapshot::lookup_by_name(&dom, &snap_name, 0)
            .map_err(|e| format!("Snapshot '{}' not found: {}", snap_name, e))?;
        let snap_xml = snap.get_xml_desc(0)
            .map_err(|e| format!("Failed to read snapshot XML: {}", e))?;
        get_domain_xml_from_snapshot(&snap_xml)
            .ok_or_else(|| "Could not extract <domain> configuration from snapshot XML".to_string())?
    } else {
        dom.get_xml_desc(2)
            .or_else(|_| dom.get_xml_desc(0))
            .map_err(|e| format!("Failed to read XML: {}", e))?
    };

    // Collect disk paths of the source VM
    let mut disks: Vec<String> = Vec::new();
    let mut search = xml.as_str();
    while let Some(src_idx) = search.find("<source file='") {
        let rest = &search[src_idx + 14..];
        if let Some(end) = rest.find('\'') {
            let path = &rest[..end];
            if path.ends_with(".qcow2") || path.ends_with(".img") || path.ends_with(".raw") {
                disks.push(path.to_string());
            }
        }
        search = &search[src_idx + 14..];
    }
    
    // Also scan for double quotes
    let mut search_dq = xml.as_str();
    while let Some(src_idx) = search_dq.find("<source file=\"") {
        let rest = &search_dq[src_idx + 14..];
        if let Some(end) = rest.find('"') {
            let path = &rest[..end];
            if path.ends_with(".qcow2") || path.ends_with(".img") || path.ends_with(".raw") {
                if !disks.contains(&path.to_string()) {
                    disks.push(path.to_string());
                }
            }
        }
        search_dq = &search_dq[src_idx + 14..];
    }

    let mut new_disk_paths = Vec::new();
    let mut created_volumes = Vec::new();

    for (idx, src_path) in disks.iter().enumerate() {
        let vol = StorageVol::lookup_by_path(&conn, src_path)
            .map_err(|e| format!("Failed to look up storage volume for path '{}': {}", src_path, e))?;
            
        let pool = find_pool_for_volume(&conn, src_path)?;
        
        let pool_xml = pool.get_xml_desc(0).unwrap_or_default();
        let pool_path = if let Some(idx) = pool_xml.find("<path>") {
            let tail = &pool_xml[idx + 6..];
            tail[..tail.find("</path>").unwrap_or(0)].trim().to_string()
        } else {
            "/var/lib/libvirt/images".to_string()
        };

        // Create new disk name and path
        let suffix = if src_path.ends_with(".qcow2") {
            "qcow2"
        } else if src_path.ends_with(".img") {
            "img"
        } else {
            "raw"
        };
        
        let new_vol_name = if disks.len() > 1 {
            format!("{}-{}.{}", new_name, idx, suffix)
        } else {
            format!("{}.{}", new_name, suffix)
        };
        let new_disk_path = format!("{}/{}", pool_path.trim_end_matches('/'), new_vol_name);

        let vol_xml_desc = vol.get_xml_desc(0).unwrap_or_default();
        let capacity = vol.get_info().map(|i| i.capacity).unwrap_or(10 * 1024 * 1024 * 1024);

        if use_snapshot {
            // Force full clone with qemu-img convert when cloning from snapshot
            let format_type = if vol_xml_desc.contains("<format type='raw'/>") { "raw" } else { "qcow2" };
            let vol_xml = format!(
                "<volume>\n  <name>{}</name>\n  <capacity>{}</capacity>\n  <target>\n    <format type='{}'/>\n  </target>\n</volume>",
                xml_escape(&new_vol_name), capacity, format_type
            );
            match StorageVol::create_xml(&pool, &vol_xml, 0) {
                Ok(new_vol) => {
                    let output = std::process::Command::new("sudo")
                        .arg("qemu-img")
                        .arg("convert")
                        .arg("-f")
                        .arg("qcow2")
                        .arg("-O")
                        .arg("qcow2")
                        .arg("-l")
                        .arg(&snap_name)
                        .arg(src_path)
                        .arg(&new_disk_path)
                        .output();
                    
                    match output {
                        Ok(out) if out.status.success() => {
                            created_volumes.push(new_vol);
                            new_disk_paths.push((src_path.clone(), new_disk_path));
                        }
                        Ok(out) => {
                            let err_msg = String::from_utf8_lossy(&out.stderr).into_owned();
                            let _ = new_vol.delete(0);
                            for v in &created_volumes {
                                let _ = v.delete(0);
                            }
                            return Err(format!("qemu-img convert failed: {}", err_msg));
                        }
                        Err(e) => {
                            let _ = new_vol.delete(0);
                            for v in &created_volumes {
                                let _ = v.delete(0);
                            }
                            return Err(format!("Failed to run qemu-img convert: {}", e));
                        }
                    }
                }
                Err(e) => {
                    for v in &created_volumes {
                        let _ = v.delete(0);
                    }
                    return Err(format!("Failed to create storage volume: {}", e));
                }
            }
        } else if clone_type == "linked" {
            // Linked clone requires qcow2 target
            let vol_xml = format!(
                "<volume>\n  <name>{}</name>\n  <capacity>{}</capacity>\n  <target>\n    <format type='qcow2'/>\n  </target>\n  <backingStore>\n    <path>{}</path>\n    <format type='qcow2'/>\n  </backingStore>\n</volume>",
                xml_escape(&new_vol_name), capacity, xml_escape(src_path)
            );
            match StorageVol::create_xml(&pool, &vol_xml, 0) {
                Ok(new_vol) => {
                    created_volumes.push(new_vol);
                    new_disk_paths.push((src_path.clone(), new_disk_path));
                }
                Err(e) => {
                    // Cleanup already created volumes
                    for v in &created_volumes {
                        let _ = v.delete(0);
                    }
                    return Err(format!("Failed to create linked volume: {}", e));
                }
            }
        } else {
            // Full clone
            let format_type = if vol_xml_desc.contains("<format type='raw'/>") { "raw" } else { "qcow2" };
            let vol_xml = format!(
                "<volume>\n  <name>{}</name>\n  <capacity>{}</capacity>\n  <target>\n    <format type='{}'/>\n  </target>\n</volume>",
                xml_escape(&new_vol_name), capacity, format_type
            );
            match StorageVol::create_xml_from(&pool, &vol_xml, &vol, 0) {
                Ok(new_vol) => {
                    created_volumes.push(new_vol);
                    new_disk_paths.push((src_path.clone(), new_disk_path));
                }
                Err(e) => {
                    // Cleanup already created volumes
                    for v in &created_volumes {
                        let _ = v.delete(0);
                    }
                    return Err(format!("Failed to clone volume: {}", e));
                }
            }
        }
    }

    // Modify the XML configuration
    let mut new_xml = xml;
    new_xml = replace_tag_content(&new_xml, "name", &new_name);

    // Remove UUID block
    if let Some(uuid_start) = new_xml.find("<uuid>") {
        if let Some(uuid_end) = new_xml[uuid_start..].find("</uuid>") {
            let actual_end = uuid_start + uuid_end + 7;
            new_xml.replace_range(uuid_start..actual_end, "");
        }
    }

    // Replace disk paths
    for (old_path, new_path) in &new_disk_paths {
        let old_source = format!("<source file='{}'", old_path);
        let new_source = format!("<source file='{}'", new_path);
        new_xml = new_xml.replace(&old_source, &new_source);
        let old_source_dq = format!("<source file=\"{}\"", old_path);
        let new_source_dq = format!("<source file=\"{}\"", new_path);
        new_xml = new_xml.replace(&old_source_dq, &new_source_dq);
    }

    // Replace MAC addresses
    let mut start = 0;
    while let Some(mac_idx) = new_xml[start..].find("<mac address=") {
        let abs_idx = start + mac_idx;
        let block = &new_xml[abs_idx..];
        let quote_char = if block.starts_with("<mac address='") { '\'' } else { '"' };
        let prefix_len = if quote_char == '\'' { "<mac address='".len() } else { "<mac address=\"".len() };
        if let Some(end_quote) = block[prefix_len..].find(quote_char) {
            let new_mac = random_mac();
            let target_range = abs_idx + prefix_len .. abs_idx + prefix_len + end_quote;
            new_xml.replace_range(target_range, &new_mac);
            start = abs_idx + prefix_len + new_mac.len() + 1;
        } else {
            start = abs_idx + 1;
        }
    }

    // Define the new VM
    match Domain::define_xml(&conn, &new_xml) {
        Ok(_) => Ok(()),
        Err(e) => {
            // Cleanup created volumes
            for v in created_volumes {
                let _ = v.delete(0);
            }
            Err(format!("Failed to define cloned VM: {}", e))
        }
    }
}
