/**
 * densable 2.1.218 `pWr` / `GJc` / `Ozs` — ephemeral screen-reader announcements
 * for deleted text (word/line kills) and similar transient events.
 *
 * Announcements are queued and drained on the next `onRenderScreenReader` paint
 * so VoiceOver/NVDA speak the killed text without needing a permanent DOM node.
 */

const MAX_QUEUE = 16
let queue: string[] = []

/**
 * densable `pWr` — push an announcement; keep only the last MAX_QUEUE items.
 */
export function announceForScreenReader(text: string): void {
  if (text === '') return
  queue.push(text)
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
