/**
 * densable 2.1.289 `px()?.transcript.reveal` binder for FH `ui.scroll` → vat.
 *
 * Gold: Xi.reveal → revealRef.current.reveal(requestId, block) →
 * `"revealed" | "unknown" | "unscrollable"`.
 * Do **not** export minify `vat` / `px` / `Xi` / `dZ`.
 */

export type TranscriptRevealBlock = 'start' | 'center' | 'end' | 'nearest'

export type TranscriptRevealResult = 'revealed' | 'unknown' | 'unscrollable'

/**
 * densable VML `reveal(requestId, block)` — returns null when unscrollable /
 * unknown index; else a Promise that resolves truthy on land.
 */
export type TranscriptRevealFn = (
  requestId: string,
  block: TranscriptRevealBlock,
) => Promise<boolean> | null

export type TranscriptRevealHost = {
  reveal: TranscriptRevealFn
  release?: () => void
}

let host: TranscriptRevealHost | undefined

/** densable VirtualMessageList / REPL registration for FH vat. */
export function setTranscriptRevealHost(
  next: TranscriptRevealHost | undefined,
): void {
  host = next
}

export function getTranscriptRevealHost(): TranscriptRevealHost | undefined {
  return host
}

/**
 * densable `Xi.reveal` alphabet.
 */
export async function revealInTranscript(
  requestId: string,
  block: TranscriptRevealBlock = 'nearest',
): Promise<TranscriptRevealResult> {
  const held = host
  if (!held) return 'unscrollable'
  const pending = held.reveal(requestId, block)
  if (!pending) return 'unknown'
  return (await pending) ? 'revealed' : 'unknown'
}

/**
 * densable `dZ(hookOrigin)` — person-initiated gate for vat only.
 */
export function isPersonInitiatedUiScroll(ctx: {
  origin?: unknown
  isPersonInput?: boolean
  rootEvent?: string
}): boolean {
  const origin = ctx.origin
  const entries = Array.isArray(origin)
    ? origin
    : origin === undefined
      ? []
      : [origin]
  const [first, ...rest] = entries
  const single = first !== undefined && rest.length === 0
  const personInput =
    single && typeof first !== 'string' && ctx.isPersonInput === true
  const root = ctx.rootEvent
  return (
    personInput ||
    (single &&
      (root === 'ui.press' || root === 'ui.input' || root === 'ui.select'))
  )
}

/**
 * densable `vat(requestId, block, hookCtx)`.
 */
export async function scrollTranscriptByRequestId(
  requestId: string,
  block: TranscriptRevealBlock,
  ctx: {
    plugin?: string
    origin?: unknown
    isPersonInput?: boolean
    rootEvent?: string
  },
): Promise<{ deny?: string }> {
  if (!host) {
    return { deny: 'transcript not scrollable here' }
  }
  if (!isPersonInitiatedUiScroll(ctx)) {
    const root = ctx.rootEvent ?? 'none'
    const who = ctx.plugin ?? ''
    // gold logs then deny — keep debug via caller if needed
    void root
    void who
    return { deny: 'not person-initiated' }
  }
  const result = await revealInTranscript(requestId, block)
  switch (result) {
    case 'revealed':
      return {}
    case 'unknown':
      return { deny: 'nothing drawn under that requestId' }
    case 'unscrollable':
      return { deny: 'transcript not scrollable here' }
  }
}
