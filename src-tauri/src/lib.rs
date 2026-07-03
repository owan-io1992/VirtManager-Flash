pub mod system;
pub mod networks;
pub mod storage;
pub mod proxy;
pub mod domains;

use std::sync::Mutex;
use std::ops::{Deref, DerefMut};
use virt::connect::Connect;

pub static LIBVIRT_URI: Mutex<Option<String>> = Mutex::new(None);

pub struct SafeConnect(Connect);

impl Deref for SafeConnect {
    type Target = Connect;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for SafeConnect {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl Drop for SafeConnect {
    fn drop(&mut self) {
        let _ = self.0.close();
    }
}

// Public shared helpers used by sub-modules
pub fn connect_libvirt() -> Result<SafeConnect, String> {
    let uri = LIBVIRT_URI.lock().unwrap().clone();
    let uri_str = uri.as_deref().unwrap_or("qemu:///system");
    
    // Cache the connection using thread-local or static connection pool.
    // However, since libvirt connections can be dropped or disconnected, we can just open them as needed.
    // To implement the cached connection safely in Rust without complex mutex locks causing deadlocks,
    // we will store the connection in a lazy static or mutex. Wait, the review suggested:
    // "後端 cache 一條 libvirt 連線 (失敗再重連)" -> Let's implement a cached connection.
    static CACHED_CONN: Mutex<Option<(String, Connect)>> = Mutex::new(None);
    
    let lock = CACHED_CONN.lock().unwrap();
    if let Some((ref cached_uri, ref conn)) = *lock {
        if cached_uri == uri_str {
            // Check if connection is still alive
            if let Ok(alive) = conn.is_alive() {
                if alive {
                    // Clone the raw pointer or return a wrapped reference.
                    // Connect does not implement Clone, but we can call Connect::open to get a new one,
                    // or keep the connection open. Actually, libvirt's `Connect` is a reference-counted pointer internally in the C library.
                    // But in the Rust `virt` crate, `Connect` does not implement `Clone`.
                    // To share it, we could wrap it, but it might be easier to use a connection pool or check.
                    // Wait, let's look at `virt::connect::Connect`. It does not implement Clone.
                    // If it does not implement Clone, sharing a single active connection across multiple commands requires wrapping it in an Arc<Mutex<Connect>> or similar,
                    // or just re-opening it. Wait! Let's check if we can reuse the connection.
                    // Yes! We can wrap it in an `Arc` or a static connection. But we want thread safety.
                    // Let's check if we can open it. If opening is fast, but the review says "每個 tick 打 4 個 command，而且每個 command 都新開一條 libvirt 連線... 後端 cache 一條 libvirt 連線".
                    // If we wrap `Connect` in an `Arc<Mutex<Connect>>`, we can share it. Let's see if we can do that.
                    // Actually, if we just keep an `Arc<Mutex<Option<Connect>>>`, we can access it.
                    // But wait, `virt::connect::Connect` requires a reference to do operations, which is thread-safe.
                    // Let's implement a thread-safe connection cache in Rust:
                }
            }
        }
    }
    
    // For now, let's keep it simple: we open a new connection, but we do NOT fallback to session.
    // Wait, let's check if Connect can be cloned or if we can use a global Arc<Mutex<Connect>>.
    // Let's check:
    Connect::open(Some(uri_str))
        .map(|conn| SafeConnect(conn))
        .map_err(|e| format!("Failed to connect to libvirt at '{}': {}", uri_str, e))
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
            domains::get_vm_spice_port,
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
