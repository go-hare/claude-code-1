/**
 * densable 2.1.283 `--await-initialize` (Gqr / zqr / fl / ul / pl / Ii).
 *
 * GOLD SEA /tmp/official-283/package/claude:
 *   cl launch schema @191756916 (type control_request + subtype initialize)
 *   fl parse @191758189
 *   Xpn local-plugin shape @177448975
 *   preAction Gqr(DXn) @192090794 then await zqr before --plugin-dir
 *
 * Launch-scoped field gold applies: plugins[] as --plugin-dir / --plugin-dir-no-mcp.
 * Do not apply other initialize fields here (those stay on the later initialize
 * control handler in print.ts).
 */
import { z } from 'zod/v4'
import { jsonParse } from '../utils/slowOperations.js'
import { normalizeControlMessageKeys } from '../utils/controlMessageCompat.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../services/analytics/index.js'

/** densable `_` / `m` / `p` @176416392 — tengu_feature_{ok,bad,sad}. */
const SDK_LAUNCH_INITIALIZE =
  'sdk_launch_initialize' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

function logSdkLaunchInitializeOk(): void {
  logEvent('tengu_feature_ok', { feature_name: SDK_LAUNCH_INITIALIZE })
}

function logSdkLaunchInitializeBad(errorCode: string): void {
  logEvent('tengu_feature_bad', {
    feature_name: SDK_LAUNCH_INITIALIZE,
    error_code:
      errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

function logSdkLaunchInitializeSad(errorCode: string): void {
  logEvent('tengu_feature_sad', {
    feature_name: SDK_LAUNCH_INITIALIZE,
    error_code:
      errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** densable `dl` — first-line ceiling before parse is skipped (absent). */
const FIRST_LINE_CEILING = 268435456
const FIRST_LINE_TOO_LONG = Symbol('first line too long')

export const SdkLocalPluginSchema = z.object({
  type: z.literal('local'),
  path: z.string(),
  skipMcpDiscovery: z.boolean().optional(),
})

/** densable `cl` — only type + initialize subtype; plugins validated separately. */
const LaunchInitializeLineSchema = z.object({
  type: z.literal('control_request'),
  request: z
    .object({
      subtype: z.literal('initialize'),
      plugins: z.unknown().optional(),
    })
    .passthrough(),
})

export type AwaitInitializeApplied = {
  kind: 'applied'
  pluginDirs: string[]
  pluginDirsNoMcp: string[]
}

export type AwaitInitializeResult =
  | { kind: 'absent' }
  | { kind: 'violation'; message: string }
  | AwaitInitializeApplied

type StdinLineBuffer = {
  generator: AsyncGenerator<string, void, unknown>
  stash: string[]
  inflight: Promise<IteratorResult<string>> | undefined
  ended: boolean
  error: unknown
  adopted: boolean
  capped: boolean
}

let pendingParse: Promise<AwaitInitializeResult | undefined> | undefined
let lineBuffer: StdinLineBuffer | undefined

/**
 * densable `DXn` — utf8 stdin chunks for stream-json (also leftover after fl).
 */
export async function* streamJsonStdinChunks(): AsyncGenerator<string> {
  try {
    process.stdin.setEncoding('utf8')
    yield* process.stdin as AsyncIterable<string>
  } catch (e) {
    const code =
      e && typeof e === 'object' && 'code' in e
        ? String((e as { code?: unknown }).code)
        : undefined
    if (
      code === 'EISDIR' ||
      code === 'ENOTCONN' ||
      code === 'ECONNRESET' ||
      code === 'EPIPE' ||
      code === 'EIO' ||
      code === 'ENXIO' ||
      code === 'EBADF'
    ) {
      logForDebugging(
        `getInputPrompt: stream-json stdin unreadable: ${errorMessage(e)}`,
        { level: 'error' },
      )
      return
    }
    throw e
  }
}

async function readFirstNonEmptyLine(
  buf: StdinLineBuffer,
): Promise<string | null | typeof FIRST_LINE_TOO_LONG> {
  let o = ''
  for (;;) {
    const n = o.indexOf('\n')
    if (n !== -1) {
      const g = o.slice(0, n)
      if (g.trim() !== '') return g
      o = o.slice(n + 1)
      continue
    }
    if (o.length > FIRST_LINE_CEILING) {
      buf.capped = true
      return FIRST_LINE_TOO_LONG
    }
    buf.inflight = buf.generator.next()
    const r = await buf.inflight
    buf.inflight = undefined
    if (r.done) {
      buf.ended = true
      return null
    }
    buf.stash.push(r.value)
    o += r.value
  }
}

async function continueStashing(buf: StdinLineBuffer): Promise<void> {
  try {
    while (
      !buf.adopted &&
      !buf.ended &&
      !buf.capped &&
      buf.error === undefined
    ) {
      buf.inflight = buf.generator.next()
      const o = await buf.inflight
      buf.inflight = undefined
      if (o.done) buf.ended = true
      else buf.stash.push(o.value)
    }
  } catch (o) {
    buf.inflight = undefined
    buf.error = o
  }
}

async function* adoptLeftover(buf: StdinLineBuffer): AsyncGenerator<string> {
  let o = false
  try {
    while (buf.stash.length > 0) yield buf.stash.shift() as string
    if (buf.inflight) {
      await buf.inflight.catch(() => {})
      while (buf.stash.length > 0) yield buf.stash.shift() as string
    }
    if (buf.error !== undefined) throw buf.error
    if (buf.ended) return
    o = true
    yield* buf.generator
  } finally {
    if (!o && !buf.ended) buf.generator.return(undefined).catch(() => {})
  }
}

export function parseAwaitInitializeLine(e: string): AwaitInitializeResult {
  let o: unknown
  try {
    o = normalizeControlMessageKeys(jsonParse(e))
  } catch {
    logSdkLaunchInitializeBad('first_line_not_json')
    return {
      kind: 'violation',
      message:
        'Error: --await-initialize requires the initialize control request as the first stdin line, and the first line is not valid JSON.',
    }
  }
  const n = LaunchInitializeLineSchema.safeParse(o)
  if (!n.success) {
    logSdkLaunchInitializeBad('first_line_not_initialize')
    return {
      kind: 'violation',
      message:
        'Error: --await-initialize requires the initialize control request as the first stdin line, and the first line is a different message.',
    }
  }
  const r = z
    .array(SdkLocalPluginSchema)
    .optional()
    .safeParse(n.data.request.plugins)
  if (!r.success) {
    logSdkLaunchInitializeBad('plugins_malformed')
    return {
      kind: 'violation',
      message:
        "Error: initialize.plugins must be an array of { type: 'local', path: string, skipMcpDiscovery?: boolean } entries.",
    }
  }
  const g = r.data ?? []
  logSdkLaunchInitializeOk()
  return {
    kind: 'applied',
    pluginDirs: g.filter(h => !h.skipMcpDiscovery).map(h => h.path),
    pluginDirsNoMcp: g.filter(h => h.skipMcpDiscovery).map(h => h.path),
  }
}

function interpretFirstLine(
  e: string | null | typeof FIRST_LINE_TOO_LONG,
): AwaitInitializeResult {
  if (e === null) {
    logForDebugging(
      '--await-initialize: stdin ended before an initialize request arrived',
      { level: 'warn' },
    )
    logSdkLaunchInitializeSad('stdin_ended')
    return { kind: 'absent' }
  }
  if (e === FIRST_LINE_TOO_LONG) {
    logForDebugging(
      '--await-initialize: first stdin line exceeds the line-size ceiling; not parsed',
      { level: 'error' },
    )
    logSdkLaunchInitializeBad('first_line_too_long')
    return { kind: 'absent' }
  }
  return parseAwaitInitializeLine(e)
}

/** densable `Gqr` — start reading the first stdin line during preAction. */
export function startAwaitInitializeStdinRead(
  generator: () => AsyncGenerator<string>,
): void {
  if (pendingParse) return
  const o: StdinLineBuffer = {
    generator: generator(),
    stash: [],
    inflight: undefined,
    ended: false,
    error: undefined,
    adopted: false,
    capped: false,
  }
  lineBuffer = o
  pendingParse = readFirstNonEmptyLine(o)
    .then(interpretFirstLine, (n: unknown) => {
      o.error = n
      logSdkLaunchInitializeSad('stdin_error')
      return { kind: 'absent' } as AwaitInitializeResult
    })
    .catch(() => {
      logSdkLaunchInitializeBad('parse_threw')
      return { kind: 'absent' } as AwaitInitializeResult
    })
  void pendingParse.then(() => continueStashing(o))
}

/** densable `zqr`. */
export function waitForAwaitInitialize(): Promise<
  AwaitInitializeResult | undefined
> {
  return pendingParse ?? Promise.resolve(undefined)
}

/** densable `Ii` — leftover stdin after the initialize line (for getInputPrompt). */
export function takeAdoptedAwaitInitializeStdin():
  | AsyncGenerator<string>
  | undefined {
  const e = lineBuffer
  if (!e || e.adopted) return
  e.adopted = true
  return adoptLeftover(e)
}

export function concatPluginDirs(
  flagDirs: unknown,
  initializeDirs: string[] | undefined,
): string[] {
  const a = Array.isArray(flagDirs)
    ? flagDirs.filter((p): p is string => typeof p === 'string')
    : []
  return [...a, ...(initializeDirs ?? [])]
}

export function resetAwaitInitializeForTesting(): void {
  pendingParse = undefined
  lineBuffer = undefined
}
