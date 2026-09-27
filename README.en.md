[简体中文](README.md)

# LAN Sync - Obsidian LAN Sync Plugin

A LocalSend-like Obsidian plugin that automatically syncs vaults and shares notes between devices on your local network — no internet required, and data never passes through any server.

## Highlights

- **Automatic device discovery**: Plug and play — devices on the LAN appear in the list automatically (desktop)
- **One-click pairing & sync**: Secure verification-code pairing between devices, with automatic background vault sync
- **Note sharing**: Share any note to a LAN device with one click from the context menu
- **Encrypted transfer**: All file transfers are automatically encrypted with AES-256-GCM
- **Large file support**: Large files are automatically chunked for stable and efficient transfer
- **History protection**: Files are backed up automatically before being overwritten by sync, and can be restored at any time
- **Real-time communication**: WebSocket-based persistent connections for instant device status awareness
- **Two-way sync**: Bidirectional sending and receiving keeps paired devices consistent
- **Sync history**: Detailed records of every sync, including sent/received file lists
- **Multi-language support**: Simplified Chinese, English, Traditional Chinese, French, Japanese, Korean

## Supported Platforms

| Feature | Desktop (Win/Mac/Linux) | Mobile (Android/iOS) |
|------|:---:|:---:|
| Automatic device discovery | ✅ | ❌ |
| Manual device connection | ✅ | ✅ |
| Two-way sync | ✅ | ✅ |
| Share notes | ✅ | ✅ |
| Receive share confirmation | ✅ | ✅ |

> Due to system limitations, mobile devices require manually entering the desktop device's IP address to connect.

## Installation

1. Copy the following three files into the `.obsidian/plugins/lan-sync/` directory of your Obsidian vault:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Open Obsidian → **Settings** → **Community plugins** → Enable "LAN Sync"

## Usage Guide

### Step 1: Set a device alias

Open the plugin settings and give your device a recognizable alias (e.g. "Xiao Ming's MacBook") so it can be easily identified on the LAN.

### Step 2: Discover devices

- **Desktop**: Turn on the "Discoverable" switch, and your device will appear in other devices' lists automatically
- **Mobile**: In the "Manually add desktop device" section of the settings page, enter the desktop device's IP address and port

You can also open the device list by searching for "View LAN devices" in the command palette.

### Step 3: Pair devices

1. Click the target device's alias in the device list
2. A 6-digit verification code is displayed on the initiator's screen
3. The target device enters the code to complete verification
4. The pairing is established automatically, and the current vault is included in the sync scope

A single device can participate in multiple pairing groups, and each group contains 2 devices.

### Step 4: Automatic sync

After pairing, the plugin checks and syncs vault changes at the configured interval (15 minutes by default). Sync rules:

- Based on each file's **last modified time**
- A history copy of the local file is created automatically before syncing (5 copies kept by default), restorable at any time
- File deletions are also synced to other paired devices

### Unpair devices

You can unpair from a device at any time in the paired devices list on the settings page. After unpairing, the two devices will no longer sync automatically, but their vault files remain unaffected.

### Sync history

In the "Sync history" section of the settings page, you can view detailed records of every sync, including sent/received file lists and change types (added/modified/deleted).

### Share notes

**Right-click** any note file → select "Share to device...":

- The recipient gets a confirmation popup with the following options:
  - Accept
  - Save as (choose a custom save path)
  - Reject
  - Add to blacklist

After repeatedly rejecting shares from the same device, it is automatically blacklisted (threshold configurable).

## Commands

| Command | Description |
|------|------|
| View LAN devices | Browse and pair with other devices on the LAN |
| Sync now | Manually trigger a vault sync |

## Settings

| Setting | Default | Description |
|------|--------|------|
| Sync interval | 15 minutes | Interval between automatic syncs |
| History copies | 5 | Number of history copies kept per file |
| History directory | `.obsidian/.lan-sync-history` | Path where history copies are stored |
| Auto-blacklist threshold | 3 | Consecutive share rejections before auto-blacklisting |
| Chunk size | 10MB | Size of each chunk for large file transfer |

## Status Bar (Desktop)

The status bar at the bottom of desktop Obsidian shows the current sync status icon. Click it to open a quick menu with actions such as manual sync, view devices, and open settings.

## License

MIT
