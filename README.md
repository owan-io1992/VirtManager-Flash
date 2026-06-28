# VirtManager-Flash

<p align="center">
  <img src="src/assets/LOGO.png" alt="VirtManager-Flash Logo" width="220" />
</p>

> A modern, lightweight, and blazing-fast desktop application designed to replace **virt-manager** for managing **KVM**, powered by the **Tauri** framework.

---

## 🌟 Introduction

**VirtManager-Flash** is a next-generation virtualization management tool. Traditional tools like `virt-manager` are powerful but rely on legacy desktop technologies and can feel clunky. VirtManager-Flash bridges the gap by combining the raw performance and security of Rust with a premium, modern, and fluid user interface built with web technologies, all packaged seamlessly using Tauri.

---

## 🚀 Key Features

- **KVM Native Management**: Seamlessly manage **KVM** (Kernel-based Virtual Machines) with a clean, fast interface.
- **Modern User Experience**: A beautiful, fluid interface with dark mode, interactive monitoring charts, and micro-animations.
- **Lightweight & Fast**: Extremely low resource footprint compared to Electron-based alternatives, thanks to Tauri and Rust.
- **Remote & Local Connections**: Manage hypervisors locally or over secure SSH tunnels.
- **Superpowers Workflow**: Developed with high-efficiency, automated, and AI-collaborative processes to ensure robust, secure, and clean code.

---

## 🛠️ Tech Stack

- **Backend**: Rust (Tauri Core, `libvirt-rs`)
- **Frontend**: React (TypeScript) + Vite, Vanilla CSS
- **Communication**: Tauri IPC (Inter-Process Communication)

---

## 📋 Getting Started

### Prerequisites

To build and run VirtManager-Flash locally, you need the following dependencies installed on your system:

#### Rust & Tauri System Dependencies
```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y libvirt-dev pkg-config build-essential curl wget libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev
```

#### Toolchain Management (`mise`)
This project uses [mise](https://mise.jdx.dev/) to manage the development toolchains (Node.js, Bun, and Rust).

Make sure you have `mise` installed, then run:
```bash
mise install
```

This will automatically install the correct versions specified in `mise.toml`.

### Installation & Running

```bash
# Run in development mode (automatically installs dependencies)
mise run dev
```

---

## 💻 Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](file:///home/owan/data/git/Vessel/LICENSE) file for details.
