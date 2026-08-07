# densable 2.1.216 #29 — Telemetry: permission-prompt fail ≠ user_reject; interrupt → user_abort

## Changelog

> Fixed telemetry misreporting permission denials: failed permission-prompt
> requests no longer count as user rejections, and user interrupts are now
> reported as user aborts instead of rejections.

## Gold (SEA 2.1.216 `/tmp/official-216/plat/package/claude`)

### Reason string constants (~220260384)

| densable | String |
|----------|--------|
| `QFn` | `tool permission stream closed before response received` |
| `ZFn` | `canUseTool returned a schema-invalid permission result` |
| `e2n` | `tool permission request failed` |
| `h8t` | `tool permission request aborted` |

Objects: `pCi/iNr/fCi/g8t = { type: "other", reason: QFn|ZFn|e2n|h8t }`.

### `rx_(decisionReason, behavior)` OTel source (~228141047)

```js
function rx_(e, t) {
  if (!e) return "config"
  switch (e.type) {
    case "permissionPromptTool": {
      let n = e.toolResult?.decisionClassification
      if (n === "user_temporary" || n === "user_permanent" || n === "user_reject")
        return n
      return t === "allow" ? "user_temporary" : "user_reject"
    }
    case "rule":
      return tx_(e.rule.source, t)
    case "hook":
      return "hook"
    case "mode":
    case "classifier":
    case "subcommandResults":
    case "asyncAgent":
    case "sandboxOverride":
    case "workingDir":
    case "safetyCheck":
      return "config"
    case "other":
      if (e.reason === h8t) return "user_abort" // ← 216 fix
      return "config"
    default:
      return "config"
  }
}
```

`tx_`: session → temporary/reject; localSettings|userSettings → permanent/reject; else config.

### `Gwu` analytics labels for `other` (~224603)

| reason | label |
|--------|-------|
| QFn | `permissionStreamClosed` |
| ZFn | `canUseToolInvalidResult` |
| e2n | `canUseToolRequestFailed` |
| h8t | `canUseToolAborted` |

### structuredIO `createCanUseTool` catch (~238642497)

```js
catch (_) {
  let y = `Tool permission request failed: ${_}`, v = fCi
  if (_ instanceof ZodError) {
    // log schema-invalid …
    y = `The canUseTool callback returned an invalid permission result. ${Moi}`
    v = iNr
  } else if (_ instanceof jS) // ControlStreamClosedError extends AbortError
    v = pCi
  else if (isAbortError(_) && d.aborted) {
    y = "Tool permission request aborted"
    v = g8t
  }
  return { behavior: "deny", message: y, toolUseID: i, decisionReason: v, decideLocation: "ask-path" }
}
```

**Must not** wrap failures as `{ type: "permissionPromptTool", … }` — that forces `user_reject` via `rx_`.

### MCP `--permission-prompt-tool` path `Nnm` (~238837501)

- Abort → `{ behavior: "deny", message: "Permission prompt was aborted.", decisionReason: g8t }`
- Schema-invalid safeParse fail → deny + `iNr` (config), not throw-as-reject

### Interactive path (already correct)

`onAbort` / `case "cancelled"` → `logDecision({ decision: "reject", source: { type: "user_abort" } })`.

## Local land

| File | Change |
|------|--------|
| `src/utils/permissions/permissionDecisionReasons.ts` | NEW — consts + `decisionReasonToOTelSource` / `ruleSourceToOTelSource` |
| `src/utils/errors.ts` | `ControlStreamClosedError extends AbortError` (densable jS) |
| `src/services/tools/toolExecution.ts` | use shared `decisionReasonToOTelSource` (abort → `user_abort`) |
| `src/cli/structuredIO.ts` | stream close → `ControlStreamClosedError`; catch classifies reasons |
| `src/cli/print.ts` | abort → `canUseToolAbortedDenyReason`; schema-invalid → config deny |

## Tests

`src/utils/permissions/__tests__/telemetryUserAbort.216.test.ts`
