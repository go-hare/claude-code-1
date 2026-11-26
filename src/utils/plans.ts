import { randomUUID } from 'crypto'
import { constants as fsConstants } from 'fs'
import { lstat, mkdir, open, readFile, realpath } from 'fs/promises'
import { basename, dirname, join, resolve, sep } from 'path'
import type { AgentId, SessionId } from 'src/types/ids.js'
import type { LogOption } from 'src/types/logs.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  SystemFileSnapshotMessage,
  UserMessage,
} from 'src/types/message.js'
import {
  getPlanSlugCache,
  getSessionId,
  setPlanSlugCacheEntry,
} from '../bootstrap/state.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '@claude-code/builtin-tools/tools/ExitPlanModeTool/constants.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage, isENOENT } from './errors.js'
import { getEnvironmentKind } from './filePersistence/outputsScanner.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'
import { getPlatform } from './platform.js'
import { getBootstrapSession, RootSessionSlot } from './sessionHost.js'
import { getInitialSettings } from './settings/settings.js'
import { generateWordSlug } from './words.js'

const MAX_SLUG_RETRIES = 10

/**
 * Get or generate a word slug for the current session's plan.
 * The slug is generated lazily on first access and cached for the session.
 * If a plan file with the generated slug already exists, retries up to 10 times.
 */
export function getPlanSlug(sessionId?: SessionId): string {
  const id = sessionId ?? getSessionId()
  const cache = getPlanSlugCache()
  let slug = cache.get(id)
  if (!slug) {
    const plansDir = getPlansDirectory()
    // Try to find a unique slug that doesn't conflict with existing files
    for (let i = 0; i < MAX_SLUG_RETRIES; i++) {
      slug = generateWordSlug()
      const filePath = join(plansDir, `${slug}.md`)
      if (!getFsImplementation().existsSync(filePath)) {
        break
      }
    }
    setPlanSlugCacheEntry(id, slug!)
  }
  return slug!
}

/**
 * Set a specific plan slug for a session (used when resuming a session)
 */
export function setPlanSlug(sessionId: SessionId, slug: string): void {
  setPlanSlugCacheEntry(sessionId, slug)
}

/**
 * Clear the plan slug for the current session.
 * This should be called on /clear to ensure a fresh plan file is used.
 */
export function clearPlanSlug(sessionId?: SessionId): void {
  const id = sessionId ?? getSessionId()
  getPlanSlugCache().delete(id)
}

/**
 * Clear ALL plan slug entries (for the active root session).
 * Use this on /clear to free sub-session slug entries.
 */
export function clearAllPlanSlugs(): void {
  getPlanSlugCache().clear()
  getPlansSessionState().slugsInDefault.clear()
}

/**
 * 2.1.323 #2014 (SEA `wl` / `Rl` / `Yo` / `El` / `Pl` @284739743):
 * Refuse any plan write under a custom `plansDirectory` that cannot be
 * proven to stay inside the project root (resolving symlinks on existing
 * ancestors, rejecting dangling symlinks, rejecting target symlinks/hardlinks).
 */
export const PLANS_DIR_CONTAINMENT_ERROR_MESSAGE =
  'Could not confirm the plansDirectory folder and plan file are inside this project. Check that the folder exists, that no link leads out of it, and that the plan file is not a link and has no hard link. If this system or drive cannot report that, remove plansDirectory from your settings to use the default plans folder.'

type VettedPlansRoot = {
  cwd: string
  canonicalCwd: string
  plansDir: string
}

function resolvePlansDirCacheKey(key: unknown): unknown {
  return key === undefined ? getCwd() : key
}

class SessionPlansDirCache extends Map<unknown, string> {
  #state: PlansSessionState
  constructor(state: PlansSessionState) {
    super()
    this.#state = state
  }
  override get(key: unknown): string | undefined {
    return super.get(resolvePlansDirCacheKey(key))
  }
  override has(key: unknown): boolean {
    return super.has(resolvePlansDirCacheKey(key))
  }
  override set(key: unknown, value: string): this {
    return super.set(resolvePlansDirCacheKey(key), value)
  }
  override delete(key: unknown): boolean {
    const resolvedKey = resolvePlansDirCacheKey(key)
    if (typeof resolvedKey === 'string') {
      this.#state.vettedCustomPlansRoots.delete(resolvedKey)
    }
    return super.delete(resolvedKey)
  }
  override clear(): void {
    this.#state.vettedCustomPlansRoots.clear()
    this.#state.slugsInDefault.clear()
    super.clear()
  }
}

class PlansSessionState {
  plansDirCache: SessionPlansDirCache
  vettedCustomPlansRoots = new Map<string, VettedPlansRoot>()
  /**
   * 2.1.325 #2268 (SEA `kl.slugsInDefault` @284739188):
   * Plan slugs that fell back to `~/.claude/plans` because a configured
   * `plansDirectory` could not accept the approved plan edit.
   */
  slugsInDefault = new Set<string>()
  planFileCache: Map<string, string | null> | null = null
  planFileBackend: PlanFileBackend | null = null

  constructor() {
    this.plansDirCache = new SessionPlansDirCache(this)
  }
}

const fallbackPlansRootObj: object = {}
const fallbackPlansSession = { root: fallbackPlansRootObj }

function getActivePlansSession(): { readonly root: object } {
  try {
    const session = getBootstrapSession()
    if (session?.root) {
      return session
    }
  } catch {
    // Fall back to module-local sentinel if sessionHost is mocked
  }
  return fallbackPlansSession
}

const plansStateBySession = new RootSessionSlot<PlansSessionState>(
  () => new PlansSessionState(),
)

function getPlansSessionState(): PlansSessionState {
  return plansStateBySession.of(getActivePlansSession())
}

function isCanonicalPathWithin(
  candidate: string,
  canonicalRoot: string,
): boolean {
  return (
    candidate === canonicalRoot || candidate.startsWith(canonicalRoot + sep)
  )
}

function tryRealpathSync(targetPath: string): string | null {
  try {
    return getFsImplementation().realpathSync(targetPath)
  } catch {
    return null
  }
}

function isDanglingSymlinkSync(targetPath: string): boolean {
  try {
    return getFsImplementation().lstatSync(targetPath).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * SEA `wl(resolved, cwd, canonicalCwd)`: check lexical containment, reject
 * backslashes off Windows, and verify the deepest existing ancestor's
 * realpath stays inside `canonicalCwd` without traversing a dangling symlink.
 */
export function isPlansDirectoryContained(
  resolved: string,
  cwd: string,
  canonicalCwd: string,
): boolean {
  if (resolved !== cwd && !resolved.startsWith(cwd + sep)) {
    return false
  }
  if (getPlatform() !== 'windows' && resolved.includes('\\')) {
    return false
  }
  let cursor = resolved
  for (;;) {
    const real = tryRealpathSync(cursor)
    if (real !== null) {
      return isCanonicalPathWithin(real, canonicalCwd)
    }
    if (isDanglingSymlinkSync(cursor)) {
      return false
    }
    const parent = dirname(cursor)
    if (parent === cursor) {
      return false
    }
    cursor = parent
  }
}

/**
 * Verify that writing a plan file at `filePath` is guaranteed to remain
 * inside the vetted project root when `plansDirectory` is active.
 * Returns the canonical target path if custom `plansDirectory` is active, or
 * `null` when writing to the default `~/.claude/plans` directory.
 * Throws if containment cannot be proven.
 */
export async function assertPlanWriteContained(
  filePath: string,
): Promise<string | null> {
  const defaultDir = join(getClaudeConfigHomeDir(), 'plans')
  const parentDir = dirname(filePath)
  if (parentDir === defaultDir) {
    return null
  }
  const vetted = getPlansSessionState().vettedCustomPlansRoots.get(getCwd())
  if (!vetted || parentDir !== vetted.plansDir) {
    throw new Error(PLANS_DIR_CONTAINMENT_ERROR_MESSAGE)
  }
  if (!isPlansDirectoryContained(parentDir, vetted.cwd, vetted.canonicalCwd)) {
    throw new Error(PLANS_DIR_CONTAINMENT_ERROR_MESSAGE)
  }
  let realParent: string
  try {
    realParent = await realpath(parentDir)
  } catch {
    throw new Error(PLANS_DIR_CONTAINMENT_ERROR_MESSAGE)
  }
  if (!isCanonicalPathWithin(realParent, vetted.canonicalCwd)) {
    throw new Error(PLANS_DIR_CONTAINMENT_ERROR_MESSAGE)
  }
  const canonicalTarget = join(realParent, basename(filePath))
  try {
    const st = await lstat(canonicalTarget)
    if (st.isSymbolicLink() || !st.isFile() || Number(st.nlink) > 1) {
      throw new Error(PLANS_DIR_CONTAINMENT_ERROR_MESSAGE)
    }
  } catch (err) {
    if (!isENOENT(err)) {
      throw err instanceof Error &&
        err.message === PLANS_DIR_CONTAINMENT_ERROR_MESSAGE
        ? err
        : new Error(PLANS_DIR_CONTAINMENT_ERROR_MESSAGE)
    }
  }
  return canonicalTarget
}

/**
 * Safely write a plan file while enforcing `plansDirectory` containment
 * (2.1.323 #2014). Opens with `O_NOFOLLOW` when available and verifies fstat
 * `isFile()` + `nlink <= 1` before truncating/writing.
 */
export async function writePlanFileContained(
  filePath: string,
  content: string,
): Promise<void> {
  const canonicalTarget = await assertPlanWriteContained(filePath)
  const target = canonicalTarget ?? filePath
  const flags =
    fsConstants.O_WRONLY | fsConstants.O_CREAT | (fsConstants.O_NOFOLLOW ?? 0)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(target, flags, 0o600)
    const st = await handle.stat()
    if (!st.isFile() || (canonicalTarget !== null && Number(st.nlink) > 1)) {
      throw new Error(PLANS_DIR_CONTAINMENT_ERROR_MESSAGE)
    }
    await handle.truncate(0)
    await handle.writeFile(content, { encoding: 'utf-8' })
  } catch (err) {
    if (canonicalTarget !== null) {
      throw new Error(PLANS_DIR_CONTAINMENT_ERROR_MESSAGE)
    }
    throw err
  } finally {
    await handle?.close().catch(() => {})
  }
}

// Memoized per RootSession: called from render bodies (FileReadTool/FileEditTool/FileWriteTool UI.tsx)
// and permission checks. Inputs (initial settings + cwd) are fixed at startup, so the
// mkdirSync result is stable for the session. Without memoization, each rendered tool
// message triggers a mkdirSync syscall (regressed in #20005).
function computePlansDirectory(state: PlansSessionState, cwd: string): string {
  const settings = getInitialSettings()
  const settingsDir = settings.plansDirectory
  const defaultPlansPath = join(getClaudeConfigHomeDir(), 'plans')
  let plansPath: string
  state.vettedCustomPlansRoots.delete(cwd)

  if (settingsDir) {
    // Settings.json (relative to project root)
    const resolved = resolve(cwd, settingsDir)
    const canonicalCwd = tryRealpathSync(cwd)

    // 2.1.323 #2014 (SEA `wl`): Validate both lexical and canonical realpath
    // containment inside project root, rejecting symlinks escaping the project
    // and backslashes off Windows.
    if (
      canonicalCwd !== null &&
      isPlansDirectoryContained(resolved, cwd, canonicalCwd)
    ) {
      state.vettedCustomPlansRoots.set(cwd, {
        cwd,
        canonicalCwd,
        plansDir: resolved,
      })
      plansPath = resolved
    } else {
      logError(
        new Error(
          `plansDirectory must be within project root, with no backslash in its path off Windows: ${settingsDir}`,
        ),
      )
      plansPath = defaultPlansPath
    }
  } else {
    // Default
    plansPath = defaultPlansPath
  }

  // Ensure directory exists (re-verify containment before creating custom dir)
  try {
    const vetted = state.vettedCustomPlansRoots.get(cwd)
    if (
      vetted &&
      plansPath === vetted.plansDir &&
      !isPlansDirectoryContained(plansPath, vetted.cwd, vetted.canonicalCwd)
    ) {
      throw new Error(PLANS_DIR_CONTAINMENT_ERROR_MESSAGE)
    }
    getFsImplementation().mkdirSync(plansPath)
  } catch (error) {
    logError(error)
  }

  return plansPath
}

function getPlansDirectoryMemoized(): string {
  const state = getPlansSessionState()
  const cwd = getCwd()
  if (state.plansDirCache.has(cwd)) {
    return state.plansDirCache.get(cwd)!
  }
  const computed = computePlansDirectory(state, cwd)
  state.plansDirCache.set(cwd, computed)
  return computed
}

function createGetPlansDirectory() {
  const fn = Object.assign(
    function getPlansDirectory(slug?: string): string {
      const state = getPlansSessionState()
      const activeSlug = slug ?? getPlanSlugCache().get(getSessionId())
      if (activeSlug !== undefined && state.slugsInDefault.has(activeSlug)) {
        return join(getClaudeConfigHomeDir(), 'plans')
      }
      return getPlansDirectoryMemoized()
    },
    {
      cache: new Map<unknown, string>(),
    },
  )
  Object.defineProperty(fn, 'cache', {
    configurable: true,
    enumerable: true,
    get(): Map<unknown, string> {
      return getPlansSessionState().plansDirCache
    },
    set(next: Map<unknown, string>): void {
      const cache = getPlansSessionState().plansDirCache
      cache.clear()
      for (const [k, v] of next) {
        cache.set(k, v)
      }
    },
  })
  return fn
}

export const getPlansDirectory = createGetPlansDirectory()

/**
 * 2.1.325 #2268 (SEA `N6s` @284740124):
 * Persist an approved plan edit to `filePath`. When `filePath` is in a custom
 * `plansDirectory` and cannot accept the write (e.g. containment check fails,
 * symlink/hardlink, read-only or missing folder), fall back to saving under the
 * default `~/.claude/plans` folder with a fresh slug, switch this session to
 * that file, and return a warning notice describing where and why.
 */
export type PersistApprovedPlanEditResult = {
  notice: string
  savedTo?: string
}

export async function persistApprovedPlanEdit(
  filePath: string,
  content: string,
): Promise<PersistApprovedPlanEditResult | undefined> {
  try {
    await writePlanFileContained(filePath, content)
    notePlanFileWritten(filePath, content)
    return undefined
  } catch (err) {
    const errText = errorMessage(err)
    logError(err)

    const defaultDir = join(getClaudeConfigHomeDir(), 'plans')
    const currentSlug = getPlanSlugCache().get(getSessionId())
    if (
      dirname(filePath) === defaultDir ||
      currentSlug === undefined ||
      basename(filePath) !== `${currentSlug}.md`
    ) {
      return {
        notice: `The approved plan could not be saved to ${filePath}: ${errText}`,
      }
    }

    const fallbackSlug = generateWordSlug()
    const fallbackPath = join(defaultDir, `${fallbackSlug}.md`)
    try {
      await mkdir(defaultDir, { recursive: true })
      const flags =
        fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0)
      const handle = await open(fallbackPath, flags, 0o600)
      try {
        await handle.writeFile(content, { encoding: 'utf-8' })
      } finally {
        await handle.close().catch(() => {})
      }
    } catch (fallbackErr) {
      const fallbackErrText = errorMessage(fallbackErr)
      logError(fallbackErr)
      setPlanSlug(getSessionId(), generateWordSlug())
      return {
        notice: `The approved plan could not be saved to ${fallbackPath}: ${fallbackErrText}. Claude has the approved text in this conversation. It could not be saved to ${filePath} either: ${errText}`,
      }
    }

    getPlansSessionState().slugsInDefault.add(fallbackSlug)
    setPlanSlug(getSessionId(), fallbackSlug)
    notePlanFileWritten(fallbackPath, content)
    return {
      notice: `The approved plan was saved to ${fallbackPath}, which this session uses from now on. It could not be saved to ${filePath}: ${errText}`,
      savedTo: fallbackPath,
    }
  }
}

/**
 * Get the file path for a session's plan
 * @param agentId Optional agent ID for subagents. If not provided, returns main session plan.
 * For main conversation (no agentId), returns {planSlug}.md
 * For subagents (agentId provided), returns {planSlug}-agent-{agentId}.md
 */
export function getPlanFilePath(agentId?: AgentId): string {
  const planSlug = getPlanSlug(getSessionId())

  // Main conversation: simple filename with word slug
  if (!agentId) {
    return join(getPlansDirectory(), `${planSlug}.md`)
  }

  // Subagents: include agent ID
  return join(getPlansDirectory(), `${planSlug}-agent-${agentId}.md`)
}

/**
 * Get the plan content for a session
 * @param agentId Optional agent ID for subagents. If not provided, returns main session plan.
 */
/**
 * #92 SEA `_l` (`planFileCache` @284728500):
 * Persist and recover plan file contents across cloud session container
 * restarts before the plan is presented.
 */
export type PlanFileBackend = {
  readText?: (key: string) => Promise<string | null>
  writeText?: (key: string, content: string) => Promise<void>
}

function planCacheKeyForPath(filePath: string): string | null {
  const plansDir = getPlansDirectory()
  if (dirname(filePath) !== plansDir) return null
  return basename(filePath)
}

export function activatePlanFileCache(backend: PlanFileBackend): void {
  const state = getPlansSessionState()
  state.planFileCache ??= new Map()
  state.planFileBackend = backend
}

export function notePlanFileWritten(filePath: string, content: string): void {
  const key = planCacheKeyForPath(filePath)
  if (!key) return
  const state = getPlansSessionState()
  state.planFileCache ??= new Map()
  state.planFileCache.set(key, content)
  if (state.planFileBackend?.writeText) {
    void state.planFileBackend.writeText(key, content).catch(() => {})
  }
}

export function notePlanFileForgotten(filePath: string): void {
  const key = planCacheKeyForPath(filePath)
  const state = getPlansSessionState()
  if (!key || !state.planFileCache) return
  state.planFileCache.delete(key)
}

export async function hydratePlanFromBackend(
  agentId?: AgentId,
): Promise<string | null> {
  const filePath = getPlanFilePath(agentId)
  const key = planCacheKeyForPath(filePath)
  const state = getPlansSessionState()
  if (!key || !state.planFileBackend?.readText) return null
  try {
    const content = await state.planFileBackend.readText(key)
    if (typeof content === 'string') {
      state.planFileCache ??= new Map()
      state.planFileCache.set(key, content)
      return content
    }
  } catch {
    // ignore backend read error
  }
  return null
}

export function resetPlanFileCacheForTests(): void {
  const state = getPlansSessionState()
  state.planFileCache = null
  state.planFileBackend = null
}

export function getPlan(agentId?: AgentId): string | null {
  const filePath = getPlanFilePath(agentId)
  try {
    return getFsImplementation().readFileSync(filePath, { encoding: 'utf-8' })
  } catch (error) {
    if (isENOENT(error)) {
      const key = planCacheKeyForPath(filePath)
      const cached = key
        ? getPlansSessionState().planFileCache?.get(key)
        : undefined
      if (typeof cached === 'string') {
        return cached
      }
      return null
    }
    logError(error)
    return null
  }
}

/**
 * Extract the plan slug from a log's message history.
 */
function getSlugFromLog(log: LogOption): string | undefined {
  return log.messages.find(m => m.slug)?.slug
}

/**
 * Restore plan slug from a resumed session.
 * Sets the slug in the session cache so getPlanSlug returns it.
 * If the plan file is missing, attempts to recover it from a file snapshot
 * (written incrementally during the session) or from message history.
 * Returns true if a plan file exists (or was recovered) for the slug.
 * @param log The log to restore from
 * @param targetSessionId The session ID to associate the plan slug with.
 *                        This should be the ORIGINAL session ID being resumed,
 *                        not the temporary session ID from before resume.
 */
export async function copyPlanForResume(
  log: LogOption,
  targetSessionId?: SessionId,
): Promise<boolean> {
  const slug = getSlugFromLog(log)
  if (!slug) {
    return false
  }

  // Set the slug for the target session ID (or current if not provided)
  const sessionId = targetSessionId ?? getSessionId()
  setPlanSlug(sessionId, slug)

  // Attempt to read the plan file directly — recovery triggers on ENOENT.
  const planPath = join(getPlansDirectory(), `${slug}.md`)
  try {
    await getFsImplementation().readFile(planPath, { encoding: 'utf-8' })
    return true
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      // Don't throw — called fire-and-forget (void copyPlanForResume(...)) with no .catch()
      logError(e)
      return false
    }
    // Only attempt recovery in remote sessions (CCR) where files don't persist
    if (getEnvironmentKind() === null) {
      return false
    }

    logForDebugging(
      `Plan file missing during resume: ${planPath}. Attempting recovery.`,
    )

    // Try file snapshot first (written incrementally during session)
    const snapshotPlan = findFileSnapshotEntry(log.messages, 'plan')
    let recovered: string | null = null
    if (snapshotPlan && snapshotPlan.content.length > 0) {
      recovered = snapshotPlan.content
      logForDebugging(
        `Plan recovered from file snapshot, ${recovered.length} chars`,
        { level: 'info' },
      )
    } else {
      // Fall back to searching message history
      recovered = recoverPlanFromMessages(log)
      if (recovered) {
        logForDebugging(
          `Plan recovered from message history, ${recovered.length} chars`,
          { level: 'info' },
        )
      }
    }

    if (recovered) {
      try {
        await writePlanFileContained(planPath, recovered)
        return true
      } catch (writeError) {
        logError(writeError)
        return false
      }
    }
    logForDebugging(
      'Plan file recovery failed: no file snapshot or plan content found in message history',
    )
    return false
  }
}

/**
 * Copy a plan file for a forked session. Unlike copyPlanForResume (which reuses
 * the original slug), this generates a NEW slug for the forked session and
 * writes the original plan content to the new file. This prevents the original
 * and forked sessions from clobbering each other's plan files.
 */
export async function copyPlanForFork(
  log: LogOption,
  targetSessionId: SessionId,
): Promise<boolean> {
  const originalSlug = getSlugFromLog(log)
  if (!originalSlug) {
    return false
  }

  const plansDir = getPlansDirectory()
  const originalPlanPath = join(plansDir, `${originalSlug}.md`)

  // Generate a new slug for the forked session (do NOT reuse the original)
  const newSlug = getPlanSlug(targetSessionId)
  const newPlanPath = join(plansDir, `${newSlug}.md`)
  try {
    const content = await readFile(originalPlanPath, { encoding: 'utf-8' })
    await writePlanFileContained(newPlanPath, content)
    return true
  } catch (error) {
    if (isENOENT(error)) {
      return false
    }
    logError(error)
    return false
  }
}

/**
 * Recover plan content from the message history. Plan content can appear in
 * three forms depending on what happened during the session:
 *
 * 1. ExitPlanMode tool_use input — normalizeToolInput injects the plan content
 *    into the tool_use input, which persists in the transcript.
 *
 * 2. planContent field on user messages — set during the "clear context and
 *    implement" flow when ExitPlanMode is approved.
 *
 * 3. plan_file_reference attachment — created by auto-compact to preserve the
 *    plan across compaction boundaries.
 */
function recoverPlanFromMessages(log: LogOption): string | null {
  for (let i = log.messages.length - 1; i >= 0; i--) {
    const msg = log.messages[i]
    if (!msg) {
      continue
    }

    if (msg.type === 'assistant') {
      const { content } = (msg as AssistantMessage).message
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block.type === 'tool_use' &&
            block.name === EXIT_PLAN_MODE_V2_TOOL_NAME
          ) {
            const input = block.input as Record<string, unknown> | undefined
            const plan = input?.plan
            if (typeof plan === 'string' && plan.length > 0) {
              return plan
            }
          }
        }
      }
    }

    if (msg.type === 'user') {
      const userMsg = msg as UserMessage
      if (
        typeof userMsg.planContent === 'string' &&
        userMsg.planContent.length > 0
      ) {
        return userMsg.planContent
      }
    }

    if (msg.type === 'attachment') {
      const attachmentMsg = msg as AttachmentMessage
      if (attachmentMsg.attachment?.type === 'plan_file_reference') {
        const plan = (attachmentMsg.attachment as { planContent?: string })
          .planContent
        if (typeof plan === 'string' && plan.length > 0) {
          return plan
        }
      }
    }
  }
  return null
}

/**
 * Find a file entry in the most recent file-snapshot system message in the transcript.
 * Scans backwards to find the latest snapshot.
 */
function findFileSnapshotEntry(
  messages: LogOption['messages'],
  key: string,
): { key: string; path: string; content: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (
      msg?.type === 'system' &&
      'subtype' in msg &&
      msg.subtype === 'file_snapshot' &&
      'snapshotFiles' in msg
    ) {
      const files = msg.snapshotFiles as Array<{
        key: string
        path: string
        content: string
      }>
      return files.find(f => f.key === key)
    }
  }
  return undefined
}

/**
 * Persist a snapshot of session files (plan, todos) to the transcript.
 * Called incrementally whenever these files change. Only active in remote
 * sessions (CCR) where local files don't persist between sessions.
 */
export async function persistFileSnapshotIfRemote(): Promise<void> {
  if (getEnvironmentKind() === null) {
    return
  }
  try {
    const snapshotFiles: { key: string; path: string; content: string }[] = []

    // Snapshot plan file
    const plan = getPlan()
    if (plan) {
      snapshotFiles.push({
        key: 'plan',
        path: getPlanFilePath(),
        content: plan,
      })
    }

    if (snapshotFiles.length === 0) {
      return
    }

    const message: SystemFileSnapshotMessage = {
      type: 'system',
      subtype: 'file_snapshot',
      content: 'File snapshot',
      level: 'info',
      isMeta: true,
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
      snapshotFiles,
    }

    const { recordTranscript } = await import('./sessionStorage.js')
    await recordTranscript([message])
  } catch (error) {
    logError(error)
  }
}
