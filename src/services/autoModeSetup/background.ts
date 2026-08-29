/**
 * densable llg / Ly0 / Ny0 — background auto-mode-setup after wizard.
 * Gold: gold-wide-llg.txt · gold-wide-Ny0.txt · gold-wide-Dag.txt
 */
import type { ToolPermissionContext } from '../../Tool.js'
import type { RequestDialog } from '../../dialog/requestDialog.js'
import {
  autoModeFlaggedAllowSpec,
  autoModeSetupReviewSpec,
} from '../../dialog/specs/jsuKinds.js'
import type { SetAppState } from '../../Task.js'
import {
  finishAutoModeScanTask,
  registerAutoModeScanTask,
} from '../../tasks/AutoModeScanTask/AutoModeScanTask.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { createSystemMessage } from '../../utils/messages.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import type { AutoModeSetupAnswers } from './answers.js'
import { answersToReconFlags } from './answers.js'
import {
  proposeAutoModeSetup,
  type ProposeAutoModeSetupResult,
} from './propose.js'
import {
  formatAutoModeSavedMessage,
  proposalToAutoModeWrite,
  saveAutoModeSetup,
  type AutoModeWriteResult,
} from './write.js'

const AUTO_MODE_SETUP_FEATURE = 'auto_mode_setup_wizard'

/** densable uBo / rWs — wrapping-up latch while llg runs after scan completes */
let autoModeSetupWrappingUp = false

/** densable alg / rWs */
export function isAutoModeSetupWrappingUp(): boolean {
  return autoModeSetupWrappingUp
}

function setAutoModeSetupWrappingUp(value: boolean): void {
  autoModeSetupWrappingUp = value
}

/** densable Ss(...) → tip createSystemMessage */
type AppendSystemMessage = (msg: ReturnType<typeof createSystemMessage>) => void

export type BackgroundAutoModeSetupArgs = {
  answers: AutoModeSetupAnswers
  mode: 'append' | 'replace'
  permissionContext: ToolPermissionContext
  setAppState: SetAppState
  requestDialog: RequestDialog
  appendSystemMessage?: AppendSystemMessage
  storageV5?: unknown
  credentials?: unknown
  propose?: typeof proposeAutoModeSetup
  write?: typeof saveAutoModeSetup
}

function appendNotice(
  append: AppendSystemMessage | undefined,
  content: string,
  level: 'notice' | 'warning',
): void {
  append?.(createSystemMessage(content, level))
}

/**
 * densable N6t — resolved event plus the feature funnel tail:
 * `Ee`/`pe`/`be` → tengu_feature_ok / _bad / _sad. Error carries the step,
 * every other non-saved choice carries the choice itself.
 */
function logWizardResolved(choice: string, step: string, mode?: string): void {
  logEvent('tengu_auto_mode_setup_wizard_resolved', {
    choice:
      choice as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    step: step as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(mode !== undefined && {
      mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
  })
  if (choice === 'saved') {
    logEvent('tengu_feature_ok', {
      feature_name:
        AUTO_MODE_SETUP_FEATURE as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } else if (choice === 'error') {
    logEvent('tengu_feature_bad', {
      feature_name:
        AUTO_MODE_SETUP_FEATURE as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        step as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } else {
    logEvent('tengu_feature_sad', {
      feature_name:
        AUTO_MODE_SETUP_FEATURE as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        choice as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
}

/**
 * densable llg — fire-and-forget wrapper with crash telemetry.
 */
export async function runBackgroundAutoModeSetup(
  args: BackgroundAutoModeSetupArgs,
): Promise<void> {
  setAutoModeSetupWrappingUp(true)
  try {
    await runBackgroundAutoModeSetupInner(args)
  } catch (err) {
    appendNotice(
      args.appendSystemMessage,
      `Auto-mode setup hit an unexpected error and stopped: ${errorMessage(err)}. Re-run /auto-mode-setup to try again.`,
      'warning',
    )
    logError(err)
    logWizardResolved('error', 'background_crash')
  } finally {
    setAutoModeSetupWrappingUp(false)
  }
}

/** densable Ly0 */
async function runBackgroundAutoModeSetupInner(
  args: BackgroundAutoModeSetupArgs,
): Promise<void> {
  const abort = new AbortController()
  const gathersFromGitHubOrg = answersToReconFlags(args.answers).allProjects
  const taskId = registerAutoModeScanTask(args.setAppState, {
    abortController: abort,
    gathersFromGitHubOrg,
  })
  try {
    await runBackgroundAutoModeSetupScan(args, taskId, abort)
  } finally {
    // densable finally lhs(..., "failed") only if still running
    finishAutoModeScanTask(taskId, args.setAppState, 'failed')
  }
}

/** densable Ny0 */
async function runBackgroundAutoModeSetupScan(
  args: BackgroundAutoModeSetupArgs,
  taskId: string,
  abort: AbortController,
): Promise<void> {
  const propose = args.propose ?? proposeAutoModeSetup
  const write = args.write ?? saveAutoModeSetup

  let result: ProposeAutoModeSetupResult
  try {
    result = await propose(args.answers, args.permissionContext, abort.signal, {
      // gold storageV5 / credentials slots — tip gather ignores storageV5 host
    })
  } catch (err) {
    logError(err)
    result = {
      ok: false,
      code: 'api_failed',
      reason:
        "The model call didn't complete. This is usually temporary — re-run /auto-mode-setup to try again.",
    }
  }

  if (!result.ok) {
    if (result.code === 'aborted' || abort.signal.aborted) {
      logWizardResolved('cancel', 'background_scan')
      return
    }
    finishAutoModeScanTask(taskId, args.setAppState, 'failed')
    appendNotice(
      args.appendSystemMessage,
      `Auto-mode setup scan failed: ${result.reason}`,
      'warning',
    )
    logWizardResolved('error', 'background_scan')
    return
  }

  if (abort.signal.aborted) {
    logWizardResolved('cancel', 'background_scan')
    return
  }

  finishAutoModeScanTask(taskId, args.setAppState, 'completed')

  const review = await args.requestDialog(
    autoModeSetupReviewSpec,
    { ...result.proposal, mode: args.mode },
    { queueBehind: true },
  )

  if (review !== 'accept') {
    appendNotice(
      args.appendSystemMessage,
      'Auto-mode proposal discarded — nothing was saved. Re-run /auto-mode-setup anytime.',
      'notice',
    )
    logWizardResolved(
      review === 'decline' ? 'decline' : 'cancel',
      'background_review',
    )
    return
  }

  let saved: AutoModeWriteResult
  try {
    saved = await write(
      {
        mode: args.mode,
        autoMode: proposalToAutoModeWrite(result.proposal),
      },
      args.storageV5,
    )
  } catch (err) {
    appendNotice(
      args.appendSystemMessage,
      `Auto-mode setup couldn't save: ${errorMessage(err)}. Re-run /auto-mode-setup to try again.`,
      'warning',
    )
    logWizardResolved('error', 'background_write')
    return
  }

  let removal = { removed: 0, skipped: 0, notFound: 0 }
  const flagged = result.proposal.remove_from_permissions_allow
  if (flagged.length > 0) {
    const flaggedResult = await args.requestDialog(
      autoModeFlaggedAllowSpec,
      { flagged, runId: taskId },
      { queueBehind: true },
    )
    const toRemove =
      flaggedResult === 'cancelled'
        ? []
        : flaggedResult.toRemove.filter(r => flagged.includes(r))
    if (toRemove.length > 0) {
      try {
        const rem = await write(
          { removeFromPermissionsAllow: toRemove },
          args.storageV5,
        )
        removal = {
          removed: rem.permissionsAllowRemoved.length,
          skipped: rem.permissionsAllowSkipped ? toRemove.length : 0,
          notFound: rem.permissionsAllowNotFound.length,
        }
      } catch (err) {
        appendNotice(
          args.appendSystemMessage,
          `${formatAutoModeSavedMessage(saved, { removed: 0, skipped: 0 })}\nNote: removing the flagged permissions.allow entries failed: ${errorMessage(err)}`,
          'warning',
        )
        logWizardResolved('saved', 'background_write', args.mode)
        return
      }
    }
  }

  appendNotice(
    args.appendSystemMessage,
    formatAutoModeSavedMessage(saved, removal),
    'notice',
  )
  logWizardResolved('saved', 'background', args.mode)
}
