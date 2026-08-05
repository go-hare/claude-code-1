# densable 2.1.212 — session WebSearch / subagent caps

## Defaults (binary)

```js
function Etu(){return Z.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION??qpg}
function vtu(){return Z.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION??zpg}
var t3r=5,qpg=200,zpg=200
```

- `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` default **200** (`qpg`)
- `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` default **200** (`zpg`)
- Env via densable `Z` (numeric coercion); unset → default

## taskRegistry counters

Export names (API surface):

- `incrementTotalAgentSpawns` / `getTotalAgentSpawns` / `resetTotalAgentSpawns`
- `incrementWebSearchCalls` / `getWebSearchCalls` / `resetWebSearchCalls`

`/clear` resets both budgets (changelog).

## WebSearch call-site (`async call`)

```js
let a=vtu(), l=t.taskRegistry.getWebSearchCalls();
if(l>=a) return me("tool_web_search","web_search_session_cap",{max_web_searches_per_session:a}),
  {data:{query:s,results:[`Web search was not performed: this session has used its web search budget (${l} of ${a} WebSearch calls). Continue with the information already gathered instead of issuing more searches. If more searches are genuinely needed, ask the user to raise CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION.`],durationSeconds:0,searchCount:0}};
t.taskRegistry.incrementWebSearchCalls();
// ... actual search
```

Soft budget miss: **return tool result**, do not throw. Telemetry event `web_search_session_cap`.

## AgentTool call-site

```js
let N=()=>{
  if(l.abortController.signal.aborted) throw new El;
  let Ue=Etu(), Ye=l.taskRegistry.getTotalAgentSpawns();
  if(Ye>=Ue) throw me("subagent_launch","subagent_count_cap"),
    new eqe(`Subagent spawn limit reached (${Ye} of ${Ue} agents spawned). Complete the remaining work directly with your tools instead of spawning more agents. If more agents are genuinely needed, ask the user to raise CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION.`);
  l.taskRegistry.incrementTotalAgentSpawns();
};
// N() before teammate spawn and other spawn paths
```

Hard cap: **throw** with densable message. Telemetry `subagent_count_cap`.

inProcessRunner: `if(!_&&!g) w.incrementTotalAgentSpawns()` — skip when already counted (`countedTowardSessionSpawnCap`).

## Product mapping

Local lacks `ToolUseContext.taskRegistry`; product uses session-scoped module counters with the same API names (get/increment/reset) so WebSearch/AgentTool/`/clear` stay 1:1 with densable semantics.
