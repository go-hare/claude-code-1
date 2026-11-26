import { createHash } from 'crypto'
import type { Dirent } from 'fs'
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'fs/promises'
import { homedir } from 'os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { getCwd } from '../../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type ImportSourceId = 'codex' | 'gemini' | 'cursor'
export type ImportItemKind =
  | 'instructions'
  | 'setting'
  | 'subagent'
  | 'command'
  | 'mcp'
  | 'skill'
export type ImportScope = 'user' | 'project'

export type ImportApplyResult = string | { skipped: string }

export type ImportableItem = {
  id: string
  kind: ImportItemKind
  scope: ImportScope
  label: string
  description?: string
  warning?: string
  fingerprint: string
  apply: (opts: { dryRun: boolean }) => Promise<ImportApplyResult>
}

export type UnmappableItem = {
  scope: ImportScope
  label: string
  reason: string
}

export type SourceScan = {
  sourceId: ImportSourceId
  displayName: string
  result: {
    items: ImportableItem[]
    unmappable: UnmappableItem[]
  }
}

export type ScanForeignConfigsResult = {
  scans: SourceScan[]
  error?: string
  warnings?: string[]
}

export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MiB

const KIND_ORDER: Record<ImportItemKind, number> = {
  instructions: 0,
  setting: 1,
  subagent: 2,
  command: 3,
  mcp: 4,
  skill: 5,
}

const KNOWN_SOURCES: readonly { id: ImportSourceId; displayName: string }[] = [
  { id: 'codex', displayName: 'OpenAI Codex' },
  { id: 'gemini', displayName: 'Google Gemini CLI' },
  { id: 'cursor', displayName: 'Cursor' },
]

/** Official 2.1.331 `MHn` — auto-apply predicate for `--yes`. */
export function isAutoImportSafe(item: {
  scope: ImportScope
  warning?: string
  kind: ImportItemKind
}): boolean {
  return item.scope === 'user' && !item.warning && item.kind !== 'skill'
}

/** Official 2.1.331 `SUt` — classify held-back items for `--yes`. */
export function getAutoImportHoldReason(item: {
  scope: ImportScope
  warning?: string
  kind: ImportItemKind
}): 'project' | 'warned' | null {
  if (item.scope === 'project') return 'project'
  if (item.warning || item.kind === 'skill') return 'warned'
  return null
}

/** Official 2.1.331 `Z` — safe basename for imported command/rule/skill files. */
export function sanitizeImportedName(raw: string): string {
  const cleaned =
    raw
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/-{3,}/g, m => '_'.repeat(m.length))
      .replace(/^-+/, '_') || '_'
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned
}

/** Official 2.1.331 `Kpe` / `OV` — strip terminal control chars from untrusted labels. */
export function sanitizeDisplayText(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI / control chars from untrusted foreign config strings
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim()
}

export function hasShellExecMarker(text: string): boolean {
  return (
    text.includes('```!') ||
    (text.includes('!`') && /(?<=^|\s)!`[^`]+`/m.test(text))
  )
}

function escapesRoot(rel: string): boolean {
  return isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)
}

export function isPathStrictlyInside(root: string, candidate: string): boolean {
  const absRoot = resolve(root)
  const absCandidate = resolve(candidate)
  const rel = relative(absRoot, absCandidate)
  return rel !== '' && !escapesRoot(rel)
}

async function ensureNoSymlinkEscape(
  root: string,
  target: string,
): Promise<boolean> {
  if (!isPathStrictlyInside(root, target)) return false
  const absRoot = resolve(root)
  const relParts = relative(absRoot, resolve(target)).split(sep)
  let current = absRoot
  for (const part of relParts) {
    current = join(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) return false
    } catch {
      // Non-existent suffix is safe to create
      return true
    }
  }
  try {
    const [realRoot, realTarget] = await Promise.all([
      realpath(absRoot),
      realpath(resolve(target)),
    ])
    const rel = relative(realRoot, realTarget)
    return rel !== '' && !escapesRoot(rel)
  } catch {
    return true
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

async function readSafeTextFile(filePath: string): Promise<string> {
  const info = await stat(filePath)
  if (!info.isFile()) {
    throw new Error(`Refusing to read ${filePath}: not a regular file`)
  }
  if (info.size > IMPORT_MAX_FILE_BYTES) {
    throw new Error('file exceeds IMPORT_MAX_FILE_BYTES; refusing to load')
  }
  return readFile(filePath, 'utf8')
}

function sha256Short(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function sortItems(items: ImportableItem[]): ImportableItem[] {
  return [...items].sort((a, b) => {
    const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    if (kindDiff !== 0) return kindDiff
    if (a.scope !== b.scope) return a.scope === 'project' ? -1 : 1
    return a.label.localeCompare(b.label)
  })
}

async function writeSafeNewFile(opts: {
  target: string
  root: string
  content: string
  label: string
  dryRun: boolean
}): Promise<ImportApplyResult> {
  if (!(await ensureNoSymlinkEscape(opts.root, opts.target))) {
    return {
      skipped: `${opts.label}: target is outside allowed root or under a symlink`,
    }
  }
  if (await pathExists(opts.target)) {
    return { skipped: `${opts.label} (already exists at ${opts.target})` }
  }
  if (opts.dryRun) {
    return `${opts.label} -> ${opts.target}`
  }
  await mkdir(dirname(opts.target), { recursive: true })
  await writeFile(opts.target, opts.content, { encoding: 'utf8', flag: 'wx' })
  return `${opts.label} -> ${opts.target}`
}

async function addMcpServerToConfig(opts: {
  targetFile: string
  root: string
  serverName: string
  serverConfig: Record<string, unknown>
  dryRun: boolean
}): Promise<ImportApplyResult> {
  if (!(await ensureNoSymlinkEscape(opts.root, opts.targetFile))) {
    return {
      skipped: `MCP ${opts.serverName}: target path failed containment check`,
    }
  }
  let existing: Record<string, unknown> = {}
  if (await pathExists(opts.targetFile)) {
    try {
      const parsed = JSON.parse(
        await readSafeTextFile(opts.targetFile),
      ) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>
      }
    } catch {
      return {
        skipped: `MCP ${opts.serverName}: existing ${opts.targetFile} is not valid JSON`,
      }
    }
  }
  const existingServers =
    existing.mcpServers &&
    typeof existing.mcpServers === 'object' &&
    !Array.isArray(existing.mcpServers)
      ? (existing.mcpServers as Record<string, unknown>)
      : {}
  if (Object.hasOwn(existingServers, opts.serverName)) {
    return { skipped: `MCP server "${opts.serverName}" (already configured)` }
  }
  if (opts.dryRun) {
    return `MCP server "${opts.serverName}" -> ${opts.targetFile}`
  }
  const next = {
    ...existing,
    mcpServers: {
      ...existingServers,
      [opts.serverName]: opts.serverConfig,
    },
  }
  await mkdir(dirname(opts.targetFile), { recursive: true })
  await writeFile(opts.targetFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return `MCP server "${opts.serverName}" -> ${opts.targetFile}`
}

function makeMarkdownFileItem(opts: {
  id: string
  kind: ImportItemKind
  scope: ImportScope
  label: string
  content: string
  target: string
  root: string
  warning?: string
}): ImportableItem {
  const shellWarning =
    opts.warning ??
    (hasShellExecMarker(opts.content)
      ? 'Contains a Claude Code shell-exec marker (```! or !`…`); review before importing.'
      : undefined)
  return {
    id: opts.id,
    kind: opts.kind,
    scope: opts.scope,
    label: opts.label,
    warning: shellWarning,
    fingerprint: sha256Short(opts.content),
    apply: ({ dryRun }) =>
      writeSafeNewFile({
        target: opts.target,
        root: opts.root,
        content: opts.content,
        label: opts.label,
        dryRun,
      }),
  }
}

async function scanMarkdownDir(opts: {
  dir: string
  scope: ImportScope
  sourceId: ImportSourceId
  kind: ImportItemKind
  targetDir: string
  targetRoot: string
  extensions: readonly string[]
  items: ImportableItem[]
  unmappable: UnmappableItem[]
}): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(opts.dir, { withFileTypes: true })
  } catch {
    return
  }
  const files = entries
    .filter(
      e =>
        e.isFile() &&
        opts.extensions.some(ext => e.name.toLowerCase().endsWith(ext)),
    )
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const file of files) {
    const srcPath = join(opts.dir, file.name)
    try {
      const content = await readSafeTextFile(srcPath)
      const base = file.name.replace(/\.[^.]+$/, '')
      const safe = sanitizeImportedName(base)
      const target = join(opts.targetDir, `${safe}.md`)
      opts.items.push(
        makeMarkdownFileItem({
          id: `${opts.sourceId}:${opts.scope}:${opts.kind}:${safe}`,
          kind: opts.kind,
          scope: opts.scope,
          label: `${opts.kind}: ${file.name}`,
          content,
          target,
          root: opts.targetRoot,
        }),
      )
    } catch {
      opts.unmappable.push({
        scope: opts.scope,
        label: file.name,
        reason: 'Could not read file.',
      })
    }
  }
}

async function scanSkillsDir(opts: {
  dir: string
  scope: ImportScope
  sourceId: ImportSourceId
  targetSkillsDir: string
  targetRoot: string
  items: ImportableItem[]
}): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(opts.dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const skillMd = join(opts.dir, entry.name, 'SKILL.md')
    if (!(await pathExists(skillMd))) continue
    try {
      const content = await readSafeTextFile(skillMd)
      const safe = sanitizeImportedName(entry.name)
      const target = join(opts.targetSkillsDir, safe, 'SKILL.md')
      opts.items.push(
        makeMarkdownFileItem({
          id: `${opts.sourceId}:${opts.scope}:skill:${safe}`,
          kind: 'skill',
          scope: opts.scope,
          label: `skill: ${entry.name}`,
          content,
          target,
          root: opts.targetRoot,
        }),
      )
    } catch {
      // skip unreadable skill
    }
  }
}

async function scanMcpJsonFile(opts: {
  filePath: string
  scope: ImportScope
  sourceId: ImportSourceId
  labelPrefix: string
  targetMcpFile: string
  targetRoot: string
  items: ImportableItem[]
  unmappable: UnmappableItem[]
}): Promise<void> {
  if (!(await pathExists(opts.filePath))) return
  let raw: string
  try {
    raw = await readSafeTextFile(opts.filePath)
  } catch {
    opts.unmappable.push({
      scope: opts.scope,
      label: opts.labelPrefix,
      reason: 'Could not read MCP configuration.',
    })
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    opts.unmappable.push({
      scope: opts.scope,
      label: opts.labelPrefix,
      reason: 'Invalid JSON; review MCP servers manually.',
    })
    return
  }
  const servers =
    parsed &&
    typeof parsed === 'object' &&
    'mcpServers' in parsed &&
    parsed.mcpServers &&
    typeof parsed.mcpServers === 'object' &&
    !Array.isArray(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, unknown>)
      : null
  if (!servers) return

  for (const [rawName, cfg] of Object.entries(servers).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue
    const safeName = sanitizeImportedName(rawName)
    const serverCfg = cfg as Record<string, unknown>
    opts.items.push({
      id: `${opts.sourceId}:${opts.scope}:mcp:${safeName}`,
      kind: 'mcp',
      scope: opts.scope,
      label: `MCP server: ${rawName}`,
      fingerprint: sha256Short(JSON.stringify(serverCfg)),
      apply: ({ dryRun }) =>
        addMcpServerToConfig({
          targetFile: opts.targetMcpFile,
          root: opts.targetRoot,
          serverName: safeName,
          serverConfig: serverCfg,
          dryRun,
        }),
    })
  }
}

async function scanCodex(
  homeDir: string,
  cwd: string,
  claudeDir: string,
): Promise<SourceScan | null> {
  const userDir = join(homeDir, '.codex')
  const projectDir = join(cwd, '.codex')
  const items: ImportableItem[] = []
  const unmappable: UnmappableItem[] = []
  let detected =
    (await pathExists(userDir)) ||
    (await pathExists(projectDir)) ||
    (await pathExists(join(cwd, 'AGENTS.md'))) ||
    (await pathExists(join(cwd, 'AGENTS.override.md')))

  const userAgents = join(userDir, 'AGENTS.md')
  if (await pathExists(userAgents)) {
    detected = true
    try {
      const content = await readSafeTextFile(userAgents)
      items.push(
        makeMarkdownFileItem({
          id: 'codex:user:instructions',
          kind: 'instructions',
          scope: 'user',
          label: '~/.codex/AGENTS.md -> ~/.claude/CLAUDE.md',
          content,
          target: join(claudeDir, 'CLAUDE.md'),
          root: claudeDir,
        }),
      )
    } catch {
      unmappable.push({
        scope: 'user',
        label: '~/.codex/AGENTS.md',
        reason: 'Could not read instructions file.',
      })
    }
  }

  for (const fileName of ['AGENTS.md', 'AGENTS.override.md']) {
    const projectAgents = join(cwd, fileName)
    if (await pathExists(projectAgents)) {
      detected = true
      try {
        const content = await readSafeTextFile(projectAgents)
        items.push(
          makeMarkdownFileItem({
            id: `codex:project:instructions:${fileName}`,
            kind: 'instructions',
            scope: 'project',
            label: `${fileName} -> CLAUDE.md`,
            content,
            target: join(cwd, 'CLAUDE.md'),
            root: cwd,
          }),
        )
      } catch {
        unmappable.push({
          scope: 'project',
          label: fileName,
          reason: 'Could not read instructions file.',
        })
      }
    }
  }

  if (await pathExists(join(userDir, 'config.toml'))) {
    detected = true
    unmappable.push({
      scope: 'user',
      label: '~/.codex/config.toml',
      reason: 'TOML settings require manual review or /import-to-claude-code.',
    })
  }

  await scanMarkdownDir({
    dir: join(userDir, 'prompts'),
    scope: 'user',
    sourceId: 'codex',
    kind: 'command',
    targetDir: join(claudeDir, 'commands'),
    targetRoot: claudeDir,
    extensions: ['.md'],
    items,
    unmappable,
  })
  await scanSkillsDir({
    dir: join(userDir, 'skills'),
    scope: 'user',
    sourceId: 'codex',
    targetSkillsDir: join(claudeDir, 'skills'),
    targetRoot: claudeDir,
    items,
  })

  if (!detected && items.length === 0 && unmappable.length === 0) return null
  return {
    sourceId: 'codex',
    displayName: 'OpenAI Codex',
    result: { items: sortItems(items), unmappable },
  }
}

async function scanGemini(
  homeDir: string,
  cwd: string,
  claudeDir: string,
): Promise<SourceScan | null> {
  const userDir = join(homeDir, '.gemini')
  const items: ImportableItem[] = []
  const unmappable: UnmappableItem[] = []
  let detected =
    (await pathExists(userDir)) || (await pathExists(join(cwd, 'GEMINI.md')))

  const userGeminiMd = join(userDir, 'GEMINI.md')
  if (await pathExists(userGeminiMd)) {
    detected = true
    try {
      const content = await readSafeTextFile(userGeminiMd)
      items.push(
        makeMarkdownFileItem({
          id: 'gemini:user:instructions',
          kind: 'instructions',
          scope: 'user',
          label: '~/.gemini/GEMINI.md -> ~/.claude/CLAUDE.md',
          content,
          target: join(claudeDir, 'CLAUDE.md'),
          root: claudeDir,
        }),
      )
    } catch {
      unmappable.push({
        scope: 'user',
        label: '~/.gemini/GEMINI.md',
        reason: 'Could not read GEMINI.md.',
      })
    }
  }

  const projectGeminiMd = join(cwd, 'GEMINI.md')
  if (await pathExists(projectGeminiMd)) {
    detected = true
    try {
      const content = await readSafeTextFile(projectGeminiMd)
      items.push(
        makeMarkdownFileItem({
          id: 'gemini:project:instructions',
          kind: 'instructions',
          scope: 'project',
          label: 'GEMINI.md -> CLAUDE.md',
          content,
          target: join(cwd, 'CLAUDE.md'),
          root: cwd,
        }),
      )
    } catch {
      unmappable.push({
        scope: 'project',
        label: 'GEMINI.md',
        reason: 'Could not read GEMINI.md.',
      })
    }
  }

  await scanMcpJsonFile({
    filePath: join(userDir, 'settings.json'),
    scope: 'user',
    sourceId: 'gemini',
    labelPrefix: '~/.gemini/settings.json',
    targetMcpFile: join(claudeDir, 'settings.json'),
    targetRoot: claudeDir,
    items,
    unmappable,
  })

  // Gemini TOML custom commands (`~/.gemini/commands/*.toml`)
  try {
    const cmdDir = join(userDir, 'commands')
    const entries = await readdir(cmdDir, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.toml')) continue
      detected = true
      try {
        const raw = await readSafeTextFile(join(cmdDir, entry.name))
        const promptMatch = /prompt\s*=\s*(?:"""([\s\S]*?)"""|"([^"]*)")/.exec(
          raw,
        )
        const body = (promptMatch?.[1] ?? promptMatch?.[2] ?? '').replaceAll(
          '{{args}}',
          '$ARGUMENTS',
        )
        if (!body.trim()) {
          unmappable.push({
            scope: 'user',
            label: `~/.gemini/commands/${entry.name}`,
            reason: 'Could not extract prompt from TOML command.',
          })
          continue
        }
        const safe = sanitizeImportedName(entry.name.replace(/\.toml$/i, ''))
        const hasGeminiShell = /!\{[^}]+\}/.test(body)
        items.push(
          makeMarkdownFileItem({
            id: `gemini:user:command:${safe}`,
            kind: 'command',
            scope: 'user',
            label: `command: /${safe}`,
            content: body,
            target: join(claudeDir, 'commands', `${safe}.md`),
            root: claudeDir,
            warning: hasGeminiShell
              ? 'Contains Gemini !{...} shell execution syntax; review before running.'
              : undefined,
          }),
        )
      } catch {
        unmappable.push({
          scope: 'user',
          label: `~/.gemini/commands/${entry.name}`,
          reason: 'Could not read TOML command.',
        })
      }
    }
  } catch {
    // commands dir optional
  }

  if (!detected && items.length === 0 && unmappable.length === 0) return null
  return {
    sourceId: 'gemini',
    displayName: 'Google Gemini CLI',
    result: { items: sortItems(items), unmappable },
  }
}

async function scanCursor(
  homeDir: string,
  cwd: string,
  claudeDir: string,
): Promise<SourceScan | null> {
  const userDir = join(homeDir, '.cursor')
  const projectDir = join(cwd, '.cursor')
  const items: ImportableItem[] = []
  const unmappable: UnmappableItem[] = []
  let detected =
    (await pathExists(userDir)) ||
    (await pathExists(projectDir)) ||
    (await pathExists(join(cwd, '.cursorrules')))

  await scanMcpJsonFile({
    filePath: join(userDir, 'mcp.json'),
    scope: 'user',
    sourceId: 'cursor',
    labelPrefix: '~/.cursor/mcp.json',
    targetMcpFile: join(claudeDir, 'settings.json'),
    targetRoot: claudeDir,
    items,
    unmappable,
  })
  await scanMcpJsonFile({
    filePath: join(projectDir, 'mcp.json'),
    scope: 'project',
    sourceId: 'cursor',
    labelPrefix: '.cursor/mcp.json',
    targetMcpFile: join(cwd, '.mcp.json'),
    targetRoot: cwd,
    items,
    unmappable,
  })

  if (await pathExists(join(cwd, '.cursorrules'))) {
    detected = true
    try {
      const content = await readSafeTextFile(join(cwd, '.cursorrules'))
      items.push(
        makeMarkdownFileItem({
          id: 'cursor:project:instructions:cursorrules',
          kind: 'instructions',
          scope: 'project',
          label: '.cursorrules -> CLAUDE.md',
          content,
          target: join(cwd, 'CLAUDE.md'),
          root: cwd,
        }),
      )
    } catch {
      unmappable.push({
        scope: 'project',
        label: '.cursorrules',
        reason: 'Could not read .cursorrules.',
      })
    }
  }

  if (await pathExists(join(cwd, '.cursorignore'))) {
    detected = true
    unmappable.push({
      scope: 'project',
      label: '.cursorignore',
      reason:
        'Claude Code has no direct equivalent. Configure permissions.deny rules in .claude/settings.json instead.',
    })
  }

  await scanMarkdownDir({
    dir: join(userDir, 'rules'),
    scope: 'user',
    sourceId: 'cursor',
    kind: 'instructions',
    targetDir: join(claudeDir, 'rules'),
    targetRoot: claudeDir,
    extensions: ['.md', '.mdc'],
    items,
    unmappable,
  })
  await scanMarkdownDir({
    dir: join(projectDir, 'rules'),
    scope: 'project',
    sourceId: 'cursor',
    kind: 'instructions',
    targetDir: join(cwd, '.claude', 'rules'),
    targetRoot: cwd,
    extensions: ['.md', '.mdc'],
    items,
    unmappable,
  })
  await scanMarkdownDir({
    dir: join(userDir, 'commands'),
    scope: 'user',
    sourceId: 'cursor',
    kind: 'command',
    targetDir: join(claudeDir, 'commands'),
    targetRoot: claudeDir,
    extensions: ['.md'],
    items,
    unmappable,
  })
  await scanMarkdownDir({
    dir: join(projectDir, 'commands'),
    scope: 'project',
    sourceId: 'cursor',
    kind: 'command',
    targetDir: join(cwd, '.claude', 'commands'),
    targetRoot: cwd,
    extensions: ['.md'],
    items,
    unmappable,
  })
  await scanSkillsDir({
    dir: join(userDir, 'skills'),
    scope: 'user',
    sourceId: 'cursor',
    targetSkillsDir: join(claudeDir, 'skills'),
    targetRoot: claudeDir,
    items,
  })
  await scanSkillsDir({
    dir: join(projectDir, 'skills'),
    scope: 'project',
    sourceId: 'cursor',
    targetSkillsDir: join(cwd, '.claude', 'skills'),
    targetRoot: cwd,
    items,
  })

  if (!detected && items.length === 0 && unmappable.length === 0) return null
  return {
    sourceId: 'cursor',
    displayName: 'Cursor',
    result: { items: sortItems(items), unmappable },
  }
}

/**
 * Official 2.1.331 `PZo` — scan foreign AI coding agent configs (`codex`, `gemini`, `cursor`).
 */
export async function scanForeignAgentConfigs(opts?: {
  from?: string
  homeDir?: string
  cwd?: string
  claudeConfigDir?: string
}): Promise<ScanForeignConfigsResult> {
  const homeDir = opts?.homeDir ?? homedir()
  const cwd = opts?.cwd ?? getCwd()
  const claudeDir = opts?.claudeConfigDir ?? getClaudeConfigHomeDir()

  const requested = opts?.from?.toLowerCase()
  const validIds = KNOWN_SOURCES.map(s => s.id)
  if (requested && !validIds.includes(requested as ImportSourceId)) {
    return {
      scans: [],
      error: `Unknown source "${opts?.from}". Expected one of: ${validIds.join(', ')}.`,
    }
  }

  const targets: ImportSourceId[] = requested
    ? [requested as ImportSourceId]
    : [...validIds]

  const scans: SourceScan[] = []
  for (const id of targets) {
    let scan: SourceScan | null = null
    if (id === 'codex') scan = await scanCodex(homeDir, cwd, claudeDir)
    else if (id === 'gemini') scan = await scanGemini(homeDir, cwd, claudeDir)
    else if (id === 'cursor') scan = await scanCursor(homeDir, cwd, claudeDir)
    if (scan) scans.push(scan)
  }

  return { scans }
}

/**
 * Official 2.1.331 `k(m)` in `chunk-0ap76e7n.js` — deterministic 32-hex SHA-256
 * digest binding `--yes=<digest>` to the exact previewed scan.
 */
export function computeImportScanDigest(scans: readonly SourceScan[]): string {
  const hash = createHash('sha256')
  const sortedScans = [...scans].sort((a, b) =>
    a.sourceId.localeCompare(b.sourceId),
  )
  for (const scan of sortedScans) {
    hash.update(scan.sourceId).update('\0')
    const sortedItems = [...scan.result.items].sort((a, b) =>
      a.id.localeCompare(b.id),
    )
    for (const item of sortedItems) {
      hash
        .update(
          JSON.stringify([
            item.id,
            item.kind,
            item.scope,
            item.label,
            item.description ?? '',
            item.warning ?? '',
            item.fingerprint,
          ]),
        )
        .update('\0')
    }
    hash.update('\x01')
    const sortedUnmappable = [...scan.result.unmappable].sort(
      (a, b) =>
        a.label.localeCompare(b.label) ||
        a.reason.localeCompare(b.reason) ||
        a.scope.localeCompare(b.scope),
    )
    for (const u of sortedUnmappable) {
      hash.update(JSON.stringify([u.scope, u.label, u.reason])).update('\0')
    }
  }
  return hash.digest('hex').slice(0, 32)
}

/**
 * Official 2.1.331 `Bdo` — write helper skill `skills/import-to-claude-code/SKILL.md`
 * listing unmapped foreign config items for manual porting.
 */
export async function writeImportFallbackSkill(
  sources: ReadonlyArray<{
    sourceId: ImportSourceId
    displayName: string
    unmappable: readonly UnmappableItem[]
  }>,
  opts: { dryRun: boolean; claudeConfigDir?: string },
): Promise<ImportApplyResult> {
  const claudeDir = opts.claudeConfigDir ?? getClaudeConfigHomeDir()
  const target = join(claudeDir, 'skills', 'import-to-claude-code', 'SKILL.md')
  const lines: string[] = [
    '---',
    'name: import-to-claude-code',
    'description: Finish porting unmapped config items from another AI coding agent',
    '---',
    '',
    '# Unmapped Agent Config Items',
    '',
    'Review each item below and port the desired settings into Claude Code:',
    '',
  ]
  for (const src of sources) {
    if (src.unmappable.length === 0) continue
    lines.push(`## ${src.displayName}`)
    for (const item of src.unmappable) {
      lines.push(
        `- [${item.scope}] ${sanitizeDisplayText(item.label)} — ${sanitizeDisplayText(item.reason)}`,
      )
    }
    lines.push('')
  }
  return writeSafeNewFile({
    target,
    root: claudeDir,
    content: lines.join('\n'),
    label: 'helper skill /import-to-claude-code',
    dryRun: opts.dryRun,
  })
}
