/**
 * Pure bg/AgentsView helpers aligned with official 2.1.207
 * (GCp / Vdt / Iia / IL_).
 */

/** Official IL_ */
export const BG_FLAGS = ['--bg', '--background'] as const

/** Official hQr — APC error codes like ESTALLED:/ERESPAWNING: stay in stderr path. */
export const APC_ERROR_CODE_RE = /^E[A-Z]+:/

export type DetachAttachResult = {
  outcome: string
  viaApc?: boolean
  msg?: string
}

/**
 * Official GCp / shouldOpenAgentsViewOnDetach.
 * After a successful APC detach attach, open AgentsView when both stdio are TTY
 * and the message is not an E* error code.
 */
export function shouldOpenAgentsViewOnDetach(
  result: DetachAttachResult,
  stdoutIsTty: boolean,
  stdinIsTty: boolean,
): boolean {
  return (
    result.outcome === 'detached' &&
    result.viaApc === true &&
    (result.msg === undefined || !APC_ERROR_CODE_RE.test(result.msg)) &&
    stdoutIsTty === true &&
    stdinIsTty === true
  )
}

/**
 * Official Iia / stripBgFlags — drop `--bg` / `--background` before `--`,
 * keep argv after `--` intact.
 */
export function stripBgFlags(args: readonly string[]): string[] {
  const dd = args.indexOf('--')
  const head = dd >= 0 ? args.slice(0, dd) : [...args]
  const tail = dd >= 0 ? args.slice(dd) : []
  const filtered = head.filter(a => a !== '--bg' && a !== '--background')
  return dd >= 0 ? [...filtered, ...tail] : filtered
}

/**
 * Official Vdt / formatBgHints — post-spawn usage lines for bg sessions.
 */
export function formatBgHints(
  shortId: string,
  idleHint?: string,
  nameOrIntent?: string,
): string {
  const line = (cmd: string, desc: string) => `  ${cmd.padEnd(26)}${desc}`
  const header = [
    `backgrounded · ${shortId}`,
    nameOrIntent ? ` · ${nameOrIntent}` : '',
    idleHint ? ` ${idleHint}` : '',
  ].join('')
  return [
    header,
    line('claude agents', 'list sessions'),
    line(`claude attach ${shortId}`, 'open in this terminal'),
    line(`claude logs ${shortId}`, 'show recent output'),
    line(`claude stop ${shortId}`, 'stop this session'),
  ].join('\n')
}

/** Minimal message shape for official p1t / deriveBackgroundSeed. */
export type BackgroundSeedMessage = {
  type: string
  isMeta?: boolean
  message?: { content?: unknown }
}

export type BackgroundSeed = {
  intent: string
  name?: string
  nameSource?: 'user' | 'auto'
  color?: string
  detail?: string
}

function textFromContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text)
    }
  }
  const joined = parts.join('\n').trim()
  return joined || null
}

function isToolResultUserMessage(msg: BackgroundSeedMessage): boolean {
  if (msg.type !== 'user') return false
  const content = msg.message?.content
  if (typeof content === 'string' || !Array.isArray(content)) return false
  return content.some(
    b =>
      b &&
      typeof b === 'object' &&
      (b as { type?: string }).type === 'tool_result',
  )
}

/** Default: treat angle-bracket system tags as non-intent user content. */
export function isSystemishUserText(text: string): boolean {
  return (
    text.startsWith('<command-') ||
    text.startsWith('<local-command-') ||
    text.startsWith('<ide_') ||
    text.startsWith('<system-') ||
    text.startsWith('<tick>') ||
    text.startsWith('<')
  )
}

/**
 * Official p1t / deriveBackgroundSeed — walk messages reverse for latest
 * non-meta user intent + latest assistant detail; attach session name/color.
 */
export function deriveBackgroundSeed(
  messages: readonly BackgroundSeedMessage[],
  fallbackIntent: string,
  options?: {
    sessionTitle?: string | null
    sessionAiTitle?: string | null
    agentColor?: string
    isSystemish?: (text: string) => boolean
  },
): BackgroundSeed | null {
  const isSystemish = options?.isSystemish ?? isSystemishUserText
  let intent = fallbackIntent
  let sawUser = false
  let detail: string | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.type === 'assistant' && detail === undefined) {
      const text = textFromContent(msg.message?.content)
      if (text) {
        detail = text.replace(/\s+/g, ' ').trim().slice(0, 120)
      }
    }
    if (msg.type === 'user' && !msg.isMeta && !isToolResultUserMessage(msg)) {
      const text = textFromContent(msg.message?.content)?.trim()
      if (text && isSystemish(text)) {
        // Official: system-tag user content still marks sawUser when tagged
        // with the tick/command envelope, but does not become intent.
        sawUser = true
        continue
      }
      sawUser = true
      if (!intent && text) intent = text
    }
    if (sawUser && intent && detail !== undefined) break
  }

  if (!sawUser && !fallbackIntent) return null

  const userTitle = options?.sessionTitle ?? undefined
  const aiTitle = options?.sessionAiTitle ?? undefined
  const name = userTitle ?? aiTitle
  const color = options?.agentColor

  return {
    intent: (intent || '(backgrounded)').slice(0, 200),
    name: name || undefined,
    nameSource: userTitle ? 'user' : aiTitle ? 'auto' : undefined,
    color: color || undefined,
    detail,
  }
}

/**
 * Official mOo / canBackgroundSession — pure gate over feature flags + seed.
 */
export function canBackgroundSession(
  messages: readonly BackgroundSeedMessage[],
  gates: {
    featureEnabled: boolean
    isBgSession: boolean
    skipHistory: boolean
    adoptDisabled: boolean
  },
  fallbackIntent = '',
  seedOptions?: Parameters<typeof deriveBackgroundSeed>[2],
): boolean {
  return (
    gates.featureEnabled &&
    !gates.isBgSession &&
    !gates.skipHistory &&
    !gates.adoptDisabled &&
    deriveBackgroundSeed(messages, fallbackIntent, seedOptions) !== null
  )
}
