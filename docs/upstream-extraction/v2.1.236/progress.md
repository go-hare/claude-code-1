# densable 2.1.236 alignment progress

Updated: 2026-08-20

## Status

| Phase | State |
| ----- | ----- |
| Changelog / GitHub body | **done** |
| densable SEA npm pack | **done** — `/tmp/official-236/plat/package/claude` · `2.1.236 (Claude Code)` · size **317044624** · sha256 `6bc4ba992d2786cbf0237c4453ca53c1fdf0c3b3d83ffa0025c0d8190ed27848` |
| Checklist HAVE/GAP | **done** — 以 `official-236-checklist.md` 为准（2026-08-26：HAVE **23** / PARTIAL **9**；`#11` 双 Ink + sXg DialogStore HAVE） |
| Implement 1:1 | **Batch A/B/C done** · **no auto commit/bump** |

## Baseline

- tip densable **2.1.235** landed · npm **2.7.45**
- densable-first 1:1 · invent-ban (#33 VSCode host a11y N/A; no gateway invent)
- concurrency **3** · ultracode dig/map
- 口径：加强升档 + 其余与 SEA 1:1

## Counts

| HAVE | PARTIAL | GAP | N/A | UNKNOWN |
| ---- | ------- | --- | --- | ------- |
| 19 | 13 | 0 | 1 (#33) | 0 |

> **计数以 `official-236-checklist.md` 为准**（现 HAVE **23** / PARTIAL **9**）。本表下方列表为历史快照。

### HAVE

`#1` `#2` `#3` `#5` `#8` `#12` `#13` `#14` `#15` `#16` `#17` `#19` `#20` `#21` `#22` `#23` `#25` `#26` `#30`

### PARTIAL

`#4` `#6` `#7` `#9` `#10` `#18` `#24` `#27` `#28` `#29` `#31` `#32`

### GAP

— none —

## Notes

- Official also published **2.1.237** on npm; **this pack is 236 only** (do not fold 237).
- SEA path: `/tmp/official-236/plat/package/claude`
- **Batch A landed**: `#1` `#15` `#19` `#21` `#23`
- **Batch B landed**: `#13` `#14` `#5` `#30` `#2`
- **Batch C landed**: `#17` `#26` `#22` HAVE；gold-weak `#18/#24/#31/#32` → **PARTIAL**（无 SEA 可落地合同，invent-ban）
  - `#22` privacy `DO_NOT_TRACK` + KIt + KD→qTa `severityByModel`（`autoModeKdQta.236` / privacyLevel）
- **precheck follow-ups（Batch C 收口后）**:
  - 修 `SendMessageTool`：`feature()` 从 `lazySchema`/`&&` 赋值 hoist 到模块顶层（Bun 编译限制）
  - 修 `#23` 测试污染：`autoModeGitStatus.untracked.236` 不再 mock `autoModeFlags`（改 env 驱动）
  - 修 `FileEditTool.toAutoClassifierInput` 测试：env=`0` 才断言 legacy string（qTa 可能 bake editRemoval）
  - 修 `environments.malformed.236` / MagicDocs `readFileBytes` / tipLifetime·uds·vscode·rateLimit·surfacePick：`snapshotModuleExports` + afterAll restore
  - 确认污染源 `quotaAutoResume.234`：afterAll 展开 live ESM namespace 把 mock 装回去；改 snapshot+多 alias restore
  - **全量 precheck 绿**：`12032 pass / 21 skip / 0 fail`（1168 files）· typecheck/biome 绿
- artifact: `weO9IlabzJ3jmpy4FgN_U`
