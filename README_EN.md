# Claude Code

[![GitHub Stars](https://img.shields.io/github/stars/claude-code/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/claude-code/claude-code/stargazers)
[![GitHub Contributors](https://img.shields.io/github/contributors/claude-code/claude-code?style=flat-square&color=green)](https://github.com/claude-code/claude-code/graphs/contributors)
[![GitHub Issues](https://img.shields.io/github/issues/claude-code/claude-code?style=flat-square&color=orange)](https://github.com/claude-code/claude-code/issues)
[![GitHub License](https://img.shields.io/github/license/claude-code/claude-code?style=flat-square)](https://github.com/claude-code/claude-code/blob/main/LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/claude-code/claude-code?style=flat-square&color=blue)](https://github.com/claude-code/claude-code/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)

> Which Claude do you like? The open source one is the best.

A reverse-engineered / decompiled source restoration of Anthropic's official Claude Code CLI tool. The goal is to keep the Claude Code interaction model while restoring multi-model providers, remote control, ACP, swarm/pipes, MCP, plugins, KAIROS, Buddy, observability, and local automation.

The published npm package is **`@go-hare/claude-code`** (current line: **2.6.35**). Platform binaries ship as optionalDependencies: `@go-hare/claude-code-<os>-<arch>`.

| Feature | Notes |
| ------- | ----- |
| **Pipes / multi-instance** | Same-host main/sub orchestration + LAN discovery; `/pipes` panel + `Shift+↓` routing |
| **ACP** | First-class agent protocol for IDEs (Zed/Cursor), session resume, skills, permission bridge |
| **Remote Control** | Self-hosted Docker remote UI — use Claude Code from a phone/browser |
| **Agents / background sessions** | `claude agents` fullscreen dashboard, daemon job dispatch, `/exit` handoff (resume/fork), Windows WMI self-spawn |
| **Fullscreen densable** | Official 2.1.210 alignment: fullscreen on by default, wheel / Jump-to-bottom, spinner visibility resume, alt-screen exit anti-flash |
| **Langfuse** | Agent-loop observability and dataset export |
| **Web Search** | Built-in search (Bing / Brave) |
| **Poor Mode** | `/poor` — drop memory extract + prompt suggestions to cut concurrent spend |
| **KAIROS** | Persistent assistant mode (brief, wait, channels, daily memory, PR push) |
| **Buddy** | Terminal companion pet (`/buddy`) |
| **Channels** | External push into the session (Feishu/Slack/Discord/WeChat plugins) |
| **Custom providers** | OpenAI / Anthropic / Gemini / Grok via `/login` (incl. Sonnet 5 / Org default) |
| **Gateway / IdP sessions** | Expired session tryRestore, secure-storage negative cache, refreshable restore without silent Bedrock fallback |
| Voice / Computer Use / Chrome Use | Doubao ASR, screenshot+input, browser automation |
| Artifacts | HTML/Markdown hosting with highlight + mermaid |
| Sentry / GrowthBook | Enterprise error tracking and feature flags |
| `/dream` | Memory file consolidation |

## Recent updates (2.6.x)

| Range | Highlights |
| ----- | ---------- |
| **2.6.35** | Windows packaged rg.exe main path uses spawn+windowsHide (no conhost flash on Grep/Glob) |
| **2.6.34** | Jump-to-bottom spinner resume; agents left-arrow / daemon skew; CSI u fullwidth colon |
| **2.6.32–2.6.30** | Alt-screen double-EXIT flash fix on Windows Terminal; fullscreen/wheel densable vs official 2.1.210 |
| **2.6.29** | Modal double-border, wheel residue, collapse blank fixes |
| **Agents view** | Group order / review list / done fold / PR column / theme tokens / needs-input nudge / token footer |
| **Gateway** | tryRestore, IdP transient re-read, secure-storage negative cache, explicit Gateway env |
| **Daemon / exit** | `/exit` → daemon `submitDispatch(resume/fork)`; stable user-bin launch; Windows WMI densable |
| **≤2.6.27** | vendor +x postinstall, Windows Bash/ripgrep, swarm banner width, macOS image paste |

## Quick start (install from npm)

```sh
npm i -g @go-hare/claude-code

# Windows: if install hits EBUSY, kill the locked binary first
# taskkill /F /IM claude.exe

claude
claude --version
claude agents
claude update
```

If install/update fails: `npm rm -g @go-hare/claude-code` then `npm i -g @go-hare/claude-code@latest` (or pin e.g. `@2.6.35`).

> Older docs that say `npm i -g claude-code` do **not** match this fork’s publish stream — use `@go-hare/claude-code`.

## Quick start (from source)

### Prerequisites

Use a recent Bun (`bun upgrade`). Target: [Bun](https://bun.sh/) >= 1.3.11.

```bash
# Linux / macOS
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

Reload the shell so `bun` is on `PATH`, then:

```bash
cd /path/to/claude-code
bun install
bun run dev      # dev REPL (version 888 = defines injected)
bun run build    # code-split dist/cli.js + chunks
bun run precheck # typecheck + biome fix + test
```

Cross-platform native publish:

```bash
bun run build:compile
bun run scripts/publish.ts
bun run scripts/publish.ts --with-main
```

### First-time `/login`

In the REPL, run `/login` and pick **Anthropic Compatible** (or OpenAI / Gemini). Settings land under `~/.claude/settings.json` → `env`.

| Field | Example |
|-------|---------|
| Base URL | `https://api.example.com/v1` |
| API Key | `sk-xxx` |
| Haiku / Sonnet / Opus model IDs | provider-specific model names |

## Feature flags

Enable with `FEATURE_<FLAG_NAME>=1`, e.g.:

```bash
FEATURE_BUDDY=1 FEATURE_BG_SESSIONS=1 bun run dev
```

See [`docs/features/`](docs/features/) for per-feature notes.

## VS Code debugging

TUI needs a real terminal — use attach mode:

1. `bun run dev:inspect` → note `ws://localhost:8888/...`
2. F5 → **Attach to Bun (TUI debug)**

## Contributors

<a href="https://github.com/claude-code/claude-code/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=claude-code/claude-code" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=claude-code%2Fclaude-code&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=claude-code%2Fclaude-code&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=claude-code%2Fclaude-code&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=claude-code%2Fclaude-code&type=date&legend=top-left" />
 </picture>
</a>

## License

This project is for educational and research purposes only. All rights to Claude Code belong to [Anthropic](https://www.anthropic.com/).
