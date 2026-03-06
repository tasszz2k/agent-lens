# Changelog

All notable changes to AgentLens are documented in this file.

## [Unreleased]

### Added

- **Cost dashboard**: new `agentlens cost` command and interactive Cost page showing usage and costs for Claude Code and Cursor. Claude Code costs are calculated from local JSONL usage logs with per-model pricing. Cursor shows premium request usage against plan limits fetched from the Cursor API.
- **Page navigation**: k9s-style `:` command bar to switch between pages (Scan, Cost). Supports typing to filter or up/down arrow keys to select. Each page shows a short description.
- **Cursor session token management**: `agentlens config --set-cursor-token` and `--clear-cursor-token` for storing the Cursor API session token used by the cost dashboard.
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
