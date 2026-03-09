# Changelog

All notable changes to AgentLens are documented in this file.

## [0.5.3](https://github.com/tasszz2k/agent-lens/compare/agentlens-v0.5.2...agentlens-v0.5.3) (2026-03-09)


### Features

* add :q quit command to command bar ([be680ff](https://github.com/tasszz2k/agent-lens/commit/be680ff5d9e08d4da55879f2687c75e15c83fcef))
* add agentlens-dev CLI command for development usage ([4e01ebb](https://github.com/tasszz2k/agent-lens/commit/4e01ebb2437548e2ca3168bc33619de8732e5a6a))
* add cost dashboard and page navigation ([c6d2481](https://github.com/tasszz2k/agent-lens/commit/c6d248173cac8eed21249c0d8b3afbf4082883b3))
* add Homebrew tap publishing and version update check ([1c7e1ec](https://github.com/tasszz2k/agent-lens/commit/1c7e1ecca088a940e701e3fe4c3dff800fa4d8a0))
* **cost:** add Cursor leaderboard, on-demand usage, and zero-config auto-detection ([3a1d301](https://github.com/tasszz2k/agent-lens/commit/3a1d30193453250585c0844ee0efe01979e788b5))
* initial commit ([ab53cce](https://github.com/tasszz2k/agent-lens/commit/ab53cce076e74cb0c96cdf92aa083cf8705c17ed))
* **ui:** add CURRENT scope, settings view, and tool/category filters ([c720462](https://github.com/tasszz2k/agent-lens/commit/c720462b264eb07ad9327242bfe3d87dfd072fc6))
* **ui:** add vim navigation, help bar, and linked entry browsing ([7c1914d](https://github.com/tasszz2k/agent-lens/commit/7c1914d9fd365df449152e3ae7aadbc4482428d6))


### Bug Fixes

* **ci:** use if-block for auto-merge to avoid set -e failure ([1adcec9](https://github.com/tasszz2k/agent-lens/commit/1adcec9a262e7281e00d1356dc453dd0d1059631))
* include Cursor on-demand spend in total cost ([7c93f7c](https://github.com/tasszz2k/agent-lens/commit/7c93f7ce22837c5ebc0b537af32a090f89928def))

## [Unreleased]

### Changed

- **Automated releases with release-please**: replaced manual tag-push release workflow with `googleapis/release-please-action@v4`. Pushes to `main` now auto-create a release PR that bumps `package.json` version and updates the changelog. Merging the PR triggers npm publish and Homebrew tap update.

## [0.5.2] - 2026-03-07

### Fixed

- **Total cost missing Cursor on-demand spend**: the TOTAL line in the cost dashboard now includes Cursor's on-demand usage. Previously, Cursor's `totalCostUsd` was hardcoded to `0`, so on-demand spending was displayed per-tool but excluded from the total.

## [0.5.1] - 2026-03-07

### Added

- **`:q` quit command**: type `:q` in the command bar to exit the application, alongside `:scan` and `:cost` page navigation.

## [0.5.0] - 2026-03-07

### Added

- **Homebrew distribution**: `brew tap tasszz2k/tap && brew install agentlens`. The GitHub Actions release workflow now automatically publishes a Homebrew formula to the `tasszz2k/homebrew-tap` repo after each npm release.
- **Version display and update check**: the TUI header now shows the current version (e.g., `AGENTLENS v0.5.0 > Cost`). On startup, it checks the npm registry for newer versions and displays an update banner with install instructions when available.

## [0.4.0] - 2026-03-07

### Added

- **Cursor leaderboard insights**: the cost dashboard now shows your team leaderboard rank, accepted diffs, agent lines (accepted / suggested with acceptance ratio), and favorite model, fetched from the Cursor analytics API.
- **Cursor on-demand usage**: displays individual on-demand spend against your limit with a progress bar (e.g., `$1.20 / $250.00`).
- **Zero-config Cursor setup**: session token, email, and team ID are now auto-detected from Cursor's local database and APIs. Manual `--set-cursor-token` is no longer required for most users.
- **Auto-refresh on page navigation**: cost data is automatically refreshed each time you navigate to the Cost page, removing the need to press `r` manually.

### Fixed

- **Cost view content overflow**: right-aligned text (request counts, leaderboard rank) no longer wraps to the next line. The content width now correctly accounts for the box border and padding.
- **URL-encoded session tokens**: tokens stored with `%3A%3A` encoding are now decoded properly, fixing authentication failures with the leaderboard and team APIs.

## [0.3.0] - 2026-03-07

### Added

- **Cost dashboard**: new `agentlens cost` command and interactive Cost page showing usage and costs for Claude Code and Cursor. Claude Code costs are calculated from local JSONL usage logs with per-model pricing (Opus, Sonnet, Haiku). Cursor shows premium request usage against plan limits with a progress bar, fetched from the Cursor API.
- **Page navigation**: k9s-style `:` command bar to switch between pages (Scan, Cost). Supports typing to filter or up/down arrow keys to select. Each page shows a short description.
- **Cursor session token management**: `agentlens config --set-cursor-token` and `--clear-cursor-token` for storing the Cursor API session token used by the cost dashboard.
- **Settings configuration overview**: settings view now shows config file path, workspace roots with tree-style connectors, discovered project count, and Cursor token status with setup hints.

## [0.2.0] - 2026-03-07

### Added

- **CURRENT scope**: new top-level section merging global + project configs, grouped by category (Skills, Rules, MCP, etc.) then by tool. Provides a single view of all active AI configs for the current repo. Starts collapsed; `c` hotkey jumps to it.
- **Settings view**: press `s` to open an in-app settings panel where you can toggle visibility of individual tools (Canonical, Claude Code, Cursor, Codex, Copilot, Multi-agent) and categories (built-in skills, system skills, plugin skills, user rules). Changes persist to `~/.config/agentlens/config.json`.
- **CLI tool filter**: `agentlens config tools` subcommand to list, enable, and disable tools/categories from the command line (`--enable`, `--disable` flags).
- **Scope-colored headers**: GLOBAL (blue), CURRENT (green), PROJECT (white) in both interactive and static output.
- **Expand hint**: collapsed scope nodes with children show a dim `(l to expand)` hint.
- **Full descriptions in detail panel**: entry descriptions are no longer truncated when viewing details.

### Fixed

- **Cursor restoration on detail close**: `expandedOverride` state is now lifted to `App`, so tree expansion state persists across detail panel open/close. Previously, navigating into CURRENT entries and pressing ESC would jump to the wrong position.
- **Diagnostics footer**: info-level diagnostics no longer inflate the issue count. The footer only appears when there are actual errors or warnings.

## [0.1.0] - 2026-03-06

### Added

- Initial release.
- Scan global and project-level agent configuration for Cursor, Claude Code, Codex, Copilot, and multi-agent setups.
- Interactive TUI with Ink/React: tree view, detail panel, search/filter.
- Vim-style navigation (`h`/`j`/`k`/`l`, `gg`, `G`, `Ctrl+d`, `Ctrl+u`).
- Toggleable k9s-style help bar (`?`).
- Linked entry navigation in detail panel with linked vs cross-reference grouping.
- Symlink chain tracing and resolution.
- Multi-project discovery from configured workspace roots.
- Static text output for non-TTY / piped usage.
- `where` command to trace canonical skill installations across tools.
- `troubleshoot` command with health checks (broken symlinks, skill gaps, stale configs, conflicts).
- Claude Code CLI integration for AI-powered diagnostic analysis.
- MCP server config scanning (JSON + TOML).
- Hooks scanning from Claude Code settings.json.
- Cursor user rules extraction from state.vscdb via sqlite3 CLI.
