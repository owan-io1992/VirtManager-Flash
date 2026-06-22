import { DomainItem } from "../types";
import { TranslationKey } from "../translations";

interface VmConsoleTabProps {
  selectedVm: DomainItem;
  spiceLoading: boolean;
  spiceError: string | null;
  spicePort: number | null;
  t: (key: TranslationKey) => string;
}

export const VmConsoleTab = ({
  selectedVm,
  spiceLoading,
  spiceError,
  spicePort,
  t,
}: VmConsoleTabProps) => {
  return (
    <div className="console-panel">
      {selectedVm.state === 1 ? (
        <div className="graphic-console-screen" style={{ width: "100%", height: "100%", padding: 0 }}>
          {spiceLoading && (
            <div className="spice-loading-spinner" style={{ padding: "3rem", color: "#24C6DC", fontWeight: 550, textAlign: "center" }}>
              {t("console_connecting")}
            </div>
          )}
          {spiceError && (
            <div className="spice-error-container" style={{ padding: "3rem", color: "#EF4444", textAlign: "center" }}>
              <p>{spiceError}</p>
              <p style={{ fontSize: "0.8rem", color: "#94A3B8" }}>{t("console_error_graphics")}</p>
            </div>
          )}
          {spicePort && (
            <iframe
              src={`/spice/spice_auto.html?host=127.0.0.1&port=5959&path=${spicePort}`}
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
};
