import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { StoragePoolItem } from "../types";
import { TranslationKey } from "../translations";
import "../styles/wizard.css";

interface IsoFile {
  path: string;
  name: string;
  pool_name: string;
}

interface CreateVmWizardProps {
  show: boolean;
  onClose: () => void;
  storagePools: StoragePoolItem[];
  t: (key: TranslationKey, replaceMap?: Record<string, string | number>) => string;
  onCreated: () => void;
}

type MemUnit = "MB" | "GB" | "TB";

const toMb = (val: number, unit: MemUnit) => {
  if (unit === "GB") return val * 1024;
  if (unit === "TB") return val * 1024 * 1024;
  return val;
};

const STEP_COUNT = 3;

export const CreateVmWizard = ({ show, onClose, storagePools, t, onCreated }: CreateVmWizardProps) => {
  const [step, setStep] = useState(1);

  // Step 1
  const [vmName, setVmName] = useState("");
  const [vcpu, setVcpu] = useState(2);
  const [memVal, setMemVal] = useState(4);
  const [memUnit, setMemUnit] = useState<MemUnit>("GB");
  const [secureBoot, setSecureBoot] = useState(false);
  const [tpm, setTpm] = useState(false);

  // Step 2
  const [diskSizeGb, setDiskSizeGb] = useState(40);
  const [storagePool, setStoragePool] = useState("");

  // Step 3
  const [isoList, setIsoList] = useState<IsoFile[]>([]);
  const [isoLoading, setIsoLoading] = useState(false);
  const [selectedIso, setSelectedIso] = useState("");
  const [isoPool, setIsoPool] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const activePools = storagePools.filter((p) => p.state === "active");

  useEffect(() => {
    if (!show) return;
    setStep(1);
    setVmName("");
    setVcpu(2);
    setMemVal(4);
    setMemUnit("GB");
    setSecureBoot(false);
    setTpm(false);
    setDiskSizeGb(40);
    setStoragePool(activePools.length > 0 ? activePools[0].name : "");
    setSelectedIso("");
    setIsoPool("");
    setError(null);
    setIsoList([]);
  }, [show]);

  useEffect(() => {
    if (step === 3) {
      setIsoLoading(true);
      invoke<IsoFile[]>("list_iso_files")
        .then((list) => {
          setIsoList(list);
          if (!isoPool && activePools.length > 0) setIsoPool(activePools[0].name);
        })
        .catch(() => setIsoList([]))
        .finally(() => setIsoLoading(false));
    }
  }, [step]);

  const validateStep = () => {
    if (step === 1 && !vmName.trim()) {
      setError(t("wizard_error_name"));
      return false;
    }
    if (step === 2 && !storagePool) {
      setError(t("wizard_error_pool"));
      return false;
    }
    setError(null);
    return true;
  };

  const handleNext = () => { if (validateStep()) setStep((s) => s + 1); };
  const handleBack = () => { setError(null); setStep((s) => s - 1); };

  const memoryMb = toMb(memVal, memUnit);
  const memoryDisplay = memUnit === "MB"
    ? `${memVal} MB`
    : memUnit === "GB"
    ? `${memVal} GB`
    : `${memVal} TB`;

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      await invoke("create_vm", {
        name: vmName.trim(),
        vcpu,
        memoryMb,
        diskSizeGb,
        storagePoolName: storagePool,
        isoPath: selectedIso,
        secureBoot,
        tpm,
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.toString() || "Failed to create VM");
    } finally {
      setCreating(false);
    }
  };

  if (!show) return null;

  const stepLabels = [t("wizard_step1"), t("wizard_step2"), t("wizard_step3")];

  return (
    <div className="wizard-overlay">
      <div className="wizard-modal">
        {/* Header */}
        <div className="wizard-header">
          <h2 className="wizard-title">{t("wizard_title")}</h2>
          <button className="wizard-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Step indicator */}
        <div className="wizard-steps">
          {stepLabels.map((label, i) => {
            const isDone = step > i + 1;
            const isActive = step === i + 1;
            return (
              <div
                key={i}
                className={`wizard-step-item ${isActive ? "active" : isDone ? "done" : ""}`}
                onClick={() => { if (isDone) { setError(null); setStep(i + 1); } }}
                style={isDone ? { cursor: "pointer" } : undefined}
              >
                <div className="wizard-step-circle">{isDone ? "✓" : i + 1}</div>
                <span className="wizard-step-label">{label}</span>
                {i < STEP_COUNT - 1 && <div className="wizard-step-line" />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="wizard-body">
          {error && <div className="wizard-error">{error}</div>}

          {/* Step 1: Basic */}
          {step === 1 && (
            <div className="wizard-fields">
              <div className="form-row">
                <div className="form-label-group">
                  <span className="form-label">{t("wizard_vm_name")}</span>
                  <span className="form-hint">{t("wizard_vm_name_hint")}</span>
                </div>
                <div className="form-control">
                  <input
                    className="form-input"
                    type="text"
                    value={vmName}
                    onChange={(e) => setVmName(e.target.value)}
                    placeholder="my-ubuntu-vm"
                    autoFocus
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-label-group">
                  <span className="form-label">{t("wizard_vcpu")}</span>
                  <span className="form-hint">{t("wizard_vcpu_hint")}</span>
                </div>
                <div className="form-control">
                  <div className="wizard-input-unit-row">
                    <input
                      type="number"
                      className="form-input wizard-num-input"
                      min={1}
                      max={512}
                      value={vcpu}
                      onChange={(e) => setVcpu(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                    <span className="wizard-unit-badge">CPU</span>
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-label-group">
                  <span className="form-label">{t("wizard_memory")}</span>
                  <span className="form-hint">{t("wizard_memory_hint")}</span>
                </div>
                <div className="form-control">
                  <div className="wizard-input-unit-row">
                    <input
                      type="number"
                      className="form-input wizard-num-input"
                      min={1}
                      value={memVal}
                      onChange={(e) => setMemVal(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                    <select
                      className="wizard-unit-select"
                      value={memUnit}
                      onChange={(e) => setMemUnit(e.target.value as MemUnit)}
                    >
                      <option value="MB">MB</option>
                      <option value="GB">GB</option>
                      <option value="TB">TB</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-label-group">
                  <span className="form-label">{t("wizard_secure_boot")}</span>
                  <span className="form-hint">{t("wizard_secure_boot_hint")}</span>
                </div>
                <div className="form-control" style={{ display: "flex", alignItems: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", color: "var(--text-color)" }}>
                    <input
                      type="checkbox"
                      checked={secureBoot}
                      onChange={(e) => setSecureBoot(e.target.checked)}
                      style={{ width: "16px", height: "16px", accentColor: "var(--primary-color)" }}
                    />
                    <span>{t("wizard_secure_boot")}</span>
                  </label>
                </div>
              </div>

              <div className="form-row">
                <div className="form-label-group">
                  <span className="form-label">{t("wizard_tpm")}</span>
                  <span className="form-hint">{t("wizard_tpm_hint")}</span>
                </div>
                <div className="form-control" style={{ display: "flex", alignItems: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", color: "var(--text-color)" }}>
                    <input
                      type="checkbox"
                      checked={tpm}
                      onChange={(e) => setTpm(e.target.checked)}
                      style={{ width: "16px", height: "16px", accentColor: "var(--primary-color)" }}
                    />
                    <span>{t("wizard_tpm")}</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Storage */}
          {step === 2 && (
            <div className="wizard-fields">
              <div className="form-row">
                <div className="form-label-group">
                  <span className="form-label">{t("wizard_disk_size")}</span>
                  <span className="form-hint">{t("wizard_disk_size_hint")}</span>
                </div>
                <div className="form-control">
                  <div className="wizard-input-unit-row">
                    <input
                      type="number"
                      className="form-input wizard-num-input"
                      min={1}
                      value={diskSizeGb}
                      onChange={(e) => setDiskSizeGb(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                    <span className="wizard-unit-badge">GB</span>
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-label-group">
                  <span className="form-label">{t("wizard_storage_pool")}</span>
                  <span className="form-hint">{t("wizard_storage_pool_hint")}</span>
                </div>
                <div className="form-control">
                  <select
                    className="form-select"
                    value={storagePool}
                    onChange={(e) => setStoragePool(e.target.value)}
                  >
                    {activePools.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name} — {p.location}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Disk summary card */}
              <div className="wizard-summary-card">
                <div className="wizard-summary-row">
                  <span>{t("wizard_disk_image_name")}</span>
                  <span className="wizard-summary-val">{vmName || t("wizard_summary_none")}.qcow2</span>
                </div>
                <div className="wizard-summary-row">
                  <span>{t("wizard_format")}</span>
                  <span className="wizard-summary-val">qcow2</span>
                </div>
                <div className="wizard-summary-row">
                  <span>{t("wizard_capacity")}</span>
                  <span className="wizard-summary-val">{diskSizeGb} GB</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: ISO */}
          {step === 3 && (
            <div className="wizard-fields">
              <div className="form-row">
                <div className="form-label-group">
                  <span className="form-label">{t("wizard_storage_pool")}</span>
                  <span className="form-hint">{t("wizard_storage_pool_hint")}</span>
                </div>
                <div className="form-control">
                  <select
                    className="form-select"
                    value={isoPool}
                    onChange={(e) => { setIsoPool(e.target.value); setSelectedIso(""); }}
                  >
                    {activePools.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name} — {p.location}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-label-group">
                  <span className="form-label">{t("wizard_iso")}</span>
                  <span className="form-hint">{t("wizard_iso_hint")}</span>
                </div>
                <div className="form-control">
                  {isoLoading ? (
                    <span className="form-hint">{t("wizard_iso_loading")}</span>
                  ) : (
                    <select
                      className="form-select"
                      value={selectedIso}
                      onChange={(e) => setSelectedIso(e.target.value)}
                    >
                      <option value="">{t("wizard_iso_none")}</option>
                      {isoList
                        .filter((iso) => !isoPool || iso.pool_name === isoPool || !iso.pool_name)
                        .map((iso) => (
                          <option key={iso.path} value={iso.path}>
                            {iso.name} {!iso.pool_name && " (Non-Pool)"}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              </div>

              {isoList.filter((iso) => !isoPool || iso.pool_name === isoPool || !iso.pool_name).length === 0 && !isoLoading && (
                <div className="wizard-iso-empty">{t("wizard_iso_empty")}</div>
              )}

              {/* Final summary */}
              <div className="wizard-summary-card">
                <div className="wizard-summary-title">{t("wizard_summary")}</div>
                <div className="wizard-summary-row">
                  <span>{t("wizard_summary_name")}</span>
                  <span className="wizard-summary-val">{vmName}</span>
                </div>
                <div className="wizard-summary-row">
                  <span>{t("wizard_summary_cpu")}</span>
                  <span className="wizard-summary-val">{vcpu} vCPU</span>
                </div>
                <div className="wizard-summary-row">
                  <span>{t("wizard_summary_memory")}</span>
                  <span className="wizard-summary-val">{memoryDisplay}</span>
                </div>
                <div className="wizard-summary-row">
                  <span>{t("wizard_summary_disk")}</span>
                  <span className="wizard-summary-val">{diskSizeGb} GB (qcow2) — {storagePool}</span>
                </div>
                <div className="wizard-summary-row">
                  <span>{t("wizard_summary_iso")}</span>
                  <span className="wizard-summary-val">
                    {selectedIso ? isoList.find((i) => i.path === selectedIso)?.name ?? selectedIso : t("wizard_summary_none")}
                  </span>
                </div>
                <div className="wizard-summary-row">
                  <span>Secure Boot</span>
                  <span className="wizard-summary-val">{secureBoot ? t("wizard_summary_enabled") : t("wizard_summary_disabled")}</span>
                </div>
                <div className="wizard-summary-row">
                  <span>TPM 2.0</span>
                  <span className="wizard-summary-val">{tpm ? t("wizard_summary_enabled") : t("wizard_summary_disabled")}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="wizard-footer">
          <button className="btn-secondary" onClick={onClose} disabled={creating}>
            {t("btn_close")}
          </button>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {step > 1 && (
              <button className="btn-secondary" onClick={handleBack} disabled={creating}>
                {t("wizard_back")}
              </button>
            )}
            {step < STEP_COUNT ? (
              <button className="btn-primary" onClick={handleNext}>
                {t("wizard_next")}
              </button>
            ) : (
              <button className="btn-primary" onClick={handleCreate} disabled={creating}>
                {creating ? t("wizard_creating") : t("wizard_create")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
