# densable 2.1.232 #26 — stream idle timeout recoverable

## Changelog

> Stream idle timeouts on Bedrock / Vertex / gateway are now recoverable

## densable gold (SEA)

```js
// YLr error taxonomy
if (P5p(e) || (e instanceof Error && e.message.startsWith('Stream idle timeout')))
  return 'api_timeout'

// P5p
function P5p(e) {
  return (
    e instanceof jNe /* APIConnectionTimeoutError */ ||
    (e instanceof Rx /* APIConnectionError */ &&
      e.message.toLowerCase().includes('timeout'))
  )
}

// Logging treats api_timeout like connection_error / rate_limit (after retries)
// Byte watchdog: sPp/Zgc master; ewa firstParty||anthropicAws; aPp bedrock opt-in
```

## Local

| densable | local |
| -------- | ----- |
| `YLr` stream-idle arm | `classifyAPIError` startsWith `Stream idle timeout` + `BodyIdleTimeoutError` |
| `P5p` | existing timeout / APIConnectionTimeoutError arms |
| byte watchdog providers | `streamWatchdogGates.ts` |

- Tests: `src/services/api/__tests__/classifyAPIError.streamIdle.232.test.ts`
