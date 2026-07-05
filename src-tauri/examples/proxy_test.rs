// Standalone replica of proxy.rs (port 5958, fixed token) used to diagnose
// the noVNC handshake path. Run: cargo run --example proxy_test
use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;

#[tokio::main]
async fn main() {
    let listener = TcpListener::bind("127.0.0.1:5958").await.unwrap();
    eprintln!("test proxy listening on 5958");

    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(async move {
            let _ = stream.set_nodelay(true);
            let target_port = std::sync::Arc::new(std::sync::atomic::AtomicU16::new(5900));
            let port_clone = target_port.clone();

            let callback = move |req: &Request, response: Response| {
                eprintln!("handshake: uri={} origin={:?}", req.uri(), req.headers().get("origin"));
                if let Some(origin) = req.headers().get("origin") {
                    let origin_str = origin.to_str().unwrap_or("");
                    if origin_str != "tauri://localhost" && origin_str != "http://localhost:1420" && origin_str != "tauri://localhost/" && origin_str != "http://localhost:1420/" {
                        eprintln!("REJECT: bad origin");
                        return Err(tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(Some("Forbidden".to_string())));
                    }
                } else {
                    eprintln!("REJECT: no origin");
                    return Err(tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(Some("Forbidden".to_string())));
                }
                let uri = req.uri();
                let token_valid = uri.query().map(|q| q.split('&').any(|p| p == "token=TESTTOKEN")).unwrap_or(false);
                if !token_valid {
                    eprintln!("REJECT: bad token");
                    return Err(tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(Some("Unauthorized".to_string())));
                }
                if let Some(port_str) = uri.path().strip_prefix('/') {
                    if let Ok(p) = port_str.parse::<u16>() {
                        if (5900..=5999).contains(&p) {
                            port_clone.store(p, std::sync::atomic::Ordering::SeqCst);
                            eprintln!("ACCEPT: target port {}", p);
                            return Ok(response);
                        }
                    }
                }
                eprintln!("REJECT: bad port");
                Err(tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(Some("Forbidden".to_string())))
            };

            let ws_stream = match accept_hdr_async(stream, callback).await {
                Ok(ws) => ws,
                Err(e) => { eprintln!("handshake failed: {}", e); return; }
            };
            let resolved_port = target_port.load(std::sync::atomic::Ordering::SeqCst);
            let tcp_stream = match TcpStream::connect(format!("127.0.0.1:{}", resolved_port)).await {
                Ok(s) => s,
                Err(e) => { eprintln!("target connect failed: {}", e); return; }
            };
            eprintln!("connected to target {}", resolved_port);
            let _ = tcp_stream.set_nodelay(true);
            let (mut tcp_read, mut tcp_write) = tcp_stream.into_split();
            let (mut ws_write, mut ws_read) = ws_stream.split();
            let ws_to_tcp = async {
                while let Some(Ok(msg)) = ws_read.next().await {
                    if msg.is_binary() || msg.is_text() {
                        let data = msg.into_data();
                        eprintln!("ws->tcp {} bytes", data.len());
                        if tcp_write.write_all(&data).await.is_err() { break; }
                    } else if msg.is_close() { break; }
                }
                let _ = tcp_write.shutdown().await;
            };
            let tcp_to_ws = async {
                let mut buf = vec![0u8; 65536];
                loop {
                    match tcp_read.read(&mut buf).await {
                        Ok(0) => break,
                        Ok(n) => {
                            eprintln!("tcp->ws {} bytes", n);
                            if ws_write.send(Message::Binary(buf[..n].to_vec())).await.is_err() { break; }
                        }
                        Err(_) => break,
                    }
                }
            };
            let _ = tokio::join!(ws_to_tcp, tcp_to_ws);
            eprintln!("session ended");
        });
    }
}
