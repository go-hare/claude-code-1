import type {
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import type { UUID } from 'crypto'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import { detectImageFormatFromBase64 } from '../utils/imageResizer.js'
import { parseInboundFileAttachments } from '../utils/processUserInput/inboundFileAttachments.js'

/**
 * Process an inbound user message from the bridge, extracting content
 * and UUID for enqueueing. Supports both string content and
 * ContentBlockParam[] (e.g. messages containing images).
 *
 * Normalizes image blocks from bridge clients that may use camelCase
 * `mediaType` instead of snake_case `media_type` (mobile-apps#5825).
 *
 * Returns the extracted fields, or undefined if the message should be
 * skipped (non-user type, missing/empty content).
 */

/**
 * Official 2.1.323 #2066: detect whether an inbound user message from
 * claude.ai / Claude Desktop contains non-typed @-mention spans (file titles,
 * app names, session names) or carries an explicit `text_not_typed` /
 * `mentions` metadata stamp so those spans are NOT treated as user-typed text.
 */
export function hasUntypedAtMentionMetadata(msg: unknown): boolean {
  if (typeof msg !== 'object' || msg === null) return false
  const rec = msg as Record<string, unknown>
  if (rec.text_not_typed === true || rec.textNotTyped === true) return true
  const message = rec.message as Record<string, unknown> | undefined
  if (message?.text_not_typed === true || message?.textNotTyped === true) {
    return true
  }
  const content = message?.content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      const b = block as Record<string, unknown>
      if (
        b.text_not_typed === true ||
        b.textNotTyped === true ||
        b.type === 'mention' ||
        b.type === 'at_mention' ||
        b.type === 'resource_mention' ||
        b.type === 'session_mention' ||
        b.type === 'app_mention'
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * Official 2.1.323 #2066: when an inbound message contains structured
 * @-mention blocks (file titles, app names, session names) from claude.ai or
 * Claude Desktop, keep them out of user-typed text parsing by neutralizing
 * leading slash/at-mention triggers and tagging `textNotTyped: true`.
 */
export function normalizeUntypedMentionBlocks(
  blocks: Array<ContentBlockParam>,
): { blocks: Array<ContentBlockParam>; hadUntypedMention: boolean } {
  let hadUntypedMention = false
  const out: Array<ContentBlockParam> = []
  for (const raw of blocks) {
    const b = raw as unknown as Record<string, unknown>
    if (
      b.type === 'mention' ||
      b.type === 'at_mention' ||
      b.type === 'resource_mention' ||
      b.type === 'session_mention' ||
      b.type === 'app_mention'
    ) {
      hadUntypedMention = true
      const title =
        (typeof b.title === 'string' && b.title) ||
        (typeof b.name === 'string' && b.name) ||
        (typeof b.label === 'string' && b.label) ||
        (typeof b.text === 'string' && b.text) ||
        ''
      if (title) {
        out.push({
          type: 'text',
          text: title,
        })
      }
      continue
    }
    if (b.text_not_typed === true || b.textNotTyped === true) {
      hadUntypedMention = true
    }
    out.push(raw)
  }
  return { blocks: hadUntypedMention ? out : blocks, hadUntypedMention }
}

export function extractInboundMessageFields(msg: SDKMessage):
  | {
      content: string | Array<ContentBlockParam>
      uuid: UUID | undefined
      /** Official: `client_platform` on inbound user → QueuedCommand.clientPlatform. */
      clientPlatform: string | undefined
      /** densable inbound D7 @202257989 — `file_attachments` stamp. */
      fileAttachments: ReturnType<typeof parseInboundFileAttachments>
      /** Official 2.1.323 #2066 (`textNotTyped`): true when @-mention titles/names came from claude.ai/desktop picker rather than user typing. */
      textNotTyped: boolean
    }
  | undefined {
  if (msg.type !== 'user') return undefined
  const content = (
    msg.message as { content?: string | Array<ContentBlockParam> } | undefined
  )?.content
  if (!content) return undefined
  if (Array.isArray(content) && content.length === 0) return undefined

  const uuid =
    'uuid' in msg && typeof msg.uuid === 'string'
      ? (msg.uuid as UUID)
      : undefined

  // Official IPO/g94: "client_platform" in H && typeof === string
  const rawPlatform = (msg as unknown as { client_platform?: unknown })
    .client_platform
  const clientPlatform =
    typeof rawPlatform === 'string' ? rawPlatform : undefined

  const mentionMeta = hasUntypedAtMentionMetadata(msg)
  let normalizedContent: string | Array<ContentBlockParam> = content
  let hadUntypedMention = mentionMeta
  if (Array.isArray(content)) {
    const imgNorm = normalizeImageBlocks(content)
    const mentionNorm = normalizeUntypedMentionBlocks(imgNorm)
    normalizedContent = mentionNorm.blocks
    hadUntypedMention ||= mentionNorm.hadUntypedMention
  }

  return {
    content: normalizedContent,
    uuid,
    clientPlatform,
    fileAttachments: parseInboundFileAttachments(msg),
    textNotTyped: hadUntypedMention,
  }
}

/**
 * Normalize image content blocks from bridge clients. iOS/web clients may
 * send `mediaType` (camelCase) instead of `media_type` (snake_case), or
 * omit the field entirely. Without normalization, the bad block poisons
 * the session — every subsequent API call fails with
 * "media_type: Field required".
 *
 * Fast-path scan returns the original array reference when no
 * normalization is needed (zero allocation on the happy path).
 */
export function normalizeImageBlocks(
  blocks: Array<ContentBlockParam>,
): Array<ContentBlockParam> {
  if (!blocks.some(isMalformedBase64Image)) return blocks

  return blocks.map(block => {
    if (!isMalformedBase64Image(block)) return block
    const src = block.source as unknown as Record<string, unknown>
    const mediaType =
      typeof src.mediaType === 'string' && src.mediaType
        ? src.mediaType
        : detectImageFormatFromBase64(block.source.data)
    return {
      ...block,
      source: {
        type: 'base64' as const,
        media_type: mediaType as Base64ImageSource['media_type'],
        data: block.source.data,
      },
    }
  })
}

function isMalformedBase64Image(
  block: ContentBlockParam,
): block is ImageBlockParam & { source: Base64ImageSource } {
  if (block.type !== 'image' || block.source?.type !== 'base64') return false
  return !(block.source as unknown as Record<string, unknown>).media_type
}
