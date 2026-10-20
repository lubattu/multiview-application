# Contributing to PokeIdle Multiview

Thanks for your interest in contributing! Bug reports, fixes and small features are all welcome.

## Development setup

- **Windows 10/11** — the app is Windows-only today (tray, power save blocker, portable build).
- **Node.js 20+** with npm.
- Git.

```bash
git clone https://github.com/ryuuft/multiview-application.git
cd multiview-application
npm install
npm start
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the test suite (vitest) |
| `npm run icon` | Regenerates `resources/icon.ico` |
| `npm run dist` | Builds the portable executable into `release/` |

## Project layout

```
src/
  main/          # main process: window, app:// protocol, webview guards, IPC, tray, /hunt extension
  renderer/      # UI: toolbar, chips, slots, splitters (vanilla JS, no bundler)
  shared/        # config schema, defaults and normalization shared by both processes
tests/           # vitest suites for config, layout and extension resolution
scripts/         # icon generation
```

## Making changes

- Keep each change focused on one behavior; avoid drive-by refactors.
- Logic that can be pure (validation, math, normalization) belongs in `src/shared/` or `src/renderer/js/layout.js` so it stays unit-testable.
- The UI text is in **pt-BR** — keep tone and terminology consistent with the existing screens.
- User-facing behavior changes must be reflected in **both** `README.md` (English) and `README.pt-BR.md`, and in `CHANGELOG.md` under an *Unreleased* heading when applicable.

## Tests

Run `npm test` before opening a pull request. New behavior should come with tests whenever the logic is testable without launching Electron (see the existing suites in `tests/`).

## Submitting a pull request

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests.
3. Make sure `npm test` passes.
4. Open a pull request describing **what** changed and **why**; link any related issue.
5. CI must pass on your branch.

## Reporting bugs

Open an issue using the bug report template. Include:

- App version (see the [releases](../../releases) page or `package.json`);
- Windows version;
- Steps to reproduce and what you expected to happen;
- Screenshots or console output if available.

## Security issues

Please do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## Releases

Maintained by the repository owner: bump `version` in `package.json`, push a `vX.Y.Z` tag, and the release workflow builds the portable executable and attaches it to the GitHub release.
