/**
 * densable J7t / m3r / f7n / f3r focus-view residual.
 *
 * viewMode:"focus" (settings) or session briefTranscript controls the
 * brief/focus transcript surface. Session state is mirrored in module-level
 * EYc (setSessionBriefTranscript) so prompts/settings can read without AppState.
 */
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { getInitialSettings, getSettingsForSource } from './settings/settings.js'

/** densable sog — tip id suffixes cleared on focus toggle. */
const FOCUS_MODE_TIP_SUFFIXES = ['', ':L'] as const

/**
 * densable J7t-shaped predicate for settings + session seed:
 * - viewMode set → only "focus" is active
 * - else → Boolean(briefTranscript)
 */
export function isFocusViewActive(
  viewMode: string | undefined | null,
  briefTranscript: boolean | undefined | null,
): boolean {
  if (viewMode) return viewMode === 'focus'
  return Boolean(briefTranscript)
}

/**
 * densable main residual:
 *   B = a.verbose ?? (q ? q === "verbose" : j ? false : config.verbose)
 */
export function resolveVerboseFromViewMode(opts: {
  cliVerbose: boolean | undefined
  viewMode: string | undefined | null
  briefTranscript: boolean | undefined | null
  configVerbose: boolean | undefined
}): boolean {
  if (opts.cliVerbose !== undefined) return opts.cliVerbose
  if (opts.viewMode) return opts.viewMode === 'verbose'
  if (isFocusViewActive(opts.viewMode, opts.briefTranscript)) return false
  return Boolean(opts.configVerbose)
}

/** densable EYc — session-scoped briefTranscript mirror (m3r / f7n). */
let sessionBriefTranscript: boolean | undefined

/** densable m3r */
export function setSessionBriefTranscript(value: boolean): void {
  sessionBriefTranscript = value
}

/** densable f7n */
export function getSessionBriefTranscript(): boolean | undefined {
  return sessionBriefTranscript
}

/**
 * densable focus system-prompt gate:
 * - Non-interactive: only when flag/settings viewMode === "focus"
 * - Interactive: viewMode wins when set; else session briefTranscript (J7t)
 */
export function resolveFocusViewActiveFromSession(opts: {
  nonInteractive: boolean
}): boolean {
  if (opts.nonInteractive) {
    const flag =
      getSettingsForSource('flagSettings')?.viewMode ??
      getInitialSettings().viewMode
    return flag === 'focus'
  }
  const settings = getInitialSettings()
  return isFocusViewActive(
    settings.viewMode,
    sessionBriefTranscript ?? settings.briefTranscript,
  )
}

/**
 * densable f3r — drop focus_mode / focus_mode:L tip history entries on toggle.
 */
export function clearFocusModeTips(): void {
  saveGlobalConfig(c => {
    const history = c.tipsHistory
    if (!history) return c
    let changed = false
    const next = { ...history }
    for (const suffix of FOCUS_MODE_TIP_SUFFIXES) {
      const key = `focus_mode${suffix}`
      if (key in next) {
        delete next[key]
        changed = true
      }
    }
    if (!changed) return c
    return { ...c, tipsHistory: next }
  })
  // Touch read path so unused-import analyzers keep getGlobalConfig pairing.
  void getGlobalConfig().tipsHistory
}
