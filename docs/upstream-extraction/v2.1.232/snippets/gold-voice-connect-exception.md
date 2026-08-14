# densable 2.1.232 #23 — voice connection refused shows immediately

## Changelog

> Voice mode: connection refusals surface immediately instead of sitting in listening

## densable gold (SEA)

```js
// connectVoiceStream(...).then(onOk, onReject)
// onReject:
//   He(Hn(Be))
//   fe("voice_stream_connect","voice_stream_connect_exception")
//   if (stale || state!=="recording") return
//   Bao() // early failure circuit
//   p.current("Voice connection failed. Check your network and try again.")
//   cleanup; W("idle")

// M5h empty-transcript after finalize:
function M5h({ hadAudioSignal: e, wsConnected: t }) {
  if (!e)
    return {
      message: 'No audio detected from microphone...',
      errorCode: 'voice_transcription_no_audio_signal',
    }
  if (!t)
    return {
      message: 'Voice connection failed. Check your network and try again.',
      errorCode: 'voice_transcription_connection_failed',
    }
  return {
    message: 'No speech detected.',
    errorCode: 'voice_transcription_no_speech',
  }
}
```

## Local

| densable | local |
| -------- | ----- |
| connect `.catch` | `useVoice.ts` `attemptConnect` promise `.catch` → error + idle |
| `M5h` | `formatEmptyVoiceTranscriptError` |
| `Bao` | `recordVoiceEarlyFailure` |

- Tests: `src/hooks/__tests__/formatEmptyVoiceTranscriptError.232.test.ts`
