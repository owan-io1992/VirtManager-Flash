import React from "react";
import { TranslationKey } from "../translations";
import { VncConsole } from "./VncConsole";

interface VmConsoleTabProps {
  vmName: string;
  vmState: number;
  graphicsLoading: boolean;
  graphicsError: string | null;
  graphicsProtocol: "vnc" | "spice" | null;
  graphicsPort: number | null;
  proxyToken: string;
  onOpenViewer: () => void;
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
}

export const VmConsoleTab = React.memo(({
  vmName: _vmName,
  vmState,
  graphicsLoading,
  graphicsError,
  graphicsProtocol,
  graphicsPort,
  proxyToken,
  onOpenViewer,
  t,
}: VmConsoleTabProps) => {
  const isGlMode = graphicsError === "SPICE_GL_NO_PORT";

  return (
    <div className="console-panel">
      {vmState === 1 ? (
        <div className="graphic-console-screen" style={{ width: "100%", height: "100%", padding: 0 }}>
          {graphicsLoading && !isGlMode && (
            <div className="spice-loading-container" style={{ padding: "3rem", textAlign: "center" }}>
              <div className="spinner" style={{ margin: "0 auto 1rem auto" }}></div>
              {t("console_connecting")}
            </div>
          )}
          {isGlMode && (
            <div style={{ padding: "3rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
              <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>🕶️</div>
              <p style={{ color: "#94A3B8", fontSize: "0.95rem", maxWidth: "420px", margin: 0 }}>{t("console_gl_mode")}</p>
              <p style={{ color: "#64748B", fontSize: "0.8rem", margin: 0 }}>{t("console_gl_mode_sub")}</p>
              <button
                onClick={onOpenViewer}
                style={{
                  marginTop: "1rem",
                  padding: "0.5rem 1.25rem",
                  background: "linear-gradient(135deg, #24C6DC, #514A9D)",
                  border: "none",
                  borderRadius: "8px",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  cursor: "pointer",
                }}
              >
                {t("console_open_viewer")}
              </button>
            </div>
          )}
          {graphicsError && !isGlMode && (
            <div className="spice-error-container" style={{ padding: "3rem", color: "#EF4444", textAlign: "center" }}>
              <p>{graphicsError}</p>
              <p style={{ fontSize: "0.8rem", color: "#94A3B8" }}>{t("console_error_graphics")}</p>
            </div>
          )}
          {graphicsPort && proxyToken && graphicsProtocol === "vnc" && (
            <VncConsole
              port={graphicsPort}
              token={proxyToken}
              connectingLabel={t("console_connecting")}
              disconnectedLabel={t("console_disconnected")}
              t={t}
            />
          )}
          {graphicsPort && proxyToken && graphicsProtocol === "spice" && (
            <iframe
              src={`/spice/spice_auto.html?host=127.0.0.1&port=5959&path=${graphicsPort}?token=${proxyToken}`}
              style={{ width: "100%", height: "100%", minHeight: "500px", border: "none", borderRadius: "12px", background: "#030508" }}
              title="SPICE Console"
            />
          )}
        </div>
      ) : (
        <div className="terminal-offline-screen">
          <span className="terminal-offline-icon">🔌</span>
          <p>{t("console_disconnected")}</p>
          <p className="terminal-subtext">{t("console_disconnected_sub")}</p>
        </div>
      )}
    </div>
  );
});
