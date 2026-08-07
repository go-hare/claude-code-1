# densable 2.1.216 #37 — bg `/mcp` + `/install-github-app` park “needs input”

## Official

> Background sessions: `/mcp` and `/install-github-app` now park a "needs input" request in the agent view when no client is attached

## densable gold

### Gate

`SB() = Zi() && !vT()` = bg session && !attacherCaps (local: `isBgSessionWithoutTerminal` / `isBgNoTerminal`).

### CUt / dRs / pRs / gQp / zpd / Kpd

```js
async function CUt(needs, detail) {
  if (!SB()) return false
  const r = await dRs(needs, detail) // → zpd on CLAUDE_JOB_DIR
  switch (r.kind) {
    case 'refused': return false
    case 'already':
      if (Kbn?.needs !== needs) gQp(needs, { tempo: 'idle', needs: void 0, detail: '' })
      return true
    case 'wrote':
      return gQp(needs, r.prior), true
  }
}

// zpd: if already same needs → already; if blocked with other needs (!= Yx empty prompt) → refused
// else write tempo:blocked + needs + detail; return {wrote, prior}

// gQp: REt=Tci.subscribe (attacher caps). When !SB() (attached), Kpd restore prior.
```

### `/mcp` sof

```js
if (SB()) return await sof(onDone), null
// sof:
const parked = await CUt('open this session to manage MCP servers', 'MCP settings requested')
onDone(parked ? _Ob : gOb, { display: 'system' })
```

- `gOb`: attach + enable/disable/reconnect steer (no “needs input” clause)
- `_Ob`: “…This session now shows "needs input" in agent view — open it and run /mcp…”

### `/install-github-app` CRb

```js
if (SB()) {
  const parked = await CUt('open this session to finish /install-github-app', '/install-github-app requested')
  onDone(parked ? parkedMsg : attachMsg, { display: 'system' })
  return null
}
```

### MCP reconnect needs-auth

```js
if (SB()) {
  const parked = await CUt(`authenticate ${name} — open this session and run /mcp`, 'MCP authentication needed')
  msg = `${name} requires authentication. Open this session and run /mcp to authenticate.` + (parked ? ' It now shows "needs input" in agent view.' : '')
} else {
  msg = `${name} requires authentication. Use /mcp to authenticate.`
}
```

## Local land

| File | Change |
|------|--------|
| `src/utils/bgCommandNeedsPark.ts` | CUt/zpd/Kpd/gQp + copy |
| `src/bootstrap/state.ts` | `subscribeAttacherCaps` + emit on `setAttacherCaps` (Tci) |
| `src/commands/mcp/mcp.tsx` | sof park |
| `src/commands/install-github-app/install-github-app.tsx` | CRb park |
| `src/components/mcp/MCPReconnect.tsx` | needs-auth CUt copy |

## Tests

`src/utils/__tests__/bgCommandNeedsPark.216.test.ts`
