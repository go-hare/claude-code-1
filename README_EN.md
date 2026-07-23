# Claude Code (go-hare)

[![GitHub Stars](https://img.shields.io/github/stars/go-hare/claude-code-1?style=flat-square&logo=github&color=yellow)](https://github.com/go-hare/claude-code-1/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/go-hare/claude-code-1?style=flat-square&color=orange)](https://github.com/go-hare/claude-code-1/issues)
[![Last Commit](https://img.shields.io/github/last-commit/go-hare/claude-code-1?style=flat-square&color=blue)](https://github.com/go-hare/claude-code-1/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)
[![npm](https://img.shields.io/npm/v/@go-hare/claude-code?style=flat-square&logo=npm)](https://www.npmjs.com/package/@go-hare/claude-code)

[中文 README](./README.md)

A **source restoration / engineering rebuild** of Anthropic’s official Claude Code CLI. The goal is to keep the Claude Code terminal experience while adding multi-provider models, self-hosted Remote Control, ACP, daemon / background sessions, MCP, plugins, and local automation.

> This is **not** an Anthropic product. Claude Code trademarks and rights belong to [Anthropic](https://www.anthropic.com/). This project is for learning and research.

| Capability | Notes |
| ---------- | ----- |
| **Multi-provider** | Configure Anthropic / OpenAI / Gemini / Grok-compatible endpoints via `/login` |
| **Remote Control** | Self-hosted RCS + Web UI; `claude remote-control` / bridge |
| **ACP** | Agent Client Protocol for IDE / proxy hosts |
| **Agents / Daemon** | `claude agents` dashboard, daemon jobs, background session resume / fork |
| **Fullscreen** | densable-aligned wheel, Jump-to-bottom, alt-screen behavior |
| **Poor Mode** | `/poor` skips memory extract / suggestions to cut token spend |
| **KAIROS / Buddy** | Persistent assistant and terminal buddy (feature-gated) |
| **Computer Use / Chrome** | Screenshot + input, Chrome MCP (platform coverage varies) |
| **Artifacts** | HTML upload hosting (standalone Cloudflare Worker package) |
| **Voice** | Speech input (including Doubao ASR path) |
| **Web Search** | Built-in search tool |
| **Langfuse** | Optional agent-loop observability |

Some capabilities are **feature-flagged** (see below). Analytics / GrowthBook / Sentry are **stub / empty implementations** — do not treat them as production enterprise integrations.

---

## Positioning

This is a **CLI-first** Claude Code–compatible runtime:

- Interactive host: `src/screens/REPL.tsx` + `src/main.tsx` / `src/entrypoints/cli.tsx`
- Query loop: `src/query.ts` / `src/QueryEngine.ts`
- Tools: `packages/builtin-tools` (exported as `@claude-code/builtin-tools`)
- Remote / daemon: `src/bridge/`, `src/daemon/`, `packages/remote-control-server/`
- ACP: `src/services/acp/`, `packages/acp-link/`

There is **no** package-level Agent Core split at `src/core`, `src/hosts`, or `src/runtime`, and no `createAgent` / `claude/core` export. Older docs that claim those paths are outdated.

Recent work aligns agent / session / queue / inbox / daemon behavior with **densable 2.1.211** (git tags `v2.8.5` pre-merge, `v2.8.6` post-merge). **Published npm version is whatever `package.json` says** (currently **2.7.5**; trust `package.json` / npm) and may not match git tags.

---

## Install (npm)

Published name: **`@go-hare/claude-code`** (platform binaries as `@go-hare/claude-code-<os>-<arch>` optionalDependencies).

```sh
npm i -g @go-hare/claude-code

# Windows: if install hits EBUSY, kill the locked binary first
# taskkill /F /IM claude.exe

claude                 # start (postinstall places the native binary under bin/)
claude --version
claude agents          # background-session dashboard (needs daemon)
claude update

# Self-hosted Remote Control example (use your RCS URL / token)
CLAUDE_BRIDGE_BASE_URL=https://your-rcs.example/ \
CLAUDE_BRIDGE_OAUTH_TOKEN=your-token \
claude --remote-control
```

On install failure: `npm rm -g @go-hare/claude-code`, then install `@latest` again (or pin e.g. `@2.7.5`).  
Legacy docs that say `npm i -g claude-code` do **not** match this fork’s publish stream.

---

## Develop from source

### Prerequisites

Use a recent [Bun](https://bun.sh/) (recommended ≥ 1.3.11):

```bash
curl -fsSL https://bun.sh/install | bash   # macOS / Linux
# Windows: powershell -c "irm bun.sh/install.ps1 | iex"
bun upgrade
```

### Install & run

From the **repo root** (directory with this `package.json`):

```bash
bun install
bun run dev          # dev mode (MACRO.* injected by scripts/dev.ts)
bun run build        # code-split output → dist/cli.js + chunks
bun run precheck     # typecheck + biome fix + full test suite
```

Cross-platform binaries and publish:

```bash
bun run build:compile                          # compile platform binary only
bun run scripts/publish.ts --build-only        # same via publish script
bun run scripts/publish.ts --dry-run           # build + npm publish --dry-run
bun run scripts/publish.ts --with-main         # include main @go-hare/claude-code
```

> The `claude` binary inside platform packages is **build output** and should not live in git long-term.

### `/login` model config

In the REPL, `/login` can select Anthropic Compatible / OpenAI / Gemini / etc.:

| Field | Example |
| ----- | ------- |
| Base URL | `https://api.example.com/v1` |
| API Key | `sk-xxx` |
| Haiku / Sonnet / Opus | model IDs for your upstream |

Tab / Shift+Tab moves fields; Enter confirms.

### Feature flags

```bash
FEATURE_BUDDY=1 bun run dev
```

The build enables a default set of flags (see `build.ts` / `scripts/defines.ts`). **Off by default** includes `LAN_PIPES`, `UDS_INBOX`, `FORK_SUBAGENT`, and others. Multi-instance / pipe features need the matching flags — they are not always on.

### VS Code debugging

TUI needs a real terminal — attach:

```bash
bun run dev:inspect   # prints ws://localhost:…
```

VS Code F5 → **Attach to Bun (TUI debug)**.

### Teach Me

```text
/teach-me Claude Code architecture
/teach-me React Ink terminal rendering --level beginner
```

Progress lives under `.claude/skills/teach-me/` when the skill is installed.

---

## Layout (short)

| Path | Role |
| ---- | ---- |
| `src/entrypoints/cli.tsx` | True entry + fast paths |
| `src/main.tsx` | Commander CLI and startup |
| `src/screens/REPL.tsx` | Interactive REPL |
| `src/query.ts` / `QueryEngine.ts` | API query and turn orchestration |
| `packages/builtin-tools/` | Built-in tools |
| `packages/@ant/ink/` | Terminal Ink framework |
| `src/bridge/` / `packages/remote-control-server/` | Remote Control |
| `src/daemon/` | Long-lived daemon |
| `src/services/acp/` / `packages/acp-link/` | ACP |
| `scripts/publish.ts` | Platform binary compile + npm publish |
| `CLAUDE.md` | Detailed engineering notes for agents / contributors |

More architecture and testing rules: [`CLAUDE.md`](./CLAUDE.md).

---

## Contributors

<a href="https://github.com/go-hare/claude-code-1/graphs/contributors">
  <img src="contributors.svg" alt="Contributors" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=go-hare%2Fclaude-code-1&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&legend=top-left" />
  </picture>
</a>

## Acknowledgments

- [doubaoime-asr](https://github.com/starccy/doubaoime-asr) — Doubao ASR for optional Voice Mode path

## License

For learning and research only. Claude Code rights belong to Anthropic. Respect upstream and dependency licenses.
