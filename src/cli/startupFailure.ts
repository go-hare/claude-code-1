/**
 * densable 2.1.283 D6 @179001395 / dmt @179001233 / O6 @179000667.
 *
 * Gold D6: stdout JSON iff cmt() (CLAUDE_CODE_STARTUP_FAILURE_RESULTS) and
 * $9n() (Dhn print-like argv AND --output-format=stream-json), skipped when
 * stdout.writableEnded / destroyed.
 *
 * Envelope is O6: subtype error_during_execution + session_id + errors:[message]
 * + dmt extras startup_failure_reason / result_index.
 * D6 remaps sessionId via gold `d()` before dmt: `--session-id` (UUID via `en`
 * unless `--sdk-url` is set).
 *
 * First gold `Fi` @175490813 is a token helper — do not land as shutdown.
 * Call-site Fi() is `$le()` analytics flush then `nn()` process.exit(1).
 */

import { randomUUID } from 'crypto'
import { EMPTY_USAGE } from '@ant/model-provider'
import { validateUuid } from '../utils/uuid.js'

function isEnvTruthy(envVar: string | boolean | undefined): boolean {
  if (!envVar) return false
  if (typeof envVar === 'boolean') return envVar
  return ['1', 'true', 'yes', 'on'].includes(envVar.toLowerCase().trim())
}

function cliArgs(argv: string[]): string[] {
  if (argv.length >= 2 && (argv[0] === 'node' || argv[0]?.endsWith('node'))) {
    return argv.slice(2)
  }
  return argv[0] === process.execPath ? argv.slice(2) : argv
}

function hasFlag(flag: string, args: string[]): boolean {
  for (const arg of args) {
    if (arg === '--') break
    if (arg === flag) return true
  }
  return false
}

/** densable cN — last `--flag` / `--flag=` value before `--`. */
function lastFlagValue(flag: string, args: string[]): string | undefined {
  let last: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') break
    if (arg?.startsWith(`${flag}=`)) {
      last = arg.slice(flag.length + 1)
      continue
    }
    if (arg === flag && i + 1 < args.length) {
      last = args[i + 1]
      i++
    }
  }
  return last
}

function parseOutputFormat(argv: string[]): string | undefined {
  return lastFlagValue('--output-format', cliArgs(argv))
}

/**
 * densable `d()` @179001166 — not exported in gold.
 * `--session-id` wins over the runtime id. Without `--sdk-url`, gold `en()`
 * (validateUuid) must accept it; otherwise keep `fallback`.
 */
export function remapStartupFailureSessionId(
  fallback: string,
  argv: string[] = process.argv,
): string {
  const args = cliArgs(argv)
  const fromFlag = lastFlagValue('--session-id', args)
  const remapped =
    lastFlagValue('--sdk-url', args) === undefined
      ? validateUuid(fromFlag)
      : fromFlag
  return remapped || fallback
}

export const MANAGED_SETTINGS_INVALID_REASON =
  'managed_settings_invalid' as const

export type StartupFailureResultInput = {
  sessionId: string
  message: string
  reason: typeof MANAGED_SETTINGS_INVALID_REASON
  resultIndex?: number | null
}

/** densable Dhn — -p/--print || --init-only || --sdk-url* || !stdout.isTTY. */
export function isPrintLikeArgv(
  argv: string[] = process.argv,
  stdoutIsTTY: boolean | undefined = process.stdout.isTTY,
): boolean {
  const args = cliArgs(argv)
  const print = hasFlag('-p', args) || hasFlag('--print', args)
  const initOnly = hasFlag('--init-only', args)
  const sdkUrl = args.some(a => a !== '--' && a.startsWith('--sdk-url'))
  return print || initOnly || sdkUrl || stdoutIsTTY !== true
}

/** Gold $9n: Dhn && --output-format=stream-json. */
export function isStartupFailureStreamJson(
  argv: string[] = process.argv,
  stdoutIsTTY: boolean | undefined = process.stdout.isTTY,
): boolean {
  return (
    isPrintLikeArgv(argv, stdoutIsTTY) &&
    parseOutputFormat(argv) === 'stream-json'
  )
}

/** densable cmt + $9n. */
export function shouldWriteStartupFailureResult(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
  stdoutIsTTY: boolean | undefined = process.stdout.isTTY,
): boolean {
  return (
    isEnvTruthy(env.CLAUDE_CODE_STARTUP_FAILURE_RESULTS) &&
    isStartupFailureStreamJson(argv, stdoutIsTTY)
  )
}

/** densable O6 + dmt. */
export function buildStartupFailureResult(r: StartupFailureResultInput): {
  type: 'result'
  subtype: 'error_during_execution'
  duration_ms: 0
  duration_api_ms: 0
  is_error: true
  num_turns: 0
  stop_reason: null
  session_id: string
  total_cost_usd: 0
  usage: typeof EMPTY_USAGE
  modelUsage: Record<string, never>
  permission_denials: []
  uuid: string
  errors: string[]
  startup_failure_reason?: typeof MANAGED_SETTINGS_INVALID_REASON
  result_index?: number
} {
  const resultIndex = r.resultIndex === undefined ? 0 : r.resultIndex
  return {
    type: 'result',
    subtype: 'error_during_execution',
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: true,
    num_turns: 0,
    stop_reason: null,
    session_id: r.sessionId,
    total_cost_usd: 0,
    usage: EMPTY_USAGE,
    modelUsage: {},
    permission_denials: [],
    uuid: randomUUID(),
    errors: [r.message],
    ...(r.reason !== undefined ? { startup_failure_reason: r.reason } : {}),
    ...(resultIndex !== null ? { result_index: resultIndex } : {}),
  }
}

/** densable D6 @179001395 */
export async function writeStartupFailureResult(
  r: StartupFailureResultInput,
  opts?: {
    env?: NodeJS.ProcessEnv
    argv?: string[]
    stdout?: NodeJS.WriteStream
  },
): Promise<void> {
  const stdout = opts?.stdout ?? process.stdout
  if (
    !shouldWriteStartupFailureResult(
      opts?.env ?? process.env,
      opts?.argv ?? process.argv,
      stdout.isTTY,
    )
  ) {
    return
  }
  if (stdout.destroyed || stdout.writableEnded) return
  const argv = opts?.argv ?? process.argv
  const line =
    JSON.stringify(
      buildStartupFailureResult({
        ...r,
        sessionId: remapStartupFailureSessionId(r.sessionId, argv),
      }),
    ) + '\n'
  await new Promise<void>(resolve => {
    const done = () => resolve()
    stdout.once('error', done)
    try {
      stdout.write(line, done)
    } catch {
      resolve()
    }
  })
}

/** densable call-site Fi: `$le()` then `nn()` — not gold token Fi @175490813. */
export async function exitAfterAnalyticsFlush(code = 1): Promise<never> {
  try {
    const [{ shutdown1PEventLogging }, { shutdownDatadog }] = await Promise.all(
      [
        import('../services/analytics/firstPartyEventLogger.js'),
        import('../services/analytics/datadog.js'),
      ],
    )
    await Promise.all([shutdown1PEventLogging(), shutdownDatadog()])
  } catch {
    // gold $le swallows flush errors
  }
  // eslint-disable-next-line custom-rules/no-process-exit -- densable nn() after $le
  process.exit(code)
  return undefined as never
}
