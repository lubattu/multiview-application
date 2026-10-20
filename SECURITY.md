# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.5.x | ✅ |
| < 1.5 | ❌ |

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/ryuuft/multiview-application/security/advisories/new) — do **not** open a public issue for security problems.

You can expect an initial response within 7 days. Please include a description of the issue, the steps to reproduce it, and the affected version.

## Scope and known limitations

- The app embeds third-party pages (`pokeidle.io`, `twitch.tv`, `kick.com`) in WebViews constrained by navigation guards, a permission allowlist and session partitions. Concerns about **those services themselves** should be reported to them, not here.
- Known limitation: popup windows opened from within the embedded pages are not subject to the same navigation restrictions.
- WebAuthn is intentionally disabled inside this app's windows, as a workaround for a documented Electron bug ([electron#27355](https://github.com/electron/electron/issues/27355)). It does not affect your browsers.
- The app reads local Chromium browser profile directories **only** to locate an already-installed /hunt extension. It performs no telemetry and makes no network requests of its own.
