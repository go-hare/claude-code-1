# densable 2.1.212 — #45 headless/SDK `set_model` next-turn

Changelog:

> Changed headless/SDK sessions to apply a `set_model` control request mid-turn;
> the next model round-trip uses the new model instead of waiting for the next turn

Also related changelog:

- Fixed hang on non-string `set_model` payload (error response)
- Fixed redundant remote `set_model` injecting duplicate `/model` breadcrumbs

## densable print handler (verbatim shape)

```js
else if (We.request.subtype === "set_model") {
  let Fr = We.request.model
  if (Fr != null && typeof Fr !== "string") {
    me("model_switch", "invalid_model_type")
    Cn(We, "set_model: model must be a string")
    continue
  }
  let Hn = We.request.model ?? "default"
  let Zr = Hn.trim().toLowerCase() === "default"
  let vn = Zr ? Kv() : Hn
  let Uo = Zr ? { recognized: true } : RGf(vn)
  let Qn = !Zr && !Z0(vn) && !(N$(vn) ?? il(vn))
  let Yo = Qn ? h5(vn) : null
  if (!Uo.recognized) {
    O("tengu_set_model_unrecognized", { shape, had_suggestion, surface: "print" })
    me("model_switch", "unrecognized_model")
    Cn(We, DGf(_5e(Hn), Uo.suggestion))
  } else if (Qn && Yo === null) {
    let Zn = Ye !== undefined && (Z0(Ye) || il(Ye)) ? oi(Ye) : undefined
    kt(Hn, Zn)
    me("model_switch", "not_allowed")
    Cn(We, r4(Hn, Zn ?? xi()))
  } else {
    let Zn = Yo ?? vn
    let Wn = xi()
    let $s = Ye
    Ye = Zn
    HS(Zn)
    l(yc => ({ ...yc, mainLoopModelForSession: Zn }))
    e.sessionState.notifyMetadataChanged({ model: Zn })
    if (xi() !== Wn || oi(Zn) !== oi($s ?? Wn)) Ge(Hn, Zn)
    if (vt()) {}
    if (Yo !== null) kt(Hn, Yo)
    if (Yo !== null) Be("model_switch", "family_alias_stepped_down")
    else Ae("model_switch")
    Mn(We)
  }
}
```

## densable symbols

| densable | role | local |
|----------|------|-------|
| `Ye` | activeUserSpecifiedModel (next ask userSpecifiedModel) | `activeUserSpecifiedModel` |
| `HS` | `mainLoopModelOverride = e` | `setMainLoopModelOverride` |
| `mainLoopModelForSession` | AppState session pin | `setAppState({ mainLoopModelForSession })` |
| `Kv` | getDefaultMainLoopModel | same |
| `xi` | getMainLoopModel | same |
| `oi` | parseUserSpecifiedModel / family resolve | `parseUserSpecifiedModel` |
| `RGf` | recognition (firstParty only) | `recognizePrintModel` |
| `DGf` | unrecognized error copy | `unrecognizedModelMessage` |
| `_5e` | sanitize id in errors | `sanitizeModelIdForError` |
| `Z0` | default-equivalent always allowed | `isDefaultEquivalentModel` |
| `il` / `N$` | availableModels allowlist | `isModelAllowed` |
| `h5` | family alias step-down | `stepFamilyAliasToAllowed` |
| `r4` | not_allowed copy | `modelNotAllowedMessage` |
| `Ge` | inject /model breadcrumbs | `injectModelSwitchBreadcrumbs` (conditional) |
| `me` / `Ae` / `Be` | tengu_feature_bad/ok/sad | `logEvent` |
| next turn | `userSpecifiedModel: Ye` | `userSpecifiedModel: activeUserSpecifiedModel` |

## densable `RGf` (recognition)

```js
function RGf(e) {
  let t = e.trim()
  if (!t) return { recognized: false, shape: "empty" }
  if (xn() !== "firstParty" || !Gd()) return { recognized: true }
  // aliases, custom env, model options, /^claude-\S+$/ → recognized
  // else YpS shape + optional fuzzy suggestion
}
```

## densable bridge `set_model`

```js
case "set_model": {
  let I = e.request.model
  if (I != null && typeof I !== "string") {
    me("model_switch", "invalid_model_type")
    error "set_model: model must be a string"
    break
  }
  let R = l?.(e.request.model ?? void 0)
  // onSetModel callback; error if !R.ok
}
```

Local bridge `onSetModel` now applies the same Ye/HS/session triple + conditional breadcrumbs.

## Local files

- `src/utils/model/printSetModel.ts` — pure decision + RGf/DGf/h5/r4/_5e
- `src/cli/print.ts` — set_model branch + onSetModel
- `src/utils/model/__tests__/printSetModel.212.test.ts`

## Gap fixed vs pre-align local

| before | after |
|--------|-------|
| no type check on non-string | error + `invalid_model_type` |
| `=== 'default'` only | `trim().toLowerCase() === 'default'` |
| no recognition / allowlist | RGf + isModelAllowed + h5 step-down |
| only Ye + HS | Ye + HS + **mainLoopModelForSession** |
| always breadcrumbs | only when model/family changes |
