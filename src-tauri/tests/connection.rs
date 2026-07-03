// Integration test for the cached libvirt connection and the polling path.
// Requires a reachable local libvirt daemon (qemu:///system).

use std::time::Instant;

#[test]
fn cached_connection_is_reused_and_list_domains_works() {
    // First call opens a fresh connection
    let t0 = Instant::now();
    let ptr1 = {
        let conn = virtmanager_flash_lib::connect_libvirt().expect("initial connect failed");
        conn.as_ptr()
    };
    let first_connect = t0.elapsed();

    // Second call must hand back the same underlying virConnectPtr
    let t1 = Instant::now();
    let ptr2 = {
        let conn = virtmanager_flash_lib::connect_libvirt().expect("cached connect failed");
        conn.as_ptr()
    };
    let cached_access = t1.elapsed();
    assert_eq!(ptr1, ptr2, "expected the cached connection to be reused");

    // After invalidation the next call must still succeed (reconnect)
    virtmanager_flash_lib::invalidate_connection();
    {
        let conn = virtmanager_flash_lib::connect_libvirt().expect("reconnect after invalidate failed");
        let _ = conn.as_ptr();
    }

    println!("first connect: {:?}, cached access: {:?}", first_connect, cached_access);

    // Exercise the 2s polling path end-to-end, twice, through the cache
    let t2 = Instant::now();
    let list1 = virtmanager_flash_lib::domains::list_domains(Some(true)).expect("list_domains #1 failed");
    let poll1 = t2.elapsed();
    let t3 = Instant::now();
    let list2 = virtmanager_flash_lib::domains::list_domains(Some(true)).expect("list_domains #2 failed");
    let poll2 = t3.elapsed();

    assert_eq!(list1.len(), list2.len(), "domain count changed between polls");
    println!(
        "list_domains #1: {:?} ({} vms), list_domains #2 (cached conn): {:?}",
        poll1,
        list1.len(),
        poll2
    );
}
