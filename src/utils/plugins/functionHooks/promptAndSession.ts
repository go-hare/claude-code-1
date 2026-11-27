/**
 * Function hooks submodule: promptAndSession
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import type { AppState } from '../../../state/AppStateStore.js'
import { logForDebugging } from '../../debug.js'
import { getMainThreadTurn } from '../../mainThreadTurn.js'
import {
  getPromptInputCursorState,
  getPromptInputStoreValue,
  savePromptInputCursorOffset,
  setPromptInputStoreValue,
} from '../../promptInputCursorStore.js'
import { restorePinnedKeys } from '../functionHooksHop.js'
import { isDeepStrictEqual } from 'util'
import {
  AGENT_TOOL_NAME,
  PROMPT_CHANGE_CLEAR_ORIGIN,
  PROMPT_CHANGE_ENGINE_ORIGIN,
  PROMPT_CHANGE_STALL_CAP,
  PROMPT_FILL_MODES,
  PROMPT_MEDIA_ABSENT,
  PROMPT_MEDIA_B64_ALIGN,
  PROMPT_MEDIA_MAX_CHUNK,
  SESSION_MESSAGES_CAP,
  describeThrown,
  hostCheck,
  isEventRecord,
  isPromptFillMode,
  jsonEqual,
  plainInputClone,
  sessionSendAddress,
  toolResultTextFromContent,
} from './constants.js'
import { runFunctionHookChain } from './hookChain.js'
import {
  activeHookServingAls,
  buildOpHookOrigin,
  checkPluginInputRefusal,
  fhState,
  getLiveHookEvent,
  hasMatchingFunctionHook,
  hasMatchingFunctionHookForOp,
  resolveHookCallOrigin,
} from './state.js'
import type {
  FunctionHookHopSite,
  GoldSessionMessage,
  GoldSessionToolResult,
  GoldSessionToolUse,
  PluginCommandSpec,
  PromptAutocompleteSuggestion,
  PromptChangeOrigin,
  PromptEditBox,
  PromptEditRecord,
  PromptMediaAttachmentInput,
  SessionListedTool,
} from './types.js'

function clampPromptEditBox(box: PromptEditBox): PromptEditBox {
  return {
    text: box.text,
    cursor: Math.max(0, Math.min(box.cursor, box.text.length)),
  }
}

function asPromptEditBox(
  value: unknown,
  fallback: PromptEditBox,
): PromptEditBox {
  if (!isEventRecord(value) || typeof value.text !== 'string') return fallback
  const cursor =
    typeof value.cursor === 'number' && Number.isFinite(value.cursor)
      ? value.cursor
      : fallback.cursor
  return clampPromptEditBox({ text: value.text, cursor })
}

/**
 * densable `Xco` / `Wie` — composer relays prompt.edit when hooked.
 * Unique English: hooked/unhooked logs live on PromptInput; throw / "moved
 * meanwhile" report here.
 */
export function createPromptEditComposer(host: {
  read: () => PromptEditBox
  commit: (box: PromptEditBox) => void
}): {
  setHooked: (hooked: boolean) => void
  record: (edit: PromptEditRecord) => void
  dispose: () => void
} {
  const abort = new AbortController()
  let hooked = false
  fhState().promptBoxBound = true
  let queued: PromptEditRecord[] = []
  let inFlight: PromptEditRecord | undefined
  let scheduled = false

  const flush = (): void => {
    scheduled = false
    if (queued.length === 0 || inFlight !== undefined) return
    const first = queued[0]!
    const last = queued.at(-1)!
    const batch: PromptEditRecord = { before: first.before, after: last.after }
    queued = []
    inFlight = batch
    const payload: Record<string, unknown> = {
      origin: 'typed',
      text: batch.before.text,
      cursor: batch.before.cursor,
      after: batch.after,
    }
    void runFunctionHookChain('prompt.edit', payload, async () => batch.after)
      .then(answered => {
        settle(batch, asPromptEditBox(answered, batch.after))
      })
      .catch(err => {
        logForDebugging(
          `prompt.edit: ${describeThrown(err)}; the editor's edit stands`,
          { level: 'error' },
        )
        settle(batch, batch.after)
      })
  }

  const settle = (batch: PromptEditRecord, answered: PromptEditBox): void => {
    inFlight = undefined
    if (abort.signal.aborted) return
    const original = batch.after
    const current = host.read()
    if (
      answered.text === original.text &&
      answered.cursor === original.cursor
    ) {
      /* gold lr: no rewrite */
    } else if (
      current.text === original.text &&
      current.cursor === original.cursor
    ) {
      host.commit(answered)
    } else {
      logForDebugging(
        "prompt.edit: a rewrite no longer fits the draft (it moved meanwhile); the person's typing stands",
        { level: 'info' },
      )
    }
    flush()
  }

  return {
    setHooked(next: boolean) {
      hooked = next
    },
    record(edit: PromptEditRecord) {
      if (!hooked) return
      queued.push(edit)
      if (!scheduled && inFlight === undefined) {
        scheduled = true
        queueMicrotask(flush)
      }
    },
    dispose() {
      queued = []
      abort.abort()
      fhState().promptBoxBound = false
    },
  }
}

function resolvePromptChangeOrigin(
  change: { after: string; origin?: PromptChangeOrigin },
  previous: PromptChangeOrigin | undefined,
): PromptChangeOrigin {
  const fallback =
    change.after === ''
      ? PROMPT_CHANGE_CLEAR_ORIGIN
      : PROMPT_CHANGE_ENGINE_ORIGIN
  const origin = change.origin
  if (origin === undefined || origin.kind === 'composer') return fallback
  if (origin.kind === 'landing') return previous ?? fallback
  return origin
}

/**
 * densable `fNe` / `GMt` — coalesces non-typed prompt box changes
 * (history recall, clear, undo, plugin fill) and raises `prompt.change`
 * with anti-loop stall detection after 8 consecutive plugin fills.
 */
export function createPromptChangeCoordinator(
  readBox: () => PromptEditBox,
  options: {
    raise?: (
      payload: { text: string; cursor: number; origin: PromptChangeOrigin },
      signal: AbortSignal,
    ) => Promise<unknown>
    later?: (cb: () => void) => void
    isHooked?: () => boolean
    report?: (message: string) => void
    stall?: (plugins: readonly string[]) => void
  } = {},
): {
  changed: (change: {
    before: string
    after: string
    origin?: PromptChangeOrigin
  }) => void
  dispose: () => void
} {
  const raise =
    options.raise ??
    (payload =>
      runFunctionHookChain('prompt.change', payload, async () => undefined))
  const later = options.later ?? queueMicrotask
  const isHooked =
    options.isHooked ?? (() => hasMatchingFunctionHook('prompt.change', {}))
  const report =
    options.report ?? (msg => logForDebugging(msg, { level: 'warn' }))
  const stall =
    options.stall ??
    ((plugins: readonly string[]) => {
      const unique = [...new Set(plugins)].sort().join(', ')
      const msg = `prompt.change: ${plugins.length} dispatches in a row for fills by ${unique}; not raised again until the box changes another way`
      logForDebugging(msg, { level: 'warn' })
    })

  const abort = new AbortController()
  let baseline: string | undefined
  let clearedAfter: string | undefined
  let pendingOrigin: PromptChangeOrigin | undefined
  let lastOrigin: PromptChangeOrigin | undefined
  let pluginFillChain: string[] = []
  let stalled = false
  let inFlight = false
  let scheduled = false

  const checkStall = (origin: PromptChangeOrigin): boolean => {
    if (origin.kind !== 'plugin') return false
    const hitCap = pluginFillChain.length >= PROMPT_CHANGE_STALL_CAP
    if (hitCap && !stalled) {
      stalled = true
      stall(pluginFillChain)
    }
    if (!hitCap) {
      pluginFillChain = [...pluginFillChain, origin.name]
    }
    return hitCap
  }

  const flush = (): void => {
    scheduled = false
    const origin = pendingOrigin
    if (
      inFlight ||
      abort.signal.aborted ||
      baseline === undefined ||
      origin === undefined
    ) {
      return
    }
    const current = readBox()
    const changedFromClear =
      clearedAfter !== undefined && current.text !== clearedAfter
    const changed = current.text !== baseline || changedFromClear
    baseline = undefined
    clearedAfter = undefined
    pendingOrigin = undefined
    if (!changed || !isHooked() || checkStall(origin)) {
      return
    }
    inFlight = true
    Promise.resolve(
      raise(
        { text: current.text, cursor: current.cursor, origin },
        abort.signal,
      ),
    )
      .catch(err => {
        report(`prompt.change: ${describeThrown(err)}`)
      })
      .finally(() => {
        inFlight = false
      })
      .then(flush)
  }

  return {
    changed(change) {
      if (abort.signal.aborted) return
      const isComposer = change.origin?.kind === 'composer'
      lastOrigin = isComposer
        ? undefined
        : resolvePromptChangeOrigin(change, lastOrigin)
      if (lastOrigin?.kind !== 'plugin') {
        pluginFillChain = []
        stalled = false
      }
      if (lastOrigin === undefined) {
        clearedAfter = baseline === undefined ? undefined : change.after
        return
      }
      if (!isHooked()) {
        baseline = undefined
        clearedAfter = undefined
        pendingOrigin = undefined
        return
      }
      baseline ??= change.before
      pendingOrigin = lastOrigin
      if (!scheduled && !inFlight) {
        scheduled = true
        later(flush)
      }
    },
    dispose() {
      baseline = undefined
      clearedAfter = undefined
      pendingOrigin = undefined
      abort.abort()
    },
  }
}

function slicePromptMediaChunk(
  entry:
    | { type: 'image' | 'document'; mediaType: string; bytes: Buffer }
    | { deny: string }
    | { unreadable: string },
  offset: number,
): Record<string, unknown> {
  if (!('bytes' in entry) || entry.bytes === undefined) {
    return entry as Record<string, unknown>
  }
  const total = entry.bytes.length
  if (offset > 0 && offset >= total) {
    return { deny: `offset ${offset} is at or past the item's ${total} bytes` }
  }
  const rawEnd = Math.min(offset + PROMPT_MEDIA_MAX_CHUNK, total)
  const alignedEnd =
    rawEnd < total
      ? rawEnd - ((rawEnd - offset) % PROMPT_MEDIA_B64_ALIGN)
      : rawEnd
  return {
    type: entry.type,
    mediaType: entry.mediaType,
    base64: entry.bytes.subarray(offset, alignedEnd).toString('base64'),
    size: total,
    ...(alignedEnd < total ? { next: alignedEnd } : {}),
  }
}

export async function withPromptSubmitMedia<T>(
  items: readonly PromptMediaAttachmentInput[],
  fn: (listedMedia: readonly string[]) => Promise<T>,
): Promise<T> {
  const ids: string[] = []
  for (const item of items) {
    const id = `media_${++fhState().promptMediaSeq}`
    let cached: ReturnType<PromptMediaAttachmentInput['read']> | undefined
    fhState().promptMediaEntries.set(id, () => (cached ??= item.read()))
    ids.push(id)
  }
  const prev = activeHookServingAls.getStore()
  try {
    return await activeHookServingAls.run(
      { ...prev, listedMedia: ids, isDispatching: () => true },
      () => fn(ids),
    )
  } finally {
    for (const id of ids) fhState().promptMediaEntries.delete(id)
  }
}

export async function readPromptMediaById(
  id: string,
  offset = 0,
): Promise<Record<string, unknown>> {
  const reader = fhState().promptMediaEntries.get(id)
  if (!reader) return PROMPT_MEDIA_ABSENT
  const entry = await reader()
  if (!fhState().promptMediaEntries.has(id)) return PROMPT_MEDIA_ABSENT
  return slicePromptMediaChunk(entry, offset)
}

export function extractAutocompleteToken(input: {
  text: string
  cursor: number
}): { text: string; cursor: number; token: string; start: number } | undefined {
  const cursor = Math.min(Math.max(input.cursor, 0), input.text.length)
  let start = cursor
  while (start > 0 && input.text.charAt(start - 1).trim() !== '') {
    start -= 1
  }
  if (start === cursor) return undefined
  return {
    text: input.text,
    cursor,
    token: input.text.slice(start, cursor),
    start,
  }
}

export function normalizeAutocompleteSuggestions(
  suggestions: unknown,
): PromptAutocompleteSuggestion[] {
  if (!Array.isArray(suggestions)) return []
  const out: PromptAutocompleteSuggestion[] = []
  for (const item of suggestions) {
    if (!isEventRecord(item) || typeof item.text !== 'string') continue
    const text = item.text.trim()
    if (text === '') continue
    const label =
      typeof item.label === 'string'
        ? item.label.replace(/\s+/gu, ' ').trim()
        : undefined
    const description =
      typeof item.description === 'string' ? item.description : undefined
    out.push({
      text,
      ...(label !== undefined && label !== '' && { label }),
      ...(description !== undefined && { description }),
    })
  }
  return out
}

export const SESSION_RECEIVE_HOP_SITE: FunctionHookHopSite = {
  restoreArgument: (passed, original) =>
    restorePinnedKeys(['agentId'], passed, original),
  checkArgument: (passed, original) => {
    if (!isDeepStrictEqual(passed.origin, original.origin)) {
      return 'a changed origin (the bridge set it; next(e) passes it on)'
    }
    if (!isDeepStrictEqual(passed.event, original.event)) {
      return 'a changed event (parsed from the delivery; next(e) passes it on)'
    }
    if (passed.agentId !== original.agentId) {
      return 'a changed agentId (the loop the delivery is for; next(e) passes it on)'
    }
    return typeof passed.text === 'string'
      ? undefined
      : 'no { text } (a string)'
  },
  check: returned => {
    if (!isEventRecord(returned)) {
      return 'not an object'
    }
    if (
      returned.consumed !== undefined &&
      typeof returned.consumed !== 'string'
    ) {
      return 'a consumed that is not a string'
    }
    if (returned.consumed === undefined && typeof returned.text !== 'string') {
      return 'neither { consumed } nor { text } (a string)'
    }
    return undefined
  },
}

export const PROMPT_AUTOCOMPLETE_HOP_SITE: FunctionHookHopSite = {
  restoreArgument: (passed, original) =>
    restorePinnedKeys(['text', 'cursor', 'token', 'start'], passed, original),
  checkArgument: (passed, original) => {
    if (
      passed.text !== original.text ||
      passed.cursor !== original.cursor ||
      passed.token !== original.token ||
      passed.start !== original.start
    ) {
      return 'a changed text, cursor, token, or start (pinned)'
    }
    return undefined
  },
  check: returned => {
    if (!isEventRecord(returned) || !Array.isArray(returned.suggestions)) {
      return 'no { suggestions } (a list)'
    }
    for (const item of returned.suggestions) {
      if (!isEventRecord(item) || typeof item.text !== 'string') {
        return 'a suggestion without { text } (a string)'
      }
    }
    return undefined
  },
}

export async function runPromptAutocomplete(
  input: { text: string; cursor: number },
  signal?: AbortSignal,
): Promise<{ suggestions: PromptAutocompleteSuggestion[]; start?: number }> {
  const tokenInfo = extractAutocompleteToken(input)
  if (!tokenInfo) return { suggestions: [] }
  const raw = await runFunctionHookChain(
    'prompt.autocomplete',
    tokenInfo,
    async () => ({ suggestions: [] }),
    undefined,
    undefined,
    {
      site: PROMPT_AUTOCOMPLETE_HOP_SITE,
      signal,
    },
  )
  const suggestions = isEventRecord(raw)
    ? normalizeAutocompleteSuggestions(raw.suggestions)
    : []
  return { suggestions, start: tokenInfo.start }
}

export function createRemoteAutocompleteDispatcher(
  askFn: (
    tokenInfo: { text: string; cursor: number; token: string; start: number },
    signal: AbortSignal,
  ) => Promise<{ suggestions: PromptAutocompleteSuggestion[] }> = (
    tokenInfo,
    signal,
  ) => runPromptAutocomplete(tokenInfo, signal),
): {
  ask: (
    clientKey: string,
    input: { text: string; cursor: number },
  ) => Promise<{
    suggestions: PromptAutocompleteSuggestion[]
    start?: number
    superseded?: true
  }>
} {
  type PendingAsk = {
    input: { text: string; cursor: number }
    resolve: (res: {
      suggestions: PromptAutocompleteSuggestion[]
      start?: number
      superseded?: true
    }) => void
  }
  const byClient = new Map<
    string,
    { inFlight?: AbortController; waiting?: PendingAsk }
  >()

  const pump = (
    clientKey: string,
    slot: { inFlight?: AbortController; waiting?: PendingAsk },
  ): void => {
    const next = slot.waiting
    if (!next || slot.inFlight) return
    slot.waiting = undefined
    const tokenInfo = extractAutocompleteToken(next.input)
    if (!tokenInfo) {
      next.resolve({ suggestions: [] })
      pump(clientKey, slot)
      return
    }
    const controller = new AbortController()
    slot.inFlight = controller
    void Promise.resolve()
      .then(() => askFn(tokenInfo, controller.signal))
      .then(res => normalizeAutocompleteSuggestions(res?.suggestions))
      .catch(() => [] as PromptAutocompleteSuggestion[])
      .then(suggestions => {
        slot.inFlight = undefined
        if (controller.signal.aborted) {
          next.resolve({ suggestions: [], superseded: true })
        } else {
          next.resolve({ suggestions, start: tokenInfo.start })
        }
        pump(clientKey, slot)
      })
  }

  return {
    ask: (clientKey, input) =>
      new Promise(resolve => {
        const slot = byClient.get(clientKey) ?? {}
        byClient.set(clientKey, slot)
        slot.waiting?.resolve({ suggestions: [], superseded: true })
        slot.waiting = { input, resolve }
        pump(clientKey, slot)
      }),
  }
}

function commandOwnerOf(name: string): string | undefined {
  return fhState().pluginCommands.get(name)?.plugin
}

function sessionSlashCommands(): Array<{
  name: string
  description?: string
  argumentHint?: unknown
  immediate?: unknown
}> {
  const state = fhState().functionHooksAppStateReader?.() as
    | (AppState & { commands?: unknown })
    | undefined
  if (!state) return []
  const bags: unknown[] = []
  if (Array.isArray(state.commands)) bags.push(...state.commands)
  if (Array.isArray(state.plugins?.commands))
    bags.push(...state.plugins.commands)
  if (Array.isArray(state.mcp?.commands)) bags.push(...state.mcp.commands)
  const listed: Array<{
    name: string
    description?: string
    argumentHint?: unknown
    immediate?: unknown
  }> = []
  const seen = new Set<string>()
  for (const item of bags) {
    if (
      !isEventRecord(item) ||
      typeof item.name !== 'string' ||
      item.name === ''
    ) {
      continue
    }
    if (seen.has(item.name)) continue
    seen.add(item.name)
    listed.push({
      name: item.name,
      ...(typeof item.description === 'string' && {
        description: item.description,
      }),
      ...(item.argumentHint !== undefined && {
        argumentHint: item.argumentHint,
      }),
      ...(item.immediate !== undefined && { immediate: item.immediate }),
    })
  }
  return listed
}

export function listPluginCommands(): Array<{
  command: string
  description: string
  argumentHint?: unknown
  immediate?: unknown
}> {
  const listed = [...fhState().pluginCommands.values()].map(({ spec }) => ({
    command: spec.name,
    description: spec.description,
    ...(spec.argumentHint !== undefined && { argumentHint: spec.argumentHint }),
    ...(spec.immediate !== undefined && { immediate: spec.immediate }),
  }))
  const seen = new Set(listed.map(item => item.command))
  for (const cmd of sessionSlashCommands()) {
    if (seen.has(cmd.name)) continue
    seen.add(cmd.name)
    listed.push({
      command: cmd.name,
      description: typeof cmd.description === 'string' ? cmd.description : '',
      ...(cmd.argumentHint !== undefined && { argumentHint: cmd.argumentHint }),
      ...(cmd.immediate !== undefined && { immediate: cmd.immediate }),
    })
  }
  return listed
}

export function registerPluginCommand(
  input: Record<string, unknown>,
  plugin?: string,
): { command: string } {
  const prefix = plugin ?? ''
  const name = String(input.name ?? '')
  const owner = commandOwnerOf(name)
  if (owner !== undefined && owner !== prefix) {
    throw new Error(
      `${prefix}: $.command.register: "/${name}" refused: the plugin ${owner} registered it already`,
    )
  }
  const spec: PluginCommandSpec = {
    name,
    description: String(input.description ?? ''),
    ...(input.argumentHint !== undefined && {
      argumentHint: input.argumentHint,
    }),
    ...(input.immediate !== undefined && { immediate: input.immediate }),
  }
  if (
    owner === prefix &&
    jsonEqual(fhState().pluginCommands.get(name)?.spec, spec)
  ) {
    return { command: name }
  }
  fhState().pluginCommands.set(name, { plugin: prefix, spec })
  return { command: name }
}

export async function runPluginCommand(
  input: Record<string, unknown>,
  plugin?: string,
): Promise<unknown> {
  const prefix = plugin ?? ''
  const command = typeof input.command === 'string' ? input.command : ''
  const args = String(input.args ?? '')
  if (
    commandOwnerOf(command) === undefined &&
    !sessionSlashCommands().some(item => item.name === command)
  ) {
    return Promise.reject(
      new Error(
        `${prefix}: $.command.run: no command named /${command} in this session`,
      ),
    )
  }
  const slash = args === '' ? `/${command}` : `/${command} ${args}`
  const refused = checkPluginInputRefusal({ plugin: prefix }, '$.command.run')
  if (refused !== undefined) {
    return Promise.reject(new Error(`${prefix}: $.command.run: ${refused}`))
  }
  const cmdRunHandler = fhState().commandRunHandler
  if (cmdRunHandler) return cmdRunHandler(slash)
  // densable W0n / Loe / Noe / Nv later.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('crypto') as typeof import('crypto')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { enqueue, getCommandQueue } =
    require('../../messageQueueManager.js') as typeof import('../../messageQueueManager.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { recordCommandRunWait } =
    require('../../processUserInput/commandRunWaits.js') as typeof import('../../processUserInput/commandRunWaits.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { markAheadOfSessionStart } =
    require('../../processUserInput/promptSubmitEntries.js') as typeof import('../../processUserInput/promptSubmitEntries.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { markTurnHookQueuedPrompt } =
    require('../../processUserInput/turnHookQueuedPrompts.js') as typeof import('../../processUserInput/turnHookQueuedPrompts.js')
  const uuid = randomUUID()
  const origin = { kind: 'plugin' as const, name: plugin ?? '' }
  const wait = recordCommandRunWait(uuid, origin)
  const rootEvent = getLiveHookEvent()
  markAheadOfSessionStart(uuid, rootEvent)
  markTurnHookQueuedPrompt(uuid, rootEvent, getCommandQueue())
  enqueue({
    mode: 'prompt',
    value: slash,
    uuid,
    origin,
    priority: 'later',
  })
  return wait
}

function sessionUserMessages(): unknown[] {
  const app = fhState().functionHooksAppStateReader?.() as
    | { messages?: unknown[] }
    | undefined
  const messages = app?.messages
  return Array.isArray(messages) ? messages : []
}

function isCountableUserTurn(message: unknown): boolean {
  if (!isEventRecord(message) || message.type !== 'user') return false
  if (message.isMeta === true || message.isVirtual === true) return false
  return true
}

/** densable D$n — count user turns that are not meta/virtual. */
export function countSessionTurns(): number {
  return sessionUserMessages().filter(isCountableUserTurn).length
}

function agentConversationDeny(agentId: string): { deny: string } {
  return {
    deny: `no conversation of agent ${agentId} in this session: not one of its agents, running in another process, or finished with no saved transcript this session reads back`,
  }
}

function liveAgentMessages(agentId: string): unknown[] | undefined {
  const tasks = fhState().functionHooksAppStateReader?.()?.tasks ?? {}
  const matches: Record<string, unknown>[] = []
  for (const task of Object.values(tasks) as unknown[]) {
    if (!isEventRecord(task)) continue
    if (task.type !== 'local_agent' && task.type !== 'in_process_teammate') {
      continue
    }
    const identity = isEventRecord(task.identity) ? task.identity : undefined
    const id =
      typeof task.agentId === 'string'
        ? task.agentId
        : typeof task.id === 'string'
          ? task.id
          : undefined
    const identityId =
      typeof identity?.agentId === 'string' ? identity.agentId : undefined
    const resumable =
      typeof identity?.resumableAgentId === 'string'
        ? identity.resumableAgentId
        : undefined
    if (id !== agentId && identityId !== agentId && resumable !== agentId) {
      continue
    }
    // densable Joe: fork workers and teammates without a resumable id
    // are not this session's live transcript for $.session.messages.
    if (task.type === 'local_agent' && task.forkWorker === true) continue
    if (task.type === 'in_process_teammate' && resumable === undefined) continue
    matches.push(task)
  }
  const live =
    matches.find(
      t =>
        t.status !== 'completed' &&
        t.status !== 'failed' &&
        t.status !== 'killed',
    ) ?? matches.at(-1)
  if (live === undefined) return undefined
  const messages = live.messages
  return Array.isArray(messages) ? messages : []
}

async function savedAgentMessages(
  agentId: string,
): Promise<unknown[] | undefined> {
  try {
    const { asAgentId } = await import('../../../types/ids.js')
    const { getAgentTranscriptPath } = await import('../../sessionPaths.js')
    const { existsSync } = await import('fs')
    const transcriptPath = getAgentTranscriptPath(asAgentId(agentId))
    if (!existsSync(transcriptPath)) return undefined
    const { loadTranscriptFile } = await import('../../sessionStorage.js')
    const loaded = await loadTranscriptFile(transcriptPath)
    const messages = [...loaded.messages.values()]
    return messages.length > 0 ? messages : undefined
  } catch (error) {
    logForDebugging(
      `$.session.messages: the saved transcript of agent ${agentId} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'warn' },
    )
    return undefined
  }
}

function messageUuid(message: unknown): string | undefined {
  if (!isEventRecord(message) || typeof message.uuid !== 'string') {
    return undefined
  }
  return message.uuid
}

function toGoldSessionRow(message: unknown): GoldSessionMessage | undefined {
  if (!isEventRecord(message)) return undefined
  if (message.role === 'user' || message.role === 'assistant') {
    const rawToolUses = Array.isArray(message.toolUses) ? message.toolUses : []
    const toolUses: GoldSessionToolUse[] = rawToolUses
      .filter(isEventRecord)
      .map(tu => {
        const id =
          typeof tu.tool_use_id === 'string'
            ? tu.tool_use_id
            : typeof tu.id === 'string'
              ? tu.id
              : ''
        return {
          ...tu,
          id,
          tool_use_id: id,
          tool: typeof tu.tool === 'string' ? tu.tool : '',
          input: plainInputClone(tu.input),
        } as GoldSessionToolUse
      })
    return {
      ...(message as GoldSessionMessage),
      role: message.role,
      text: typeof message.text === 'string' ? message.text : '',
      toolUses,
    }
  }
  const msgBody = isEventRecord(message.message) ? message.message : undefined
  if (message.type === 'assistant') {
    const content = msgBody?.content
    const textParts: string[] = []
    const toolUses: GoldSessionToolUse[] = []
    if (typeof content === 'string') {
      textParts.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!isEventRecord(block)) continue
        if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text)
        } else if (block.type === 'tool_use') {
          const id = typeof block.id === 'string' ? block.id : ''
          toolUses.push({
            id,
            tool_use_id: id,
            tool: typeof block.name === 'string' ? block.name : '',
            input: plainInputClone(block.input),
          })
        }
      }
    }
    return {
      role: 'assistant',
      text: textParts.join(''),
      toolUses,
    }
  }
  if (message.type !== 'user') return undefined
  if (message.isMeta === true || message.isVirtual === true) return undefined
  const content = msgBody?.content
  if (content === undefined || typeof content === 'string') {
    return {
      role: 'user',
      text: typeof content === 'string' ? content : '',
      toolUses: [],
    }
  }
  const textParts: string[] = []
  const toolResults: GoldSessionToolResult[] = []
  const hasToolUseResult = message.toolUseResult !== undefined
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isEventRecord(block)) continue
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text)
      } else if (block.type === 'tool_result') {
        toolResults.push({
          tool_use_id:
            typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
          text: toolResultTextFromContent(block.content),
          isError: block.is_error === true,
          ...(hasToolUseResult && { result: message.toolUseResult }),
        })
      }
    }
  }
  return {
    role: 'user',
    text: textParts.join(''),
    toolUses: [],
    ...(toolResults.length > 0 && { toolResults }),
  }
}

function shapeSessionMessages(
  rawMessages: unknown[],
  asApi: boolean,
  plugin?: string,
): unknown[] {
  if (rawMessages.length === 0) return []
  if (asApi) {
    return rawMessages.flatMap(item => {
      if (!isEventRecord(item)) return []
      if (
        (item.type === 'user' || item.type === 'assistant') &&
        isEventRecord(item.message)
      ) {
        return [item.message]
      }
      if (item.role === 'user' || item.role === 'assistant') return [item]
      return []
    })
  }
  // Preserve direct host-op unit test stubs (`{ type: 'user' }` without `.message` or `.role`)
  const allBareStubs = rawMessages.every(
    item =>
      isEventRecord(item) &&
      !('message' in item) &&
      !('role' in item) &&
      (item.type === 'user' || item.type === 'assistant'),
  )
  if (allBareStubs && plugin === undefined) {
    return rawMessages
  }
  const out: GoldSessionMessage[] = []
  const resultsById = new Map<string, GoldSessionToolResult>()
  for (let i = rawMessages.length - 1; i >= 0; i--) {
    if (out.length >= SESSION_MESSAGES_CAP) break
    const row = toGoldSessionRow(rawMessages[i])
    if (!row) continue
    for (const tr of row.toolResults ?? []) {
      if (tr.tool_use_id !== '') resultsById.set(tr.tool_use_id, tr)
    }
    const enrichedToolUses = row.toolUses.map(tu => {
      const match = resultsById.get(tu.tool_use_id)
      if (!match) return tu
      const isAgentTool = tu.tool === AGENT_TOOL_NAME || tu.tool === 'Task'
      const agentExtras =
        isAgentTool && isEventRecord(match.result)
          ? {
              ...(typeof match.result.agentId === 'string' && {
                agentId: match.result.agentId,
              }),
              ...(typeof match.result.totalDurationMs === 'number' && {
                durationMs: match.result.totalDurationMs,
              }),
            }
          : {}
      return {
        ...tu,
        ...('result' in match && { result: match.result }),
        text: match.text,
        ...(match.isError && { isError: true as const }),
        ...agentExtras,
      }
    })
    out.push({ ...row, toolUses: enrichedToolUses })
  }
  return out.reverse()
}

export async function listSessionMessages(
  input: Record<string, unknown>,
  plugin?: string,
): Promise<unknown[] | { deny: string }> {
  const asApi = input.as === 'api'
  if (typeof input.agentId !== 'string') {
    return shapeSessionMessages(sessionUserMessages(), asApi, plugin)
  }
  const agentId = input.agentId
  const saved = await savedAgentMessages(agentId)
  const live = liveAgentMessages(agentId)
  if (!saved) {
    if (live === undefined) return agentConversationDeny(agentId)
    return shapeSessionMessages(live, asApi, plugin)
  }
  const liveList = live ?? []
  const seen = new Set(
    liveList.flatMap(message => {
      const uuid = messageUuid(message)
      return uuid === undefined ? [] : [uuid]
    }),
  )
  const combined = [
    ...saved.filter(message => {
      const uuid = messageUuid(message)
      return uuid === undefined || !seen.has(uuid)
    }),
    ...liveList,
  ]
  return shapeSessionMessages(combined, asApi, plugin)
}

export function sessionTools(): SessionListedTool[] {
  const app = fhState().functionHooksAppStateReader?.() as
    | { tools?: SessionListedTool[] }
    | undefined
  return Array.isArray(app?.tools) ? app.tools : []
}

export async function listSessionTools(): Promise<
  Array<{
    name: string
    description: string
    mcp: boolean
  }>
> {
  const listed = []
  for (const tool of sessionTools()) {
    let description = tool.name
    const prompt = (tool as { prompt?: unknown }).prompt
    if (typeof prompt === 'function') {
      try {
        const value = await prompt({})
        if (typeof value === 'string' && value !== '') description = value
      } catch {
        description = tool.name
      }
    } else if (
      typeof tool.description === 'string' &&
      tool.description !== ''
    ) {
      description = tool.description
    }
    listed.push({
      name: tool.name,
      description,
      mcp: tool.isMcp === true,
    })
  }
  return listed
}

export function runTurnAbort(
  input: Record<string, unknown>,
  plugin?: string,
): Promise<unknown> {
  const heldTurn = activeHookServingAls.getStore()?.turnHeld
  const turnId =
    typeof input.turnId === 'string' && input.turnId !== ''
      ? input.turnId
      : (heldTurn ?? '')
  const who = plugin !== undefined && plugin !== '' ? `${plugin}: ` : ''
  const running = getMainThreadTurn()
  if (!running) {
    const abortHandler = fhState().turnAbortHandler
    if (abortHandler) return abortHandler({ turnId })
    return Promise.reject(
      new Error(`${who}$.turn.abort: no turn is running (asked for ${turnId})`),
    )
  }
  if (running.turnId !== turnId) {
    return Promise.reject(
      new Error(
        `${who}$.turn.abort: ${turnId} is not the running turn (${running.turnId}); a hook ends the turn turn.start told it about`,
      ),
    )
  }
  if (running.cancelled()) {
    return Promise.reject(
      new Error(`${who}$.turn.abort: ${turnId} is already ending`),
    )
  }
  running.cancel()
  return Promise.resolve()
}

export function runPromptSubmit(
  input: Record<string, unknown>,
  plugin?: string,
): Promise<unknown> {
  const text = typeof input.text === 'string' ? input.text : ''
  const submitHandler = fhState().promptSubmitHandler
  if (submitHandler) return submitHandler({ text })
  // densable Boo / LBn: record waiter then enqueue. Art Ios(hss) settles it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('crypto') as typeof import('crypto')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { enqueue } =
    require('../../messageQueueManager.js') as typeof import('../../messageQueueManager.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { recordPromptSubmitWait } =
    require('../../processUserInput/promptSubmitWaits.js') as typeof import('../../processUserInput/promptSubmitWaits.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { markAheadOfSessionStart } =
    require('../../processUserInput/promptSubmitEntries.js') as typeof import('../../processUserInput/promptSubmitEntries.js')
  const uuid = randomUUID()
  const asUser = input.asUser === true
  const origin = asUser
    ? { kind: 'plugin' as const, name: plugin ?? '', asUser: true as const }
    : { kind: 'plugin' as const, name: plugin ?? '' }
  const wait = recordPromptSubmitWait(uuid, origin)
  const rootEvent = getLiveHookEvent()
  markAheadOfSessionStart(uuid, rootEvent)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getCommandQueue } =
    require('../../messageQueueManager.js') as typeof import('../../messageQueueManager.js')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { markTurnHookQueuedPrompt } =
    require('../../processUserInput/turnHookQueuedPrompts.js') as typeof import('../../processUserInput/turnHookQueuedPrompts.js')
  markTurnHookQueuedPrompt(uuid, rootEvent, getCommandQueue())
  enqueue({
    mode: 'prompt',
    value: text,
    uuid,
    origin,
    priority: 'later',
  })
  return wait
}

export async function runPromptFill(
  input: Record<string, unknown>,
  plugin?: string,
): Promise<{
  isFilled: boolean
  refusal?: string
  text: string
  cursor: number
}> {
  const rawText = typeof input.text === 'string' ? input.text : ''
  const rawMode = input.mode
  if (rawMode !== undefined && !isPromptFillMode(rawMode)) {
    hostCheck(
      'prompt.fill',
      `takes { mode } of ${PROMPT_FILL_MODES.join(', ')}`,
      plugin,
    )
  }
  const mode = isPromptFillMode(rawMode) ? rawMode : 'replace'
  const storeState = getPromptInputCursorState()
  const currentText =
    storeState.active || getPromptInputStoreValue() !== ''
      ? storeState.value
      : fhState().promptBoxText
  const currentCursor = Math.max(
    0,
    Math.min(
      storeState.cursor !== null
        ? storeState.cursor
        : storeState.active || getPromptInputStoreValue() !== ''
          ? currentText.length
          : fhState().promptBoxCursor,
      currentText.length,
    ),
  )
  const applyFill = (
    fillText: string,
    fillMode: (typeof PROMPT_FILL_MODES)[number],
  ): { text: string; cursor: number } => {
    if (fillMode === 'append') {
      const nextText = `${currentText}${fillText}`
      return { text: nextText, cursor: nextText.length }
    }
    if (fillMode === 'insert') {
      const nextText = `${currentText.slice(0, currentCursor)}${fillText}${currentText.slice(currentCursor)}`
      return { text: nextText, cursor: currentCursor + fillText.length }
    }
    return { text: fillText, cursor: fillText.length }
  }
  const commitDraft = (nextText: string, nextCursor: number) => {
    fhState().promptBoxText = nextText
    fhState().promptBoxCursor = nextCursor
    setPromptInputStoreValue(nextText)
    savePromptInputCursorOffset(nextCursor)
    return {
      isFilled: true,
      text: nextText,
      cursor: nextCursor,
    }
  }
  const origin =
    plugin !== undefined && plugin !== ''
      ? { kind: 'plugin' as const, name: plugin }
      : { kind: 'engine' as const }
  const payload: Record<string, unknown> = {
    text: rawText,
    mode,
    origin,
    ...(Array.isArray(input.decorations) && { decorations: input.decorations }),
  }
  const hookOrigin = buildOpHookOrigin(plugin)
  if (!hasMatchingFunctionHookForOp('prompt.fill', payload, hookOrigin)) {
    const applied = applyFill(rawText, mode)
    return commitDraft(applied.text, applied.cursor)
  }
  let filledDraft: { text: string; cursor: number } | undefined
  const out = await runFunctionHookChain(
    'prompt.fill',
    payload,
    async event => {
      const nextMode = isPromptFillMode(event.mode) ? event.mode : mode
      const nextText = typeof event.text === 'string' ? event.text : rawText
      filledDraft = applyFill(nextText, nextMode)
      commitDraft(filledDraft.text, filledDraft.cursor)
      return { isFilled: true }
    },
    undefined,
    undefined,
    {
      origin: resolveHookCallOrigin(plugin),
      hookOrigin,
    },
  )
  if (isEventRecord(out) && out.isFilled === false) {
    return {
      isFilled: false,
      ...(typeof out.refusal === 'string' && { refusal: out.refusal }),
      text: currentText,
      cursor: currentCursor,
    }
  }
  const settled = filledDraft ?? applyFill(rawText, mode)
  if (filledDraft === undefined) {
    commitDraft(settled.text, settled.cursor)
  }
  return {
    isFilled: true,
    text: settled.text,
    cursor: settled.cursor,
  }
}

export function runSessionCompact(
  instructions: string,
  plugin?: string,
): Promise<unknown> {
  const who = plugin !== undefined && plugin !== '' ? plugin : ''
  if (process.env.DISABLE_COMPACT) {
    return Promise.reject(
      new Error(
        `${who}: $.session.compact: compaction is switched off in this session (DISABLE_COMPACT), for /compact and plugins alike`,
      ),
    )
  }
  const running = fhState().turnRunningReader?.() ?? getMainThreadTurn()
  if (running !== undefined) {
    return Promise.reject(
      new Error(
        `${who}: $.session.compact: a turn is running (${running.turnId}); the conversation compacts between turns, so call it from turn.complete or later`,
      ),
    )
  }
  const compactHandler = fhState().sessionCompactHandler
  if (compactHandler) {
    return compactHandler({ instructions }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${who}: $.session.compact: ${message}`)
    })
  }
  return Promise.reject(
    new Error(
      `${who}: $.session.compact is not available in this mode: no session is bound in this process (the REPL has not mounted and no headless session is built); catch it and carry on`,
    ),
  )
}

function sessionSendResult(raw: unknown): {
  isDelivered: boolean
  reason?: string
} {
  if (!isEventRecord(raw)) {
    return {
      isDelivered: false,
      reason: 'the SendMessage tool did not deliver it',
    }
  }
  if (typeof raw.deny === 'string') {
    return { isDelivered: false, reason: raw.deny }
  }
  const result = isEventRecord(raw.result) ? raw.result : undefined
  if (raw.isError !== true && result?.success === true) {
    return { isDelivered: true }
  }
  const message = result?.message
  return {
    isDelivered: false,
    reason:
      typeof message === 'string' && message !== ''
        ? message
        : typeof raw.text === 'string' && raw.text !== ''
          ? raw.text
          : 'the SendMessage tool did not deliver it',
  }
}

export async function runSessionSend(
  input: Record<string, unknown>,
  plugin?: string,
): Promise<{ isDelivered: boolean; reason?: string }> {
  const tools = sessionTools()
  if (!tools.some(tool => tool.name === 'SendMessage')) {
    return {
      isDelivered: false,
      reason:
        'this session has no SendMessage tool (messaging between sessions and agents is not on here)',
    }
  }
  const to = sessionSendAddress(input.to)
  if (typeof to !== 'string' || to === '') {
    return {
      isDelivered: false,
      reason: `no live session on this machine has id ${String(input.to)} (a session that exited, or another machine's; a Remote Control or cloud session is addressed by its session_... id)`,
    }
  }
  const sendToolCallHandler = fhState().toolCallHandler
  if (!sendToolCallHandler) {
    return {
      isDelivered: false,
      reason: `no live session on this machine has id ${to} (a session that exited, or another machine's; a Remote Control or cloud session is addressed by its session_... id)`,
    }
  }
  const raw = await sendToolCallHandler({
    tool: 'SendMessage',
    to,
    message: input.text,
  })
  return sessionSendResult(raw)
}
