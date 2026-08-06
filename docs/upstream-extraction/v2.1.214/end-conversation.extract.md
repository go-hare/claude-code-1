# densable 2.1.214 — EndConversation extract

Source: `@anthropic-ai/claude-code-win32-x64@2.1.214` (`claude.exe`).

## Symbols

| densable | meaning |
|----------|---------|
| `END_CONVERSATION_TOOL_NAME` / `V$` | `"EndConversation"` |
| `END_CONVERSATION_GB_FLAG` / `p9i` | `"tengu_umber_kestrel"` |
| `parseEndConversationFlagValue` / `Pqu` | GB payload → `{enabled, allowedEntrypoints}` |
| `compileAllowedEntrypointsRegex` / `Dqu` | scope string → `/^(?:…)$/i` or null |
| `modelMeetsEndConversationFloor` / `Rqu` / `Iqu` | family floor compare |
| `isEndConversationToolEnabled` / `_fo` | entrypoint + floor + GB |
| `getDeferredHintSection` / `tty` | deferred tool one-liner for system |
| `lastAssistantTurnCalledEndConversation` / `Mqu` | two-step reflection gate |
| `EndConversationTool` / `oty` | tool via `buildTool` (`Ai`) |
| `markSessionEndedByModel` / `Ams` | transcript `{type:"ended-by-model"}` |
| `tengu_end_conversation_tool_call` | analytics event |

## Flag / floor

```js
// default entrypoints
_ms = /^cli$/i
// floors
ety = [["opus",[4,8]],["sonnet",[5]],["fable",[5]],["mythos",[5]]]

// model: ^claude-([a-z]+)-(\d+(?:-\d+)*)$ vs floor vector (component-wise ≥)
// flag true → enabled, default entrypoints
// flag { scope: "cli|sdk" } → enabled, compileAllowedEntrypointsRegex(scope)
// else → disabled

// isEnabled:
//   entrypoint = CLAUDE_CODE_ENTRYPOINT (j5t)
//   model = getMainLoopModel (aWn)
//   eKn() always false (no hard-disable stub)
//   return enabled && allowedEntrypoints.test(entrypoint) && modelMeetsFloor
```

## Tool surface

- `shouldDefer: true`, empty `strictObject({})` input
- `outputSchema: { ended: boolean, message: string }`
- `isReadOnly: true`, `isConcurrencySafe: false`
- `checkPermissions` → always allow
- description/prompt = full product guidance (`a7r`)
- `searchHint`: end conversation / abuse / demonstration

## call() phases

1. **fork** (`toolUseContext.agentId`): phase `reflect`, return `ended:false` + `END_CONVERSATION_FORK_REFLECTION_PROMPT`
2. **first call** (`!lastAssistantTurnCalledEndConversation(messages)`): phase `reflect`, return `ended:false` + `END_CONVERSATION_REFLECTION_PROMPT` (re-read guidance; call again to end)
3. **second call**: phase `end`
   - `markSessionEndedByModel(sessionId)` → `{type:"ended-by-model", timestamp, sessionId}`
   - `abortController.abort("end_conversation")`
   - non-interactive: `gracefulShutdown(1, "other", { finalMessage: END_CONVERSATION_FINAL_MESSAGE })`
   - interactive: `setAppState(s => ({...s, endedByModel: true}))`
   - return `ended:true`, message `END_CONVERSATION_TOOL_RESULT` (`"Claude has ended this chat."`)

## Product strings (verbatim)

- **DESCRIPTION**: `End the current conversation. Use only for sustained user abuse or when the user explicitly requests a demonstration of this tool. This will close the conversation and prevent any further messages from being sent.` + full rules (self-harm never, forks no-op, warning required, …)
- **FINAL_MESSAGE**: `Claude ended the conversation. To continue, please start a new session.`
- **TOOL_RESULT**: `Claude has ended this chat.`
- **UI block after end**: `Claude ended this conversation. Start a new session (or /clear) to continue.`
- **sibling cancel**: `<tool_use_error>Cancelled: Claude ended the conversation</tool_use_error>`
- **analytics**: `tengu_end_conversation_tool_call` `{surface, is_non_interactive, phase}` surface ∈ `fork|print|repl`

## Sibling abort

`StreamingToolExecutor.getAbortReason`: `reason === "end_conversation"` → if tool is EndConversation itself → null; else `"conversation_ended"`.

## Gates after end

- `processUserInput`: if `endedByModel` → warning system message, `shouldQuery:false`
- compact / forked agent launch: refuse when `endedByModel`
- `/clear` / session reset: `endedByModel: false`
- resume: load `ended-by-model` transcript entries into session-ended set (densable `eKn` hard-disable is stubbed false; marker still written)

## Local mapping

| densable | local |
|----------|-------|
| `Ai` buildTool | `buildTool` |
| `et(p9i,false)` | `getFeatureValue_CACHED_MAY_BE_STALE('tengu_umber_kestrel', false)` |
| `j5t()` | `process.env.CLAUDE_CODE_ENTRYPOINT` |
| `aWn()` | `getMainLoopModel()` |
| `Ams` / `ZJ` | `markSessionEndedByModel` / `appendEntryToFile` |
| `JM()` skip persist | `isSessionPersistenceDisabled()` |
| `pre(...)` | identity (suffix stub empty) |
| `OGe` / `Brt` | LogOption.endedByModel spread / read |
| `Ern` | `restoreSessionStateFromLog` + `processResumeFromLog` initialState |
| compact refuse | `compactConversation` throw SESSION_ENDED_MESSAGE |
| `xtn` fork refuse | `AgentTool.call` + `/fork` preflight `endedByModel` |
| `endconv_deferred_hint` | `systemPromptSection('endconv_deferred_hint')` |
| sibling cancel | `StreamingToolExecutor` `conversation_ended` |

## Wiring (go-hare)

- Tool: `packages/builtin-tools/src/tools/EndConversationTool/*`
- Registry: `packages/builtin-tools/src/index.ts` + `src/tools.ts` `getAllBaseTools`
- AppState: `endedByModel` + `/clear` reset
- Transcript: `ended-by-model` Entry + `loadTranscriptFile` → `endedByModelSessions`
- Resume: LogOption.endedByModel → initialState / setAppState
- Input gate: `processUserInput` when `endedByModel`
