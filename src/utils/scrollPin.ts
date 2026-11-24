import type { UUID } from 'node:crypto'
import { type ScrollBoxHandle, ScrollViewport } from '@anthropic/ink'
import type { Message } from '../types/message.js'
import { getAutoScrollEnabled } from './config.js'
import { logForDebugging } from './debug.js'
import { isHumanTurn } from './messagePredicates.js'
import type { SubscribableTranscript } from './transcriptStore.js'

/**
 * Official 2.1.328 `KEs` (@318476113 @18650): true when an assistant message
 * contains at least one non-whitespace text block (tool-use-only rows return
 * false so they neither increment unseen turn counts nor advance `#w`).
 */
export function assistantHasVisibleText(m: Message): boolean {
  if (m.type !== 'assistant') return false
  const content = m.message?.content
  if (!Array.isArray(content)) return false
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      block.type === 'text' &&
      typeof block.text === 'string' &&
      block.text.trim() !== ''
    ) {
      return true
    }
  }
  return false
}

export type UnseenDivider = {
  firstUnseenUuid: UUID
  count: number
}

export type ScrollPinSnapshot = {
  dividerY: number | null
  unseenDivider: UnseenDivider | undefined
}

export type ScrollPinRevealHost = {
  reveal: (
    requestId: string,
    block?: 'start' | 'center' | 'end' | 'nearest',
  ) => Promise<boolean> | null
  release: () => void
  rowHolding: (selection: unknown) => string | undefined
}

export type ScrollDialogBounds = {
  row: number
  rows: number
}

const EMPTY_SNAPSHOT: ScrollPinSnapshot = {
  dividerY: null,
  unseenDivider: undefined,
}

function messageUuid(msg: Message | undefined): string | null {
  const uuid: unknown = msg && 'uuid' in msg ? msg.uuid : undefined
  return typeof uuid === 'string' && uuid.length > 0 ? uuid : null
}

function headMessageUuid(messages: readonly Message[]): string | null {
  return messageUuid(messages[0])
}

function hasMessageWithUuid(
  messages: readonly Message[],
  uuid: string,
): boolean {
  for (let i = 0; i < messages.length; i++) {
    if (messageUuid(messages[i]) === uuid) return true
  }
  return false
}

/**
 * Distinguish older-history prepends (`useAssistantHistory`: `[...older, ...prev]`,
 * `[sentinel, ...prev]`, or replacing a leading `system/informational` loading
 * sentinel with `[...older, ...prev.slice(1)]`) from full transcript replacements
 * (compaction, `/clear`, `/resume`) where the prior head is gone.
 */
function isPrependOrSentinelSwap(
  prevMessages: readonly Message[],
  prevHeadUuid: string,
  nextMessages: readonly Message[],
): boolean {
  if (hasMessageWithUuid(nextMessages, prevHeadUuid)) {
    return true
  }
  const prevHead = prevMessages[0]
  if (prevHead?.type === 'system' && prevHead.subtype === 'informational') {
    const prevSecondUuid = messageUuid(prevMessages[1])
    if (
      prevSecondUuid !== null &&
      hasMessageWithUuid(nextMessages, prevSecondUuid)
    ) {
      return true
    }
  }
  return false
}

function computeDialogTarget(
  handle: ScrollBoxHandle,
  bounds?: ScrollDialogBounds,
): { top: number; bottom: number } {
  const vh = handle.getViewportHeight()
  const bottom = Math.max(0, handle.getScrollHeight() - vh)
  const top =
    bounds === undefined
      ? bottom
      : Math.min(bottom, Math.max(0, bounds.row + bounds.rows - vh))
  return { top, bottom }
}

/**
 * Official 2.1.328 `Zse` — centralized scroll pin & unseen-divider controller.
 *
 * Owns `viewport`, `modalViewport`, `revealRef`, unseen divider state,
 * repin rules (`onPromptEdit`, `onUserRowLanded`, `onBelowTranscriptSlotChange`),
 * and dialog scroll anchoring (`showDialog`, `followDialog`, `onDialogLeft`).
 */
export class ScrollPin {
  readonly viewport = new ScrollViewport()
  readonly modalViewport = new ScrollViewport()
  readonly revealRef: { current: ScrollPinRevealHost | null } = {
    current: null,
  }

  private readonly computeDivider: (
    messages: readonly Message[],
    dividerIndex: number | null,
  ) => UnseenDivider | undefined
  private readonly onUserScrolledHook?: () => void
  private readonly transcriptUnsub: (() => void) | undefined
  private readonly listeners = new Set<() => void>()
  private snapshot: ScrollPinSnapshot = EMPTY_SNAPSHOT
  private messages: readonly Message[] = []
  private firstMessageUuid: string | null = null
  private dividerIndex: number | null = null
  private lastMessageCount = -1
  private renderedLength: number | null = null
  private replyStreaming = false
  private wasStreamingAtScrollAway = false
  private scrolledAway = false
  private dialogReturnTarget: number | 'bottom' | null = null
  private dialogPinnedTop: number | null = null
  private prevBelowTranscriptSlot: boolean | undefined = undefined

  constructor(opts: {
    transcript?: SubscribableTranscript
    computeDivider: (
      messages: readonly Message[],
      dividerIndex: number | null,
    ) => UnseenDivider | undefined
    onUserScrolled?: () => void
  }) {
    this.computeDivider = opts.computeDivider
    this.onUserScrolledHook = opts.onUserScrolled
    if (opts.transcript) {
      const store = opts.transcript
      this.messages = store.getSnapshot()
      this.firstMessageUuid = headMessageUuid(this.messages)
      this.transcriptUnsub = store.subscribe(() => {
        this.syncMessages(store.getSnapshot())
      })
    }
  }

  dispose(): void {
    this.transcriptUnsub?.()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  getSnapshot = (): ScrollPinSnapshot => this.snapshot

  get dividerY(): number | null {
    return this.snapshot.dividerY
  }

  get isScrolledAway(): boolean {
    return this.scrolledAway
  }

  setRenderedLength(len: number | null): void {
    this.renderedLength = len
  }

  setReplyStreaming(streaming: boolean): void {
    this.replyStreaming = streaming
  }

  syncMessages(messages: readonly Message[]): void {
    const prevMessages = this.messages
    const prevHeadUuid = this.firstMessageUuid
    const nextHeadUuid = headMessageUuid(messages)
    const headChanged = prevHeadUuid !== null && nextHeadUuid !== prevHeadUuid
    this.messages = messages

    if (headChanged) {
      if (isPrependOrSentinelSwap(prevMessages, prevHeadUuid, messages)) {
        // Older history was prepended (or a transient loading sentinel at
        // index 0 was inserted/replaced). Keep dividerIndex, dividerY,
        // unseenDivider, renderedLength, scrolledAway, and reveal/dialog state
        // intact so `useAssistantHistory`'s `shiftDivider` shifts cleanly.
        this.firstMessageUuid = nextHeadUuid
        this.lastMessageCount = messages.length
        return
      }
      // Transcript head replaced (compaction, /clear, or /resume).
      // Even when postCompact.length >= dividerIndex, the prior dividerY,
      // dividerIndex, unseenDivider, and scrolledAway state belong to the old
      // transcript and must be reset cleanly.
      this.clearRevealAndDialog()
      this.dividerIndex = null
      this.wasStreamingAtScrollAway = false
      this.scrolledAway = false
      this.renderedLength = null
      this.firstMessageUuid = nextHeadUuid
      this.updateSnapshot(null, messages)
      return
    }

    if (this.firstMessageUuid === null && nextHeadUuid !== null) {
      this.firstMessageUuid = nextHeadUuid
    }

    if (this.dividerIndex === null) return
    if (messages.length < this.dividerIndex) {
      this.dividerIndex = null
      this.wasStreamingAtScrollAway = false
      this.updateSnapshot(null, messages)
      return
    }
    if (messages.length !== this.lastMessageCount) {
      this.updateSnapshot(this.snapshot.dividerY, messages)
    }
  }

  /**
   * Explicitly reset unseen divider, scroll-away flag, and dialog pin state
   * when conversation compaction replaces the transcript.
   */
  resetForCompaction = (nextMessages?: readonly Message[]): void => {
    if (nextMessages !== undefined) {
      this.messages = nextMessages
    }
    this.clearRevealAndDialog()
    this.dividerIndex = null
    this.wasStreamingAtScrollAway = false
    this.scrolledAway = false
    this.renderedLength = null
    this.firstMessageUuid = headMessageUuid(this.messages)
    this.updateSnapshot(null, this.messages)
  }

  /**
   * Explicitly sync ScrollPin state when exiting `ctrl+o` transcript view back
   * to prompt mode so stale scrolledAway / unseenDivider state cannot stick.
   */
  resetForTranscriptExit = (): void => {
    this.clearRevealAndDialog()
    this.dividerIndex = null
    this.wasStreamingAtScrollAway = false
    this.scrolledAway = false
    this.prevBelowTranscriptSlot = undefined
    this.updateSnapshot(null, this.messages)
    this.viewport.handle?.scrollToBottom()
  }

  shiftDivider = (indexDelta: number, heightDelta: number): void => {
    if (this.dividerIndex !== null) {
      this.dividerIndex += indexDelta
    }
    const nextY =
      this.snapshot.dividerY !== null
        ? this.snapshot.dividerY + heightDelta
        : null
    this.updateSnapshot(nextY, this.messages)
  }

  isAtBottom = (): boolean => this.viewport.handle?.isSticky() ?? true

  repin = (force = false, reason = '?'): void => {
    if (!force && !getAutoScrollEnabled()) return
    const handle = this.viewport.handle
    if (handle && !handle.isSticky()) {
      const max = Math.max(
        0,
        handle.getScrollHeight() - handle.getViewportHeight(),
      )
      logForDebugging(
        `repinScroll(${reason}, force=${force}): yanking from scrollTop=${handle.getScrollTop()} (max=${max})`,
      )
    }
    this.clearRevealAndDialog()
    handle?.scrollToBottom()
    this.clearDividerDeferred()
    this.scrolledAway = false
  }

  onPromptEdit(next: string, prev: string): void {
    if (prev !== '' || next === '' || this.scrolledAway) return
    this.repin(false, 'typedIntoEmpty')
  }

  onUserRowLanded(msg: Message): void {
    const promptSource = (msg as { promptSource?: string }).promptSource
    const ownSubmit =
      (promptSource === 'typed' || promptSource === 'suggestion_accepted') &&
      isHumanTurn(msg)
    if (ownSubmit || !this.scrolledAway) {
      this.repin(false, ownSubmit ? 'ownSubmitLanded' : 'rowLanded')
    }
  }

  onBelowTranscriptSlotChange(open: boolean): void {
    const prev = this.prevBelowTranscriptSlot
    this.prevBelowTranscriptSlot = open
    if (prev === undefined || prev === open) return
    if (
      this.dialogReturnTarget === null &&
      (this.viewport.handle?.isSticky() ?? true)
    ) {
      this.repin(false, `progressOrPanel→${open}`)
    }
  }

  onUserScroll = (sticky: boolean, handle: ScrollBoxHandle): void => {
    this.clearRevealAndDialog()
    this.onUserScrolledHook?.()
    this.scrolledAway = !sticky
    if (sticky) {
      this.clearDividerDeferred()
    } else {
      this.snapshotDividerAtScrollAway(handle)
    }
  }

  onUserScrollWithoutDivider = (sticky: boolean): void => {
    this.clearRevealAndDialog()
    this.scrolledAway = !sticky
  }

  reveal = async (
    requestId: string,
    block?: 'start' | 'center' | 'end' | 'nearest',
  ): Promise<'unscrollable' | 'revealed' | 'unknown'> => {
    const host = this.revealRef.current
    if (!this.viewport.handle || !host) return 'unscrollable'
    const promise = host.reveal(requestId, block)
    if (!promise) return 'unknown'
    this.scrolledAway = true
    this.clearDialogPin()
    return (await promise) ? 'revealed' : 'unknown'
  }

  rowHolding = (selection: unknown): string | undefined =>
    this.revealRef.current?.rowHolding(selection)

  releaseReveal = (): void => {
    this.revealRef.current?.release()
  }

  jumpToNew = (): void => {
    this.clearRevealAndDialog()
    this.viewport.handle?.scrollToBottom()
    this.scrolledAway = false
  }

  showDialog = (
    bounds: ScrollDialogBounds | undefined,
    restoreAfter: boolean,
  ): boolean => {
    const handle = this.viewport.handle
    if (!handle) return false
    const { top, bottom } = computeDialogTarget(handle, bounds)
    const cur = handle.getScrollTop() + handle.getPendingDelta()
    const sticky = handle.isSticky()
    const autoFollow = sticky || getAutoScrollEnabled()
    if (top < bottom || (!restoreAfter && !autoFollow)) {
      if (cur === top && !sticky) return false
      logForDebugging(`ScrollPin.showDialog: from scrollTop=${cur} to ${top}`)
      this.releaseReveal()
      this.dialogReturnTarget ??=
        restoreAfter && !sticky ? cur : autoFollow ? 'bottom' : null
      this.scrolledAway = true
      this.dialogPinnedTop = top
      handle.scrollTo(top)
      return true
    }
    if (sticky) return false
    if (!restoreAfter) {
      this.repin(true, 'dialog')
      return true
    }
    logForDebugging(`ScrollPin.showDialog: from scrollTop=${cur}`)
    this.releaseReveal()
    this.dialogReturnTarget ??= cur
    handle.scrollToBottom()
    return true
  }

  followDialog = (bounds: ScrollDialogBounds | undefined): void => {
    const handle = this.viewport.handle
    if (this.dialogPinnedTop === null || !handle || bounds === undefined) return
    const cur = handle.getScrollTop() + handle.getPendingDelta()
    const { top } = computeDialogTarget(handle, bounds)
    if (cur !== this.dialogPinnedTop && cur !== top) {
      this.clearDialogPin()
      return
    }
    this.dialogPinnedTop = top
    if (cur !== top) handle.scrollTo(top)
  }

  onDialogLeft = (): void => {
    const target = this.dialogReturnTarget
    this.clearDialogPin()
    if (target === 'bottom') {
      this.repin(true, 'dialogLeft')
    } else if (target !== null) {
      this.viewport.handle?.scrollTo(target)
    }
  }

  private clearRevealAndDialog(): void {
    this.releaseReveal()
    this.clearDialogPin()
  }

  private clearDialogPin(): void {
    this.dialogReturnTarget = null
    this.dialogPinnedTop = null
  }

  private snapshotDividerAtScrollAway(handle: ScrollBoxHandle): void {
    const max = Math.max(
      0,
      handle.getScrollHeight() - handle.getViewportHeight(),
    )
    if (handle.getScrollTop() + handle.getPendingDelta() >= max) return
    if (this.snapshot.dividerY !== null) return
    this.dividerIndex = this.renderedLength ?? this.messages.length
    this.wasStreamingAtScrollAway = this.replyStreaming
    this.updateSnapshot(handle.getScrollHeight(), this.messages)
  }

  private clearDividerDeferred(): void {
    const prevY = this.snapshot.dividerY
    if (prevY === null) return
    this.dividerIndex = null
    this.updateSnapshot(prevY, this.messages)
    queueMicrotask(() => {
      if (this.dividerIndex === null) {
        this.updateSnapshot(null, this.messages)
      }
    })
  }

  private updateSnapshot(
    dividerY: number | null,
    messages: readonly Message[],
  ): void {
    this.lastMessageCount = messages.length
    const prev = this.snapshot
    if (this.wasStreamingAtScrollAway && this.dividerIndex !== null) {
      const candidate = this.computeDivider(
        messages,
        this.dividerIndex,
      )?.firstUnseenUuid
      if (candidate !== undefined) {
        this.wasStreamingAtScrollAway = false
        const idx = messages.findLastIndex(
          m => 'uuid' in m && m.uuid === candidate,
        )
        const msg = idx >= 0 ? messages[idx] : undefined
        if (
          msg?.type === 'assistant' &&
          !msg.isApiErrorMessage &&
          assistantHasVisibleText(msg)
        ) {
          this.dividerIndex = idx + 1
        }
      }
    }
    const nextRaw = this.computeDivider(messages, this.dividerIndex)
    const nextDivider =
      nextRaw?.firstUnseenUuid === prev.unseenDivider?.firstUnseenUuid &&
      nextRaw?.count === prev.unseenDivider?.count
        ? prev.unseenDivider
        : nextRaw
    if (dividerY === prev.dividerY && nextDivider === prev.unseenDivider) return
    this.snapshot =
      dividerY === null && nextDivider === undefined
        ? EMPTY_SNAPSHOT
        : { dividerY, unseenDivider: nextDivider }
    this.emit()
  }
}
