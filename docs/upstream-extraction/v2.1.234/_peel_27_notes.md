# densable 2.1.234 #27 — permission preview 仅信任 inbound channel

> Changelog: *Fixed permission previews relay only to channel servers admitted by inbound trust gate; explicit permission-capability opt-out honored.*

## Gold (SEA)

| Symbol | Role |
|--------|------|
| `s3r` / `t3r` | `!!experimental[key]` — explicit `false` is opt-out |
| `Yrf(clients, t, r)` | connected + `--channels` + both caps + `r(name)` + `protocolEra!=="modern"` |
| `Xrf(isServerRegistered)` | pending map + registered-set predicate |
| `i3r` | capability → era → provider → `QJe` → `Kir` → session → marketplace → allowlist |
| `g4n` | org list if set, else ledger (no team/enterprise check) |
| `t2a` | hard revoke: `provider\|disabled\|capability\|era` |
| send site | `Yrf(..., c1t!==void 0, m.isServerRegistered)` |

`g.current.add` on register; hard skip deletes + removes handlers; soft skip + previously registered **preserves** handler.

## Local 1:1

| densable | Local |
|----------|-------|
| `s3r` | `hasExperimentalCapability` |
| `Yrf` | `filterPermissionRelayClients(clients, isInAllowlist, isInboundAdmitted)` |
| `Xrf` | `createChannelPermissionCallbacks(isServerRegistered)` |
| `g.current` | `channelRegisteredServersRef` |
| `i3r` | `gateChannelServer(..., protocolEra?)` |
| `t2a` | `isChannelGateHardRevocation` |
| `Kir` team/enterprise | `isChannelsPolicyBlocked` |
| `M.protocolEra` | `readClientProtocolEra(client)` stamped on both `client.ts` connect objects |

Kept (not invent): builtin `weixin@builtin` always allowlisted. Local `getEffectiveChannelAllowlist` still requires team/enterprise for org replace (stricter than gold `g4n`).

**Not ported:** gold non-Yi `Kir` (`policy!==null && channelsEnabled!==true`) — would block anyone with a policy file. `isChannelsEnabled()` remains always-true (pre-existing residual vs gold `QJe`/`tengu_harbor`).

Invent-ban: no `accountSwitched` / `relaunching` / `gatewayLoginError`.

## Tests

- `channelPermissions.test.ts` — s3r / Yrf inbound + era / Xrf registered-set / `readClientProtocolEra`
- `channelInboundTrust.234.test.ts` — t2a / Kir / allowlist / i3r capability+era

## Residuals (kept, not invent)

- Local `getEffectiveChannelAllowlist` still requires team/enterprise for org replace (stricter than gold `g4n`).
- Gold non-Yi `Kir` not ported.
- `isChannelsEnabled()` remains always-true (pre-existing vs gold `QJe`/`tengu_harbor`).
- `Client` TS type may omit `getProtocolEra`; runtime v2 Client has it. Producer uses optional method, not a Client subclass.

## Status

**HAVE** (targeted). protocolEra producer was missing on connect (verifier FAIL); now stamped via `readClientProtocolEra` at `client.ts` main connect + `setupSdkMcpClients`. ChannelAllowlistSkip literal type unblocks tsc Extract-never.
