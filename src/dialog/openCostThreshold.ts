/**
 * densable oXg(Gm, Wxt) / LZh — open cost_threshold via NMs when gates pass.
 *
 * Gold: if await e(Wxt,{})==="cancelled" return; else latch + analytics.
 */
import { logEvent } from '../services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import type { DialogStore } from './dialogStore.js'
import type { RequestDialog } from './requestDialog.js'
import { COST_THRESHOLD_KIND, costThresholdSpec } from './specs/jsuKinds.js'

export function isCostThresholdDialog(kind: string | undefined): boolean {
  return kind === COST_THRESHOLD_KIND
}

/**
 * Open cost_threshold if not already ack'd / already open.
 * Esc/dismiss → cancelled → no latch (densable oXg).
 */
export async function openCostThresholdIfNeeded(opts: {
  requestDialog: RequestDialog
  dialogStore: DialogStore
}): Promise<'opened' | 'skipped'> {
  const { requestDialog, dialogStore } = opts
  if (getGlobalConfig().hasAcknowledgedCostThreshold) return 'skipped'
  if (dialogStore.getState().open.some(d => d.kind === COST_THRESHOLD_KIND)) {
    return 'skipped'
  }
  const result = await requestDialog(costThresholdSpec, {})
  if (result === 'cancelled') return 'opened'
  saveGlobalConfig(current =>
    current.hasAcknowledgedCostThreshold
      ? current
      : { ...current, hasAcknowledgedCostThreshold: true },
  )
  logEvent('tengu_cost_threshold_acknowledged', {})
  return 'opened'
}
