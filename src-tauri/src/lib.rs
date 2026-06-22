pub mod system;
pub mod networks;
pub mod storage;
pub mod proxy;
pub mod domains;

use virt::connect::Connect;

// Public shared helpers used by sub-modules
pub fn connect_libvirt() -> Result<Connect, String> {
    // Try system connection first, then session connection
    Connect::open(Some("qemu:///system"))
        .or_else(|_| Connect::open(Some("qemu:///session")))
        .map_err(|e| format!("Failed to connect to libvirt: {}", e))
}

pub fn extract_xml_tag_attr(xml: &str, tag_prefix: &str, attr: &str) -> Option<String> {
    if let Some(idx) = xml.find(tag_prefix) {
        let tag_block = &xml[idx..];
        let search_str = format!("{}='", attr);
        if let Some(attr_idx) = tag_block.find(&search_str) {
            let start = attr_idx + search_str.len();
            if let Some(end_idx) = tag_block[start..].find("'") {
                return Some(tag_block[start..start + end_idx].to_string());
            }
        }
        let search_str_double = format!("{}=\"", attr);
        if let Some(attr_idx) = tag_block.find(&search_str_double) {
            let start = attr_idx + search_str_double.len();
            if let Some(end_idx) = tag_block[start..].find("\"") {
                return Some(tag_block[start..start + end_idx].to_string());
            }
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::async_runtime::spawn(proxy::run_proxy_server());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            domains::list_domains,
            domains::start_domain,
            domains::shutdown_domain,
            domains::stop_domain,
            domains::suspend_domain,
            domains::resume_domain,
            domains::reboot_domain,
            domains::reset_domain,
            domains::open_viewer,
            domains::get_vm_spice_port,
            domains::update_vm_settings,
            system::get_system_resources,
            networks::list_networks,
            storage::list_storage_pools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
