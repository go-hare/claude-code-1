# Upstream changelog slice — densable 2.1.225

Source: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md (section `## 2.1.225`).

Official binary SEA: densable **2.1.225** (`// Version: 2.1.225` HIT ×6), size **279661952** bytes, sha256 `08d6e85dd2b80883bb8da93cbeae3dc79b4704d6b84a05d614bf1ff4a5155b69`.

Path: `/tmp/official-225/plat/package/claude`  
Snippet root: `docs/upstream-extraction/v2.1.225/snippets/`.

## 2.1.225

- Added gateway spend-limit support to Claude Code's usage warning; the limit-reached message now names the cap, its reset time, and the operator's message (requires the gateway on 2.1.225)
- Added a workspace trust prompt to `claude agents` for untrusted directories, matching the behavior of `claude`
- Fixed a transient 401 replacing a long-lived `CLAUDE_CODE_OAUTH_TOKEN` with a stored login's short-lived token, breaking headless sessions until restart
- Fixed MCP OAuth servers on macOS intermittently failing with a burst of 401 errors, as if never authenticated, after a keychain read timed out
- Fixed auto mode counting a safety-filter refusal of its own permission check toward the consecutive-block limit; the action is still denied, but the model is now told to move on rather than retry
- Fixed cross-session messages staying parked without a notice or expiry in headless sessions and during startup
- Fixed conversation history breaking on Remote Control session resume after very large conversations were compacted
- Fixed hovering over a session in another project in the agents list changing the directory the next agent starts in
- Fixed `claude self-hosted-runner` registering and then failing every session when `--base-dir` cannot be created or written; it now exits at startup with a clear error
- Fixed Claude Code on the web sessions being misreported as stuck, re-sending a growing event backlog on every reconnect
- Improved Remote Control: photos attached from the Claude app are now shown to Claude directly instead of being read from disk with a separate tool call
- [VSCode] Fixed Focus view folding away the latest to-do list, a pending question's context, and settled answers; thinking-only folds show "Thought for Ns" and re-collapse when their turn completes
- SendMessage can now start a conversation with your Remote Control sessions on other machines by name (`ListAgents` shows them as `name [ref]`), instead of only replying after they message you first
- SendMessage: a Remote Control recipient you already confirmed is never swapped for a same-named session on this machine when its own list couldn't be checked

## Neighbor versions (do not fold into this pack)

- **2.1.224** — self-hosted-runner / cross-session / archive plugin (local tip `6ec40f7f`, HAVE 29/31)
- **2.1.226** — "Bug fixes and reliability improvements" (1 bullet; opaque)
- **2.1.227** — 5 bullets (feature flags / tui / slash menu / perf)
- **2.1.228** — 18 bullets (layout hang / SHR hooks / skills harden / Write tool / …)
