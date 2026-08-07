# densable 2.1.216 #27 — Skills/commands mid-session slash-menu refresh

## Changelog

> Fixed skills and commands changed during a session not appearing in the slash menu until restart

## Gold (SEA 2.1.216)

### Skill watcher `XoS` (~235624542)

Factory returns `{ initialize, dispose, subscribe, _checkIdleTransitionForTest }`.
Module singleton `z0r = XoS()`.

| const | value |
|-------|-------|
| joS stabilityThreshold | 1000 |
| GoS pollInterval | 500 |
| WoS reloadDebounce | 300 |
| VoS chokidar active interval | 2000 |
| zoS idle interval | 30000 |
| KoS idle threshold | 60000 |
| YoS idle-check interval | 10000 |
| bGa | `"<skill-watcher-idle-wake>"` |
| fOf usePolling | `true` |

**Watch paths `QoS`:** user/project `skills`, `commands`, **`agents`**; `--add-dir` `.claude/skills`.

**chokidar ignored:** non file/dir/symlink; `.git`; **files not ending in `.md`**.

**Reload `H`:** ConfigChange (skip if idle-wake only) → `xLt` skill caches → fingerprint `JoS` (name→contentHash) → unchanged+idle-wake early return → `$2` clearCommandsCache → selective `oNs` forget sent skills → emit.

**Idle `I`:** switch poll interval; on active wake schedule `H(bGa)`.

**`U7` signal:** plugin/--add-dir invalidation → emit skillsChanged.

### UI hook `mOf`

Watcher → `$2` + `pw` commands + optional `lU` agents. GrowthBook/`A2` → `wZ` memo-only.

### stream-json `aa` (~238771533)

```js
if (!el || d.outputFormat !== "stream-json") return
HE({ type: "system", subtype: "commands_changed", commands: DVe(...) })
```

`DVe`: user-invocable commands → `{ name: userFacingName, description, argumentHint, aliases }` (qualified name may append to aliases).

## Local land

| File | Change |
|------|--------|
| `skillChangeDetector.ts` | agents dirs, .md filter, idle poll, fingerprint, U7, always polling |
| `useSkillsChange.ts` | optional agents reload |
| `REPL.tsx` | pass agents callback |
| `print.ts` | emit `commands_changed` |
| `coreSchemas.ts` | `SDKCommandsChangedMessageSchema` |
| `loadSkillsDir.ts` / `command.ts` | `contentHash` for JoS |
| `attachments.ts` | `forgetSentSkillNames` (oNs) |

## Tests

`src/utils/skills/__tests__/skillMenuRefresh.216.test.ts`
