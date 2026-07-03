use serde::{Serialize, Deserialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader};
use virt::connect::Connect;

#[derive(Serialize, Deserialize, Clone)]
pub struct SystemResources {
    pub cpu_cores: u32,
    pub cpu_threads: u32,
    pub mem_total_kb: u64,
    pub mem_available_kb: u64,
    pub os_platform: String,
}

fn parse_cpu_info() -> (u32, u32) {
    let mut threads = 0;
    
    if let Ok(val) = std::thread::available_parallelism() {
        threads = val.get() as u32;
    }
    
    let physical_cores;
    
    if let Ok(file) = File::open("/proc/cpuinfo") {
        let reader = BufReader::new(file);
        let mut physical_ids = HashSet::new();
        let mut cores_per_socket = 0;
        let mut processor_count = 0;
        
        for line in reader.lines().map_while(Result::ok) {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() == 2 {
                let key = parts[0].trim();
                let val = parts[1].trim();
                if key == "processor" {
                    processor_count += 1;
                } else if key == "physical id" {
                    if let Ok(pid) = val.parse::<u32>() {
                        physical_ids.insert(pid);
                    }
                } else if key == "cpu cores" {
                    if let Ok(cores) = val.parse::<u32>() {
                        cores_per_socket = cores;
                    }
                }
            }
        }
        
        if processor_count > 0 {
            threads = processor_count;
        }
        
        let socket_count = if physical_ids.is_empty() { 1 } else { physical_ids.len() as u32 };
        if cores_per_socket > 0 {
            physical_cores = cores_per_socket * socket_count;
        } else {
            physical_cores = (threads / 2).max(1);
        }
    } else {
        physical_cores = (threads / 2).max(1);
    }
    
    (physical_cores, threads)
}

fn parse_mem_info() -> (u64, u64) {
    let mut total_kb = 0;
    let mut available_kb = 0;
    let mut free_kb = 0;
    let mut buffers_kb = 0;
    let mut cached_kb = 0;
    
    if let Ok(file) = File::open("/proc/meminfo") {
        let reader = BufReader::new(file);
        for line in reader.lines().map_while(Result::ok) {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() == 2 {
                let key = parts[0].trim();
                let val_str = parts[1].trim();
                let val = val_str.split_whitespace().next()
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(0);
                    
                if key == "MemTotal" {
                    total_kb = val;
                } else if key == "MemAvailable" {
                    available_kb = val;
                } else if key == "MemFree" {
                    free_kb = val;
                } else if key == "Buffers" {
                    buffers_kb = val;
                } else if key == "Cached" {
                    cached_kb = val;
                }
            }
        }
    }
    
    if available_kb == 0 {
        available_kb = free_kb + buffers_kb + cached_kb;
    }
    
    (total_kb, available_kb)
}

#[tauri::command]
pub fn get_system_resources() -> Result<SystemResources, String> {
    let (cpu_cores, cpu_threads) = parse_cpu_info();
    let (mem_total_kb, mem_available_kb) = parse_mem_info();
    let os_platform = format!("Linux ({})", std::env::consts::ARCH);
    
    Ok(SystemResources {
        cpu_cores,
        cpu_threads,
        mem_total_kb,
        mem_available_kb,
        os_platform,
    })
}

#[tauri::command]
pub fn set_libvirt_uri(uri: String) -> Result<(), String> {
    let mut conn = Connect::open(Some(&uri))
        .map_err(|e| format!("Failed to connect with URI '{}': {}", uri, e))?;
    let _ = conn.close();
    *crate::LIBVIRT_URI.lock().unwrap() = Some(uri);
    Ok(())
}

#[tauri::command]
pub fn get_libvirt_uri() -> String {
    crate::LIBVIRT_URI.lock().unwrap().clone().unwrap_or_else(|| "qemu:///system".to_string())
}
