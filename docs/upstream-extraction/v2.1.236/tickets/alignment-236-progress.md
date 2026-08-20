# alignment-236 progress ticket

Updated: 2026-08-20

## Counts

HAVE **18** / PARTIAL **14** / GAP **0** / N/A **1** (#33)

## Batch C

- `#17` `#26` `#22` → **HAVE**
- gold-weak `#18` `#24` `#31` `#32` → **PARTIAL**（invent-ban）

## precheck

- typecheck + biome：**绿**
- Batch C 聚焦测试：**绿**
- 全量：**`12032 pass / 21 skip / 0 fail`**（1168 files）— **exit 0**
- 已修阻断：
  1. `SendMessageTool` `feature()` hoist（Bun 禁 lazySchema/`&&` 赋值）
  2. `autoModeGitStatus.untracked.236` 不再 mock `autoModeFlags`
  3. `FileEditTool.toAutoClassifierInput` 测试按 env=0 断言 legacy string
  4. `environments.malformed.236` + MagicDocs `readFileBytes` + tip/uds/vscode/rateLimit/surfacePick snapshot restore
  5. **`quotaAutoResume.234`**：live-namespace afterAll 假 restore → `snapshotModuleExports` + 多 alias restore（清掉 otel TRACEPARENT ×2 + autoModeReset ×1 + tui ×5）

## Residual（未 commit）

- `#14` `dialog_queued_at_park` 已落地（J1t/xo park watch）；Fo/Wlt 仍 residual

## Standing

**no auto commit / push / bump**
