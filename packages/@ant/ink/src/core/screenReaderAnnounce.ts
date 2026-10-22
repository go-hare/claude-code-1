/**
 * densable 2.1.218 `pWr` / `GJc` / `Ozs` — ephemeral screen-reader announcements
 * for deleted text (word/line kills) and similar transient events.
 *
 * Announcements are queued and drained on the next `onRenderScreenReader` paint
 * so VoiceOver/NVDA speak the killed text without needing a permanent DOM node.
 */

const MAX_QUEUE = 16
/** densable `v` / `M` — CLAUDE_AX_PREPARK_MS default 0, cap 5000. */
const PREPARK_DEFAULT_MS = 0
const PREPARK_MAX_MS = 5000
/** densable `WXo` default 1000, cap 10000. */
const ANNOUNCEMENT_HOLD_DEFAULT_MS = 1000
const ANNOUNCEMENT_HOLD_MAX_MS = 10_000

let queue: string[] = []
/** densable `#t` — next drain should hold the SR frame. */
let holdRequested = false
/** densable `#a` — hold-until epoch ms. */
let holdUntilMs = 0

/**
 * densable `mW` / `pWr` — push an announcement; keep only the last MAX_QUEUE items.
 * `hold` sets takeHoldRequest for the next SR paint.
 */
export function announceForScreenReader(text: string, hold = false): void {
  if (text === '') return
  queue.push(text)
  if (hold) holdRequested = true
  if (queue.length > MAX_QUEUE) {
    queue.splice(0, queue.length - MAX_QUEUE)
  }
}

/**
 * densable `GJc` — drain and clear the announcement queue.
 */
export function drainScreenReaderAnnouncements(): string[] {
  if (queue.length === 0) return []
  const out = queue
  queue = []
  return out
}

/** Test helper — clear queue without reading. */
export function clearScreenReaderAnnouncements(): void {
  queue = []
  holdRequested = false
  holdUntilMs = 0
}

/** densable `takeHoldRequest`. */
export function takeScreenReaderHoldRequest(): boolean {
  const requested = holdRequested
  holdRequested = false
  return requested
}

/** densable `GXo`. */
export function startScreenReaderHold(untilMs: number): void {
  holdUntilMs = untilMs
}

/** densable `pWe`. */
export function endScreenReaderHold(): void {
  holdUntilMs = 0
  holdRequested = false
}

/** densable `zXo`. */
export function isScreenReaderHoldActive(nowMs = Date.now()): boolean {
  return nowMs < holdUntilMs
}

/** densable `UXo`. */
export function getScreenReaderPreparkMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_AX_PREPARK_MS
  let configured: number | undefined
  if (raw !== undefined && raw !== '') {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed >= 0) configured = parsed
  }
  return Math.min(configured ?? PREPARK_DEFAULT_MS, PREPARK_MAX_MS)
}

/** densable `WXo` — consume the hold request and return hold ms. */
export function takeScreenReaderAnnouncementHoldMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (!takeScreenReaderHoldRequest()) return 0
  const raw = env.CLAUDE_AX_ANNOUNCEMENT_HOLD_MS
  let configured: number | undefined
  if (raw !== undefined && raw !== '') {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed >= 0) configured = parsed
  }
  return Math.min(
    configured ?? ANNOUNCEMENT_HOLD_DEFAULT_MS,
    ANNOUNCEMENT_HOLD_MAX_MS,
  )
}

/** Test helper — peek without drain. */
export function peekScreenReaderAnnouncements(): readonly string[] {
  return queue
}

/**
 * densable `Ozs` — format deleted text for SR announcement.
 *
 * - empty kill → no-op
 * - masked input (mask !== "") → "deleted"
 * - whitespace-only: "new line" / "tab" / "space"
 * - otherwise: newlines → spaces, trim
 */
export function formatDeletedTextAnnouncement(
  killed: string,
  mask = '',
): string | undefined {
  if (killed === '') return undefined
  if (mask !== '') return 'deleted'
  if (killed.trim() === '') {
    if (killed.includes('\n')) return 'new line'
    if (killed.includes('\t')) return 'tab'
    return 'space'
  }
  return killed.replaceAll('\n', ' ').trim()
}

/**
 * densable `Ozs` + `pWr` combined — announce a kill for screen readers.
 */
export function announceDeletedText(killed: string, mask = ''): void {
  const text = formatDeletedTextAnnouncement(killed, mask)
  if (text !== undefined) announceForScreenReader(text)
}
