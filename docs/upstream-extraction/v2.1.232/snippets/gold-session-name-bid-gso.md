# densable 2.1.232 #4 residual — Bid / G$o / mEn / jid wiring

> Core pure (`ZM_`/`JM_`/`kp`/…) + `/rename` already local PARTIAL.  
> This note locks densable **orchestration** still missing.

## densable symbols

| Sym | Role |
| --- | --- |
| `Kzs()` | GB `tengu_session_name_uniqueness` default **true** |
| `mEn(desired, moment, deps=qzs, suffixBase)` | listLive + `ZM_` + log + `session_name_collision` analytics；`whenRegistered` 门 |
| `Bid({sessionNameArg, interactive, writeName, onRenamed, deps, scheduleRecheck})` | **startup**：user arg 写入 → 对当前 name `mEn(…,"startup")` → yield 则 `writeName(…,"collision")` + `announceYield`；未 yield 则 `scheduleRecheck` 3s 后再 `mEn(…,"recheck")` |
| `G$o({name, onYield, deps, suffixBase})` | **recheck-only** 调度（rename 成功后挂） |
| `Uid` / `eO_=3000` | `setTimeout(fn, 3000).unref()` |
| `kxr` | /rename path：`mEn(…,"rename")` + `JEe` write + `G$o` recheck + `announceYield` |
| `jid(old, new, desired, send=uEn, listLive)` | 跨会话 notice：仅 `Kzs&&ig()&&correspondents`；文案 `This session was renamed from "…" to "…" ("…" is held…). Address this one as "…" from now on.`；按 UDS correspondent sock 发 |
| `Nid` / `zD` | correspondents Map、lastYield、userTypedName、pendingYield |
| `nameSource` | `user` \| `collision` \| `derived` \| `auto` — derived 跳过 uniqueness |

## Local residual map

| densable | local |
| --- | --- |
| pure `ZM_`/`JM_`/`kp`/`Lid`/`YM_`/`XM_` | `sessionNameUniqueness.ts` **HAVE** |
| `/rename` `kxr` core yield | `rename.ts` + `listLiveSessionRecords` **HAVE** |
| `Bid` startup | **`runSessionNameStartupUniqueness`** via `runSessionStartupSideEffects` **HAVE** |
| `G$o` recheck after rename | **`scheduleSessionNameRenameRecheck`** in `/rename` **HAVE** |
| `mEn` + GB `Kzs` | `resolveSessionNameWithLiveRegistry` + `isSessionNameUniquenessEnabled` **HAVE** |
| pid `nameSource` / `nameSince` | `updateSessionName(name, source)` writes both **HAVE** |
| `jid` peer notice | **HAVE** — `notifySessionNameCorrespondents` + `announceYield` from Bid/rename/G$o |
| `Nid.correspondents` | **HAVE** — `sessionNameState` + note on UDS in/out |
| densable `QM_` lastYield reuse | **HAVE** — `preferStableYieldName` / `reuseLastYieldName` in mEn |
| strict `procStart` YM_ | residual（默认 lenient） |
| `procStart` field | registry optional |

## Status

**#4 HAVE**（主路径 1:1）。residual：strict `procStart` YM_ only.
