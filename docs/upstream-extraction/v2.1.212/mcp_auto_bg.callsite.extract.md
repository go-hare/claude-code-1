# densable 2.1.212 — MCP auto-background call-site

## Exports

```js
tt(BZu,{getMcpAutoBackgroundMs:()=>Ncy, callMcpToolWithAutoBackground:()=>$cy})
```

## `getMcpAutoBackgroundMs` (`Ncy`)

```js
function Ncy(e,{isNonInteractiveSession:t=!1}={}){
  if(Ocy.has(e?.type??"")) return 0;           // Ocy = Set(["sse-ide","ws-ide"])
  if(pv()) return 0;                            // local gate (if any)
  if(t && !Z.CLAUDE_AUTO_BACKGROUND_TASKS) return 0;
  let r=Z.CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS;
  if(r!==void 0) return Math.min(Math.max(0,r), Mcy); // Mcy=2147483647
  return Qe("tengu_mcp_auto_background", !0) ? Lcy : 0; // Lcy=120000
}
```

- Default **ON** at **120_000** ms when GB `tengu_mcp_auto_background` defaults true.
- Env `0` disables; positive sets threshold; unset → GB default.
- Non-interactive: only when `CLAUDE_AUTO_BACKGROUND_TASKS` truthy.
- IDE transports `sse-ide` / `ws-ide`: always off.

## `callMcpToolWithAutoBackground` (`$cy`)

Race: `run(signal)` vs timeout `autoBackgroundMs`.

- If settles or parent aborted before timeout → return normal result.
- If `hasPendingElicitation?.()` during timeout → keep waiting (loop).
- Local wiring: `beginMcpElicitation`/`endMcpElicitation` around URL elicitation
  processing in `callMCPToolWithUrlElicitationRetry`; client auto-bg passes
  `hasPendingElicitation` = process counter OR AppState elicitation.queue length.
- On timeout: register task, `onBackgrounded?.()`, analytics `tengu_mcp_tool_auto_backgrounded`.
- Immediate tool result text:

```
MCP tool "${description}" is still running after ${S}s. It was moved to the background as task ${y} and keeps running; you'll receive a notification with the result when it completes. You can keep working in the meantime. To stop it, use TaskStop with task_id "${y}". Note: it does not survive exiting this session.
```

- When promise settles: update task status completed/failed; enqueue task-notification; analytics success/fail on `mcp_auto_background`.
