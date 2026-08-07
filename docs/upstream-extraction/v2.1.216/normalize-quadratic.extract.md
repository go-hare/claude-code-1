# densable 2.1.216 — message normalization quadratic fix (1:1)

> **id:** `normalize` · Changelog #2  
> **Status:** **HAVE** (LN Map+cursor in `normalizeMessagesForAPI`; tests `normalizeMessagesForAPI.quadratic.216`)  
> SEA: `qry` @ ~230139928, `LN` @ ~230588285; contrast 215 `tN` @ ~228556257  
> Deep dig: `DEEP-1TO1.md` · dumps: `normalize-quadratic.*`, `runtime-norm-*.txt`

---

## 1. Product intent (changelog)

> Fixed a slowdown in long sessions where message normalization cost grew quadratically with the number of turns, causing multi-second stalls and slow resumes.

---

## 2. densable binary proof

| Needle | Hit | Offset | Notes |
|--------|-----|--------|-------|
| `preNormalizedMessageCount` | true | 230143083 | `tengu_api_before_normalize` |
| `postNormalizedMessageCount` | true | 230144124 | `tengu_api_after_normalize` |
| `query_message_normalization_start` | true | 230143124 | profiler phase |
| `query_message_normalization_end` | true | 230140442 | densable fires **inside** qry after LN, before post-normalize |
| `normalizeMessages` literal | false | -1 | mangled to LN/tN; UI `normalizeMessages` is different |

**Scope of 216 delta:** assistant same-`message.id` merge inside `LN` (local: `normalizeMessagesForAPI`). Surrounding pipeline already exists in 215/local.

**Pack-report correction:** local already has pre/post counts + checkpoints in `src/services/api/claude.ts` + `src/utils/queryProfiler.ts`. Claim “no local equivalents” is **outdated**. Algorithm is Map+cursor in LN, not missing telemetry.

---

## 3. Cleaned densable schema / strings

### Telemetry / profiler

- `tengu_api_before_normalize` `{ preNormalizedMessageCount }`
- `tengu_api_after_normalize` `{ postNormalizedMessageCount }`
- `query_message_normalization_start` / `query_message_normalization_end`
- Phase label: `Message normalization`

### Related LN events (not new in 216)

`tengu_tool_result_pairing_repaired`, `tengu_filtered_orphaned_thinking_message`, `tengu_filtered_trailing_thinking_block`, `tengu_filtered_whitespace_only_assistant`, `tengu_fixed_empty_assistant_content`, `tengu_reorder_tool_uses_skipped_for_thinking`, `tengu_media_byte_cap_stripped`, merge warn for non-string `.text`.

Destructure guard: `Cannot destructure property 'messagesPreNormalize' from null or undefined value`.

---

## 4. Cleaned densable runtime

```js
/* densable 2.1.216 — LN assistant-merge linear fix
 * Gold: SEA LN@216 vs tN@215 reverse scan O(n) per assistant → O(n^2)
 */

// call site (claude API path):
// logEvent before_normalize { preNormalizedMessageCount }
// queryCheckpoint start
// qry(...) → LN + postNormalize + midConvFallback
// logEvent after_normalize { postNormalizedMessageCount }

function qry(messages, opts) {
  // prefilter wBd; collapseSources; mediaGenerous…
  const postNormalize = (apiMsgs) => {
    // strip tool refs / caller; ensureToolResultPairing; stripAdvisor; stripExcessMedia
  };
  let api = LN(pre, opts.tools, opts.midConvLatchedOff ? undefined : bodyModel, {
    preserveTrailingThinking: opts.resumeIncompleteThinking,
  });
  assertImagesWithinLimit(api, …);
  queryCheckpoint('query_message_normalization_end'); // BEFORE postNormalize in densable
  api = postNormalize(api);
  // midConvFallback re-LN without model if primary has api_system
  return { messagesPreNormalize: pre, messagesForAPI: api, midConvFallback };
}

// === 215 quadratic (DO NOT KEEP) ===
// for (let G = result.length - 1; G >= 0; G--) {
//   if not assistant/api_system/tool_result break
//   if assistant && same id → merge
// }

// === 216 linear (PORT THIS) ===
function normalizeMessagesForAPI_LN(messages, tools = [], model, options) {
  const result = [];
  const assistantIdToIndex = new Map(); // message.id -> index
  let mapScanFrom = 0;

  function advanceAssistantIdMap() {
    for (; mapScanFrom < result.length; mapScanFrom++) {
      const y = result[mapScanFrom];
      if (y.type === 'assistant') {
        assistantIdToIndex.set(y.message.id, mapScanFrom);
      } else if (y.type !== 'api_system' && !isToolResultUser(y)) {
        assistantIdToIndex.clear();
      }
      // api_system + tool_result users are TRANSPARENT (do not clear)
    }
  }

  for (const msg of reorderedMessages) {
    switch (msg.type) {
      case 'assistant': {
        const incoming = normalizeAssistantToolInputs(msg, tools);
        advanceAssistantIdMap();
        const idx = assistantIdToIndex.get(incoming.message.id);
        if (idx !== undefined && result[idx]?.type === 'assistant') {
          result[idx] = mergeAssistantMessages(result[idx], incoming); // fay
        } else {
          flushMetaBuffer();
          result.push(/* maybe reorder tool_use A6d */);
        }
        break;
      }
      // user / attachment / … unchanged shape
    }
  }
  return postFilterNormalized(result, options?.preserveTrailingThinking);
}
```

**Semantics preserved vs 215 reverse walk:** merge latest same-id assistant in current segment; segment ends on non-assistant that is not api_system and not tool_result user.

**Not the bug:** UI-only `normalizeMessages()` block splitting.  
**Not inventing:** no cross-turn normalize cache; each API call still full-pass O(n) LN.

### Mangled symbols

`qry@216`, `JS_@215`, `LN@216`, `tN@215`, `fay@216`/`sK_@215` merge, Map `I` + cursor `D`, `gZ`/`ube` isToolResultUser, `RBd` ensureToolResultPairing, `tg`/`Kh` checkpoints, `M`/`N` logEvent

---

## 5. go-hare land status (was gap; now HAVE)

| Path | Status |
|------|--------|
| `src/utils/messages.ts` `normalizeMessagesForAPI` | **HAVE** reverse for-loop ~assistant merge; tool_result break |
| same `isToolResultMessage` | exists but unused by merge path |
| same `mergeAssistantMessages` | **AUDIT** — may be weaker than densable fay (naive concat) |
| `src/services/api/claude.ts` telemetry | **HAVE** pre/post + checkpoints; midConv re-enters same LN |
| `src/utils/queryProfiler.ts` | **HAVE** phase names |
| UI `normalizeMessages` | **DO NOT CHANGE** |
| CC-1215 tests in `messages.test.ts` | **CONFLICT** assert no merge across tool_result — densable gold **merges**; rewrite tests |

**Missing pieces:** Map+cursor; tool_result transparency; mergeAssistantMessages fay parity; optional profiler end placement; no incremental session cache.

---

## 6. 1:1 implement steps (ordered)

1. Gold source densable 2.1.216 LN only; 215 reverse-scan is pre-fix baseline.
2. In `normalizeMessagesForAPI`, replace reverse for-loop with Map + `mapScanFrom` advance before merge lookup.
3. Align segment transparency: tool_result users must **not** clear map (parity 215 reverse continue past ube).
4. Upgrade `mergeAssistantMessages` to densable fay if weaker (non-string text drop, thinking filters, tool_use reorder).
5. Do not change UI `normalizeMessages()`.
6. Leave telemetry names; optional densable-strict: move `query_message_normalization_end` to immediately after LN before postNormalize.
7. midConvFallback must use same LN Map path.
8. Rewrite CC-1215 anti-merge tests to densable merge-across-tool_result + ensureToolResultPairing still repairs.
9. Tests (section 7); update pack/checklist after green.
10. Do **not** invent cross-turn normalize cache.

---

## 7. Tests

- Many same-id streaming partials separated by tool_result users merge correctly.
- Intervening real user clears segment (no cross-turn merge of different ids).
- api_system mid-conv does not block same-id merge.
- Structural near-linear (map lookups / no reverse full scans — not flaky wall-clock alone).
- Resume-shaped orphan tool_use still repaired after ensureToolResultPairing.
- If merge upgraded: non-string text drop / tool_use reorder.

Suggested:

- `src/utils/__tests__/normalizeMessagesForAPI.quadratic.216.test.ts`
- Rewrite conflicting cases in `src/utils/__tests__/messages.test.ts`
- Optional `mergeAssistantMessages.216.test.ts`

---

## 8. Risks / do-not-simplify

- Wrong Map clear rules → drop/duplicate tool_use → API 400 or context loss.
- Map port without merge parity changes wire content.
- Profiler end placement differs densable vs local (before vs after postNormalize) — intentional unless product wants PHASE BREAKDOWN parity.
- Keep Map call-local (no module state).
- Prefer structural perf assertions over multi-second thresholds.
- Implement from 215 vs 216 SEA LN diff, not invent alternate O(n) rewrite.
