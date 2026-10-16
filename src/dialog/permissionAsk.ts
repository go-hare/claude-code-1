/**
 * densable Vru submit analog.
 *
 * Gold 2.1.239: jsu `vM(v4t,Vru)`. Esc/onCancel → `{behavior:"deny"}`.
 * Submit `{behavior:"allow", updatedInput:{...input, answers}}`.
 * DualInk analog: images + afkTimeoutMs + annotations. Omit gold
 * image convert.
 * Host answer only; do not dequeue.
 */
import type {
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import type {
  Question,
  QuestionOption,
} from '@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { stringWidth } from '@anthropic/ink'
import type { PastedContent } from '../utils/config.js'
import { maybeResizeAndDownsampleImageBlock } from '../utils/imageResizer.js'
import type { PermissionRequestSource } from './permissionRequestSource.js'
import type { PermissionPromptResult } from './specs/permissionKinds.js'

/** densable hpy */
export const OFY_PREVIEW_CAP = 2000

/** densable Ofy preview */
export type AskPreview =
  | { kind: 'full'; markdown: string }
  | { kind: 'withheld' }

export type HostAskQuestionOption = {
  label: string
  description?: string
  preview?: AskPreview
}

export type EngineConfirmDisplayBody =
  | { kind: 'text'; text: string }
  | { kind: 'fileLink'; label: string; url: string; path: string }

export type HostAskQuestion = {
  question: string
  header?: string
  options: HostAskQuestionOption[]
  multiSelect?: boolean
  /** densable DY displayQuestion when isEngineConfirm. */
  displayQuestion?: string
  /** densable DY displayBody when isEngineConfirm. */
  displayBody?: EngineConfirmDisplayBody[]
}

export type AskUserQuestionPermissionPayload = {
  requestId: string
  toolName: string
  permissionResult: unknown
  input?: unknown
  questions: unknown[]
  metadataSource?: unknown
  showAlwaysAllow?: boolean
  isAskCappedByOrg?: boolean
  requestSource?: PermissionRequestSource
  isMcp?: boolean
  /**
   * densable `_o` isEngineConfirm. DualInk Qge UI calls DY(questions,
   * isEngineConfirm) so the question splits on the first blank line.
   */
  isEngineConfirm?: boolean
}

export type AskUserQuestionAnnotation = {
  preview?: string
  notes?: string
}

/** densable UVe — visible after FFFD/ws collapse. oge/WSt invent-ban. */
function isOfyDisplayable(value: string): boolean {
  const collapsed = value
    .replace(/\uFFFD/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return collapsed !== '' && stringWidth(collapsed) > 0
}

/** densable Ofy preview arm. MJn/Kil/Ug invent-ban — store string. */
export function mapOfyPreview(raw: unknown): AskPreview | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'object') {
    const rec = raw as { kind?: unknown; markdown?: unknown }
    if (rec.kind === 'withheld') return { kind: 'withheld' }
    if (rec.kind === 'full' && typeof rec.markdown === 'string') {
      return mapOfyPreview(rec.markdown)
    }
    return undefined
  }
  if (typeof raw !== 'string') return undefined
  if (raw.length > OFY_PREVIEW_CAP) return { kind: 'withheld' }
  if (!isOfyDisplayable(raw)) return undefined
  return { kind: 'full', markdown: raw }
}

function previewOf(raw: unknown): AskPreview | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  return mapOfyPreview((raw as { preview?: unknown }).preview)
}

function optionOf(raw: unknown): HostAskQuestionOption | null {
  if (typeof raw !== 'object' || raw === null) return null
  const label = (raw as { label?: unknown }).label
  if (typeof label !== 'string' || label === '') return null
  const description = (raw as { description?: unknown }).description
  const preview = previewOf(raw)
  return {
    label,
    ...(typeof description === 'string' ? { description } : {}),
    ...(preview ? { preview } : {}),
  }
}

const ENGINE_CONFIRM_FILE_LINK = /\[([^[\]\n]*)\]\(([^()\s]*)\)/g

/**
 * densable jyo — split engine-confirm question on the first blank line.
 * Title is the first paragraph; body parses markdown file links.
 */
export function splitEngineConfirmQuestion(question: string): {
  title: string
  body: EngineConfirmDisplayBody[]
} {
  const at = question.indexOf('\n\n')
  if (at === -1) return { title: question, body: [] }
  const rest = question.slice(at + 2).replace(/^\n+/, '')
  return {
    title: question.slice(0, at),
    body: rest === '' ? [] : parseEngineConfirmBody(rest),
  }
}

function parseEngineConfirmBody(raw: string): EngineConfirmDisplayBody[] {
  const out: EngineConfirmDisplayBody[] = []
  let pending = ''
  let cursor = 0
  for (const match of raw.matchAll(ENGINE_CONFIRM_FILE_LINK)) {
    const [full, label = '', href = ''] = match
    const path = fileUrlPath(href)
    pending += raw.slice(cursor, match.index)
    cursor = (match.index ?? 0) + full.length
    if (path === null) {
      pending += full
      continue
    }
    if (pending !== '') {
      out.push({ kind: 'text', text: pending })
      pending = ''
    }
    out.push({ kind: 'fileLink', label, url: href, path })
  }
  pending += raw.slice(cursor)
  if (pending !== '') out.push({ kind: 'text', text: pending })
  return out
}

function fileUrlPath(href: string): string | null {
  if (!/^file:\/\/\//i.test(href)) return null
  try {
    return new URL(href).pathname
  } catch {
    return null
  }
}

/**
 * densable DY(h, v=!1) — when isEngineConfirm, fill displayQuestion/body.
 * Answer key stays `question` (gold `key: M.question`).
 */
export function applyEngineConfirmDisplay(
  questions: HostAskQuestion[],
  isEngineConfirm: boolean,
): HostAskQuestion[] {
  if (!isEngineConfirm) return questions
  return questions.map(q => {
    const split = splitEngineConfirmQuestion(q.question)
    return {
      ...q,
      displayQuestion: split.title,
      displayBody: split.body,
    }
  })
}

/** densable Ofy — keep questions that have a question string (`key`). */
export function normalizeAskQuestions(raw: unknown): HostAskQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: HostAskQuestion[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as {
      question?: unknown
      header?: unknown
      options?: unknown
      multiSelect?: unknown
    }
    if (typeof rec.question !== 'string' || rec.question === '') continue
    const options = Array.isArray(rec.options)
      ? rec.options.flatMap(opt => {
          const parsed = optionOf(opt)
          return parsed ? [parsed] : []
        })
      : []
    out.push({
      question: rec.question,
      ...(typeof rec.header === 'string' ? { header: rec.header } : {}),
      options,
      ...(rec.multiSelect === true ? { multiSelect: true } : {}),
    })
  }
  return out
}

/**
 * DualInk Question mapping. header/description default `''`.
 * Preview string only when Ofy kind==="full". withheld → omit.
 */
export function toDualInkQuestions(questions: HostAskQuestion[]): Question[] {
  return questions.map(q => ({
    question: q.question,
    header: q.header ?? '',
    options: q.options.map((opt): QuestionOption => {
      const markdown =
        opt.preview?.kind === 'full' ? opt.preview.markdown : undefined
      return {
        label: opt.label,
        description: opt.description ?? '',
        ...(markdown ? { preview: markdown } : {}),
      }
    }),
    multiSelect: q.multiSelect === true,
  }))
}

export type AskUserQuestionSubmitExtras = {
  afkTimeoutMs?: number
  contentBlocks?: unknown[]
  annotations?: Record<string, AskUserQuestionAnnotation>
}

/**
 * DualInk analog I3 — resize may degrade to text placeholders. Not gold
 * image convert.
 */
export async function convertImagesToBlocks(
  images: PastedContent[],
): Promise<ContentBlockParam[] | undefined> {
  if (images.length === 0) return undefined
  return Promise.all(
    images.map(async img => {
      const block: ImageBlockParam = {
        type: 'image',
        source: {
          type: 'base64',
          media_type: (img.mediaType ||
            'image/png') as Base64ImageSource['media_type'],
          data: img.content,
        },
      }
      const resized = await maybeResizeAndDownsampleImageBlock(block)
      return resized.block
    }),
  )
}

/**
 * DualInk analog Other-row answer. Image-only Other →
 * `(Image attached)`; typed Other with images appends the same
 * suffix. Regular labels pass through.
 */
export function formatAskUserQuestionAnswer(
  label: string,
  textInput: string | undefined,
  imageCount: number,
): string {
  if (textInput) {
    return imageCount > 0 ? `${textInput} (Image attached)` : textInput
  }
  if (label === '__other__') {
    return imageCount > 0 ? '(Image attached)' : label
  }
  return label
}

function formatAskUserQuestionTranscript(
  questions: { question: string }[],
  answers: Record<string, string>,
): string {
  return questions
    .map(q => {
      const answer = answers[q.question]
      if (answer) {
        return `- "${q.question}"\n  Answer: ${answer}`
      }
      return `- "${q.question}"\n  (No answer provided)`
    })
    .join('\n')
}

/** DualInk analog Chat about this deny feedback. */
export function formatAskUserQuestionChatAboutFeedback(
  questions: { question: string }[],
  answers: Record<string, string>,
): string {
  return `The user wants to clarify these questions.
    This means they may have additional information, context or questions for you.
    Take their response into account and then reformulate the questions if appropriate.
    Start by asking them what they would like to clarify.

    Questions asked:\n${formatAskUserQuestionTranscript(questions, answers)}`
}

/** DualInk analog Skip interview deny feedback. */
export function formatAskUserQuestionSkipInterviewFeedback(
  questions: { question: string }[],
  answers: Record<string, string>,
): string {
  return `The user has indicated they have provided enough answers for the plan interview.
Stop asking clarifying questions and proceed to finish the plan with the information you have.

Questions asked and answers provided:\n${formatAskUserQuestionTranscript(questions, answers)}`
}

/**
 * DualInk analog submitAnswers annotations: selected option preview +
 * questionStates notes.
 */
export function buildAskUserQuestionAnnotations(
  questions: HostAskQuestion[],
  answers: Record<string, string>,
  questionStates: Record<string, { textInputValue?: string }>,
): Record<string, AskUserQuestionAnnotation> {
  const annotations: Record<string, AskUserQuestionAnnotation> = {}
  for (const q of questions) {
    const answer = answers[q.question]
    const notes = questionStates[q.question]?.textInputValue
    const selectedOption = answer
      ? q.options.find(opt => opt.label === answer)
      : undefined
    const preview =
      selectedOption?.preview?.kind === 'full'
        ? selectedOption.preview.markdown
        : undefined
    if (preview || notes?.trim()) {
      annotations[q.question] = {
        ...(preview && { preview }),
        ...(notes?.trim() && { notes: notes.trim() }),
      }
    }
  }
  return annotations
}

/**
 * densable KDs DualInk analog — `{...input, answers}` keyed by
 * `q.question`. DualInk analog afkTimeoutMs + contentBlocks +
 * annotations.
 */
export function resolveAskUserQuestionSubmit(
  payload: AskUserQuestionPermissionPayload,
  answers: Record<string, string>,
  extras?: AskUserQuestionSubmitExtras,
): PermissionPromptResult {
  const input =
    typeof payload.input === 'object' && payload.input !== null
      ? (payload.input as Record<string, unknown>)
      : {}
  const contentBlocks = extras?.contentBlocks
  const annotations = extras?.annotations
  return {
    behavior: 'allow',
    updatedInput: {
      ...input,
      answers,
      ...(extras?.afkTimeoutMs !== undefined
        ? { afkTimeoutMs: extras.afkTimeoutMs }
        : {}),
      ...(annotations && Object.keys(annotations).length > 0
        ? { annotations }
        : {}),
    },
    ...(contentBlocks && contentBlocks.length > 0 ? { contentBlocks } : {}),
  }
}

/** DualInk analog Chat about / Skip interview — mailbox deny. */
export function resolveAskUserQuestionDeny(extras?: {
  feedback?: string
  contentBlocks?: unknown[]
}): PermissionPromptResult {
  const contentBlocks = extras?.contentBlocks
  return {
    behavior: 'deny',
    ...(extras?.feedback ? { feedback: extras.feedback } : {}),
    ...(contentBlocks && contentBlocks.length > 0 ? { contentBlocks } : {}),
  }
}
