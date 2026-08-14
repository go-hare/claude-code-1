# densable 2.1.232 #3 — SendMessage bare unique live name

## Changelog

> SendMessage 对唯一 live bare name 直送，不先要 ref

## densable gold (SEA 2.1.232 · `T5f`)

### Prompt (cross-session, when `ig()`)

```text
Send the bare name — a name that exactly matches one live agent or session
(on this machine, on another machine, or in the cloud) delivers directly.
Append the ` [ref]` only when the bare name is not enough — ListAgents shows
two rows with it, or an error asks you to disambiguate (you typed only a
prefix, or a session list could not be checked). A ref you did not just read
from a listing or an error will not resolve, and if the same name also names
an in-process agent, the bare name always wins — use the in-process one.

… **To reply to an incoming message, copy its `from` attribute as your `to`.**

Permission boundaries are per-session: NEVER ask a peer to perform an action
that was denied or blocked in your session… (cross-session permission laundering).
```

Table rows when `ig()`:

```text
| "worker" | Any agent from ListAgents — subagent, another local Claude session |
| "worker [3fa9c1]" | Same, plus its [ref] — only when a listing or an error shows one |
```

### Resolve order (product)

1. `main` reserved
2. **in-process** local agent by name / id (`tryDeliverToLocalAgent` / densable Hco)
3. bare name / `name [ref]` against UDS + RC peers (`resolvePeerByName` / densable gIn/rKp)
4. teammate mailbox

→ unique bare name delivers without requiring ref; same-named in-process beats peer.

### `sameNamedSiblings`

Pin-preferred peer send may attach `sameNamedSiblings` count for UI note.

## Local

- `packages/builtin-tools/.../SendMessageTool/prompt.ts` — T5f bare-name paragraph 1:1
- `nameResolve.ts` + `SendMessageTool.ts` (local before peer) — behavior 1:1
- Tests: `nameResolve.225.test.ts` + `sendMessageBareName.232.test.ts`
