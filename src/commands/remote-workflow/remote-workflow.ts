import type { LocalCommandCall } from '../../types/command.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  REMOTE_WORKFLOW_ARGS_ENV,
  REMOTE_WORKFLOW_MAX_BYTES,
  REMOTE_WORKFLOW_SCRIPT_ENV,
  checkRemoteWorkflowPolicyGate,
  formatRemoteWorkflowError,
  runRemoteWorkflowScript,
} from './remoteWorkflowRunner.js'

function errorResult(
  layer: string,
  message: string,
): {
  type: 'text'
  value: string
} {
  return {
    type: 'text',
    value: formatRemoteWorkflowError(layer, message),
  }
}

/**
 * Official 2.1.331 `chunk-3f6rt389.js` — `/__remote-workflow` handler.
 */
export const call: LocalCommandCall = async (_args, context) => {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return errorResult(
      'not-remote-session',
      'this command only runs inside a remote (CCR) session (CLAUDE_CODE_REMOTE is not set). Use the Workflow tool locally.',
    )
  }

  const script = process.env[REMOTE_WORKFLOW_SCRIPT_ENV]
  if (script === undefined || script === '') {
    return errorResult(
      'env-missing',
      `${REMOTE_WORKFLOW_SCRIPT_ENV} is not set. This command is the deterministic entry point for sessions launched with an environment-delivered workflow script; it has no interactive use.`,
    )
  }

  const gateErr = checkRemoteWorkflowPolicyGate()
  if (gateErr) {
    return errorResult('policy-gate', gateErr)
  }

  let parsedArgs: unknown
  const rawArgs = process.env[REMOTE_WORKFLOW_ARGS_ENV]
  if (rawArgs !== undefined && rawArgs !== '') {
    if (rawArgs.length > REMOTE_WORKFLOW_MAX_BYTES) {
      return errorResult(
        'args-too-large',
        `${REMOTE_WORKFLOW_ARGS_ENV} exceeds ${REMOTE_WORKFLOW_MAX_BYTES} bytes.`,
      )
    }
    try {
      parsedArgs = JSON.parse(rawArgs)
    } catch (err) {
      return errorResult(
        'args-parse',
        `${REMOTE_WORKFLOW_ARGS_ENV} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const outcome = await runRemoteWorkflowScript({
    script,
    args: parsedArgs,
    telemetrySource: 'remote_env',
    context,
  })
  return { type: 'text', value: outcome.line }
}
