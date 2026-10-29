# VirtManager-Flash

<p align="center">
  <img src="src/assets/LOGO.png" alt="VirtManager-Flash Logo" width="220" />
</p>

<p align="center">
  <a href="#english">English</a> | <a href="#繁體中文">繁體中文</a>
</p>

---

<a name="english"></a>
## English

> A modern, lightweight, and blazing-fast KVM virtualization desktop application, serving as a modern and lightweight alternative/complement to **virt-manager**, powered by the **Tauri** framework.

### 🌟 Introduction

**VirtManager-Flash** aims to simplify the complexity of `virt-manager`, combining the raw performance and security of Rust with a premium, modern, and fluid user interface built with web technologies, all packaged seamlessly using Tauri.

### 🚀 Key Features

- **KVM Native Management**: Seamlessly manage **KVM** (Kernel-based Virtual Machines) with a clean, fast interface.
- **Modern User Experience**: A beautiful, fluid interface with dark mode, interactive monitoring charts, and micro-animations.
- **Lightweight & Fast**: Extremely low resource footprint compared to Electron-based alternatives, thanks to Tauri and Rust.
- **Remote & Local Connections**: Manage hypervisors locally or over secure SSH tunnels.

### 📋 Getting Started

#### Installation & Requirements

This application talks to the local `libvirtd` daemon, so `libvirt` itself must be installed and running (not just its client library). Installing `virt-manager` is the recommended way to pull this in, since VirtManager-Flash also relies on `virt-manager` for advanced configuration it doesn't cover itself.

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y virt-manager libgtk-3-0 libwebkit2gtk-4.1-0 librsvg2-common

# Fedora / RHEL / CentOS
sudo dnf install -y virt-manager gtk3 webkit2gtk4.1 librsvg2

# Arch Linux
sudo pacman -S --needed virt-manager gtk3 webkit2gtk-4.1 librsvg
```

After installing, make sure the `libvirtd` service is enabled and running:
```bash
sudo systemctl enable --now libvirtd
```

#### 🧑‍💻 For Developers

Building from source, architecture and contributing: see [DEVELOPMENT.md](DEVELOPMENT.md).

#### 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<a name="繁體中文"></a>
## 繁體中文

> 基於 **Tauri** 框架打造，作為 **virt-manager** 現代化與輕量化互補/替代選擇的 **KVM** 虛擬化管理桌面應用程式。

### 🌟 簡介

**VirtManager-Flash** 旨在**簡化 `virt-manager` 的複雜度**，結合 Rust 的極致效能與安全性，搭配以網頁技術建構的精美、現代化且流暢的用戶介面，並透過 Tauri 進行無縫封裝，為您帶來更簡單、直覺的 KVM 虛擬化管理體驗。

### 🚀 核心特性

- **KVM 原生管理**：透過簡潔、快速的介面無縫管理 **KVM** (核心虛擬機)。
- **現代化使用者體驗**：擁有深色模式、互動式監控圖表和細微動畫的精美、流暢介面。
- **輕量與極速**：得益於 Tauri 和 Rust，與基於 Electron 的替代方案相比，資源占用極低。
- **遠端與本地連線**：透過本地或安全的 SSH 通道管理虛擬化主機。

### 📋 開始使用

#### 安裝與系統需求

本應用程式會與本機的 `libvirtd` 服務通訊，因此必須安裝並啟動 `libvirt` 本身（而不僅僅是其用戶端函式庫）。建議直接安裝 `virt-manager`，除了會一併安裝 `libvirt` 之外，VirtManager-Flash 本身未涵蓋的進階設定也需要依靠 `virt-manager` 協助處理。

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y virt-manager libgtk-3-0 libwebkit2gtk-4.1-0 librsvg2-common

# Fedora / RHEL / CentOS
sudo dnf install -y virt-manager gtk3 webkit2gtk4.1 librsvg2

# Arch Linux
sudo pacman -S --needed virt-manager gtk3 webkit2gtk-4.1 librsvg
```

安裝完成後，請確認 `libvirtd` 服務已啟用並執行中：
```bash
sudo systemctl enable --now libvirtd
```

#### 🧑‍💻 開發者

從原始碼建置、架構與貢獻方式請參閱 [DEVELOPMENT.md](DEVELOPMENT.md)。

#### 📄 授權條款

本專案採用 MIT 授權條款 - 詳見 [LICENSE](LICENSE) 檔案。
