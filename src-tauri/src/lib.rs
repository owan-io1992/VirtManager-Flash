pub mod system;
pub mod networks;
pub mod storage;
pub mod proxy;
pub mod domains;

use std::sync::{Mutex, Arc};
use std::ops::Deref;
use virt::connect::Connect;

pub static LIBVIRT_URI: Mutex<Option<String>> = Mutex::new(None);

// Cached libvirt connection shared by all commands. Wrapped in Arc to allow
// multiple commands to execute concurrently on different threads without
// serializing on the global Mutex lock.
static CONNECTION: Mutex<Option<Arc<Connect>>> = Mutex::new(None);

pub struct ConnGuard(Arc<Connect>);

impl Deref for ConnGuard {
    type Target = Connect;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

// Public shared helpers used by sub-modules
pub fn connect_libvirt() -> Result<ConnGuard, String> {
    let mut guard = CONNECTION.lock().unwrap_or_else(|p| p.into_inner());

    if let Some(conn) = guard.as_ref() {
        if conn.is_alive().unwrap_or(false) {
            return Ok(ConnGuard(conn.clone()));
        }
        if let Some(stale) = guard.take() {
            if let Ok(mut conn) = Arc::try_unwrap(stale) {
                let _ = conn.close();
            }
        }
    }

    let uri = LIBVIRT_URI.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let uri_str = uri.as_deref().unwrap_or("qemu:///system");

    let conn = Connect::open(Some(uri_str))
        .map_err(|e| format!("Failed to connect to libvirt at '{}': {}", uri_str, e))?;
    let conn_arc = Arc::new(conn);
    *guard = Some(conn_arc.clone());
    Ok(ConnGuard(conn_arc))
}

// Close and drop the cached connection so the next command reconnects
// (used when the libvirt URI changes).
pub fn invalidate_connection() {
    let mut guard = CONNECTION.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(stale) = guard.take() {
        if let Ok(mut conn) = Arc::try_unwrap(stale) {
            let _ = conn.close();
        }
    }
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
    // WebKitGTK's DMA-BUF renderer (default since 2.44) fails to create an EGL
    // display on many GPU/driver combos (older Mesa, proprietary NVIDIA, VMs),
    // aborting at startup with "Could not create default EGL display. Aborting...".
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    proxy::init_proxy_token();
    tauri::async_runtime::spawn(proxy::run_proxy_server());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            proxy::get_proxy_token,
            domains::list_domains,
            domains::start_domain,
            domains::shutdown_domain,
            domains::stop_domain,
            domains::suspend_domain,
            domains::resume_domain,
            domains::reboot_domain,
            domains::reset_domain,
            domains::open_viewer,
            domains::get_vm_graphics_port,
            domains::optimize_vm_for_app,
            domains::update_vm_settings,
            domains::get_vm_settings,
            domains::get_vm_xml,
            domains::save_vm_xml,
            domains::create_vm,
            domains::delete_vm,
            domains::check_guest_agent,
            domains::debug_memory_stats,
            domains::qemu_agent_command,
            domains::list_snapshots,
            domains::create_snapshot,
            domains::revert_to_snapshot,
            domains::delete_snapshot,
            storage::list_iso_files,
            system::get_system_resources,
            networks::list_networks,
            networks::start_network,
            networks::stop_network,
            networks::delete_network,
            networks::create_network,
            storage::list_storage_pools,
            storage::start_storage_pool,
            storage::stop_storage_pool,
            storage::delete_storage_pool,
            storage::create_storage_pool,
            storage::create_volume,
            storage::delete_volume,
            storage::resize_volume,
            system::set_libvirt_uri,
            system::get_libvirt_uri
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
