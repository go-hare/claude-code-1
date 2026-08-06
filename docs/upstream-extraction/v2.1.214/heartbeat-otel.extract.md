# densable 2.1.214 — tool heartbeat + OTel extract

> Binary: `/tmp/official-214/package/claude.exe` (npm pack `@anthropic-ai/claude-code-win32-x64@2.1.214`)

## #9 tool progress heartbeat (`_Lu` / `Pss`)

```js
function _Lu({toolName:e,toolUseID:t,abortSignal:r,onProgress:n}){
  if(e===No)return A3g; // No = Agent tool name
  let o=Date.now(),i=!1,s=0,
  a=setInterval(()=>{
    try{
      if(i)return;
      if(r.aborted){l();return}
      n({type:"progress",toolUseID:`${t}-heartbeat-${s++}`,
         data:{type:"tool_heartbeat",toolName:e,
               elapsedTimeSeconds:Math.floor((Date.now()-o)/1000)}})
    }catch(c){ke(c),l()}
  },Pss); // Pss=30000
  a.unref();
  function l(){if(i)return;i=!0,clearInterval(a)}
  return l
}
function A3g(){}
var Pss=30000;
```

Call site (tool dispatch):

```js
let ce=n.agentId?()=>{}:_Lu({toolName:e.name,toolUseID:t,abortSignal:n.abortController.signal,onProgress:p})
try{ne=await e.call(...)}finally{ce()}
```

SDK twin yield (`[engine] yield-twin tool_progress heartbeat`):

```js
else if(e.data.type==="tool_heartbeat")
  yield{type:"tool_progress",tool_use_id:e.toolUseID,tool_name:e.data.toolName,
        parent_tool_use_id:e.parentToolUseID,elapsed_time_seconds:e.data.elapsedTimeSeconds,
        heartbeat:!0,session_id:Et(),uuid:e.uuid};
```

### Local mapping

| densable | local |
|----------|-------|
| `_Lu` | `src/utils/toolHeartbeat.ts` `startToolHeartbeat` |
| call site | `src/services/tools/toolExecution.ts` around `tool.call` |
| twin yield | `src/utils/queryHelpers.ts` `normalizeMessage` progress branch |
| schema | `SDKToolProgressMessageSchema.heartbeat` |

## #11–12 OTel

### Content max (`Ptg` / `W1` / `Dtg`)

```js
function Ptg(){
  return Math.min(
    Z.CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH??Dtg,
    Z.OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT??1/0,
    Z.OTEL_LOGRECORD_ATTRIBUTE_VALUE_LENGTH_LIMIT??1/0,
    Z.OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT??1/0)
}
function W1(e){
  let t=Ptg();
  if(e.length<=t)return{content:e,truncated:!1};
  let n=`\n\n[TRUNCATED - Content exceeds ${t>=1024?`${Math.floor(t/1024)}KB`:`${t} character`} limit]`;
  if(n.length>=t)return{content:e.slice(0,t),truncated:!0};
  return{content:e.slice(0,t-n.length)+n,truncated:!0}
}
var Dtg=61440;
```

Local: `getOTelContentMaxLength` + `truncateOTelContent` in `src/utils/telemetry/events.ts`; beta `truncateContent` delegates.

### `tool_source` (`u8n` / `aBi` / `W5t`)

```js
function aBi(e){return e?.serverType==="sdk"&&W5t()}
function u8n(e){
  let t=!e?"builtin":aBi(e)?"sdk_host_builtin_mcp":"mcp";
  return{tool_source:Se(t)}
}
// Xbl = Set(["claude-desktop","claude-desktop-3p","local-agent"])
// W5t = bGm() && !Pgi  (entrypoint in Xbl && !CLAUDE_CODE_CHILD_SESSION)
```

Used on `tool_decision` OTel (not tool_result in densable).

Local: `src/utils/telemetry/toolSource.ts`; wired in `toolExecution` `tool_decision`.

### `message.uuid` / `client_request_id`

- `user_prompt`: `"message.uuid": de` (message uuid before create)
- `assistant_response`: `"message.uuid": A.at(-1)?.uuid`
- `api_request` / `api_error`: `client_request_id`

Local: `processTextPrompt.ts`, `logging.ts` (+ pass `clientRequestId` from `claude.ts`).

## #13 subagentStatusLine effort

densable payload row:

```js
effort:g.effort, contextWindowSize:..., tokenCount:..., tokenSamples:...
```

Task register: `effort:a.effort` from agent definition.

Local: `LocalAgentTaskState.effort`, `SubagentStatusTaskRow.effort`, `executeSubagentStatusLine` maps `g.effort ?? g.selectedAgent?.effort`.
