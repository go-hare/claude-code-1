# densable 2.1.216 #5 — web idle re-ask / drop answer (SDK reinit redelivery)

Official:

> Claude Code on the web: after idle, re-asking questions / dropping answers

## densable gold

SEA: `/tmp/official-216/plat/package/claude` (VERSION **2.1.216**).

Needles:

| Needle | HIT |
|--------|-----|
| `tengu_reinit_pending_redelivery` | yes |
| `n_pending_permissions` / `n_pending_dialogs` | yes |
| `getPendingPermissionRequests` / `getPendingUserDialogRequests` | yes |
| `pending_permission_requests` / `pending_user_dialog_requests` on success control_response | yes |

### Server (`l1S` — print initialize handler)

SEA dump (minified, alreadyInitialized = `r`):

```js
async function l1S(e, t, r, n, o, i, s, a, l, c, u, d, p) {
  let f
  if (r) {
    let y = a.getPendingPermissionRequests(),
      v = a.getPendingUserDialogRequests()
    return (
      M('tengu_reinit_pending_redelivery', {
        n_pending_permissions: Mh(y.length),
        n_pending_dialogs: Mh(v.length),
      }),
      n.enqueue({
        type: 'control_response',
        response: {
          subtype: 'success', // NOT error / "Already initialized"
          request_id: t,
          response: await inl(o, qst(u()), i, s, d, c.userSpecifiedModel),
          pending_permission_requests: y,
          pending_user_dialog_requests: v,
        },
      }),
      {}
    )
  }
  // … first-init path continues (systemPrompt / agents / hooks / inl) …
}
```

Critical product change vs pre-216:

- **Wrong (pre-216 local):** `subtype: 'error', error: 'Already initialized'` (+ optional pending fields). Hosts that only re-arm on **success** miss parks → re-ask / drop answer after web idle reconnect.
- **Right (densable 216):** `subtype: 'success'` + full `inl` init body + pending sibling arrays + telemetry.

### Host surfaces (densable SEA 1:1)

| Surface | densable | Local |
|---------|----------|-------|
| **Query SDK** (`request(initialize)` / `reinitialize`) | On **initialize success only**: `processPendingPermissionRequests` + `processPendingUserDialogRequests` (filter subtypes, `handleControlRequest`) | **`@anthropic-ai/claude-agent-sdk`** already contains `processPendingPermissionRequests` / dialog twin |
| **RemoteSessionManager** | On any `control_response`: redeliver **only** `pending_user_dialog_requests` (+ seen-id skip). **Does not** redeliver `pending_permission_requests` | Same — dialog only (214 race tests) |
| **awaitControlResponse** | Strips/ignores prompt-redelivery fields | N/A / agent-sdk |

**Do not invent** RemoteSessionManager permission redelivery — densable SEA only arms permissions via Query initialize path.

### StructuredIO

`getPendingPermissionRequests` filters `can_use_tool`; `getPendingUserDialogRequests` filters `request_user_dialog`. `republishSurvivingPendingAction` is a separate park-survivor path (already local).

## Local land

| File | Change |
|------|--------|
| `src/utils/sdkReinitRedelivery.ts` | pure `buildReinitSuccessResponse` + `reinitRedeliveryTelemetry` + event name |
| `src/cli/print.ts` | `buildSdkInitializeResponse` (densable `inl`); reinit branch success redelivery + telemetry |
| Host / schema | already HAVE (214) |

tests: `sdkReinitRedelivery.216.test.ts` (+ host `remoteSessionPermissionRace214.test.ts`)

## N/A surface

CCR / claude.ai web UI chrome is Anthropic cloud product — not this CLI repo. Landable 1:1 is the **SDK print reinit contract** shared by web host + local remote session manager.
