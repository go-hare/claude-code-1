# Upstream changelog slices for densable 2.1.217 pack

Source: `docs/upstream-extraction/v2.1.212/CHANGELOG.upstream.md` (refreshed with 2.1.217 section).

## 2.1.217

1. Added emoji shortcode autocomplete in the prompt input: type `:heart:` to insert ❤️, or `:hea` for suggestions — disable with the `emojiCompletionEnabled` setting
2. Added warnings when transcript writes are failing (e.g. disk full) or when session saving is off due to an inherited environment variable, instead of losing transcripts silently
3. Fixed a memory leak where truncated MCP tool outputs kept the full untruncated result in memory for the rest of the session
4. Fixed Windows auto-update failures that could leave `claude.exe` missing; failed updates now restore the preserved executable automatically
5. Fixed background session isolation not canonicalizing symlinked working directories, which could let sessions escape their workspace folder
6. Fixed auto-compact never triggering for Claude Opus 4.8 on Bedrock and `/compact` failing once over the limit
7. Fixed corporate mTLS, TLS-verify, OAuth scope, and proxy settings being ignored in Claude Desktop sessions
8. Fixed screen reader mode's startup announcement being cut off by the first prompt render, and the thinking status row re-rendering every few seconds to update elapsed time and token counts
9. Fixed managed settings that set `OTEL_EXPORTER_OTLP_ENDPOINT` not governing all signals — lower-scope signal-specific overrides no longer redirect telemetry away from the managed endpoint
10. Fixed `--resume`/`--continue` and `/resume` failing with a TypeError when a transcript has a malformed attachment entry
11. Fixed Remote Control sessions not showing a pending permission prompt or dialog to viewers that connected after it appeared
12. Fixed background shells sometimes becoming impossible to stop after a session is sent to the background (`/background` or `←`) or when the session exits on a heavily loaded machine, most visible on Windows
13. Fixed a `CLAUDE.md` or `SKILL.md` paths frontmatter value with many brace groups OOM-killing or stalling the CLI at startup — brace expansion is now budget-bounded
14. Fixed the transcript preview sitting flush against the input area when attaching to a starting background session; it now leaves the same one-line gap as the live layout, so the transcript no longer shifts when the session takes over
15. Improved footer PR badge links to be clickable hyperlinks even when terminal support can't be detected (e.g. over ssh/tmux); set `FORCE_HYPERLINK=0` to opt out
16. Changed the login-expiry warning to appear 3 days before expiry instead of 5
17. Capped the frontend-design plugin suggestion tip at 3 lifetime impressions instead of repeating indefinitely
18. Added a cap on concurrently-running subagents (default 20, override with `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`) so one message can't fan out unbounded background agents
19. Changed subagents to no longer spawn nested subagents by default; set `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` to allow deeper nesting
20. Fixed `--max-budget-usd` not stopping background subagents: once the cap is reached, new spawns are denied and running background agents are halted
21. *(bundled as #20 in upstream numbering — max-budget is last bullet)*

Official section has **20** bullets (emoji → max-budget). Numbered 1–20 above.

## Neighbor: 2.1.216 (closed in go-hare 2.7.31)

See `docs/upstream-extraction/v2.1.216/official-216-checklist.md` (HAVE 38 / N/A 1).

## densable binary

`%TEMP%/official-217/package/claude.exe` — `@anthropic-ai/claude-code-win32-x64@2.1.217` (259 460 768 bytes).
