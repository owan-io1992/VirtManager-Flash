import React, { useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc";

interface VncConsoleProps {
  port: number;
  token: string;
  connectingLabel: string;
  disconnectedLabel: string;
}

export const VncConsole = React.memo(({ port, token, connectingLabel, disconnectedLabel }: VncConsoleProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setStatus("connecting");
    setDetail(null);

    let rfb: RFB | null = null;

    const onConnect = () => setStatus("connected");
    const onDisconnect = (e: Event) => {
      setStatus("disconnected");
      const clean = (e as CustomEvent).detail?.clean;
      setDetail(clean === false ? "Connection closed unexpectedly" : null);
    };
    const onSecurityFailure = (e: Event) => {
      setDetail(`VNC security failure: ${(e as CustomEvent).detail?.reason ?? "unknown"}`);
    };

    // Deferred so StrictMode's mount/unmount/mount cycle doesn't open a
    // websocket that is immediately torn down mid-handshake.
    const timer = setTimeout(() => {
      try {
        rfb = new RFB(container, `ws://127.0.0.1:5959/${port}?token=${token}`);
      } catch (e) {
        setStatus("disconnected");
        setDetail(`RFB init failed: ${e}`);
        return;
      }
      rfb.scaleViewport = true;
      rfb.resizeSession = true;
      rfb.background = "#030508";
      // Loopback connection: favor image quality over bandwidth
      rfb.qualityLevel = 9;
      rfb.compressionLevel = 0;
      rfb.addEventListener("connect", onConnect);
      rfb.addEventListener("disconnect", onDisconnect);
      rfb.addEventListener("securityfailure", onSecurityFailure);
    }, 50);

    return () => {
      clearTimeout(timer);
      if (rfb) {
        rfb.removeEventListener("connect", onConnect);
        rfb.removeEventListener("disconnect", onDisconnect);
        rfb.removeEventListener("securityfailure", onSecurityFailure);
        try {
          rfb.disconnect();
        } catch {
          // already closed
        }
      }
    };
  }, [port, token]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: "500px" }}>
      {status !== "connected" && (
        <div className="spice-loading-container" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", zIndex: 1 }}>
          {status === "connecting" ? (
            <>
              <div className="spinner"></div>
              {connectingLabel} (VNC :{port})
            </>
          ) : (
            disconnectedLabel
          )}
          {detail && <div style={{ color: "#F59E0B", fontSize: "0.8rem", maxWidth: "480px" }}>{detail}</div>}
        </div>
      )}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", minHeight: "500px", borderRadius: "12px", overflow: "hidden", background: "#030508" }}
      />
    </div>
  );
});
