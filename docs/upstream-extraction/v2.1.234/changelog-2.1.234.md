# densable 2.1.234 changelog (official)

> Source: GitHub release **v2.1.234** (2026-08-17, @ashwin-ant)  
> SEA: `%LOCALAPPDATA%/Temp/official-234/plat/package/claude.exe`  
> sha256: `3f877e78543e2cb4daad61d18f06cc11028f9dffc1afd41ccf1f8f84cf02eb1b` (324028576 bytes)  
> Binary beats changelog when they disagree.

## What's changed

1. Added optional `CLAUDE_CODE_PROJECT_DIR_NAME` env: hosts that give each session its own config directory can choose a short name for the per-project transcript directory
2. Added `selection:clear` keybinding action (clear in-app text selection; also agents view)
3. Added GitLab MR badge to footer and statusline: GitLab remote + authenticated `glab` → MR `!N` with draft/pending/green states
4. Continue session automatically when a claude.ai usage limit resets; opt out in `/config` ("Continue automatically at usage limit")
5. Claude is told to use account email only to identify you, not send it to unrelated services unless asked
6. Security: remote file reads, session restore, CLAUDE.md includes, workflow scripts and file uploads reject Windows NT-namespace (`\??\`) paths (remaining pre-approval NTLM hardening)
7. Fixed auto mode in very long sessions repeatedly re-checking and denying sandboxed commands' network access after compaction
8. Fixed session-scoped permission answers (including denies) dropped when answering background subagent tool permission prompts
9. Fixed crash when non-streaming fallback API response had thinking block missing `thinking` or text block missing `text` (typically third-party gateways)
10. Fixed markdown rendering extremely slow for some unusual Unicode sequences
11. Fixed `SendMessage` rejecting a recipient copied from `ListAgents` when session name is at 200-char cap or emoji-heavy
12. Fixed repository detection mis-reading host of git remotes with unusual userinfo
13. Fixed MCP diagnostics printing resolved secrets: scope-conflict warnings show configured `${VAR}` form; connection-failure details show only server origin
14. Fixed `strictKnownMarketplaces` allowlists accepting SCP-style git marketplace sources whose host differs from the one git would connect to
15. Fixed modal text (e.g. `/login` OAuth URL) losing characters when copied in fullscreen
16. Fixed `---` horizontal rule in rendered markdown running into the next line
17. Fixed consecutive shell commands splitting into multiple "Ran 1 shell command" rows when todo/task updates interleaved
18. Fixed dialogs like `/permissions` opened while a `!` shell command was running being dismissed when the command finished
19. Fixed queued `!` shell command being sent to the model as plain text after up-arrow edit of queued input
20. Fixed queued messages reappearing in prompt history while still queued; Esc while selecting queued message no longer interrupts turn; `!` mode no longer sticks after mid-turn submit
21. Fixed accepting "Try the new fullscreen renderer?" restarting session without permission mode / tool allow-deny / model / effort flags
22. Fixed `/tui` dropping launch `--allowed-tools`/`--disallowed-tools` on restart; declines to switch with reason when restrictions can't carry over
23. Fixed trust prompts omitting repository-wide scope warning when directory was first seen before the repository existed there
24. Fixed IDE diff tab closing during permission re-prompt answering new prompt with previous input
25. Fixed: files sent to user during Remote Control sessions hosted by Claude Code Desktop or VS Code now upload (phone/web empty card)
26. Fixed: after `/login` while `CLAUDE_CODE_OAUTH_TOKEN` set, stale-token reminder no longer leaks into Claude's auto-resumed turn — user-only
27. Fixed: permission previews relay only to channel servers admitted by inbound trust gate; explicit permission-capability opt-out honored
28. Fixed: credential masking on relayed permission previews can no longer hide commands/paths/destinations; oversized private-key blocks redact under full-strength redaction
29. Fixed: provider API tokens that mask on permission previews now mask even when directly followed by shell delimiters
30. Fixed Claude Desktop inter-session messages silently dropped when cross-session messaging read as disabled (sender "thinking" for minutes)
31. Remote Control: signing this computer into a different claude.ai account/org stops running session within seconds with reason (not misleading HTTP 404 hours later)
32. Remote Control sessions from Desktop/VS Code keep phones and claude.ai/code updated on permission mode (and claude.ai/code on model) as they change
33. Remote Control: effort picks on phone or claude.ai/code apply to terminal/Desktop/VS Code-hosted sessions; session publishes effort to connected clients
34. `SendMessage` and `ListAgents` say when account session list was too long to check completely (instead of treating unseen as absent)
35. Expired Anthropic profile credential points at `/login` when a claude.ai login would take precedence
36. Improved transcript: user prompts render markdown (code blocks, inline code, lists) like replies
37. Improved "API returned empty or malformed response" error: content type, body kind, size, request ID, why original streaming failed
38. Improved auto-generated session titles to short specific names (not sentence restatements)
39. Reduced context cost of built-in `claude-api` skill from ~200k+ to ~25k via on-demand reference docs
40. `/permissions` can open while Claude is working — rule changes apply to rest of current turn
41. `/add-dir` usable while working; `/add-dir`, `/autocompact`, `/theme`, `/help`, `/config`, `/advisor` dialogs open mid-turn in fullscreen TUI
42. `/goal` clears itself with notice when turn dies on unrecoverable error (revoked auth, exhausted credits, context overflow)
43. `/goal`: when background tasks keep goal waiting 30+ minutes, Claude checks in (`CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0` to opt out)
44. `claude setup-token` rejects unexpected extra arguments
45. Esc in fullscreen no longer clears mouse text selection (interrupts/dismisses as usual; selection stays)
46. Removed redundant "Allowed by auto mode classifier" line under every Agent tool call
47. **Removed "Default teammate model" setting from `/config`**; agent-team teammates now use the leader's model unless the spawn names one
48. Dimmed elapsed-time counter on running tool header
49. Background task notifications between turns sent to model inside tags matching mid-turn delivery
50. Mantle: skip admin-pin availability probe at startup when main-loop model already picked
51. Windows: startup no longer stalls on repeated rename retries when `~/.claude.json` is read-only

## Product notes for go-hare

- **#47** supersedes go-hare **2.7.44** partial approach (follow-leader while keeping `/config` picker). Densable **removes** the setting entirely.
- Several items are Desktop/VS Code / claude.ai cloud RC (**likely N/A invent-ban**): #25, #30–#33 parts, Mantle #50.
- `#6` extends prior `\??\` NTLM hardening to more pre-approval surfaces.
- Binary SEA must confirm string/control-flow for each candidate before HAVE.

Sources:
- [GitHub release v2.1.234](https://github.com/anthropics/claude-code/releases/tag/v2.1.234)
- [Releasebot Claude Code updates](https://releasebot.io/updates/anthropic/claude-code)
