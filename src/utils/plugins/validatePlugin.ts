import { readFileSync, type Dirent, type Stats } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import * as path from 'path'
import { z } from 'zod/v4'
import { errorMessage, getErrnoCode, isENOENT } from '../errors.js'
import { FRONTMATTER_REGEX } from '../frontmatterParser.js'
import { stripBOM } from '../jsonRead.js'
import { jsonParse } from '../slowOperations.js'
import { getSettingsForSource } from '../settings/settings.js'
import type { HooksSettings } from '../settings/types.js'
import { parseYaml } from '../yaml.js'
import { applyMarketplacePluginRoot } from './marketplacePluginRoot.js'
import {
  ANTHROPIC_OWN_PLUGIN_VALIDATE_MARKETPLACE,
  checkAnthropicOwnPluginName,
} from './pluginReservedName.js'
import { isOfficialMarketplaceName } from './pluginIdentifier.js'
import {
  collectUnknownPluginHooksJsonKeyWarnings,
  PluginHooksSchema,
  PluginManifestSchema,
  PluginMarketplaceEntrySchema,
  PluginMarketplaceSchema,
} from './schemas.js'

const PLUGIN_PATH_PLACEHOLDERS = [
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_PROJECT_DIR',
] as const

/**
 * densable `ut` — unquoted `${VAR}` / `$VAR` outside quotes/escapes.
 */
export function findUnquotedPluginPlaceholders(command: string): string[] {
  const found = new Set<string>()
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (!inSingle && ch === '\\') {
      i++
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (ch !== '$' || inSingle || inDouble) {
      continue
    }
    for (const name of PLUGIN_PATH_PLACEHOLDERS) {
      const braced = command.startsWith(`{${name}}`, i + 1)
      const bare =
        command.startsWith(name, i + 1) &&
        !/[A-Za-z0-9_]/.test(command.charAt(i + 1 + name.length))
      if (braced || bare) {
        found.add(`\${${name}}`)
        break
      }
    }
  }
  return [...found]
}

/**
 * densable `Fe` — command hooks (skip exec-form args and powershell).
 */
export function warnUnquotedPluginPlaceholders(
  hooks:
    | HooksSettings
    | Record<string, Array<{ hooks: unknown[] }> | undefined>,
): Array<{ event: string; command: string; placeholders: string[] }> {
  const hits: Array<{
    event: string
    command: string
    placeholders: string[]
  }> = []
  for (const [event, matchers] of Object.entries(hooks)) {
    for (const matcher of matchers ?? []) {
      for (const hook of matcher.hooks) {
        const commandHook = hook as {
          type?: string
          args?: unknown
          shell?: string
          command?: string
        }
        if (
          commandHook.type !== 'command' ||
          commandHook.args !== undefined ||
          commandHook.shell === 'powershell' ||
          typeof commandHook.command !== 'string'
        ) {
          continue
        }
        const placeholders = findUnquotedPluginPlaceholders(commandHook.command)
        if (placeholders.length > 0) {
          hits.push({
            event,
            command: commandHook.command,
            placeholders,
          })
        }
      }
    }
  }
  return hits
}

function unquotedPluginPlaceholderWarningMessage(
  placeholders: string[],
  command: string,
): string {
  const shown = command.length <= 200 ? command : command.slice(0, 200)
  return (
    `Shell command uses ${placeholders.join(', ')} without quotes: ${shown}. ` +
    'If the expanded path contains a space the command can split into several words and fail. ' +
    'Wrap the placeholder in double quotes, or use exec form: ' +
    '{"command": "<executable>", "args": ["${CLAUDE_PLUGIN_ROOT}/..."]}.'
  )
}

/**
 * Fields that belong in marketplace.json entries (PluginMarketplaceEntrySchema)
 * but not plugin.json (PluginManifestSchema). Plugin authors reasonably copy
 * one into the other. Surfaced as warnings by `claude plugin validate` since
 * they're a known confusion point — the load path silently strips all unknown
 * keys via zod's default behavior, so they're harmless at runtime but worth
 * flagging to authors.
 */
const MARKETPLACE_ONLY_MANIFEST_FIELDS = new Set([
  'category',
  'source',
  'tags',
  'strict',
  'id',
])

export type GatingHookInfo = {
  module: string
  pattern: string
  hook: string
  hasCatch: boolean
}

export type ValidationResult = {
  success: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
  filePath: string
  fileType: 'plugin' | 'marketplace' | 'skill' | 'agent' | 'command' | 'hooks'
  notes?: string[]
  gatingHooks?: GatingHookInfo[]
}

/** densable `n9r`. */
export function pluginValidationOutcome(
  results: ValidationResult[],
  options: { strict?: boolean },
): { noErrors: boolean; hasWarnings: boolean; allSuccess: boolean } {
  const noErrors = results.every(r => r.success)
  const hasWarnings = results.some(r => r.warnings.length > 0)
  return {
    noErrors,
    hasWarnings,
    allSuccess: options.strict ? noErrors && !hasWarnings : noErrors,
  }
}

export type ValidationError = {
  path: string
  message: string
  code?: string
}

export type ValidationWarning = {
  path: string
  message: string
}

/**
 * Detect whether a file is a plugin manifest or marketplace manifest
 */
function detectManifestType(
  filePath: string,
): 'plugin' | 'marketplace' | 'unknown' {
  const fileName = path.basename(filePath)
  const dirName = path.basename(path.dirname(filePath))

  // Check filename patterns
  if (fileName === 'plugin.json') return 'plugin'
  if (fileName === 'marketplace.json') return 'marketplace'

  // Check if it's in .claude-plugin directory
  if (dirName === '.claude-plugin') {
    return 'plugin' // Most likely plugin.json
  }

  return 'unknown'
}

/**
 * Format Zod validation errors into a readable format
 */
function formatZodErrors(zodError: z.ZodError): ValidationError[] {
  return zodError.issues.map(error => ({
    path: error.path.join('.') || 'root',
    message: error.message,
    code: error.code,
  }))
}

/**
 * Check for parent-directory segments ('..') in a path string.
 *
 * For plugin.json component paths this is a security concern (escaping the plugin dir).
 * For marketplace.json source paths it's almost always a resolution-base misunderstanding:
 * paths resolve from the marketplace repo root, not from marketplace.json itself, so the
 * '..' a user added to "climb out of .claude-plugin/" is unnecessary. Callers pass `hint`
 * to attach the right explanation.
 */
function checkPathTraversal(
  p: string,
  field: string,
  errors: ValidationError[],
  hint?: string,
): void {
  if (p.includes('..')) {
    errors.push({
      path: field,
      message: hint
        ? `Path contains "..": ${p}. ${hint}`
        : `Path contains ".." which could be a path traversal attempt: ${p}`,
    })
  }
}

// Shown when a marketplace plugin source contains '..'. Most users hit this because
// they expect paths to resolve relative to marketplace.json (inside .claude-plugin/),
// but resolution actually starts at the marketplace repo root — see gh-29485.
// Computes a tailored "use X instead of Y" suggestion from the user's actual path
// rather than a hardcoded example (review feedback on #20895).
function marketplaceSourceHint(p: string): string {
  // Strip leading ../ segments: the '..' a user added to "climb out of
  // .claude-plugin/" is unnecessary since paths already start at the repo root.
  // If '..' appears mid-path (rare), fall back to a generic example.
  const stripped = p.replace(/^(\.\.\/)+/, '')
  const corrected = stripped !== p ? `./${stripped}` : './plugins/my-plugin'
  return (
    'Plugin source paths are resolved relative to the marketplace root (the directory ' +
    'containing .claude-plugin/), not relative to marketplace.json. ' +
    `Use "${corrected}" instead of "${p}".`
  )
}

/**
 * Validate a plugin manifest file (plugin.json)
 */
export async function validatePluginManifest(
  filePath: string,
): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []
  const absolutePath = path.resolve(filePath)

  // Read file content — handle ENOENT / EISDIR / permission errors directly
  let content: string
  try {
    content = await readFile(absolutePath, { encoding: 'utf-8' })
  } catch (error: unknown) {
    const code = getErrnoCode(error)
    let message: string
    if (code === 'ENOENT') {
      message = `File not found: ${absolutePath}`
    } else if (code === 'EISDIR') {
      message = `Path is not a file: ${absolutePath}`
    } else {
      message = `Failed to read file: ${errorMessage(error)}`
    }
    return {
      success: false,
      errors: [{ path: 'file', message, code }],
      warnings: [],
      filePath: absolutePath,
      fileType: 'plugin',
    }
  }

  let parsed: unknown
  try {
    parsed = jsonParse(stripBOM(content))
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: 'json',
          message: `Invalid JSON syntax: ${errorMessage(error)}`,
        },
      ],
      warnings: [],
      filePath: absolutePath,
      fileType: 'plugin',
    }
  }

  // Check for path traversal in the parsed JSON before schema validation
  // This ensures we catch security issues even if schema validation fails
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>

    // Check commands
    if (obj.commands) {
      const commands = Array.isArray(obj.commands)
        ? obj.commands
        : [obj.commands]
      commands.forEach((cmd, i) => {
        if (typeof cmd === 'string') {
          checkPathTraversal(cmd, `commands[${i}]`, errors)
        }
      })
    }

    // Check agents
    if (obj.agents) {
      const agents = Array.isArray(obj.agents) ? obj.agents : [obj.agents]
      agents.forEach((agent, i) => {
        if (typeof agent === 'string') {
          checkPathTraversal(agent, `agents[${i}]`, errors)
        }
      })
    }

    // Check skills
    if (obj.skills) {
      const skills = Array.isArray(obj.skills) ? obj.skills : [obj.skills]
      skills.forEach((skill, i) => {
        if (typeof skill === 'string') {
          checkPathTraversal(skill, `skills[${i}]`, errors)
        }
      })
    }
  }

  // Surface marketplace-only fields as a warning BEFORE validation flags
  // them. `claude plugin validate` is a developer tool — authors running it
  // want to know these fields don't belong here. But it's a warning, not an
  // error: the plugin loads fine at runtime (the base schema strips unknown
  // keys). We strip them here so the .strict() call below doesn't double-
  // report them as unrecognized-key errors on top of the targeted warnings.
  let toValidate = parsed
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>
    const strayKeys = Object.keys(obj).filter(k =>
      MARKETPLACE_ONLY_MANIFEST_FIELDS.has(k),
    )
    if (strayKeys.length > 0) {
      const stripped = { ...obj }
      for (const key of strayKeys) {
        delete stripped[key]
        warnings.push({
          path: key,
          message:
            `Field '${key}' belongs in the marketplace entry (marketplace.json), ` +
            `not plugin.json. It's harmless here but unused — Claude Code ` +
            `ignores it at load time.`,
        })
      }
      toValidate = stripped
    }
  }

  // Validate against schema (post-strip, so marketplace fields don't fail it).
  // We call .strict() locally here even though the base schema is lenient —
  // the runtime load path silently strips unknown keys for resilience, but
  // this is a developer tool and authors running it want typo feedback.
  const result = PluginManifestSchema().strict().safeParse(toValidate)

  if (!result.success) {
    errors.push(...formatZodErrors(result.error))
  }

  // Check for common issues and add warnings
  if (result.success) {
    const manifest = result.data

    // Warn if name isn't strict kebab-case. CC's schema only rejects spaces,
    // but the Claude.ai marketplace sync rejects non-kebab names. Surfacing
    // this here lets authors catch it in CI before the sync fails on them.
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name)) {
      warnings.push({
        path: 'name',
        message:
          `Plugin name "${manifest.name}" is not kebab-case. Claude Code accepts ` +
          `it, but the Claude.ai marketplace sync requires kebab-case ` +
          `(lowercase letters, digits, and hyphens only, e.g., "my-plugin").`,
      })
    }

    // densable `fkt` + `spo` — plugin.json is gold kind "alone".
    const reserved = checkAnthropicOwnPluginName(manifest.name)
    if (reserved) {
      const row = {
        path: 'name',
        message: `${reserved.message} ${ANTHROPIC_OWN_PLUGIN_VALIDATE_MARKETPLACE}`,
      }
      if (reserved.severity === 'error') errors.push(row)
      else warnings.push(row)
    }

    // Warn if no version specified
    if (!manifest.version) {
      warnings.push({
        path: 'version',
        message:
          'No version specified. Consider adding a version following semver (e.g., "1.0.0")',
      })
    }

    // Warn if no description
    if (!manifest.description) {
      warnings.push({
        path: 'description',
        message:
          'No description provided. Adding a description helps users understand what your plugin does',
      })
    }

    // Warn if no author
    if (!manifest.author) {
      warnings.push({
        path: 'author',
        message:
          'No author information provided. Consider adding author details for plugin attribution',
      })
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    filePath: absolutePath,
    fileType: 'plugin',
  }
}

/**
 * Validate a marketplace manifest file (marketplace.json)
 */
export async function validateMarketplaceManifest(
  filePath: string,
): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []
  const absolutePath = path.resolve(filePath)

  // Read file content — handle ENOENT / EISDIR / permission errors directly
  let content: string
  try {
    content = await readFile(absolutePath, { encoding: 'utf-8' })
  } catch (error: unknown) {
    const code = getErrnoCode(error)
    let message: string
    if (code === 'ENOENT') {
      message = `File not found: ${absolutePath}`
    } else if (code === 'EISDIR') {
      message = `Path is not a file: ${absolutePath}`
    } else {
      message = `Failed to read file: ${errorMessage(error)}`
    }
    return {
      success: false,
      errors: [{ path: 'file', message, code }],
      warnings: [],
      filePath: absolutePath,
      fileType: 'marketplace',
    }
  }

  let parsed: unknown
  try {
    parsed = jsonParse(content)
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: 'json',
          message: `Invalid JSON syntax: ${errorMessage(error)}`,
        },
      ],
      warnings: [],
      filePath: absolutePath,
      fileType: 'marketplace',
    }
  }

  // Check for path traversal in plugin sources before schema validation
  // This ensures we catch security issues even if schema validation fails
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>

    if (Array.isArray(obj.plugins)) {
      obj.plugins.forEach((plugin: unknown, i: number) => {
        if (plugin && typeof plugin === 'object' && 'source' in plugin) {
          const source = (plugin as { source: unknown }).source
          // Check string sources (relative paths)
          if (typeof source === 'string') {
            checkPathTraversal(
              source,
              `plugins[${i}].source`,
              errors,
              marketplaceSourceHint(source),
            )
          }
          // Check object-source .path (git-subdir: subdirectory within the
          // remote repo, sparse-cloned). '..' here is a genuine traversal attempt
          // within the remote repo tree, not a marketplace-root misunderstanding —
          // keep the security framing (no marketplaceSourceHint). See #20895 review.
          if (
            source &&
            typeof source === 'object' &&
            'path' in source &&
            typeof (source as { path: unknown }).path === 'string'
          ) {
            checkPathTraversal(
              (source as { path: string }).path,
              `plugins[${i}].source.path`,
              errors,
            )
          }
        }
      })
    }
  }

  // Validate against schema.
  // The base schemas are lenient (strip unknown keys) for runtime resilience,
  // but this is a developer tool — authors want typo feedback. We rebuild the
  // schema with .strict() here. Note .strict() on the outer object does NOT
  // propagate into z.array() elements, so we also override the plugins array
  // with strict entries to catch typos inside individual plugin entries too.
  const strictMarketplaceSchema = PluginMarketplaceSchema()
    .extend({
      plugins: z.array(PluginMarketplaceEntrySchema().strict()),
    })
    .strict()
  const result = strictMarketplaceSchema.safeParse(
    applyMarketplacePluginRoot(parsed),
  )

  if (!result.success) {
    errors.push(...formatZodErrors(result.error))
  }

  // Check for common issues and add warnings
  if (result.success) {
    const marketplace = result.data

    // Warn if no plugins
    if (!marketplace.plugins || marketplace.plugins.length === 0) {
      warnings.push({
        path: 'plugins',
        message: 'Marketplace has no plugins defined',
      })
    }

    // Check each plugin entry
    if (marketplace.plugins) {
      const skipOwnNameCheck = isOfficialMarketplaceName(marketplace.name)
      marketplace.plugins.forEach((plugin, i) => {
        // Check for duplicate plugin names
        const duplicates = marketplace.plugins.filter(
          p => p.name === plugin.name,
        )
        if (duplicates.length > 1) {
          errors.push({
            path: `plugins[${i}].name`,
            message: `Duplicate plugin name "${plugin.name}" found in marketplace`,
          })
        }
        // densable `fkt` on marketplace entries (no `spo`); skip official catalog.
        if (!skipOwnNameCheck) {
          const reserved = checkAnthropicOwnPluginName(plugin.name)
          if (reserved) {
            const row = {
              path: `plugins[${i}].name`,
              message: reserved.message,
            }
            if (reserved.severity === 'error') errors.push(row)
            else warnings.push(row)
          }
        }
      })

      // Version-mismatch check: for local-source entries that declare a
      // version, compare against the plugin's own plugin.json. At install
      // time, calculatePluginVersion (pluginVersioning.ts) prefers the
      // manifest version and silently ignores the entry version — so a
      // stale entry.version is invisible user confusion (marketplace UI
      // shows one version, /status shows another after install).
      // Only local sources: remote sources would need cloning to check.
      const manifestDir = path.dirname(absolutePath)
      const marketplaceRoot =
        path.basename(manifestDir) === '.claude-plugin'
          ? path.dirname(manifestDir)
          : manifestDir
      for (const [i, entry] of marketplace.plugins.entries()) {
        if (
          !entry.version ||
          typeof entry.source !== 'string' ||
          !entry.source.startsWith('./')
        ) {
          continue
        }
        const pluginJsonPath = path.join(
          marketplaceRoot,
          entry.source,
          '.claude-plugin',
          'plugin.json',
        )
        let manifestVersion: string | undefined
        try {
          const raw = await readFile(pluginJsonPath, { encoding: 'utf-8' })
          const parsed = jsonParse(stripBOM(raw)) as { version?: unknown }
          if (typeof parsed.version === 'string') {
            manifestVersion = parsed.version
          }
        } catch {
          // Missing/unreadable plugin.json is someone else's error to report
          continue
        }
        if (manifestVersion && manifestVersion !== entry.version) {
          warnings.push({
            path: `plugins[${i}].version`,
            message:
              `Entry declares version "${entry.version}" but ${entry.source}/.claude-plugin/plugin.json says "${manifestVersion}". ` +
              `At install time, plugin.json wins (calculatePluginVersion precedence) — the entry version is silently ignored. ` +
              `Update this entry to "${manifestVersion}" to match.`,
          })
        }
      }
    }

    // Warn if no description in metadata
    if (!marketplace.metadata?.description) {
      warnings.push({
        path: 'metadata.description',
        message:
          'No marketplace description provided. Adding a description helps users understand what this marketplace offers',
      })
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    filePath: absolutePath,
    fileType: 'marketplace',
  }
}
/**
 * Validate the YAML frontmatter in a plugin component markdown file.
 *
 * The runtime loader (parseFrontmatter) silently drops unparseable YAML to a
 * debug log and returns an empty object. That's the right resilience choice
 * for the load path, but authors running `claude plugin validate` want a hard
 * signal. This re-parses the frontmatter block and surfaces what the loader
 * would silently swallow.
 */
function validateComponentFile(
  filePath: string,
  content: string,
  fileType: 'skill' | 'agent' | 'command',
): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  const match = content.match(FRONTMATTER_REGEX)
  if (!match) {
    warnings.push({
      path: 'frontmatter',
      message:
        'No frontmatter block found. Add YAML frontmatter between --- delimiters ' +
        'at the top of the file to set description and other metadata.',
    })
    return { success: true, errors, warnings, filePath, fileType }
  }

  const frontmatterText = match[1] || ''
  let parsed: unknown
  try {
    parsed = parseYaml(frontmatterText)
  } catch (e) {
    errors.push({
      path: 'frontmatter',
      message:
        `YAML frontmatter failed to parse: ${errorMessage(e)}. ` +
        `At runtime this ${fileType} loads with empty metadata (all frontmatter ` +
        `fields silently dropped).`,
    })
    return { success: false, errors, warnings, filePath, fileType }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push({
      path: 'frontmatter',
      message:
        'Frontmatter must be a YAML mapping (key: value pairs), got ' +
        `${Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed}.`,
    })
    return { success: false, errors, warnings, filePath, fileType }
  }

  const fm = parsed as Record<string, unknown>

  // description: must be scalar. coerceDescriptionToString logs+drops arrays/objects at runtime.
  if (fm.description !== undefined) {
    const d = fm.description
    if (
      typeof d !== 'string' &&
      typeof d !== 'number' &&
      typeof d !== 'boolean' &&
      d !== null
    ) {
      errors.push({
        path: 'description',
        message:
          `description must be a string, got ${Array.isArray(d) ? 'array' : typeof d}. ` +
          `At runtime this value is dropped.`,
      })
    }
  } else {
    warnings.push({
      path: 'description',
      message:
        `No description in frontmatter. A description helps users and Claude ` +
        `understand when to use this ${fileType}.`,
    })
  }

  // name: if present, must be a string (skills/commands use it as displayName;
  // plugin agents use it as the agentType stem — non-strings would stringify to garbage)
  if (
    fm.name !== undefined &&
    fm.name !== null &&
    typeof fm.name !== 'string'
  ) {
    errors.push({
      path: 'name',
      message: `name must be a string, got ${typeof fm.name}.`,
    })
  }

  // allowed-tools: string or array of strings
  const at = fm['allowed-tools']
  if (at !== undefined && at !== null) {
    if (typeof at !== 'string' && !Array.isArray(at)) {
      errors.push({
        path: 'allowed-tools',
        message: `allowed-tools must be a string or array of strings, got ${typeof at}.`,
      })
    } else if (Array.isArray(at) && at.some(t => typeof t !== 'string')) {
      errors.push({
        path: 'allowed-tools',
        message: 'allowed-tools array must contain only strings.',
      })
    }
  }

  // shell: 'bash' | 'powershell' (controls !`cmd` block routing)
  const sh = fm.shell
  if (sh !== undefined && sh !== null) {
    if (typeof sh !== 'string') {
      errors.push({
        path: 'shell',
        message: `shell must be a string, got ${typeof sh}.`,
      })
    } else {
      // Normalize to match parseShellFrontmatter() runtime behavior —
      // `shell: PowerShell` should not fail validation but work at runtime.
      const normalized = sh.trim().toLowerCase()
      if (normalized !== 'bash' && normalized !== 'powershell') {
        errors.push({
          path: 'shell',
          message: `shell must be 'bash' or 'powershell', got '${sh}'.`,
        })
      }
    }
  }

  return { success: errors.length === 0, errors, warnings, filePath, fileType }
}

const NON_GATING_HOOK_EVENTS = new Set<string>([
  'tool.describe',
  'prompt.fill',
  'prompt.suggest',
  'prompt.edit',
  'prompt.change',
  'prompt.autocomplete',
  'prompt.section',
  'prompt.context',
  'prompt.attachment',
  'prompt.compose',
  'command.describe',
  'config.describe',
  'skill.prompt',
  'attribution.text',
  'session.start',
  'session.attach',
  'session.detach',
  'session.measure',
  'session.end',
  'turn.start',
  'turn.step',
  'turn.complete',
  'ui.render',
  'ui.resolve',
  'ui.press',
  'ui.input',
  'ui.select',
  'ui.message',
  'ui.fault',
  'engine.create',
])

/** Official `R$o` — true when pattern matches at least one gating hook event. */
export function isGatingHookPattern(pattern: string): boolean {
  const { FUNCTION_HOOK_EVENTS, functionHookPatternMatches } =
    require('./functionHooksModules.js') as typeof import('./functionHooksModules.js')
  if (!pattern.includes('*')) {
    return !NON_GATING_HOOK_EVENTS.has(pattern)
  }
  const matched = FUNCTION_HOOK_EVENTS.filter(ev =>
    functionHookPatternMatches(pattern, ev),
  )
  return (
    matched.length === 0 || matched.some(ev => !NON_GATING_HOOK_EVENTS.has(ev))
  )
}

function tsStringLiteral(
  ts: typeof import('typescript'),
  node: import('typescript').Node | undefined,
): string | undefined {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  return undefined
}

function tsIdentifierUsed(
  ts: typeof import('typescript'),
  root: import('typescript').Node,
  targetName: string,
): boolean {
  let used = false
  const visit = (node: import('typescript').Node): void => {
    if (used) return
    if (ts.isIdentifier(node) && node.text === targetName) {
      const p = node.parent
      if (
        p &&
        ((ts.isPropertyAccessExpression(p) && p.name === node) ||
          (ts.isPropertyAssignment(p) && p.name === node))
      ) {
        // property name, not a value reference
      } else {
        used = true
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(root, visit)
  return used
}

type TsImportBinding = {
  specifier: string
  importedName: string
}

function collectTsImportsAndExports(
  ts: typeof import('typescript'),
  sf: import('typescript').SourceFile,
): {
  namedFns: Map<string, import('typescript').FunctionLikeDeclaration>
  imports: Map<string, TsImportBinding>
  exports: Map<string, string>
  defaultExportName?: string
  defaultExportFn?: import('typescript').FunctionLikeDeclaration
  reExports: Array<{
    specifier: string
    exportedName: string
    importedName: string
  }>
  starReExports: string[]
} {
  const namedFns = new Map<
    string,
    import('typescript').FunctionLikeDeclaration
  >()
  const imports = new Map<string, TsImportBinding>()
  const exports = new Map<string, string>()
  const reExports: Array<{
    specifier: string
    exportedName: string
    importedName: string
  }> = []
  const starReExports: string[] = []
  let defaultExportName: string | undefined
  let defaultExportFn: import('typescript').FunctionLikeDeclaration | undefined

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      const isExport =
        stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ??
        false
      const isDefault =
        stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ??
        false
      if (stmt.name) {
        namedFns.set(stmt.name.text, stmt)
        if (isExport) {
          exports.set(isDefault ? 'default' : stmt.name.text, stmt.name.text)
        }
      }
      if (isExport && isDefault) {
        defaultExportFn = stmt
      }
    } else if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.importClause
    ) {
      const specifier = stmt.moduleSpecifier.text
      if (stmt.importClause.name) {
        imports.set(stmt.importClause.name.text, {
          specifier,
          importedName: 'default',
        })
      }
      const bindings = stmt.importClause.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          imports.set(el.name.text, {
            specifier,
            importedName: (el.propertyName ?? el.name).text,
          })
        }
      }
    } else if (ts.isExportDeclaration(stmt)) {
      const spec =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : undefined
      if (!stmt.exportClause && spec) {
        starReExports.push(spec)
      } else if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const exportedName = el.name.text
          const importedName = (el.propertyName ?? el.name).text
          if (spec) {
            reExports.push({ specifier: spec, exportedName, importedName })
          } else {
            exports.set(exportedName, importedName)
          }
        }
      }
    } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      if (ts.isIdentifier(stmt.expression)) {
        defaultExportName = stmt.expression.text
      } else if (
        ts.isFunctionExpression(stmt.expression) ||
        ts.isArrowFunction(stmt.expression)
      ) {
        defaultExportFn = stmt.expression
      }
    }
  }

  return {
    namedFns,
    imports,
    exports,
    defaultExportName,
    defaultExportFn,
    reExports,
    starReExports,
  }
}

function resolveExportedTsFunction(
  ts: typeof import('typescript'),
  file: string,
  exportName: string,
  getFile: (file: string) =>
    | {
        sf: import('typescript').SourceFile
        meta: ReturnType<typeof collectTsImportsAndExports>
      }
    | undefined,
  resolveImport: (
    specifier: string,
    fromFile: string,
  ) => { file: string; source: string } | undefined,
  visiting = new Set<string>(),
): import('typescript').FunctionLikeDeclaration | undefined {
  const key = `${file}\0${exportName}`
  if (visiting.has(key)) return undefined
  visiting.add(key)
  const parsed = getFile(file)
  if (!parsed) return undefined
  const { meta } = parsed
  if (exportName === 'default') {
    if (meta.defaultExportFn) return meta.defaultExportFn
    if (meta.defaultExportName) {
      const local = meta.namedFns.get(meta.defaultExportName)
      if (local) return local
      const imp = meta.imports.get(meta.defaultExportName)
      if (imp) {
        const target = resolveImport(imp.specifier, file)
        if (target) {
          return resolveExportedTsFunction(
            ts,
            target.file,
            imp.importedName,
            getFile,
            resolveImport,
            visiting,
          )
        }
      }
    }
  }
  const localName = meta.exports.get(exportName)
  if (localName !== undefined) {
    const fn = meta.namedFns.get(localName)
    if (fn) return fn
    const imp = meta.imports.get(localName)
    if (imp) {
      const target = resolveImport(imp.specifier, file)
      if (target) {
        return resolveExportedTsFunction(
          ts,
          target.file,
          imp.importedName,
          getFile,
          resolveImport,
          visiting,
        )
      }
    }
  }
  for (const re of meta.reExports) {
    if (re.exportedName !== exportName) continue
    const target = resolveImport(re.specifier, file)
    if (!target) continue
    const found = resolveExportedTsFunction(
      ts,
      target.file,
      re.importedName,
      getFile,
      resolveImport,
      visiting,
    )
    if (found) return found
  }
  if (exportName !== 'default') {
    for (const spec of meta.starReExports) {
      const target = resolveImport(spec, file)
      if (!target) continue
      const found = resolveExportedTsFunction(
        ts,
        target.file,
        exportName,
        getFile,
        resolveImport,
        visiting,
      )
      if (found) return found
    }
  }
  return undefined
}

function isTsHookFnReachingNext(
  ts: typeof import('typescript'),
  fnArg: import('typescript').Node | undefined,
  namedFns: Map<string, import('typescript').FunctionLikeDeclaration>,
  resolveImportedFn?: (
    name: string,
  ) => import('typescript').FunctionLikeDeclaration | undefined,
): boolean {
  if (!fnArg) return true
  const fnNode = ts.isIdentifier(fnArg)
    ? (namedFns.get(fnArg.text) ?? resolveImportedFn?.(fnArg.text))
    : ts.isFunctionExpression(fnArg) || ts.isArrowFunction(fnArg)
      ? fnArg
      : undefined
  if (!fnNode || !fnNode.body) return true
  const nextParam = fnNode.parameters[2]
  if (nextParam !== undefined) {
    if (!ts.isIdentifier(nextParam.name)) return true
    if (tsIdentifierUsed(ts, fnNode.body, nextParam.name.text)) return true
  }
  return tsIdentifierUsed(ts, fnNode.body, 'eval')
}

function extractTsCommandsFromMatcher(
  ts: typeof import('typescript'),
  matcherNode: import('typescript').Node | undefined,
): string[] {
  if (!matcherNode || !ts.isObjectLiteralExpression(matcherNode)) return []
  for (const prop of matcherNode.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const keyName = ts.isIdentifier(prop.name)
      ? prop.name.text
      : tsStringLiteral(ts, prop.name)
    if (keyName !== 'command') continue
    const single = tsStringLiteral(ts, prop.initializer)
    if (single !== undefined) return [single]
    if (ts.isArrayLiteralExpression(prop.initializer)) {
      const out: string[] = []
      for (const el of prop.initializer.elements) {
        const s = tsStringLiteral(ts, el)
        if (s !== undefined) out.push(s)
      }
      return out
    }
  }
  return []
}

/**
 * Official `Yja` / `wQt` AST validator for plugin hook modules:
 * detects `on(pattern, ...)` registrations, `.catch(...)` wrappers (`ave`),
 * own-command `command.run` handlers (`_Qt`), and gating hooks (`R$o`).
 */
export function analyzeGatingHooksInSource(
  moduleName: string,
  source: string,
  options?: {
    shippedCommands?: ReadonlySet<string>
    resolveImport?: (
      specifier: string,
      fromFile: string,
    ) => { file: string; source: string } | undefined
  },
): {
  gatingHooks: GatingHookInfo[]
  ownCommandRegistrations: string[]
  notes: string[]
} {
  let ts: typeof import('typescript')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ts = require('typescript') as typeof import('typescript')
  } catch {
    return { gatingHooks: [], ownCommandRegistrations: [], notes: [] }
  }

  const sf = ts.createSourceFile(
    moduleName,
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  const fileCache = new Map<
    string,
    {
      sf: import('typescript').SourceFile
      meta: ReturnType<typeof collectTsImportsAndExports>
    }
  >()
  const entryMeta = collectTsImportsAndExports(ts, sf)
  fileCache.set(moduleName, { sf, meta: entryMeta })
  const resolveImportFn = options?.resolveImport
  const getFile = (file: string) => {
    const cached = fileCache.get(file)
    if (cached) return cached
    return undefined
  }
  const resolveImportCached = (specifier: string, fromFile: string) => {
    const hit = resolveImportFn?.(specifier, fromFile)
    if (!hit) return undefined
    if (!fileCache.has(hit.file)) {
      const childSf = ts.createSourceFile(
        hit.file,
        hit.source,
        ts.ScriptTarget.Latest,
        true,
      )
      fileCache.set(hit.file, {
        sf: childSf,
        meta: collectTsImportsAndExports(ts, childSf),
      })
    }
    return hit
  }
  const resolveImportedFn = (name: string) => {
    const imp = entryMeta.imports.get(name)
    if (!imp || !resolveImportFn) return undefined
    const target = resolveImportCached(imp.specifier, moduleName)
    if (!target) return undefined
    return resolveExportedTsFunction(
      ts,
      target.file,
      imp.importedName,
      getFile,
      resolveImportCached,
    )
  }
  const namedFns = entryMeta.namedFns
  const registeredCommands = new Set<string>()
  const onCalls: import('typescript').CallExpression[] = []

  const visit = (node: import('typescript').Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      namedFns.set(node.name.text, node)
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === 'on') {
        onCalls.push(node)
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'register' &&
        ts.isPropertyAccessExpression(callee.expression) &&
        callee.expression.name.text === 'command'
      ) {
        const arg0 = node.arguments[0]
        const firstStr = tsStringLiteral(ts, arg0)
        if (firstStr !== undefined) {
          registeredCommands.add(firstStr)
        } else if (arg0 && ts.isObjectLiteralExpression(arg0)) {
          for (const prop of arg0.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === 'name'
            ) {
              const nameVal = tsStringLiteral(ts, prop.initializer)
              if (nameVal !== undefined) registeredCommands.add(nameVal)
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sf, visit)

  const gatingHooks: GatingHookInfo[] = []
  const ownCommandRegistrations: string[] = []
  const notes: string[] = []

  for (const call of onCalls) {
    const pattern = tsStringLiteral(ts, call.arguments[0])
    if (pattern === undefined) continue

    const matcherNode =
      call.arguments.length >= 3 ? call.arguments[1] : undefined
    const commands =
      pattern === 'command.run'
        ? extractTsCommandsFromMatcher(ts, matcherNode)
        : []
    const registration =
      commands.length > 0
        ? `on("${pattern}", { command: ${commands.map(c => `"${c}"`).join(', ')} })`
        : `on("${pattern}")`

    // Official `ave`: call.catch(...)
    const p1 = call.parent
    const hasCatch =
      p1 !== undefined &&
      ts.isPropertyAccessExpression(p1) &&
      p1.expression === call &&
      p1.name.text === 'catch'

    const catchCall =
      hasCatch && p1.parent && ts.isCallExpression(p1.parent)
        ? p1.parent
        : undefined
    const handlerNodes = [
      ...call.arguments.slice(-1),
      ...(catchCall ? catchCall.arguments : []),
    ]
    const reachesNext = handlerNodes.some(h =>
      isTsHookFnReachingNext(ts, h, namedFns, resolveImportedFn),
    )

    const isOwnCommand =
      pattern === 'command.run' &&
      !reachesNext &&
      commands.length > 0 &&
      commands.every(c => registeredCommands.has(c)) &&
      !(
        options?.shippedCommands &&
        commands.some(c => options.shippedCommands!.has(c))
      )

    if (isOwnCommand) {
      ownCommandRegistrations.push(registration)
      notes.push(`[${moduleName}] answers its own command: ${registration}`)
      continue
    }

    if (isGatingHookPattern(pattern)) {
      gatingHooks.push({
        module: moduleName,
        pattern,
        hook: registration,
        hasCatch,
      })
      notes.push(
        `[${moduleName}] gating hook ${hasCatch ? 'with' : 'without'} .catch: ${registration}`,
      )
    }
  }

  return { gatingHooks, ownCommandRegistrations, notes }
}

export type HookModuleStateRef = { plugin: string; key: string }

export type HookModuleStateAndMatcherAnalysis = {
  stateReads: HookModuleStateRef[]
  stateWrites: HookModuleStateRef[]
  matchers: Array<{ pattern: string; matcher: Record<string, unknown> }>
  error?: string
}

const VAR_REBOUND_MESSAGES = {
  declared:
    'is declared here too, so the value it names cannot be listed. Declare it once',
  assigned:
    'is assigned here, so the value it names cannot be listed. Leave it unassigned, or write the reference at the call',
  doubted:
    'may be assigned here, where the engine can bind the name apart from the text, so the value it names cannot be listed. Rename one of the two',
  looped:
    "is spelled in a loop's head here, and the engine can write such a target past a nearer name of that spelling, so the value it names cannot be listed. Rename one of the two",
  early:
    'is read here as the file loads, above its declaration, where it is still undefined, so the value it names cannot be listed. Declare it above this read',
} as const

function binarySearchIntervalEnd(
  starts: readonly number[],
  pos: number,
): number {
  let lo = 0
  let hi = starts.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (starts[mid]! <= pos) lo = mid + 1
    else hi = mid
  }
  return lo
}

function isTsFunctionLike(
  ts: typeof import('typescript'),
  node: import('typescript').Node | undefined,
): node is import('typescript').FunctionLikeDeclaration {
  return (
    node !== undefined &&
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node))
  )
}

function isTsScopeNode(
  ts: typeof import('typescript'),
  node: import('typescript').Node,
): boolean {
  return (
    ts.isSourceFile(node) ||
    isTsFunctionLike(ts, node) ||
    ts.isBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isSwitchStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  )
}

function isTsLexicalScope(
  ts: typeof import('typescript'),
  node: import('typescript').Node,
): boolean {
  return (
    ts.isSourceFile(node) ||
    isTsFunctionLike(ts, node) ||
    ts.isBlock(node) ||
    ts.isSwitchStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  )
}

function isTsVarScope(
  ts: typeof import('typescript'),
  node: import('typescript').Node,
): boolean {
  return ts.isSourceFile(node) || isTsFunctionLike(ts, node)
}

function collectPatternIdentifiers(
  ts: typeof import('typescript'),
  node: import('typescript').Node | undefined,
): import('typescript').Identifier[] {
  if (!node) return []
  if (ts.isIdentifier(node)) return [node]
  if (ts.isArrayBindingPattern(node) || ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap(el =>
      ts.isOmittedExpression(el) ? [] : collectPatternIdentifiers(ts, el),
    )
  }
  if (ts.isObjectBindingPattern(node)) {
    return node.elements.flatMap(el => collectPatternIdentifiers(ts, el.name))
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap(prop => {
      if (ts.isShorthandPropertyAssignment(prop)) return [prop.name]
      if (ts.isPropertyAssignment(prop)) {
        return collectPatternIdentifiers(ts, prop.initializer)
      }
      if (ts.isSpreadAssignment(prop)) {
        return collectPatternIdentifiers(ts, prop.expression)
      }
      return []
    })
  }
  if (ts.isBindingElement(node)) {
    return collectPatternIdentifiers(ts, node.name)
  }
  if (ts.isSpreadElement(node)) {
    return collectPatternIdentifiers(ts, node.expression)
  }
  return []
}

/**
 * Official AST `$.state` & `matcher` static analyzer (2.1.292 #237/#238/#239):
 * - O(N log N) `counted()` + `apart()` + binary-search `starts`
 * - `shadowOf` ("engine") vs `writtenShadowOf` ("written")
 * - refuses redeclared/reassigned/early-read/looped top-level `var` for `$.state`
 */
const MAX_SCAN_SCOPE_DEPTH = 2000
const SCAN_EXCERPT_LIMIT = 80

function formatScanRefusalMessage(
  file: string,
  sourceLines: readonly string[],
  line: number | undefined,
  construct: string,
): string {
  const raw = line !== undefined ? (sourceLines[line - 1]?.trim() ?? '') : ''
  const excerpt =
    raw.length > SCAN_EXCERPT_LIMIT
      ? `${raw.slice(0, SCAN_EXCERPT_LIMIT)}...`
      : raw
  const location =
    line === undefined
      ? ''
      : excerpt === ''
        ? `:${line}`
        : `, compiled line ${line} \`${excerpt}\``
  return `${file}${location}: ${construct}`
}

export function analyzeHookModuleStateAndMatchers(
  moduleName: string,
  source: string,
): HookModuleStateAndMatcherAnalysis {
  const sourceLines = source.split(/\r?\n/)
  let ts: typeof import('typescript')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ts = require('typescript') as typeof import('typescript')
  } catch {
    return { stateReads: [], stateWrites: [], matchers: [] }
  }

  let sf: import('typescript').SourceFile
  try {
    sf = ts.createSourceFile(moduleName, source, ts.ScriptTarget.Latest, true)
  } catch (err) {
    if (err instanceof RangeError) {
      return {
        stateReads: [],
        stateWrites: [],
        matchers: [],
        error: formatScanRefusalMessage(
          moduleName,
          sourceLines,
          undefined,
          `code nested too deep to scan (the parser stopped: ${err.message})`,
        ),
      }
    }
    throw err
  }

  // Iterative scope-depth check (#400): refuse > 2000 nested scopes before
  // recursive AST walks can overflow the call stack.
  {
    const stack: Array<{ node: import('typescript').Node; depth: number }> = [
      { node: sf, depth: 0 },
    ]
    while (stack.length > 0) {
      const current = stack.pop()!
      const isScope =
        isTsFunctionLike(ts, current.node) ||
        ts.isBlock(current.node) ||
        ts.isForStatement(current.node) ||
        ts.isForInStatement(current.node) ||
        ts.isForOfStatement(current.node) ||
        ts.isWhileStatement(current.node) ||
        ts.isDoStatement(current.node) ||
        ts.isSwitchStatement(current.node) ||
        ts.isCatchClause(current.node)
      const nextDepth = isScope ? current.depth + 1 : current.depth
      if (nextDepth > MAX_SCAN_SCOPE_DEPTH) {
        const line =
          sf.getLineAndCharacterOfPosition(current.node.getStart(sf)).line + 1
        return {
          stateReads: [],
          stateWrites: [],
          matchers: [],
          error: formatScanRefusalMessage(
            moduleName,
            sourceLines,
            line,
            `code nested too deep to scan: more than ${MAX_SCAN_SCOPE_DEPTH} scopes (functions, blocks, loops) open inside one another`,
          ),
        }
      }
      ts.forEachChild(current.node, child => {
        stack.push({ node: child, depth: nextDepth })
      })
    }
  }

  const declared = new Map<string, import('typescript').Identifier[]>()
  const read = new Map<string, import('typescript').Identifier[]>()
  const assignedAt = new Map<string, import('typescript').Identifier[]>()
  const loopAssigned = new Map<string, import('typescript').Identifier[]>()
  const stateCalls: Array<{
    call: import('typescript').CallExpression
    spelling: 'state.get' | 'state.set'
  }> = []
  const onCalls: import('typescript').CallExpression[] = []
  const libraryHelpers = new Set<string>(['atom', 'memberOf', 'derive'])
  const libraryCallSet = new Set<import('typescript').Node>()

  const pushMap = (
    map: Map<string, import('typescript').Identifier[]>,
    key: string,
    val: import('typescript').Identifier,
  ) => {
    const arr = map.get(key)
    if (arr) arr.push(val)
    else map.set(key, [val])
  }

  const isDeclarationId = (node: import('typescript').Identifier): boolean => {
    const p = node.parent
    if (!p) return false
    if (ts.isVariableDeclaration(p) && p.name === node) return true
    if (ts.isParameter(p) && p.name === node) return true
    if (ts.isBindingElement(p) && p.name === node) return true
    if (
      (ts.isFunctionDeclaration(p) ||
        ts.isFunctionExpression(p) ||
        ts.isClassDeclaration(p) ||
        ts.isClassExpression(p)) &&
      p.name === node
    ) {
      return true
    }
    if (
      (ts.isImportClause(p) && p.name === node) ||
      (ts.isImportSpecifier(p) && p.name === node) ||
      (ts.isNamespaceImport(p) && p.name === node)
    ) {
      return true
    }
    return false
  }

  const isNonValueId = (node: import('typescript').Identifier): boolean => {
    const p = node.parent
    if (!p) return false
    if (ts.isPropertyAccessExpression(p) && p.name === node) return true
    if (ts.isPropertyAssignment(p) && p.name === node) return true
    if (ts.isMethodDeclaration(p) && p.name === node) return true
    if (ts.isLabeledStatement(p) && p.label === node) return true
    if (ts.isBreakStatement(p) && p.label === node) return true
    if (ts.isContinueStatement(p) && p.label === node) return true
    if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return true
    return false
  }

  const visit = (node: import('typescript').Node): void => {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (
        op === ts.SyntaxKind.EqualsToken ||
        (op >= ts.SyntaxKind.FirstCompoundAssignment &&
          op <= ts.SyntaxKind.LastCompoundAssignment)
      ) {
        for (const id of collectPatternIdentifiers(ts, node.left)) {
          pushMap(assignedAt, id.text, id)
        }
      }
    } else if (
      ts.isPrefixUnaryExpression(node) ||
      ts.isPostfixUnaryExpression(node)
    ) {
      if (
        node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        for (const id of collectPatternIdentifiers(ts, node.operand)) {
          pushMap(assignedAt, id.text, id)
        }
      }
    } else if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      for (const id of collectPatternIdentifiers(ts, node.initializer)) {
        pushMap(assignedAt, id.text, id)
        pushMap(loopAssigned, id.text, id)
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === 'on') {
        onCalls.push(node)
      }
      if (ts.isIdentifier(callee) && libraryHelpers.has(callee.text)) {
        libraryCallSet.add(node)
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isPropertyAccessExpression(callee.expression) &&
        ts.isIdentifier(callee.expression.expression) &&
        callee.expression.expression.text === '$' &&
        callee.expression.name.text === 'state' &&
        (callee.name.text === 'get' || callee.name.text === 'set')
      ) {
        stateCalls.push({
          call: node,
          spelling: `state.${callee.name.text}` as 'state.get' | 'state.set',
        })
      }
    } else if (ts.isIdentifier(node)) {
      if (isDeclarationId(node)) {
        pushMap(declared, node.text, node)
      } else if (!isNonValueId(node)) {
        pushMap(read, node.text, node)
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sf, visit)

  const climbTo = (
    node: import('typescript').Node | undefined,
    pred: (n: import('typescript').Node) => boolean,
  ): import('typescript').Node | undefined => {
    let cur = node
    while (cur !== undefined) {
      if (pred(cur)) return cur
      cur = cur.parent
    }
    return undefined
  }

  const deferrerOf = (
    node: import('typescript').Node,
  ): import('typescript').Node | undefined =>
    climbTo(node.parent, n => isTsFunctionLike(ts, n))

  const declScopeOf = (
    id: import('typescript').Identifier,
  ): import('typescript').Node | 'unplaced' => {
    let cur: import('typescript').Node | undefined = id.parent
    while (
      cur &&
      (ts.isBindingElement(cur) ||
        ts.isObjectBindingPattern(cur) ||
        ts.isArrayBindingPattern(cur))
    ) {
      cur = cur.parent
    }
    if (!cur) return 'unplaced'
    if (ts.isVariableDeclaration(cur)) {
      const list = cur.parent
      const isConstOrLet =
        ts.isVariableDeclarationList(list) &&
        (list.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) !== 0
      return (
        climbTo(cur, n =>
          isConstOrLet ? isTsLexicalScope(ts, n) : isTsVarScope(ts, n),
        ) ?? 'unplaced'
      )
    }
    if (ts.isParameter(cur)) {
      return climbTo(cur, n => isTsFunctionLike(ts, n)) ?? 'unplaced'
    }
    if (ts.isFunctionDeclaration(cur) || ts.isClassDeclaration(cur)) {
      return cur.name === id
        ? (climbTo(cur.parent, n => isTsLexicalScope(ts, n)) ?? 'unplaced')
        : cur
    }
    if (
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isClassExpression(cur) ||
      ts.isCatchClause(cur)
    ) {
      return cur
    }
    if (
      ts.isImportClause(cur) ||
      ts.isImportSpecifier(cur) ||
      ts.isNamespaceImport(cur)
    ) {
      return sf
    }
    return 'unplaced'
  }

  type Span = {
    start: number
    end: number
    declaration: import('typescript').Identifier
  }
  const buildSpanLookup = (
    spans: Span[],
  ): ((pos: number) => import('typescript').Identifier | undefined) => {
    const events: Array<{
      place: number
      span: Span
      isStart: boolean
      rank: number
    }> = []
    for (const span of spans) {
      if (span.start >= span.end) continue
      events.push({
        place: span.start,
        span,
        isStart: true,
        rank: -span.end,
      })
      events.push({
        place: span.end,
        span,
        isStart: false,
        rank: -span.start,
      })
    }
    events.sort(
      (a, b) =>
        a.place - b.place ||
        Number(a.isStart) - Number(b.isStart) ||
        a.rank - b.rank,
    )
    const stack: Span[] = []
    const starts: number[] = []
    const owners: Array<import('typescript').Identifier | undefined> = []
    for (const ev of events) {
      if (ev.isStart) stack.push(ev.span)
      else {
        const idx = stack.lastIndexOf(ev.span)
        if (idx !== -1) stack.splice(idx, 1)
      }
      starts.push(ev.place)
      owners.push(stack.at(-1)?.declaration)
    }
    return (pos: number) => owners[binarySearchIntervalEnd(starts, pos) - 1]
  }

  const shadowCache = new Map<
    string,
    Map<
      import('typescript').Identifier,
      import('typescript').Identifier | undefined
    >
  >()
  const makeShadowOf = (mode: 'engine' | 'written') => {
    const fnCache = new Map<
      string,
      (pos: number) => import('typescript').Identifier | undefined
    >()
    return (
      id: import('typescript').Identifier,
    ): import('typescript').Identifier | undefined => {
      const cacheKey = `${mode}:${id.text}`
      let byId = shadowCache.get(cacheKey)
      if (!byId) {
        byId = new Map()
        shadowCache.set(cacheKey, byId)
      }
      if (byId.has(id)) return byId.get(id)
      let lookup = fnCache.get(id.text)
      if (!lookup) {
        const decls = declared.get(id.text) ?? []
        const spans: Span[] = []
        for (const decl of decls) {
          const scope = declScopeOf(decl)
          if (scope === 'unplaced' || ts.isSourceFile(scope)) continue
          if (ts.isSwitchStatement(scope)) {
            spans.push(
              {
                start: scope.getStart(sf),
                end: scope.expression.getStart(sf),
                declaration: decl,
              },
              {
                start: scope.expression.end,
                end: scope.end,
                declaration: decl,
              },
            )
            continue
          }
          // In "engine" mode, a parameter declaration shadows the whole function
          // (including parameter defaults); if the body redeclares the name,
          // "written" mode binds the body declaration across the body block.
          const targetScope =
            mode === 'engine' &&
            ts.isBlock(scope) &&
            isTsFunctionLike(ts, scope.parent)
              ? scope.parent
              : scope
          if (isTsScopeNode(ts, targetScope)) {
            spans.push({
              start: targetScope.getStart(sf),
              end: targetScope.end,
              declaration: decl,
            })
          }
        }
        lookup = buildSpanLookup(spans)
        fnCache.set(id.text, lookup)
      }
      const res = lookup(id.getStart(sf))
      byId.set(id, res)
      return res
    }
  }

  const shadowOf = makeShadowOf('engine')
  const writtenShadowOf = makeShadowOf('written')

  const initsCache = new Map<
    import('typescript').Node,
    Map<
      string,
      {
        id: import('typescript').Identifier
        init: import('typescript').Expression
        isVar: boolean
      }
    >
  >()
  const getInits = (scope: import('typescript').Node) => {
    const cached = initsCache.get(scope)
    if (cached) return cached
    const map = new Map<
      string,
      {
        id: import('typescript').Identifier
        init: import('typescript').Expression
        isVar: boolean
      }
    >()
    const stmts =
      ts.isSourceFile(scope) || ts.isBlock(scope) ? scope.statements : []
    for (const stmt of stmts) {
      if (!ts.isVariableStatement(stmt)) continue
      const isExported =
        stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ??
        false
      const flags = stmt.declarationList.flags
      const isConst = (flags & ts.NodeFlags.Const) !== 0
      const isTopVar =
        !isConst &&
        (flags & ts.NodeFlags.Let) === 0 &&
        ts.isSourceFile(scope) &&
        !isExported
      if (!isConst && !isTopVar) continue
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          map.set(decl.name.text, {
            id: decl.name,
            init: decl.initializer,
            isVar: isTopVar,
          })
        }
      }
    }
    initsCache.set(scope, map)
    return map
  }

  const exportingIds = new Set<string>()
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      const isExported =
        stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ??
        false
      if (isExported) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) exportingIds.add(decl.name.text)
        }
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const spec of stmt.exportClause.elements) {
        exportingIds.add((spec.propertyName ?? spec.name).text)
      }
    }
  }

  const formatVarRebound = (
    name: string,
    cause: keyof typeof VAR_REBOUND_MESSAGES,
    at: import('typescript').Node,
  ): string => {
    const line = sf.getLineAndCharacterOfPosition(at.getStart(sf)).line + 1
    return formatScanRefusalMessage(
      moduleName,
      sourceLines,
      line,
      `the var ${name}, read for a $.state reference, ${VAR_REBOUND_MESSAGES[cause]}`,
    )
  }

  const checkVarRebound = (
    varId: import('typescript').Identifier,
  ): string | undefined => {
    const name = varId.text
    const topDecls = (declared.get(name) ?? []).filter(
      d => declScopeOf(d) === sf,
    )
    if (topDecls.length > 1) {
      const at = topDecls.includes(varId) ? topDecls[1]! : varId
      return formatVarRebound(name, 'declared', at)
    }
    const isTopUnshadowed = (id: import('typescript').Identifier) =>
      writtenShadowOf(id) === undefined || writtenShadowOf(id) !== shadowOf(id)
    const assigned = (assignedAt.get(name) ?? []).filter(isTopUnshadowed)
    const unshadowedAssigned = assigned.find(
      a => writtenShadowOf(a) === undefined,
    )
    if (unshadowedAssigned) {
      return formatVarRebound(name, 'assigned', unshadowedAssigned)
    }
    if (assigned.length > 0) {
      return formatVarRebound(name, 'doubted', assigned[0]!)
    }
    const looped = loopAssigned.get(name)?.[0]
    if (looped) {
      return formatVarRebound(name, 'looped', looped)
    }
    const earlyRead = (read.get(name) ?? []).find(
      r =>
        r.getStart(sf) < varId.getStart(sf) &&
        deferrerOf(r) === undefined &&
        isTopUnshadowed(r),
    )
    if (earlyRead) {
      return formatVarRebound(name, 'early', earlyRead)
    }
    return undefined
  }

  // O(N log N) counted() & apart() for const plain-read verification (#237)
  type CountedEntry = {
    owned: Map<
      import('typescript').Identifier | undefined,
      Array<{ use: import('typescript').Identifier; at: number }>
    >
  }
  const countedCache = new Map<string, CountedEntry>()
  const counted = (name: string): CountedEntry => {
    const cached = countedCache.get(name)
    if (cached) return cached
    const uses = read.get(name) ?? []
    const owned = new Map<
      import('typescript').Identifier | undefined,
      Array<{ use: import('typescript').Identifier; at: number }>
    >()
    uses.forEach((use, at) => {
      const owner = writtenShadowOf(use)
      const list = owned.get(owner)
      if (list) list.push({ use, at })
      else owned.set(owner, [{ use, at }])
    })
    const entry = { owned }
    countedCache.set(name, entry)
    return entry
  }

  const apart = (
    name: string,
    exceptSet: ReadonlySet<import('typescript').Node>,
  ): {
    placed: Array<{ use: import('typescript').Identifier; at: number }>
    starts: number[]
  } => {
    const uses = read.get(name) ?? []
    const placed: Array<{ use: import('typescript').Identifier; at: number }> =
      []
    const starts: number[] = []
    uses.forEach((use, at) => {
      const callAncestor = climbTo(use, n => exceptSet.has(n))
      if (callAncestor !== undefined) return
      placed.push({ use, at })
      starts.push(use.getStart(sf))
    })
    return { placed, starts }
  }

  const isPlainConstUse = (
    use: import('typescript').Identifier,
    exceptSet: ReadonlySet<import('typescript').Node>,
  ): boolean => {
    const p = use.parent
    if (!p) return false
    if (climbTo(use, n => exceptSet.has(n)) !== undefined) return true
    if (ts.isSpreadAssignment(p) && ts.isObjectLiteralExpression(p.parent)) {
      return true
    }
    if (ts.isPropertyAccessExpression(p) && p.expression === use) return true
    return false
  }

  const resolveBinding = (
    id: import('typescript').Identifier,
  ):
    | {
        init: import('typescript').Expression
        scope: import('typescript').Node
        isVar: boolean
      }
    | { error: string }
    | undefined => {
    const eng = shadowOf(id)
    const writ = writtenShadowOf(id)
    if (eng !== writ) {
      return {
        error: `"${id.text}" is read among the parameters of a function whose body declares that name again: the engine may bind such a read apart from the text, so the value it names cannot be listed. Rename one of the two`,
      }
    }
    const scope =
      eng === undefined ? sf : (climbTo(eng, n => isTsScopeNode(ts, n)) ?? sf)
    const binding = getInits(scope).get(id.text)
    if (!binding) return undefined
    if (binding.isVar) {
      const varErr = checkVarRebound(binding.id)
      if (varErr !== undefined) return { error: varErr }
    }
    return { init: binding.init, scope, isVar: binding.isVar }
  }

  const exceptCalls = new Set<import('typescript').Node>([
    ...stateCalls.map(s => s.call),
    ...libraryCallSet,
  ])

  const stateConstsToCheck: Array<{
    read: import('typescript').Identifier
    scope: import('typescript').Node
    isVar: boolean
    spelling: string
  }> = []

  const resolveStateRef = (
    expr: import('typescript').Expression,
    spelling: string,
    seen = new Set<string>(),
  ): HookModuleStateRef[] | { error: string } | undefined => {
    if (ts.isIdentifier(expr)) {
      if (seen.has(expr.text)) return undefined
      const bound = resolveBinding(expr)
      if (!bound) return undefined
      if ('error' in bound) return bound
      stateConstsToCheck.push({
        read: expr,
        scope: bound.scope,
        isVar: bound.isVar,
        spelling,
      })
      return resolveStateRef(
        bound.init,
        spelling,
        new Set([...seen, expr.text]),
      )
    }
    if (ts.isCallExpression(expr)) {
      const callee = expr.expression
      const helper = ts.isIdentifier(callee) ? callee.text : undefined
      const arg0 = expr.arguments[0]
      if ((helper === 'atom' || helper === 'memberOf') && arg0) {
        return resolveStateRef(arg0, spelling, seen)
      }
      if (helper === 'derive' && arg0 && ts.isArrayLiteralExpression(arg0)) {
        const out: HookModuleStateRef[] = []
        for (const el of arg0.elements) {
          const r = resolveStateRef(el, spelling, seen)
          if (!r) return undefined
          if ('error' in r) return r
          out.push(...r)
        }
        return out
      }
      return undefined
    }
    if (!ts.isObjectLiteralExpression(expr)) return undefined
    let plugin: string | undefined
    let key: string | undefined
    for (const prop of expr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const sub = resolveStateRef(prop.expression, spelling, seen)
        if (!sub) return undefined
        if ('error' in sub) return sub
        if (sub[0]) {
          plugin = sub[0].plugin
          key = sub[0].key
        }
        continue
      }
      if (!ts.isPropertyAssignment(prop)) return undefined
      const propName = ts.isIdentifier(prop.name)
        ? prop.name.text
        : tsStringLiteral(ts, prop.name)
      if (propName === 'plugin') {
        const v = tsStringLiteral(ts, prop.initializer)
        if (v === undefined) return undefined
        plugin = v
      } else if (propName === 'key') {
        const v = tsStringLiteral(ts, prop.initializer)
        if (v === undefined) return undefined
        key = v
      }
    }
    if (plugin !== undefined && key !== undefined) {
      return [{ plugin, key }]
    }
    return undefined
  }

  const resolveMatcherObject = (
    expr: import('typescript').Expression,
    seen = new Set<string>(),
  ): Record<string, unknown> | { error: string } | undefined => {
    if (ts.isIdentifier(expr)) {
      if (seen.has(expr.text)) return undefined
      const bound = resolveBinding(expr)
      if (!bound) return undefined
      if ('error' in bound) return bound
      return resolveMatcherObject(bound.init, new Set([...seen, expr.text]))
    }
    if (!ts.isObjectLiteralExpression(expr)) return undefined
    const out: Record<string, unknown> = {}
    for (const prop of expr.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      const k = ts.isIdentifier(prop.name)
        ? prop.name.text
        : tsStringLiteral(ts, prop.name)
      if (k === undefined) continue
      const str = tsStringLiteral(ts, prop.initializer)
      if (str !== undefined) {
        out[k] = str
      } else if (ts.isArrayLiteralExpression(prop.initializer)) {
        const arr = prop.initializer.elements
          .map(el => tsStringLiteral(ts, el))
          .filter((v): v is string => v !== undefined)
        out[k] = arr
      }
    }
    return out
  }

  const stateReadsMap = new Map<string, HookModuleStateRef>()
  const stateWritesMap = new Map<string, HookModuleStateRef>()
  const matchers: Array<{ pattern: string; matcher: Record<string, unknown> }> =
    []

  for (const { call, spelling } of stateCalls) {
    const arg0 = call.arguments[0]
    if (!arg0) continue
    const resolved = resolveStateRef(arg0, spelling)
    if (resolved && 'error' in resolved) {
      return {
        stateReads: [],
        stateWrites: [],
        matchers: [],
        error: resolved.error,
      }
    }
    if (resolved) {
      const target = spelling === 'state.get' ? stateReadsMap : stateWritesMap
      for (const ref of resolved) {
        target.set(`${ref.plugin}\x00${ref.key}`, ref)
      }
    }
  }

  // Verify every const used in a $.state reference is only plain-read (O(log N) via apart)
  const checkedScopes = new Set<import('typescript').Node>()
  for (const item of stateConstsToCheck) {
    if (item.isVar || checkedScopes.has(item.scope)) continue
    checkedScopes.add(item.scope)
    const name = item.read.text
    if (ts.isSourceFile(item.scope) && exportingIds.has(name)) {
      return {
        stateReads: [],
        stateWrites: [],
        matchers: [],
        error: `the const ${name}, read as the reference of a $.${item.spelling} call, is also written through, handed on or exported here, and const does not freeze: what it holds at the call could not be listed.`,
      }
    }
    const owner = writtenShadowOf(item.read)
    const owned = (counted(name).owned.get(owner) ?? []).filter(
      h =>
        h.use.getStart(sf) >= item.scope.getStart(sf) &&
        h.use.end <= item.scope.end,
    )
    const badOwned = owned.find(h => !isPlainConstUse(h.use, exceptCalls))
    if (badOwned) {
      return {
        stateReads: [],
        stateWrites: [],
        matchers: [],
        error: `the const ${name}, read as the reference of a $.${item.spelling} call, is also written through, handed on or exported here, and const does not freeze: what it holds at the call could not be listed.`,
      }
    }
    const ap = apart(name, exceptCalls)
    const lo = binarySearchIntervalEnd(ap.starts, item.scope.getStart(sf) - 1)
    const hi = binarySearchIntervalEnd(ap.starts, item.scope.end - 1)
    const outside = ap.placed.slice(lo, hi)
    if (
      outside.length > 0 &&
      outside.some(h => !isPlainConstUse(h.use, exceptCalls))
    ) {
      return {
        stateReads: [],
        stateWrites: [],
        matchers: [],
        error: `the const ${name}, read as the reference of a $.${item.spelling} call, is also written through, handed on or exported here, and const does not freeze: what it holds at the call could not be listed.`,
      }
    }
  }

  for (const call of onCalls) {
    const pattern = tsStringLiteral(ts, call.arguments[0])
    if (pattern === undefined || call.arguments.length < 3) continue
    const matcherArg = call.arguments[1]
    if (!matcherArg) continue
    const resolved = resolveMatcherObject(matcherArg)
    if (resolved && 'error' in resolved && typeof resolved.error === 'string') {
      return {
        stateReads: [],
        stateWrites: [],
        matchers: [],
        error: resolved.error,
      }
    }
    if (resolved) {
      matchers.push({ pattern, matcher: resolved })
    }
  }

  return {
    stateReads: [...stateReadsMap.values()],
    stateWrites: [...stateWritesMap.values()],
    matchers,
  }
}

const DEFAULT_TYPES_CONTRACT = './types/index.d.ts'

type DeclaredPluginState = { plugin: string; keys: string[] }

function parsePluginStateDeclarations(
  dtsContent: string,
): DeclaredPluginState[] {
  let ts: typeof import('typescript')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ts = require('typescript') as typeof import('typescript')
  } catch {
    return []
  }
  const sf = ts.createSourceFile(
    'index.d.ts',
    dtsContent,
    ts.ScriptTarget.Latest,
    true,
  )
  const result: DeclaredPluginState[] = []
  const visit = (node: import('typescript').Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'PluginState') {
      for (const member of node.members) {
        if (
          ts.isPropertySignature(member) &&
          member.name &&
          member.type &&
          ts.isTypeLiteralNode(member.type)
        ) {
          const pluginName =
            ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
              ? member.name.text
              : undefined
          if (!pluginName) continue
          const keys: string[] = []
          for (const keyMember of member.type.members) {
            if (ts.isPropertySignature(keyMember) && keyMember.name) {
              const keyName =
                ts.isIdentifier(keyMember.name) ||
                ts.isStringLiteral(keyMember.name)
                  ? keyMember.name.text
                  : undefined
              if (keyName) keys.push(keyName)
            }
          }
          result.push({ plugin: pluginName, keys })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return result
}

async function readPluginTypesContract(pluginDir: string): Promise<{
  hasManifest: boolean
  owner: string
  declared: DeclaredPluginState[]
  conventional?: string
  refusal?: string
  isRefused: boolean
}> {
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json')
  let owner = path.basename(pluginDir)
  let manifestTypes: unknown
  let hasManifest = false
  try {
    const raw = await readFile(manifestPath, { encoding: 'utf-8' })
    const parsed = jsonParse(raw) as Record<string, unknown> | undefined
    if (parsed && typeof parsed === 'object') {
      hasManifest = true
      if (typeof parsed.name === 'string' && parsed.name.length > 0) {
        owner = parsed.name
      }
      manifestTypes = parsed.types
    }
  } catch {
    return { hasManifest: false, owner, declared: [], isRefused: false }
  }

  if (
    !hasManifest ||
    (manifestTypes !== undefined && typeof manifestTypes !== 'string')
  ) {
    return { hasManifest: false, owner, declared: [], isRefused: false }
  }

  const relContract = manifestTypes ?? DEFAULT_TYPES_CONTRACT
  const resolvedContract = path.resolve(pluginDir, relContract)
  const relCheck = path.relative(pluginDir, resolvedContract)
  const conventional =
    manifestTypes === undefined
      ? `the types contract at ${DEFAULT_TYPES_CONTRACT}`
      : undefined
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    const msg = `${relContract} leaves the plugin's folder`
    return {
      hasManifest: true,
      owner,
      declared: [],
      conventional,
      refusal: conventional
        ? `the file at ${DEFAULT_TYPES_CONTRACT} could not be taken as the types contract (${msg})`
        : msg,
      isRefused: true,
    }
  }

  try {
    const dtsContent = await readFile(resolvedContract, { encoding: 'utf-8' })
    return {
      hasManifest: true,
      owner,
      declared: parsePluginStateDeclarations(dtsContent),
      conventional,
      isRefused: false,
    }
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (
      manifestTypes === undefined &&
      (code === 'ENOENT' || code === 'ENOTDIR')
    ) {
      return { hasManifest: true, owner, declared: [], isRefused: false }
    }
    const msg = errorMessage(e)
    return {
      hasManifest: true,
      owner,
      declared: [],
      conventional,
      refusal: conventional
        ? `the file at ${DEFAULT_TYPES_CONTRACT} could not be taken as the types contract (${msg})`
        : msg,
      isRefused: true,
    }
  }
}

function validateModuleStateAgainstContract(params: {
  reads: HookModuleStateRef[]
  writes: HookModuleStateRef[]
  owner: string
  declared: DeclaredPluginState[]
  conventional?: string
  refusal?: string
}): string[] {
  const { reads, writes, owner, declared, conventional, refusal } = params
  const byPlugin = new Map<string, Set<string>>()
  for (const entry of declared) {
    const set = byPlugin.get(entry.plugin) ?? new Set<string>()
    for (const k of entry.keys) set.add(k)
    byPlugin.set(entry.plugin, set)
  }
  const problems: string[] = []
  for (const w of writes) {
    if (w.plugin !== owner) {
      problems.push(
        `$.state.set refers to ${w.plugin}.${w.key}, which ${w.plugin} owns: only a value's owner writes it (to change what is written, hook ${w.plugin}'s state.set and rewrite e.value)`,
      )
    }
  }
  for (const ref of [...reads, ...writes]) {
    if (ref.plugin !== owner) continue
    const hasKey = byPlugin.get(ref.plugin)?.has(ref.key) === true
    if (!hasKey) {
      const contractLabel = conventional ?? "the manifest's types contract"
      const suffix =
        refusal ??
        `${contractLabel} must name it in interface PluginState { ${ref.plugin}: { ${ref.key}: ... } }`
      const msg = `${ref.plugin}.${ref.key} is not declared: ${suffix}`
      if (!problems.includes(msg)) {
        problems.push(msg)
      }
    }
  }
  return problems
}

/**
 * Validate a plugin's hooks.json file. Unlike frontmatter, this one HARD-ERRORS
 * at runtime (pluginLoader uses .parse() not .safeParse()) — a bad hooks.json
 * breaks the whole plugin. Surfacing it here is essential.
 */
async function validateHooksJson(
  filePath: string,
  pluginDir?: string,
): Promise<ValidationResult> {
  let content: string
  try {
    content = await readFile(filePath, { encoding: 'utf-8' })
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    // ENOENT is fine — hooks are optional
    if (code === 'ENOENT') {
      return {
        success: true,
        errors: [],
        warnings: [],
        filePath,
        fileType: 'hooks',
      }
    }
    return {
      success: false,
      errors: [
        { path: 'file', message: `Failed to read file: ${errorMessage(e)}` },
      ],
      warnings: [],
      filePath,
      fileType: 'hooks',
    }
  }

  let parsed: unknown
  try {
    parsed = jsonParse(content)
  } catch (e) {
    return {
      success: false,
      errors: [
        {
          path: 'json',
          message:
            `Invalid JSON syntax: ${errorMessage(e)}. ` +
            `At runtime this breaks the entire plugin load.`,
        },
      ],
      warnings: [],
      filePath,
      fileType: 'hooks',
    }
  }

  const result = PluginHooksSchema().safeParse(parsed)
  if (!result.success) {
    return {
      success: false,
      errors: formatZodErrors(result.error),
      warnings: [],
      filePath,
      fileType: 'hooks',
    }
  }

  const warnings: ValidationWarning[] = []
  for (const message of collectUnknownPluginHooksJsonKeyWarnings(parsed)) {
    warnings.push({ path: 'hooks.json', message })
  }
  for (const hit of warnUnquotedPluginPlaceholders(result.data.hooks ?? {})) {
    warnings.push({
      path: `hooks.${hit.event}`,
      message: unquotedPluginPlaceholderWarningMessage(
        hit.placeholders,
        hit.command,
      ),
    })
  }

  const notes: string[] = []
  const gatingHooks: GatingHookInfo[] = []
  const hooksDir = path.dirname(filePath)
  const moduleEntries =
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    'modules' in parsed
      ? (parsed as { modules?: Record<string, unknown> }).modules
      : undefined
  const modulePaths: Array<[string, string]> = []
  if (moduleEntries && typeof moduleEntries === 'object') {
    for (const [modKey, modVal] of Object.entries(moduleEntries)) {
      if (typeof modVal === 'string') {
        modulePaths.push([modKey, path.resolve(hooksDir, modVal)])
      }
    }
  }
  if (modulePaths.length === 0) {
    modulePaths.push(
      ['register.ts', path.join(hooksDir, 'register.ts')],
      ['register.js', path.join(hooksDir, 'register.js')],
    )
  }
  const errors: ValidationError[] = []
  const policySettings = getSettingsForSource('policySettings')
  const managedHooksNote =
    policySettings?.disableAllHooks === true
      ? 'disableAllHooks in managed settings'
      : policySettings?.allowManagedHooksOnly === true
        ? 'only managed plugins and built-in plugins run (allowManagedHooksOnly / disableAllHooks)'
        : undefined
  const resolveRelativeModuleImport = (
    specifier: string,
    fromFile: string,
  ): { file: string; source: string } | undefined => {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      return undefined
    }
    const baseDir = path.dirname(
      path.isAbsolute(fromFile) ? fromFile : path.resolve(hooksDir, fromFile),
    )
    const rawTarget = path.resolve(baseDir, specifier)
    const candidates = [
      rawTarget,
      `${rawTarget}.ts`,
      `${rawTarget}.tsx`,
      `${rawTarget}.mts`,
      `${rawTarget}.js`,
      `${rawTarget}.mjs`,
      `${rawTarget}.jsx`,
    ]
    if (rawTarget.endsWith('.js') || rawTarget.endsWith('.mjs')) {
      const stem = rawTarget.replace(/\.(?:m?js)$/, '')
      candidates.unshift(`${stem}.ts`, `${stem}.mts`, `${stem}.tsx`)
    }
    for (const candidate of candidates) {
      try {
        const src = readFileSync(candidate, 'utf-8')
        return { file: candidate, source: src }
      } catch {
        // try next extension
      }
    }
    return undefined
  }
  for (const [modName, modFullPath] of modulePaths) {
    try {
      const modSrc = await readFile(modFullPath, { encoding: 'utf-8' })
      if (managedHooksNote !== undefined) {
        notes.push(
          `[${modName}] hooks are skipped here (does not load where only managed hooks may): ${managedHooksNote}`,
        )
      }
      const analysis = analyzeGatingHooksInSource(modName, modSrc, {
        resolveImport: (spec, from) =>
          resolveRelativeModuleImport(
            spec,
            from === modName ? modFullPath : from,
          ),
      })
      notes.push(...analysis.notes)
      gatingHooks.push(...analysis.gatingHooks)
      const stateAnalysis = analyzeHookModuleStateAndMatchers(modName, modSrc)
      if (stateAnalysis.error !== undefined) {
        errors.push({
          path: `modules.${modName}`,
          message: stateAnalysis.error,
        })
      } else {
        for (const ref of stateAnalysis.stateReads) {
          notes.push(`[${modName}] state.get: ${ref.plugin}.${ref.key}`)
        }
        for (const ref of stateAnalysis.stateWrites) {
          notes.push(`[${modName}] state.set: ${ref.plugin}.${ref.key}`)
        }
        if (
          stateAnalysis.stateReads.length > 0 ||
          stateAnalysis.stateWrites.length > 0
        ) {
          const resolvedPluginDir =
            pluginDir ?? path.dirname(path.dirname(filePath))
          const contract = await readPluginTypesContract(resolvedPluginDir)
          if (contract.hasManifest) {
            if (
              contract.isRefused &&
              contract.refusal &&
              contract.conventional === undefined
            ) {
              errors.push({
                path: `modules.${modName}`,
                message: contract.refusal,
              })
            } else {
              const stateProblems = validateModuleStateAgainstContract({
                reads: stateAnalysis.stateReads,
                writes: stateAnalysis.stateWrites,
                owner: contract.owner,
                declared: contract.declared,
                conventional: contract.conventional,
                refusal: contract.refusal,
              })
              for (const msg of stateProblems) {
                errors.push({
                  path: `modules.${modName}`,
                  message: msg,
                })
              }
            }
          }
        }
      }
    } catch {
      // Missing or unreadable module handled elsewhere
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    filePath,
    fileType: 'hooks',
    ...(notes.length > 0 && { notes }),
    ...(gatingHooks.length > 0 && { gatingHooks }),
  }
}

/**
 * Recursively collect .md files under a directory. Uses withFileTypes to
 * avoid a stat per entry. Returns absolute paths so error messages stay
 * readable.
 */
async function collectMarkdown(
  dir: string,
  isSkillsDir: boolean,
): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw e
  }

  // Skills use <name>/SKILL.md — only descend one level, only collect SKILL.md.
  // Matches the runtime loader: single .md files in skills/ are NOT loaded,
  // and subdirectories of a skill dir aren't scanned. Paths are speculative
  // (the subdir may lack SKILL.md); the caller handles ENOENT.
  if (isSkillsDir) {
    return entries
      .filter(e => e.isDirectory())
      .map(e => path.join(dir, e.name, 'SKILL.md'))
  }

  // Commands/agents: recurse and collect all .md files.
  const out: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdown(full, false)))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Validate the content files inside a plugin directory — skills, agents,
 * commands, and hooks.json. Scans the default component directories (the
 * manifest can declare custom paths but the default layout covers the vast
 * majority of plugins; this is a linter, not a loader).
 *
 * Returns one ValidationResult per file that has errors or warnings. A clean
 * plugin returns an empty array.
 */
export async function validatePluginContents(
  pluginDir: string,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = []

  const dirs: Array<['skill' | 'agent' | 'command', string]> = [
    ['skill', path.join(pluginDir, 'skills')],
    ['agent', path.join(pluginDir, 'agents')],
    ['command', path.join(pluginDir, 'commands')],
  ]

  for (const [fileType, dir] of dirs) {
    const files = await collectMarkdown(dir, fileType === 'skill')
    for (const filePath of files) {
      let content: string
      try {
        content = await readFile(filePath, { encoding: 'utf-8' })
      } catch (e: unknown) {
        // ENOENT is expected for speculative skill paths (subdirs without SKILL.md)
        if (isENOENT(e)) continue
        results.push({
          success: false,
          errors: [
            { path: 'file', message: `Failed to read: ${errorMessage(e)}` },
          ],
          warnings: [],
          filePath,
          fileType,
        })
        continue
      }
      const r = validateComponentFile(filePath, content, fileType)
      if (r.errors.length > 0 || r.warnings.length > 0) {
        results.push(r)
      }
    }
  }

  const hooksResult = await validateHooksJson(
    path.join(pluginDir, 'hooks', 'hooks.json'),
    pluginDir,
  )
  if (
    hooksResult.errors.length > 0 ||
    hooksResult.warnings.length > 0 ||
    (hooksResult.notes?.length ?? 0) > 0 ||
    (hooksResult.gatingHooks?.length ?? 0) > 0
  ) {
    results.push(hooksResult)
  }

  return results
}

/**
 * densable 2.1.233 #14 — validate a bare skills directory (no plugin.json).
 * Accepts:
 * - path ending with `.claude/skills` or `skills`
 * - path that contains skill subdirs with SKILL.md
 * Aggregates content validation into a single ValidationResult.
 */
async function tryValidateBareSkillsDirectory(
  absolutePath: string,
): Promise<ValidationResult | null> {
  const base = path.basename(absolutePath)
  // densable 2.1.233 #14: path is skills/ or .../.claude/skills
  // (base==='skills' already covers parentBase==='.claude')
  const looksLikeSkillsDir =
    base === 'skills' ||
    absolutePath.replace(/\\/g, '/').endsWith('/.claude/skills')

  // Prefer validatePluginContents when this is a plugin root that has skills/
  // but no manifest — or when the path itself is the skills directory.
  let scanRoot = absolutePath
  if (looksLikeSkillsDir) {
    // validatePluginContents expects plugin root with skills/ child — pass parent
    // when we're already inside skills/, else scan absolutePath as skills root.
    scanRoot = path.dirname(absolutePath)
  }

  // If not clearly a skills path, probe for SKILL.md under skills/ or direct children
  if (!looksLikeSkillsDir) {
    const nestedSkills = path.join(absolutePath, 'skills')
    try {
      const st = await stat(nestedSkills)
      if (st.isDirectory()) {
        scanRoot = absolutePath
      } else {
        return null
      }
    } catch {
      // Maybe absolutePath is itself a single skill dir with SKILL.md
      try {
        await stat(path.join(absolutePath, 'SKILL.md'))
        const content = await readFile(path.join(absolutePath, 'SKILL.md'), {
          encoding: 'utf-8',
        })
        return validateComponentFile(
          path.join(absolutePath, 'SKILL.md'),
          content,
          'skill',
        )
      } catch {
        return null
      }
    }
  }

  const contentResults =
    looksLikeSkillsDir && base === 'skills'
      ? await validateSkillsDirOnly(absolutePath)
      : await validatePluginContents(scanRoot)

  // Empty results: still a valid skills surface with no issues (success).
  // (Previously `looksLikeSkillsDir || contentResults` was always true for
  // arrays — dead `return null`.)
  if (contentResults.length === 0) {
    return {
      success: true,
      errors: [],
      warnings: [],
      filePath: absolutePath,
      fileType: 'skill',
    }
  }

  const errors = contentResults.flatMap(r =>
    r.errors.map(e => ({
      ...e,
      path: `${path.relative(absolutePath, r.filePath) || r.filePath}: ${e.path}`,
    })),
  )
  const warnings = contentResults.flatMap(r =>
    r.warnings.map(w => ({
      ...w,
      path: `${path.relative(absolutePath, r.filePath) || r.filePath}: ${w.path}`,
    })),
  )
  return {
    success: errors.length === 0,
    errors,
    warnings,
    filePath: absolutePath,
    fileType: 'skill',
  }
}

/** Scan only a skills directory (not a full plugin root). */
async function validateSkillsDirOnly(
  skillsDir: string,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = []
  const files = await collectMarkdown(skillsDir, true)
  for (const filePath of files) {
    let content: string
    try {
      content = await readFile(filePath, { encoding: 'utf-8' })
    } catch (e: unknown) {
      if (isENOENT(e)) continue
      results.push({
        success: false,
        errors: [
          { path: 'file', message: `Failed to read: ${errorMessage(e)}` },
        ],
        warnings: [],
        filePath,
        fileType: 'skill',
      })
      continue
    }
    const r = validateComponentFile(filePath, content, 'skill')
    if (r.errors.length > 0 || r.warnings.length > 0) {
      results.push(r)
    }
  }
  return results
}

/**
 * Validate a manifest file or directory (auto-detects type)
 */
export async function validateManifest(
  filePath: string,
): Promise<ValidationResult> {
  const absolutePath = path.resolve(filePath)

  // Stat path to check if it's a directory — handle ENOENT inline
  let stats: Stats | null = null
  try {
    stats = await stat(absolutePath)
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      throw e
    }
  }

  if (stats?.isDirectory()) {
    // Look for manifest files in .claude-plugin directory
    // Prefer marketplace.json over plugin.json
    const marketplacePath = path.join(
      absolutePath,
      '.claude-plugin',
      'marketplace.json',
    )
    const marketplaceResult = await validateMarketplaceManifest(marketplacePath)
    // Only fall through if the marketplace file was not found (ENOENT)
    if (marketplaceResult.errors[0]?.code !== 'ENOENT') {
      return marketplaceResult
    }

    const pluginPath = path.join(absolutePath, '.claude-plugin', 'plugin.json')
    const pluginResult = await validatePluginManifest(pluginPath)
    if (pluginResult.errors[0]?.code !== 'ENOENT') {
      return pluginResult
    }

    // densable 2.1.233 #14 — bare `.claude/skills` (or a skills/ dir without
    // plugin.json) still validates skill markdown content.
    const bareSkills = await tryValidateBareSkillsDirectory(absolutePath)
    if (bareSkills) {
      return bareSkills
    }

    return {
      success: false,
      errors: [
        {
          path: 'directory',
          message: `No manifest found in directory. Expected .claude-plugin/marketplace.json or .claude-plugin/plugin.json`,
        },
      ],
      warnings: [],
      filePath: absolutePath,
      fileType: 'plugin',
    }
  }

  const manifestType = detectManifestType(filePath)

  switch (manifestType) {
    case 'plugin':
      return validatePluginManifest(filePath)
    case 'marketplace':
      return validateMarketplaceManifest(filePath)
    case 'unknown': {
      // Try to parse and guess based on content (matches official marketplace add / Fs heuristic)
      try {
        const content = await readFile(absolutePath, { encoding: 'utf-8' })
        const parsed = jsonParse(stripBOM(content))
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        ) {
          const obj = parsed as Record<string, unknown>
          const keys = Object.keys(obj)
          const marketplaceShape = PluginMarketplaceSchema().shape
          const pluginShape = PluginManifestSchema().shape
          const hasMarketplaceOnlyKey = keys.some(
            k =>
              Object.hasOwn(marketplaceShape, k) &&
              !Object.hasOwn(pluginShape, k),
          )
          const hasPluginOnlyKey = keys.some(
            k =>
              Object.hasOwn(pluginShape, k) &&
              !Object.hasOwn(marketplaceShape, k),
          )
          if (
            Array.isArray(obj.plugins) ||
            (Object.hasOwn(obj, 'plugins') && Object.hasOwn(obj, 'owner')) ||
            (hasMarketplaceOnlyKey && !hasPluginOnlyKey)
          ) {
            return validateMarketplaceManifest(filePath)
          }
        }
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code === 'ENOENT') {
          return {
            success: false,
            errors: [
              {
                path: 'file',
                message: `File not found: ${absolutePath}`,
              },
            ],
            warnings: [],
            filePath: absolutePath,
            fileType: 'plugin', // Default to plugin for error reporting
          }
        }
        // Fall through to default validation for other errors (e.g., JSON parse)
      }

      // Default: validate as plugin manifest
      return validatePluginManifest(filePath)
    }
  }
}

export type ReadmeInstallAdvice = {
  file: string
  message: string
  installLine: string
}

const README_ADVICE_PLACEHOLDER = '<owner>/<repo>'
const README_ADVICE_VALID_NAME_MAX = 128
const README_ADVICE_FIELD_CAP = 1024
const README_INSTALL_FLAGS = new Set([
  '--marketplace',
  '--scope',
  '-s',
  '--config',
  '--accept-command',
])

function trimReadmeToken(token: string): string {
  const keep = [...token].map(ch => !'`\'"()<>[]*.,;:!?'.includes(ch))
  const first = keep.findIndex(Boolean)
  if (first === -1) return ''
  const last = keep.findLastIndex(Boolean)
  return token.slice(first, last + 1)
}

function parseReadmeInstallLines(content: string): {
  bySource: Set<string>
  byName: Set<string>
} {
  const lines = content
    .split('\n')
    .flatMap(line => line.split(/plugin[ \t]+(?:install|i)[ \t]+/).slice(1))
    .map(part =>
      part
        .split(/\s+/)
        .map(trimReadmeToken)
        .filter(tok => tok !== ''),
    )

  const hasMarketplaceFlag = (tokens: string[]): boolean =>
    tokens.some((tok, idx) =>
      tok.startsWith('--marketplace=')
        ? /^--marketplace=[^<>]+$/.test(tok)
        : tok === '--marketplace' &&
          /^[^-<>][^<>]*$/.test(tokens[idx + 1] ?? ''),
    )

  const extractPositionalName = (tokens: string[]): string =>
    tokens.find(
      (tok, idx) =>
        !tok.startsWith('-') &&
        !README_INSTALL_FLAGS.has(tokens[idx - 1] ?? ''),
    ) ?? ''

  const extractQualifiedName = (tokens: string[]): string => {
    const qualified = tokens.find(tok => tok.lastIndexOf('@') > 0) ?? ''
    const at = qualified.indexOf('@')
    return at > 0 && qualified.length > at + 1 && !/[<>]/.test(qualified)
      ? qualified.slice(0, at)
      : ''
  }

  return {
    bySource: new Set(
      lines.filter(hasMarketplaceFlag).map(extractPositionalName),
    ),
    byName: new Set(lines.map(extractQualifiedName)),
  }
}

function readmeInstallsPlugin(
  installs: { bySource: Set<string>; byName: Set<string> },
  name: string,
): boolean {
  return (
    installs.byName.has(name) || installs.bySource.has(trimReadmeToken(name))
  )
}

function truncateAdviceField(
  text: string,
  cap = README_ADVICE_FIELD_CAP,
): string {
  return text.length <= cap ? text : `${text.slice(0, cap - 1)}…`
}

function formatReadmeAdviceSentence(
  name: string,
  listing?: { root: string; entry?: unknown },
): string {
  const missingEntry = listing !== undefined && listing.entry === undefined
  return [
    `This README has no line that installs "${name}"`,
    'from a marketplace.',
    ...(missingEntry
      ? [
          path.join(listing.root, '.claude-plugin', 'marketplace.json'),
          'has no entry for it. Add one.',
        ]
      : []),
    `${missingEntry ? 'Then add' : 'Add'} the install line,`,
    'which works in one step on Claude Code 2.1.275 or later.',
  ].join(' ')
}

function inferMarketplaceRepoFromGitConfig(
  configText: string,
): string | undefined {
  const urlMatch =
    configText.match(/^\s*pushurl\s*=\s*(.+)$/m) ??
    configText.match(/^\s*url\s*=\s*(.+)$/m)
  const raw = urlMatch?.[1]?.trim() ?? ''
  if (!raw) return undefined
  const sshScp = raw.match(/^(?:[^@]+@)?([^:]+):([^/]+)\/(.+?)(?:\.git)?$/)
  if (sshScp && !raw.includes('://')) {
    const [, host, owner, repo] = sshScp
    return host === 'github.com'
      ? `${owner}/${repo}`
      : `https://${host}/${owner}/${repo}.git`
  }
  try {
    const parsed = new URL(raw)
    const parts = parsed.pathname.replace(/^\/+|\.git$/g, '').split('/')
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return parsed.hostname === 'github.com'
        ? `${parts[0]}/${parts[1]}`
        : `https://${parsed.hostname}/${parts[0]}/${parts[1]}.git`
    }
  } catch {
    return undefined
  }
  return undefined
}

async function readReadmeInfo(
  dir: string,
): Promise<
  | { file: string; installs: { bySource: Set<string>; byName: Set<string> } }
  | undefined
> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter(e => e.isFile() && /^readme(\.[a-z0-9.-]+)?$/i.test(e.name))
    .map(e => e.name)
  const chosen =
    candidates.find(n => n.toLowerCase() === 'readme.md') ??
    candidates.toSorted()[0]
  if (!chosen) return undefined
  const filePath = path.join(dir, chosen)
  const text = await readFile(filePath, { encoding: 'utf-8' }).catch(
    () => undefined,
  )
  if (text === undefined) return undefined
  return { file: filePath, installs: parseReadmeInstallLines(text) }
}

/**
 * Collect non-fatal README install-line advice for `claude plugin validate` (#352).
 * Never changes validation success or exit code, even under `--strict`.
 */
export async function collectReadmeInstallAdvice(
  targetPath: string,
  primaryResult: ValidationResult | undefined,
  extraResults: readonly (ValidationResult | undefined)[] = [],
): Promise<ReadmeInstallAdvice[]> {
  if (!primaryResult) return []
  const allValid = [primaryResult, ...extraResults].every(
    r => r === undefined || r.errors.length === 0,
  )
  if (!allValid) return []

  const manifestDir = path.dirname(primaryResult.filePath)
  const rootDir = path.dirname(manifestDir)
  if (path.basename(manifestDir) !== '.claude-plugin') return []

  const readPluginName = async (dir: string): Promise<string | undefined> => {
    try {
      const raw = await readFile(
        path.join(dir, '.claude-plugin', 'plugin.json'),
        { encoding: 'utf-8' },
      )
      const parsed = jsonParse(raw) as { name?: unknown }
      return typeof parsed?.name === 'string' ? parsed.name : undefined
    } catch {
      return undefined
    }
  }

  const targets: Array<{
    root: string
    name: string
    listing?: { root: string; pluginsCount: number; entry?: unknown }
  }> = []

  if (primaryResult.fileType === 'plugin') {
    targets.push({
      root: rootDir,
      name: (await readPluginName(rootDir)) ?? '',
    })
  } else if (
    primaryResult.fileType === 'marketplace' &&
    path.resolve(targetPath) === path.resolve(rootDir)
  ) {
    try {
      const raw = await readFile(
        path.join(rootDir, '.claude-plugin', 'marketplace.json'),
        { encoding: 'utf-8' },
      )
      const mkt = jsonParse(raw) as {
        plugins?: Array<{ name?: string; source?: unknown }>
      }
      const plugins = Array.isArray(mkt?.plugins) ? mkt.plugins : []
      for (const entry of plugins.slice(0, 64)) {
        if (
          typeof entry.source === 'string' &&
          !entry.source.split(/[\\/]/).includes('..') &&
          typeof entry.name === 'string'
        ) {
          targets.push({
            root: path.resolve(rootDir, entry.source),
            name: entry.name,
            listing: { root: rootDir, pluginsCount: plugins.length, entry },
          })
        }
      }
      if (!targets.some(t => path.resolve(t.root) === path.resolve(rootDir))) {
        const selfName = (await readPluginName(rootDir)) ?? ''
        if (selfName) {
          const selfEntry = plugins.find(p => p.name === selfName)
          targets.push({
            root: rootDir,
            name: selfEntry?.name ?? selfName,
            listing: {
              root: rootDir,
              pluginsCount: plugins.length,
              entry: selfEntry,
            },
          })
        }
      }
    } catch {
      return []
    }
  }

  const readmeCache = new Map<
    string,
    Awaited<ReturnType<typeof readReadmeInfo>>
  >()
  const getReadme = async (dir: string) => {
    if (!readmeCache.has(dir)) {
      readmeCache.set(dir, await readReadmeInfo(dir))
    }
    return readmeCache.get(dir)
  }

  const advice: ReadmeInstallAdvice[] = []
  for (const t of targets) {
    if (
      !t.name ||
      t.name.length > README_ADVICE_VALID_NAME_MAX ||
      /[\s<>]/.test(t.name)
    ) {
      continue
    }
    const localReadme = await getReadme(t.root)
    const isNested =
      t.listing?.entry !== undefined &&
      path.resolve(t.listing.root) !== path.resolve(t.root)
    const singlePluginMarketplace = isNested && t.listing!.pluginsCount === 1
    const needMarketplaceReadme =
      isNested &&
      (singlePluginMarketplace ||
        (localReadme !== undefined &&
          !readmeInstallsPlugin(localReadme.installs, t.name)))
    const marketReadme = needMarketplaceReadme
      ? await getReadme(t.listing!.root)
      : undefined
    if (
      [localReadme, marketReadme].some(
        r => r !== undefined && readmeInstallsPlugin(r.installs, t.name),
      )
    ) {
      continue
    }
    const chosen =
      localReadme ?? (singlePluginMarketplace ? marketReadme : undefined)
    if (!chosen) continue

    let marketplaceSource: string | undefined
    if (t.listing !== undefined) {
      const gitCfg = await readFile(
        path.join(t.listing.root, '.git', 'config'),
        { encoding: 'utf-8' },
      ).catch(() => undefined)
      if (gitCfg !== undefined) {
        marketplaceSource = inferMarketplaceRepoFromGitConfig(gitCfg)
      }
    }

    const extraHint =
      t.listing === undefined
        ? [
            'Validate the folder that holds its marketplace.json',
            `to have ${README_ADVICE_PLACEHOLDER} filled in,`,
            'and the name its marketplace lists it under.',
          ].join(' ')
        : marketplaceSource !== undefined
          ? ''
          : [
              `In it, replace ${README_ADVICE_PLACEHOLDER}`,
              'with the repository that holds the marketplace.',
            ].join(' ')

    const sentence = formatReadmeAdviceSentence(t.name, t.listing)
    const message = truncateAdviceField(
      extraHint ? `${sentence} ${extraHint}` : sentence,
    )
    const installLine = truncateAdviceField(
      `/plugin install ${t.name} --marketplace ${marketplaceSource ?? README_ADVICE_PLACEHOLDER}`,
    )
    advice.push({
      file: truncateAdviceField(chosen.file),
      message,
      installLine,
    })
  }
  return advice
}

export function formatReadmeInstallAdvice(
  advice: readonly ReadmeInstallAdvice[],
  icons: { info?: string; pointer?: string } = {},
): string[] {
  if (advice.length === 0) return []
  const info = icons.info ?? 'i'
  const pointer = icons.pointer ?? '>'
  return [
    `${info} Advice (does not change the verdict):`,
    '',
    ...advice.flatMap(item => [
      `  ${pointer} ${item.file}: ${item.message}`,
      `      ${item.installLine}`,
    ]),
    '',
  ]
}
