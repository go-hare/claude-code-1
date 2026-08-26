# #7 Auto mode compact 后重复拒网络 — notes

## Gold (densable 2.1.234 SEA)

- `wkr(mode, bypassAvailable)` → auto=classify / bypass|plan+bypass=allow / dontAsk=deny / else ask
- `lVr` → synthetic `SandboxNetworkAccess` via auto classifier; fail-closed; warn on block
- `Jvr`/`getOrClassify` + `bun(messages)` watermark; reuse always|same-transcript; drop unavailable(!PTL)
- `zvb`/`addSessionAllowedHost` + `KXt` IPv6 brackets → `C8o`/`refreshConfig`
- `LOr` merges `sessionAllowedHosts` into allow domains **only when not** managed-only
- REPL `OVt` / print `W4g` / InboxPoller auto-resolve before queue (`Tv0=bun([])` + `EJ()` tools)
- UI/bridge/SDK allow → `addSessionAllowedHost` (classifier allow alone does **not** seed the bag)

## Local

| Piece | Path |
|-------|------|
| wkr/lVr/Jvr/W4g | `src/utils/sandbox/sandboxNetworkDecision.ts` |
| headless T/k refs | `src/utils/sandbox/sandboxNetworkHeadlessRefs.ts` |
| session bag + LOr | `sandbox-adapter.ts` `sessionAllowedHosts` / `addSessionAllowedHost` / convert merge |
| REPL | `sandboxAskCallback` wkr first; dialog/bridge allow → addSessionAllowedHost |
| print | W4g wrap + `setSandboxNetworkHeadlessMessages(mutableMessages)` / tools |
| structuredIO | createSandboxAskCallback allow → addSessionAllowedHost |
| InboxPoller | wkr/classify auto-resolve; queue only on ask |

## Tests

- `sandboxNetworkDecision.234.test.ts` — wkr / bun / Jvr / W4g
- `sessionAllowedHosts.234.test.ts` — KXt + LOr merge + managed-only exclusion

## Residual（非 invent）

- densable `lVr` opts `{isSubagentLoop, recordPresumed}`：本地 `classifyYoloAction` 无对等 API，未硬塞。
