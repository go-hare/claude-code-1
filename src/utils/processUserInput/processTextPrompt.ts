import type { ContentBlockParam } from '@anthropic-ai/sdk/resources'
import { randomUUID } from 'crypto'
import { getPromptId, setPromptId } from 'src/bootstrap/state.js'
import type {
  AttachmentMessage,
  MessageOrigin,
  SystemMessage,
  UserMessage,
} from 'src/types/message.js'
import { logEvent } from '../../services/analytics/index.js'
import type { PermissionMode } from '../../types/permissions.js'
import { getBashTaskDeliveryBag } from '../bashTaskDeliveryOutcomes.js'
import { createUserMessage } from '../messages.js'
import { formatUserPromptForOTel, logOTelEvent } from '../telemetry/events.js'
import { startInteractionSpan } from '../telemetry/sessionTracing.js'
import {
  matchesKeepGoingKeyword,
  matchesNegativeKeyword,
} from '../userPromptKeywords.js'
import { inputPromptStampTelemetry } from './artStamps.js'

const CONTEXT_ONLY_XML_BLOCK_RE =
  /^\s*<(?:ide_selection|ide_opened_file|system-reminder)\b[\s\S]*<\/(?:ide_selection|ide_opened_file|system-reminder)>\s*$/

/**
 * Official 2.1.325 #2318: extract ALL user text fragments from string or
 * content-block array inputs so OpenTelemetry `user_prompt` events preserve
 * earlier messages' text when queued messages merge in VS Code or when a
 * message also includes an image block.
 *
 * Leading pure IDE/attachment wrapper blocks (`<ide_selection>`,
 * `<ide_opened_file>`, `<system-reminder>`) are excluded when actual user text
 * blocks are present.
 */
export function extractOtelUserPromptText(
  input: string | Array<ContentBlockParam>,
): string {
  if (typeof input === 'string') {
    return input
  }
  const allTexts: string[] = []
  const nonWrapperTexts: string[] = []
  for (const block of input) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      allTexts.push(block.text)
      if (!CONTEXT_ONLY_XML_BLOCK_RE.test(block.text)) {
        nonWrapperTexts.push(block.text)
      }
    }
  }
  const chosen = nonWrapperTexts.length > 0 ? nonWrapperTexts : allTexts
  return chosen.join('\n')
}

export type MidTurnQueuedPromptCommand = {
  mode: string
  value: string | Array<ContentBlockParam>
  uuid?: string
  isMeta?: boolean
  origin?: MessageOrigin
}

/**
 * Official 2.1.325 #2317 (`cu` -> `Lmt`): emit an OpenTelemetry `user_prompt`
 * event for each user prompt delivered mid-turn while tool calls are running,
 * tagged with `delivery.mode: "mid_turn"` and the running turn's `prompt.id`.
 */
export function emitMidTurnUserPromptOTelEvents(
  commands: readonly MidTurnQueuedPromptCommand[],
  runningPromptId: string | null | undefined = getPromptId(),
): number {
  let emitted = 0
  for (const cmd of commands) {
    if (cmd.mode !== 'prompt' || cmd.isMeta) continue
    const text = extractOtelUserPromptText(cmd.value)
    if (!text) continue
    const formatted = formatUserPromptForOTel(text, cmd.origin)
    void logOTelEvent('user_prompt', {
      prompt_length: String(text.length),
      prompt: formatted.prompt,
      ...(runningPromptId ? { 'prompt.id': runningPromptId } : {}),
      ...(cmd.uuid ? { 'message.uuid': cmd.uuid } : {}),
      'delivery.mode': 'mid_turn',
    })
    emitted++
  }
  return emitted
}

export function processTextPrompt(
  input: string | Array<ContentBlockParam>,
  imageContentBlocks: ContentBlockParam[],
  imagePasteIds: number[],
  attachmentMessages: AttachmentMessage[],
  uuid?: string,
  permissionMode?: PermissionMode,
  isMeta?: boolean,
  origin?: MessageOrigin,
  wakeupSource?: string,
  hostInitiator?: unknown,
  artifactCommentTurn?: unknown,
  taskDelivery?: unknown,
): {
  messages: (UserMessage | AttachmentMessage | SystemMessage)[]
  shouldQuery: boolean
} {
  const promptId = randomUUID()
  setPromptId(promptId)

  const userPromptText =
    typeof input === 'string'
      ? input
      : input.find(block => block.type === 'text')?.text || ''
  startInteractionSpan(userPromptText, undefined, origin)

  // Emit user_prompt OTEL event for both string (CLI) and array (SDK/VS Code)
  // input shapes. Official 2.1.325 #2318: keep ALL user text fragments across
  // merged queued messages and text+image messages instead of `.findLast()`.
  const otelPromptText = extractOtelUserPromptText(input)
  // densable: message uuid is assigned before user_prompt OTel so message.uuid
  // rides the event (vc("user_prompt", {..., "message.uuid": de})).
  const messageUuid = uuid ?? randomUUID()

  if (otelPromptText) {
    const formattedPrompt = formatUserPromptForOTel(otelPromptText, origin)
    void logOTelEvent('user_prompt', {
      prompt_length: String(otelPromptText.length),
      prompt: formattedPrompt.prompt,
      'prompt.id': promptId,
      'message.uuid': messageUuid,
    })
  }

  const isNegative = matchesNegativeKeyword(userPromptText)
  const isKeepGoing = matchesKeepGoingKeyword(userPromptText)
  const stampTelemetry = inputPromptStampTelemetry({
    wakeupSource,
    hostInitiator,
    artifactCommentTurn,
  })
  logEvent('tengu_input_prompt', {
    is_negative: isNegative,
    is_keep_going: isKeepGoing,
    ...stampTelemetry,
  })

  // densable pun @191452578: skip stamping taskDelivery when GetTask already fetched.
  const deliveryTaskId =
    taskDelivery && typeof taskDelivery === 'object'
      ? (taskDelivery as { taskId?: unknown }).taskId
      : undefined
  const effectiveTaskDelivery =
    typeof deliveryTaskId === 'string' &&
    getBashTaskDeliveryBag().bashTaskSnapshots.get(deliveryTaskId)?.fetched
      ? undefined
      : taskDelivery

  // If we have pasted images, create a message with image content
  if (imageContentBlocks.length > 0) {
    // Build content: text first, then images below
    const textContent =
      typeof input === 'string'
        ? input.trim()
          ? [{ type: 'text' as const, text: input }]
          : []
        : input
    const userMessage = createUserMessage({
      content: [...textContent, ...imageContentBlocks],
      uuid: messageUuid,
      imagePasteIds: imagePasteIds.length > 0 ? imagePasteIds : undefined,
      permissionMode,
      isMeta: isMeta || undefined,
      origin,
      ...(effectiveTaskDelivery !== undefined && {
        taskDelivery: effectiveTaskDelivery,
      }),
    })

    return {
      messages: [userMessage, ...attachmentMessages],
      shouldQuery: true,
    }
  }

  const userMessage = createUserMessage({
    content: input,
    uuid: messageUuid,
    permissionMode,
    isMeta: isMeta || undefined,
    origin,
    ...(effectiveTaskDelivery !== undefined && {
      taskDelivery: effectiveTaskDelivery,
    }),
  })

  return {
    messages: [userMessage, ...attachmentMessages],
    shouldQuery: true,
  }
}
