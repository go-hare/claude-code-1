# #41 mid-turn fullscreen dialogs — densable 2.1.234

## Gold

- `ARt(e,t)` — resolve `immediate` boolean | `(args)=>boolean`
- `Ns()` — fullscreen **feature** gate (`isFullscreenFeatureGateEnabled`)
- `X3e()` — `tengu_immediate_model_command` (`shouldInferenceConfigCommandBeImmediate`)
- `RVr()` — `Ns()&&X3e()` (`shouldFullscreenInferenceCommandBeImmediate`)

| Command | immediate |
|---------|-----------|
| help / theme | `get immediate(){return Ns()}` |
| add-dir | `(e)=>e.trim()!==""\|\|Ns()` |
| config / advisor | `(e)=>e.trim()!==""?X3e():RVr()` |
| autocompact | `immediate:!0` |

Advisor: `local-jsx` + Dialog “Advisor (experimental)” + Select (`sah`/`Mno`).
Autocompact: `local-jsx` dialog `Buh` + `CVr`/`bDn`/`Nq`; settings `autoCompactWindow`.

## Local

- `src/utils/immediateCommand.ts` — ARt/Ns/X3e/RVr
- `src/types/command.ts` — `immediate?: boolean | ((args)=>boolean)`
- help/theme/add-dir/config immediacy
- `src/commands/advisor/` — local-jsx dialog + apply
- `src/commands/autocompact/` — local-jsx dialog + apply
- `src/utils/autoCompactWindow.ts` — bDn/Nq/CVr
- settings schema `autoCompactWindow`
- `getEffectiveContextWindowSize` honors settings window

## Status

**HAVE** (core mid-turn immediacy + advisor/autocompact surfaces).
Optional deepen: full densable clientdata/experiment Nq tables; advisor capability-rank `Qer` gate.
