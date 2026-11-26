/**
 * Official 2.1.331 hidden `claude import-conversations <exportPath>` handler
 * (`chunk-20j1h4d1.js`).
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { safeParseJSON } from '../../utils/json.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { cliError } from '../exit.js'

export const MAX_EXPORT_BYTES = 1_073_741_824 // 1 GiB

export type ExportChatMessage = {
  uuid: string
  sender: 'human' | 'assistant' | string
  text?: string
  created_at?: string
  parent_message_uuid?: string | null
  content?: Array<{ type: string; text?: string; name?: string }>
}

export type ExportConversation = {
  uuid: string
  name?: string
  created_at?: string
  updated_at?: string
  project_uuid?: string | null
  chat_messages: ExportChatMessage[]
}

export type ExportProject = {
  uuid: string
  name?: string
  prompt_template?: string
  docs?: Array<{ filename?: string; content: string }>
}

export type ExportManifest = {
  account_uuid: string
  conversations: Array<{ uuid: string; message_count: number }>
  projects: Array<{ uuid: string; doc_count: number }>
}

export type ParsedExportBundle = {
  manifest: ExportManifest
  conversations: ExportConversation[]
  projects: ExportProject[]
}

export type ImportConversationsSummary = {
  conversations: number
  skipped: number
  messages: number
  projects: number
  docs: number
  files: number
  artifacts: number
  fileEditsFailed: number
  manifestDiff: string[]
  jsonlPaths: string[]
  titles: string[]
  createdAts: Array<number | null>
  updatedAts: Array<number | null>
  projectList: Array<{ uuid: string; name: string; dirName: string }>
  conversationProjects: Record<string, string | null>
  attachmentFiles: Record<string, string[]>
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function sanitizeNameSegment(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function buildProjectDirName(project: ExportProject): string | null {
  const slug = sanitizeNameSegment(project.name ?? '') || 'project'
  const dirName = `${slug}-${project.uuid}`
  if (/^[a-zA-Z0-9._-]+$/.test(dirName) && dirName.length <= 200) {
    return dirName
  }
  return null
}

function parseTimestampMs(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : ms
}

export function computeManifestDiff(
  manifest: ExportManifest,
  summary: Pick<
    ImportConversationsSummary,
    'conversations' | 'skipped' | 'messages' | 'projects' | 'docs'
  >,
): string[] {
  const diffs: string[] = []
  if (
    manifest.conversations.length !==
    summary.conversations + summary.skipped
  ) {
    diffs.push(
      `conversations: manifest=${manifest.conversations.length} imported=${summary.conversations + summary.skipped}`,
    )
  }
  const expectedMsgs = manifest.conversations.reduce(
    (acc, c) => acc + c.message_count,
    0,
  )
  if (expectedMsgs !== summary.messages) {
    diffs.push(
      `messages: manifest=${expectedMsgs} imported=${summary.messages}`,
    )
  }
  if (manifest.projects.length !== summary.projects) {
    diffs.push(
      `projects: manifest=${manifest.projects.length} imported=${summary.projects}`,
    )
  }
  const expectedDocs = manifest.projects.reduce(
    (acc, p) => acc + p.doc_count,
    0,
  )
  if (expectedDocs !== summary.docs) {
    diffs.push(`docs: manifest=${expectedDocs} imported=${summary.docs}`)
  }
  return diffs
}

export async function parseExportBundle(
  exportPath: string,
): Promise<ParsedExportBundle> {
  const info = await stat(exportPath)
  if (info.size > MAX_EXPORT_BYTES) {
    throw new Error('export file exceeds MAX_EXPORT_BYTES')
  }
  if (exportPath.toLowerCase().endsWith('.zip')) {
    throw new Error(
      'ZIP export archives require unzip extraction before import',
    )
  }
  const text = await readFile(exportPath, 'utf8')
  const parsed = safeParseJSON(text, false)
  if (!isPlainRecord(parsed)) {
    throw new Error('export file is not valid JSON')
  }
  const rawConversations = Array.isArray(parsed.conversations)
    ? (parsed.conversations as ExportConversation[])
    : []
  const rawProjects = Array.isArray(parsed.projects)
    ? (parsed.projects as ExportProject[])
    : []
  const rawManifest = isPlainRecord(parsed.manifest) ? parsed.manifest : null

  const manifest: ExportManifest =
    rawManifest &&
    Array.isArray(rawManifest.conversations) &&
    Array.isArray(rawManifest.projects)
      ? {
          account_uuid:
            typeof rawManifest.account_uuid === 'string'
              ? rawManifest.account_uuid
              : 'unknown',
          conversations:
            rawManifest.conversations as ExportManifest['conversations'],
          projects: rawManifest.projects as ExportManifest['projects'],
        }
      : {
          account_uuid: 'unknown',
          conversations: rawConversations.map(c => ({
            uuid: c.uuid,
            message_count: Array.isArray(c.chat_messages)
              ? c.chat_messages.length
              : 0,
          })),
          projects: rawProjects.flatMap(p =>
            buildProjectDirName(p) !== null
              ? [{ uuid: p.uuid, doc_count: p.docs?.length ?? 0 }]
              : [],
          ),
        }

  return {
    manifest,
    conversations: rawConversations,
    projects: rawProjects,
  }
}

export async function runImportConversations(
  exportPath: string,
  options: { cwd: string; dryRun?: boolean },
): Promise<ImportConversationsSummary> {
  const bundle = await parseExportBundle(exportPath)
  const targetCwd = resolve(options.cwd)
  const dryRun = options.dryRun === true

  const validProjects = bundle.projects.flatMap(project => {
    const dirName = buildProjectDirName(project)
    return dirName === null ? [] : [{ project, dirName }]
  })

  const summary: ImportConversationsSummary = {
    conversations: 0,
    skipped: 0,
    messages: 0,
    projects: 0,
    docs: 0,
    files: 0,
    artifacts: 0,
    fileEditsFailed: 0,
    manifestDiff: [],
    jsonlPaths: [],
    titles: [],
    createdAts: [],
    updatedAts: [],
    projectList: validProjects.map(({ project, dirName }) => ({
      uuid: project.uuid,
      name: project.name ?? '',
      dirName,
    })),
    conversationProjects: {},
    attachmentFiles: {},
  }

  const sessionsDir = join(targetCwd, 'sessions')
  if (!dryRun) {
    await mkdir(sessionsDir, { recursive: true, mode: 0o700 })
    await mkdir(join(targetCwd, 'projects'), { recursive: true, mode: 0o700 })
    await mkdir(join(targetCwd, 'files'), { recursive: true, mode: 0o700 })
  }

  for (const { project, dirName } of validProjects) {
    const projectDir = join(targetCwd, 'projects', dirName)
    if (!dryRun) {
      await mkdir(projectDir, { recursive: true, mode: 0o700 })
    }
    const promptTemplate = project.prompt_template?.trim()
    if (promptTemplate && !dryRun) {
      await writeFile(
        join(projectDir, 'project-instructions.md'),
        promptTemplate,
        'utf8',
      )
    }
    for (const doc of project.docs ?? []) {
      const safeDoc =
        sanitizeNameSegment(doc.filename ? basename(doc.filename) : '') ||
        'untitled.md'
      summary.docs += 1
      if (!dryRun) {
        await writeFile(join(projectDir, safeDoc), doc.content ?? '', 'utf8')
      }
    }
    summary.projects += 1
  }

  for (const conv of bundle.conversations) {
    const sessionUuid = deterministicUuid(conv.uuid)
    const jsonlPath = join(sessionsDir, `${sessionUuid}.jsonl`)
    const messages = Array.isArray(conv.chat_messages) ? conv.chat_messages : []
    const trimmedName = (conv.name ?? '').trim()
    const firstHuman =
      messages.find(m => m.sender === 'human')?.text?.trim() ?? ''
    const title =
      trimmedName && trimmedName !== 'New conversation'
        ? trimmedName
        : firstHuman.slice(0, 60) || 'Untitled'

    summary.jsonlPaths.push(jsonlPath)
    summary.titles.push(title)
    summary.createdAts.push(parseTimestampMs(conv.created_at))
    summary.updatedAts.push(parseTimestampMs(conv.updated_at))
    summary.conversationProjects[sessionUuid] = conv.project_uuid ?? null
    summary.messages += messages.length

    if (!dryRun) {
      const lines = messages.map(msg =>
        jsonStringify({
          type: msg.sender === 'human' ? 'user' : 'assistant',
          uuid: msg.uuid,
          parentUuid: msg.parent_message_uuid ?? null,
          isSidechain: false,
          timestamp: msg.created_at ?? new Date().toISOString(),
          cwd: targetCwd,
          sessionId: sessionUuid,
          version: 'claude-export-import',
          message: {
            role: msg.sender === 'human' ? 'user' : 'assistant',
            content: msg.text ?? '',
          },
        }),
      )
      await writeFile(jsonlPath, `${lines.join('\n')}\n`, 'utf8')
    }
    summary.conversations += 1
  }

  summary.manifestDiff = computeManifestDiff(bundle.manifest, summary)
  return summary
}

export async function importConversationsHandler(
  exportPath: string,
  options: { cwd?: string; dryRun?: boolean },
): Promise<void> {
  if (!isEnvTruthy(process.env.CLAUDE_IMPORT_CONVERSATIONS)) {
    return cliError('import-conversations is not enabled')
  }
  if (!options.cwd) {
    return cliError('--cwd is required')
  }

  const resolvedCwd = resolve(options.cwd)
  let summary: ImportConversationsSummary
  try {
    summary = await runImportConversations(exportPath, {
      cwd: resolvedCwd,
      dryRun: options.dryRun,
    })
  } catch (err) {
    const msg = errorMessage(err)
    const tooLarge =
      msg.startsWith('export file exceeds MAX_EXPORT_BYTES') ||
      msg.startsWith('Archive total size is too large')
    const code =
      err instanceof Error && 'code' in err
        ? String((err as NodeJS.ErrnoException).code)
        : ''
    const suffix = tooLarge
      ? 'Import failed: the export exceeds the import size limit (IMPORT_TOO_LARGE)\n'
      : code === 'ENOSPC'
        ? 'Import failed: not enough disk space (IMPORT_NO_SPACE)\n'
        : 'Import failed (IMPORT_ERROR)\n'
    process.stderr.write(
      `import-conversations failed: ${msg.slice(0, 400)}\n${suffix}`,
    )
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(1)
    return
  }

  const prefix = options.dryRun ? '[dry-run] ' : ''
  process.stdout.write(
    `${prefix}imported: conversations=${summary.conversations} skipped=${summary.skipped} messages=${summary.messages} projects=${summary.projects} docs=${summary.docs} files=${summary.files} artifacts=${summary.artifacts}\n`,
  )
  process.stdout.write(
    `${jsonStringify({
      sessionIds: summary.jsonlPaths.map(p => basename(p, '.jsonl')),
      titles: summary.titles,
      jsonlPaths: summary.jsonlPaths,
      createdAts: summary.createdAts,
      updatedAts: summary.updatedAts,
      cwd: resolvedCwd,
      projects: summary.projectList,
      conversationProjects: summary.conversationProjects,
      attachmentFiles: summary.attachmentFiles,
      counts: {
        conversations: summary.conversations,
        projects: summary.projects,
        files: summary.files,
        docs: summary.docs,
        artifacts: summary.artifacts,
        fileEditsFailed: summary.fileEditsFailed,
        skipped: summary.skipped,
      },
    })}\n`,
  )

  if (summary.manifestDiff.length > 0) {
    process.stderr.write(
      `manifest mismatch:\n  ${summary.manifestDiff.join('\n  ')}\nImport completed with mismatches (IMPORT_MANIFEST_MISMATCH)\n`,
    )
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(1)
    return
  }

  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(0)
}
