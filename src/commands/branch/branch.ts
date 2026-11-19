import { randomUUID, type UUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { logEvent } from '../../services/analytics/index.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type {
  ContentReplacementEntry,
  Entry,
  LogOption,
  SerializedMessage,
  TranscriptMessage,
} from '../../types/logs.js'
import { parseJSONL } from '../../utils/json.js'
import {
  getProjectDir,
  getTranscriptPath,
  getTranscriptPathForSession,
  isTranscriptMessage,
  saveCustomTitle,
  searchSessionsByCustomTitle,
} from '../../utils/sessionStorage.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { formatForkSessionTitle } from '../../bridge/createSession.js'
import { resetTaskListState } from '../../utils/tasks.js'

type TranscriptEntry = TranscriptMessage & {
  forkedFrom?: {
    sessionId: string
    messageUuid: UUID
  }
}

/**
 * Derive a single-line title base from the first user message.
 * Collapses whitespace — multiline first messages (pasted stacks, code)
 * otherwise flow into the saved title and break the resume hint.
 */
export function deriveFirstPrompt(
  firstUserMessage: Extract<SerializedMessage, { type: 'user' }> | undefined,
): string {
  const content = (firstUserMessage as any)?.message?.content
  if (!content) return 'Branched conversation'
  const raw =
    typeof content === 'string'
      ? content
      : content.find(
          (block: {
            type: string
            text?: string
          }): block is { type: 'text'; text: string } => block.type === 'text',
        )?.text
  if (!raw) return 'Branched conversation'
  return (
    raw.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Branched conversation'
  )
}

/**
 * Creates a fork of the current conversation by copying from the transcript file.
 * Preserves all original metadata (timestamps, gitBranch, etc.) while updating
 * sessionId and adding forkedFrom traceability.
 */
async function createFork(customTitle?: string): Promise<{
  sessionId: UUID
  title: string | undefined
  parentCustomTitle: string | undefined
  forkPath: string
  serializedMessages: SerializedMessage[]
  contentReplacementRecords: ContentReplacementEntry['replacements']
}> {
  const forkSessionId = randomUUID() as UUID
  const originalSessionId = getSessionId()
  const projectDir = getProjectDir(getOriginalCwd())
  const forkSessionPath = getTranscriptPathForSession(forkSessionId)
  const currentTranscriptPath = getTranscriptPath()

  // Ensure project directory exists
  await mkdir(projectDir, { recursive: true, mode: 0o700 })

  // Read current transcript file
  let transcriptContent: Buffer
  try {
    transcriptContent = await readFile(currentTranscriptPath)
  } catch {
    throw new Error('No conversation to branch')
  }

  if (transcriptContent.length === 0) {
    throw new Error('No conversation to branch')
  }

  // Parse all transcript entries (messages + metadata entries like content-replacement)
  const entries = parseJSONL<Entry>(transcriptContent)

  let parentCustomTitle: string | undefined
  for (const entry of entries) {
    if (
      entry.type === 'custom-title' &&
      'customTitle' in entry &&
      typeof entry.customTitle === 'string' &&
      entry.customTitle.trim() !== ''
    ) {
      parentCustomTitle = entry.customTitle
    }
  }

  // Filter to only main conversation messages (exclude sidechains and non-message entries)
  const mainConversationEntries = entries.filter(
    (entry): entry is TranscriptMessage =>
      isTranscriptMessage(entry) && !entry.isSidechain,
  )

  // Content-replacement entries for the original session. These record which
  // tool_result blocks were replaced with previews by the per-message budget.
  // Without them in the fork JSONL, `claude -r {forkId}` reconstructs state
  // with an empty replacements Map → previously-replaced results are classified
  // as FROZEN and sent as full content (prompt cache miss + permanent overage).
  // sessionId must be rewritten since loadTranscriptFile keys lookup by the
  // session's messages' sessionId.
  const contentReplacementRecords = entries
    .filter(
      (entry): entry is ContentReplacementEntry =>
        entry.type === 'content-replacement' &&
        entry.sessionId === originalSessionId,
    )
    .flatMap(entry => entry.replacements)

  if (mainConversationEntries.length === 0) {
    throw new Error('No messages to branch')
  }

  // densable 2.1.218 #23 forkSession: old→new uuid map; remap parentUuid by
  // walking/skipping progress; remap logicalParentUuid via map (null stays null).
  const uuidMap = new Map<UUID, UUID>()
  for (const entry of mainConversationEntries) {
    uuidMap.set(entry.uuid, randomUUID() as UUID)
  }
  const byUuid = new Map(mainConversationEntries.map(e => [e.uuid, e] as const))

  const lines: string[] = []
  const serializedMessages: SerializedMessage[] = []

  for (const entry of mainConversationEntries) {
    // parentUuid: walk source parentUuid chain skipping progress, remap
    let remappedParent: UUID | null = null
    let walk: UUID | null | undefined = entry.parentUuid
    while (walk) {
      const w = byUuid.get(walk)
      if (!w) break
      if (w.type !== 'progress') {
        remappedParent = uuidMap.get(walk) ?? null
        break
      }
      walk = w.parentUuid
    }
    // logicalParentUuid: remap through same uuidMap (null stays null)
    const srcLogical = (entry as { logicalParentUuid?: UUID | null })
      .logicalParentUuid
    const remappedLogical: UUID | null | undefined =
      srcLogical === undefined
        ? undefined
        : srcLogical == null
          ? srcLogical
          : (uuidMap.get(srcLogical) ?? null)

    const newUuid = uuidMap.get(entry.uuid)!
    // Create forked transcript entry preserving all original metadata
    const forkedEntry: TranscriptEntry = {
      ...entry,
      uuid: newUuid,
      sessionId: forkSessionId,
      parentUuid: remappedParent,
      ...(remappedLogical !== undefined && {
        logicalParentUuid: remappedLogical,
      }),
      isSidechain: false,
      forkedFrom: {
        sessionId: originalSessionId,
        messageUuid: entry.uuid,
      },
    }

    // Build serialized message for LogOption
    const serialized: SerializedMessage = {
      ...entry,
      uuid: newUuid,
      sessionId: forkSessionId,
      parentUuid: remappedParent,
      ...(remappedLogical !== undefined && {
        logicalParentUuid: remappedLogical,
      }),
    }

    serializedMessages.push(serialized)
    lines.push(jsonStringify(forkedEntry))
  }

  // Append content-replacement entry (if any) with the fork's sessionId.
  // Written as a SINGLE entry (same shape as insertContentReplacement) so
  // loadTranscriptFile's content-replacement branch picks it up.
  if (contentReplacementRecords.length > 0) {
    const forkedReplacementEntry: ContentReplacementEntry = {
      type: 'content-replacement',
      sessionId: forkSessionId,
      replacements: contentReplacementRecords,
    }
    lines.push(jsonStringify(forkedReplacementEntry))
  }

  // Write the fork session file
  await writeFile(forkSessionPath, lines.join('\n') + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })

  return {
    sessionId: forkSessionId,
    title: customTitle,
    parentCustomTitle,
    forkPath: forkSessionPath,
    serializedMessages,
    contentReplacementRecords,
  }
}

/**
 * Generates a unique fork name using `formatForkSessionTitle` (#1601 / #1686)
 * and checks for collisions with existing session names.
 * If "baseName (fork)" already exists, increments to "baseName (fork 2)", "baseName (fork 3)", etc.
 */
export async function getUniqueForkName(baseName: string): Promise<string> {
  let candidateName = formatForkSessionTitle(baseName) || 'Forked session'

  // Check if this exact name already exists
  const existingWithExactName = await searchSessionsByCustomTitle(
    candidateName,
    { exact: true },
  )

  if (existingWithExactName.length === 0) {
    return candidateName
  }

  // Name collision - collect existing forked titles and increment via formatForkSessionTitle
  const stemMatch = candidateName.match(/^(.*) \(fork(?: \d{1,15})?\)$/)
  const searchPrefix = stemMatch ? `${stemMatch[1]} (fork` : candidateName
  const existingForks = await searchSessionsByCustomTitle(searchPrefix)

  const usedTitles = new Set<string>()
  for (const session of existingForks) {
    if (session.customTitle) {
      usedTitles.add(session.customTitle)
    }
  }

  while (usedTitles.has(candidateName)) {
    const next = formatForkSessionTitle(candidateName)
    if (!next || next === candidateName) break
    candidateName = next
  }

  return candidateName
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const customTitle = args?.trim() || undefined

  const originalSessionId = getSessionId()

  try {
    const {
      sessionId,
      title,
      parentCustomTitle,
      forkPath,
      serializedMessages,
      contentReplacementRecords,
    } = await createFork(customTitle)

    // Build LogOption for resume
    const now = new Date()
    const firstPrompt = deriveFirstPrompt(
      serializedMessages.find(m => m.type === 'user') as
        | Extract<SerializedMessage, { type: 'user' }>
        | undefined,
    )

    // Save custom title - use provided title, parent session custom title, or firstPrompt
    // Formats via formatForkSessionTitle ("Name (fork)", "Name (fork 2)", ...), preserving suffix on truncation
    const baseName = title ?? parentCustomTitle ?? firstPrompt
    const effectiveTitle = await getUniqueForkName(baseName)
    await saveCustomTitle(sessionId, effectiveTitle, forkPath)

    logEvent('tengu_conversation_forked', {
      message_count: serializedMessages.length,
      has_custom_title: !!title,
    })

    const forkLog: LogOption = {
      date: now.toISOString().split('T')[0]!,
      messages: serializedMessages,
      fullPath: forkPath,
      value: now.getTime(),
      created: now,
      modified: now,
      firstPrompt,
      messageCount: serializedMessages.length,
      isSidechain: false,
      sessionId,
      customTitle: effectiveTitle,
      contentReplacements: contentReplacementRecords,
    }

    // Resume into the fork
    const titleInfo = title ? ` "${title}"` : ''
    const resumeHint = `\nTo resume the original: claude -r ${originalSessionId}`
    const successMessage = `Branched conversation${titleInfo}. You are now in the branch.${resumeHint}`

    if (context.resume) {
      resetTaskListState()
      await context.resume(sessionId, forkLog, 'fork')
      onDone(successMessage, { display: 'system' })
    } else {
      // Fallback if resume not available
      onDone(
        `Branched conversation${titleInfo}. Resume with: /resume ${sessionId}`,
      )
    }

    return null
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred'
    onDone(`Failed to branch conversation: ${message}`)
    return null
  }
}
