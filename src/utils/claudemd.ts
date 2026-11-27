/**
 * Files are loaded in the following order:
 *
 * 1. Managed memory (eg. /etc/claude-code/CLAUDE.md) - Global instructions for all users
 * 2. User memory (~/.claude/CLAUDE.md) - Private global instructions for all projects
 * 3. Project memory (CLAUDE.md, .claude/CLAUDE.md, and .claude/rules/*.md in project roots) - Instructions checked into the codebase
 * 4. Local memory (CLAUDE.local.md in project roots) - Private project-specific instructions
 *
 * Files are loaded in reverse order of priority, i.e. the latest files are highest priority
 * with the model paying more attention to them.
 *
 * File discovery:
 * - User memory is loaded from the user's home directory
 * - Project and Local files are discovered by traversing from the current directory up to root
 * - Files closer to the current directory have higher priority (loaded later)
 * - CLAUDE.md, .claude/CLAUDE.md, and all .md files in .claude/rules/ are checked in each directory for Project memory
 *
 * Memory @include directive:
 * - Memory files can include other files using @ notation
 * - Syntax: @path, @./relative/path, @~/home/path, or @/absolute/path
 * - @path (without prefix) is treated as a relative path (same as @./path)
 * - Works in leaf text nodes only (not inside code blocks or code strings)
 * - Included files are added as separate entries before the including file
 * - Circular references are prevented by tracking processed files
 * - Non-existent files are silently ignored
 */

import { feature } from 'bun:bundle'
import ignore from 'ignore'
import {
  Lexer,
  Tokenizer,
  type Token,
  type Tokens,
  type TokensList,
} from 'marked'
import { isDisklessActive } from './disklessGuards.js'
import { filterCompilableIgnorePatterns } from './ignorePatterns.js'
import { settingsHaveBlockReadsOutsideWorkingDirectories } from './permissions/outsideReads.js'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
} from 'path'
import picomatch from 'picomatch'
import { logEvent } from 'src/services/analytics/index.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  getOriginalCwd,
} from '../bootstrap/state.js'
import { truncateEntrypointContent } from '../memdir/memdir.js'
import {
  getAutoMemEntrypoint,
  isAutoMemoryEnabled,
  isAutoMemoryHeldByOutsideReadBlock,
} from '../memdir/paths.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getCurrentProjectConfig,
  getManagedClaudeRulesDir,
  getMemoryPath,
  getUserClaudeRulesDir,
} from './config.js'
import { randomUUID } from 'crypto'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { getErrnoCode } from './errors.js'
import { normalizePathForComparison } from './file.js'
import { cacheKeys, type FileStateCache } from './fileStateCache.js'
import {
  parseFrontmatter,
  splitPathInFrontmatter,
} from './frontmatterParser.js'
import {
  getFsImplementation,
  isAutomountMapRoot,
  safeResolvePath,
  walkPermissionPaths,
} from './fsOperations.js'
import { findCanonicalGitRoot, findGitRoot } from './git.js'
import {
  executeInstructionsLoadedHooks,
  hasInstructionsLoadedHook,
  type InstructionsLoadReason,
  type InstructionsMemoryType,
} from './hooks.js'
import { RootSessionSlot } from './hostSlot.js'
import type { MemoryType } from './memory/types.js'
import { expandPath, isUnsafeNetworkOrNtIncludePath } from './path.js'
import {
  matchingRuleForInput,
  pathInOutsideReadFenceWorkingPath,
  pathInWorkingPath,
  workingDirPathsForPermission,
} from './permissions/filesystem.js'
import { getBootstrapSession, runWithSession } from './sessionRoot.js'
import {
  getEnabledSettingSources,
  isSettingSourceEnabled,
} from './settings/constants.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from './settings/settings.js'
import { isSafeGlobPattern } from './settings/validation.js'
import type { ToolPermissionContext } from '../Tool.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemPaths = feature('TEAMMEM')
  ? (require('../memdir/teamMemPaths.js') as typeof import('../memdir/teamMemPaths.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

type SessionMemoized<Args extends unknown[], Result> = ((
  ...args: Args
) => Result) & {
  cache: Map<unknown, Result>
}

function memoizePerRootSession<Args extends unknown[], Result, Key = Args[0]>(
  fn: (...args: Args) => Result,
  resolver?: (...args: Args) => Key,
): SessionMemoized<Args, Result> {
  const slot = new RootSessionSlot(() => new Map<unknown, Result>())
  const memoized = (...args: Args): Result => {
    const key = resolver ? resolver(...args) : args[0]
    const cache = slot.of(getBootstrapSession())
    if (cache.has(key)) {
      return cache.get(key) as Result
    }
    const result = fn(...args)
    cache.set(key, result)
    return result
  }
  Object.defineProperty(memoized, 'cache', {
    get: () => slot.of(getBootstrapSession()),
    set: (next: Map<unknown, Result>) => {
      const current = slot.of(getBootstrapSession())
      if (current === next) return
      current.clear()
      for (const [k, v] of next.entries()) {
        current.set(k, v)
      }
    },
    configurable: true,
    enumerable: true,
  })
  return memoized as unknown as SessionMemoized<Args, Result>
}

type ClaudeMdPermissionContextSourceEntry = {
  getter: () => ToolPermissionContext | undefined
}

type ClaudeMdSessionState = {
  hasLoggedInitialLoad: boolean
  nextEagerLoadReason: InstructionsLoadReason
  shouldFireHook: boolean
  claudeMdPermissionContext: ToolPermissionContext | undefined
  getLiveClaudeMdPermissionContext:
    | (() => ToolPermissionContext | undefined)
    | undefined
  liveClaudeMdPermissionContextStack: ClaudeMdPermissionContextSourceEntry[]
  withheldMemoryState: {
    owed: Map<string, WithheldMemoryEntry>
    logged: Set<string>
    token: string
    seen: Set<string>
  }
}

const claudeMdSessionSlot = new RootSessionSlot<ClaudeMdSessionState>(() => ({
  hasLoggedInitialLoad: false,
  nextEagerLoadReason: 'session_start',
  shouldFireHook: true,
  claudeMdPermissionContext: undefined,
  getLiveClaudeMdPermissionContext: undefined,
  liveClaudeMdPermissionContextStack: [],
  withheldMemoryState: {
    owed: new Map(),
    logged: new Set(),
    token: randomUUID(),
    seen: new Set(),
  },
}))

function getClaudeMdSessionState(): ClaudeMdSessionState {
  return claudeMdSessionSlot.of(getBootstrapSession())
}

const MEMORY_INSTRUCTION_PROMPT =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.'
// Recommended max character count for a memory file
export const MAX_MEMORY_CHARACTER_COUNT = 40000

// File extensions that are allowed for @include directives
// This prevents binary files (images, PDFs, etc.) from being loaded into memory
const TEXT_FILE_EXTENSIONS = new Set([
  // Markdown and text
  '.md',
  '.txt',
  '.text',
  // Data formats
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  // Web
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  // JavaScript/TypeScript
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  // Python
  '.py',
  '.pyi',
  '.pyw',
  // Ruby
  '.rb',
  '.erb',
  '.rake',
  // Go
  '.go',
  // Rust
  '.rs',
  // Java/Kotlin/Scala
  '.java',
  '.kt',
  '.kts',
  '.scala',
  // C/C++
  '.c',
  '.cpp',
  '.cc',
  '.cxx',
  '.h',
  '.hpp',
  '.hxx',
  // C#
  '.cs',
  // Swift
  '.swift',
  // Shell
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  // Config
  '.env',
  '.ini',
  '.cfg',
  '.conf',
  '.config',
  '.properties',
  // Database
  '.sql',
  '.graphql',
  '.gql',
  // Protocol
  '.proto',
  // Frontend frameworks
  '.vue',
  '.svelte',
  '.astro',
  // Templating
  '.ejs',
  '.hbs',
  '.pug',
  '.jade',
  // Other languages
  '.php',
  '.pl',
  '.pm',
  '.lua',
  '.r',
  '.R',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.clj',
  '.cljs',
  '.cljc',
  '.edn',
  '.hs',
  '.lhs',
  '.elm',
  '.ml',
  '.mli',
  '.f',
  '.f90',
  '.f95',
  '.for',
  // Build files
  '.cmake',
  '.make',
  '.makefile',
  '.gradle',
  '.sbt',
  // Documentation
  '.rst',
  '.adoc',
  '.asciidoc',
  '.org',
  '.tex',
  '.latex',
  // Lock files (often text-based)
  '.lock',
  // Misc
  '.log',
  '.diff',
  '.patch',
])

export type MemoryFileInfo = {
  path: string
  type: MemoryType
  content: string
  parent?: string // Path of the file that included this one
  globs?: string[] // Glob patterns for file paths this rule applies to
  // True when auto-injection transformed `content` (stripped HTML comments,
  // stripped frontmatter, truncated MEMORY.md) such that it no longer matches
  // the bytes on disk. When set, `rawContent` holds the unmodified disk bytes
  // so callers can cache a `isPartialView` readFileState entry — presence in
  // cache provides dedup + change detection, but Edit/Write still require an
  // explicit Read before proceeding.
  contentDiffersFromDisk?: boolean
  rawContent?: string
}

function pathInOriginalCwd(path: string): boolean {
  return pathInWorkingPath(path, getOriginalCwd())
}

/**
 * Parses raw content to extract both content and glob patterns from frontmatter
 * @param rawContent Raw file content with frontmatter
 * @returns Object with content and globs (undefined if no paths or match-all pattern)
 */
function parseFrontmatterPaths(rawContent: string): {
  content: string
  paths?: string[]
} {
  const { frontmatter, content } = parseFrontmatter(rawContent)

  if (!frontmatter.paths) {
    return { content }
  }

  const patterns = splitPathInFrontmatter(frontmatter.paths)
    .map(pattern => {
      // Remove /** suffix - ignore library treats 'path' as matching both
      // the path itself and everything inside it
      return pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern
    })
    .filter((p: string) => p.length > 0)

  // If all patterns are ** (match-all), treat as no globs (undefined)
  // This means the file applies to all paths
  if (patterns.length === 0 || patterns.every((p: string) => p === '**')) {
    return { content }
  }

  return { content, paths: patterns }
}

/**
 * Strip block-level HTML comments (<!-- ... -->) from markdown content.
 *
 * Uses the marked lexer to identify comments at the block level only, so
 * comments inside inline code spans and fenced code blocks are preserved.
 * Inline HTML comments inside a paragraph are also left intact; the intended
 * use case is authorial notes that occupy their own lines.
 *
 * Unclosed comments (`<!--` with no matching `-->`) are left in place so a
 * typo doesn't silently swallow the rest of the file.
 */
const SETEXT_UNDERLINE_LINE_RE = /^ {0,3}(?:=+|-+) *$/
const SETEXT_UNDERLINE_ANY_RE = /^ {0,3}(?:=+|-+) *$/m
const SETEXT_PARAGRAPH_STOP_RE =
  /^(?:\s*$|(?:[*+-]|\d{1,9}[.)]) |(?: {4}| {0,3}\t)| {0,3}(?:`{3,}|~{3,})| {0,3}>| {0,3}#{1,6}| {0,3}<[^\n>]+>$|.*[\u2028\u2029])/

class MemoryMarkdownTokenizer extends Tokenizer {
  lexed: Array<{ text: string; inReach: Set<number> }> = []

  override lheading(src: string): Tokens.Heading | undefined {
    const current = this.lexed.at(-1)
    if (
      current !== undefined &&
      !current.inReach.has(src.length) &&
      (current.text.at(-src.length - 1) ?? '\n') === '\n'
    ) {
      return undefined
    }
    return super.lheading(src)
  }
}

class MemoryMarkdownLexer extends Lexer {
  #tokenizer: MemoryMarkdownTokenizer

  constructor() {
    const tokenizer = new MemoryMarkdownTokenizer()
    super({ gfm: false, tokenizer })
    this.#tokenizer = tokenizer
  }

  override blockTokens(
    src: string,
    tokens: Token[] = [],
    top = false,
  ): TokensList {
    const inReach = new Set<number>()
    let lineEnd = SETEXT_UNDERLINE_ANY_RE.test(src) ? src.length : -1
    let reachable = false
    while (lineEnd >= 0) {
      const lineStart =
        lineEnd === 0 ? 0 : src.lastIndexOf('\n', lineEnd - 1) + 1
      const line = src.slice(lineStart, lineEnd)
      if (reachable) {
        inReach.add(src.length - lineStart)
      }
      reachable =
        SETEXT_UNDERLINE_LINE_RE.test(line) ||
        (reachable && !SETEXT_PARAGRAPH_STOP_RE.test(line))
      lineEnd = lineStart - 1
    }
    this.#tokenizer.lexed.push({ text: src, inReach })
    try {
      return super.blockTokens(src, tokens as TokensList, top) as TokensList
    } finally {
      this.#tokenizer.lexed.pop()
    }
  }
}

export function lexMemoryMarkdown(content: string): ReturnType<Lexer['lex']> {
  return new MemoryMarkdownLexer().lex(content)
}

export function stripHtmlComments(content: string): {
  content: string
  stripped: boolean
} {
  if (!content.includes('<!--')) {
    return { content, stripped: false }
  }
  // gfm:false is fine here — html-block detection is a CommonMark rule.
  return stripHtmlCommentsFromTokens(lexMemoryMarkdown(content))
}

function stripHtmlCommentsFromTokens(tokens: ReturnType<Lexer['lex']>): {
  content: string
  stripped: boolean
} {
  let result = ''
  let stripped = false

  // A well-formed HTML comment span. Non-greedy so multiple comments on the
  // same line are matched independently; [\s\S] to span newlines.
  const commentSpan = /<!--[\s\S]*?-->/g

  for (const token of tokens) {
    if (token.type === 'html') {
      const trimmed = token.raw.trimStart()
      if (trimmed.startsWith('<!--') && trimmed.includes('-->')) {
        // Per CommonMark, a type-2 HTML block ends at the *line* containing
        // `-->`, so text after `-->` on that line is part of this token.
        // Strip only the comment spans and keep any residual content.
        const residue = token.raw.replace(commentSpan, '')
        stripped = true
        if (residue.trim().length > 0) {
          // Residual content exists (e.g. `<!-- note --> Use bun`): keep it.
          result += residue
        }
        continue
      }
    }
    result += token.raw
  }

  return { content: result, stripped }
}

/**
 * Parses raw memory file content into a MemoryFileInfo. Pure function — no I/O.
 *
 * When includeBasePath is given, @include paths are resolved in the same lex
 * pass and returned alongside the parsed file (so processMemoryFile doesn't
 * need to lex the same content a second time).
 */
function parseMemoryFileContent(
  rawContent: string,
  filePath: string,
  type: MemoryType,
  includeBasePath?: string,
): { info: MemoryFileInfo | null; includePaths: string[] } {
  // Skip non-text files to prevent loading binary data (images, PDFs, etc.) into memory
  const ext = extname(filePath).toLowerCase()
  if (ext && !TEXT_FILE_EXTENSIONS.has(ext)) {
    logForDebugging(`Skipping non-text file in @include: ${filePath}`)
    return { info: null, includePaths: [] }
  }

  const { content: withoutFrontmatter, paths } =
    parseFrontmatterPaths(rawContent)

  // Lex once so strip and @include-extract share the same tokens. gfm:false
  // is required by extract (so ~/path doesn't tokenize as strikethrough) and
  // doesn't affect strip (html blocks are a CommonMark rule).
  const hasComment = withoutFrontmatter.includes('<!--')
  const tokens =
    hasComment || includeBasePath !== undefined
      ? lexMemoryMarkdown(withoutFrontmatter)
      : undefined

  // Only rebuild via tokens when a comment actually needs stripping —
  // marked normalises \r\n during lex, so round-tripping a CRLF file
  // through token.raw would spuriously flip contentDiffersFromDisk.
  const strippedContent =
    hasComment && tokens
      ? stripHtmlCommentsFromTokens(tokens).content
      : withoutFrontmatter

  const includePaths =
    tokens && includeBasePath !== undefined
      ? extractIncludePathsFromTokens(tokens, includeBasePath)
      : []

  // Truncate MEMORY.md entrypoints to the line AND byte caps
  let finalContent = strippedContent
  if (type === 'AutoMem' || type === 'TeamMem') {
    finalContent = truncateEntrypointContent(strippedContent).content
  }

  // Covers frontmatter strip, HTML comment strip, and MEMORY.md truncation
  const contentDiffersFromDisk = finalContent !== rawContent
  return {
    info: {
      path: filePath,
      type,
      content: finalContent,
      globs: paths,
      contentDiffersFromDisk,
      rawContent: contentDiffersFromDisk ? rawContent : undefined,
    },
    includePaths,
  }
}

function handleMemoryFileReadError(error: unknown, filePath: string): void {
  const code = getErrnoCode(error)
  // ENOENT = file doesn't exist, EISDIR = is a directory — both expected
  if (code === 'ENOENT' || code === 'EISDIR') {
    return
  }
  // Log permission errors (EACCES) as they're actionable
  if (code === 'EACCES') {
    // Don't log the full file path to avoid PII/security issues
    logEvent('tengu_claude_md_permission_error', {
      is_access_error: 1,
      has_home_dir: filePath.includes(getClaudeConfigHomeDir()) ? 1 : 0,
    })
  }
}

/** Official 2.1.328 `X3t = 4194304` (4 MiB) max byte limit for memory file reads. */
const MAX_MEMORY_FILE_BYTES = 4 * 1024 * 1024

/**
 * Official 2.1.328 (`H` / `held` permission-controlled reader passed to `are` /
 * `$ht` / `QHe` / `lzo`): returns the UTF-8 text of `filePath` if permitted by
 * `Read(...)` deny rules and outside-read bounds, or `undefined` if withheld/missing.
 */
export type MemoryFilePermissionReader = (
  filePath: string,
  maxBytes: number,
) => Promise<string | undefined>

/**
 * Official 2.1.328 (`Wut`): register the session's launch ToolPermissionContext
 * (`judgedBy`) so recursive CLAUDE.md / @include / rules loading checks Read
 * deny rules. Official `uZr` resolves readers from the live engineStore context
 * first and only falls back to `judgedBy`, which is what
 * `registerClaudeMdPermissionContextSource` supplies.
 */
export function setClaudeMdPermissionContext(
  context: ToolPermissionContext | undefined,
): void {
  const state = getClaudeMdSessionState()
  if (state.claudeMdPermissionContext !== context) {
    state.claudeMdPermissionContext = context
    clearMemoryFileCaches()
  }
}

/**
 * Official 2.1.328 (`uZr` → `e.engineStore.current?.getState().toolPermissionContext`):
 * register a getter that returns the session's *current* ToolPermissionContext
 * so permission changes made mid-session (e.g. /permissions, settings sync)
 * apply to subsequent memory loads. Returns an unregister callback that restores
 * the previous source on unmount so ephemeral providers cannot clobber the live
 * session's permission context.
 */
export function registerClaudeMdPermissionContextSource(
  getter: (() => ToolPermissionContext | undefined) | undefined,
): () => void {
  const ownerSession = getBootstrapSession()
  const ownerRoot = ownerSession.root ?? ownerSession
  const state = claudeMdSessionSlot.of(ownerRoot)
  if (getter === undefined) {
    state.liveClaudeMdPermissionContextStack.length = 0
    if (state.getLiveClaudeMdPermissionContext !== undefined) {
      state.getLiveClaudeMdPermissionContext = undefined
      clearMemoryFileCaches()
    }
    return () => {}
  }
  const entry: ClaudeMdPermissionContextSourceEntry = { getter }
  state.liveClaudeMdPermissionContextStack.push(entry)
  if (state.getLiveClaudeMdPermissionContext !== getter) {
    state.getLiveClaudeMdPermissionContext = getter
    clearMemoryFileCaches()
  }
  let active = true
  return () => {
    if (!active) return
    active = false
    const idx = state.liveClaudeMdPermissionContextStack.lastIndexOf(entry)
    if (idx !== -1) {
      state.liveClaudeMdPermissionContextStack.splice(idx, 1)
    }
    const next =
      state.liveClaudeMdPermissionContextStack[
        state.liveClaudeMdPermissionContextStack.length - 1
      ]?.getter
    if (state.getLiveClaudeMdPermissionContext !== next) {
      state.getLiveClaudeMdPermissionContext = next
      runWithSession(ownerRoot, () => {
        getMemoryFiles.cache?.clear?.()
      })
    }
  }
}

function hasWholeToolReadDenyRule(context: ToolPermissionContext): boolean {
  for (const rules of Object.values(context.alwaysDenyRules)) {
    if (rules?.some(r => r === 'Read' || r === 'Read(*)')) {
      return true
    }
  }
  return false
}

function hasAnyReadDenyRule(context: ToolPermissionContext): boolean {
  for (const rules of Object.values(context.alwaysDenyRules)) {
    if (rules?.some(r => r === 'Read' || r.startsWith('Read('))) {
      return true
    }
  }
  return false
}

function buildSettingsPermissionContextForMemory():
  | ToolPermissionContext
  | undefined {
  const alwaysDenyRules: ToolPermissionContext['alwaysDenyRules'] = {}
  let hasReadDeny = false
  for (const source of getEnabledSettingSources()) {
    const deny = getSettingsForSource(source)?.permissions?.deny
    if (deny && deny.length > 0) {
      alwaysDenyRules[source] = deny
      if (deny.some(r => r === 'Read' || r.startsWith('Read('))) {
        hasReadDeny = true
      }
    }
  }
  const blockOutside = settingsHaveBlockReadsOutsideWorkingDirectories()
  if (!hasReadDeny && !blockOutside) {
    return undefined
  }
  const additionalWorkingDirectories = new Map<
    string,
    { path: string; source: 'cliArg' }
  >()
  for (const dir of getAdditionalDirectoriesForClaudeMd()) {
    additionalWorkingDirectories.set(dir, { path: dir, source: 'cliArg' })
  }
  return {
    mode: 'default',
    additionalWorkingDirectories,
    alwaysAllowRules: {},
    alwaysDenyRules,
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    blockReadsOutsideWorkingDirectories: blockOutside,
  }
}

function readEngineStorePermissionContext(): ToolPermissionContext | undefined {
  const store = getBootstrapSession().engineStore.current
  if (
    typeof store !== 'object' ||
    store === null ||
    !('getState' in store) ||
    typeof (store as { getState?: unknown }).getState !== 'function'
  ) {
    return undefined
  }
  const state = (
    store as { getState: () => { toolPermissionContext?: unknown } | undefined }
  ).getState()
  const ctx = state?.toolPermissionContext
  if (
    typeof ctx !== 'object' ||
    ctx === null ||
    !('alwaysDenyRules' in ctx) ||
    !('mode' in ctx)
  ) {
    return undefined
  }
  return ctx as ToolPermissionContext
}

function resolveEffectiveMemoryPermissionContext():
  | ToolPermissionContext
  | undefined {
  // Official `uZr`: live engineStore context → `judgedBy` (launch context
  // registered via Wut) → default. The settings-source builder is our
  // `md()`-style default for entrypoints that never register a session
  // context (print mode before store creation, standalone loaders).
  const state = getClaudeMdSessionState()
  const ctx =
    state.getLiveClaudeMdPermissionContext?.() ??
    readEngineStorePermissionContext() ??
    state.claudeMdPermissionContext ??
    buildSettingsPermissionContextForMemory()
  if (!ctx) return undefined
  if (
    !hasAnyReadDenyRule(ctx) &&
    ctx.restricted !== true &&
    ctx.blockReadsOutsideWorkingDirectories !== true
  ) {
    return undefined
  }
  return ctx
}

/**
 * Official 2.1.328 `zt` (chunk@293381675.js @45000): direct memory paths under
 * an ancestor directory that `above(dir)` exempts from the outside-read block.
 * Symlink targets and recursive `@include` files outside these direct paths
 * remain subject to `enforceOutsideBlock`.
 */
const ANCESTOR_EXEMPT_MEMORY_PATHS: readonly (readonly string[])[] = [
  ['CLAUDE.md'],
  ['CLAUDE.local.md'],
  ['AGENTS.md'],
  ['.claude', 'CLAUDE.md'],
  ['.claude', 'AGENTS.md'],
  ['.claude', 'rules'],
]

/** Official 2.1.328 `Te` — check whether candidatePath falls under any exempt direct path of an ancestor dir. */
function isPathUnderAncestorMemoryExempt(
  candidatePath: string,
  ancestorDirVariants: readonly string[],
  exemptRelativePaths: readonly (readonly string[])[] = ANCESTOR_EXEMPT_MEMORY_PATHS,
): boolean {
  return ancestorDirVariants.some(dirVariant =>
    exemptRelativePaths.some(parts =>
      pathInWorkingPath(candidatePath, join(dirVariant, ...parts), {
        caseFold: false,
        uncShapeParity: true,
      }),
    ),
  )
}

function isHeldOutsideForContext(
  candidatePath: string,
  context: ToolPermissionContext,
): boolean {
  if (
    context.blockReadsOutsideWorkingDirectories !== true &&
    context.restricted !== true
  ) {
    return false
  }
  return !pathInOutsideReadFenceWorkingPath(candidatePath, context, [
    candidatePath,
  ])
}

/**
 * Official 2.1.328 (`Awl` / `we` / `ne` / `Re` / `Jt`): creates a
 * permission-controlled reader that walks symlink hops via `walkPermissionPaths`,
 * rejects unresolved symlinks, refuses any path covered by a `Read(...)` deny
 * rule, refuses paths outside the outside-read fence working directories (except
 * when `exemptAncestorDir` exempts that ancestor's own direct memory paths),
 * and checks `stat()` (`isFile() && size <= maxBytes`) BEFORE calling `readFile`.
 */
export function createMemoryPermissionReader(
  context: ToolPermissionContext,
  opts?: {
    enforceOutsideBlock?: boolean
    exemptAncestorDir?: string
    exemptRelativePaths?: readonly (readonly string[])[]
    onWithheld?: (filePath: string, why: WithheldMemoryWhy) => void
  },
): MemoryFilePermissionReader {
  const enforceOutsideBlock = opts?.enforceOutsideBlock ?? true
  const ancestorDirVariants =
    opts?.exemptAncestorDir !== undefined
      ? workingDirPathsForPermission(opts.exemptAncestorDir)
      : undefined
  const exemptRelativePaths =
    opts?.exemptRelativePaths ?? ANCESTOR_EXEMPT_MEMORY_PATHS
  const noteWithheldIfNonDirExists = async (
    filePath: string,
    why: WithheldMemoryWhy,
  ): Promise<void> => {
    try {
      const fs = getFsImplementation()
      const st = fs.lstatSync(filePath)
      if (st.isDirectory()) return
    } catch {
      return
    }
    recordWithheldMemoryPaths([{ path: filePath, why }])
    opts?.onWithheld?.(filePath, why)
  }

  return async (
    filePath: string,
    maxBytes: number,
  ): Promise<string | undefined> => {
    if (hasWholeToolReadDenyRule(context)) {
      await noteWithheldIfNonDirExists(filePath, 'denied')
      return undefined
    }

    const walked = walkPermissionPaths(filePath)
    if (walked.unresolved) {
      await noteWithheldIfNonDirExists(filePath, 'unsettled')
      return undefined
    }

    for (const candidatePath of walked.paths) {
      if (
        matchingRuleForInput(candidatePath, context, 'read', 'deny') !== null
      ) {
        await noteWithheldIfNonDirExists(filePath, 'denied')
        return undefined
      }
    }

    // Official `we` + `Jt`: every path along the symlink walk must satisfy the
    // outside-read fence unless exempted as a direct memory path of
    // `exemptAncestorDir`. Symlink targets and recursive `@include` files that
    // land outside both the working dirs and `exemptAncestorDir`'s direct memory
    // paths are refused (`why: 'outside'`).
    if (
      enforceOutsideBlock &&
      walked.paths.some(
        candidatePath =>
          isHeldOutsideForContext(candidatePath, context) &&
          !(
            ancestorDirVariants !== undefined &&
            isPathUnderAncestorMemoryExempt(
              candidatePath,
              ancestorDirVariants,
              exemptRelativePaths,
            )
          ),
      )
    ) {
      await noteWithheldIfNonDirExists(filePath, 'outside')
      return undefined
    }

    try {
      const fs = getFsImplementation()
      // Official `Re`: stat before readFile so huge files/FIFOs cannot OOM or hang.
      const stats = await fs.stat(filePath)
      if (!stats.isFile() || stats.size > maxBytes) {
        return undefined
      }
      const rawContent = await fs.readFile(filePath, { encoding: 'utf-8' })
      if (Buffer.byteLength(rawContent, 'utf-8') > maxBytes) {
        return undefined
      }
      return rawContent
    } catch (error) {
      handleMemoryFileReadError(error, filePath)
      return undefined
    }
  }
}

function getDefaultPermissionReaderForMemoryType(
  type: MemoryType,
  opts?: {
    enforceOutsideBlock?: boolean
    exemptAncestorDir?: string
  },
): MemoryFilePermissionReader | undefined {
  if (type === 'User' || type === 'Managed') {
    return undefined
  }
  const ctx = resolveEffectiveMemoryPermissionContext()
  if (!ctx) return undefined
  return createMemoryPermissionReader(ctx, opts)
}

/**
 * Used by processMemoryFile → getMemoryFiles so the event loop stays
 * responsive during the directory walk (many readFile attempts, most
 * ENOENT). When includeBasePath is given, @include paths are resolved in
 * the same lex pass and returned alongside the parsed file.
 * Official 2.1.328 (`$ht`): when `permissionReader` (`held`) is provided,
 * reads through it so Read deny rules and outside-read checks apply uniformly;
 * otherwise still stats before readFile to prevent OOM on huge files/FIFOs.
 */
async function safelyReadMemoryFileAsync(
  filePath: string,
  type: MemoryType,
  includeBasePath?: string,
  permissionReader?: MemoryFilePermissionReader,
): Promise<{ info: MemoryFileInfo | null; includePaths: string[] }> {
  if (isDisklessActive()) {
    return { info: null, includePaths: [] }
  }
  try {
    if (permissionReader) {
      const rawContent = await permissionReader(filePath, MAX_MEMORY_FILE_BYTES)
      if (rawContent === undefined) {
        return { info: null, includePaths: [] }
      }
      return parseMemoryFileContent(rawContent, filePath, type, includeBasePath)
    }
    const fs = getFsImplementation()
    const stats = await fs.stat(filePath)
    if (!stats.isFile() || stats.size > MAX_MEMORY_FILE_BYTES) {
      return { info: null, includePaths: [] }
    }
    const rawContent = await fs.readFile(filePath, { encoding: 'utf-8' })
    if (Buffer.byteLength(rawContent, 'utf-8') > MAX_MEMORY_FILE_BYTES) {
      return { info: null, includePaths: [] }
    }
    return parseMemoryFileContent(rawContent, filePath, type, includeBasePath)
  } catch (error) {
    handleMemoryFileReadError(error, filePath)
    return { info: null, includePaths: [] }
  }
}

type MarkdownToken = {
  type: string
  text?: string
  href?: string
  tokens?: MarkdownToken[]
  raw?: string
  items?: MarkdownToken[]
}

// Extract @path include references from pre-lexed tokens and resolve to
// absolute paths. Skips html tokens so @paths inside block comments are
// ignored — the caller may pass pre-strip tokens.
function extractIncludePathsFromTokens(
  tokens: ReturnType<Lexer['lex']>,
  basePath: string,
): string[] {
  const absolutePaths = new Set<string>()

  // Extract @paths from a text string and add resolved paths to absolutePaths.
  function extractPathsFromText(textContent: string) {
    const includeRegex = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g
    let match
    while ((match = includeRegex.exec(textContent)) !== null) {
      let path = match[1]
      if (!path) continue

      // Strip fragment identifiers (#heading, #section-name, etc.)
      const hashIndex = path.indexOf('#')
      if (hashIndex !== -1) {
        path = path.substring(0, hashIndex)
      }
      if (!path) continue

      // Unescape the spaces in the path
      path = path.replace(/\\ /g, ' ')

      // Accept @path, @./path, @~/path, or @/path
      if (path) {
        const isValidPath =
          path.startsWith('./') ||
          path.startsWith('~/') ||
          (path.startsWith('/') && path !== '/') ||
          (!path.startsWith('@') &&
            !path.match(/^[#%^&*()]+/) &&
            path.match(/^[a-zA-Z0-9._-]/))

        if (isValidPath) {
          const resolvedPath = expandPath(path, dirname(basePath))
          absolutePaths.add(resolvedPath)
        }
      }
    }
  }

  // Recursively process elements to find text nodes
  function processElements(elements: MarkdownToken[]) {
    for (const element of elements) {
      if (element.type === 'code' || element.type === 'codespan') {
        continue
      }

      // For html tokens that contain comments, strip the comment spans and
      // check the residual for @paths (e.g. `<!-- note --> @./file.md`).
      // Other html tokens (non-comment tags) are skipped entirely.
      if (element.type === 'html') {
        const raw = element.raw || ''
        const trimmed = raw.trimStart()
        if (trimmed.startsWith('<!--') && trimmed.includes('-->')) {
          const commentSpan = /<!--[\s\S]*?-->/g
          const residue = raw.replace(commentSpan, '')
          if (residue.trim().length > 0) {
            extractPathsFromText(residue)
          }
        }
        continue
      }

      // Process text nodes
      if (element.type === 'text') {
        extractPathsFromText(element.text || '')
      }

      // Recurse into children tokens
      if (element.tokens) {
        processElements(element.tokens)
      }

      // Special handling for list structures
      if (element.items) {
        processElements(element.items)
      }
    }
  }

  processElements(tokens as MarkdownToken[])
  return [...absolutePaths]
}

const MAX_INCLUDE_DEPTH = 5

/**
 * Checks whether a CLAUDE.md file path is excluded by the claudeMdExcludes setting.
 * Only applies to User, Project, and Local memory types.
 * Managed, AutoMem, and TeamMem types are never excluded.
 *
 * Matches both the original path and the realpath-resolved path to handle symlinks
 * (e.g., /tmp -> /private/tmp on macOS).
 */
function normalizeWindowsDriveLetter(p: string): string {
  if (/^[A-Za-z]:\//.test(p)) {
    return p[0]!.toLowerCase() + p.slice(1)
  }
  return p
}

function isClaudeMdExcluded(filePath: string, type: MemoryType): boolean {
  if (type !== 'User' && type !== 'Project' && type !== 'Local') {
    return false
  }

  const patterns = getInitialSettings().claudeMdExcludes
  if (!patterns || patterns.length === 0) {
    return false
  }

  const matchOpts = { dot: true }
  const normalizedPath = normalizeWindowsDriveLetter(
    filePath.replaceAll('\\', '/'),
  )

  // Build an expanded pattern list that includes realpath-resolved versions of
  // absolute patterns. This handles symlinks like /tmp -> /private/tmp on macOS:
  // the user writes "/tmp/project/CLAUDE.md" in their exclude, but the system
  // resolves the CWD to "/private/tmp/project/...", so the file path uses the
  // real path. By resolving the patterns too, both sides match.
  // Official 2.1.326 (#122): guard against malformed/catastrophic globs so
  // picomatch never hangs or throws on a single bad pattern.
  const expandedPatterns = resolveExcludePatterns(patterns)
    .map(normalizeWindowsDriveLetter)
    .filter(p => {
      if (p.length === 0) return false
      const check = isSafeGlobPattern(p)
      if (!check.safe) {
        logForDebugging(
          `Ignoring unsafe claudeMdExcludes glob pattern "${p.slice(0, 120)}": ${check.reason}`,
          { level: 'warn' },
        )
        return false
      }
      return true
    })
  if (expandedPatterns.length === 0) {
    return false
  }

  for (const pat of expandedPatterns) {
    try {
      if (picomatch.isMatch(normalizedPath, pat, matchOpts)) {
        return true
      }
    } catch (err) {
      logForDebugging(
        `Ignoring invalid claudeMdExcludes glob pattern "${pat.slice(0, 120)}": ${err instanceof Error ? err.message : String(err)}`,
        { level: 'warn' },
      )
    }
  }
  return false
}

/** official T3 — symlink whose target could not be canonicalized (broken/loop/unresolvable). */
function isUnresolvedSymlink(resolved: {
  isSymlink: boolean
  isCanonical: boolean
}): boolean {
  return resolved.isSymlink && !resolved.isCanonical
}

/**
 * Expands exclude patterns by resolving symlinks in absolute path prefixes.
 * For each absolute pattern (starting with /), tries to resolve the longest
 * existing directory prefix via realpathSync and adds the resolved version.
 * Glob patterns (containing *) have their static prefix resolved.
 */
function resolveExcludePatterns(patterns: string[]): string[] {
  const fs = getFsImplementation()
  const expanded: string[] = patterns.map(p => p.replaceAll('\\', '/'))

  for (const normalized of expanded) {
    // Only resolve absolute patterns — glob-only patterns like "**/*.md" don't have
    // a filesystem prefix to resolve
    if (!normalized.startsWith('/')) {
      continue
    }

    // Find the static prefix before any glob characters
    const globStart = normalized.search(/[*?{[]/)
    const staticPrefix =
      globStart === -1 ? normalized : normalized.slice(0, globStart)
    const dirToResolve = dirname(staticPrefix)

    try {
      const resolved = safeResolvePath(fs, dirToResolve)
      if (
        isUnsafeNetworkOrNtIncludePath(resolved.resolvedPath) ||
        isUnresolvedSymlink(resolved)
      ) {
        continue
      }
      const resolvedDir = resolved.resolvedPath.replaceAll('\\', '/')
      if (resolvedDir !== dirToResolve) {
        const resolvedPattern =
          resolvedDir + normalized.slice(dirToResolve.length)
        expanded.push(resolvedPattern)
      }
    } catch {
      // Directory doesn't exist; skip resolution for this pattern
    }
  }

  return expanded
}

/**
 * Recursively processes a memory file and all its @include references
 * Returns an array of MemoryFileInfo objects with includes first, then main file
 */
export async function processMemoryFile(
  filePath: string,
  type: MemoryType,
  processedPaths: Set<string>,
  includeExternal: boolean,
  depth: number = 0,
  parent?: string,
  permissionReader?: MemoryFilePermissionReader,
): Promise<MemoryFileInfo[]> {
  // Skip if already processed or max depth exceeded.
  // Normalize paths for comparison to handle Windows drive letter casing
  // differences (e.g., C:\Users vs c:\Users).
  const normalizedPath = normalizePathForComparison(filePath)
  if (processedPaths.has(normalizedPath) || depth >= MAX_INCLUDE_DEPTH) {
    return []
  }

  // Skip if path is excluded by claudeMdExcludes setting
  if (isClaudeMdExcluded(filePath, type)) {
    return []
  }

  // densable sTe/include_guard: su(e)&&!db(e)||bu(e)||Jw(e) → skip (bu stub false).
  // WSL UNC must remain allowed — do NOT OR workflow s7t's su||Jw.
  if (isUnsafeNetworkOrNtIncludePath(filePath)) {
    return []
  }

  // Resolve symlink path early for @import resolution
  const resolved = safeResolvePath(getFsImplementation(), filePath)
  const { resolvedPath, isSymlink } = resolved

  if (
    isUnsafeNetworkOrNtIncludePath(resolvedPath) ||
    isUnresolvedSymlink(resolved)
  ) {
    if (isUnresolvedSymlink(resolved)) {
      recordWithheldMemoryPaths([{ path: filePath, why: 'unsettled' }])
    }
    return []
  }

  // official #23 (HMr/outsideReads): when blockReadsOutsideWorkingDirectories is
  // enabled, refuse symlinked Project/Local/ExperimentalUltraClaudeMd memory files
  // whose resolved target lies outside the working directories.
  if (
    type !== 'User' &&
    type !== 'Managed' &&
    isSymlink &&
    !pathInOriginalCwd(resolvedPath) &&
    settingsHaveBlockReadsOutsideWorkingDirectories()
  ) {
    recordWithheldMemoryPaths([{ path: filePath, why: 'outside' }])
    return []
  }

  // Official 2.1.328 (`are` + `H`): resolve permission-controlled reader for
  // this file and pass it recursively to every `@include` target so nested
  // files covered by `Read(...)` deny rules or outside-read blocks cannot enter
  // context. For top-level non-symlink memory files called directly without an
  // explicit reader, scope the exemption strictly to the file's ancestor dir's
  // own direct memory paths (`above(baseDir)`).
  const defaultExemptDir =
    depth === 0 && !isSymlink
      ? basename(dirname(filePath)) === '.claude'
        ? dirname(dirname(filePath))
        : dirname(filePath)
      : undefined
  const effectivePermissionReader =
    permissionReader ??
    getDefaultPermissionReaderForMemoryType(type, {
      enforceOutsideBlock: true,
      ...(defaultExemptDir !== undefined
        ? { exemptAncestorDir: defaultExemptDir }
        : {}),
    })

  processedPaths.add(normalizedPath)
  if (isSymlink) {
    processedPaths.add(normalizePathForComparison(resolvedPath))
  }

  const { info: memoryFile, includePaths: resolvedIncludePaths } =
    await safelyReadMemoryFileAsync(
      filePath,
      type,
      resolvedPath,
      effectivePermissionReader,
    )
  if (!memoryFile || !memoryFile.content.trim()) {
    return []
  }

  markWithheldMemoryLoaded([filePath])

  // Add parent information
  if (parent) {
    memoryFile.parent = parent
  }

  const result: MemoryFileInfo[] = []

  // Add the main file first (parent before children)
  result.push(memoryFile)

  for (const resolvedIncludePath of resolvedIncludePaths) {
    const isExternal = !pathInOriginalCwd(resolvedIncludePath)
    if (isExternal && !includeExternal) {
      continue
    }

    // Recursively process included files with this file as parent and
    // propagate the permission-controlled reader (official `are(..., H)`).
    const includedFiles = await processMemoryFile(
      resolvedIncludePath,
      type,
      processedPaths,
      includeExternal,
      depth + 1,
      filePath, // Pass current file as parent
      effectivePermissionReader,
    )
    result.push(...includedFiles)
  }

  return result
}

/**
 * Processes all .md files in the .claude/rules/ directory and its subdirectories
 * @param rulesDir The path to the rules directory
 * @param type Type of memory file (User, Project, Local)
 * @param processedPaths Set of already processed file paths
 * @param includeExternal Whether to include external files
 * @param conditionalRule If true, only include files with frontmatter paths; if false, only include files without frontmatter paths
 * @param visitedDirs Set of already visited directory real paths (for cycle detection)
 * @returns Array of MemoryFileInfo objects
 */
export async function processMdRules({
  rulesDir,
  type,
  processedPaths,
  includeExternal,
  conditionalRule,
  visitedDirs = new Set(),
  permissionReader,
}: {
  rulesDir: string
  type: MemoryType
  processedPaths: Set<string>
  includeExternal: boolean
  conditionalRule: boolean
  visitedDirs?: Set<string>
  permissionReader?: MemoryFilePermissionReader
}): Promise<MemoryFileInfo[]> {
  if (visitedDirs.has(rulesDir)) {
    return []
  }

  const effectivePermissionReader =
    permissionReader ?? getDefaultPermissionReaderForMemoryType(type)

  try {
    const fs = getFsImplementation()

    const resolvedDir = safeResolvePath(fs, rulesDir)
    const { resolvedPath: resolvedRulesDir, isSymlink } = resolvedDir
    if (
      isUnsafeNetworkOrNtIncludePath(resolvedRulesDir) ||
      isUnresolvedSymlink(resolvedDir)
    ) {
      return []
    }

    visitedDirs.add(rulesDir)
    if (isSymlink) {
      visitedDirs.add(resolvedRulesDir)
    }

    const result: MemoryFileInfo[] = []
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(resolvedRulesDir)
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR') {
        return []
      }
      throw e
    }

    for (const entry of entries) {
      const entryPath = join(rulesDir, entry.name)
      const resolvedEntry = safeResolvePath(fs, entryPath)
      const { resolvedPath: resolvedEntryPath, isSymlink } = resolvedEntry
      if (
        isUnsafeNetworkOrNtIncludePath(resolvedEntryPath) ||
        isUnresolvedSymlink(resolvedEntry)
      ) {
        continue
      }

      // Use Dirent methods for non-symlinks to avoid extra stat calls.
      // For symlinks, we need stat to determine what the target is.
      const stats = isSymlink ? await fs.stat(resolvedEntryPath) : null
      const isDirectory = stats ? stats.isDirectory() : entry.isDirectory()
      const isFile = stats ? stats.isFile() : entry.isFile()

      if (isDirectory) {
        result.push(
          ...(await processMdRules({
            rulesDir: resolvedEntryPath,
            type,
            processedPaths,
            includeExternal,
            conditionalRule,
            visitedDirs,
            permissionReader: effectivePermissionReader,
          })),
        )
      } else if (isFile && entry.name.endsWith('.md')) {
        // Official `QHe`: when a rule entry is symlinked (`entryPath !== resolvedEntryPath`),
        // also check the symlink spelling via permissionReader so Read deny on the symlink path applies.
        if (
          effectivePermissionReader &&
          entryPath !== resolvedEntryPath &&
          !processedPaths.has(normalizePathForComparison(resolvedEntryPath)) &&
          (await effectivePermissionReader(
            entryPath,
            MAX_MEMORY_FILE_BYTES,
          )) === undefined
        ) {
          continue
        }
        const files = await processMemoryFile(
          resolvedEntryPath,
          type,
          processedPaths,
          includeExternal,
          0,
          undefined,
          effectivePermissionReader,
        )
        result.push(
          ...files.filter(f => (conditionalRule ? f.globs : !f.globs)),
        )
      }
    }

    return result
  } catch (error) {
    if (error instanceof Error && error.message.includes('EACCES')) {
      logEvent('tengu_claude_rules_md_permission_error', {
        is_access_error: 1,
        has_home_dir: rulesDir.includes(getClaudeConfigHomeDir()) ? 1 : 0,
      })
    }
    return []
  }
}

/**
 * Official 2.1.328 `qC` (`Dq()` hold signature): fingerprint permission hold
 * state (Read deny rules, restricted/outside-read fence, additional working
 * dirs, AutoMem hold) so `getMemoryFiles` invalidates its memo cache whenever
 * the effective permission hold state changes.
 */
function getMemoryPermissionHoldSignature(): string {
  const ctx = resolveEffectiveMemoryPermissionContext()
  const autoMemHeld = isAutoMemoryHeldByOutsideReadBlock(ctx) ? '1' : '0'
  if (!ctx) {
    return `none|am:${autoMemHeld}`
  }
  const readDenies: string[] = []
  for (const [source, rules] of Object.entries(ctx.alwaysDenyRules)) {
    if (!rules) continue
    for (const rule of rules) {
      if (rule === 'Read' || rule.startsWith('Read(')) {
        readDenies.push(`${source}:${rule}`)
      }
    }
  }
  const dirs: string[] = []
  for (const [dir, entry] of ctx.additionalWorkingDirectories.entries()) {
    dirs.push(`${dir}:${entry.source}`)
  }
  return [
    ctx.restricted === true ? 'R1' : 'R0',
    ctx.blockReadsOutsideWorkingDirectories === true ? 'B1' : 'B0',
    `am:${autoMemHeld}`,
    readDenies.sort().join(','),
    dirs.sort().join(','),
  ].join('|')
}

export const getMemoryFiles = memoizePerRootSession(
  async (forceIncludeExternal: boolean = false): Promise<MemoryFileInfo[]> => {
    if (isDisklessActive()) {
      return []
    }
    const startTime = Date.now()
    logForDiagnosticsNoPII('info', 'memory_files_started')

    const result: MemoryFileInfo[] = []
    const processedPaths = new Set<string>()
    const config = getCurrentProjectConfig()
    const includeExternal =
      forceIncludeExternal ||
      config.hasClaudeMdExternalIncludesApproved ||
      false

    // Process Managed file first (always loaded - policy settings)
    const managedClaudeMd = getMemoryPath('Managed')
    result.push(
      ...(await processMemoryFile(
        managedClaudeMd,
        'Managed',
        processedPaths,
        includeExternal,
      )),
    )
    // Process Managed .claude/rules/*.md files
    const managedClaudeRulesDir = getManagedClaudeRulesDir()
    result.push(
      ...(await processMdRules({
        rulesDir: managedClaudeRulesDir,
        type: 'Managed',
        processedPaths,
        includeExternal,
        conditionalRule: false,
      })),
    )

    // Process User file (only if userSettings is enabled)
    if (isSettingSourceEnabled('userSettings')) {
      const userClaudeMd = getMemoryPath('User')
      result.push(
        ...(await processMemoryFile(
          userClaudeMd,
          'User',
          processedPaths,
          true, // User memory can always include external files
        )),
      )
      // Process User ~/.claude/rules/*.md files
      const userClaudeRulesDir = getUserClaudeRulesDir()
      result.push(
        ...(await processMdRules({
          rulesDir: userClaudeRulesDir,
          type: 'User',
          processedPaths,
          includeExternal: true,
          conditionalRule: false,
        })),
      )
    }

    // Then process Project and Local files
    const dirs: string[] = []
    const originalCwd = getOriginalCwd()
    let currentDir = originalCwd

    while (currentDir !== parse(currentDir).root) {
      dirs.push(currentDir)
      currentDir = dirname(currentDir)
    }

    // When running from a git worktree nested inside its main repo (e.g.,
    // .claude/worktrees/<name>/ from `claude -w`), the upward walk passes
    // through both the worktree root and the main repo root. Both contain
    // checked-in files like CLAUDE.md and .claude/rules/*.md, so the same
    // content gets loaded twice. Skip Project-type (checked-in) files from
    // directories above the worktree but within the main repo — the worktree
    // already has its own checkout. CLAUDE.local.md is gitignored so it only
    // exists in the main repo and is still loaded.
    // See: https://github.com/anthropics/claude-code/issues/29599
    const gitRoot = findGitRoot(originalCwd)
    const canonicalRoot = findCanonicalGitRoot(originalCwd)
    const isNestedWorktree =
      gitRoot !== null &&
      canonicalRoot !== null &&
      normalizePathForComparison(gitRoot) !==
        normalizePathForComparison(canonicalRoot) &&
      pathInWorkingPath(gitRoot, canonicalRoot)

    // Official 2.1.328 (`Awl` / `Hme` / `Pn`): build `within` and per-ancestor
    // `above(dir)` permission-controlled readers so ancestor directories only
    // exempt their own direct memory paths while keeping `enforceOutsideBlock`
    // active for every recursive `@include` and symlink target.
    const memoryPermCtx = resolveEffectiveMemoryPermissionContext()
    const withinPermissionReader = memoryPermCtx
      ? createMemoryPermissionReader(memoryPermCtx, {
          enforceOutsideBlock: true,
        })
      : undefined
    const abovePermissionReaderFor = memoryPermCtx
      ? (ancestorDir: string) =>
          createMemoryPermissionReader(memoryPermCtx, {
            enforceOutsideBlock: true,
            exemptAncestorDir: ancestorDir,
          })
      : undefined

    // Process from root downward to CWD
    for (const dir of dirs.reverse()) {
      // 2.1.323 #2161: Do not look up CLAUDE.md / .claude inside Linux autofs
      // map roots (such as `/home`) or `CLAUDE_CODE_AUTOMOUNT_ROOTS`.
      if (isAutomountMapRoot(dir)) {
        continue
      }
      // In a nested worktree, skip checked-in files from the main repo's
      // working tree (dirs inside canonicalRoot but outside the worktree).
      const skipProject =
        isNestedWorktree &&
        pathInWorkingPath(dir, canonicalRoot) &&
        !pathInWorkingPath(dir, gitRoot)
      const dirPermissionReader =
        dir === originalCwd
          ? withinPermissionReader
          : abovePermissionReaderFor?.(dir)

      // Try reading CLAUDE.md (Project) - only if projectSettings is enabled
      if (isSettingSourceEnabled('projectSettings') && !skipProject) {
        const projectPath = join(dir, 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            projectPath,
            'Project',
            processedPaths,
            includeExternal,
            0,
            undefined,
            dirPermissionReader,
          )),
        )

        // Try reading .claude/CLAUDE.md (Project)
        const dotClaudePath = join(dir, '.claude', 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            dotClaudePath,
            'Project',
            processedPaths,
            includeExternal,
            0,
            undefined,
            dirPermissionReader,
          )),
        )

        // Try reading .claude/rules/*.md files (Project)
        const rulesDir = join(dir, '.claude', 'rules')
        result.push(
          ...(await processMdRules({
            rulesDir,
            type: 'Project',
            processedPaths,
            includeExternal,
            conditionalRule: false,
            permissionReader: dirPermissionReader,
          })),
        )
      }

      // Try reading CLAUDE.local.md (Local) - only if localSettings is enabled
      if (isSettingSourceEnabled('localSettings')) {
        const localPath = join(dir, 'CLAUDE.local.md')
        result.push(
          ...(await processMemoryFile(
            localPath,
            'Local',
            processedPaths,
            includeExternal,
            0,
            undefined,
            dirPermissionReader,
          )),
        )
      }
    }

    // Process CLAUDE.md from additional directories (--add-dir) if env var is enabled
    // This is controlled by CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD and defaults to off
    // Note: we don't check isSettingSourceEnabled('projectSettings') here because --add-dir
    // is an explicit user action and the SDK defaults settingSources to [] when not specified
    let includeAdditionalDirsClaudeMd = isEnvTruthy(
      process.env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD,
    )
    try {
      const { isAdditionalDirectoriesClaudeMdEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
      includeAdditionalDirsClaudeMd = isAdditionalDirectoriesClaudeMdEnabled()
    } catch {
      // residual helpers optional
    }
    if (includeAdditionalDirsClaudeMd) {
      const additionalDirs = getAdditionalDirectoriesForClaudeMd()
      for (const dir of additionalDirs) {
        // Try reading CLAUDE.md from the additional directory
        const projectPath = join(dir, 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            projectPath,
            'Project',
            processedPaths,
            includeExternal,
            0,
            undefined,
            withinPermissionReader,
          )),
        )

        // Try reading .claude/CLAUDE.md from the additional directory
        const dotClaudePath = join(dir, '.claude', 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            dotClaudePath,
            'Project',
            processedPaths,
            includeExternal,
            0,
            undefined,
            withinPermissionReader,
          )),
        )

        // Try reading .claude/rules/*.md files from the additional directory
        const rulesDir = join(dir, '.claude', 'rules')
        result.push(
          ...(await processMdRules({
            rulesDir,
            type: 'Project',
            processedPaths,
            includeExternal,
            conditionalRule: false,
            permissionReader: withinPermissionReader,
          })),
        )
      }
    }

    // Memdir entrypoint (memory.md) - only if feature is on, not held by
    // outside-read block (official `DZr`: `v_() && !Rge()`), and file exists
    if (
      isAutoMemoryEnabled() &&
      !isAutoMemoryHeldByOutsideReadBlock(memoryPermCtx)
    ) {
      const { info: memdirEntry } = await safelyReadMemoryFileAsync(
        getAutoMemEntrypoint(),
        'AutoMem',
      )
      if (memdirEntry) {
        const normalizedPath = normalizePathForComparison(memdirEntry.path)
        if (!processedPaths.has(normalizedPath)) {
          processedPaths.add(normalizedPath)
          result.push(memdirEntry)
        }
      }
    }

    // Team memory entrypoint - only if feature is on and file exists
    if (feature('TEAMMEM') && teamMemPaths!.isTeamMemoryEnabled()) {
      const { info: teamMemEntry } = await safelyReadMemoryFileAsync(
        teamMemPaths!.getTeamMemEntrypoint(),
        'TeamMem',
      )
      if (teamMemEntry) {
        const normalizedPath = normalizePathForComparison(teamMemEntry.path)
        if (!processedPaths.has(normalizedPath)) {
          processedPaths.add(normalizedPath)
          result.push(teamMemEntry)
        }
      }
    }

    const totalContentLength = result.reduce(
      (sum, f) => sum + f.content.length,
      0,
    )

    logForDiagnosticsNoPII('info', 'memory_files_completed', {
      duration_ms: Date.now() - startTime,
      file_count: result.length,
      total_content_length: totalContentLength,
    })

    const typeCounts: Record<string, number> = {}
    for (const f of result) {
      typeCounts[f.type] = (typeCounts[f.type] ?? 0) + 1
    }

    const sessionState = getClaudeMdSessionState()
    if (!sessionState.hasLoggedInitialLoad) {
      sessionState.hasLoggedInitialLoad = true
      logEvent('tengu_claudemd__initial_load', {
        file_count: result.length,
        total_content_length: totalContentLength,
        user_count: typeCounts['User'] ?? 0,
        project_count: typeCounts['Project'] ?? 0,
        local_count: typeCounts['Local'] ?? 0,
        managed_count: typeCounts['Managed'] ?? 0,
        automem_count: typeCounts['AutoMem'] ?? 0,
        ...(feature('TEAMMEM')
          ? { teammem_count: typeCounts['TeamMem'] ?? 0 }
          : {}),
        duration_ms: Date.now() - startTime,
      })
    }

    // Fire InstructionsLoaded hook for each instruction file loaded
    // (fire-and-forget, audit/observability only).
    // AutoMem/TeamMem are intentionally excluded — they're a separate
    // memory system, not "instructions" in the CLAUDE.md/rules sense.
    // Gated on !forceIncludeExternal: the forceIncludeExternal=true variant
    // is only used by getExternalClaudeMdIncludes() for approval checks, not
    // for building context — firing the hook there would double-fire on startup.
    // The one-shot flag is consumed on every !forceIncludeExternal cache miss
    // (NOT gated on hasInstructionsLoadedHook) so the flag is released even
    // when no hook is configured — otherwise a mid-session hook registration
    // followed by a direct .cache.clear() would spuriously fire with a stale
    // 'session_start' reason.
    if (!forceIncludeExternal) {
      const eagerLoadReason = consumeNextEagerLoadReason()
      if (eagerLoadReason !== undefined && hasInstructionsLoadedHook()) {
        for (const file of result) {
          if (!isInstructionsMemoryType(file.type)) continue
          const loadReason = file.parent ? 'include' : eagerLoadReason
          void executeInstructionsLoadedHooks(
            file.path,
            file.type,
            loadReason,
            {
              globs: file.globs,
              parentFilePath: file.parent,
            },
          )
        }
      }
    }

    return result
  },
  (forceIncludeExternal: boolean = false): string => {
    const holdSignature = getMemoryPermissionHoldSignature()
    return `${getOriginalCwd()}::${getCwd()}::${Boolean(forceIncludeExternal)}::${holdSignature}`
  },
)

function isInstructionsMemoryType(
  type: MemoryType,
): type is InstructionsMemoryType {
  return (
    type === 'User' ||
    type === 'Project' ||
    type === 'Local' ||
    type === 'Managed'
  )
}

function consumeNextEagerLoadReason(): InstructionsLoadReason | undefined {
  const state = getClaudeMdSessionState()
  if (!state.shouldFireHook) return undefined
  state.shouldFireHook = false
  const reason = state.nextEagerLoadReason
  state.nextEagerLoadReason = 'session_start'
  return reason
}

/**
 * Clears the getMemoryFiles memoize cache
 * without firing the InstructionsLoaded hook.
 *
 * Use this for cache invalidation that is purely for correctness (e.g.
 * worktree enter/exit, settings sync, /memory dialog). For events that
 * represent instructions actually being reloaded into context (e.g.
 * compaction), use resetGetMemoryFilesCache() instead.
 */
export function clearMemoryFileCaches(): void {
  // ?.cache because tests spyOn this, which replaces the memoize wrapper.
  getMemoryFiles.cache?.clear?.()
}

export function resetGetMemoryFilesCache(
  reason: InstructionsLoadReason = 'session_start',
): void {
  const state = getClaudeMdSessionState()
  state.nextEagerLoadReason = reason
  state.shouldFireHook = true
  clearMemoryFileCaches()
}

export function getLargeMemoryFiles(files: MemoryFileInfo[]): MemoryFileInfo[] {
  return files.filter(f => f.content.length > MAX_MEMORY_CHARACTER_COUNT)
}

/**
 * When tengu_moth_copse is on, the findRelevantMemories prefetch surfaces
 * memory files via attachments, so the MEMORY.md index is no longer injected
 * into the system prompt. Callsites that care about "what's actually in
 * context" (context builder, /context viz) should filter through this.
 */
export function filterInjectedMemoryFiles(
  files: MemoryFileInfo[],
): MemoryFileInfo[] {
  const skipMemoryIndex = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_moth_copse',
    false,
  )
  if (!skipMemoryIndex) return files
  return files.filter(f => f.type !== 'AutoMem' && f.type !== 'TeamMem')
}

/**
 * densable 2.1.283 `HEn` — exists check for AGENTS.md beside a walk directory.
 * Not the loader; agents-md compositor injects files on prompt.context.
 */
export async function directoryHasAgentsMd(dir: string): Promise<boolean> {
  const filePath = join(dir, 'AGENTS.md')
  if (isUnsafeNetworkOrNtIncludePath(filePath)) return false
  try {
    const fs = getFsImplementation()
    const resolved = safeResolvePath(fs, filePath)
    if (
      isUnsafeNetworkOrNtIncludePath(resolved.resolvedPath) ||
      isUnresolvedSymlink(resolved)
    ) {
      return false
    }
    if (
      resolved.isSymlink &&
      !pathInOriginalCwd(resolved.resolvedPath) &&
      settingsHaveBlockReadsOutsideWorkingDirectories()
    ) {
      return false
    }
    const stats = fs.lstatSync(filePath)
    if (stats.isSymbolicLink() && !resolved.isCanonical) {
      return false
    }
    return stats.isFile() || stats.isSymbolicLink()
  } catch {
    return false
  }
}

export const getClaudeMds = (
  memoryFiles: MemoryFileInfo[],
  filter?: (type: MemoryType) => boolean,
): string => {
  const memories: string[] = []
  // Official GB tengu_paper_halyard — skip Project/Local CLAUDE.md.
  // CLAUDE_CODE_SKIP_PROJECT_BACKFILL is schema-only in 2.1.207 (no product
  // consumer on this path); do not OR it in here.
  const skipProjectLevel = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_paper_halyard',
    false,
  )

  for (const file of memoryFiles) {
    if (filter && !filter(file.type)) continue
    if (skipProjectLevel && (file.type === 'Project' || file.type === 'Local'))
      continue
    if (file.content) {
      const description =
        file.type === 'Project'
          ? ' (project instructions, checked into the codebase)'
          : file.type === 'Local'
            ? " (user's private project instructions, not checked in)"
            : feature('TEAMMEM') && file.type === 'TeamMem'
              ? ' (shared team memory, synced across the organization)'
              : file.type === 'AutoMem'
                ? " (user's auto-memory, persists across conversations)"
                : " (user's private global instructions for all projects)"

      const content = file.content.trim()
      if (feature('TEAMMEM') && file.type === 'TeamMem') {
        memories.push(
          `Contents of ${file.path}${description}:\n\n<team-memory-content source="shared">\n${content}\n</team-memory-content>`,
        )
      } else {
        memories.push(`Contents of ${file.path}${description}:\n\n${content}`)
      }
    }
  }

  if (memories.length === 0) {
    return ''
  }

  return `${MEMORY_INSTRUCTION_PROMPT}\n\n${memories.join('\n\n')}`
}

/**
 * Gets managed and user conditional rules that match the target path.
 * This is the first phase of nested memory loading.
 *
 * @param targetPath The target file path to match against glob patterns
 * @param processedPaths Set of already processed file paths (will be mutated)
 * @returns Array of MemoryFileInfo objects for matching conditional rules
 */
export async function getManagedAndUserConditionalRules(
  targetPath: string,
  processedPaths: Set<string>,
): Promise<MemoryFileInfo[]> {
  const result: MemoryFileInfo[] = []

  // Process Managed conditional .claude/rules/*.md files
  const managedClaudeRulesDir = getManagedClaudeRulesDir()
  result.push(
    ...(await processConditionedMdRules(
      targetPath,
      managedClaudeRulesDir,
      'Managed',
      processedPaths,
      false,
    )),
  )

  if (isSettingSourceEnabled('userSettings')) {
    // Process User conditional .claude/rules/*.md files
    const userClaudeRulesDir = getUserClaudeRulesDir()
    result.push(
      ...(await processConditionedMdRules(
        targetPath,
        userClaudeRulesDir,
        'User',
        processedPaths,
        true,
      )),
    )
  }

  return result
}

/**
 * Gets memory files for a single nested directory (between CWD and target).
 * Loads CLAUDE.md, unconditional rules, and conditional rules for that directory.
 *
 * @param dir The directory to process
 * @param targetPath The target file path (for conditional rule matching)
 * @param processedPaths Set of already processed file paths (will be mutated)
 * @returns Array of MemoryFileInfo objects
 */
export async function getMemoryFilesForNestedDirectory(
  dir: string,
  targetPath: string,
  processedPaths: Set<string>,
  permissionReader?: MemoryFilePermissionReader,
): Promise<MemoryFileInfo[]> {
  if (isDisklessActive()) {
    return []
  }
  const result: MemoryFileInfo[] = []
  const effectivePermissionReader =
    permissionReader ?? getDefaultPermissionReaderForMemoryType('Project')

  // Process project memory files (CLAUDE.md and .claude/CLAUDE.md)
  if (isSettingSourceEnabled('projectSettings')) {
    const projectPath = join(dir, 'CLAUDE.md')
    result.push(
      ...(await processMemoryFile(
        projectPath,
        'Project',
        processedPaths,
        false,
        0,
        undefined,
        effectivePermissionReader,
      )),
    )
    const dotClaudePath = join(dir, '.claude', 'CLAUDE.md')
    result.push(
      ...(await processMemoryFile(
        dotClaudePath,
        'Project',
        processedPaths,
        false,
        0,
        undefined,
        effectivePermissionReader,
      )),
    )
  }

  // Process local memory file (CLAUDE.local.md)
  if (isSettingSourceEnabled('localSettings')) {
    const localPath = join(dir, 'CLAUDE.local.md')
    result.push(
      ...(await processMemoryFile(
        localPath,
        'Local',
        processedPaths,
        false,
        0,
        undefined,
        effectivePermissionReader,
      )),
    )
  }

  const rulesDir = join(dir, '.claude', 'rules')

  // Process project unconditional .claude/rules/*.md files, which were not eagerly loaded
  // Use a separate processedPaths set to avoid marking conditional rule files as processed
  const unconditionalProcessedPaths = new Set(processedPaths)
  result.push(
    ...(await processMdRules({
      rulesDir,
      type: 'Project',
      processedPaths: unconditionalProcessedPaths,
      includeExternal: false,
      conditionalRule: false,
      permissionReader: effectivePermissionReader,
    })),
  )

  // Process project conditional .claude/rules/*.md files
  result.push(
    ...(await processConditionedMdRules(
      targetPath,
      rulesDir,
      'Project',
      processedPaths,
      false,
      effectivePermissionReader,
    )),
  )

  // processedPaths must be seeded with unconditional paths for subsequent directories
  for (const path of unconditionalProcessedPaths) {
    processedPaths.add(path)
  }

  return result
}

/**
 * Gets conditional rules for a CWD-level directory (from root up to CWD).
 * Only processes conditional rules since unconditional rules are already loaded eagerly.
 *
 * @param dir The directory to process
 * @param targetPath The target file path (for conditional rule matching)
 * @param processedPaths Set of already processed file paths (will be mutated)
 * @returns Array of MemoryFileInfo objects
 */
export async function getConditionalRulesForCwdLevelDirectory(
  dir: string,
  targetPath: string,
  processedPaths: Set<string>,
  permissionReader?: MemoryFilePermissionReader,
): Promise<MemoryFileInfo[]> {
  const rulesDir = join(dir, '.claude', 'rules')
  return processConditionedMdRules(
    targetPath,
    rulesDir,
    'Project',
    processedPaths,
    false,
    permissionReader,
  )
}

/**
 * Processes all .md files in the .claude/rules/ directory and its subdirectories,
 * filtering to only include files with frontmatter paths that match the target path
 * @param targetPath The file path to match against frontmatter glob patterns
 * @param rulesDir The path to the rules directory
 * @param type Type of memory file (User, Project, Local)
 * @param processedPaths Set of already processed file paths
 * @param includeExternal Whether to include external files
 * @returns Array of MemoryFileInfo objects that match the target path
 */
export async function processConditionedMdRules(
  targetPath: string,
  rulesDir: string,
  type: MemoryType,
  processedPaths: Set<string>,
  includeExternal: boolean,
  permissionReader?: MemoryFilePermissionReader,
): Promise<MemoryFileInfo[]> {
  const conditionedRuleMdFiles = await processMdRules({
    rulesDir,
    type,
    processedPaths,
    includeExternal,
    conditionalRule: true,
    permissionReader,
  })

  // Filter to only include files whose globs patterns match the targetPath
  return conditionedRuleMdFiles.filter(file => {
    if (!file.globs || file.globs.length === 0) {
      return false
    }

    // For Project rules: glob patterns are relative to the directory containing .claude
    // For Managed/User rules: glob patterns are relative to the original CWD
    const baseDir =
      type === 'Project'
        ? dirname(dirname(rulesDir)) // Parent of .claude
        : getOriginalCwd() // Project root for managed/user rules

    const relativePath = isAbsolute(targetPath)
      ? relative(baseDir, targetPath)
      : targetPath
    // ignore() throws on empty strings, paths escaping the base (../),
    // and absolute paths (Windows cross-drive relative() returns absolute).
    // Files outside baseDir can't match baseDir-relative globs anyway.
    if (
      !relativePath ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath)
    ) {
      return false
    }
    // Official 2.1.207: drop uncompilable globs instead of throwing.
    const globs = filterCompilableIgnorePatterns(
      file.globs,
      'claudemd_rule_globs',
    )
    if (globs.length === 0) return false
    return ignore().add(globs).ignores(relativePath)
  })
}

export type ExternalClaudeMdInclude = {
  path: string
  parent: string
}

export function getExternalClaudeMdIncludes(
  files: MemoryFileInfo[],
): ExternalClaudeMdInclude[] {
  const externals: ExternalClaudeMdInclude[] = []
  for (const file of files) {
    if (file.type !== 'User' && file.parent && !pathInOriginalCwd(file.path)) {
      externals.push({ path: file.path, parent: file.parent })
    }
  }
  return externals
}

export function hasExternalClaudeMdIncludes(files: MemoryFileInfo[]): boolean {
  return getExternalClaudeMdIncludes(files).length > 0
}

export async function shouldShowClaudeMdExternalIncludesWarning(): Promise<boolean> {
  const config = getCurrentProjectConfig()
  if (
    config.hasClaudeMdExternalIncludesApproved ||
    config.hasClaudeMdExternalIncludesWarningShown
  ) {
    return false
  }

  return hasExternalClaudeMdIncludes(await getMemoryFiles(true))
}

/**
 * Check if a file path is a memory file (CLAUDE.md, CLAUDE.local.md, or .claude/rules/*.md)
 */
export function isMemoryFilePath(filePath: string): boolean {
  const name = basename(filePath)
  const normalizedPath = normalizePathForComparison(filePath)

  // CLAUDE.md or CLAUDE.local.md anywhere
  if (name === 'CLAUDE.md' || name === 'CLAUDE.local.md') {
    return true
  }

  // .md files in .claude/rules/ directories
  if (name.endsWith('.md') && normalizedPath.includes('/.claude/rules/')) {
    return true
  }

  return false
}

/**
 * Get all memory file paths from both standard discovery and readFileState.
 * Combines:
 * - getMemoryFiles() paths (CWD upward to root)
 * - readFileState paths matching memory patterns (includes child directories)
 */
export function getAllMemoryFilePaths(
  files: MemoryFileInfo[],
  readFileState: FileStateCache,
): string[] {
  const paths = new Set<string>()
  for (const file of files) {
    if (file.content.trim().length > 0) {
      paths.add(file.path)
    }
  }

  // Add memory files from readFileState (includes child directories)
  for (const filePath of cacheKeys(readFileState)) {
    if (isMemoryFilePath(filePath)) {
      paths.add(filePath)
    }
  }

  return Array.from(paths)
}

// ============================================================================
// #229: Withheld memory tracking & transcript formatting (NE / d3 / tst / nst / ost)
// ============================================================================

export type WithheldMemoryWhy = 'denied' | 'outside' | 'unjudged' | 'unsettled'

export type WithheldMemoryEntry = {
  path: string
  why: WithheldMemoryWhy
}

export type WithheldMemoryAttachmentEntry = WithheldMemoryEntry & {
  displayPath: string
}

export const WITHHELD_MEMORY_REASON_LABELS: Record<WithheldMemoryWhy, string> =
  {
    denied: 'a Read deny rule covers it',
    outside:
      "it's read from outside your working directories, where reads are blocked",
    unjudged:
      "a Read deny rule couldn't be checked without a working directory",
    unsettled: "where it leads couldn't be worked out",
  }

const MAX_WITHHELD_TRACKED = 200
const WITHHELD_SHOWN_LIMIT = 20

export function getWithheldMemoryToken(): string {
  return getClaudeMdSessionState().withheldMemoryState.token
}

export function logWithheldMemoryPaths(
  entries: readonly WithheldMemoryEntry[],
): void {
  const { withheldMemoryState } = getClaudeMdSessionState()
  for (const { path, why } of entries) {
    if (
      !withheldMemoryState.logged.has(path) &&
      withheldMemoryState.logged.size < MAX_WITHHELD_TRACKED
    ) {
      withheldMemoryState.logged.add(path)
      logForDebugging(
        `Instruction file not loaded: ${path} (${WITHHELD_MEMORY_REASON_LABELS[why]})`,
      )
    }
  }
}

export function recordWithheldMemoryPaths(
  entries: readonly WithheldMemoryEntry[],
  isNonInteractive = false,
): void {
  logWithheldMemoryPaths(entries)
  if (isNonInteractive) return
  const { withheldMemoryState } = getClaudeMdSessionState()
  for (const entry of entries) {
    if (
      !withheldMemoryState.owed.has(entry.path) &&
      withheldMemoryState.owed.size < MAX_WITHHELD_TRACKED
    ) {
      withheldMemoryState.owed.set(entry.path, entry)
    }
  }
}

export function markWithheldMemoryLoaded(paths: readonly string[]): void {
  const { withheldMemoryState } = getClaudeMdSessionState()
  for (const p of paths) {
    withheldMemoryState.owed.delete(p)
  }
}

export function drainWithheldMemoryOwed(
  excludePaths: ReadonlySet<string> | readonly string[],
): WithheldMemoryEntry[] {
  const { withheldMemoryState } = getClaudeMdSessionState()
  for (const p of excludePaths) {
    withheldMemoryState.owed.delete(p)
  }
  return Array.from(withheldMemoryState.owed.values())
}

export function collectWithheldMemorySeen(
  attachments: ReadonlyArray<{ type: string; [key: string]: unknown }>,
  token = getClaudeMdSessionState().withheldMemoryState.token,
): Set<string> {
  const { withheldMemoryState } = getClaudeMdSessionState()
  const fromAttachments = new Set<string>()
  for (const att of attachments) {
    if (att.type !== 'withheld_memory' || att.by !== token) continue
    if (!Array.isArray(att.entries)) continue
    for (const entry of att.entries) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { path?: unknown }).path === 'string'
      ) {
        const p = (entry as { path: string }).path
        fromAttachments.add(p)
        if (withheldMemoryState.seen.size < MAX_WITHHELD_TRACKED) {
          withheldMemoryState.seen.add(p)
        }
      }
    }
  }
  return new Set([...withheldMemoryState.seen, ...fromAttachments])
}

export function resetWithheldMemoryStateForTests(): void {
  const { withheldMemoryState } = getClaudeMdSessionState()
  withheldMemoryState.owed.clear()
  withheldMemoryState.logged.clear()
  withheldMemoryState.seen.clear()
}

export function formatWithheldMemoryLine(
  why: WithheldMemoryWhy,
  displayPath: string,
): { lead: string; mark: string; path: string } {
  return {
    lead: `Instruction file not loaded (${WITHHELD_MEMORY_REASON_LABELS[why]}):`,
    mark: 'path:',
    path: displayPath.replace(/\s+/g, ' '),
  }
}

export function formatWithheldMore(more: number): string {
  return `and ${more} more instruction ${more === 1 ? 'file' : 'files'} not loaded`
}

export function withheldShown<T>(entries: readonly T[]): {
  shown: T[]
  more: number
} {
  return {
    shown: entries.slice(0, WITHHELD_SHOWN_LIMIT),
    more: Math.max(entries.length - WITHHELD_SHOWN_LIMIT, 0),
  }
}
