# densable 2.1.231 FLv OAuth redirect selection (SEA win32)

```js
// JFr / gIt / ILv / AMa=3118
function JFr(e=AMa){return`http://localhost:${e}/callback`}
function rLv(){let e=Q.MCP_OAUTH_CALLBACK_PORT;return e!==void 0&&e<=65535?e:void 0}
async function gIt(e){let t=rLv();if(t)return t;if(e&&await wMa(e))return e; /* random… */ if(await wMa(AMa))return AMa;throw Error("No available ports for OAuth redirect")}
function ILv(e){let t=IMa(e);return t==="http://127.0.0.1"||t==="http://localhost"}

// FLv perform consent OAuth:
let a = cached mcpOAuth entry
let u = a?.clientId && a.redirectUri && ILv(a.redirectUri) ? Number(new URL(a.redirectUri).port)||void 0 : void 0
let h = t.oauth?.callbackPort
let g = !!o?.redirectUri
let y = g ? 0 : h ?? await gIt(u)
let S = o?.redirectUri ?? JFr(y)
Ht(e, g ? `Using custom redirectUri: ${S} (no localhost listener)`
        : `Using redirect port: ${y}${h?" (from config)":u&&y===u?" (reusing registered port)":""}`)
let v = !a?.clientId || y===u || a.redirectUri===S
await PMa(e,t,{preserveClientRegistration:v})
// if(g) startSdkAuth only; else listen(y,"127.0.0.1")+startSdkAuth
```
