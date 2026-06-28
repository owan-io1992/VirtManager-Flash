import { TranslationKey } from "../translations";

interface PreferencesModalProps {
  showPrefModal: boolean;
  setShowPrefModal: (show: boolean) => void;
  theme: "dark" | "light";
  setTheme: (theme: "dark" | "light") => void;
  lang: "zh" | "en";
  setLang: (lang: "zh" | "en") => void;
  autoconnect: boolean;
  setAutoconnect: (auto: boolean) => void;
  t: (key: TranslationKey) => string;
}

export const PreferencesModal = ({
  showPrefModal,
  setShowPrefModal,
  theme,
  setTheme,
  lang,
  setLang,
  autoconnect,
  setAutoconnect,
  t,
}: PreferencesModalProps) => {
  if (!showPrefModal) return null;

  return (
    <div className="preferences-modal-overlay" onClick={() => setShowPrefModal(false)}>
      <div className="preferences-modal preferences-modal-small" onClick={(e) => e.stopPropagation()}>
        <div className="preferences-modal-header">
          <span className="preferences-modal-title">{t("modal_title")}</span>
          <button className="btn-close-modal" onClick={() => setShowPrefModal(false)} style={{ fontSize: "1.5rem" }}>&times;</button>
        </div>

        <div className="preferences-modal-body" style={{ padding: "1.5rem" }}>
          <div className="settings-group" style={{ width: "100%" }}>
            <div className="form-row">
              <span className="form-label">{t("modal_theme")}</span>
              <select
                className="form-select"
                value={theme}
                onChange={(e) => setTheme(e.target.value as "dark" | "light")}
              >
                <option value="dark">{t("pref_theme_dark")}</option>
                <option value="light">{t("pref_theme_light")}</option>
              </select>
            </div>

            <div className="form-row" style={{ marginTop: "1.25rem" }}>
              <span className="form-label">{t("modal_lang")}</span>
              <select
                className="form-select"
                value={lang}
                onChange={(e) => setLang(e.target.value as "zh" | "en")}
              >
                <option value="zh">{t("pref_lang_zh")}</option>
                <option value="en">{t("pref_lang_en")}</option>
              </select>
            </div>

            <div className="form-row" style={{ marginTop: "1.25rem" }}>
              <span className="form-label">{t("pref_autoconnect")}</span>
              <input
                type="checkbox"
                className="form-checkbox"
                checked={autoconnect}
                onChange={(e) => setAutoconnect(e.target.checked)}
              />
            </div>
          </div>
        </div>

        <div className="preferences-modal-footer">
          <button className="btn-save-settings" style={{ margin: 0 }} onClick={() => setShowPrefModal(false)}>
            {t("btn_close")}
          </button>
        </div>
      </div>
    </div>
  );
};
