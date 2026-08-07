# densable 2.1.216 — MCP re-auth timing + needs-reauth toast (1:1)

> **id:** `mcp-reauth` · Changelog #19  
> **Status:** **HAVE** (UI QLu→ebe→eMu; t7r emit on permanent refresh clear; per-server toast; CLI residual = densable wat)  
> SEA: `/tmp/official-216/plat/package/claude`  
> Landed: 2026-08-06

---

## 1. Product intent (changelog)

> Fixed MCP re-auth revoking working credentials before the new sign-in succeeds; background needs-auth messaging points at a usable command.

Two product surfaces:

1. **Interactive re-auth order** — do not `wat` (revoke+clear local) before OAuth; snapshot old tokens, OAuth into storage, reconnect, then server-revoke only *replaced* tokens.
2. **Lost-auth notification** — when refresh permanently kills credentials, toast: open `/mcp` and select **Re-authenticate** (not a dead bg-only command).

---

## 2. densable binary proof

| Needle | Hit | Notes |
|--------|-----|-------|
| `function QLu` | 1 | snapshot tokens from secure storage |
| `function ZLu` | 1 | server-side revoke only (no local clear) |
| `function eMu` | 1 | revoke replaced tokens after connected |
| `function wat` | 1 | clear-auth / CLI pre-login path |
| `await QLu` + `await ebe` + `await eMu` | UI menu | reauth handler |
| `await wat(...,{preserveStepUpState:!0}),await ...ebe` | CLI login | **still pre-revokes** |
| `t7r=xs()` | 1 | reauth signal bus |
| `t7r.emit(this.serverName)` | 2 | invalid_grant + invalid_client paths |
| `t7r.subscribe` | 1 | SRa / useManageMCPConnections |
| `mcp-needs-reauth-` | toast key | |
| `lost authentication · open /mcp and select Re-authenticate` | copy | |
| `Got new credentials, but … rejected them on reconnect` | reconnect fail | |
| `Can't authenticate MCP servers while no terminal is attached…` | bg | already local `BG_NO_TERMINAL_MCP_AUTH_MSG` |

---

## 3. densable runtime (cleaned)

### 3.1 Token helpers

```js
// QLu — snapshot
async function QLu(e, t) {
  let n = (await Hc().readAsync())?.mcpOAuth?.[f0(e, t)]
  if (!n?.accessToken && !n?.refreshToken) return
  return {
    accessToken: n.accessToken || void 0,
    refreshToken: n.refreshToken,
    clientId: n.clientId,
    clientSecret: n.clientSecret,
    ...n.discoveryState && {
      discoveryState: { authorizationServerUrl: n.discoveryState.authorizationServerUrl },
    },
  }
}

// ZLu — server revoke only; returns failure kind
// eMu — compare previous vs current; revoke only replaced access/refresh
// wat — ZLu current + clear local (+ optional preserveStepUpState)
```

### 3.2 UI reauth (MCP remote server menu)

```js
let Ge = e.isAuthenticated ? await QLu(e.name, ve.config) : void 0
await ebe(e.name, ve.config, /* setAuthUrl */, signal, { onWaitingForCallback })
// tengu_mcp_auth_config_authenticate
let Me = await Y(e.name) // reconnect
if (Me.client.type === "connected") {
  if (Ge) await eMu(e.name, ve.config, Ge)
  // Authentication successful. Reconnected/Connected to …
} else if (Me.client.type === "needs-auth") {
  // Got new credentials, but ${name} rejected them on reconnect…
} else {
  // Got new credentials, but reconnecting to ${name} failed…
}
```

### 3.3 CLI `mcp login` (residual = densable)

```js
await wat(e, n.config, { preserveStepUpState: true })
await ebe(...)
```

**Do not invent CLI eMu** unless a later densable drops `wat` here.

### 3.4 Refresh permanent failure → t7r

```js
// invalid_grant
let { freshTokens } = await this.readConcurrentRefreshWinner()
if (freshTokens) return freshTokens // concurrent winner — no toast
await this.invalidateCredentials("tokens")
// failure telemetry invalid_grant
t7r.emit(this.serverName)

// invalid_client | unauthorized_client
// concurrent winner / concurrent re-register → no emit
await this.invalidateCredentials("all")
t7r.emit(this.serverName)
```

### 3.5 Notification subscriber (SRa)

```js
t7r.subscribe((L) => {
  if (v.current.has(L)) return
  let F = store.mcp.clients.find((O) => O.name === L)
  if (F?.type !== "connected") return
  // Silent recovery paths — oKn(config, hasClaudeAuth) || (XAA && oauth.xaa)
  if ((F.config.type === "sse" || F.config.type === "http") &&
      (oKn(F.config, !!ys()?.accessToken || IWe()) || Zge() && !!F.config.oauth?.xaa))
    return
  v.current.add(L)
  y({
    key: `mcp-needs-reauth-${L}`,
    kind: "warning",
    priority: "high",
    text: `MCP server "${L}" lost authentication · open /mcp and select Re-authenticate`,
    color: "warning",
    timeoutMs: 12000,
  })
})
```

`oKn(e,t) = n5e(e) || DYt(e) || (Fce(e.url) && firstParty && t)`

- `n5e`: Authorization header present  
- `DYt`: headersHelper object identity (WeakSet) — local uses `headersHelper` string  
- `Fce`: https Anthropic design MCP `/v1/design/`  
- `Zge`: `CLAUDE_CODE_ENABLE_XAA`

---

## 4. Local port map

| densable | Local |
|----------|--------|
| QLu | `snapshotMcpOAuthTokens` (`auth.ts`) |
| ZLu | `revokeTokensAtServer` |
| eMu | `revokeReplacedMcpTokens` |
| wat | `revokeServerTokens` (clear-auth + CLI login) |
| ebe | `performMCPOAuthFlow` |
| UI handler | `MCPRemoteServerMenu.handleAuthenticate` |
| t7r | `mcpReauthSignal.ts` emit/subscribe |
| SRa subscribe | `useManageMCPConnections` effect |
| bg no TTY | `BG_NO_TERMINAL_MCP_AUTH_MSG` (already) |

---

## 5. Residuals

1. **CLI `mcp login` still pre-revokes** — densable SEA gold: `await wat(e,n.config,{preserveStepUpState:!0}),await ebe(...)`. **Keep 1:1** — do not invent CLI QLu/eMu.  
2. **DYt `prg` WeakSet** — local ports `isMcpHeadersHelperConfig` / `markMcpHeadersHelperConfig` (object identity). densable SEA has `prg.has` but **no recovered `prg.add` call site** (mark path effectively dead). Toast oKn must **not** skip on truthy `headersHelper` string (`nKn` is a different gate).  
3. Local notification type has no `kind` field — densable `kind:"warning"` omitted; `color`/`priority`/`timeoutMs` match.  
4. Concurrent refresh winner helper aligned to densable `readConcurrentRefreshWinner` (null expiry OR >300s).

---

## 6. Tests

- `src/services/mcp/__tests__/mcpReauth.216.test.ts` — signal, skip gate, source contracts.

---

## 7. Definition of done

- [x] UI reauth no pre-`wat`  
- [x] eMu only after connected  
- [x] densable reconnect failure copy  
- [x] t7r emit on permanent refresh clear  
- [x] per-server toast + skip gate  
- [x] CLI residual documented as densable parity  
- [x] `.216` tests  
