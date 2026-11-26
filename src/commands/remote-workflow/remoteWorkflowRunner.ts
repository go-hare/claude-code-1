import { extractMeta, parseScript } from '@claude-code/workflow-engine'
import { feature } from 'bun:bundle'
import { isRemotePolicyAllowed } from '../../services/policyLimits/index.js'
import type { LocalJSXCommandContext } from '../../types/command.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'

export const REMOTE_WORKFLOW_SCRIPT_ENV = 'CLAUDE_REMOTE_WORKFLOW_SCRIPT'
export const REMOTE_WORKFLOW_ARGS_ENV = 'CLAUDE_REMOTE_WORKFLOW_ARGS'
export const REMOTE_WORKFLOW_MAX_BYTES = 100_000
export const REMOTE_WORKFLOW_SERVER_CARRIER_MAX_BYTES = 512_000

const MAX_ERROR_LINE_LEN = 4000
const NONDETERMINISM_RE = /\b(?:Date\.now|Math\.random)\s*\(|\bnew\s+Date\s*\(/

// biome-ignore lint/suspicious/noControlCharactersInRegex: reject disallowed C0 control chars except tab/newline/CR
const DISALLOWED_CONTROL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

/**
 * Official 2.1.331 `Tao(layer, message)` — deterministic single-line error
 * envelope for `__remote-workflow` and `workflow-launch-exec`.
 */
export function formatRemoteWorkflowError(
  layer: string,
  message: string,
): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: flatten ASCII record/group/unit separators and line breaks into a single line
  const LINE_BREAK_SEPARATORS_RE = /[\r\n\v\f\x1c\x1d\x1e\u0085\u2028\u2029]+/g
  let clean = message
    .replace(LINE_BREAK_SEPARATORS_RE, ' ')
    .replaceAll('remote-workflow:', 'remote-workflow;')
  if (clean.length > MAX_ERROR_LINE_LEN) {
    clean = `${clean.slice(0, MAX_ERROR_LINE_LEN)}…[truncated]`
  }
  return `remote-workflow: error[${layer}]: ${clean}`
}

/**
 * Official 2.1.331 `Ben()` — check whether dynamic workflows are disabled by
 * env var, managed/user settings, or org policy.
 */
export function checkRemoteWorkflowPolicyGate(opts?: {
  serverAuthoredCarrier?: boolean
  eventSessionOrigin?: string
  env?: NodeJS.ProcessEnv
}): string | null {
  const env = opts?.env ?? process.env
  const envDisabled = Object.entries(env).some(
    ([key, val]) =>
      key.toUpperCase() === 'CLAUDE_CODE_DISABLE_WORKFLOWS' && isEnvTruthy(val),
  )
  if (envDisabled) {
    return 'dynamic workflows are disabled for this session (the environment variable `CLAUDE_CODE_DISABLE_WORKFLOWS` was set when Claude Code started).'
  }

  const policy = getSettingsForSource('policySettings') as
    | { disableWorkflows?: boolean; env?: Record<string, string> }
    | null
    | undefined
  const policyDisabled =
    policy?.disableWorkflows === true ||
    Object.entries(policy?.env ?? {}).some(
      ([key, val]) =>
        key.toUpperCase() === 'CLAUDE_CODE_DISABLE_WORKFLOWS' &&
        isEnvTruthy(val),
    )

  if (policyDisabled) {
    if (
      opts?.serverAuthoredCarrier === true &&
      opts?.eventSessionOrigin === 'review'
    ) {
      return "Code review did not run: workflows are turned off in this machine's managed settings (`disableWorkflows`, or `CLAUDE_CODE_DISABLE_WORKFLOWS` in its `env` block). Ask this machine's administrator to allow it."
    }
    return 'dynamic workflows are disabled for this session (the `disableWorkflows` setting).'
  }

  if (!isRemotePolicyAllowed('allow_workflows')) {
    return 'dynamic workflows are disabled for this session (org policy `allow_workflows`).'
  }

  return null
}

export type RemoteWorkflowRunResult =
  | { ok: true; line: string; workflowName?: string }
  | { ok: false; layer: string; line: string }

/**
 * Official 2.1.331 `sXo` — validate and run a remote workflow script through
 * the local `WorkflowService` when `WORKFLOW_SCRIPTS` is enabled.
 */
export async function runRemoteWorkflowScript(opts: {
  script: string
  args?: unknown
  telemetrySource: 'remote_env' | 'remote_event'
  serverAuthoredCarrier?: boolean
  eventSessionOrigin?: string
  context: LocalJSXCommandContext
}): Promise<RemoteWorkflowRunResult> {
  const fail = (layer: string, message: string): RemoteWorkflowRunResult => ({
    ok: false,
    layer,
    line: formatRemoteWorkflowError(layer, message),
  })

  const gateErr = checkRemoteWorkflowPolicyGate({
    serverAuthoredCarrier: opts.serverAuthoredCarrier,
    eventSessionOrigin: opts.eventSessionOrigin,
  })
  if (gateErr) {
    return fail('policy-gate', gateErr)
  }

  const maxBytes = opts.serverAuthoredCarrier
    ? REMOTE_WORKFLOW_SERVER_CARRIER_MAX_BYTES
    : REMOTE_WORKFLOW_MAX_BYTES
  if (opts.script.length > maxBytes) {
    return fail(
      'script-too-large',
      `workflow script exceeds ${maxBytes} bytes.`,
    )
  }

  if (DISALLOWED_CONTROL_CHARS_RE.test(opts.script)) {
    return fail(
      'control-chars',
      'workflow script contains disallowed control characters.',
    )
  }

  let parsed: ReturnType<typeof parseScript>
  let scriptBody: string
  try {
    scriptBody = extractMeta(opts.script).body
    parsed = parseScript(opts.script)
  } catch (err) {
    return fail('meta-parse', `invalid workflow script: ${errorMessage(err)}`)
  }

  if (NONDETERMINISM_RE.test(scriptBody)) {
    return fail(
      'nondeterminism',
      'workflow scripts must be deterministic: Date.now()/Math.random()/new Date() are unavailable.',
    )
  }

  if (!feature('WORKFLOW_SCRIPTS')) {
    return fail(
      'unavailable',
      'workflow scripts are not enabled in this build.',
    )
  }

  const canUseTool = opts.context.canUseTool
  if (!canUseTool) {
    return fail(
      'no-permission-handler',
      'cannot execute workflow without an active tool permission handler.',
    )
  }

  const { getWorkflowService } = await import('../../workflow/service.js')
  const service = getWorkflowService()

  let runId: string
  try {
    const launched = await service.launch(
      {
        script: opts.script,
        args: opts.args,
      },
      opts.context,
      canUseTool,
    )
    runId = launched.runId
  } catch (err) {
    return fail('launch-failed', errorMessage(err))
  }

  const terminal = await new Promise<
    ReturnType<typeof service.getRun> | undefined
  >(resolve => {
    const existing = service.getRun(runId)
    if (
      existing &&
      (existing.status === 'completed' ||
        existing.status === 'failed' ||
        existing.status === 'killed')
    ) {
      resolve(existing)
      return
    }
    const unsub = service.subscribe(() => {
      const current = service.getRun(runId)
      if (
        current &&
        (current.status === 'completed' ||
          current.status === 'failed' ||
          current.status === 'killed')
      ) {
        unsub()
        resolve(current)
      }
    })
  })

  if (!terminal) {
    return fail(
      'unexpected-state',
      'workflow ended without a recorded run state.',
    )
  }

  if (terminal.status === 'completed') {
    const payload = JSON.stringify({
      status: 'completed',
      runId,
      agentCount: terminal.agents.length,
      result: terminal.returnValue ?? null,
    })
    return {
      ok: true,
      line: `remote-workflow: ${payload}`,
      workflowName: parsed.meta?.name,
    }
  }

  if (terminal.status === 'failed') {
    return fail(
      'workflow-failed',
      `workflow failed (${terminal.agents.length} agents): ${terminal.error ?? 'unknown error'}`,
    )
  }

  if (terminal.status === 'killed') {
    return fail('killed', 'workflow was aborted before completion.')
  }

  return fail(
    'unexpected-state',
    `workflow ended in unexpected state '${terminal.status}'.`,
  )
}
