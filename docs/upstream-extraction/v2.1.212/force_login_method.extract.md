# densable 2.1.212 — #43 Enterprise forceLoginMethod (VS Code / SDK / setup-token / install-github-app)

Changelog:

> Expanded enterprise `forceLoginMethod` enforcement to VS Code, SDK, setup-token, and install-github-app surfaces; added `gateway` method + `forceLoginGatewayUrl`.

## densable settings schema

```js
forceLoginMethod: A.enum(["claudeai","console","gateway"]).optional().catch(void 0)
  .describe('Force a specific login method: "claudeai" for Claude Pro/Max, "console" for Console billing, "gateway" for the Cloud gateway OIDC device flow')
forceLoginGatewayUrl: A.string().url().optional().catch(void 0)
  .describe('@internal Cloud gateway URL to pre-fill and auto-connect to during login...')
```

## densable core helpers

### `h5t` — admin-managed policy origin

```js
function h5t(e) {
  return e === 'helper' || e === 'plist' || e === 'hklm' || e === 'file'
}
```

Local: `isAdminManagedPolicyOrigin` + existing `getPolicySettingsOrigin()` (`remote|plist|hklm|file|hkcu`).

### `A9t` — effective forceLoginMethod

```js
function A9t() {
  if (h5t(_4e()) && Tr('policySettings')?.forceLoginMethod === 'gateway')
    return 'gateway'
  let e = Kn()?.forceLoginMethod
  return e === 'gateway' ? void 0 : e
}
```

- Only **admin** policy origins may pin `gateway`.
- User/merged `gateway` without admin origin is stripped.

Local: `resolveEffectiveForceLoginMethod`.

### `Stt(loginWithClaudeAi)` — multi-surface pin check

```js
function Stt(e) {
  if (Z.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) {
    if (A9t() !== void 0)
      Be('auth_force_login_org', 'managed_by_host_under_method_pin')
    return { valid: true }
  }
  let t = A9t()
  if (t === void 0) return { valid: true }
  if (t === 'gateway')
    return {
      valid: false,
      message:
        "forceLoginMethod is 'gateway' in managed settings; run /login from an interactive terminal to authenticate.",
    }
  if (e === (t === 'claudeai')) return { valid: true }
  let r =
    _ae('forceLoginMethod') === 'policySettings'
      ? 'managed settings'
      : 'settings'
  return {
    valid: false,
    message:
      t === 'claudeai'
        ? `forceLoginMethod is 'claudeai' in ${r}; log in with a Claude.ai subscription account instead.`
        : `forceLoginMethod is 'console' in ${r}; log in with an Anthropic Console account instead.`,
  }
}
```

Local: `validateForcedLoginMethod` + `getSettingSourceForKey` (≈ densable `_ae`).

## Call sites (densable → local)

| densable surface | densable call | local |
|------------------|---------------|-------|
| `setup-token` (`bu_`) | `Stt(!0)` then refuse + `cli_setup_token` / `force_login_method_refused` | `setupTokenHandler` in `cli/handlers/util.tsx` |
| CLI `auth login` (`ibS`) | `A9t()==="gateway"` → stderr interactive /login; method + orgUUID mismatch gate | `authLogin` in `cli/handlers/auth.ts` |
| SDK `claude_authenticate` | `Stt(Fr??!0)` before OAuth; orgUUID mismatch suppress | `print.ts` control_request handler |
| `install-github-app` OAuth step | `Stt(!0)` before startOAuthFlow; error suffix API key | `OAuthFlowStep.tsx` |
| Interactive `ConsoleOAuthFlow` (`n8e`) | admin gateway URL + `gateway_setup` / `g2s` OIDC UI | `ConsoleOAuthFlow.tsx` + `GatewayConnect.tsx` |

## densable `g2s` GatewayConnect (interactive OIDC) — HAVE 2026-08-06

Extracted from densable `claude.exe` (offsets ~232236627 helpers, ~241161xxx UI):

### Component `g2s({onDone,onCancel,initialUrl,screenLocked})`

States: `url_input` → `connecting` → (`trust_prompt`?) → `connecting` → `polling` → `onDone`.

Key paths:

1. **Normalize URL** `u6n` — trim, default `https://`, strip trailing `/`, http only for localhost.
2. **Network policy** `mOc` — DNS resolve; every address must be private (a6n) unless host in FedRAMP allowlist `GGh` (`claude.fedstart.com`, `claude.palantirfedstart.com`); proxy host must also be private when used.
3. **Metadata** `GET {base}/.well-known/oauth-authorization-server` → optional `device_authorization_endpoint` / `token_endpoint`.
4. **Same-origin filter** `$zd` — advertised endpoints only if same origin; else `{base}/oauth/device_authorization` and `{base}/oauth/token`.
5. **TLS probe** `o2r` → `{hostname, fingerprint}` (fingerprint256 lowercased, colons stripped; non-https loopback → `http-loopback`).
6. **Pin compare** `i2r(hostname)` vs live; match → device auth; else `trust_prompt`.
7. **Trust** `gOc(hostname, fingerprint)` writes `gatewayTrust[host]=fp`; then device auth.
8. **Device authorization** `POST deviceAuthorizationEndpoint` empty body, `application/x-www-form-urlencoded`; zod `fl_`; open `verification_uri_complete ?? verification_uri`; show `user_code`.
9. **Poll** `POST tokenEndpoint` with `grant_type=urn:ietf:params:oauth:grant-type:device_code` + `device_code`; handle `authorization_pending` / `slow_down`(+5s) / `expired_token` / `access_denied` via `wki`.
10. **Finish** re-probe TLS; pin must still match; `Smc` → `cje` set `gatewayAuth` + secureStorage `enterpriseGateway` `{url,jwt,expiresAt,tokenEndpoint,idpRefreshToken?}`.

UI copy (verbatim densable):

- `Cloud gateway` / managed URL / `Press Enter to connect` / `Esc to cancel`
- No URL: `Gateway login is required by your organization's policy, but no gateway URL is configured...`
- Trust: first-connect vs cert-rotation warnings; `Certificate fingerprint (SHA-256): {16}…`
- Poll: `Cloud gateway · sign in` + user code + `Waiting for sign-in to complete in your browser…`
- Success surface in parent: `Connected to Cloud gateway.` + Enter → `tengu_oauth_gateway_done`

### densable `n8e` wiring

```js
// policy admin gateway
d = h5t(_4e()) && policy?.forceLoginMethod === 'gateway'
p = d ? policy?.forceLoginGatewayUrl : void 0
f = settings.forceLoginMethod === 'gateway' && !d ? void 0 : settings.forceLoginMethod
m = prop ?? f
g = m === 'gateway' || p !== void 0
// initial: setup-token | claudeai/console → ready_to_start; g → gateway_setup; else idle
// gatewayScreenLocked: m === 'gateway'
// gateway_setup → g2s({initialUrl:p, screenLocked:m==='gateway', onDone→gateway_done, onCancel→idle})
// gateway_done Enter → tengu_oauth_gateway_done
// gatewayUnsupportedWarning: null (densable)
```

Local:

- `src/utils/gatewayLogin.ts` — pure protocol helpers
- `src/components/GatewayConnect.tsx` — g2s UI
- `src/components/ConsoleOAuthFlow.tsx` — n8e gateway_setup/gateway_done
- reuses `gatewayEnv.ts` (`probeGatewayTlsFingerprint`, `persistGatewayTlsPin`, `persistEnterpriseGatewayCredential`, `setGatewayAuth`)

## Local status (2026-08-06)

| densable | local | status |
|----------|-------|--------|
| enum + `forceLoginGatewayUrl` schema | `settings/types.ts` | **HAVE** |
| `A9t` / `Stt` / `_ae` / `h5t` | `forceLoginMethod.ts` | **HAVE** |
| setup-token refuse | `util.tsx` | **HAVE** |
| CLI auth login gateway refuse + org mismatch | `auth.ts` | **HAVE** |
| SDK claude_authenticate | `print.ts` | **HAVE** |
| install-github-app OAuth | `OAuthFlowStep.tsx` | **HAVE** |
| ConsoleOAuthFlow + g2s OIDC wizard | `ConsoleOAuthFlow.tsx` + `GatewayConnect.tsx` + `gatewayLogin.ts` | **HAVE** |
| VS Code extension host surface | N/A in this repo (CLI/SDK only) | **N/A** — same Stt used by SDK path |

## Related local files

- `src/utils/forceLoginMethod.ts`
- `src/utils/gatewayLogin.ts`
- `src/utils/gatewayEnv.ts`
- `src/components/GatewayConnect.tsx`
- `src/components/ConsoleOAuthFlow.tsx`
- `src/utils/__tests__/forceLoginMethod.212.test.ts`
- `src/utils/__tests__/gatewayLogin.test.ts`
- `src/utils/settings/types.ts`
- `src/cli/handlers/util.tsx` / `auth.ts`
- `src/cli/print.ts`
- `src/commands/install-github-app/OAuthFlowStep.tsx`
