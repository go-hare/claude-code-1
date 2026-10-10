/**
 * densable 2.1.289 Skt / bHo / Bhe — focus-fold holds the streaming preview.
 *
 * Gold Skt:
 *   focusFoldHoldsPreview =
 *     isLoading && briefTranscript && screen !== 'transcript' && fullscreen
 *     && (tailBlank || streamingToolUses.length > 0 || bHo(messages))
 *
 * Gold Ve (Messages hasStreamingText / Oa mount):
 *   isLoading && isMain && hasDisplayed && !focusFoldHoldsPreview
 *
 * Gold spinner: !hasDisplayed || tailBlank || isBriefOnly || focusFoldHoldsPreview
 *
 * Do not use this to hide Ty displayed (closed-prefix). Fold only unmounts Oa.
 */

import { isHumanLikeOrigin } from './messages.js'

type ContentBlock = { type?: string }

export type FocusFoldMessage = {
  type?: string
  isMeta?: boolean
  message?: { content?: unknown }
  attachment?: {
    type?: string
    commandMode?: string
    isMeta?: boolean
    origin?: { kind?: string }
  }
}

/**
 * densable Bhe — visible queued prompt attachment (turn boundary for bHo).
 * queued_command prompt kept when (!isMeta && human-like) or channel/peer/slack-ping.
 */
export function isVisibleQueuedPromptAttachment(
  msg: FocusFoldMessage,
): boolean {
  if (msg.type !== 'attachment') return false
  const n = msg.attachment
  if (n?.type !== 'queued_command' || n.commandMode !== 'prompt') {
    return false
  }
  if (!n.isMeta && isHumanLikeOrigin(n.origin)) return true
  const kind = n.origin?.kind
  return kind === 'channel' || kind === 'peer' || kind === 'slack-ping'
}

function contentBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return []
  return content.filter(
    (b): b is ContentBlock => b !== null && typeof b === 'object',
  )
}

/**
 * densable bHo — trailing open tool_use turn (walk from the end).
 * assistant tool_use → true; real user (no tool_result, !isMeta) or Bhe → false.
 */
export function messagesHoldFocusFold(
  messages: ReadonlyArray<FocusFoldMessage>,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const r = messages[i]!
    if (r.type === 'assistant') {
      if (contentBlocks(r.message?.content).some(s => s.type === 'tool_use')) {
        return true
      }
    } else if (r.type === 'user') {
      const hasToolResult = contentBlocks(r.message?.content).some(
        h => h.type === 'tool_result',
      )
      if (!hasToolResult && !r.isMeta) return false
    } else if (r.type === 'attachment' && isVisibleQueuedPromptAttachment(r)) {
      return false
    }
  }
  return false
}

export type FocusFoldHoldsPreviewInput = {
  isLoading: boolean
  briefTranscript: boolean
  screen: string
  fullscreen: boolean
  tailBlank: boolean
  streamingToolUseCount: number
  messages: ReadonlyArray<FocusFoldMessage>
}

/** densable Skt.focusFoldHoldsPreview */
export function resolveFocusFoldHoldsPreview(
  opts: FocusFoldHoldsPreviewInput,
): boolean {
  if (
    !(
      opts.isLoading &&
      opts.briefTranscript &&
      opts.screen !== 'transcript' &&
      opts.fullscreen
    )
  ) {
    return false
  }
  return (
    opts.tailBlank ||
    opts.streamingToolUseCount > 0 ||
    messagesHoldFocusFold(opts.messages)
  )
}

/**
 * densable `Jfr(l,u,m,p)` — tri-state streaming preview hold for `xSe`.
 * Distinct from Skt boolean (Oa unmount). Gold:
 *   if (screen==="transcript" || isBriefOnly) return "hidden"
 *   return briefTranscript && layout==="fullscreen" ? "focus" : "none"
 */
export type StreamingPreviewHold = 'hidden' | 'focus' | 'none'

export function resolveStreamingPreviewHold(
  screen: string,
  isBriefOnly: boolean,
  briefTranscript: boolean,
  layout: string,
): StreamingPreviewHold {
  if (screen === 'transcript' || isBriefOnly) return 'hidden'
  return briefTranscript && layout === 'fullscreen' ? 'focus' : 'none'
}

/**
 * densable `det(h)` next to `xSe` — raw has a completed (non-empty) line.
 */
export function streamingRawHasCompletedLine(raw: string | null): boolean {
  if (raw === null) return false
  const v = raw.lastIndexOf('\n')
  return v !== -1 && /\S/.test(raw.slice(0, v))
}

/**
 * densable `xSe._previewOnScreen(h,v,M)`:
 *   none → true; hidden → false;
 *   focus → !turnHasToolUse && streamingToolUses.length===0 && det(raw)
 */
export function isStreamingPreviewOnScreen(
  raw: string | null,
  hold: StreamingPreviewHold,
  turnHasToolUse: boolean,
  streamingToolUseCount: number,
): boolean {
  switch (hold) {
    case 'none':
      return true
    case 'hidden':
      return false
    case 'focus':
      return (
        !turnHasToolUse &&
        streamingToolUseCount === 0 &&
        streamingRawHasCompletedLine(raw)
      )
  }
}
