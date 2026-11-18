// @ts-nocheck — SourceTextModule evaluates this as JS; no TypeScript syntax.
/**
 * 2.1.325 built-in plugin `cc-plugin-agents-md`.
 * Plain JS: SourceTextModule cannot evaluate TypeScript `as` / types.
 */
export const PLUGIN_NAME = 'cc-plugin-agents-md'
export const PLUGIN_DESCRIPTION =
  'AGENTS.md as project instructions: by default loaded where the project has no CLAUDE.md; by its instructionFiles option, loaded beside CLAUDE.md, left out, or with the project instructions dropped'

export const AGENTS_NAMES = ['AGENTS.md', '.claude/AGENTS.md']
export const CLAUDE_NAMES = [
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  'CLAUDE.local.md',
]
export const DEFAULT_LOOP = 'main'
export const RESET_COMMANDS = ['clear', 'compact', 'resume']
export const DEFAULT_MODE = 'claude-md-or-agents-md'
export const DROPPED_KINDS = ['project', 'local', 'user']
export const MODES = [
  'claude-md',
  'claude-md-or-agents-md',
  'claude-md-and-agents-md',
  'managed-only',
]
export const LEGACY_PROJECT_INSTRUCTIONS = {
  none: 'managed-only',
  claude: 'claude-md',
  'agents-fallback': 'claude-md-or-agents-md',
  both: 'claude-md-and-agents-md',
}

export const USER_CONFIG = {
  instructionFiles: {
    type: 'string',
    title: 'Project instructions',
    description:
      '"claude-md": CLAUDE.md only, loaded by the engine as today. "claude-md-or-agents-md" (default): a project with no CLAUDE.md of its own gets its AGENTS.md files instead, loaded exactly where and how CLAUDE.md would be. "claude-md-and-agents-md": AGENTS.md files are loaded beside CLAUDE.md (a file CLAUDE.md already imports or links to is not loaded twice). "managed-only": the project\'s and your own instruction files are dropped; the organization\'s managed CLAUDE.md and memory stay.',
    required: false,
    default: DEFAULT_MODE,
    options: [...MODES],
  },
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const isTruthyEnv = value =>
  value !== undefined && TRUTHY.has(value.trim().toLowerCase())

const sepFor = path => (path.includes('\\') ? '\\' : '/')

export function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/(?<=.)\/+$/, '')
}

export function isWithin(path, root) {
  return normalizePath(path).startsWith(`${normalizePath(root)}/`)
}

export function samePath(file, target) {
  return normalizePath(file.path) === normalizePath(target)
}

export function formatContextEntry(file) {
  return `Contents of ${file.path}:\n\n${file.content}`
}

export function excludeDirs(candidates, claudeHits) {
  const dirs = new Set(claudeHits.map(item => item.dir))
  return candidates.filter(item => !dirs.has(item.dir))
}

export function appendContext(existing, additions) {
  return [...(existing ?? []), ...additions.map(formatContextEntry)]
}

export function isProjectOrLocal(file) {
  return file.kind === 'project' || file.kind === 'local'
}

export function resolveRootPath(file, byPath) {
  const seen = new Set([file.path])
  let cur = file.path
  let parent = file.parent
  while (parent !== undefined && !seen.has(parent)) {
    seen.add(parent)
    cur = parent
    parent = byPath.get(parent)?.parent
  }
  return cur
}

export function ancestorDirOf(filePath) {
  const norm = normalizePath(filePath)
  const dotClaudeIdx = norm.lastIndexOf('/.claude/')
  const idx = dotClaudeIdx === -1 ? norm.lastIndexOf('/') : dotClaudeIdx
  return idx <= 0 ? '/' : norm.slice(0, idx)
}

export function insertionIndexForDir(files, dir) {
  const byPath = new Map(files.map(file => [file.path, file]))
  const deeperIdx = files.findIndex(
    file =>
      isProjectOrLocal(file) &&
      isWithin(ancestorDirOf(resolveRootPath(file, byPath)), dir),
  )
  if (deeperIdx !== -1) return deeperIdx
  const lastProjectIdx = files.findLastIndex(isProjectOrLocal)
  if (lastProjectIdx !== -1) return lastProjectIdx + 1
  const memoryIdx = files.findIndex(file => file.kind === 'memory')
  return memoryIdx === -1 ? files.length : memoryIdx
}

export function expandHomeOrRelative(targetPath, cwd, home) {
  if (
    (targetPath === '~' || targetPath.startsWith('~/')) &&
    home !== undefined
  ) {
    const cleanHome = home.replace(/(?<=.)[\\/]+$/, '')
    return targetPath === '~'
      ? cleanHome
      : `${cleanHome}${sepFor(cleanHome)}${targetPath.slice(2)}`
  }
  return /^(?:[A-Za-z]:)?[\\/]/.test(targetPath)
    ? targetPath
    : `${cwd}${sepFor(cwd)}${targetPath}`
}

export function ancestorsToInstructionFiles(ancestors) {
  return ancestors.flatMap(entry =>
    entry.parts.map((part, index) => ({
      path: part.path,
      kind: 'project',
      content: part.content,
      ...(index > 0 && { parent: entry.parts[0]?.path ?? part.path }),
    })),
  )
}

export function isClaudeProjectFile(file, root) {
  if (
    !(
      isProjectOrLocal(file) &&
      file.parent === undefined &&
      CLAUDE_NAMES.some(name => normalizePath(file.path).endsWith(`/${name}`))
    )
  ) {
    return false
  }
  const dir = ancestorDirOf(file.path)
  const normRoot = normalizePath(root)
  return dir === normRoot || isWithin(normRoot, dir)
}

export function keepNonDropped(file) {
  return !DROPPED_KINDS.includes(file.kind)
}

export function dedupInstructionFiles(candidates, existing) {
  const seenPaths = new Set(existing.map(file => normalizePath(file.path)))
  const seenContent = new Set(
    existing.filter(isProjectOrLocal).map(file => file.content.trim()),
  )
  const result = []
  for (const file of candidates) {
    const norm = normalizePath(file.path)
    const trimmed = file.content.trim()
    if (
      !(seenPaths.has(norm) || (trimmed !== '' && seenContent.has(trimmed)))
    ) {
      seenPaths.add(norm)
      result.push(file)
    }
  }
  return result
}

export function insertAgentsMdFiles(existing, additions) {
  if (additions.length === 0) return existing
  const result = [...existing]
  const byPath = new Map(additions.map(file => [file.path, file]))
  const grouped = new Map()
  for (const file of additions) {
    const dir = ancestorDirOf(resolveRootPath(file, byPath))
    grouped.set(dir, [...(grouped.get(dir) ?? []), file])
  }
  for (const [dir, group] of grouped) {
    result.splice(insertionIndexForDir(result, dir), 0, ...group)
  }
  return result
}

export function legacyModeOf(value) {
  if (value === undefined) return undefined
  return (
    (typeof value === 'string'
      ? LEGACY_PROJECT_INSTRUCTIONS[value]
      : undefined) ?? 'claude-md'
  )
}

export function resolveMode(value) {
  return MODES.find(mode => mode === value) ?? DEFAULT_MODE
}

const TELEMETRY_FEATURE = 'agents_md'
const MODE_ENUM = value => ({ value, of: MODES })

function summarizeLoad(files, isYielded, isWalkFailed) {
  const importCount = files.reduce(
    (sum, file) => sum + (file.parent === undefined ? 0 : 1),
    0,
  )
  return {
    fileCount: files.length - importCount,
    importCount,
    totalContentLength: files.reduce(
      (sum, file) => sum + file.content.length,
      0,
    ),
    isYielded,
    isWalkFailed,
  }
}

const markForLoad = summary =>
  summary.isWalkFailed
    ? { feature: TELEMETRY_FEATURE, kind: 'sad', reason: 'walk_failed' }
    : { feature: TELEMETRY_FEATURE, kind: 'ok' }

const loadTelemetryEvent = (mode, summary) => ({
  event: 'agents_md_load',
  props: {
    mode: MODE_ENUM(mode),
    file_count: summary.fileCount,
    import_count: summary.importCount,
    total_content_length: summary.totalContentLength,
    yielded: summary.isYielded,
    walk_failed: summary.isWalkFailed,
  },
})

const modeTelemetryEvent = (mode, isInteractive) => ({
  event: 'agents_md_mode',
  props: {
    mode: MODE_ENUM(mode),
    is_interactive: isInteractive,
  },
})

const nestedTelemetryEvent = (mode, fileCount) => ({
  event: 'agents_md_nested',
  props: {
    mode: MODE_ENUM(mode),
    file_count: fileCount,
  },
})

const fireAndForget = fn => {
  Promise.resolve()
    .then(fn)
    .catch(() => undefined)
}

const PENDING_STAGES = ['read', 'submitted', 'riding']
const RIDING_STAGES = ['riding']

function recordPending(state, loop, files) {
  const map = state.pending.get(loop) ?? new Map()
  state.pending.set(loop, map)
  for (const file of files) {
    map.set(file.path, 'read')
  }
}

function clearPending(state, loop, stages) {
  const pendingMap = state.pending.get(loop)
  const givenSet = state.given.get(loop)
  for (const [path, stage] of pendingMap ?? []) {
    if (stages === undefined || stages.includes(stage)) {
      givenSet?.delete(path)
      pendingMap?.delete(path)
    }
  }
}

function settlePendingOnTurnComplete(state, loop, event) {
  const pendingMap = state.pending.get(loop)
  const stages = [...(pendingMap?.values() ?? [])].includes('riding')
    ? RIDING_STAGES
    : undefined
  if (event.isAborted) {
    clearPending(state, loop, stages)
  }
  for (const [path, stage] of [...(pendingMap ?? [])]) {
    if (stages === undefined || stages.includes(stage)) {
      pendingMap?.delete(path)
    }
  }
}

function advancePending(state, loop, nextStage) {
  const pendingMap = state.pending.get(loop)
  const nextIdx = PENDING_STAGES.indexOf(nextStage)
  for (const [path, stage] of [...(pendingMap ?? [])]) {
    if (PENDING_STAGES.indexOf(stage) < nextIdx) {
      pendingMap?.set(path, nextStage)
    }
  }
}

function commitPendingToGiven(state) {
  state.given.clear()
  for (const [loop, pendingMap] of state.pending) {
    state.given.set(loop, new Set(pendingMap.keys()))
  }
}

const targetSpec = (path, event, road) => ({
  path,
  road,
  loop: event.agentId ?? DEFAULT_LOOP,
  isWhole: event.offset === undefined && event.limit === undefined,
})

const createSubdirState = mode => ({
  mode,
  isFallback: mode === 'claude-md-or-agents-md',
  given: new Map(),
  pending: new Map(),
  inContext: [],
  home: undefined,
  isClaudeProject: undefined,
  rootSeen: undefined,
})

const EMPTY = []
const NO_DEDUP = {}

async function attachmentsAllowed($) {
  const [simple, disabled] = await Promise.all([
    $.env.get('CLAUDE_CODE_SIMPLE'),
    $.env.get('CLAUDE_CODE_DISABLE_ATTACHMENTS'),
  ])
  return !isTruthyEnv(simple) && !isTruthyEnv(disabled)
}

async function readUsageDedupeKey($, mode) {
  try {
    if (
      isTruthyEnv(await $.env.get('CLAUDE_CODE_AGENTS_MD_ROWS_EVERY_PROCESS'))
    ) {
      return NO_DEDUP
    }
    return {
      key: `${await $.session.id()} ${mode}`,
      noted: await $.store.get('usage-rows-queued'),
    }
  } catch (err) {
    $.ui.log(
      `AGENTS.md usage rows: could not read whether this session already sent them, so this process sends them (${String(err)})`,
      { to: 'debug' },
    )
    return NO_DEDUP
  }
}

async function resolveHome($, cwd) {
  const [home, userProfile] = await Promise.all([
    $.env.get('HOME'),
    $.env.get('USERPROFILE'),
  ])
  return cwd.includes('\\') ? (userProfile ?? home) : (home ?? userProfile)
}

async function collectSubdirAgentsMd($, target, state) {
  if (!(await attachmentsAllowed($))) return []
  const [root, cwd] = await Promise.all([$.session.root(), $.session.cwd()])
  state.home ??= await resolveHome($, cwd)
  const resolved = expandHomeOrRelative(target.path, cwd, state.home)
  if (root !== state.rootSeen) {
    state.rootSeen = root
    state.isClaudeProject = undefined
    state.given.clear()
    state.pending.clear()
  }
  state.isClaudeProject ??=
    state.isFallback &&
    (await $.fs.ancestors({ names: CLAUDE_NAMES })).length > 0
  if (state.isClaudeProject || !isWithin(resolved, root)) return []

  const [agentsHits, claudeHits] = await Promise.all([
    $.fs.ancestors({ names: AGENTS_NAMES, of: resolved, below: root }),
    $.fs.ancestors({ names: CLAUDE_NAMES, of: resolved, below: root }),
  ]).catch(() => [EMPTY, EMPTY])

  const givenSet = state.given.get(target.loop) ?? new Set()
  state.given.set(target.loop, givenSet)
  const filteredHits = (
    state.isFallback ? excludeDirs(agentsHits, claudeHits) : agentsHits
  ).filter(hit => isWithin(hit.dir, root))
  const fresh = dedupInstructionFiles(
    ancestorsToInstructionFiles(filteredHits),
    [...state.inContext, ...ancestorsToInstructionFiles(claudeHits)],
  ).filter(file => !givenSet.has(file.path))
  const toInject = fresh.filter(file => !samePath(file, resolved))
  const toMarkGiven = fresh.filter(
    file =>
      toInject.includes(file) || (samePath(file, resolved) && target.isWhole),
  )
  for (const file of toMarkGiven) {
    givenSet.add(file.path)
  }
  if (target.road === 'mention') {
    recordPending(state, target.loop, toMarkGiven)
  }
  if (toInject.length > 0) {
    fireAndForget(() =>
      $.telemetry.log(nestedTelemetryEvent(state.mode, toInject.length)),
    )
  }
  return toInject
}

export function register(on, options = {}) {
  const mode = resolveMode(options.instructionFiles)
  const legacyMode = legacyModeOf(options.projectInstructions)
  const useLegacy = legacyMode !== undefined && mode === DEFAULT_MODE
  const effectiveMode = useLegacy ? legacyMode : mode
  let legacyNotified = legacyMode === undefined
  const usesAgentsMd =
    effectiveMode !== 'claude-md' && effectiveMode !== 'managed-only'
  const usageKeyPromise = Promise.withResolvers()
  let sessionStartSeen = false

  on('session.start', ($, e, next) => {
    sessionStartSeen = true
    fireAndForget(async () => {
      let dedup = NO_DEDUP
      try {
        const info = e.isInteractive
          ? NO_DEDUP
          : await readUsageDedupeKey($, effectiveMode)
        const { key, noted } = info
        const alreadySent =
          key !== undefined &&
          typeof noted === 'string' &&
          (noted === key || noted.startsWith(`${key} `))
        if (!alreadySent) {
          await $.telemetry.log(
            modeTelemetryEvent(effectiveMode, e.isInteractive),
          )
        }
        dedup = info
        if (!alreadySent && !usesAgentsMd && key !== undefined) {
          await $.store.set('usage-rows-queued', key)
        }
      } finally {
        usageKeyPromise.resolve(dedup)
      }
    })
    if (!legacyNotified) {
      legacyNotified = true
      $.ui.log(
        useLegacy
          ? `option projectInstructions in settings is honoured for now, read as instructionFiles ${effectiveMode}; set instructionFiles to ${effectiveMode} and remove projectInstructions`
          : `option projectInstructions in settings is not read: instructionFiles ${effectiveMode} is set; remove projectInstructions`,
      )
    }
    return next(e)
  })

  if (effectiveMode === 'claude-md') return

  if (effectiveMode === 'managed-only') {
    on(
      'prompt.context',
      { instructionFiles: { kind: DROPPED_KINDS } },
      ($, e, next) =>
        next({
          ...e,
          instructionFiles: e.instructionFiles?.filter(keepNonDropped),
        }),
    )
    return
  }

  const state = createSubdirState(effectiveMode)
  const { isFallback, given } = state
  let lastLoggedRoot
  let loadTelemetrySent = false

  on('prompt.context', async ($, e, next) => {
    const files = e.instructionFiles
    if (files === undefined) {
      return next(e).finally(() => {
        commitPendingToGiven(state)
      })
    }
    const root = isFallback ? await $.session.root() : undefined
    state.rootSeen = root ?? state.rootSeen
    let walkFailed = false
    const isClaudeProj =
      root !== undefined &&
      (files.some(file => isClaudeProjectFile(file, root)) ||
        (await $.fs.ancestors({ names: CLAUDE_NAMES }).then(
          hits => hits.length > 0,
          () => {
            walkFailed = true
            return true
          },
        )))
    state.isClaudeProject = isClaudeProj
    const ancestors = isClaudeProj
      ? EMPTY
      : await $.fs.ancestors({ names: AGENTS_NAMES }).catch(() => {
          walkFailed = true
          return EMPTY
        })
    const fresh = dedupInstructionFiles(
      ancestorsToInstructionFiles(ancestors),
      files,
    )
    if (!loadTelemetrySent) {
      loadTelemetrySent = true
      const summary = summarizeLoad(
        fresh,
        isClaudeProj && !walkFailed,
        walkFailed,
      )
      fireAndForget(async () => {
        const { key, noted } = await usageKeyPromise.promise
        const mark = markForLoad(summary)
        const stored = key && `${key} ${mark.kind}`
        if (stored !== undefined && noted === stored) return
        await Promise.all([
          $.telemetry.log(loadTelemetryEvent(effectiveMode, summary)),
          $.telemetry.mark(mark),
        ])
        if (stored !== undefined) {
          await $.store.set('usage-rows-queued', stored)
        }
      })
    }
    if (root !== undefined && root !== lastLoggedRoot && fresh.length > 0) {
      lastLoggedRoot = root
      $.ui.log(
        'no CLAUDE.md found; AGENTS.md loaded: ' +
          fresh
            .filter(file => file.parent === undefined)
            .map(file => file.path)
            .join(', '),
        { to: 'debug' },
      )
    }
    const merged = insertAgentsMdFiles(files, fresh)
    return next({ ...e, instructionFiles: merged }).finally(() => {
      commitPendingToGiven(state)
      state.inContext = merged
    })
  })

  on('command.run', { command: RESET_COMMANDS }, async ($, e, next) => {
    const res = await next(e)
    given.clear()
    state.pending.clear()
    return res
  })

  on('session.compact', async ($, e, next) => {
    const res = await next(e)
    if (res.skip === undefined) {
      clearPending(state, e.agentId ?? DEFAULT_LOOP)
    }
    return res
  })

  on('prompt.submit', ($, e, next) => {
    clearPending(state, DEFAULT_LOOP, ['submitted'])
    advancePending(state, DEFAULT_LOOP, 'submitted')
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (!sessionStartSeen) {
      usageKeyPromise.resolve(NO_DEDUP)
    }
    if (e.agentId === undefined) {
      advancePending(state, DEFAULT_LOOP, 'riding')
    }
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    settlePendingOnTurnComplete(state, e.agentId ?? DEFAULT_LOOP, e)
    return next(e)
  })

  on('agent.spawn', { fork: true }, async ($, e, next) => {
    const res = await next(e)
    if (e.resume === undefined && res.agentId !== undefined) {
      const parentSet = given.get(e.parentAgentId ?? DEFAULT_LOOP)
      const childSet = given.get(res.agentId)
      given.set(
        res.agentId,
        new Set([...(parentSet ?? []), ...(childSet ?? [])]),
      )
    }
    return res
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const res = await next(e)
    if (e.tool !== 'Read' || res.deny !== undefined || res.isError) return res
    const target = targetSpec(e.file_path, e, 'read')
    const injections = await collectSubdirAgentsMd($, target, state)
    return injections.length > 0
      ? { ...res, context: appendContext(res.context, injections) }
      : res
  })

  on('prompt.mention', async ($, e, next) => {
    const res = await next(e)
    const target = targetSpec(e.path, e, 'mention')
    clearPending(state, target.loop, ['submitted'])
    if (res.deny !== undefined || res.type === 'pdf_reference') return res
    const injections = await collectSubdirAgentsMd($, target, state)
    return injections.length > 0
      ? { ...res, context: appendContext(res.context, injections) }
      : res
  })
}
