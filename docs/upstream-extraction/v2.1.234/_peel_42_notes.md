# densable 2.1.234 #42 — `/goal` unrecoverable clear

## SEA gold
- `pXp(activeGoal, toolUseContext, querySource, terminal)` after `Ebe` turn
- Gate: `tengu_quartz_pipit` default true; main family; no `agentId`; not aborted
- `LMv(terminal)` → `auth` | `billing` | `context_limit` | `model_unavailable` | null
- `K1a(msg)` = `apiErrorIsTransient===true || error==="overloaded"||error==="server_error"`
- Auth skip: `CLAUDE_CODE_REMOTE` || `b1()` (desktop/local-agent) || `Eqt()!=null` (sdk oauth refresh)
- `TOe` logs `tengu_goal_cleared` with coarsened reason `context_limit|api_error`
- `pe("goal_met", errorCode)` → `tengu_feature_bad`
- Yield: `{type:"active_goal",value:undefined}` + `Hdi(true,condition)` + warning notice

## Local
- `src/services/goal/goalUnrecoverableClear.ts`
- `src/query/transitions.ts` — `api_error` (+ LMv reason union)
- `src/query.ts` — isApiErrorMessage → `api_error` + `errorKind` + `isTransient`
- `src/screens/REPL.tsx` — `runTurn` finally `yield* clearGoalOnUnrecoverableError`; `onActiveGoal` clears AppState
- `errors.ts` — oauth org → `oauth_org_not_allowed`; bedrock model-id / 404 → `model_not_found`
- SDK error enum extended for those kinds + `overloaded`

## Tests
- `goalUnrecoverableClear.234.test.ts`
