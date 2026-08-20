# GitHub release v2.1.236

Published: 2026-08-19T20:02Z (from GitHub UI; ashwin-ant)

## What's changed

- Added `ANTHROPIC_DEFAULT_MODEL` env: new-session start model; `/model` still overrides+persists (unlike `ANTHROPIC_MODEL`)
- `notify_when_idle` on cross-session SendMessage — one-shot idle notice (macOS/Linux)
- Sandbox macOS: wildcard read-deny (e.g. `**/.env`) precedence inside allowed read regions; covers dir contents; rename bypass closed
- Fixed clipboard/bg housekeeping/bg sessions/local MCP logs after switched-into dir removed (since 2.1.229)
- Fullscreen renderer: single failed start → fall back to classic instead of permanent exit
- `/model` picker taller-than-terminal: show only fitting rows + scroll
- SendMessage rejected when malformed closing tag left text in summary
- Unhandled rejection when subprocess fails to start (e.g. powershell on WSL) — regression 2.1.234
- Fullscreen: newly sent message missing until next update after resize
- Fullscreen: blank band after clearing multi-line prompt; panes not repainting after resize away/back
- Managed-settings approval prompt missing at startup while still eating first keypress
- tmux/iTerm title jump: write title only when text changes (was every 960ms)
- Unclear error when cloud environments list empty/malformed
- Fable 5 first-time usage-credits prompt auto-selecting fallback after 60s under Remote Control
- Spinner tips never appear when guest-pass reward in ~/.claude.json malformed
- Skills hot-reload error after session cwd deleted (SDK/VS Code; 2.1.229+)
- Self-hosted runner: idle/retire/startup-timeout release occasionally resumes elsewhere before post-session hook done
- Clawd mascot eyes/feet uneven in iTerm2 at some font sizes
- Recap runaway: cap at 400 chars, word boundary (auto + `/recap`)
- Startup: session counter written in background
- Auto mode: Monitor allow rules set aside so Monitor reviewed like Bash
- Auto mode on Bedrock/Vertex/Foundry + telemetry-off: classifier same defaults as Claude API incl severity-scored
- Auto mode git status not fooled by status.showUntrackedFiles=no
- `/model` highlight only newest model name
- `/goal`: idle+parked behind bg work auto check-in 30m then 1h/2h
- `/usage` usage-credits spend row for Team/Enterprise; capped 0% before spend
- SIGTERM print/SDK: no interrupted-turn / synthetic denials; still kill cmds + exit 143
- Enter on slash typo/unavailable reports instead of closest fuzzy; prefixes/aliases still run
- Remote Control marks session offline within seconds on CLI/terminal exit
- SendMessage refuses further msgs once burst would exceed inbox (no false sent)
- Session title chip aligned with footer right edge
- Right-aligned footer items + truncated notices share consistent right margin
- [VSCode] transcript screen reader: live announcements + per-turn heading nav
