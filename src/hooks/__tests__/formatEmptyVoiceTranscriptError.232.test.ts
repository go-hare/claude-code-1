import { describe, expect, test } from 'bun:test'
import { formatEmptyVoiceTranscriptError } from '../useVoice.js'

/**
 * densable 2.1.232 #23 / M5h empty-transcript taxonomy.
 */
describe('formatEmptyVoiceTranscriptError (densable M5h)', () => {
  test('no audio signal first', () => {
    const r = formatEmptyVoiceTranscriptError({
      hadAudioSignal: false,
      wsConnected: false,
    })
    expect(r.errorCode).toBe('voice_transcription_no_audio_signal')
    expect(r.message).toContain('No audio detected from microphone')
  })

  test('audio but no connection → connection failed', () => {
    const r = formatEmptyVoiceTranscriptError({
      hadAudioSignal: true,
      wsConnected: false,
    })
    expect(r.errorCode).toBe('voice_transcription_connection_failed')
    expect(r.message).toBe(
      'Voice connection failed. Check your network and try again.',
    )
  })

  test('connected + audio → no speech', () => {
    const r = formatEmptyVoiceTranscriptError({
      hadAudioSignal: true,
      wsConnected: true,
    })
    expect(r.errorCode).toBe('voice_transcription_no_speech')
    expect(r.message).toBe('No speech detected.')
  })
})
