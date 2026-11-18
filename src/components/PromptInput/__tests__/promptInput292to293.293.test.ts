import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyPluginAutocompleteReplacement,
  inlinePasteVariants,
  mapPluginAutocompleteSuggestions,
  matchesWithCombiningMarks,
} from '../PromptInput.js'
import {
  isWithinSameChunk,
  markSameChunkInput,
  SAME_CHUNK_WINDOW_MS,
} from '../../../hooks/useTextInput.js'
import {
  isDaemonShutdownSignaled,
  markDaemonShutdownSignaled,
  resetDaemonShutdownSignaled,
} from '../../../daemon/state.js'
import {
  FOCUS_TIP_ACTIVE,
  FOCUS_TIP_INVITE,
  FOCUS_TIP_MAX_SHOWS,
} from '../../../utils/focusView.js'

describe('Wave 4B #196, #262, #310, #312, #314, #315, #316, #384 alignments', () => {
  test('#196 mapPluginAutocompleteSuggestions & applyPluginAutocompleteReplacement', () => {
    const items = mapPluginAutocompleteSuggestions(
      [{ text: '#123', label: 'Issue\n#123', description: 'Fix bug' }],
      4,
    )
    expect(items).toEqual([
      {
        id: 'autocomplete-0-#123',
        displayText: 'Issue #123',
        description: 'Fix bug',
        metadata: {
          __pluginAutocomplete: true,
          autocompleteText: '#123',
          start: 4,
        },
      },
    ])
    expect(
      applyPluginAutocompleteReplacement(
        { text: 'see #12', cursor: 7 },
        '#123',
        4,
      ),
    ).toEqual({ text: 'see #123', cursor: 8 })
  })

  test('#314 sameChunk tracking stays true in microtask & within 150ms', async () => {
    expect(SAME_CHUNK_WINDOW_MS).toBe(150)
    const token = {}
    expect(isWithinSameChunk(token)).toBe(false)
    markSameChunkInput(token)
    expect(isWithinSameChunk(token)).toBe(true)
    await Promise.resolve()
    expect(isWithinSameChunk(token)).toBe(true)
  })

  test('#315 matchesWithCombiningMarks & inlinePasteVariants preserve skill paste after accent merge', () => {
    const pastedSkill = '/cafe'
    const withAccent = '/cafe\u0301'
    const nfc = withAccent.normalize('NFC')
    expect(inlinePasteVariants(withAccent)).toContain(nfc)
    // When needle ends with combining mark and haystack has base + combining mark
    expect(matchesWithCombiningMarks('/cafe\u0301', '/cafe\u0301')).toBe(true)
    expect(matchesWithCombiningMarks('/cafe', pastedSkill)).toBe(false)
  })

  test('#262 focusView exports official tip constants', () => {
    expect(FOCUS_TIP_INVITE).toBe(
      'Just want the answer? Run /focus now to hide the steps along the way',
    )
    expect(FOCUS_TIP_ACTIVE).toBe(
      'Focus view is on and the steps are hidden. Run /focus to show them',
    )
    expect(FOCUS_TIP_MAX_SHOWS).toBe(10)
  })

  test('#310 REPL 10s defer timer checks unsent input and pending question', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf-8',
    )
    expect(src).toContain('tengu_defer_cap_cancelled_draft')
    expect(src).toContain('tengu_defer_cap_refused_ask')
    expect(src).toContain('hasPendingQuestionRef.current')
  })

  test('#312 AgentView passes onTransientReadError to listAllJobs', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../screens/AgentView.tsx'),
      'utf-8',
    )
    expect(src).toContain('onTransientReadError')
    expect(src).toContain('if (transientReadError) return;')
  })

  test('#384 daemon shutdown signal state toggles cleanly', () => {
    resetDaemonShutdownSignaled()
    expect(isDaemonShutdownSignaled()).toBe(false)
    markDaemonShutdownSignaled()
    expect(isDaemonShutdownSignaled()).toBe(true)
    resetDaemonShutdownSignaled()
    expect(isDaemonShutdownSignaled()).toBe(false)
  })

  test('#316 FeedbackDrafts locks cancel while submitting and passes abortSignal', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../FeedbackDrafts.tsx'),
      'utf-8',
    )
    expect(src).toContain(
      "isCancelActive={mode !== 'submitting' && !editingText}",
    )
    expect(src).toContain('signal: abortSignal')
  })
})
