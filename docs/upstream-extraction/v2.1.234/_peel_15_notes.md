# densable 2.1.234 #15 — fullscreen modal copy losing characters

## SEA gold
- `y8i(selection, isActive, onCopied, lastCopiedRef?)`
- On settle: `copySelectionNoClear()`; `_e("clipboard_write")`; cache text in `lastCopiedRef`
- Scroll ctrl+c: if `lastCopiedRef` set → clearSelection + toast(cache); else `copySelection()`
- Toast tip: native path + `copyOnSelect===undefined` → append `· disable auto-copy in /config` (Cvh, wtw=10, Rvh=5)

## Local
- `src/hooks/useCopyOnSelect.ts` — lastCopiedRef + tengu_feature_ok clipboard_write + classifier
- `src/components/ScrollKeybindingHandler.tsx` — lastCopiedRef ctrl+c + tip path via tipHistory
- AgentView/FleetView remains 3-arg (SEA matches)

## Tests
- `useCopyOnSelect.234.test.ts`
