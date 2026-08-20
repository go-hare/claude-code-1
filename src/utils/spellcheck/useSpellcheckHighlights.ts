/**
 * densable 2.1.235 #1 — mhg: underline misspelled prompt words as you type.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { TextHighlight } from '../textHighlighting.js'
import { isScreenReaderModeEnabled } from '../screenReaderGate.js'
import { logForDebugging } from '../debug.js'
import {
  disposeSpellcheckChecker,
  getOrCreateSpellcheckChecker,
  type SpellcheckChecker,
} from './checker.js'
import { DEFAULT_SPELLCHECK_COLOR, normalizeSpellcheckColor } from './color.js'
import {
  isSpellcheckCheckerName,
  isSpellcheckLanguageName,
  normalizeSpellcheckChecker,
  SPELLCHECK_CHECKERS,
} from './protocol.js'
import {
  emitSpellcheckSettingsWarnings,
  resolveSpellcheckSettings,
} from './settings.js'
import { tokenizeSpellcheckWords } from './tokenize.js'

/** densable KuE / YuE / JuE */
const REQUEST_DEBOUNCE_MS = 250
const SPELLCHECK_HIGHLIGHT_PRIORITY = 2
const TRAILING_APOSTROPHE_RE = /^['’]*$/

export type SpellcheckPlaceholder = {
  index: number
  match: string
}

export type UseSpellcheckHighlightsArgs = {
  text: string
  cursorOffset: number
  active: boolean
  placeholders?: SpellcheckPlaceholder[]
}

const EMPTY_HIGHLIGHTS: TextHighlight[] = []
const EMPTY_VERDICTS = {
  isMisspelled: (_word: string): boolean | undefined => undefined,
}

/** densable fhg — overlap-test against the *pre-merge base* only. */
function mergeNonOverlapping(
  base: TextHighlight[],
  extra: TextHighlight[],
): TextHighlight[] {
  if (extra.length === 0) return base
  const out = [...base]
  for (const h of extra) {
    if (!base.some(o => h.start < o.end && h.end > o.start)) out.push(h)
  }
  return out
}

/**
 * densable mhg — returns TextHighlight[] with underline + color for misspellings.
 * Skips words still being typed (cursor at end + only apostrophes after).
 */
export function useSpellcheckHighlights({
  text,
  cursorOffset,
  active,
  placeholders = [],
}: UseSpellcheckHighlightsArgs): TextHighlight[] {
  const hostRef = useRef<object | null>(null)
  if (hostRef.current === null) hostRef.current = {}
  const host = hostRef.current

  // getSettingsForSource is process-cached; cheap to re-read each render.
  const live = resolveSpellcheckSettings()

  useEffect(() => {
    emitSpellcheckSettingsWarnings(host, live)
  }, [host, live.block, live.source, live.enabled])

  const enabled = live.enabled
  const checkerSetting = (enabled && live.block?.checker?.trim()) || undefined
  const languageSetting = (enabled && live.block?.language?.trim()) || undefined
  const colorSetting = enabled ? live.block?.color : undefined

  const checker = useMemo(() => {
    const normalized = normalizeSpellcheckChecker(checkerSetting)
    if (
      checkerSetting !== undefined &&
      checkerSetting !== 'auto' &&
      !isSpellcheckCheckerName(checkerSetting)
    ) {
      logForDebugging(
        `[spellcheck] unknown spellcheck.checker "${checkerSetting}"; looking for ${SPELLCHECK_CHECKERS.join(', ')} instead`,
      )
    }
    return normalized
  }, [checkerSetting])

  const language = useMemo(() => {
    if (languageSetting === undefined) return undefined
    if (isSpellcheckLanguageName(languageSetting)) return languageSetting
    logForDebugging(
      `[spellcheck] ignoring spellcheck.language "${languageSetting}": not a plain dictionary name`,
    )
    return undefined
  }, [languageSetting])

  const color = useMemo(() => {
    if (colorSetting === undefined) return DEFAULT_SPELLCHECK_COLOR
    const next = normalizeSpellcheckColor(colorSetting)
    // densable edE logs when falling back to theme error color
    if (next === DEFAULT_SPELLCHECK_COLOR) {
      const trimmed = colorSetting.trim().replace(/\s+(?=[^()]*\))/g, '')
      const acceptedAsError =
        trimmed.toLowerCase() === 'error' ||
        trimmed.toLowerCase() === 'ansi:error'
      if (!acceptedAsError) {
        logForDebugging(
          `[spellcheck] ignoring unrecognized spellcheck.color "${colorSetting}"; using the theme's error color`,
        )
      }
    }
    return next
  }, [colorSetting])

  const [instance, setInstance] = useState<SpellcheckChecker | undefined>(() =>
    enabled ? getOrCreateSpellcheckChecker(host, checker, language) : undefined,
  )

  useEffect(() => {
    if (enabled) {
      setInstance(getOrCreateSpellcheckChecker(host, checker, language))
    } else {
      disposeSpellcheckChecker(host)
      setInstance(undefined)
    }
  }, [enabled, host, checker, language])

  useEffect(
    () => () => {
      disposeSpellcheckChecker(host)
    },
    [host],
  )

  const getVerdicts = useMemo(
    () => (instance ? () => instance.verdicts : () => EMPTY_VERDICTS),
    [instance],
  )
  const verdicts = useSyncExternalStore(
    instance ? instance.changed.subscribe : () => () => {},
    getVerdicts,
  )

  const screenReader = isScreenReaderModeEnabled()

  const words = useMemo(() => {
    if (!instance || !active || screenReader) return []
    const spans = tokenizeSpellcheckWords(text)
    if (placeholders.length === 0) return spans
    return spans.filter(
      span =>
        !placeholders.some(
          p => span.start < p.index + p.match.length && span.end > p.index,
        ),
    )
  }, [instance, active, screenReader, text, placeholders])

  const isStillTyping = useCallback(
    (span: { end: number }) =>
      cursorOffset >= span.end &&
      TRAILING_APOSTROPHE_RE.test(text.slice(span.end, cursorOffset)),
    [text, cursorOffset],
  )

  const unknownJoined = useMemo(
    () =>
      words
        .filter(
          span =>
            !isStillTyping(span) &&
            verdicts.isMisspelled(span.word) === undefined,
        )
        .map(span => span.word)
        .join('\n'),
    [words, verdicts, isStillTyping],
  )

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestDebounced = useMemo(() => {
    const fn = (payload: string) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null
        instance?.request(payload.split('\n'))
      }, REQUEST_DEBOUNCE_MS)
    }
    fn.cancel = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
    }
    return fn
  }, [instance])

  useEffect(() => {
    if (unknownJoined) requestDebounced(unknownJoined)
    else requestDebounced.cancel()
    return () => requestDebounced.cancel()
  }, [unknownJoined, text, instance, requestDebounced])

  return useMemo(() => {
    const highlights: TextHighlight[] = []
    for (const span of words) {
      if (isStillTyping(span)) continue
      if (verdicts.isMisspelled(span.word) === true) {
        highlights.push({
          start: span.start,
          end: span.end,
          color,
          underline: true,
          priority: SPELLCHECK_HIGHLIGHT_PRIORITY,
        })
      }
    }
    return highlights.length > 0 ? highlights : EMPTY_HIGHLIGHTS
  }, [words, verdicts, isStillTyping, color])
}

export { mergeNonOverlapping as mergeSpellcheckHighlights }
