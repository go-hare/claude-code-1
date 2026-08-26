# densable 2.1.212 — #19 Hosted sessions: ignore repo mTLS / extra CA / OAuth scopes

Changelog:

> Fixed hosted (host-managed) sessions failing at startup when repository settings configured mTLS certs, extra CA bundles, or OAuth scopes; these transport settings are now ignored with a warning

## densable symbols

| densable | role |
|----------|------|
| `LGm` | Set of transport-sensitive env keys |
| `KVt(key)` | `LGm.has(key.toUpperCase())` |
| `PGm` / `LLn` | `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` |
| `s_o(key, source)` | once-per-key warn strip |
| `byy` | settings.env filter under host-managed |
| `HNe.managedByHost` | `PROVIDER_MANAGED_BY_HOST \|\| HOST_AUTH_ENV_VAR` |
| `HNe.managedByHostFlag` | `PROVIDER_MANAGED_BY_HOST` only |
| `qp_` | early CA path: skip settings NODE_EXTRA_CA_CERTS when host-managed + KVt |

### LGm (verbatim)

```js
LGm = new Set([
  'CLAUDE_CODE_CLIENT_CERT',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'CLAUDE_CODE_OAUTH_SCOPES',
])
function KVt(e) {
  return LGm.has(e.toUpperCase())
}
```

### s_o warn copy

```
Ignoring ${key} from ${source} — this session's provider routing is managed by the host (CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST or a host-auth-callback marker), so settings-sourced provider/auth configuration does not apply.
```

### byy host branch (relevant)

```js
if (HNe.managedByHostFlag && LLn(o)) {
  s_o(o, t)
  continue
}
if (HNe.managedByHostFlag && KVt(o)) {
  s_o(o, t)
  continue
}
```

### qp_ early CA

```js
if (Z.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST && KVt('NODE_EXTRA_CA_CERTS')) {
  T('CA certs: skipping settings-sourced NODE_EXTRA_CA_CERTS under host-managed provider')
  return
}
```

## Local alignment

| densable | local | status |
|----------|-------|--------|
| LGm / KVt | `HOST_TRANSPORT_SENSITIVE_ENV_VARS` / `isHostTransportSensitiveEnvVar` | **HAVE** |
| PGm / LLn | `HOST_PROXY_ENV_VARS` / `isHostProxyEnvVar` | **HAVE** |
| s_o | `warnHostManagedSettingsEnvIgnored` | **HAVE** |
| byy strip | `stripHostManagedSettingsEnv` + `filterSettingsEnv` | **HAVE** |
| qp_ | `caCertsConfig.getExtraCertsPathFromConfig` early return | **HAVE** |

## Related files

- `src/utils/managedEnvConstants.ts`
- `src/utils/managedEnv.ts`
- `src/utils/caCertsConfig.ts`
- `src/utils/__tests__/hostManagedTransportEnv.212.test.ts`
