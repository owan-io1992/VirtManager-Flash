use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;

pub async fn run_proxy_server() {
    let listener = match TcpListener::bind("127.0.0.1:5959").await {
        Ok(l) => l,
        Err(_) => return,
    };
    
    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(async move {
            let target_port = std::sync::Arc::new(std::sync::atomic::AtomicU16::new(5900));
            let port_clone = target_port.clone();
            let callback = move |req: &Request, response: Response| {
                let uri = req.uri();
                let path = uri.path();
                if let Some(port_str) = path.strip_prefix('/') {
                    if let Ok(p) = port_str.parse::<u16>() {
                        port_clone.store(p, std::sync::atomic::Ordering::SeqCst);
                    }
                }
                Ok(response)
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
                let mut buf = vec![0u8; 8192];
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
