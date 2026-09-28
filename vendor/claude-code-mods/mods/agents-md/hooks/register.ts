// @ts-nocheck — SourceTextModule evaluates this as JS; no TypeScript syntax.
/**
 * densable 2.1.283 built-in plugin `agents-md` (`$e` / `et`).
 * Loaded by the function-hooks compositor. Core CLAUDE.md walk stays GEn.
 * Plain JS: SourceTextModule cannot evaluate TypeScript `as` / types.
 */
export const PLUGIN_NAME = 'agents-md'
export const PLUGIN_DESCRIPTION =
  'AGENTS.md as project instructions: by default loaded where the project has no CLAUDE.md; by its instructionFiles option, loaded beside CLAUDE.md, left out, or with the project instructions dropped'

export const AGENTS_NAMES = ['AGENTS.md', '.claude/AGENTS.md']
export const CLAUDE_NAMES = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']
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

const MAIN_LOOP = 'main'
const FEATURE_NAME = 'agents_md'
const LOAD_EVENT = 'agents_md_load'
const MODE_EVENT = 'agents_md_mode'
const NESTED_EVENT = 'agents_md_nested'
const WALK_FAILED_REASON = 'walk_failed'
const EMPTY = []
const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

export function chainRootOf(file, byPath) {
  const seen = new Set([file.path])
  let path = file.path
  let parent = file.parent
  while (parent !== undefined && !seen.has(parent)) {
    seen.add(parent)
    path = parent
    parent = byPath.get(parent)?.parent
  }
  return path
}

export function filesOf(hits) {
  return hits.flatMap(hit =>
    hit.parts.map((part, index) => ({
      path: part.path,
      kind: 'project',
      content: part.content,
      ...(index > 0 && { parent: hit.parts[0]?.path ?? part.path }),
    })),
  )
}

function pathSep(sample) {
  return sample.includes('\\') ? '\\' : '/'
}

export function absoluteOf(filePath, cwd, home) {
  if ((filePath === '~' || filePath.startsWith('~/')) && home !== undefined) {
    const root = home.replace(/(?<=.)[\\/]+$/, '')
    return filePath === '~'
      ? root
      : `${root}${pathSep(root)}${filePath.slice(2)}`
  }
  return /^(?:[A-Za-z]:)?[\\/]/.test(filePath)
    ? filePath
    : `${cwd}${pathSep(cwd)}${filePath}`
}

export function normalSpellingOf(path) {
  return path.replaceAll('\\', '/').replace(/(?<=.)\/+$/, '')
}

export function isBelow(path, root) {
  return normalSpellingOf(path).startsWith(`${normalSpellingOf(root)}/`)
}

export function isFileAt(file, path) {
  return normalSpellingOf(file.path) === normalSpellingOf(path)
}

export function nestedFrame(file) {
  return `Contents of ${file.path}:\n\n${file.content}`
}

export function outsideClaudeDirs(agents, claude) {
  const dirs = new Set(claude.map(hit => hit.dir))
  return agents.filter(hit => !dirs.has(hit.dir))
}

export function isProjectOwn(file) {
  return file.kind === 'project' || file.kind === 'local'
}

export function projectDirOf(path) {
  const spelling = normalSpellingOf(path)
  const claude = spelling.lastIndexOf('/.claude/')
  const slash = claude === -1 ? spelling.lastIndexOf('/') : claude
  return slash <= 0 ? '/' : spelling.slice(0, slash)
}

export function insertionIndex(files, projectDir) {
  const byPath = new Map(files.map(file => [file.path, file]))
  const below = files.findIndex(
    file =>
      isProjectOwn(file) &&
      isBelow(projectDirOf(chainRootOf(file, byPath)), projectDir),
  )
  if (below !== -1) return below
  const lastOwn = files.findLastIndex(isProjectOwn)
  if (lastOwn !== -1) return lastOwn + 1
  const memory = files.findIndex(file => file.kind === 'memory')
  return memory === -1 ? files.length : memory
}

export function isClaudeFileOnWalk(file, root) {
  if (
    !(
      isProjectOwn(file) &&
      file.parent === undefined &&
      CLAUDE_NAMES.some(name =>
        normalSpellingOf(file.path).endsWith(`/${name}`),
      )
    )
  ) {
    return false
  }
  const dir = projectDirOf(file.path)
  const spelling = normalSpellingOf(root)
  return dir === spelling || isBelow(spelling, dir)
}

export function isKeptWithoutInstructions(file) {
  return !DROPPED_KINDS.includes(file.kind)
}

export function unseenFiles(incoming, existing) {
  const paths = new Set(existing.map(file => normalSpellingOf(file.path)))
  const contents = new Set(
    existing.filter(isProjectOwn).map(file => file.content.trim()),
  )
  const out = []
  for (const file of incoming) {
    const path = normalSpellingOf(file.path)
    const content = file.content.trim()
    if (paths.has(path) || (content !== '' && contents.has(content))) continue
    paths.add(path)
    out.push(file)
  }
  return out
}

export function withProjectFiles(existing, added) {
  if (added.length === 0) return [...existing]
  const next = [...existing]
  const byPath = new Map(added.map(file => [file.path, file]))
  const grouped = new Map()
  for (const file of added) {
    const dir = projectDirOf(chainRootOf(file, byPath))
    grouped.set(dir, [...(grouped.get(dir) ?? []), file])
  }
  for (const [dir, files] of grouped) {
    next.splice(insertionIndex(next, dir), 0, ...files)
  }
  return next
}

export function legacyModeOf(value) {
  if (value === undefined) return undefined
  return (
    (typeof value === 'string' ? LEGACY_PROJECT_INSTRUCTIONS[value] : undefined) ??
    'claude-md'
  )
}

export function modeOf(value) {
  return MODES.find(mode => mode === value) ?? DEFAULT_MODE
}

export function isSwitchedOn(value) {
  return value !== undefined && TRUTHY.has(value.trim().toLowerCase())
}

export function loadCountsOf(files, isYielded, isWalkFailed) {
  const importCount = files.reduce(
    (sum, file) => sum + (file.parent === undefined ? 0 : 1),
    0,
  )
  return {
    fileCount: files.length - importCount,
    importCount,
    totalContentLength: files.reduce((sum, file) => sum + file.content.length, 0),
    isYielded,
    isWalkFailed,
  }
}

function loadMarkOf(counts) {
  return counts.isWalkFailed
    ? { feature: FEATURE_NAME, kind: 'sad', reason: WALK_FAILED_REASON }
    : { feature: FEATURE_NAME, kind: 'ok' }
}

function modeChoiceOf(mode) {
  return { value: mode, of: MODES }
}

function loadRowOf(mode, counts) {
  return {
    event: LOAD_EVENT,
    props: {
      mode: modeChoiceOf(mode),
      file_count: counts.fileCount,
      import_count: counts.importCount,
      total_content_length: counts.totalContentLength,
      yielded: counts.isYielded,
      walk_failed: counts.isWalkFailed,
    },
  }
}

function modeRowOf(mode, isInteractive) {
  return {
    event: MODE_EVENT,
    props: { mode: modeChoiceOf(mode), is_interactive: isInteractive },
  }
}

function nestedRowOf(mode, fileCount) {
  return {
    event: NESTED_EVENT,
    props: { mode: modeChoiceOf(mode), file_count: fileCount },
  }
}

function quietly(work) {
  Promise.resolve()
    .then(work)
    .catch(() => {
      return
    })
}

function isRecord(value) {
  return typeof value === 'object' && value !== null
}

function asFiles(value) {
  return Array.isArray(value) ? value : undefined
}

function isTruncatedRead(result) {
  if (!isRecord(result) || result.type !== 'text') return false
  const file = result.file
  if (!isRecord(file)) return true
  const truncated = file.truncatedByTokenCap
  const startLine = file.startLine
  const numLines = file.numLines
  const totalLines = file.totalLines
  return !(
    (truncated === undefined || truncated === false) &&
    startLine === 1 &&
    typeof numLines === 'number' &&
    typeof totalLines === 'number' &&
    numLines >= totalLines
  )
}

async function attachmentsEnabled(api) {
  const [simple, disabled] = await Promise.all([
    api.env.get('CLAUDE_CODE_SIMPLE'),
    api.env.get('CLAUDE_CODE_DISABLE_ATTACHMENTS'),
  ])
  return !isSwitchedOn(simple) && !isSwitchedOn(disabled)
}

async function homeOf(api, cwd) {
  const [home, profile] = await Promise.all([
    api.env.get('HOME'),
    api.env.get('USERPROFILE'),
  ])
  return cwd.includes('\\') ? (profile ?? home) : (home ?? profile)
}

export function register(on, options = {}) {
  const instructionFilesMode = modeOf(options.instructionFiles)
  const legacy = legacyModeOf(options.projectInstructions)
  const honourLegacy =
    legacy !== undefined && instructionFilesMode === DEFAULT_MODE
  const mode = honourLegacy ? legacy : instructionFilesMode
  let warnedLegacy = legacy === undefined
  on('session.start', (_api, event, next) => {
    const api = _api
    quietly(() =>
      api.telemetry?.log?.(modeRowOf(mode, Boolean(event.isInteractive))),
    )
    if (!warnedLegacy) {
      warnedLegacy = true
      api.ui.log(
        honourLegacy
          ? `option projectInstructions in settings is honoured for now, read as instructionFiles ${mode}; set instructionFiles to ${mode} and remove projectInstructions`
          : `option projectInstructions in settings is not read: instructionFiles ${mode} is set; remove projectInstructions`,
      )
    }
    return next(event)
  })
  if (mode === 'claude-md') return
  if (mode === 'managed-only') {
    // Gold matcher `{instructionFiles:{kind}}` is an engine field filter.
    // Local matcherAllows is `===`, so the hook is registered without it.
    on('prompt.context', (_api, event, next) =>
      next({
        ...event,
        instructionFiles: asFiles(event.instructionFiles)?.filter(
          isKeptWithoutInstructions,
        ),
      }),
    )
    return
  }
  const fallback = mode === 'claude-md-or-agents-md'
  const nestedSeen = new Map()
  let lastContextFiles = []
  let home
  let yieldedClaude
  let lastRoot
  let loggedRoot
  let loggedLoad = false
  on('prompt.context', async (api, event, next) => {
    const files = asFiles(event.instructionFiles)
    if (files === undefined) {
      return next(event).finally(() => {
        nestedSeen.clear()
      })
    }
    const root = fallback ? await api.session.root() : undefined
    lastRoot = root ?? lastRoot
    let walkFailed = false
    yieldedClaude =
      root !== undefined &&
      (files.some(file => isClaudeFileOnWalk(file, root)) ||
        (await api.fs.ancestors({ names: CLAUDE_NAMES }).then(
          hits => hits.length > 0,
          () => {
            walkFailed = true
            return true
          },
        )))
    const hits = yieldedClaude
      ? EMPTY
      : await api.fs.ancestors({ names: AGENTS_NAMES }).catch(() => {
          walkFailed = true
          return EMPTY
        })
    const added = unseenFiles(filesOf(hits), files)
    if (!loggedLoad) {
      loggedLoad = true
      const counts = loadCountsOf(
        added,
        Boolean(yieldedClaude && !walkFailed),
        walkFailed,
      )
      quietly(() => api.telemetry?.log?.(loadRowOf(mode, counts)))
      quietly(() => api.telemetry?.mark?.(loadMarkOf(counts)))
    }
    if (root !== undefined && root !== loggedRoot && added.length > 0) {
      loggedRoot = root
      api.ui.log(
        'no CLAUDE.md found; AGENTS.md loaded: ' +
          added
            .filter(file => file.parent === undefined)
            .map(file => file.path)
            .join(', '),
      )
    }
    const merged = withProjectFiles(files, added)
    return next({ ...event, instructionFiles: merged }).finally(() => {
      nestedSeen.clear()
      lastContextFiles = merged
    })
  })
  on('agent.spawn', { fork: true }, async (_api, event, next) => {
    const spawned = await next(event)
    if (spawned.agentId !== undefined) {
      const parent = nestedSeen.get(String(event.parentAgentId ?? MAIN_LOOP))
      nestedSeen.set(String(spawned.agentId), new Set(parent))
    }
    return spawned
  })
  on('tool.call', { tool: 'Read' }, async (api, event, next) => {
    const result = await next(event)
    if (event.tool !== 'Read' || result.deny !== undefined || result.isError) {
      return result
    }
    if (!(await attachmentsEnabled(api))) return result
    const [root, cwd] = await Promise.all([
      api.session.root(),
      api.session.cwd(),
    ])
    home ??= await homeOf(api, cwd)
    const filePath = absoluteOf(String(event.file_path ?? ''), cwd, home)
    if (root !== lastRoot) {
      lastRoot = root
      yieldedClaude = undefined
      nestedSeen.clear()
    }
    yieldedClaude ??=
      fallback && (await api.fs.ancestors({ names: CLAUDE_NAMES })).length > 0
    if (yieldedClaude || !isBelow(filePath, root)) return result
    const [agents, claude] = await Promise.all([
      api.fs.ancestors({ names: AGENTS_NAMES, of: filePath, below: root }),
      api.fs.ancestors({ names: CLAUDE_NAMES, of: filePath, below: root }),
    ]).catch(() => [EMPTY, EMPTY])
    const agentId = String(event.agentId ?? MAIN_LOOP)
    const seen = nestedSeen.get(agentId) ?? new Set()
    nestedSeen.set(agentId, seen)
    const scoped = (fallback ? outsideClaudeDirs(agents, claude) : agents).filter(
      hit => isBelow(hit.dir, root),
    )
    const fresh = unseenFiles(filesOf(scoped), [
      ...lastContextFiles,
      ...filesOf(claude),
    ]).filter(file => !seen.has(file.path))
    const extra = fresh.filter(file => !isFileAt(file, filePath))
    const fullRead =
      event.offset === undefined &&
      event.limit === undefined &&
      !isTruncatedRead(result.result)
    for (const file of fresh) {
      if (extra.includes(file) || (isFileAt(file, filePath) && fullRead)) {
        seen.add(file.path)
      }
    }
    const injected = extra.length > 0
    if (injected) {
      quietly(() => api.telemetry?.log?.(nestedRowOf(mode, extra.length)))
    }
    return injected
      ? {
          ...result,
          context: [...(result.context ?? []), ...extra.map(nestedFrame)],
        }
      : result
  })
}
