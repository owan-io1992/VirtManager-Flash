use virt::domain::Domain;
use virt::storage_vol::StorageVol;
use super::types::{DiskInfo, NicInfo, FilesystemInfo, VmSettings};
use super::utils::*;

const VIRTMANAGER_FLASH_OS_NS: &str = "https://virtmanager-flash.app/xmlns/os/1.0";
const METADATA_ELEMENT: i32 = 2;
const AFFECT_CONFIG: u32 = 2;
const AFFECT_LIVE_CONFIG: u32 = 3;

fn update_block_boot_order(block: &str, boot_order: Option<u32>) -> String {
    let mut b = block.to_string();
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
            None => "".to_string(),
        }
    });

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

fn update_disks_xml(xml: &str, disks: &[DiskInfo], boot_devices: &[String]) -> String {
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
                if disk.path.is_empty() {
                    if let Some(src_start) = b.find("<source") {
                        if let Some(rel_end) = b[src_start..].find("/>") {
                            let end = src_start + rel_end + 2;
                            let mut cleaned = String::new();
                            cleaned.push_str(&b[..src_start]);
                            cleaned.push_str(&b[end..]);
                            b = cleaned;
                        }
                    }
                } else {
                    if b.contains("file=") {
                        b = replace_attr_in_block(&b, "<source", "file", &disk.path);
                    } else if b.contains("dev=") {
                        b = replace_attr_in_block(&b, "<source", "dev", &disk.path);
                    } else {
                        if let Some(tgt_idx) = b.find("<target") {
                            let mut new_b = String::new();
                            new_b.push_str(&b[..tgt_idx]);
                            new_b.push_str(&format!("<source file='{}'/>\n      ", disk.path));
                            new_b.push_str(&b[tgt_idx..]);
                            b = new_b;
                        }
                    }
                }
                
                let existing_driver_type = get_attr_in_block(&b, "<driver", "type");
                let expected_driver_type = existing_driver_type.unwrap_or_else(|| {
                    if is_cdrom { "raw".to_string() } else { "qcow2".to_string() }
                });
                b = replace_attr_in_block(&b, "<driver", "type", &expected_driver_type);
                
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
            None => "".to_string(),
        }
    });

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
            let source_tag = if disk.path.is_empty() {
                "".to_string()
            } else {
                format!("\n      <source file='{}'/>", disk.path)
            };
            let disk_xml = format!(
                "    <disk type='file' device='{}'>\n      <driver name='qemu' type='{}'/>{}\n      <target dev='{}' bus='{}'/>{}{}\n    </disk>\n",
                if disk.device.is_empty() { "disk" } else { &disk.device },
                driver_type,
                source_tag,
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
    if xml.contains("<graphics") {
        let mut new_xml = replace_attr_in_block(xml, "<graphics", "type", graphics_type);
        
        if graphics_type == "spice" {
            if let Some(start_idx) = new_xml.find("<graphics") {
                if let Some(rel_end) = new_xml[start_idx..].find("</graphics>") {
                    let end_idx = start_idx + rel_end + "</graphics>".len();
                    let block = &new_xml[start_idx..end_idx];
                    
                    if let Some(open_tag_end_rel) = block.find('>') {
                        let open_tag = &block[..open_tag_end_rel + 1];
                        let mut listen_line = "      <listen type='address'/>\n".to_string();
                        if block.contains("<listen") {
                            if let Some(l_start) = block.find("<listen") {
                                if let Some(l_end_rel) = block[l_start..].find('>') {
                                    listen_line = format!("      {}\n", &block[l_start..l_start + l_end_rel + 1]);
                                }
                            }
                        }
                        
                        let optimized_block = format!(
                            "{}\n{}      <image compression='lz'/>\n      <streaming mode='off'/>\n    </graphics>",
                            open_tag, listen_line
                        );
                        new_xml.replace_range(start_idx..end_idx, &optimized_block);
                    }
                } else if let Some(rel_end) = new_xml[start_idx..].find("/>") {
                    let end_idx = start_idx + rel_end + "/>".len();
                    let open_tag = &new_xml[start_idx..end_idx];
                    let open_tag_clean = open_tag.trim_end_matches("/>").trim_end_matches('/');
                    let optimized_block = format!(
                        "{}>\n      <listen type='address'/>\n      <image compression='lz'/>\n      <streaming mode='off'/>\n    </graphics>",
                        open_tag_clean
                    );
                    new_xml.replace_range(start_idx..end_idx, &optimized_block);
                }
            }
        }
        new_xml
    } else {
        xml.to_string()
    }
}

fn update_video_xml(xml: &str, video_model: &str) -> String {
    if xml.contains("<video") {
        map_blocks(xml, "<video", "</video>", |block| {
            let mut b = replace_attr_in_block(block, "<model", "type", video_model);
            if video_model != "qxl" {
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
        let mut result = replace_attr_in_block(xml, "<topology", "sockets", &sockets.to_string());
        result = replace_attr_in_block(&result, "<topology", "cores", &cores.to_string());
        replace_attr_in_block(&result, "<topology", "threads", &threads.to_string())
    } else if let Some(cpu_idx) = xml.find("<cpu") {
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
        if !new_xml.contains("firmware=") {
            if let Some(idx) = new_xml.find("<os>") {
                new_xml.replace_range(idx..idx + 4, "<os firmware='efi'>");
            } else if let Some(idx) = new_xml.find("<os ") {
                new_xml.insert_str(idx + 4, "firmware='efi' ");
            }
        }
        if !new_xml.contains("<firmware>") {
            if let Some(type_idx) = new_xml.find("<type ") {
                if let Some(end_type_idx) = new_xml[type_idx..].find("</type>") {
                    let insert_idx = type_idx + end_type_idx + 7;
                    new_xml.insert_str(insert_idx, "\n    <firmware>\n      <feature enabled='yes' name='secure-boot'/>\n    </firmware>");
                }
            }
        }
        if !new_xml.contains("<smm ") && !new_xml.contains("<smm>") {
            if let Some(features_idx) = new_xml.find("<features>") {
                new_xml.insert_str(features_idx + 10, "\n    <smm state='on'/>");
            }
        }
    } else {
        new_xml = new_xml.replace(" firmware='efi'", "").replace(" firmware=\"efi\"", "");
        if let Some(start_firmware) = new_xml.find("<firmware>") {
            if let Some(end_firmware) = new_xml[start_firmware..].find("</firmware>") {
                let delete_end = start_firmware + end_firmware + 11;
                new_xml.drain(start_firmware..delete_end);
            }
        }
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

fn update_filesystems_xml(xml: &str, filesystems: &[FilesystemInfo]) -> String {
    let updated_xml = map_blocks(xml, "<filesystem", "</filesystem>", |block| {
        let target_dir = match get_attr_in_block(block, "<target", "dir") {
            Some(t) => t,
            None => return block.to_string(),
        };
        match filesystems.iter().find(|f| f.target_dir == target_dir) {
            Some(fs) => {
                let driver_tag = if fs.driver == "virtiofs" { "\n      <driver type='virtiofs'/>" } else { "" };
                let readonly_tag = if fs.readonly { "\n      <readonly/>" } else { "" };
                format!(
                    "    <filesystem type='mount' accessmode='passthrough'>{}\n      <source dir='{}'/>\n      <target dir='{}'/>{}\n    </filesystem>\n",
                    driver_tag, fs.source_dir, fs.target_dir, readonly_tag
                )
            }
            None => "".to_string(),
        }
    });

    let mut new_fs_xml = String::new();
    for fs in filesystems {
        let mut exists = false;
        for block in collect_blocks(&updated_xml, "<filesystem", "</filesystem>") {
            if let Some(td) = get_attr_in_block(&block, "<target", "dir") {
                if td == fs.target_dir {
                    exists = true;
                    break;
                }
            }
        }
        if !exists {
            let driver_tag = if fs.driver == "virtiofs" { "\n      <driver type='virtiofs'/>" } else { "" };
            let readonly_tag = if fs.readonly { "\n      <readonly/>" } else { "" };
            let fs_block = format!(
                "    <filesystem type='mount' accessmode='passthrough'>{}\n      <source dir='{}'/>\n      <target dir='{}'/>{}\n    </filesystem>\n",
                driver_tag, fs.source_dir, fs.target_dir, readonly_tag
            );
            new_fs_xml.push_str(&fs_block);
        }
    }

    if !new_fs_xml.is_empty() {
        if let Some(devices_idx) = updated_xml.find("</devices>") {
            let mut final_xml = String::new();
            final_xml.push_str(&updated_xml[..devices_idx]);
            final_xml.push_str(&new_fs_xml);
            final_xml.push_str(&updated_xml[devices_idx..]);
            return final_xml;
        }
    }

    updated_xml
}

fn apply_cdroms_live(dom: &Domain, disks: &[DiskInfo]) -> Result<(), String> {
    let live_xml = dom.get_xml_desc(0)
        .map_err(|e| format!("Failed to read live XML: {}", e))?;
    for block in collect_blocks(&live_xml, "<disk", "</disk>") {
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
        let edited = if disk.path.is_empty() {
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

fn update_shared_memory_xml(xml: &str, shared_memory: bool) -> String {
    let mut xml = xml.to_string();
    if let Some(start_idx) = xml.find("<memoryBacking>") {
        if let Some(end_idx) = xml[start_idx..].find("</memoryBacking>") {
            let actual_end = start_idx + end_idx + "</memoryBacking>".len();
            xml.replace_range(start_idx..actual_end, "");
        }
    } else if let Some(idx) = xml.find("<memoryBacking/>") {
        xml.replace_range(idx..idx + "<memoryBacking/>".len(), "");
    }
    
    if shared_memory {
        let insert_marker = if xml.contains("</currentMemory>") {
            "</currentMemory>"
        } else if xml.contains("</memory>") {
            "</memory>"
        } else {
            "<domain"
        };
        
        if let Some(pos) = xml.find(insert_marker) {
            let insert_pos = pos + insert_marker.len();
            let insert_str = "\n  <memoryBacking>\n    <source type='memfd'/>\n    <access mode='shared'/>\n  </memoryBacking>";
            xml.insert_str(insert_pos, insert_str);
        }
    }
    xml
}

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

#[tauri::command(async)]
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
    filesystems: Vec<FilesystemInfo>,
    shared_memory: bool,
) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;

    dom.set_autostart(autostart)
        .map_err(|e| format!("Failed to set autostart: {}", e))?;

    let is_active = dom.is_active().unwrap_or(false);
    if is_active {
        apply_nics_live(&dom, &nics)?;
        apply_cdroms_live(&dom, &disks)?;
    }

    if !is_active {
        for disk in &disks {
            if disk.path.is_empty() || disk.device == "cdrom" {
                continue;
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

    let mut xml = dom.get_xml_desc(2)
        .or_else(|_| dom.get_xml_desc(0))
        .map_err(|e| format!("Failed to read XML: {}", e))?;

    xml = replace_tag_content(&xml, "memory", &max_memory.to_string());
    xml = replace_tag_content(&xml, "currentMemory", &memory.to_string());
    xml = replace_tag_content(&xml, "vcpu", &cpu.to_string());

    xml = update_boot_xml(&xml, &boot_devices);
    xml = update_bootmenu_xml(&xml, boot_menu);

    if !machine.is_empty() {
        xml = replace_attr_in_block(&xml, "<type", "machine", &machine);
    }

    xml = update_graphics_xml(&xml, &graphics_type);
    xml = update_topology_xml(&xml, cpu_sockets, cpu_cores, cpu_threads);

    xml = update_disks_xml(&xml, &disks, &boot_devices);
    xml = update_interfaces_xml(&xml, &nics, &boot_devices);

    xml = update_video_xml(&xml, &video_model);
    xml = update_secure_boot_xml(&xml, secure_boot);
    xml = update_tpm_xml(&xml, tpm);
    xml = update_shared_memory_xml(&xml, shared_memory);
    xml = update_filesystems_xml(&xml, &filesystems);

    Domain::define_xml(&conn, &xml)
        .map_err(|e| format!("Failed to save VM configuration XML: {}", e))?;

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

    let new_name = new_name.trim();
    if !new_name.is_empty() && new_name != name {
        let dom = Domain::lookup_by_name(&conn, &name)
            .map_err(|e| format!("VM not found: {}", e))?;
        dom.rename(new_name, 0)
            .map_err(|e| format!("Failed to rename VM: {}", e))?;
    }

    Ok(())
}

#[tauri::command(async)]
pub fn get_vm_xml(name: String) -> Result<String, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;
    dom.get_xml_desc(2)
        .or_else(|_| dom.get_xml_desc(0))
        .map_err(|e| format!("Failed to read XML: {}", e))
}

#[tauri::command(async)]
pub fn save_vm_xml(xml: String) -> Result<(), String> {
    let conn = crate::connect_libvirt()?;
    Domain::define_xml(&conn, &xml)
        .map(|_| ())
        .map_err(|e| format!("Failed to define VM from XML: {}", e))
}

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

fn parse_filesystems(xml: &str) -> Vec<FilesystemInfo> {
    collect_blocks(xml, "<filesystem", "</filesystem>")
        .iter()
        .map(|block| {
            let source_dir = get_attr_in_block(block, "<source", "dir").unwrap_or_default();
            let target_dir = get_attr_in_block(block, "<target", "dir").unwrap_or_default();
            let readonly = block.contains("<readonly");
            let driver = if block.contains("type='virtiofs'") || block.contains("type=\"virtiofs\"") {
                "virtiofs".to_string()
            } else {
                "9p".to_string()
            };
            FilesystemInfo {
                source_dir,
                target_dir,
                readonly,
                driver,
            }
        })
        .collect()
}

#[tauri::command(async)]
pub fn get_vm_settings(name: String) -> Result<VmSettings, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;

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
    let shared_memory = xml.contains("<memoryBacking>") && (xml.contains("mode='shared'") || xml.contains("pages='yes'"));

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
        filesystems: parse_filesystems(&xml),
        shared_memory,
    })
}

#[tauri::command(async)]
pub fn optimize_vm_for_app(name: String) -> Result<String, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;

    let mut xml = dom.get_xml_desc(virt::sys::VIR_DOMAIN_XML_INACTIVE)
        .map_err(|e| format!("Failed to get VM XML: {}", e))?;

    xml = remove_elements_containing(&xml, "channel", "spicevmc");
    xml = remove_elements_containing(&xml, "redirdev", "spicevmc");
    xml = remove_elements_containing(&xml, "graphics", "type='spice'");

    if !xml.contains("<graphics type='vnc'") {
        insert_before_devices_close(&mut xml, "    <graphics type='vnc' autoport='yes' listen='127.0.0.1'>\n      <listen type='address' address='127.0.0.1'/>\n    </graphics>\n  ");
    }

    if !xml.contains("type='qemu-vdagent'") {
        insert_before_devices_close(&mut xml, "    <channel type='qemu-vdagent'>\n      <target type='virtio' name='com.redhat.spice.0'/>\n      <source>\n        <clipboard copypaste='yes'/>\n      </source>\n    </channel>\n  ");
    }

    let had_audio = xml.contains("<audio");
    xml = remove_elements_containing(&xml, "audio", "type=");
    if had_audio || xml.contains("<sound") {
        insert_before_devices_close(&mut xml, "    <audio id='1' type='none'/>\n  ");
    }

    while let Some(vstart) = xml.find("<video") {
        let Some(rel_end) = xml[vstart..].find("</video>") else { break };
        let vend = vstart + rel_end + "</video>".len();
        if xml[vstart..vend].contains("qxl") {
            xml.replace_range(vstart..vend, "<video>\n      <model type='virtio' heads='1' primary='yes'/>\n    </video>");
        } else {
            break;
        }
    }

    if xml.contains("driver type='virtiofs'") || xml.contains("type='virtiofs'") {
        xml = update_shared_memory_xml(&xml, true);
    }

    Domain::define_xml(&conn, &xml)
        .map_err(|e| format!("Failed to apply optimized config: {}", e))?;

    let running = dom.is_active().unwrap_or(false);
    Ok(if running { "RESTART_REQUIRED".to_string() } else { "APPLIED".to_string() })
}
