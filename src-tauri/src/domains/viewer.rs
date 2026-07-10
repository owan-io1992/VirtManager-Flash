use virt::domain::Domain;

#[tauri::command(async)]
pub fn open_viewer(name: String) -> Result<(), String> {
    std::process::Command::new("virt-viewer")
        .arg("--attach")
        .arg("-c")
        .arg("qemu:///system")
        .arg(&name)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch virt-viewer: {}", e))
}

// Extracts the allocated TCP port for a given graphics type from domain XML.
// Returns Ok(Some(port)) when allocated, Ok(None) when the graphics type is absent,
// and Err(NOT_READY) when autoport hasn't been assigned yet (port='-1').
fn find_graphics_port(xml: &str, gtype: &str) -> Result<Option<u16>, String> {
    let marker = format!("type='{}'", gtype);
    if let Some(idx) = xml.find(&marker) {
        // Use graphics element boundary to avoid matching 'port=' inside 'autoport='
        if let Some(elem_end) = xml[idx..].find('>') {
            let elem = &xml[idx..idx + elem_end];
            if let Some(port_start) = elem.find(" port='") {
                let start = idx + port_start + 7;
                if let Some(port_end) = xml[start..].find("'") {
                    let port_str = &xml[start..start + port_end];
                    if let Ok(p) = port_str.parse::<u16>() {
                        return Ok(Some(p));
                    }
                    // port='-1' means libvirt/qemu hasn't allocated the autoport yet
                    if port_str == "-1" {
                        return Err("GRAPHICS_PORT_NOT_READY".to_string());
                    }
                }
            }
        }
    }
    Ok(None)
}

// Returns "vnc:<port>" or "spice:<port>". VNC is preferred because the embedded
// noVNC client vastly outperforms spice-html5.
#[tauri::command(async)]
pub fn get_vm_graphics_port(name: String) -> Result<String, String> {
    let conn = crate::connect_libvirt()?;
    let dom = Domain::lookup_by_name(&conn, &name)
        .map_err(|e| format!("VM not found: {}", e))?;

    let xml = dom.get_xml_desc(0)
        .map_err(|e| format!("Failed to get VM XML: {}", e))?;

    if let Some(p) = find_graphics_port(&xml, "vnc")? {
        return Ok(format!("vnc:{}", p));
    }

    // Detect SPICE with GL rendering (listen type='none') — no TCP port available
    if xml.contains("type='spice'") && (xml.contains("<listen type='none'/>") || xml.contains("listen type=\"none\"")) {
        return Err("SPICE_GL_NO_PORT".to_string());
    }

    if let Some(p) = find_graphics_port(&xml, "spice")? {
        return Ok(format!("spice:{}", p));
    }

    Err("No graphics display (SPICE or VNC) found for this VM".to_string())
}
