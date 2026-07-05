use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;
use std::sync::OnceLock;

// Secure token generated at startup to prevent unauthorized local WebSocket connections
static PROXY_TOKEN: OnceLock<String> = OnceLock::new();

pub fn init_proxy_token() {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let token: String = (0..32)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect();
    let _ = PROXY_TOKEN.set(token);
}

#[tauri::command]
pub fn get_proxy_token() -> Result<String, String> {
    PROXY_TOKEN.get().cloned().ok_or_else(|| "Proxy token not initialized".to_string())
}

pub async fn run_proxy_server() {
    let listener = match TcpListener::bind("127.0.0.1:5959").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Console proxy failed to bind 127.0.0.1:5959 (port already in use?): {}", e);
            return;
        }
    };
    
    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(async move {
            let _ = stream.set_nodelay(true);
            let target_port = std::sync::Arc::new(std::sync::atomic::AtomicU16::new(5900));
            let port_clone = target_port.clone();
            
            let callback = move |req: &Request, response: Response| {
                // 1. Validate Origin header to prevent CSWSH (Cross-Site WebSocket Hijacking)
                if let Some(origin) = req.headers().get("origin") {
                    let origin_str = origin.to_str().unwrap_or("");
                    if origin_str != "tauri://localhost" && origin_str != "http://localhost:1420" && origin_str != "tauri://localhost/" && origin_str != "http://localhost:1420/" {
                        return Err(tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(Some("Forbidden: Invalid Origin".to_string())));
                    }
                } else {
                    return Err(tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(Some("Forbidden: Missing Origin".to_string())));
                }

                // 2. Validate Token in query parameter
                let uri = req.uri();
                let token_valid = if let Some(query) = uri.query() {
                    let expected = format!("token={}", PROXY_TOKEN.get().map(|s| s.as_str()).unwrap_or(""));
                    query.split('&').any(|param| param == expected)
                } else {
                    false
                };

                if !token_valid {
                    return Err(tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(Some("Unauthorized: Invalid Token".to_string())));
                }

                // 3. Extract and validate target port
                let path = uri.path();
                if let Some(port_str) = path.strip_prefix('/') {
                    if let Ok(p) = port_str.parse::<u16>() {
                        // Limit to SPICE/VNC port ranges
                        if (5900..=5999).contains(&p) {
                            port_clone.store(p, std::sync::atomic::Ordering::SeqCst);
                            return Ok(response);
                        }
                    }
                }
                
                Err(tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(Some("Forbidden: Invalid Port".to_string())))
            };
            
            let ws_stream = match accept_hdr_async(stream, callback).await {
                Ok(ws) => ws,
                Err(_) => return,
            };
            
            let resolved_port = target_port.load(std::sync::atomic::Ordering::SeqCst);
            let tcp_stream = match TcpStream::connect(format!("127.0.0.1:{}", resolved_port)).await {
                Ok(s) => s,
                Err(_) => return,
            };
            let _ = tcp_stream.set_nodelay(true);
            
            let (mut tcp_read, mut tcp_write) = tcp_stream.into_split();
            let (mut ws_write, mut ws_read) = ws_stream.split();
            
            let ws_to_tcp = async {
                while let Some(Ok(msg)) = ws_read.next().await {
                    if msg.is_binary() || msg.is_text() {
                        let data = msg.into_data();
                        if tcp_write.write_all(&data).await.is_err() {
                            break;
                        }
                    } else if msg.is_close() {
                        break;
                    }
                }
                let _ = tcp_write.shutdown().await;
            };
            
            let tcp_to_ws = async {
                let mut buf = vec![0u8; 65536];
                loop {
                    match tcp_read.read(&mut buf).await {
                        Ok(0) => break,
                        Ok(n) => {
                            let msg = Message::Binary(buf[..n].to_vec());
                            if ws_write.send(msg).await.is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            };
            
            let _ = tokio::join!(ws_to_tcp, tcp_to_ws);
        });
    }
}
