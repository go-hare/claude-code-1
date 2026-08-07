# densable 2.1.216 — AskUserQuestion free-text neutral wording (1:1)

> **id:** `askuser-neutral` · Changelog #4  
> **Status:** **HAVE** (structural pure MC vs free-text/notes/response; tests `mapToolResult.216`)  
> SEA: mapToolResult ~226581200–226589400  
> Deep dig: `DEEP-1TO1.md` · dumps: `askuser-free-text.*` (partial needles; authoritative body is SEA JS)  
> Local: `packages/builtin-tools/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`

---

## 1. Product intent (changelog)

> Fixed AskUserQuestion telling Claude to continue even when your answer asked it to wait or explain first — free-text answers now get neutral wording.

**Note:** Binary does **not** NLP-match “wait/explain”. Neutrality is **structural** (free-text/notes/response fail pure-structured predicate).

---

## 2. densable binary proof

| Needle | Hit | Offset | Notes |
|--------|-----|--------|-------|
| `You can now continue` | true | 226589138 | pure structured continue template |
| `free-text` | true | 69144533 | skill/prompt + multi-select UI (adjacent) |
| `answered your questions` | false | -1 | densable uses “Your questions have been answered”; local “User has answered…” |
| `wait` / `explain first` / `neutral` | false | -1 | changelog-only product intent |

---

## 3. Cleaned densable schema / strings

### tool_result templates

```text
Pure MC:
  Your questions have been answered: ${s}. You can now continue with these answers in mind.

Free-text / notes / custom:
  The user answered: ${s}. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.

Freeform response field:
  The user responded: ${response}

Empty:
  The user did not answer the questions.

AFK (c7u):
  No response after ${secs}s — the user may be away from keyboard. Proceed using your best judgment based on the context so far; you can re-ask this question later if it's still relevant.
  + optional: Before going idle the user had selected: ${s}.

Summary tokens:
  "${q}"="${ans}" | "${q}"=(no option selected)
  selected preview:\n${preview}
  notes: ${notes}          // densable: "notes:" not "user notes:"
Sentinel: (notes only)     // Yho
```

### Schema (densable)

- options: label, description, preview? (no model-authored Other)
- annotations: questionText → `{ preview?, notes? }`
- output: questions, answers, `response?` (“Freeform text the user typed instead of selecting a structured option”), annotations?, afkTimeoutMs?
- answers preprocess: array-of-strings join `", "` (sd_)

### Prompt guidance (adjacent)

Skip button + free-text box always present; do not include `None`/`Other` as model options.

---

## 4. Cleaned densable runtime

```js
const NOTES_ONLY = '(notes only)'; // Yho

function mapToolResultToToolResultBlockParam(
  { questions, answers, response, annotations, afkTimeoutMs },
  toolUseId,
) {
  // build summary s per question (skip if !hasOption && !notes)
  // hasOption = ans && ans !== NOTES_ONLY
  // notes label: "notes:" 

  let content;
  if (afkTimeoutMs) {
    content = s
      ? `${formatAfkTimeoutMessage(afkTimeoutMs)}\n\nBefore going idle the user had selected: ${s}.`
      : formatAfkTimeoutMessage(afkTimeoutMs);
  } else if (response?.trim()) {
    content = `The user responded: ${response}`;
  } else if (s) {
    const allPureStructured = questions.every(({ question: qText, options, multiSelect }) => {
      if (annotations?.[qText]?.notes) return false;
      const ans = answers[qText];
      const labels = new Set(options.map(o => o.label));
      if (Array.isArray(ans)) {
        return multiSelect && ans.length > 0 && ans.every(x => labels.has(x));
      }
      if (!ans || ans === NOTES_ONLY) return true;
      if (labels.has(ans)) return true;
      if (!multiSelect) return false; // custom free-text
      const parts = ans.split(', ');
      return parts.length > 1 && parts.every(x => labels.has(x));
    });
    content = allPureStructured
      ? `Your questions have been answered: ${s}. You can now continue with these answers in mind.`
      : `The user answered: ${s}. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`;
  } else {
    content = 'The user did not answer the questions.';
  }
  return { type: 'tool_result', content, tool_use_id: toolUseId };
}

// call() forwards response when trim non-empty
```

### Mangled symbols

`vsr`, `Yho`, `c7u`, `sd_`, `cd_` outputSchema, `mapToolResultToToolResultBlockParam`, …

---

## 5. go-hare land status (was gap; now HAVE)

| Path | Status |
|------|--------|
| `AskUserQuestionTool.tsx` mapToolResult | **HAVE** was: `User has answered your questions… You can now continue…` |
| same | **HAVE** densable `notes:` |
| same | **HAVE** NOTES_ONLY / (no option selected) |
| same | **HAVE** response freeform branch |
| same | **HAVE** empty-answer branch |
| same | **HAVE** c7u AFK + Before going idle |
| Permission UI | **HAVE** free-text fails pure predicate |
| Prompt | optional; core item is tool_result wording |

---

## 6. 1:1 implement steps (ordered)

1. Port `NOTES_ONLY = '(notes only)'`.
2. Extend outputSchema + call() with optional `response` (exact describe).
3. Align answers array-of-strings preprocess join `", "` if UI can emit arrays.
4. Rebuild summary: hasOption/NOTES_ONLY, `(no option selected)`, `selected preview:`, `notes:`.
5. Content priority exact: afk → response → pure vs neutral → empty.
6. Pure every() densable edges only (notes force false; multiSelect rules; no NLP).
7. Wire call() response pass-through.
8. Ensure permission UI free-text fails pure predicate (answers custom / notes / response) without inventing unproven UI.
9. Align AFK to c7u + Before going idle.
10. Tests (section 7).
11. Leave model prompt Other guidance alone unless also porting densable Vqi variants.
12. `bun run precheck`.

---

## 7. Tests

- All labels → continue wording; no neutral clause.
- Custom non-label free-text → neutral careful-read / not-proceed.
- annotations notes → neutral even if answer is valid label.
- response freeform → `The user responded:`.
- Empty → did not answer.
- NOTES_ONLY + notes summary shape.
- multiSelect pure comma-joined labels → continue; custom token → neutral; array purity edges.
- afkTimeoutMs alone and with partial selections.

Suggested:

- `packages/builtin-tools/src/tools/AskUserQuestionTool/__tests__/mapToolResult.216.test.ts`
- `.../__tests__/call.forwardResponse.216.test.ts`
- optional UI submitAnswers free-text sink test

---

## 8. Risks / do-not-simplify

- Wrong free-text sink (answers vs notes vs response) can still force continue if pure not failed.
- multiSelect purity: split `", "` length>1 for string form — edge cases UNCERTAIN.
- NOTES_ONLY purity true while notes force neutral via every short-circuit.
- Do not leave mixed local+densable templates (`User has answered…` / parenthetical AFK / `user notes:`).
- Changelog wait/explain is product intent only — structural neutrality, not NLP.
- Adjacent multi-select type===`"input"` free-text UI is a different component.
- Existing extract `askuser-free-text.*` incomplete; SEA body is authoritative.
