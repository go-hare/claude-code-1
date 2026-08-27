/**
 * densable idm / Mrf — IDE diff as doo claim racer (not React-owned).
 */
import { randomUUID } from 'crypto'
import { basename } from 'path'
import type { Tool, ToolUseContext } from '../Tool.js'
import { logEvent } from '../services/analytics/index.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import {
  applyIdeEditsToToolInput,
  type IdeDiffEligibility,
} from './ideDiffEligibility.js'
import {
  clearIdeDiffRacerCloseTab,
  setIdeDiffRacerCloseTab,
} from './ideDiffRacerRegistry.js'
import {
  closeTabInIDE,
  computeEditsFromContents,
  showDiffInIDE,
} from '../hooks/useDiffInIDE.js'

export type IdeDiffRacerInput = {
  toolUseID: string
  tool: Tool
  input: Record<string, unknown>
  toolUseContext: ToolUseContext
  eligibility: IdeDiffEligibility
  /** densable localDisplayOnly → noop closeTab, no openDiff */
  localDisplayOnly?: boolean
  claim: () => boolean
  dismissAndTeardown: () => void
  notifyBridge?: (msg: {
    behavior: 'allow' | 'deny'
    updatedInput?: Record<string, unknown>
    message?: string
  }) => void
  resolveAllow: (updatedInput: Record<string, unknown>) => void
  resolveDeny: () => void
}

export type IdeDiffRacerHandle = {
  closeTab: () => void
}

export {
  getIdeDiffRacerCloseTab,
  hasIdeDiffRacer,
  subscribeIdeDiffRacers,
} from './ideDiffRacerRegistry.js'

/**
 * densable Mrf — start IDE diff racer; returns closeTab for addTeardown.
 */
export function startIdeDiffRacer(
  input: IdeDiffRacerInput,
): IdeDiffRacerHandle {
  if (input.localDisplayOnly === true) {
    return { closeTab: () => {} }
  }

  const {
    toolUseID,
    tool,
    input: toolInput,
    toolUseContext,
    eligibility,
    claim,
    dismissAndTeardown,
    notifyBridge,
    resolveAllow,
    resolveDeny,
  } = input

  const { filePath, edits, ideClient, ideName } = eligibility
  const tabName = `✻ [Claude Code] ${basename(filePath)} (${randomUUID().slice(0, 6)}) ⧉`
  let closed = false

  function closeTab(): void {
    if (closed) return
    closed = true
    clearIdeDiffRacerCloseTab(toolUseID)
    void closeTabInIDE(tabName, ideClient).catch(err => {
      logForDebugging(`closeTabInIDE failed: ${errorMessage(err)}`)
    })
  }

  setIdeDiffRacerCloseTab(toolUseID, closeTab)

  logEvent('tengu_ext_will_show_diff', {
    ideName,
    toolName: tool.name,
    editCount: edits.length,
  } as never)

  void showDiffInIDE(filePath, edits, toolUseContext, tabName, () => closed)
    .then(({ oldContent, newContent }) => {
      const newEdits = computeEditsFromContents(
        filePath,
        oldContent,
        newContent,
        'single',
      )
      if (newEdits.length === 0) {
        // densable: reject via IDE
        if (closed || !claim()) return
        closeTab()
        logEvent('tengu_ext_diff_rejected', {} as never)
        notifyBridge?.({
          behavior: 'deny',
          message: 'User denied via IDE',
        })
        dismissAndTeardown()
        resolveDeny()
        return
      }
      if (closed || !claim()) return
      closeTab()
      const updatedInput = applyIdeEditsToToolInput(tool, toolInput, newEdits)
      logEvent('tengu_ext_diff_accepted', {} as never)
      notifyBridge?.({
        behavior: 'allow',
        updatedInput,
        message: undefined,
      })
      dismissAndTeardown()
      resolveAllow(updatedInput)
    })
    .catch(err => {
      if (closed || toolUseContext.abortController.signal.aborted) return
      logForDebugging(`IDE diff view failed: ${errorMessage(err)}`)
    })

  return { closeTab }
}
