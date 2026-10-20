# PokeIdle Multiview

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/ryuuft/multiview-application?v=1.5.0)](../../releases)
[![CI](https://github.com/ryuuft/multiview-application/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

**English** | [Português (Brasil)](README.pt-BR.md)

Run up to **4 isolated [pokeidle.io](https://pokeidle.io) sessions in a single window**, built for idling multiple accounts at the same time on one PC — with hidden Twitch and Kick background streams for the game's XP bonus.

> The app interface is in **Portuguese (Brazil)**. This document covers everything you need to use it.

## Features

- **Up to 4 slots**, each one an isolated, persistent session (logins survive restarts).
- **Layout modes**: Grid (2×2 with draggable splitters) and Focus (one slot highlighted).
- **Twitch & Kick background streams (multi-stream)**: each tab can watch **several official channels at once**, hidden and muted, to stack the game's XP bonus (+2.5% per extra stream) — on both platforms. Linking is done through the game's own **Link Twitch/Kick** button (authorization opens in its own window, in the tab's session, and closes itself when done). Official channel links inside the game feed the tab's background without opening extra windows — up to **8 channels per platform per tab** (📺 Twitch / 🟩 Kick counters on the tab chip). All streams resume automatically when the app reopens.
- **Close to tray**: with streams active, **×** hides the app to the tray and the farm keeps running (hint shown once). "Show" and "Quit" live on the tray icon. Configurable in **⚙** (always / streams only / never).
- **Keep the PC awake**: while streams are active, the app prevents Windows from suspending (optional in **⚙**).
- **Automatic lowest quality**: when a stream goes to the background, the app tries to pick the player's lowest quality (less CPU/GPU). Optional in **⚙**.
- **Stream health**: a stuck stream gets a **⚠** on the chip counter and is restarted automatically (rounds with backoff); problem channels are listed in the tooltip.
- **Bring a stream back**: with the panel open (📺/🟩), every background channel appears as a pill — **click the name to bring the stream back into the panel** (e.g. to claim Kick points); when done, **Background** sends it back. **×** closes it for good.
- **Login without the passkey prompt**: the app disables WebAuthn (passkeys) on Twitch, Kick and Google pages — the API is broken inside Electron ([electron#27355](https://github.com/electron/electron/issues/27355)) and the "Windows Security" prompt used to freeze the login. With the API out of the way, **Continue with Google** works through classic authentication (email + password), and Twitch/Kick also accept username/password. Two-factor codes and push approvals work normally.
- **Auto-reload**: reloads all game pages on a configurable interval (Off, 15 min, 30 min, 1 h, 3 h, 6 h, 12 h or 24 h) — handy for daily game updates.
- **/hunt extension**: if the ["/hunt for PokeIdle"](https://chromewebstore.google.com/detail/hunt-for-pokeidle/mhnplloljgchpfpcpbhmcokmnefodjnh) Chrome extension is installed in any Chromium browser on the machine (Chrome, Edge, Brave, Vivaldi, Comet, Opera…), the app automatically loads its latest version into every slot on each launch — update it in the browser and the app follows on the next reload.
- **Per-slot zoom** from 50% to 200% (10% steps).
- **Per-slot mute** and individual manual reload (⟳).
- **Rename slots** with a double click on the name or through the tab's **⋯** menu (which also has reload and close, with confirmation).
- **Crash recovery**: if the game stops responding, a "Reload" button appears over the slot.
- Settings are persisted (slots, layout, zoom, sound, auto-reload, tray, sleep, quality, window size) — under **⚙** in the top bar.

## Getting started

**Requirements:** Windows 10/11 (x64). No installer needed.

1. Download `PokeIdleMultiview.exe` (portable) from the [Releases](../../releases) page.
2. Run it.
3. Click **+ Slot** to open accounts (up to 4) and log in on each one.

> Buttons referenced in this document keep their Portuguese labels as they appear in the app: **+ Slot** (add slot), **Vincular** (link), **Segundo plano** (background), **Auto-recarga** (auto-reload), **Fechar todas** (close all).

### XP bonus with background streams

1. In the game, open the **Bônus Twitch** (or **Bônus Kick**) modal and click **Vincular** — the authorization opens in its own window and closes itself when finished.
2. Click the official channel links inside the game. The first time, a panel appears so you can confirm the login — click **Segundo plano** to pin the channel; from the next click on, each channel goes straight to the background (the tab chip shows the counters, e.g. `📺 3` and `🟩 2`).
3. With the panel open, active streams appear as pills at the top, with **×** to stop each one and **Fechar todas** to stop everything.

### Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + 1` … `Ctrl + 4` | Select the corresponding slot |

## Data & configuration

Preferences live in `%APPDATA%\PokeIdleMultiview\config.json` (atomic writes; the config is normalized on every read/save). Cookies and storage for each slot live in separate partitions (`persist:slot-1` … `persist:slot-4`).

## Privacy & security

- Embedded pages can only navigate to `pokeidle.io` / `www.pokeidle.io`. Stream panels are restricted to `twitch.tv` and `kick.com` (with `accounts.google.com` allowed during login) and replace the game inside their own tab while visible.
- WebViews only get the permissions they explicitly request from an allowlist (camera/microphone are not among them).
- The app scans local Chromium browser profiles **only** to locate an already-installed /hunt extension. Nothing is uploaded anywhere: the app makes no network requests of its own beyond the pages you load.
- WebAuthn is disabled only inside this app's windows — your browsers are untouched.
- Known limitation: popup windows opened from within the embedded pages are not subject to the same navigation restrictions.

## Disclaimer

This is an unofficial, community-made tool. It is **not affiliated with or endorsed by pokeidle.io, Twitch, Kick or Google**. Keeping streams open in the background and running multiple accounts may be subject to the terms of service of the game and of the streaming platforms — check the current rules and use the app at your own risk.

## Development

Requirements: Node.js (with npm). Windows is needed to build the executable.

```bash
npm install        # install dependencies (includes Electron)
npm start          # run the app in development mode
npm test           # run the test suite (vitest)
npm run dist       # build the portable executable into release/
```

Main structure:

```
src/
  main/          # main process (window, webview guards, IPC, app:// protocol, /hunt extension)
  renderer/      # UI (toolbar, chips, slots, splitters)
  shared/        # shared config (defaults, normalization, limits)
tests/           # tests for config, layout and extensions
scripts/         # icon generation
```

`resources/icon.ico` is generated by `npm run icon` (part of `npm run dist`) and is not versioned. Releases are cut by pushing a `vX.Y.Z` tag — a GitHub Actions workflow builds the executable and attaches it to the release automatically.

## Contributing

Bug reports and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
