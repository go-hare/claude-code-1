# densable 2.1.234 #20 — queued messages / Esc / `!` mode

## Changelog
queued messages reappearing in prompt history while still queued; Esc while
selecting a queued message no longer interrupts the turn; `!` mode no longer
sticks after mid-turn submit.

## SEA gold (mmap peels)

| 符号 | 含义 |
| --- | --- |
| `lte()` | `K.CLAUDE_CODE_KB_COHESION_FIXES` truthy（默认 OFF） |
| `LI` | ↑：`lte` 走 `queueEditIndex`；else `Phe()\|\|!cu()` |
| `na` | ↓：`lte` 走 index；else footer/history |
| `Ne` / `HFn` | `popEditableAt`：`n.filter(lJ)[i]` + `NMt` + splice `popOne` |
| `Io` | Enter 在 index 非空时 `HFn`；bash `NMt` 失败 toast |
| `F3i` / `Vag` / `j3i` | `selectionHighlight` on/off；lJ index → processedCommands.indexOf |
| `SQw` | backspace/delete/ctrl+u\|w\|k 清 index |
| `$l` | Esc 在 index 非空时只清 index（不 interrupt） |
| clamp | `yo===0 → null`；`Er>yo-1 → yo-1` |
| type-clear | input 变且 `pr.current!==N` → `mr(null)` |

`Phe` **就是** `popAllEditable`（`fii`），不是无关门。`cu()` = 队列有 editable
且 live draft `h6()===N`。

## Local

- `messageQueueManager.ts` — `popEditableAt` ≡ `Ne`（无 `ke` paste-id remap，
  与 `popAllEditable` 同一 extract 路径）；`queueEditIndexAfterHistoryUp/Down`；
  `clampQueueEditIndex`
- `PromptInput.tsx` — LI / na / Io / SQw / $l / type-clear / clamp / Ys；`lte` =
  `isKbCohesionFixesEnabled()`；`Phe` = `popAllEditable(h6=liveInputRef, Xe)` +
  `_e("input_queue_pop_to_edit")`
- `PromptInputQueuedCommands.tsx` — Vag identity remap
- `QueuedMessageContext.tsx` + `HighlightedThinkingText.tsx` — F3i / j3i
- core already HAVE：`historyEntry`/`JDr` 延后写；`onSubmitProceed` 清 bang；
  Esc-while-select 不 interrupt（`useCancelRequest`）

## Residual（故意不 invent）

- `ke()` paste-id remap — 与 `popAllEditable` 同一 extract residual
- 无 `queueOrigin` / `queueMode` 字段
- #35 profile `/login` 仍 GAP

## Tests
- `popAllEditable.234.test.ts` — Ne / LI / na / clamp
