# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-10-16

### Added

- Close to tray: with streams active, the window button hides the app to the tray and the farm keeps running; behavior configurable (always / streams only / never) with a one-time hint.
- Anti-suspension: while streams are active, the app optionally blocks Windows from suspending.
- Stream health: stuck streams get a ⚠ indicator on the tab chip and restart automatically in rounds with backoff; problem channels are listed in the tooltip.
- Reworked tab chip UI.

## [1.4.0] - 2026-10-16

### Added

- Kick channels in the background — both Twitch and Kick streams now work per tab (up to 8 channels per platform).

## [1.3.0] - 2026-10-14

### Added

- Twitch background channels per tab for the game's XP bonus: link through the in-game button, official channel links feed hidden and muted viewers without extra windows, and all streams resume automatically on relaunch.
- Background streams can be brought back into the panel (e.g. to claim points) and returned to the background.

## [1.2.0] - 2026-10-13

### Added

- Automatic loading of the locally installed ["/hunt for PokeIdle"](https://chromewebstore.google.com/detail/hunt-for-pokeidle/mhnplloljgchpfpcpbhmcokmnefodjnh) extension into all slots, picking the latest version found in any Chromium browser profile.

## [1.1.0] - 2026-10-13

### Added

- Configurable auto-reload of all game pages (Off, 15 min, 30 min, 1 h, 3 h, 6 h, 12 h or 24 h), persisted across sessions.

## [1.0.0] - 2026-10-09

### Added

- Initial release: up to 4 isolated [pokeidle.io](https://pokeidle.io) sessions in a single window, each with its own persistent login.
- Grid (2×2, draggable splitters) and Focus layout modes.
- Per-slot zoom (50–200%), mute and manual reload; slot renaming.
- `Ctrl + 1` … `Ctrl + 4` slot shortcuts.
- Crash recovery with an in-slot reload button.
- Portable Windows x64 executable with a custom icon.
