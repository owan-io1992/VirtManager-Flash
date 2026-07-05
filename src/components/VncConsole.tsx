import React, { useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { TranslationKey } from "../translations";

interface VncConsoleProps {
  port: number;
  token: string;
  connectingLabel: string;
  disconnectedLabel: string;
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
}

export const VncConsole = React.memo(({ port, token, connectingLabel, disconnectedLabel, t }: VncConsoleProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const handlePaste = (e: Event) => {
      const text = (e as CustomEvent).detail;
      console.log("VncConsole: handlePaste event received, text:", text, "rfb ready:", !!rfbRef.current);
      if (rfbRef.current && text) {
        rfbRef.current.clipboardPasteFrom(text);
      }
    };
    window.addEventListener("paste-to-vm", handlePaste);
    return () => {
      window.removeEventListener("paste-to-vm", handlePaste);
    };
  }, []);

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

    const onClipboard = (e: Event) => {
      const text = (e as CustomEvent).detail?.text;
      if (text) {
        writeText(text)
          .then(() => {
            window.dispatchEvent(new CustomEvent("guest-copied", { detail: text }));
          })
          .catch((err) => {
            console.error("Failed to copy guest clipboard to host:", err);
          });
      }
    };

    // Deferred so StrictMode's mount/unmount/mount cycle doesn't open a
    // websocket that is immediately torn down mid-handshake.
    const timer = setTimeout(() => {
      try {
        rfb = new RFB(container, `ws://127.0.0.1:5959/${port}?token=${token}`);
        rfbRef.current = rfb;
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
      rfb.addEventListener("clipboard", onClipboard);
    }, 50);

    return () => {
      clearTimeout(timer);
      rfbRef.current = null;
      if (rfb) {
        rfb.removeEventListener("connect", onConnect);
        rfb.removeEventListener("disconnect", onDisconnect);
        rfb.removeEventListener("securityfailure", onSecurityFailure);
        rfb.removeEventListener("clipboard", onClipboard);
        try {
          rfb.disconnect();
        } catch {
          // already closed
        }
      }
    };
  }, [port, token, t]);

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
