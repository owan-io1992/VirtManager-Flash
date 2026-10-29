# Development Guide / 開發指南

[← Back to README](README.md)

---

## English

### 🛠️ Tech Stack

- **Backend**: Rust (Tauri Core, `libvirt-rs`)
- **Frontend**: React (TypeScript) + Vite, Vanilla CSS
- **Communication**: Tauri IPC (Inter-Process Communication)

### 📋 Building from Source

#### Prerequisites

##### Build Dependencies (Required for compiling from source)
```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y libvirt-dev pkg-config build-essential curl wget libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev
```

##### Toolchain Management (`mise`)
This project uses [mise](https://mise.jdx.dev/) to manage the development toolchains (Node.js, Bun, and Rust).

Make sure you have `mise` installed, then run:
```bash
mise install
```

This will automatically install the correct versions specified in `mise.toml`.

#### Installation, Running & Building

```bash
# Run in development mode (automatically installs dependencies)
mise run dev

# Build the application (all bundles)
mise run build

# Build a specific package format (e.g. if AppImage bundler fails)
mise run build -- --bundles deb
```

#### 💻 Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

---

## 繁體中文

### 🛠️ 技術棧

- **後端**：Rust (Tauri Core, `libvirt-rs`)
- **前端**：React (TypeScript) + Vite, Vanilla CSS
- **通訊方式**：Tauri IPC (進程間通訊)

### 📋 從原始碼建置

#### 前提條件

##### 建置依賴 (從原始碼編譯時需要)
```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y libvirt-dev pkg-config build-essential curl wget libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev
```

##### 工具鏈管理 (`mise`)
本專案使用 [mise](https://mise.jdx.dev/) 來管理開發工具鏈 (Node.js, Bun 和 Rust)。

請確保您已安裝 `mise`，然後執行：
```bash
mise install
```

這將會自動安裝 `mise.toml` 中指定的正確版本。

#### 安裝、執行與建置

```bash
# 列出所有可用的 mise 任務
mise tasks

# 以開發模式執行 (會自動安裝依賴)
mise run dev

# 建置應用程式 (所有安裝包)
mise run build

# 建置特定的安裝包格式 (例如當 AppImage 打包失敗時)
mise run build -- --bundles deb
```

#### 💻 推薦的 IDE 設定

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
