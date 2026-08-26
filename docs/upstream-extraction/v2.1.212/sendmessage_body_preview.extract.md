# densable 2.1.212 — #38 SendMessage bodies not duplicated into history / tool results

Changelog:

> Reduced token usage in inter-agent messaging: `SendMessage` bodies are no longer duplicated into replayed history and tool results

## densable symbols

| densable | role |
|----------|------|
| `Bs(e,t,r=!1)` | width-aware truncate (+ optional first-line); `Bs(text, 50)` for previews |
| `mi` | grapheme truncate with `…` |
| `vKg` | unicast mailbox send |
| `xKg` | `SendMessageTool` |
| `De` | `JSON.stringify` for tool_result text |

### Unicast success payload (vKg)

```js
return {
  data: {
    success: true,
    message: `Message sent to ${e}'s inbox`,
    msg_id: d,
    routing: {
      sender: c,
      senderColor: u,
      target: `@${e}`,
      targetColor: p,
      summary: r,
      content: Bs(t, 50), // NOT full body
    },
  },
}
```

Mailbox still receives full `text: t` via `JA` / `writeToMailbox`.

### backfillObservableInput (xKg)

```js
if (typeof e.message === 'string')
  (e.type = 'message'), (e.recipient = e.to), (e.content = Bs(e.message, 50))
// structured reason/feedback also Bs(r, 50)
```

### mapToolResultToToolResultBlockParam

```js
mapToolResultToToolResultBlockParam(e, t) {
  return {
    tool_use_id: t,
    type: 'tool_result',
    content: [{ type: 'text', text: De(e) }], // stringifies data (already previewed)
  }
}
```

## Local alignment

| densable | local | status |
|----------|-------|--------|
| `Bs(t,50)` on routing | `handleMessage` / `handleBroadcast` `content: truncate(content, 50)` | **HAVE** |
| backfill `Bs(…,50)` | `backfillObservableInput` | **HAVE** |
| mapToolResult stringify | existing `jsonStringify(data)` | **HAVE** |
| full body only in mailbox | `writeToMailbox({ text: content })` unchanged | **HAVE** |

## Related files

- `packages/builtin-tools/src/tools/SendMessageTool/SendMessageTool.ts`
- `packages/builtin-tools/src/tools/SendMessageTool/__tests__/sendMessageBodyPreview.212.test.ts`
- `src/utils/truncate.ts` (`truncate` ≈ densable `Bs`)
