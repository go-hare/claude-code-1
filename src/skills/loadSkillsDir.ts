import { realpath } from 'fs/promises'
import ignore from 'ignore'
import memoize from 'lodash-es/memoize.js'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  sep as pathSep,
  relative,
  resolve,
} from 'path'
import {
  getAdditionalDirectoriesForClaudeMd,
  getInlinePlugins,
  getInlinePluginsNoMcp,
  getOriginalCwd,
  getSessionId,
  getSyncedPluginDirs,
} from '../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Command, PromptCommand } from '../types/command.js'
import {
  parseArgumentNames,
  substituteArguments,
} from '../utils/argumentSubstitution.js'
import { logForDebugging } from '../utils/debug.js'
import {
  awaitPendingSkillDownload,
  hasPendingSkillDownload,
  type PendingSkillDownloadOutcome,
  registerPendingSkillDownload,
} from './syncedSkillsHarden.js'
import { isValidSkillName, recordNameNotShown } from '../utils/sanitization.js'
import { filterCompilableIgnorePatterns } from '../utils/ignorePatterns.js'
import {
  EFFORT_LEVELS,
  type EffortValue,
  parseEffortValue,
} from '../utils/effort.js'
import { getCwd } from '../utils/cwd.js'
import { getCurrentWorktreeSession } from '../utils/worktree.js'
import {
  getClaudeConfigHomeDir,
  isBareMode,
  isEnvTruthy,
} from '../utils/envUtils.js'
import { isENOENT, isFsInaccessible } from '../utils/errors.js'
import {
  buildSkillFile,
  coerceDescriptionToString,
  type FrontmatterData,
  type FrontmatterShell,
  mergeDisallowedToolsFromFrontmatter,
  parseBooleanFrontmatter,
  parseFrontmatter,
  parseFrontmatterMetadata,
  parseShellFrontmatter,
  splitPathInFrontmatter,
} from '../utils/frontmatterParser.js'
import { getFsImplementation } from '../utils/fsOperations.js'
import { wrapSkillAllowedToolsGetter } from '../utils/permissions/skillAllowedToolsTrust.js'
import { isPathGitignored } from '../utils/git/gitignore.js'
import { logError } from '../utils/log.js'
import {
  extractDescriptionFromMarkdown,
  getProjectDirsUpToHome,
  loadMarkdownFilesForSubdir,
  type MarkdownFile,
  parseSlashCommandToolsFromFrontmatter,
} from '../utils/markdownConfigLoader.js'
import { parseUserSpecifiedModel } from '../utils/model/model.js'
import { executeShellCommandsInPrompt } from '../utils/promptShellExecution.js'
import { SandboxManager } from '../utils/sandbox/sandbox-adapter.js'
import type { SettingSource } from '../utils/settings/constants.js'
import { isSettingSourceEnabled } from '../utils/settings/constants.js'
import { getManagedFilePath } from '../utils/settings/managedPath.js'
import {
  isRestrictedToPluginOnly,
  registerStrictPluginOnlyChangeCallback,
} from '../utils/settings/pluginOnlyPolicy.js'
import { HooksSchema, type HooksSettings } from '../utils/settings/types.js'
import { createSignal } from '../utils/signal.js'
import { registerMCPSkillBuilders } from './mcpSkillBuilders.js'

export type LoadedFrom =
  | 'commands_DEPRECATED'
  | 'skills'
  | 'plugin'
  | 'managed'
  | 'bundled'
  | 'mcp'
  | 'syncedSkills' // densable 2.1.228 #12 — claude.ai sync
  | 'memoryStore' // densable sN loadedFrom:"memoryStore" @181327164

/**
 * Returns a claude config directory path for a given source.
 */
export function getSkillsPath(
  source: SettingSource | 'plugin',
  dir: 'skills' | 'commands',
): string {
  switch (source) {
    case 'policySettings':
      return join(getManagedFilePath(), '.claude', dir)
    case 'userSettings':
      return join(getClaudeConfigHomeDir(), dir)
    case 'projectSettings':
      return `.claude/${dir}`
    case 'plugin':
      return 'plugin'
    default:
      return ''
  }
}

/**
 * Estimates token count for a skill based on frontmatter only
 * (name, description, whenToUse) since full content is only loaded on invocation.
 */
export function estimateSkillFrontmatterTokens(skill: Command): number {
  const frontmatterText = [skill.name, skill.description, skill.whenToUse]
    .filter(Boolean)
    .join(' ')
  return roughTokenCountEstimation(frontmatterText)
}

/**
 * Gets a unique identifier for a file by resolving symlinks to a canonical path.
 * This allows detection of duplicate files accessed through different paths
 * (e.g., via symlinks or overlapping parent directories).
 * Returns null if the file doesn't exist or can't be resolved.
 *
 * Uses realpath to resolve symlinks, which is filesystem-agnostic and avoids
 * issues with filesystems that report unreliable inode values (e.g., inode 0 on
 * some virtual/container/NFS filesystems, or precision loss on ExFAT).
 * See: https://github.com/anthropics/claude-code/issues/13893
 */
async function getFileIdentity(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath)
  } catch {
    return null
  }
}

// Internal type to track skill with its file path for deduplication
type SkillWithPath = {
  skill: Command
  filePath: string
}

/**
 * Parse and validate hooks from frontmatter.
 * Returns undefined if hooks are not defined or invalid.
 */
function parseHooksFromFrontmatter(
  frontmatter: FrontmatterData,
  skillName: string,
): HooksSettings | undefined {
  if (!frontmatter.hooks) {
    return undefined
  }

  const result = HooksSchema().safeParse(frontmatter.hooks)
  if (!result.success) {
    logForDebugging(
      `Invalid hooks in skill '${skillName}': ${result.error.message}`,
    )
    return undefined
  }

  return result.data
}

/**
 * Parse paths frontmatter from a skill, using the same format as CLAUDE.md rules.
 * Returns undefined if no paths are specified or if all patterns are match-all.
 */
function parseSkillPaths(frontmatter: FrontmatterData): string[] | undefined {
  if (!frontmatter.paths) {
    return undefined
  }

  const patterns = splitPathInFrontmatter(frontmatter.paths)
    .map(pattern => {
      // Remove /** suffix - ignore library treats 'path' as matching both
      // the path itself and everything inside it
      return pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern
    })
    .filter((p: string) => p.length > 0)

  // If all patterns are ** (match-all), treat as no paths (undefined)
  if (patterns.length === 0 || patterns.every((p: string) => p === '**')) {
    return undefined
  }

  return patterns
}

// Official 2.1.328 `vot()` / `gsn()` / `YB()` (`chunk@284022131.js@395500-397000`,
// `chunk@294254613.js@3898200`): skip connector-downloads and cloud browser-downloads
// folders during skill discovery so downloaded connector files are never loaded as skills.
const CONNECTOR_DOWNLOADS_DIR_NAME = 'connector-downloads'
const CONNECTOR_DOWNLOADS_INVISIBLE_RE =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g
const CONNECTOR_DOWNLOADS_SEGMENT_RE = new RegExp(
  `^${CONNECTOR_DOWNLOADS_DIR_NAME}[. ]*(?::.*)?$`,
)

export function isConnectorDownloadsSegment(segment: string): boolean {
  if (segment.length < CONNECTOR_DOWNLOADS_DIR_NAME.length) {
    return false
  }
  const normalized = segment
    .toLowerCase()
    .replaceAll('\u017F', 's')
    .replace(CONNECTOR_DOWNLOADS_INVISIBLE_RE, '')
  return CONNECTOR_DOWNLOADS_SEGMENT_RE.test(normalized)
}

function isPathInsideConnectorDownloadsSync(targetPath: string): boolean {
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    return false
  }
  const segments = targetPath.split(/[\\/]/)
  if (segments.some(isConnectorDownloadsSegment)) {
    return true
  }
  const stageRoot = process.env.CLAUDE_STAGE_FILE_ROOT
  if (stageRoot && isAbsolute(stageRoot)) {
    const browserDownloads = resolve(stageRoot, 'browser-downloads')
    const normalized = resolve(targetPath)
    if (
      normalized === browserDownloads ||
      normalized.startsWith(browserDownloads + pathSep)
    ) {
      return true
    }
  }
  return false
}

/**
 * Official 2.1.328 `vot(path)` (`chunk@284022131.js@396977`): returns true when
 * `dirPath` (or its resolved realpath) is a `connector-downloads` directory or
 * lies beneath one.
 */
export async function isConnectorDownloadsPath(
  dirPath: string,
): Promise<boolean> {
  const normalized = resolve(dirPath)
  if (isPathInsideConnectorDownloadsSync(normalized)) {
    return true
  }
  try {
    const resolved = await realpath(normalized)
    if (isPathInsideConnectorDownloadsSync(resolved)) {
      return true
    }
  } catch {
    // Path may not exist yet — lexical check above already ran.
  }
  return false
}

/**
 * Parses all skill frontmatter fields that are shared between file-based and
 * MCP skill loading. Caller supplies the resolved skill name and the
 * source/loadedFrom/baseDir/paths fields separately.
 */
export function parseSkillFrontmatterFields(
  frontmatter: FrontmatterData,
  markdownContent: string,
  resolvedName: string,
  descriptionFallbackLabel: 'Skill' | 'Custom command' = 'Skill',
): {
  displayName: string | undefined
  description: string
  hasUserSpecifiedDescription: boolean
  allowedTools: string[]
  disallowedTools: string[]
  argumentHint: string | undefined
  argumentNames: string[]
  whenToUse: string | undefined
  version: string | undefined
  model: ReturnType<typeof parseUserSpecifiedModel> | undefined
  disableModelInvocation: boolean
  userInvocable: boolean
  hooks: HooksSettings | undefined
  executionContext: 'fork' | undefined
  /** densable 2.1.218: fork skills default background:true */
  background: boolean | undefined
  agent: string | undefined
  effort: EffortValue | undefined
  shell: FrontmatterShell | undefined
  /** densable createdBy — dream-proposal only. */
  createdBy: 'dream-proposal' | undefined
  /** Official 2.1.328 `fallback` — thin-pointer stub yields to plugin/MCP skill. */
  fallback: boolean | undefined
  /** Official 2.1.328 `metadata` — free-form author metadata object. */
  metadata: Record<string, unknown> | undefined
} {
  const validatedDescription = coerceDescriptionToString(
    frontmatter.description,
    resolvedName,
  )
  const description =
    validatedDescription ??
    extractDescriptionFromMarkdown(markdownContent, descriptionFallbackLabel)

  const userInvocable =
    frontmatter['user-invocable'] === undefined
      ? true
      : parseBooleanFrontmatter(frontmatter['user-invocable'])

  const model =
    frontmatter.model === 'inherit'
      ? undefined
      : frontmatter.model
        ? parseUserSpecifiedModel(frontmatter.model as string)
        : undefined

  const effortRaw = frontmatter['effort']
  const effort =
    effortRaw !== undefined ? parseEffortValue(effortRaw) : undefined
  if (effortRaw !== undefined && effort === undefined) {
    logForDebugging(
      `Skill ${resolvedName} has invalid effort '${effortRaw}'. Valid options: ${EFFORT_LEVELS.join(', ')} or an integer`,
    )
  }

  // Official 2.1.328: preserve `displayName` frontmatter field (falling back to `name`)
  const rawDisplayName =
    frontmatter.displayName != null
      ? String(frontmatter.displayName)
      : frontmatter.name != null
        ? String(frontmatter.name)
        : undefined
  let displayName: string | undefined = rawDisplayName
  if (rawDisplayName !== undefined && !isValidSkillName(rawDisplayName)) {
    recordNameNotShown(rawDisplayName, `is not shown for ${resolvedName}`)
    displayName = undefined
  }

  const fallback =
    frontmatter.fallback === undefined || frontmatter.fallback === null
      ? undefined
      : parseBooleanFrontmatter(frontmatter.fallback)

  return {
    displayName,
    description,
    hasUserSpecifiedDescription: validatedDescription !== null,
    allowedTools: parseSlashCommandToolsFromFrontmatter(
      frontmatter['allowed-tools'],
    ),
    disallowedTools: mergeDisallowedToolsFromFrontmatter(
      frontmatter,
      parseSlashCommandToolsFromFrontmatter,
    ),
    argumentHint:
      frontmatter['argument-hint'] != null
        ? String(frontmatter['argument-hint'])
        : undefined,
    argumentNames: parseArgumentNames(
      frontmatter.arguments as string | string[] | undefined,
    ),
    whenToUse: frontmatter.when_to_use as string | undefined,
    version: frontmatter.version as string | undefined,
    model,
    disableModelInvocation: parseBooleanFrontmatter(
      frontmatter['disable-model-invocation'],
    ),
    userInvocable,
    hooks: parseHooksFromFrontmatter(frontmatter, resolvedName),
    executionContext: frontmatter.context === 'fork' ? 'fork' : undefined,
    // densable 2.1.218 #34: context:fork runs background by default; opt out with background: false
    background:
      frontmatter.context === 'fork'
        ? frontmatter.background === undefined
          ? true
          : parseBooleanFrontmatter(frontmatter.background)
        : frontmatter.background === undefined
          ? undefined
          : parseBooleanFrontmatter(frontmatter.background),
    agent: frontmatter.agent as string | undefined,
    effort,
    shell: parseShellFrontmatter(frontmatter.shell, resolvedName),
    createdBy:
      frontmatter.created_by === 'dream-proposal' ||
      frontmatter.improved_by === 'dream-proposal'
        ? 'dream-proposal'
        : undefined,
    fallback,
    metadata: parseFrontmatterMetadata(frontmatter.metadata),
  }
}

/**
 * Creates a skill command from parsed data
 */
export function createSkillCommand({
  skillName,
  displayName,
  description,
  hasUserSpecifiedDescription,
  markdownContent,
  contentHash,
  allowedTools,
  disallowedTools,
  argumentHint,
  argumentNames,
  whenToUse,
  version,
  model,
  disableModelInvocation,
  userInvocable,
  source,
  baseDir,
  loadedFrom,
  hooks,
  executionContext,
  background,
  agent,
  paths,
  effort,
  shell,
  createdBy,
  fallback,
  metadata,
  skillFile,
}: {
  skillName: string
  displayName: string | undefined
  description: string
  hasUserSpecifiedDescription: boolean
  markdownContent: string
  /** densable contentHash (JoS fingerprint). Defaults to Bun.hash(markdown). */
  contentHash?: string
  allowedTools: string[]
  disallowedTools?: string[]
  argumentHint: string | undefined
  argumentNames: string[]
  whenToUse: string | undefined
  version: string | undefined
  model: string | undefined
  disableModelInvocation: boolean
  userInvocable: boolean
  source: PromptCommand['source']
  baseDir: string | undefined
  loadedFrom: LoadedFrom
  hooks: HooksSettings | undefined
  executionContext: 'inline' | 'fork' | undefined
  background: boolean | undefined
  agent: string | undefined
  paths: string[] | undefined
  effort: EffortValue | undefined
  shell: FrontmatterShell | undefined
  createdBy?: 'dream-proposal'
  fallback?: boolean
  metadata?: Record<string, unknown>
  skillFile?: PromptCommand['skillFile']
}): Command {
  // densable 2.1.228 #12 — $vr/$Phn label+sanitize for claude.ai synced skills;
  // bDo capability wipe when xTt says body is untrusted (syncedSkills on local
  // machine; mcp always). Lazy-require keeps the harden module out of cold paths
  // that never load synced skills.
  let finalDescription = description
  let finalWhenToUse = whenToUse
  let finalArgumentHint = argumentHint
  let finalAllowedTools = allowedTools
  let finalDisallowedTools: string[] | undefined =
    disallowedTools && disallowedTools.length > 0 ? disallowedTools : undefined
  let finalHooks = hooks
  let finalExecutionContext = executionContext
  let finalBackground = background
  let finalAgent = agent
  let finalModel = model
  let finalEffort = effort
  let finalShell = shell
  let finalPaths = paths
  let hardenBody = loadedFrom === 'mcp'
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const harden =
      require('./syncedSkillsHarden.js') as typeof import('./syncedSkillsHarden.js')
    if (loadedFrom === 'syncedSkills') {
      finalDescription = harden.sanitizeSyncedSkillDescription(description)
      if (whenToUse) {
        finalWhenToUse = harden.sanitizeSyncedSkillText(whenToUse)
      }
      if (argumentHint) {
        finalArgumentHint = harden.sanitizeSyncedSkillText(argumentHint)
      }
    }
    hardenBody = harden.shouldHardenSkillBody(loadedFrom)
    if (hardenBody) {
      const wiped = harden.emptyHardenedSkillCapabilities()
      finalAllowedTools = wiped.allowedTools
      finalDisallowedTools = wiped.disallowedTools
      finalHooks = wiped.hooks
      finalExecutionContext = wiped.executionContext
      finalBackground = wiped.background
      finalAgent = wiped.agent
      finalModel = wiped.model
      finalEffort = wiped.effort
      finalShell = wiped.shell
      finalPaths = wiped.paths
    }
  } catch {
    if (loadedFrom === 'syncedSkills') {
      hardenBody = true
      finalAllowedTools = []
      finalHooks = undefined
      finalExecutionContext = undefined
      finalBackground = undefined
      finalAgent = undefined
      finalModel = undefined
      finalEffort = undefined
      finalShell = undefined
      finalPaths = undefined
    }
  }

  // #1781: When CLAUDE_CODE_IGNORE_PERSISTED_TRUST is set (e.g. self-hosted
  // runner with `--trust-workspace false`), do not register frontmatter hooks
  // from workspace/project skills.
  if (
    finalHooks !== undefined &&
    isEnvTruthy(process.env.CLAUDE_CODE_IGNORE_PERSISTED_TRUST) &&
    (source === 'projectSettings' || source === 'localSettings')
  ) {
    logForDebugging(
      `[skills] Skipping frontmatter hooks for skill '${skillName}': CLAUDE_CODE_IGNORE_PERSISTED_TRUST is set`,
    )
    finalHooks = undefined
  }

  const command: Command = {
    type: 'prompt',
    name: skillName,
    description: finalDescription,
    hasUserSpecifiedDescription,
    allowedTools: finalAllowedTools,
    ...(finalDisallowedTools !== undefined
      ? { disallowedTools: finalDisallowedTools }
      : {}),
    argumentHint: finalArgumentHint,
    argNames: argumentNames.length > 0 ? argumentNames : undefined,
    whenToUse: finalWhenToUse,
    version,
    model: finalModel,
    disableModelInvocation,
    userInvocable,
    context: finalExecutionContext,
    ...(finalBackground !== undefined ? { background: finalBackground } : {}),
    agent: finalAgent,
    effort: finalEffort,
    paths: finalPaths,
    contentLength: markdownContent.length,
    // densable Xen: contentHash:i??Bun.hash(o).toString(36)
    contentHash: contentHash ?? Bun.hash(markdownContent).toString(36),
    isHidden: !userInvocable,
    progressMessage: 'running',
    userFacingName(): string {
      return displayName || skillName
    },
    source,
    loadedFrom,
    ...(createdBy !== undefined ? { createdBy } : {}),
    ...(skillFile !== undefined ? { skillFile } : {}),
    hooks: finalHooks,
    skillRoot: baseDir,
    ...(finalAllowedTools.length > 0
      ? {
          getAllowedTools: wrapSkillAllowedToolsGetter(
            { name: skillName, source, allowedTools: finalAllowedTools },
            finalAllowedTools,
          ),
        }
      : {}),
    async getPromptForCommand(args, toolUseContext) {
      if (loadedFrom === 'syncedSkills' && hasPendingSkillDownload(skillName)) {
        const outcome = await awaitPendingSkillDownload(
          skillName,
          toolUseContext.abortController?.signal,
        )
        if (!outcome.ok) {
          return [{ type: 'text', text: outcome.reason }]
        }
      }

      let finalContent = baseDir
        ? `Base directory for this skill: ${baseDir}\n\n${markdownContent}`
        : markdownContent

      finalContent = substituteArguments(
        finalContent,
        args,
        true,
        argumentNames,
      )

      // Replace ${CLAUDE_SKILL_DIR} with the skill's own directory so bash
      // injection (!`...`) can reference bundled scripts. Normalize backslashes
      // to forward slashes on Windows so shell commands don't treat them as escapes.
      // densable xTt: do not expand skill-dir paths for hardened remote sources.
      if (baseDir && !hardenBody) {
        const skillDir =
          process.platform === 'win32' ? baseDir.replace(/\\/g, '/') : baseDir
        finalContent = finalContent.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir)
      }

      try {
        // densable mIo.get() — expand only when bOn pinned the expander.
        const { leftoverDevModsExpanderSlot } = await import(
          '../utils/plugins/pluginDevMods.js'
        )
        const expand = leftoverDevModsExpanderSlot()
        if (expand !== undefined) {
          finalContent = await expand(finalContent, {
            isPreload: toolUseContext.options?.isSkillPreload === true,
          })
        }
      } catch {
        // densable wfr optional when plugin_dev_mods host is absent
      }

      // Replace ${CLAUDE_SESSION_ID} with the current session ID
      finalContent = finalContent.replace(
        /\$\{CLAUDE_SESSION_ID\}/g,
        getSessionId(),
      )

      // Security: MCP / densable 2.1.228 #12 syncedSkills (on the user's machine)
      // are untrusted — never execute inline shell (!`…` / ```! … ```).
      // densable xTt/Mzb: shell only when !xTt(loadedFrom).
      if (!hardenBody) {
        finalContent = await executeShellCommandsInPrompt(
          finalContent,
          {
            ...toolUseContext,
            getAppState() {
              const appState = toolUseContext.getAppState()
              return {
                ...appState,
                toolPermissionContext: {
                  ...appState.toolPermissionContext,
                  alwaysAllowRules: {
                    ...appState.toolPermissionContext.alwaysAllowRules,
                    command: finalAllowedTools,
                  },
                },
              }
            },
          },
          `/${skillName}`,
          finalShell,
        )
      } else {
        // densable: strip shell patterns rather than leaving raw !` in the prompt
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const gates =
            require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
          finalContent = gates.stripSkillShellCommands(finalContent)
        } catch {
          // leave content if gate module unavailable
        }
      }

      return [{ type: 'text', text: finalContent }]
    },
  } satisfies Command

  if (fallback !== undefined) {
    ;(command as Command & { fallback?: boolean }).fallback = fallback
  }
  if (metadata !== undefined) {
    ;(command as Command & { metadata?: Record<string, unknown> }).metadata =
      metadata
  }
  if (displayName !== undefined) {
    ;(command as Command & { displayName?: string }).displayName = displayName
  }
  return command
}

/**
 * Loads skills from a /skills/ directory path.
 * Only supports directory format: skill-name/SKILL.md
 */
async function loadSkillsFromSkillsDir(
  basePath: string,
  source: SettingSource,
  loadedFrom: 'skills' | 'syncedSkills' = 'skills',
  hostCatalogSkills?: ReadonlySet<string>,
): Promise<SkillWithPath[]> {
  if (await isConnectorDownloadsPath(basePath)) {
    logForDebugging(
      `[skills] Skipped skills dir in or beneath a connector-downloads folder: ${basePath}`,
    )
    return []
  }

  const fs = getFsImplementation()

  let entries
  try {
    entries = await fs.readdir(basePath)
  } catch (e: unknown) {
    if (!isFsInaccessible(e)) logError(e)
    return []
  }

  const results = await Promise.all(
    entries.map(async (entry): Promise<SkillWithPath | null> => {
      try {
        // Only support directory format: skill-name/SKILL.md
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          // Single .md files are NOT supported in /skills/ directory
          return null
        }

        if (
          hostCatalogSkills !== undefined &&
          !hostCatalogSkills.has(entry.name)
        ) {
          return null
        }

        const skillDirPath = join(basePath, entry.name)
        const skillFilePath = join(skillDirPath, 'SKILL.md')

        let content: string
        try {
          content = await fs.readFile(skillFilePath, { encoding: 'utf-8' })
        } catch (e: unknown) {
          // SKILL.md doesn't exist, skip this entry. Log non-ENOENT errors
          // (EACCES/EPERM/EIO) so permission/IO problems are diagnosable.
          if (!isENOENT(e)) {
            logForDebugging(`[skills] failed to read ${skillFilePath}: ${e}`, {
              level: 'warn',
            })
          }
          return null
        }

        const {
          frontmatter,
          frontmatterAsWritten,
          asWrittenProblem,
          content: markdownContent,
        } = parseFrontmatter(content, skillFilePath)

        const skillName = entry.name
        if (!isValidSkillName(skillName)) {
          recordNameNotShown(skillName, 'is not offered')
          return null
        }
        const parsed = parseSkillFrontmatterFields(
          frontmatter,
          markdownContent,
          skillName,
        )
        const paths = parseSkillPaths(frontmatter)

        const skill = createSkillCommand({
          ...parsed,
          skillName,
          markdownContent,
          // densable disk load: contentHash:Bun.hash(p).toString(36) on full file
          contentHash: Bun.hash(content).toString(36),
          source,
          baseDir: skillDirPath,
          loadedFrom,
          paths,
          skillFile: buildSkillFile(
            frontmatterAsWritten,
            skillFilePath,
            asWrittenProblem,
          ),
        })
        if (hostCatalogSkills !== undefined && skill.type === 'prompt') {
          ;(skill as Command & { fromHostCatalog?: boolean }).fromHostCatalog =
            true
        }
        return {
          skill,
          filePath: skillFilePath,
        }
      } catch (error) {
        logError(error)
        return null
      }
    }),
  )

  const loaded = results.filter((r): r is SkillWithPath => r !== null)
  if (loadedFrom === 'syncedSkills') {
    const nextRoots = new Set<string>()
    for (const item of loaded) {
      if (item.skill.type === 'prompt' && item.skill.skillRoot) {
        nextRoots.add(item.skill.skillRoot)
      }
    }
    const prevRoots = lastLoadedSyncedSkillRootsByDir.get(basePath)
    if (prevRoots && prevRoots.size > 0) {
      const removed = new Set<string>()
      for (const root of prevRoots) {
        if (!nextRoots.has(root)) removed.add(root)
      }
      if (removed.size > 0) {
        pruneRemovedSyncedSkillHooks(
          removed,
          'skill_gone',
          activeSyncedSkillHooksPruner,
        )
      }
    }
    lastLoadedSyncedSkillRootsByDir.set(basePath, nextRoots)
  }
  return loaded
}

// --- Legacy /commands/ loader ---

function isSkillFile(filePath: string): boolean {
  return /^skill\.md$/i.test(basename(filePath))
}

/**
 * Transforms markdown files to handle "skill" commands in legacy /commands/ folder.
 * When a SKILL.md file exists in a directory, only that file is loaded
 * and it takes the name of its parent directory.
 */
function transformSkillFiles(files: MarkdownFile[]): MarkdownFile[] {
  const filesByDir = new Map<string, MarkdownFile[]>()

  for (const file of files) {
    const dir = dirname(file.filePath)
    const dirFiles = filesByDir.get(dir) ?? []
    dirFiles.push(file)
    filesByDir.set(dir, dirFiles)
  }

  const result: MarkdownFile[] = []

  for (const [dir, dirFiles] of filesByDir) {
    const skillFiles = dirFiles.filter(f => isSkillFile(f.filePath))
    if (skillFiles.length > 0) {
      const skillFile = skillFiles[0]!
      if (skillFiles.length > 1) {
        logForDebugging(
          `Multiple skill files found in ${dir}, using ${basename(skillFile.filePath)}`,
        )
      }
      result.push(skillFile)
    } else {
      result.push(...dirFiles)
    }
  }

  return result
}

function buildNamespace(targetDir: string, baseDir: string): string {
  const normalizedBaseDir = baseDir.endsWith(pathSep)
    ? baseDir.slice(0, -1)
    : baseDir

  if (targetDir === normalizedBaseDir) {
    return ''
  }

  const relativePath = targetDir.slice(normalizedBaseDir.length + 1)
  return relativePath ? relativePath.split(pathSep).join(':') : ''
}

function getSkillCommandName(filePath: string, baseDir: string): string {
  const skillDirectory = dirname(filePath)
  const parentOfSkillDir = dirname(skillDirectory)
  const commandBaseName = basename(skillDirectory)

  const namespace = buildNamespace(parentOfSkillDir, baseDir)
  return namespace ? `${namespace}:${commandBaseName}` : commandBaseName
}

function getRegularCommandName(filePath: string, baseDir: string): string {
  const fileName = basename(filePath)
  const fileDirectory = dirname(filePath)
  const commandBaseName = fileName.replace(/\.md$/, '')

  const namespace = buildNamespace(fileDirectory, baseDir)
  return namespace ? `${namespace}:${commandBaseName}` : commandBaseName
}

function getCommandName(file: MarkdownFile): string {
  const isSkill = isSkillFile(file.filePath)
  return isSkill
    ? getSkillCommandName(file.filePath, file.baseDir)
    : getRegularCommandName(file.filePath, file.baseDir)
}

/**
 * Loads skills from legacy /commands/ directories.
 * Supports both directory format (SKILL.md) and single .md file format.
 * Commands from /commands/ default to user-invocable: true
 */
async function loadSkillsFromCommandsDir(
  cwd: string,
): Promise<SkillWithPath[]> {
  try {
    const markdownFiles = await loadMarkdownFilesForSubdir('commands', cwd)
    const processedFiles = transformSkillFiles(markdownFiles)

    const skills: SkillWithPath[] = []

    for (const {
      baseDir,
      filePath,
      frontmatter,
      content,
      source,
    } of processedFiles) {
      try {
        const isSkillFormat = isSkillFile(filePath)
        const skillDirectory = isSkillFormat ? dirname(filePath) : undefined
        const cmdName = getCommandName({
          baseDir,
          filePath,
          frontmatter,
          content,
          source,
        })

        const parsed = parseSkillFrontmatterFields(
          frontmatter,
          content,
          cmdName,
          'Custom command',
        )

        if (!isValidSkillName(cmdName)) {
          recordNameNotShown(cmdName, 'is not offered')
          continue
        }

        skills.push({
          skill: createSkillCommand({
            ...parsed,
            skillName: cmdName,
            displayName: undefined,
            markdownContent: content,
            source,
            baseDir: skillDirectory,
            loadedFrom: 'commands_DEPRECATED',
            paths: undefined,
            skillFile: buildSkillFile(frontmatter, filePath),
          }),
          filePath,
        })
      } catch (error) {
        logError(error)
      }
    }

    return skills
  } catch (error) {
    logError(error)
    return []
  }
}

/**
 * Loads all skills from both /skills/ and legacy /commands/ directories.
 *
 * Skills from /skills/ directories:
 * - Only support directory format: skill-name/SKILL.md
 * - Default to user-invocable: true (can opt-out with user-invocable: false)
 *
 * Skills from legacy /commands/ directories:
 * - Support both directory format (SKILL.md) and single .md file format
 * - Default to user-invocable: true (user can type /cmd)
 *
 * @param cwd Current working directory for project directory traversal
 */
export const getSkillDirCommands = memoize(
  async (cwd: string): Promise<Command[]> => {
    const userSkillsDir = join(getClaudeConfigHomeDir(), 'skills')
    const managedSkillsDir = join(getManagedFilePath(), '.claude', 'skills')
    const extensionRoot = getCurrentWorktreeSession()?.extensionRoot
    const hasDistinctExtensionRoot =
      extensionRoot !== undefined && resolve(extensionRoot) !== resolve(cwd)
    const rawProjectSkillsDirs = hasDistinctExtensionRoot
      ? [
          ...getProjectDirsUpToHome('skills', cwd),
          ...getProjectDirsUpToHome('skills', extensionRoot),
        ]
      : getProjectDirsUpToHome('skills', cwd)
    const seenProjectDirs = new Set<string>()
    const dedupedProjectSkillsDirs: string[] = []
    for (const dir of rawProjectSkillsDirs) {
      const normalized = resolve(dir)
      if (!seenProjectDirs.has(normalized)) {
        seenProjectDirs.add(normalized)
        dedupedProjectSkillsDirs.push(dir)
      }
    }

    // Official 2.1.328 `_Hs` (`chunk@294254613.js@3898200`): skip project skill
    // dirs and added folders located in or beneath a connector-downloads dir.
    const projectConnectorFlags = await Promise.all(
      dedupedProjectSkillsDirs.map(dir => isConnectorDownloadsPath(dir)),
    )
    const projectSkillsDirs = dedupedProjectSkillsDirs.filter(
      (_dir, idx) => !projectConnectorFlags[idx],
    )

    logForDebugging(
      `Loading skills from: managed=${managedSkillsDir}, user=${userSkillsDir}, project=[${projectSkillsDirs.join(', ')}]`,
    )

    // Load from additional directories (--add-dir)
    const rawAdditionalDirs = getAdditionalDirectoriesForClaudeMd()
    const additionalConnectorFlags = await Promise.all(
      rawAdditionalDirs.map(async dir => {
        for (const candidate of [
          dir,
          join(dir, '.claude'),
          join(dir, '.claude', 'skills'),
          join(dir, '.claude', 'commands'),
        ]) {
          if (await isConnectorDownloadsPath(candidate)) {
            return true
          }
        }
        return false
      }),
    )
    const additionalDirs = rawAdditionalDirs.filter((dir, idx) => {
      if (additionalConnectorFlags[idx]) {
        logForDebugging(
          `[skills] Skipped added folder in or beneath a connector-downloads folder: ${dir}`,
        )
        return false
      }
      return true
    })
    const skillsLocked = isRestrictedToPluginOnly('skills')
    const projectSettingsEnabled =
      isSettingSourceEnabled('projectSettings') && !skillsLocked

    // --bare: skip auto-discovery (managed/user/project dir walks + legacy
    // commands-dir). Load ONLY explicit --add-dir paths. Bundled skills
    // register separately. skillsLocked still applies — --bare is not a
    // policy bypass.
    if (isBareMode()) {
      if (additionalDirs.length === 0 || !projectSettingsEnabled) {
        logForDebugging(
          `[bare] Skipping skill dir discovery (${additionalDirs.length === 0 ? 'no --add-dir' : 'projectSettings disabled or skillsLocked'})`,
        )
        return []
      }
      const additionalSkillsNested = await Promise.all(
        additionalDirs.map(dir =>
          loadSkillsFromSkillsDir(
            join(dir, '.claude', 'skills'),
            'projectSettings',
          ),
        ),
      )
      // No dedup needed — explicit dirs, user controls uniqueness.
      return additionalSkillsNested.flat().map(s => s.skill)
    }

    // Load from /skills/ directories, additional dirs, and legacy /commands/ in parallel
    // (all independent — different directories, no shared state)
    const hostCatalog =
      isSettingSourceEnabled('userSettings') && !skillsLocked
        ? parseHostSkillCatalog()
        : null

    const [
      managedSkills,
      userSkills,
      hostCatalogSkills,
      projectSkillsNested,
      additionalSkillsNested,
      legacyCommands,
      extensionRootLegacyCommands,
    ] = await Promise.all([
      (() => {
        try {
          const { isPolicySkillsDisabled } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
          return isPolicySkillsDisabled()
        } catch {
          return isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_POLICY_SKILLS)
        }
      })()
        ? Promise.resolve([])
        : loadSkillsFromSkillsDir(managedSkillsDir, 'policySettings'),
      isSettingSourceEnabled('userSettings') && !skillsLocked
        ? loadSkillsFromSkillsDir(userSkillsDir, 'userSettings')
        : Promise.resolve([]),
      hostCatalog !== null
        ? loadHostCatalogSkills(hostCatalog)
        : Promise.resolve([]),
      projectSettingsEnabled
        ? Promise.all(
            projectSkillsDirs.map(dir =>
              loadSkillsFromSkillsDir(dir, 'projectSettings'),
            ),
          )
        : Promise.resolve([]),
      projectSettingsEnabled
        ? Promise.all(
            additionalDirs.map(dir =>
              loadSkillsFromSkillsDir(
                join(dir, '.claude', 'skills'),
                'projectSettings',
              ),
            ),
          )
        : Promise.resolve([]),
      // Legacy commands-as-skills goes through markdownConfigLoader with
      // subdir='commands', which our agents-only guard there skips. Block
      // here when skills are locked — these ARE skills, regardless of the
      // directory they load from.
      skillsLocked ? Promise.resolve([]) : loadSkillsFromCommandsDir(cwd),
      !skillsLocked && hasDistinctExtensionRoot
        ? loadSkillsFromCommandsDir(extensionRoot)
        : Promise.resolve([]),
    ])

    // Flatten and combine all skills
    const allSkillsWithPaths = [
      ...managedSkills,
      ...userSkills,
      ...projectSkillsNested.flat(),
      ...additionalSkillsNested.flat(),
      ...legacyCommands,
      ...extensionRootLegacyCommands,
      ...getInMemorySyncedSkills().map(skill => ({
        skill,
        filePath: '',
      })),
    ]

    // Deduplicate by resolved path (handles symlinks and duplicate parent directories)
    // Pre-compute file identities in parallel (realpath calls are independent),
    // then dedup synchronously (order-dependent first-wins)
    const fileIds = await Promise.all(
      allSkillsWithPaths.map(({ skill, filePath }) =>
        skill.type === 'prompt'
          ? getFileIdentity(filePath)
          : Promise.resolve(null),
      ),
    )

    const seenFileIds = new Map<string, string>()
    const deduplicatedSkills: Command[] = []

    for (let i = 0; i < allSkillsWithPaths.length; i++) {
      const entry = allSkillsWithPaths[i]
      if (entry === undefined || entry.skill.type !== 'prompt') continue
      const { skill } = entry

      const fileId = fileIds[i]
      if (fileId === null || fileId === undefined) {
        deduplicatedSkills.push(skill)
        continue
      }

      const existingSource = seenFileIds.get(fileId)
      if (existingSource !== undefined) {
        logForDebugging(
          `Skipping duplicate skill '${skill.name}' from ${skill.source} (same file already loaded from ${existingSource})`,
        )
        continue
      }

      seenFileIds.set(fileId, skill.source)
      deduplicatedSkills.push(skill)
    }

    const duplicatesRemoved =
      allSkillsWithPaths.length - deduplicatedSkills.length
    if (duplicatesRemoved > 0) {
      logForDebugging(`Deduplicated ${duplicatesRemoved} skills (same file)`)
    }

    if (hostCatalogSkills.length > 0) {
      const hostFileIds = await Promise.all(
        hostCatalogSkills.map(({ filePath }) => getFileIdentity(filePath)),
      )
      for (let i = 0; i < hostCatalogSkills.length; i++) {
        const entry = hostCatalogSkills[i]
        if (!entry) continue
        const fileId = hostFileIds[i]
        if (fileId && seenFileIds.has(fileId)) {
          logForDebugging(
            `Skipping host catalog skill '${entry.skill.name}': another skills folder links to the same file`,
          )
          continue
        }
        deduplicatedSkills.push(entry.skill)
      }
    }

    // Separate conditional skills (with paths frontmatter) from unconditional ones
    const unconditionalSkills: Command[] = []
    const newConditionalSkills: Command[] = []
    for (const skill of deduplicatedSkills) {
      const isConditional =
        skill.type === 'prompt' && !!skill.paths && skill.paths.length > 0
      // densable iXe update-existing: `if (P) { x=Q3e(R); if (has(x)) set(x,R) }`
      if (isConditional) {
        const x = skillMapKey(skill)
        if (dynamicSkills.has(x)) {
          dynamicSkills.set(x, skill)
        }
      }
      if (isConditional && !activatedConditionalSkillNames.has(skill.name)) {
        newConditionalSkills.push(skill)
      } else {
        unconditionalSkills.push(skill)
      }
    }

    // Store conditional skills for later activation when matching files are touched
    for (const skill of newConditionalSkills) {
      conditionalSkills.set(skill.name, skill)
    }

    if (newConditionalSkills.length > 0) {
      logForDebugging(
        `[skills] ${newConditionalSkills.length} conditional skills stored (activated when matching files are touched)`,
      )
    }

    logForDebugging(
      `Loaded ${deduplicatedSkills.length} unique skills (${unconditionalSkills.length} unconditional, ${newConditionalSkills.length} conditional, managed: ${managedSkills.length}, user: ${userSkills.length}, project: ${projectSkillsNested.flat().length}, additional: ${additionalSkillsNested.flat().length}, legacy commands: ${legacyCommands.length})`,
    )

    return unconditionalSkills
  },
  (cwd: string) =>
    `${cwd}\0${getCurrentWorktreeSession()?.extensionRoot ?? ''}`,
)

export const HOST_SKILL_CATALOG_DIR = '/mnt/skills/public'
const HOST_SKILL_CATALOG_MAX = 64
const HOST_SKILL_FOLDER_RE = /^[A-Za-z0-9._-]+$/

export type HostSkillCatalog = {
  dir: string
  skills: Set<string>
}

/**
 * SEA `$Ht` — parse `CLAUDE_CODE_HOST_SKILL_CATALOG` JSON `{"skills": [...]}`.
 */
export function parseHostSkillCatalog(
  raw: string | undefined = process.env.CLAUDE_CODE_HOST_SKILL_CATALOG,
): HostSkillCatalog | null {
  if (raw === undefined) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      !Array.isArray((parsed as { skills?: unknown }).skills)
    ) {
      logForDebugging(
        'Ignoring CLAUDE_CODE_HOST_SKILL_CATALOG: expected {"skills": 1 to 64 folder names of ASCII letters, digits, ".", "_" or "-", other than "." and ".."}',
        { level: 'warn' },
      )
      return null
    }
    const skills = (parsed as { skills: unknown[] }).skills
    if (skills.length < 1 || skills.length > HOST_SKILL_CATALOG_MAX) {
      logForDebugging(
        'Ignoring CLAUDE_CODE_HOST_SKILL_CATALOG: expected {"skills": 1 to 64 folder names of ASCII letters, digits, ".", "_" or "-", other than "." and ".."}',
        { level: 'warn' },
      )
      return null
    }
    const valid: string[] = []
    for (const s of skills) {
      if (
        typeof s !== 'string' ||
        s.length > 255 ||
        s === '.' ||
        s === '..' ||
        !HOST_SKILL_FOLDER_RE.test(s)
      ) {
        logForDebugging(
          'Ignoring CLAUDE_CODE_HOST_SKILL_CATALOG: expected {"skills": 1 to 64 folder names of ASCII letters, digits, ".", "_" or "-", other than "." and ".."}',
          { level: 'warn' },
        )
        return null
      }
      valid.push(s)
    }
    return { dir: HOST_SKILL_CATALOG_DIR, skills: new Set(valid) }
  } catch {
    logForDebugging(
      'Ignoring CLAUDE_CODE_HOST_SKILL_CATALOG: expected {"skills": 1 to 64 folder names of ASCII letters, digits, ".", "_" or "-", other than "." and ".."}',
      { level: 'warn' },
    )
    return null
  }
}

/**
 * SEA `kus` — load Cowork / claude.ai Directory plugin skills named in host catalog.
 */
export async function loadHostCatalogSkills(
  catalog: HostSkillCatalog,
): Promise<SkillWithPath[]> {
  return loadSkillsFromSkillsDir(
    catalog.dir,
    'userSettings',
    'syncedSkills',
    catalog.skills,
  )
}

/**
 * SEA `tNe` / `p5r` — return the folder prefix for a skill outside `cwd` (e.g. `--add-dir`),
 * or `null` for skills directly under `cwd` or non-directory skills.
 */
export function getAddDirSkillPrefix(
  cmd: Pick<Command, 'type'> & { skillRoot?: string },
  cwd: string,
): string | null {
  if (cmd.type !== 'prompt' || !cmd.skillRoot) return null
  const marker = `${pathSep}.claude${pathSep}`
  const idx = cmd.skillRoot.lastIndexOf(marker)
  if (idx === -1) return null
  const baseDir = cmd.skillRoot.slice(0, idx)
  const rel = relative(cwd, baseDir)
  if (rel === '') return null
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return basename(baseDir)
  }
  return rel.split(pathSep).join('/')
}

/**
 * SEA `h5r` / `m5r` — when a skill in `--add-dir` (or nested dir) collides with an existing
 * command/skill name, offer it as `<folder>:<name>` instead of dropping or shadowing it.
 */
export function disambiguateAddDirSkills(
  commands: Command[],
  cwd: string = getOriginalCwd(),
): Command[] {
  const nameCounts = new Map<string, number>()
  for (const cmd of commands) {
    nameCounts.set(cmd.name, (nameCounts.get(cmd.name) ?? 0) + 1)
    for (const alias of cmd.aliases ?? []) {
      nameCounts.set(alias, (nameCounts.get(alias) ?? 0) + 1)
    }
  }

  const seenNames = new Set<string>()
  const out: Command[] = []
  for (const cmd of commands) {
    const prefix = getAddDirSkillPrefix(cmd, cwd)
    const collides =
      seenNames.has(cmd.name) || (nameCounts.get(cmd.name) ?? 0) > 1
    if (
      cmd.type === 'prompt' &&
      prefix !== null &&
      collides &&
      cmd.loadedFrom !== 'syncedSkills'
    ) {
      const qualifiedName = `${prefix}:${cmd.name}`
      if (!seenNames.has(qualifiedName)) {
        seenNames.add(qualifiedName)
        const isShadowed = seenNames.has(cmd.name)
        const hint = isShadowed
          ? `scoped to ${prefix}/ — use this instead of the unscoped "${cmd.name}" skill when the files being changed are under ${prefix}/`
          : `from ${prefix}/.claude/skills — applies when working on files under ${prefix}/`
        out.push({
          ...cmd,
          name: qualifiedName,
          unqualifiedName: cmd.name,
          aliases: undefined,
          userFacingName: () => qualifiedName,
          description: `${cmd.description} (${hint})`,
        } as Command)
        continue
      }
    }
    seenNames.add(cmd.name)
    out.push(cmd)
  }
  return out
}

export function clearSkillCaches() {
  getSkillDirCommands.cache?.clear?.()
  loadMarkdownFilesForSubdir.cache?.clear?.()
  conditionalSkills.clear()
  activatedConditionalSkillNames.clear()
  clearInMemorySyncedSkills()
  clearSyncedSkillLandingFailures()
}

// Official 2.1.325 #2332: invalidate cached skills when managed
// strictPluginOnlyCustomization changes mid-session.
registerStrictPluginOnlyChangeCallback(() => {
  clearSkillCaches()
  clearDynamicSkills()
})

// Backwards-compatible aliases for tests
export { getSkillDirCommands as getCommandDirCommands }
export { clearSkillCaches as clearCommandCaches }
export { transformSkillFiles }

// --- Dynamic skill discovery ---

// State for dynamically discovered skills
const dynamicSkillDirs = new Set<string>()
const deferredSkillDirs = new Map<string, string>()
const dynamicSkills = new Map<string, Command>()

// #1812 (2.1.319): Withhold nested `.claude/skills` discovery for the rest of
// the session once the Bash sandbox has been enabled (gated on
// `tengu_iridescent_feather`).
const IRIDESCENT_FEATHER_FLAG = 'tengu_iridescent_feather'
let nestedDiscoveryWithheld = false

/**
 * #1812: Returns true when nested `.claude/skills` discovery has been latched
 * as withheld in this session because Bash sandboxing was enabled.
 */
export function isNestedSkillDiscoveryWithheld(): boolean {
  return (
    nestedDiscoveryWithheld &&
    getFeatureValue_CACHED_MAY_BE_STALE(IRIDESCENT_FEATHER_FLAG, true)
  )
}

/**
 * #1812: Checks whether nested `.claude/skills` auto-loading should be
 * suppressed. Latches `nestedDiscoveryWithheld = true` for the session once
 * `SandboxManager.isSandboxingEnabled()` is observed true, so turning the
 * sandbox off mid-session still cannot load skills written while sandboxed.
 */
export function shouldWithholdNestedSkillDiscovery(): boolean {
  if (
    !(nestedDiscoveryWithheld || SandboxManager.isSandboxingEnabled()) ||
    !getFeatureValue_CACHED_MAY_BE_STALE(IRIDESCENT_FEATHER_FLAG, true)
  ) {
    return false
  }
  if (!nestedDiscoveryWithheld) {
    nestedDiscoveryWithheld = true
    logForDebugging(
      '[skills] Skills in .claude/skills folders below the folder Claude Code started in or was moved to with /cd will not load until Claude Code restarts, even if the Bash sandbox is turned off, because sandboxed commands can write to those folders. To use such a skill, start Claude Code in its folder or /cd there.',
    )
  }
  return true
}

/** Test-only reset for `#1812` latched nested-discovery state. */
export function resetNestedDiscoveryWithheldForTesting(): void {
  nestedDiscoveryWithheld = false
}

function foldPathForPrefixMatch(p: string): string {
  const normalized = resolve(p)
  const folded =
    process.platform === 'win32' || process.platform === 'darwin'
      ? normalized.toLowerCase()
      : normalized
  return folded.endsWith(pathSep) ? folded : folded + pathSep
}

/**
 * #1942 (2.1.321) + Official 2.1.325 #2363: Build normalized prefixes for
 * `~/.claude/plugins`, synced plugin dirs, AND `--plugin-dir` directories
 * (both raw and realpath) so nested `.claude/skills` discovery never walks
 * into or loads skills from installed/cached or `--plugin-dir` plugin trees
 * when a session is started above them.
 */
export async function getPluginOwnedPrefixes(
  extraPluginDirs?: readonly string[],
): Promise<string[]> {
  const configHome = getClaudeConfigHomeDir()
  const rawPluginsDir = join(configHome, 'plugins')
  const prefixes = new Set<string>([foldPathForPrefixMatch(rawPluginsDir)])
  const addPrefixWithRealpath = async (dir: string): Promise<void> => {
    const resolved = resolve(dir)
    prefixes.add(foldPathForPrefixMatch(resolved))
    try {
      const real = await realpath(resolved)
      prefixes.add(foldPathForPrefixMatch(real))
    } catch {
      // dir may not exist yet
    }
  }
  try {
    const resolvedConfigHome = await realpath(configHome)
    prefixes.add(foldPathForPrefixMatch(join(resolvedConfigHome, 'plugins')))
  } catch {
    // config dir may not exist yet
  }
  try {
    const resolvedPlugins = await realpath(rawPluginsDir)
    prefixes.add(foldPathForPrefixMatch(resolvedPlugins))
  } catch {
    // plugins dir may not exist yet
  }
  // Official 2.1.325 #2363: exclude `--plugin-dir` folders from nested
  // `.claude/skills` discovery when started above them.
  const pluginDirs = [
    ...getInlinePlugins(),
    ...getInlinePluginsNoMcp(),
    ...getSyncedPluginDirs(),
    ...(extraPluginDirs ?? []),
  ]
  for (const dir of pluginDirs) {
    if (typeof dir === 'string' && dir.length > 0) {
      await addPrefixWithRealpath(dir)
    }
  }
  return [...prefixes]
}

function isUnderPrefixes(dirPath: string, prefixes: string[]): boolean {
  const folded = foldPathForPrefixMatch(dirPath)
  return prefixes.some(prefix => folded.startsWith(prefix))
}

// --- Conditional skills (path-filtered) ---

// Skills with paths frontmatter that haven't been activated yet
const conditionalSkills = new Map<string, Command>()
// Names of skills that have been activated (survives cache clears within a session)
const activatedConditionalSkillNames = new Set<string>()

// Signal fired when dynamic skills are loaded
const skillsLoaded = createSignal()

/**
 * Register a callback to be invoked when dynamic skills are loaded.
 * Used by other modules to clear caches without creating import cycles.
 * Returns an unsubscribe function.
 */
export function onDynamicSkillsLoaded(callback: () => void): () => void {
  // Wrap at subscribe time so a throwing listener is logged and skipped
  // rather than aborting skillsLoaded.emit() and breaking skill loading.
  // Same callSafe pattern as growthbook.ts — createSignal.emit() has no
  // per-listener try/catch.
  return skillsLoaded.subscribe(() => {
    try {
      callback()
    } catch (error) {
      logError(error)
    }
  })
}

/**
 * Discovers skill directories by walking up from file paths to cwd.
 * Only discovers directories below cwd (cwd-level skills are loaded at startup).
 *
 * @param filePaths Array of file paths to check
 * @param cwd Current working directory (upper bound for discovery)
 * @returns Array of newly discovered skill directories, sorted deepest first
 */
/**
 * Gold `B5n(e, n, r)` (#1319): verify `dir` is in the same git `workTree` and
 * return `git check-ignore` exit code (1 = not ignored, 0 = ignored,
 * 128/undefined = unconfirmed).
 */
async function checkGitIgnoreInWorkTree(
  dir: string,
  workTree: string,
  cwd: string,
): Promise<number | undefined> {
  const { findGitRoot } = await import('../utils/git.js')
  if (findGitRoot(dir) !== workTree) {
    return undefined
  }
  const { execFileNoThrowWithCwd } = await import('../utils/execFileNoThrow.js')
  const { code } = await execFileNoThrowWithCwd(
    'git',
    ['check-ignore', '--', dir],
    {
      preserveOutputOnError: false,
      cwd,
    },
  )
  return code
}

export async function discoverSkillDirsForPaths(
  filePaths: string[],
  cwd: string,
  trustedCwdInfo?: { cwd: string; workTree: string },
): Promise<string[]> {
  // #1812: Suppress nested `.claude/skills` auto-loading when Bash sandbox is on.
  if (shouldWithholdNestedSkillDiscovery()) {
    return []
  }

  const fs = getFsImplementation()
  const resolvedCwd = cwd.endsWith(pathSep) ? cwd.slice(0, -1) : cwd
  const newDirs: string[] = []
  // #1942: Exclude `~/.claude/plugins` from nested `.claude/skills` discovery.
  const pluginOwnedPrefixes = await getPluginOwnedPrefixes()

  for (const filePath of filePaths) {
    // Start from the file's parent directory
    let currentDir = dirname(filePath)

    if (
      isUnderPrefixes(currentDir, pluginOwnedPrefixes) ||
      (await isConnectorDownloadsPath(currentDir))
    ) {
      logForDebugging(
        '[skills] Skipped the nested skills search for a file in a sync-owned, plugin, or connector-downloads folder',
      )
      continue
    }

    // Walk up to cwd but NOT including cwd itself
    // CWD-level skills are already loaded at startup, so we only discover nested ones
    // Use prefix+separator check to avoid matching /project-backup when cwd is /project
    while (currentDir.startsWith(resolvedCwd + pathSep)) {
      if (isUnderPrefixes(currentDir, pluginOwnedPrefixes)) {
        const parent = dirname(currentDir)
        if (parent === currentDir) break
        currentDir = parent
        continue
      }

      const skillDir = join(currentDir, '.claude', 'skills')
      const deferredAt = deferredSkillDirs.get(skillDir)
      if (deferredAt !== undefined && deferredAt !== resolvedCwd) {
        deferredSkillDirs.delete(skillDir)
        dynamicSkillDirs.delete(skillDir)
      }

      // Skip if we've already checked this path (hit or miss) — avoids
      // repeating the same failed stat on every Read/Write/Edit call when
      // the directory doesn't exist (the common case).
      if (!dynamicSkillDirs.has(skillDir)) {
        dynamicSkillDirs.add(skillDir)
        try {
          await fs.stat(skillDir)
          // #1942: Also verify the resolved symlink target isn't inside ~/.claude/plugins
          let resolvedSkillDir: string | undefined
          try {
            resolvedSkillDir = await realpath(skillDir)
          } catch {
            // Keep raw path if realpath fails
          }
          if (
            isUnderPrefixes(resolvedSkillDir ?? skillDir, pluginOwnedPrefixes)
          ) {
            logForDebugging(
              `[skills] Skipped sync-owned skills dir (resolved): ${skillDir}`,
            )
            continue
          }
          // Skills dir exists. Before loading, check if the containing dir
          // is gitignored — blocks e.g. node_modules/pkg/.claude/skills from
          // loading silently.
          const isWithinTrustedCwd =
            trustedCwdInfo === undefined ||
            currentDir.startsWith(trustedCwdInfo.cwd + pathSep)
          if (!isWithinTrustedCwd) {
            const exitCode = await checkGitIgnoreInWorkTree(
              currentDir,
              trustedCwdInfo.workTree,
              resolvedCwd,
            )
            if (exitCode !== 1) {
              if (exitCode !== 0) {
                deferredSkillDirs.set(skillDir, resolvedCwd)
              }
              logForDebugging(
                `[skills] Skipped gitignored or unconfirmed skills dir: ${skillDir}`,
              )
              continue
            }
          } else if (
            await isPathGitignored(
              currentDir,
              trustedCwdInfo?.cwd ?? resolvedCwd,
            )
          ) {
            logForDebugging(
              `[skills] Skipped gitignored skills dir: ${skillDir}`,
            )
            continue
          }
          newDirs.push(skillDir)
        } catch {
          // Directory doesn't exist — already recorded above, continue
        }
      }

      // Move to parent
      const parent = dirname(currentDir)
      if (parent === currentDir) break // Reached root
      currentDir = parent
    }
  }

  // Sort by path depth (deepest first) so skills closer to the file take precedence
  return newDirs.sort(
    (a, b) => b.split(pathSep).length - a.split(pathSep).length,
  )
}

/**
 * densable `Q3e` — dynamic-skill map key.
 * `${type==="prompt" ? skillRoot ?? "" : ""}\0${name}`
 */
export function skillMapKey(skill: Command): string {
  return `${skill.type === 'prompt' ? (skill.skillRoot ?? '') : ''}\0${skill.name}`
}

/**
 * densable iXe/`Q3e` replace: a dynamic skill belongs to the scanned dirs
 * when its skillRoot is the dir or a descendant (`relative` empty / not `..`
 * / not absolute).
 */
function skillBelongsToSkillDirs(skill: Command, dirs: string[]): boolean {
  const skillRoot = skill.type === 'prompt' ? (skill.skillRoot ?? '') : ''
  return dirs.some(dir => {
    const rel = relative(dir, skillRoot)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

/**
 * Loads skills from the given directories and merges them into the dynamic skills map.
 * Skills from directories closer to the file (deeper paths) take precedence.
 *
 * @param dirs Array of skill directories to load from (should be sorted deepest first)
 * @param opts.replace densable iXe `{replace:true}` — drop skills that belong
 *   to these dirs but are no longer on disk. `/cd` `ft` does not pass this.
 */
export async function addSkillDirectories(
  dirs: string[],
  opts: { replace?: boolean } = {},
): Promise<void> {
  if (
    !isSettingSourceEnabled('projectSettings') ||
    isRestrictedToPluginOnly('skills')
  ) {
    logForDebugging(
      '[skills] Dynamic skill discovery skipped: projectSettings disabled or plugin-only policy',
    )
    return
  }
  if (dirs.length === 0) {
    return
  }

  const previousSkillNamesForLogging = new Set(dynamicSkills.keys())

  // Load skills from all directories
  const loadedSkills = await Promise.all(
    dirs.map(dir => loadSkillsFromSkillsDir(dir, 'projectSettings')),
  )

  if (opts.replace) {
    const incoming = new Set(
      loadedSkills.flat().map(({ skill }) => skillMapKey(skill)),
    )
    for (const [key, skill] of dynamicSkills) {
      if (skillBelongsToSkillDirs(skill, dirs) && !incoming.has(key)) {
        dynamicSkills.delete(key)
      }
    }
  }

  // Process in reverse order (shallower first) so deeper paths override
  for (let i = loadedSkills.length - 1; i >= 0; i--) {
    for (const { skill } of loadedSkills[i] ?? []) {
      if (skill.type === 'prompt') {
        dynamicSkills.set(skillMapKey(skill), skill)
      }
    }
  }

  const newSkillCount = loadedSkills.flat().length
  if (newSkillCount > 0) {
    const addedSkills = [...dynamicSkills.keys()].filter(
      n => !previousSkillNamesForLogging.has(n),
    )
    logForDebugging(
      `[skills] Dynamically discovered ${newSkillCount} skills from ${dirs.length} directories`,
    )
    if (addedSkills.length > 0) {
      logEvent('tengu_dynamic_skills_changed', {
        source:
          'file_operation' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        previousCount: previousSkillNamesForLogging.size,
        newCount: dynamicSkills.size,
        addedCount: addedSkills.length,
        directoryCount: dirs.length,
      })
    }
  }

  // Notify listeners that skills were loaded (so they can clear caches)
  skillsLoaded.emit()
}

/**
 * densable hZc/`gJa` — after cwd has moved, re-read the new project's
 * skill dirs with `{replace:true}`. No-ops when cwd is still the launch root
 * (`mn()===Wo()`). `/cd` `ft` does not call this; the skill watcher does.
 */
export async function refreshMovedDirectorySkills(): Promise<void> {
  const cwd = getCwd()
  if (cwd === getOriginalCwd()) {
    return
  }
  await addSkillDirectories(getProjectDirsUpToHome('skills', cwd), {
    replace: true,
  })
}

/**
 * Gets all dynamically discovered skills.
 * These are skills discovered from file paths during the session.
 */
export function getDynamicSkills(): Command[] {
  return Array.from(dynamicSkills.values())
}

/**
 * Activates conditional skills (skills with paths frontmatter) whose path
 * patterns match the given file paths. Activated skills are added to the
 * dynamic skills map, making them available to the model.
 *
 * Uses the `ignore` library (gitignore-style matching), matching the behavior
 * of CLAUDE.md conditional rules.
 *
 * @param filePaths Array of file paths being operated on
 * @param cwd Current working directory (paths are matched relative to cwd)
 * @returns Array of newly activated skill names
 */
export function activateConditionalSkillsForPaths(
  filePaths: string[],
  cwd: string,
): string[] {
  if (conditionalSkills.size === 0) {
    return []
  }

  const activated: string[] = []

  for (const [name, skill] of conditionalSkills) {
    if (skill.type !== 'prompt' || !skill.paths || skill.paths.length === 0) {
      continue
    }

    // Official 2.1.207: filter uncompilable paths globs before ignore().add.
    const skillPaths = filterCompilableIgnorePatterns(
      skill.paths,
      'skill_paths',
    )
    if (skillPaths.length === 0) {
      continue
    }
    const skillIgnore = ignore().add(skillPaths)
    for (const filePath of filePaths) {
      const relativePath = isAbsolute(filePath)
        ? relative(cwd, filePath)
        : filePath

      // ignore() throws on empty strings, paths escaping the base (../),
      // and absolute paths (Windows cross-drive relative() returns absolute).
      // Files outside cwd can't match cwd-relative patterns anyway.
      if (
        !relativePath ||
        relativePath.startsWith('..') ||
        isAbsolute(relativePath)
      ) {
        continue
      }

      if (skillIgnore.ignores(relativePath)) {
        // Activate this skill by moving it to dynamic skills
        dynamicSkills.set(skillMapKey(skill), skill)
        conditionalSkills.delete(name)
        activatedConditionalSkillNames.add(name)
        activated.push(name)
        logForDebugging(
          `[skills] Activated conditional skill '${name}' (matched path: ${relativePath})`,
        )
        break
      }
    }
  }

  if (activated.length > 0) {
    logEvent('tengu_dynamic_skills_changed', {
      source:
        'conditional_paths' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      previousCount: dynamicSkills.size - activated.length,
      newCount: dynamicSkills.size,
      addedCount: activated.length,
      directoryCount: 0,
    })

    // Notify listeners that skills were loaded (so they can clear caches)
    skillsLoaded.emit()
  }

  return activated
}

/**
 * Clears dynamic skill state (for testing).
 */
export async function discoverAndActivateSkillsForFilePath(
  filePath: string,
  outDirs?: string[] | Set<string>,
): Promise<void> {
  const originalCwd = getOriginalCwd()
  const currentCwd = getCwd()
  const { findGitRoot } = await import('../utils/git.js')
  const normalizedOrig = originalCwd.endsWith(pathSep)
    ? originalCwd.slice(0, -1)
    : originalCwd
  const origWorkTree =
    originalCwd !== currentCwd &&
    (currentCwd === normalizedOrig ||
      currentCwd.startsWith(normalizedOrig + pathSep))
      ? findGitRoot(originalCwd)
      : null
  const trustedCwdInfo =
    origWorkTree !== null && findGitRoot(currentCwd) === origWorkTree
      ? { cwd: originalCwd, workTree: origWorkTree }
      : undefined
  const effectiveCwd = trustedCwdInfo === undefined ? originalCwd : currentCwd
  const newDirs = await discoverSkillDirsForPaths(
    [filePath],
    effectiveCwd,
    trustedCwdInfo,
  )
  if (newDirs.length > 0) {
    if (outDirs) {
      if (outDirs instanceof Set) {
        for (const d of newDirs) {
          outDirs.add(d)
        }
      } else {
        for (const d of newDirs) {
          if (!outDirs.includes(d)) outDirs.push(d)
        }
      }
    }
    void addSkillDirectories(newDirs)
      .then(() => {
        activateConditionalSkillsForPaths([filePath], effectiveCwd)
      })
      .catch(() => {})
  }
  activateConditionalSkillsForPaths([filePath], effectiveCwd)
}

export function clearDynamicSkills(): void {
  dynamicSkillDirs.clear()
  deferredSkillDirs.clear()
  dynamicSkills.clear()
  conditionalSkills.clear()
  activatedConditionalSkillNames.clear()
}

const MAX_CHANGED_SKILL_DISCOVERY_DIRS = 100
const VERIFY_OR_REVIEW_SKILLS = new Set(['verify', 'code-review'])

export function isVerifyOrReviewSkillName(name: string): boolean {
  return VERIFY_OR_REVIEW_SKILLS.has(name)
}

/**
 * Official `O(cwd)` @298208500 (#1145):
 * Collect changed/untracked file paths from `git status --porcelain -z`
 * (capped at 100 unique parent directories) so `/verify` and `/code-review`
 * discover nested package skills even when files were modified via shell.
 */
export async function getChangedFilesForSkillDiscovery(
  cwd: string,
): Promise<string[]> {
  if (isBareMode()) return []
  const { isRestrictedToPluginOnly } = await import(
    '../utils/settings/pluginOnlyPolicy.js'
  )
  if (isRestrictedToPluginOnly('skills')) return []
  const { isSettingSourceEnabled } = await import(
    '../utils/settings/constants.js'
  )
  if (!isSettingSourceEnabled('projectSettings')) return []

  const { findGitRoot, gitExe } = await import('../utils/git.js')
  const gitRoot = findGitRoot(cwd)
  if (!gitRoot) return []

  const { execFileNoThrowWithCwd } = await import('../utils/execFileNoThrow.js')
  const res = await execFileNoThrowWithCwd(
    gitExe(),
    ['status', '--porcelain', '-z', '--untracked-files=normal'],
    { cwd: gitRoot, stdin: 'ignore' },
  )
  if (res.code !== 0 || !res.stdout) return []

  const entries = res.stdout.split('\0')
  const byDir = new Map<string, string>()
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? ''
    if (entry.length < 4) continue
    const paths = [entry.slice(3)]
    if (/[RC]/.test(entry.slice(0, 2))) {
      i++
      paths.push(entries[i] ?? '')
    }
    for (const rel of paths) {
      if (!rel) continue
      const full = resolve(gitRoot, rel)
      if (full === gitRoot) continue
      if (byDir.size >= MAX_CHANGED_SKILL_DISCOVERY_DIRS) break
      byDir.set(dirname(full), full)
    }
  }
  return [...byDir.values()]
}

/**
 * Official `m0n` discovery step (#1145): discover and load nested
 * `.claude/skills` directories for shell-modified files.
 */
export async function discoverNestedSkillsForChangedFiles(
  cwd: string,
): Promise<string[]> {
  const changed = await getChangedFilesForSkillDiscovery(cwd)
  if (changed.length === 0) return []
  const newDirs = await discoverSkillDirsForPaths(changed, cwd)
  if (newDirs.length > 0) {
    await addSkillDirectories(newDirs)
  }
  return newDirs
}

// Expose createSkillCommand + parseSkillFrontmatterFields to MCP skill
// discovery via a leaf registry module. See mcpSkillBuilders.ts for why this
// indirection exists (a literal dynamic import from mcpSkills.ts fans a single
// edge out into many cycle violations; a variable-specifier dynamic import
// passes dep-cruiser but fails to resolve in Bun-bundled binaries at runtime).
// eslint-disable-next-line custom-rules/no-top-level-side-effects -- write-once registration, idempotent
registerMCPSkillBuilders({
  createSkillCommand,
  parseSkillFrontmatterFields,
})

export {
  checkSyncReuseWithinMs,
  DEFAULT_SYNC_REUSE_WITHIN_MS,
  readSyncReuseStamp,
  resolveSyncReuseWithinMs,
  settleSyncReuseStamp,
  SYNC_REUSE_STAMP_FILENAME,
} from '../utils/accountSkillsSyncVeto.js'

/**
 * Official #1547 (`ln = 600_000` / `failedLandings` / `r6n(..., "skill_gone")`):
 * Retain claude.ai synced skills in memory when disk write fails, prevent
 * repeated downloads for 10 minutes (`600_000` ms) for the same version, and
 * prune hooks when synced skills are removed (`skill_gone`).
 */
export const SYNCED_SKILL_DOWNLOAD_COOLDOWN_MS = 600_000

type FailedLandingRecord = {
  version: string
  failures: number
  failedAtMs: number
}

const inMemorySyncedSkills = new Map<string, Command>()
const failedSyncedSkillLandings = new Map<string, FailedLandingRecord>()
const lastLoadedSyncedSkillRootsByDir = new Map<string, Set<string>>()
let activeSyncedSkillHooksPruner: (roots: ReadonlySet<string>) => number = () =>
  0

export function setSyncedSkillHooksPruner(
  pruner: ((roots: ReadonlySet<string>) => number) | null,
): void {
  activeSyncedSkillHooksPruner = pruner ?? (() => 0)
}

export function retainInMemorySyncedSkill(
  skillId: string,
  command: Command,
  opts?: { pendingDownloadStart?: (signal?: AbortSignal) => void },
): ((outcome: PendingSkillDownloadOutcome) => void) | undefined {
  inMemorySyncedSkills.set(skillId, command)
  if (opts?.pendingDownloadStart !== undefined) {
    return registerPendingSkillDownload(command.name, opts.pendingDownloadStart)
  }
  return undefined
}

export function removeInMemorySyncedSkill(
  skillId: string,
  opts?: {
    reason?: SkillHooksRemovalReason
    removeHooksForRoots?: (roots: ReadonlySet<string>) => number
  },
): boolean {
  const existing = inMemorySyncedSkills.get(skillId)
  const deleted = inMemorySyncedSkills.delete(skillId)
  if (deleted && existing?.type === 'prompt' && existing.skillRoot) {
    pruneRemovedSyncedSkillHooks(
      new Set([existing.skillRoot]),
      opts?.reason ?? 'skill_gone',
      opts?.removeHooksForRoots ?? activeSyncedSkillHooksPruner,
    )
  }
  return deleted
}

export function getInMemorySyncedSkills(): Command[] {
  return [...inMemorySyncedSkills.values()]
}

export function clearInMemorySyncedSkills(opts?: {
  reason?: SkillHooksRemovalReason
  removeHooksForRoots?: (roots: ReadonlySet<string>) => number
}): void {
  const roots = new Set<string>()
  for (const cmd of inMemorySyncedSkills.values()) {
    if (cmd.type === 'prompt' && cmd.skillRoot) {
      roots.add(cmd.skillRoot)
    }
  }
  inMemorySyncedSkills.clear()
  if (roots.size > 0) {
    pruneRemovedSyncedSkillHooks(
      roots,
      opts?.reason ?? 'sync_off',
      opts?.removeHooksForRoots ?? activeSyncedSkillHooksPruner,
    )
  }
}

export function recordFailedSyncedSkillLanding(
  skillId: string,
  version: string,
  nowMs: number = Date.now(),
): void {
  const prev = failedSyncedSkillLandings.get(skillId)
  failedSyncedSkillLandings.set(skillId, {
    version,
    failures: prev?.version === version ? prev.failures + 1 : 1,
    failedAtMs: nowMs,
  })
}

export function shouldSkipSyncedSkillDownload(
  skillId: string,
  version: string,
  nowMs: number = Date.now(),
): boolean {
  const record = failedSyncedSkillLandings.get(skillId)
  if (!record) return false
  if (record.version !== version) {
    failedSyncedSkillLandings.delete(skillId)
    return false
  }
  const elapsed = nowMs - record.failedAtMs
  return elapsed >= 0 && elapsed < SYNCED_SKILL_DOWNLOAD_COOLDOWN_MS
}

export function clearSyncedSkillLandingFailures(): void {
  failedSyncedSkillLandings.clear()
}

export type SkillHooksRemovalReason =
  | 'sync_off'
  | 'account_change'
  | 'skill_gone'

const SKILL_HOOKS_REMOVAL_COPY: Record<SkillHooksRemovalReason, string> = {
  sync_off: "Skills sync is off (a setting or the organization's policy).",
  account_change: 'A sign-out, or a sign-in not verified as the same account.',
  skill_gone:
    "Those skills are gone from this account's list or from the disk.",
}

/**
 * Official `r6n(JXt, roots, reason)` — prune hooks registered by removed
 * synced skills and log diagnostic telemetry.
 */
export function pruneRemovedSyncedSkillHooks(
  removedSkillRoots: ReadonlySet<string>,
  reason: SkillHooksRemovalReason,
  removeHooksForRoots: (roots: ReadonlySet<string>) => number,
): number {
  if (removedSkillRoots.size === 0) return 0
  const count = removeHooksForRoots(removedSkillRoots)
  if (count === 0) return 0
  logForDebugging(
    `Hooks of synced skills removed: ${count}. ${SKILL_HOOKS_REMOVAL_COPY[reason]}`,
  )
  return count
}
