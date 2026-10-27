import { feature } from 'bun:bundle'
import { useMemo } from 'react'
import { useCommandQueue } from 'src/hooks/useCommandQueue.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { useAppState } from 'src/state/AppState.js'
import { getGlobalConfig } from 'src/utils/config.js'
import { getExampleCommandFromCache } from 'src/utils/exampleCommands.js'
import { isQueuedCommandEditable } from 'src/utils/messageQueueManager.js'
import { isKbCohesionFixesEnabled } from 'src/utils/systemPromptArms.js'
import { truncate } from 'src/utils/truncate.js'

// Dead code elimination: conditional import for proactive mode
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../proactive/index.js')
    : null

type Props = {
  input: string
  submitCount: number
  /** densable qle `hasMessages`. Gold `v<1&&!M&&he` — skip Try after resume. */
  hasMessages?: boolean
  viewingAgentName?: string
}

const NUM_TIMES_QUEUE_HINT_SHOWN = 3
/** densable qle `JWt=20`. */
const MAX_TEAMMATE_NAME_WIDTH = 20

/**
 * densable qle `UGn` — GB `tengu_jiggly_mochi` default false.
 * Do not export minify `UGn`. Not fullscreen.
 */
function leftoverQleJigglyMochi(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_jiggly_mochi', false) === true
  )
}

export function usePromptInputPlaceholder({
  input,
  submitCount,
  hasMessages = false,
  viewingAgentName,
}: Props): string | undefined {
  const queuedCommands = useCommandQueue()
  const promptSuggestionEnabled = useAppState(s => s.promptSuggestionEnabled)
  const queueEditIndex = useAppState(s => s.queueEditIndex)
  const placeholder = useMemo(() => {
    if (input !== '') {
      return
    }

    // densable qle: `Message @${ko(N,JWt)}…` — ko/rt already appends … when
    // truncated; gold still concatenates another … after ko. KEEP that BODY.
    if (viewingAgentName) {
      return `Message @${truncate(viewingAgentName, MAX_TEAMMATE_NAME_WIDTH)}…`
    }

    // densable qle: X.some(uf) then queueEditIndex / EE / UGn / hintCount.
    if (queuedCommands.some(isQueuedCommandEditable)) {
      const editLane =
        queueEditIndex === null
          ? 'none'
          : queueEditIndex === 0
            ? 'oldest'
            : 'newer'
      if (editLane !== 'none') {
        return editLane === 'oldest'
          ? 'Press Enter to edit the selected message, or up again for history'
          : 'Press Enter to edit the selected message, or up again for an older one'
      }
      const kbCohesion = isKbCohesionFixesEnabled()
      if (leftoverQleJigglyMochi()) {
        return kbCohesion
          ? 'Press up to select a queued message to edit, or Enter to send them now'
          : 'Press up to edit queued messages, Enter to send them immediately'
      }
      if (
        (getGlobalConfig().queuedCommandUpHintCount || 0) <
        NUM_TIMES_QUEUE_HINT_SHOWN
      ) {
        return kbCohesion
          ? 'Press up to select a queued message, then Enter to edit it'
          : 'Press up to edit queued messages'
      }
    }

    // densable qle: `if(v<1&&!M&&he)return Slo(q())`. Proactive skip is analog extra KEEP.
    if (
      submitCount < 1 &&
      !hasMessages &&
      promptSuggestionEnabled &&
      !proactiveModule?.isProactiveActive()
    ) {
      return getExampleCommandFromCache()
    }
  }, [
    input,
    queuedCommands,
    queueEditIndex,
    submitCount,
    hasMessages,
    promptSuggestionEnabled,
    viewingAgentName,
  ])

  return placeholder
}
