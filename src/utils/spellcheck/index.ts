export {
  SPELLCHECK_CHECKERS,
  SPELLCHECK_LANGUAGE_RE,
  SPELLCHECK_TERSE_HANDSHAKE,
  buildSpellcheckArgs,
  formatSpellcheckRequest,
  isSpellcheckCheckerName,
  isSpellcheckLanguageName,
  normalizeSpellcheckChecker,
  parseSpellcheckBanner,
  parseSpellcheckResponseLine,
  type SpellcheckCheckerName,
  type SpellcheckCheckerOrAuto,
  type SpellcheckResponseLine,
} from './protocol.js'
export { tokenizeSpellcheckWords, type SpellcheckWordSpan } from './tokenize.js'
export {
  DEFAULT_SPELLCHECK_COLOR,
  isValidSpellcheckColorValue,
  normalizeSpellcheckColor,
} from './color.js'
export {
  SpellcheckChecker,
  disposeSpellcheckChecker,
  getOrCreateSpellcheckChecker,
  resolveSpellcheckCommand,
  type ResolvedSpellcheckCommand,
  type SpellcheckVerdicts,
} from './checker.js'
export {
  emitSpellcheckSettingsWarnings,
  resolveSpellcheckSettings,
  warnSpellcheckOnce,
  type ResolvedSpellcheckSettings,
  type SpellcheckSettingsBlock,
} from './settings.js'
export {
  mergeSpellcheckHighlights,
  useSpellcheckHighlights,
  type SpellcheckPlaceholder,
  type UseSpellcheckHighlightsArgs,
} from './useSpellcheckHighlights.js'
