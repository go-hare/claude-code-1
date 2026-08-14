# densable 2.1.232 — RC cluster + panel + VML (HAVE / PARTIAL notes)

## Agent panel (#41)

- `kye=30000` panel grace = local `PANEL_GRACE_MS`
- `kT(status)` terminal → stamp `evictAfter: now+kye`
- Completed agents leave panel unless keepalive / retain (`isLocalAgentPanelActive`)
- Footer pills + horizontal overflow window (left/right arrows)
- densable string family: `/tasks to see subagents`

## VirtualMessageList (#33)

- densable `wih` / `pBE` / `mfT` / `dBE` / `Ish`
- Incremental itemKeys with `#N` collision suffix
- Float64Array offsets; column change **scales** heights (no full clear)
- Visible-range only measure + sticky prompt

## RC (#17–21, #39–40, #42)

| Item | densable | local |
| ---- | -------- | ----- |
| #18 reattach | `reattachSessionId` + seq | `remoteBridgeCore` / env REATTACH |
| #21 gone | unarchive gone → mint fresh | same + `reattach_fallback` |
| #19 unreachable | `unreachableFromHere` only for bridge env kind | session list meta |
| #39 reconnect | `buv=14` `vjp=30s` `Sjp=300s` `vuv`≈30min；`oa` 4093 remintCap | `remintRecovery.ts` + `recoverFromCloseCode`；work `connGiveUpMs=600000` |
| #40 no steal | non-owner suppress / already connected | 228 #5 + UI refuse |
| #42 terminal | QR space / spawn `w` hints | `bridgeUI.ts` 1:1 |

## #47 protected-path

- Trailing-slash strip (`Mmr`) — `stripTrailingSlashForSandbox`
- Windows path bypass → manual approval (`classifierApprovable:false`)
- denyWrite protected list (+ glab 232)
- Managed sandbox binaries need approval (#34)
- Residual: Linux seccomp violation monitor string in SEA

## Tests already covering related paths

- `bridgeReattach.test.ts`, panel/framework tests, VirtualMessageList / useVirtualScroll tests
