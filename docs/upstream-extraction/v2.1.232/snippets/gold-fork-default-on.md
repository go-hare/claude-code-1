# densable 2.1.232 #1 — FORK_SUBAGENT default ON

## Gold (SEA)

```js
function Drb() {
  if (X.CLAUDE_CODE_FORK_SUBAGENT === true) return 'env'
  if (Nn()) return 'disabled' // USER_TYPE=ant
  return 'default' // product default ON
}
function FDd() {
  let e = UL() // session sticky
  if (Ige()) return 'disabled' // coordinator
  if (X.CLAUDE_CODE_FORK_SUBAGENT === false) return 'disabled'
  if (e.forkSubagentEnabledSource !== undefined)
    return e.forkSubagentEnabledSource
  let t = Drb()
  if (t !== 'disabled') e.forkSubagentEnabledSource = t
  return t
}
function _Ie() {
  return FDd() !== 'disabled'
}

// Agent spawn: run_in_background !== false → async bg (non-teammate)
```

## Local

| densable | local |
| -------- | ----- |
| `Drb`/`FDd` | `resolveForkSubagentSource` |
| `_Ie` | `isForkSubagentEnabled` in gate + AgentTool wrapper |
| coordinator / non-interactive | AgentTool `forkSubagent.ts` after gate |
| bg default | `run_in_background !== false` (already HAVE) |

GB `tengu_fork_subagent` is **not** densable default path (Drb has no GB).
