# Quo for Linux

This repository packages an unofficial Linux desktop client for [Quo](https://www.quo.com/). The client loads `https://my.quo.com` inside a hardened Electron window.

Quo does not endorse or support this project. Quo officially provides desktop applications for Windows and macOS. Its supported Linux route is the browser application.

## Security model

This fork treats all remote content as untrusted unless it belongs to an approved Quo or OpenPhone HTTPS hostname.

Renderer sandboxing and context isolation remain enabled. Node integration stays disabled. The client also blocks insecure content and webview attachment.

Internal URLs require HTTPS on the default port. Their hostnames must match a real Quo or OpenPhone domain boundary. Lookalike hosts and credential-bearing URLs are rejected. Malformed input and unsafe protocols are also rejected.

Approved external web links open through the desktop handler. Email and telephone links follow the same policy. Popup windows and server redirects receive the main window's controls.

Media access requires the exact `https://my.quo.com` origin. Requests must name audio or video explicitly. Notifications and sanitized clipboard writes require the same origin. Cross-origin frames cannot inherit these permissions.

Launches containing `--no-sandbox` or `--disable-sandbox` stop before the Quo window opens. The application has no preload script or IPC interface for remote content.

## Requirements

Development requires Node.js 22.12 or newer with npm.

Runtime requirements depend on the selected package. The Arch package declares its required desktop libraries. Audio calls also need a working PipeWire or PulseAudio-compatible session.

## Development

Install exact dependencies and fetch the verified build icon:

```bash
npm ci
```

Start the client:

```bash
npm start
```

Run validation:

```bash
npm run check
npm test
npm audit --audit-level=high
```

The icon download uses HTTPS and a pinned SHA-256 value. The Quo icon is not committed to this repository.

## Linux packages

Build configured Linux packages:

```bash
npm run dist -- --x64 --publish never
```

Artifacts are written to `release/`:

- `Quo-*.AppImage`
- `quo-linux_*.deb`
- `quo-linux-*.pacman`

The package archive includes the runtime icon, license, main process, and all policy modules.

### Arch and Omarchy

Install the generated native package with pacman:

```bash
sudo pacman -U release/quo-linux-*.pacman
```

The package uses current Arch dependency names. It does not require the removed `http-parser` or `libappindicator-gtk3` packages.

Omarchy already supplies PipeWire, portals, Chromium support libraries, and a desktop keyring. The native package is the preferred dedicated-client format.

Omarchy also provides an Install > Web App workflow. That option uses the maintained system Chromium and remains the lowest-maintenance choice.

### AppImage

The AppImage bundles Electron and needs either FUSE2 compatibility or extraction mode:

```bash
APPIMAGE_EXTRACT_AND_RUN=1 ./release/Quo-*.AppImage
```

The launcher may add `--no-sandbox` when user namespaces are unavailable. This client rejects that fallback instead of running without Chromium isolation.

Use the native Arch package when the AppImage exits because sandbox support is unavailable.

### Debian and Ubuntu

Install the generated Debian package with apt:

```bash
sudo apt install ./release/quo-linux_*.deb
```

## Runtime behavior

Closing the main window hides it while Quo remains available for calls and notifications. Use the tray menu to reopen or quit the client.

Window geometry is saved asynchronously. Invalid or off-screen geometry is moved back onto an active display.

Network failures use one bounded retry timer. Repeated renderer crashes also use delayed, finite recovery attempts.

Recovery records are stored in Electron's user-data directory. Records contain event types and numeric codes. They also contain hostnames. URL paths and credentials are excluded. Query values and fragments are also excluded.

The log rotates at 256 KiB and uses user-only file permissions.

## CI

GitHub Actions runs syntax checks, behavior tests, and a high-severity dependency audit. It also builds Linux packages and inspects packaged resources.

CI checks the AppImage launcher and Arch package metadata. Built artifacts are retained as workflow artifacts in this fork.

## Current limitations

Quo does not list Linux as a supported desktop operating system. Browser changes can still affect login, calls, or notifications.

The repository does not provide an automatic updater. Install a newly built package when Electron or Quo requirements change.

Wayland microphone access depends on the host PipeWire session. Tray behavior depends on the desktop StatusNotifier implementation.

## License

Repository code is available under the MIT License. Quo owns its name and icon. It also owns the web application.
