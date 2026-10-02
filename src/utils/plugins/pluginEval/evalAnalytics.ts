/**
 * densable `ag` / `cg` — per-run plugin-eval analytics.
 * Gold `_`(name) = success event; `p`/`m`(name, outcome) = event + outcome.
 */
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../../services/analytics/index.js'
import { MOCK_AGENT_FAILED } from './agentMock.js'
import type { RunArm } from './types.js'

const OUTCOME = (
  value: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS =>
  value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

function logNamed(eventName: string, outcome?: string): void {
  if (outcome === undefined) {
    logEvent(eventName, {})
    return
  }
  logEvent(eventName, { outcome: OUTCOME(outcome) })
}

/**
 * densable `ag(grant, arm, {published, errored})`.
 * Skip when the run is ungranted or the without-plugin arm.
 */
export function logEvalArtifactPublish(
  grant: { granted: boolean },
  arm: RunArm | undefined,
  result: { published: boolean; errored: boolean },
): void {
  if (!grant.granted || arm === 'without') return
  if (result.published) logNamed('cli_plugin_eval_artifact_publish')
  else if (result.errored) {
    logNamed('cli_plugin_eval_artifact_publish', 'run_errored')
  } else logNamed('cli_plugin_eval_artifact_publish', 'no_publish')
}

/**
 * densable `cg(run)`. Gold `rpe` is `MOCK_AGENT_FAILED` (relay_internal prefix),
 * not `fbt`.
 */
export function logEvalMocks(run: {
  mockSetupFailure: string | null
  aborted: { reason: string } | null
}): void {
  if (run.mockSetupFailure === 'registration') {
    logNamed('cli_plugin_eval_mocks', 'standin_registration')
  } else if (run.mockSetupFailure === 'identity') {
    logNamed('cli_plugin_eval_mocks', 'standin_identity')
  } else if (run.mockSetupFailure === 'tools_missing') {
    logNamed('cli_plugin_eval_mocks', 'standin_tools_missing')
  } else if (run.mockSetupFailure === 'integrity') {
    logNamed('cli_plugin_eval_mocks', 'standin_integrity')
  } else if (
    run.aborted !== null &&
    run.aborted.reason.startsWith(MOCK_AGENT_FAILED)
  ) {
    logNamed('cli_plugin_eval_mocks', 'agent_relay_failed')
  } else if (run.aborted !== null) {
    logNamed('cli_plugin_eval_mocks', 'aborted_by_mock')
  } else {
    logNamed('cli_plugin_eval_mocks')
  }
}
