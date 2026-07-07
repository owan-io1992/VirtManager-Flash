import logoPng from "../assets/LOGO.png";
import { TranslationKey } from "../translations";

interface AboutModalProps {
  showAboutModal: boolean;
  setShowAboutModal: (show: boolean) => void;
  lang: "zh" | "en";
  t: (key: TranslationKey) => string;
}

export const AboutModal = ({
  showAboutModal,
  setShowAboutModal,
  lang,
  t,
}: AboutModalProps) => {
  if (!showAboutModal) return null;

  const isZh = lang === "zh";

  return (
    <div className="preferences-modal-overlay" style={{ zIndex: 10000 }}>
      <div className="preferences-modal" style={{ maxWidth: "420px", height: "auto", maxHeight: "580px" }}>
        <div className="preferences-modal-header">
          <span className="preferences-modal-title">
            {isZh ? "關於此應用程式" : "About Application"}
          </span>
          <button
            className="btn-close-modal"
            onClick={() => setShowAboutModal(false)}
            style={{ fontSize: "1.5rem" }}
          >
            &times;
          </button>
        </div>

        <div className="preferences-modal-body" style={{ padding: "2rem 1.5rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto" }}>
          {/* Logo */}
          <div style={{ marginBottom: "1.25rem" }}>
            <img
              src={logoPng}
              alt="Logo"
              style={{
                height: "6.5rem",
                width: "auto",
                objectFit: "contain",
                filter: "drop-shadow(0 0 15px rgba(36, 198, 220, 0.3))",
              }}
            />
          </div>

          {/* App Name */}
          <h2 className="about-app-title">
            VirtManager-Flash
          </h2>

          {/* Version */}
          <div className="about-version">
            v{__APP_VERSION__}
          </div>

          {/* Description */}
          <p className="about-description">
            {isZh
              ? "一個使用 Tauri、React 與 Rust 打造的極速、現代化 KVM/libvirt 虛擬機管理工具。"
              : "A lightning-fast, modern KVM/libvirt virtual machine manager built with Tauri, React, and Rust."}
          </p>

          {/* Details / Link */}
          <div className="about-details">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748B" }}>GitHub</span>
              <a
                href="https://github.com/owan-io1992/VirtManager-Flash"
                target="_blank"
                rel="noreferrer"
                className="about-link"
              >
                owan-io1992/VirtManager-Flash
              </a>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748B" }}>{isZh ? "授權條款" : "License"}</span>
              <span className="about-detail-val">MIT License</span>
            </div>
          </div>
        </div>

        <div className="preferences-modal-footer">
          <button
            className="btn-save-settings"
            style={{ margin: 0, width: "100%" }}
            onClick={() => setShowAboutModal(false)}
          >
            {t("btn_close")}
          </button>
        </div>
      </div>
    </div>
  );
};
