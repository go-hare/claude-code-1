# Upstream changelog slices for densable 2.1.218 pack

Source: `docs/upstream-extraction/v2.1.212/CHANGELOG.upstream.md` (section `## 2.1.218`, lines 100–137).

## 2.1.218

Official section has **36** dash bullets (not third-party 37-count blogs that insert MCP-list diagnostics).

1. Changed `/code-review` to run as a background subagent, so review work no longer fills your conversation and keeps stacked slash commands as its review target
2. Added screen-reader announcements of deleted text for word and line deletions (`Option+Delete`, `Ctrl+W`, `Cmd+Backspace`, `Ctrl+U`, `Ctrl+K`) in `--ax-screen-reader` mode
3. Fixed Windows paths with `\u`-prefixed segments (like `C:\Users\unicorn`) being corrupted into CJK characters in tool inputs, which made those files inaccessible
4. Fixed the left arrow key discarding the conversation with no undo: presses right after editing now ask to confirm, and Esc in the agent view returns to the conversation it backgrounded
5. Fixed multi-line paste collapsing into one line with `j` in place of newlines in terminals that encode pasted newlines as Ctrl+J
6. Fixed `/context` reporting stale pre-compact token usage after compacting from the message picker
7. Fixed `/ultrareview` failing on descriptive arguments like "review my auth changes" — they now run a review of your current branch with the text applied as a note to the findings
8. Fixed `/code-review ultra` silently running a local review in non-interactive sessions — it now launches the cloud review
9. Fixed gateway spend metering to price Bedrock application-inference-profile ARNs and other config-mapped upstream model IDs at the configured model's rates
10. Fixed mojibake when a long IDE selection was truncated mid-emoji, and a case where a tool executor error could be silently dropped
11. Fixed an engine teardown race that could start and abandon a phantom turn, and made input pushed after close consistently rejected
12. Fixed spurious "[Request interrupted by user]" messages after interrupted tool calls, and an unpaired `tool_use` block left in the transcript when a tool aborted mid-response
13. Fixed VoiceOver reading "new line" instead of echoing the typed space at the end of the input in `--ax-screen-reader` mode
14. Fixed plugin and settings panels not moving the terminal cursor to the focused row, so screen readers and magnifiers can follow arrow-key navigation
15. Fixed crashes (maximum call stack exceeded) when a deeply nested watched directory tree was deleted or moved, and when rendering deeply nested UI trees
16. Fixed pull request events occasionally being lost when a session exited immediately after creating or linking a PR
17. Fixed the Bedrock setup wizard failing profile verification for assume-role profiles in partitioned AWS regions and on proxy-only networks
18. Fixed rare negative or incorrect turn duration measurements after a system clock adjustment by timing turns with a monotonic clock
19. Fixed the "N MCP servers need authentication" startup notice over-counting claude.ai connectors that aren't connected in claude.ai
20. Fixed prompt history entries being dropped or duplicated when history writes raced or failed
21. Fixed a retry loop that re-sent identical doomed requests after a context-overflow error with a large thinking budget; `Ctrl+B` backgrounding now applies the same background-shell caps as other paths
22. Fixed agent frontmatter hooks running from untrusted folders: hooks now require the agent file's own folder to have accepted workspace trust
23. Fixed fork-session lineage being lost after compaction in headless and SDK sessions
24. Fixed a resumed session failing every turn, or crashing on resume, when its history held a malformed delta attachment
25. Improved `/ultrareview` error feedback so Claude can correct an invalid argument instead of retrying it unchanged
26. Improved auto mode: the dangerous-rm, background-`&`, and suspicious-Windows-path checks no longer open permission dialogs; the auto-mode classifier adjudicates them instead
27. Improved sandbox command restrictions for IDE interactions
28. Improved trust dialogs to name the repository root the grant covers
29. Changed `/deep-research` to start only when invoked manually; Claude no longer launches it on its own
30. Changed plan mode with auto to no longer prompt for Bash commands the static analyzer can't prove read-only; the auto-mode classifier judges them instead
31. Added an announcement when fast mode changes as a result of switching models via `/config model=<x>` or Remote Control
32. Changed server-managed settings so benign feature and cost toggles no longer trigger the settings-approval prompt
33. Changed agent markdown files to reject agent names containing `:`, which is reserved for plugin namespacing
34. Changed skills with `context: fork` to run in the background by default; opt out per skill with `background: false`
35. Added `yes`/`no`/`on`/`off`/`1`/`0` (case-insensitive) as accepted values for skill and plugin frontmatter booleans, alongside `true`/`false`
36. Fixed remote sessions continuing to send heartbeats after their worker was replaced, which left long-lived desktop and IDE processes retrying a rejected request every few seconds forever

### densable binary

- Path: `/tmp/official-218/plat/package/claude`
- Source: `npm pack @anthropic-ai/claude-code-darwin-arm64@2.1.218`
- Size: ~243 MB Mach-O arm64
- `claude --version` → **2.1.218 (Claude Code)** HIT

### Neighbor

| 版 | 状态 |
|----|------|
| 2.1.217 | closed (`e5e83e50` / `5dcf1180`, product 2.7.32) |
| **2.1.218** | **this pack** |
| 2.1.219+ | separate pack |

### densable key needles (sampled)

| Needle | Item |
|--------|------|
| `Invalid "name": names must not contain ":" (reserved for plugin namespacing)` | #33 |
| `" is not a boolean (use true/false, 1/0, yes/no, on/off)` | #35 (plugin --config; skill/agent frontmatter same family) |
| `Only for \`context: fork\`. Forks run as background agents... set \`false\` to keep caller waiting` | #34 |
| `application-inference-profile` | #9 |
| `suspiciousWindowsPath` / `tengu_bash_dangerous_rm_too_complex` | #26 |
| `disableModelInvocation` / `deep-research` | #29 |
| `/code-review ultra` / `ultrareview` | #1 #7 #8 #25 |
| `[Request interrupted by user]` | #12 |
| `hook execution - workspace trust not accepted` | #22 |
| `Ozs` / `pWr` (SR delete announce) | #2 |
