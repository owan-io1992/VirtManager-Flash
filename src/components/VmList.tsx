import React, { useState } from "react";
import { DomainItem, Folder } from "../types";
import { TranslationKey } from "../translations";

// Helper to determine VM state styles
const getStateInfo = (stateNum: number) => {
  switch (stateNum) {
    case 1:
      return { label: "Running", className: "running" };
    case 3:
      return { label: "Paused", className: "paused" };
    case 5:
      return { label: "Stopped", className: "stopped" };
    default:
      return { label: "Offline", className: "stopped" };
  }
};

interface VmListProps {
  domains: DomainItem[];
  folders: Folder[];
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  topLevelOrder: string[];
  setTopLevelOrder: React.Dispatch<React.SetStateAction<string[]>>;
  selectedVmNames: string[];
  setSelectedVmNames: React.Dispatch<React.SetStateAction<string[]>>;
  lastSelectedName: string | null;
  setLastSelectedName: React.Dispatch<React.SetStateAction<string | null>>;
  lang: "zh" | "en";
  t: (key: TranslationKey) => string;
  loading: boolean;
  newFolderName: string;
  setNewFolderName: (val: string) => void;
  isCreatingFolder: boolean;
  setIsCreatingFolder: (val: boolean) => void;
  handleCreateFolder: () => void;
  handleDeleteFolder: (folderId: string, e: React.MouseEvent) => void;
  toggleFolderCollapse: (folderId: string) => void;
  handleContextMenu: (e: React.MouseEvent, name: string) => void;
}

export const VmList = ({
  domains,
  folders,
  setFolders,
  topLevelOrder,
  setTopLevelOrder,
  selectedVmNames,
  setSelectedVmNames,
  lastSelectedName,
  setLastSelectedName,
  lang,
  t,
  loading,
  newFolderName,
  setNewFolderName,
  isCreatingFolder,
  setIsCreatingFolder,
  handleCreateFolder,
  handleDeleteFolder,
  toggleFolderCollapse,
  handleContextMenu,
}: VmListProps) => {
  const [filterText, setFilterText] = useState("");

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<{ type: "vm" | "folder"; id: string } | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  const [dragInsertion, setDragInsertion] = useState<{ targetId: string; position: "before" | "after" } | null>(null);

  // Drag and drop handlers
  const handleVmDragStart = (e: React.DragEvent, vmName: string) => {
    setDraggedItem({ type: "vm", id: vmName });
    e.dataTransfer.setData("text/plain", vmName);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleFolderDragStart = (e: React.DragEvent, folderId: string) => {
    setDraggedItem({ type: "folder", id: folderId });
    e.dataTransfer.setData("text/plain", folderId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedItem) return;
    if (draggedItem.id === targetId) return;

    setDragOverItem(targetId);

    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const isUpperHalf = relativeY < rect.height / 2;

    setDragInsertion({
      targetId,
      position: isUpperHalf ? "before" : "after",
    });
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
    setDragInsertion(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
    setDragInsertion(null);
  };

  const handleDropOnItem = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const insertion = dragInsertion;
    setDragOverItem(null);
    setDragInsertion(null);
    setDraggedItem(null);
    if (!draggedItem || !insertion) return;

    if (draggedItem.type === "vm") {
      const draggedVm = draggedItem.id;
      if (draggedVm === targetId) return;

      let sourceFolderId: string | null = null;
      folders.forEach((f) => {
        if (f.vmNames.includes(draggedVm)) sourceFolderId = f.id;
      });

      if (sourceFolderId) {
        setFolders((prev) =>
          prev.map((f) => (f.id === sourceFolderId ? { ...f, vmNames: f.vmNames.filter((v) => v !== draggedVm) } : f))
        );
      } else {
        setTopLevelOrder((prev) => prev.filter((v) => v !== draggedVm));
      }

      let targetFolderId: string | null = null;
      folders.forEach((f) => {
        if (f.vmNames.includes(targetId)) targetFolderId = f.id;
      });

      if (targetFolderId) {
        setFolders((prev) =>
          prev.map((f) => {
            if (f.id === targetFolderId) {
              const newVms = f.vmNames.filter((v) => v !== draggedVm);
              const targetIdx = newVms.indexOf(targetId);
              const insertIdx = insertion.position === "before" ? targetIdx : targetIdx + 1;
              newVms.splice(insertIdx, 0, draggedVm);
              return { ...f, vmNames: newVms };
            }
            return f;
          })
        );
      } else {
        setTopLevelOrder((prev) => {
          const newOrder = prev.filter((v) => v !== draggedVm);
          const targetIdx = newOrder.indexOf(targetId);
          const insertIdx = insertion.position === "before" ? targetIdx : targetIdx + 1;
          newOrder.splice(insertIdx, 0, draggedVm);
          return newOrder;
        });
      }
    } else if (draggedItem.type === "folder") {
      const draggedFolderId = draggedItem.id;
      let targetTopLevelItem = targetId;
      folders.forEach((f) => {
        if (f.vmNames.includes(targetId)) {
          targetTopLevelItem = f.id;
        }
      });

      if (draggedFolderId === targetTopLevelItem) return;

      setTopLevelOrder((prev) => {
        const newOrder = prev.filter((x) => x !== draggedFolderId);
        const targetIdx = newOrder.indexOf(targetTopLevelItem);
        const insertIdx = insertion.position === "before" ? targetIdx : targetIdx + 1;
        newOrder.splice(insertIdx, 0, draggedFolderId);
        return newOrder;
      });
    }
  };

  const handleDropOnFolderHeader = (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    const insertion = dragInsertion;
    setDragOverItem(null);
    setDragInsertion(null);
    setDraggedItem(null);
    if (!draggedItem) return;

    if (draggedItem.type === "vm") {
      const draggedVm = draggedItem.id;
      let sourceFolderId: string | null = null;
      folders.forEach((f) => {
        if (f.vmNames.includes(draggedVm)) sourceFolderId = f.id;
      });

      if (sourceFolderId === targetFolderId) return;

      if (sourceFolderId) {
        setFolders((prev) =>
          prev.map((f) => (f.id === sourceFolderId ? { ...f, vmNames: f.vmNames.filter((v) => v !== draggedVm) } : f))
        );
      } else {
        setTopLevelOrder((prev) => prev.filter((v) => v !== draggedVm));
      }

      setFolders((prev) =>
        prev.map((f) => (f.id === targetFolderId ? { ...f, vmNames: [draggedVm, ...f.vmNames] } : f))
      );
    } else if (draggedItem.type === "folder") {
      const draggedFolderId = draggedItem.id;
      if (draggedFolderId === targetFolderId) return;
      if (!insertion) return;

      setTopLevelOrder((prev) => {
        const newOrder = prev.filter((x) => x !== draggedFolderId);
        const targetIdx = newOrder.indexOf(targetFolderId);
        const insertIdx = insertion.position === "before" ? targetIdx : targetIdx + 1;
        newOrder.splice(insertIdx, 0, draggedFolderId);
        return newOrder;
      });
    }
  };

  const handleDropOnContainer = (e: React.DragEvent) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    setDragOverItem(null);
    setDragInsertion(null);
    setDraggedItem(null);
    if (!draggedItem) return;

    if (draggedItem.type === "vm") {
      const draggedVm = draggedItem.id;
      let sourceFolderId: string | null = null;
      folders.forEach((f) => {
        if (f.vmNames.includes(draggedVm)) sourceFolderId = f.id;
      });

      if (sourceFolderId) {
        setFolders((prev) =>
          prev.map((f) => (f.id === sourceFolderId ? { ...f, vmNames: f.vmNames.filter((v) => v !== draggedVm) } : f))
        );
      } else {
        setTopLevelOrder((prev) => prev.filter((v) => v !== draggedVm));
      }

      setTopLevelOrder((prev) => {
        if (prev.includes(draggedVm)) return prev;
        return [...prev, draggedVm];
      });
    }
  };

  // Selection handlers
  const handleItemClick = (e: React.MouseEvent, name: string) => {
    if (e.shiftKey && lastSelectedName && lastSelectedName !== name) {
      const lastIndex = domains.findIndex((d) => d.name === lastSelectedName);
      const currentIndex = domains.findIndex((d) => d.name === name);
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeNames = domains.slice(start, end + 1).map((d) => d.name);
        setSelectedVmNames(rangeNames);
      }
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedVmNames((prev) => {
        if (prev.includes(name)) {
          return prev.filter((n) => n !== name);
        } else {
          return [...prev, name];
        }
      });
      setLastSelectedName(name);
    } else {
      setSelectedVmNames([name]);
      setLastSelectedName(name);
    }
  };

  const handleCheckboxChange = (name: string) => {
    setSelectedVmNames((prev) => {
      if (prev.includes(name)) {
        return prev.filter((n) => n !== name);
      } else {
        return [...prev, name];
      }
    });
    setLastSelectedName(name);
  };

  const filter = filterText.trim().toLowerCase();
  const matchesFilter = (name: string) => !filter || name.toLowerCase().includes(filter);

  // When filtering: flatten everything and show only matched VMs (ignore folders)
  const isFiltering = filter.length > 0;
  const filteredDomains = isFiltering ? domains.filter((d) => matchesFilter(d.name)) : null;

  return (
    <>
      {/* Filter input */}
      <div className="vm-filter-row">
        <div className="vm-filter-input-wrap">
          <svg className="vm-filter-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="vm-filter-input"
            type="text"
            placeholder={lang === "zh" ? "搜尋 VM..." : "Filter VMs..."}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
          {filterText && (
            <button className="vm-filter-clear" onClick={() => setFilterText("")}>✕</button>
          )}
        </div>
      </div>

      {isCreatingFolder && (
        <div className="folder-create-container">
          <input
            type="text"
            className="input-folder-name"
            placeholder={t("placeholder_new_folder")}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFolder();
              if (e.key === "Escape") setIsCreatingFolder(false);
            }}
            autoFocus
          />
          <button className="btn-folder-create-confirm" onClick={handleCreateFolder}>✓</button>
          <button className="btn-folder-create-cancel" onClick={() => setIsCreatingFolder(false)}>✗</button>
        </div>
      )}

      <div
        className={`vm-list ${draggedItem ? "dragging-active" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropOnContainer}
      >
        {/* Filtered flat list */}
        {isFiltering && filteredDomains!.map((vm) => {
          const isSelected = selectedVmNames.includes(vm.name);
          const stateInfo = getStateInfo(vm.state);
          return (
            <div
              key={vm.name}
              className={`vm-list-item ${isSelected ? "selected" : ""}`}
              onClick={(e) => handleItemClick(e, vm.name)}
              onContextMenu={(e) => handleContextMenu(e, vm.name)}
            >
              <div className="vm-item-checkbox-container" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  className="vm-item-checkbox"
                  checked={isSelected}
                  onChange={() => handleCheckboxChange(vm.name)}
                />
              </div>
              <div className="vm-item-details">
                <span className="vm-item-name">{vm.name}</span>
                <span className="vm-item-type">
                  {vm.os_type.toLowerCase().includes("hvm") ? "KVM VM" : "LXC Container"}
                </span>
              </div>
              <div className="vm-item-status">
                <span className={`status-dot-mini ${stateInfo.className}`}></span>
              </div>
            </div>
          );
        })}
        {isFiltering && filteredDomains!.length === 0 && (
          <div style={{ textAlign: "center", color: "#64748B", padding: "2rem 0", fontSize: "0.85rem" }}>
            {lang === "zh" ? "找不到符合的 VM" : "No matching VMs"}
          </div>
        )}

        {/* Normal ordered list (folders + top-level VMs) */}
        {!isFiltering && topLevelOrder.map((itemId) => {
          if (itemId.startsWith("folder_")) {
            const folder = folders.find((f) => f.id === itemId);
            if (!folder) return null;

            const isInsertionTarget = dragInsertion?.targetId === folder.id;
            const isVmHovering = dragOverItem === folder.id && draggedItem?.type === "vm";
            const folderHeaderClass = `folder-header ${isVmHovering ? "drag-over-folder-header" : ""} ${
              isInsertionTarget && draggedItem?.type === "folder"
                ? (dragInsertion.position === "before" ? "drag-insert-before" : "drag-insert-after")
                : ""
            }`;

            return (
              <div
                key={folder.id}
                className="folder-item"
                onDragOver={(e) => handleDragOver(e, folder.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDropOnFolderHeader(e, folder.id)}
              >
                {/* Folder Header */}
                <div
                  className={folderHeaderClass}
                  draggable
                  onDragStart={(e) => handleFolderDragStart(e, folder.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => toggleFolderCollapse(folder.id)}
                >
                  <span className={`folder-caret ${folder.collapsed ? "collapsed" : ""}`}>▼</span>
                  <span className="folder-icon">{folder.collapsed ? "📁" : "📂"}</span>
                  <span className="folder-name">{folder.name}</span>
                  <button
                    className="btn-delete-folder"
                    onClick={(e) => handleDeleteFolder(folder.id, e)}
                    title="刪除資料夾"
                  >
                    🗑️
                  </button>
                </div>

                {/* Folder Children VMs */}
                {!folder.collapsed && (
                  <div className="folder-children">
                    {folder.vmNames.map((vmName) => {
                      const vm = domains.find((d) => d.name === vmName);
                      if (!vm) return null;
                      const isSelected = selectedVmNames.includes(vm.name);
                      const stateInfo = getStateInfo(vm.state);

                      const isInsertionTargetVm = dragInsertion?.targetId === vm.name;
                      const vmClass = `vm-list-item ${isSelected ? "selected" : ""} ${
                        isInsertionTargetVm ? (dragInsertion.position === "before" ? "drag-insert-before" : "drag-insert-after") : ""
                      }`;

                      return (
                        <div
                          key={vm.name}
                          className={vmClass}
                          draggable
                          onDragStart={(e) => handleVmDragStart(e, vm.name)}
                          onDragOver={(e) => handleDragOver(e, vm.name)}
                          onDragLeave={handleDragLeave}
                          onDragEnd={handleDragEnd}
                          onDrop={(e) => handleDropOnItem(e, vm.name)}
                          onClick={(e) => handleItemClick(e, vm.name)}
                          onContextMenu={(e) => handleContextMenu(e, vm.name)}
                        >
                          <div className="vm-item-checkbox-container" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="vm-item-checkbox"
                              checked={isSelected}
                              onChange={() => handleCheckboxChange(vm.name)}
                            />
                          </div>
                          <div className="vm-item-details">
                            <span className="vm-item-name">{vm.name}</span>
                            <span className="vm-item-type">
                              {vm.os_type.toLowerCase().includes("hvm") ? "KVM VM" : "LXC Container"}
                            </span>
                          </div>
                          <div className="vm-item-status">
                            <span className={`status-dot-mini ${stateInfo.className}`}></span>
                          </div>
                        </div>
                      );
                    })}
                    {folder.vmNames.length === 0 && (
                      <div style={{ padding: "0.5rem 1rem", fontSize: "0.75rem", color: "#64748B", fontStyle: "italic" }}>
                        {lang === "zh" ? "拖移 VM 到此處..." : "Drag VM here..."}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          } else {
            // Top-level VM
            const vm = domains.find((d) => d.name === itemId);
            if (!vm) return null;
            const isSelected = selectedVmNames.includes(vm.name);
            const stateInfo = getStateInfo(vm.state);

            const isInsertionTargetVm = dragInsertion?.targetId === vm.name;
            const vmClass = `vm-list-item ${isSelected ? "selected" : ""} ${
              isInsertionTargetVm ? (dragInsertion.position === "before" ? "drag-insert-before" : "drag-insert-after") : ""
            }`;

            return (
              <div
                key={vm.name}
                className={vmClass}
                draggable
                onDragStart={(e) => handleVmDragStart(e, vm.name)}
                onDragOver={(e) => handleDragOver(e, vm.name)}
                onDragLeave={handleDragLeave}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDropOnItem(e, vm.name)}
                onClick={(e) => handleItemClick(e, vm.name)}
                onContextMenu={(e) => handleContextMenu(e, vm.name)}
              >
                <div className="vm-item-checkbox-container" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="vm-item-checkbox"
                    checked={isSelected}
                    onChange={() => handleCheckboxChange(vm.name)}
                  />
                </div>
                <div className="vm-item-details">
                  <span className="vm-item-name">{vm.name}</span>
                  <span className="vm-item-type">
                    {vm.os_type.toLowerCase().includes("hvm") ? "KVM VM" : "LXC Container"}
                  </span>
                </div>
                <div className="vm-item-status">
                  <span className={`status-dot-mini ${stateInfo.className}`}></span>
                </div>
              </div>
            );
          }
        })}

        {!isFiltering && domains.length === 0 && !loading && (
          <div style={{ textAlign: "center", color: "#64748B", padding: "2rem 0", fontSize: "0.85rem" }}>
            {t("empty_vms")}
          </div>
        )}
      </div>
    </>
  );
};
