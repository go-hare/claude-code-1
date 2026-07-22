/**
 * densable /focus residual (v0d / dLy).
 *
 * Toggle focus view (brief transcript): prompt + summary + response.
 * densable gates on Ki() (local: isFullscreenFeatureGateEnabled). When the
 * gate is off, settings viewMode:"focus" cannot be session-toggled; an active
 * session briefTranscript can still be turned off with the fullscreen hint.
 */
import type { ToolUseContext } from '../Tool.js'
import type {
  Command,
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../types/command.js'
import {
  clearFocusModeTips,
  isFocusViewActive,
  setSessionBriefTranscript,
} from '../utils/focusView.js'
import { isFullscreenFeatureGateEnabled } from '../utils/fullscreen.js'
import { getInitialSettings } from '../utils/settings/settings.js'

const FULLSCREEN_HINT =
  'Focus view needs the fullscreen renderer. Run /tui fullscreen to switch (this restarts and resumes your session), or set CLAUDE_CODE_NO_FLICKER=1 and restart.'

const focus = {
  type: 'local-jsx',
  name: 'focus',
  description: 'Toggle focus view: just your prompt, summary, and response',
  immediate: true,
  // densable dLy has requires:{ink:!0}; local Command type has no requires field —
  // fullscreen gate is enforced in call() via isFullscreenFeatureGateEnabled.
  load: () =>
    Promise.resolve({
      async call(
        onDone: LocalJSXCommandOnDone,
        context: ToolUseContext & LocalJSXCommandContext,
      ): Promise<null> {
        const settings = getInitialSettings()
        const appBrief = Boolean(context.getAppState().briefTranscript)

        if (!isFullscreenFeatureGateEnabled()) {
          if (settings.viewMode === 'focus') {
            onDone(
              `Focus view is set by "viewMode": "focus" in settings.json — remove it there and restart Claude Code to turn it off. ${FULLSCREEN_HINT}`,
              { display: 'system' },
            )
            return null
          }
          if (appBrief || isFocusViewActive(settings.viewMode, appBrief)) {
            context.setAppState(prev => {
              if (!prev.briefTranscript) return prev
              return { ...prev, briefTranscript: false }
            })
            setSessionBriefTranscript(false)
            clearFocusModeTips()
            onDone(`Focus view disabled. ${FULLSCREEN_HINT}`, {
              display: 'system',
            })
            return null
          }
          onDone(FULLSCREEN_HINT, { display: 'system' })
          return null
        }

        const next = !appBrief
        context.setAppState(prev => {
          if (prev.briefTranscript === next) return prev
          return { ...prev, briefTranscript: next }
        })
        setSessionBriefTranscript(next)
        clearFocusModeTips()
        onDone(next ? 'Focus view enabled' : 'Focus view disabled', {
          display: 'system',
        })
        return null
      },
    }),
} satisfies Command

export default focus
