import { feature } from 'bun:bundle'
import { posix as posixPath, win32 as win32Path } from 'path'
import { z } from 'zod/v4'
import { SandboxSettingsSchema } from '../../entrypoints/sandboxTypes.js'
import { EDITOR_MODES, NOTIFICATION_CHANNELS } from '../configConstants.js'
import { isEnvTruthy } from '../envUtils.js'
import { lazySchema } from '../lazySchema.js'
import { PERMISSION_MODES } from '../permissions/PermissionMode.js'
import { MarketplaceSourceSchema } from '../plugins/schemas.js'
import { PermissionRuleSchema } from './permissionValidation.js'

// Re-export hook schemas and types from centralized location for backward compatibility
export {
  type AgentHook,
  type BashCommandHook,
  type HookCommand,
  HookCommandSchema,
  type HookMatcher,
  HookMatcherSchema,
  HooksSchema,
  type HooksSettings,
  type HttpHook,
  type McpToolHook,
  type PromptHook,
} from '../../schemas/hooks.js'

// Also import for use within this file
import { type HookCommand, HooksSchema } from '../../schemas/hooks.js'
import { count } from '../array.js'

/**
 * Schema for environment variables
 */
export const EnvironmentVariablesSchema = lazySchema(() =>
  z.record(z.string(), z.coerce.string()),
)

/**
 * Schema for permissions section
 */
export const PermissionsSchema = lazySchema(() =>
  z
    .object({
      allow: z
        .array(PermissionRuleSchema())
        .optional()
        .describe('List of permission rules for allowed operations'),
      deny: z
        .array(PermissionRuleSchema())
        .optional()
        .describe('List of permission rules for denied operations'),
      ask: z
        .array(PermissionRuleSchema())
        .optional()
        .describe(
          'List of permission rules that should always prompt for confirmation',
        ),
      defaultMode: z
        .enum(PERMISSION_MODES)
        .optional()
        .describe('Default permission mode when Claude Code needs access'),
      disableBypassPermissionsMode: z
        .enum(['disable'])
        .optional()
        .describe('Disable the ability to bypass permission prompts'),
      ...(feature('TRANSCRIPT_CLASSIFIER')
        ? {
            disableAutoMode: z
              .enum(['disable'])
              .optional()
              .describe('Disable auto mode'),
          }
        : {}),
      blockReadsOutsideWorkingDirectories: z
        .boolean()
        .optional()
        .describe(
          'When true, file tools refuse reads outside the working directories',
        ),
      blockFileToolReadsOutsideWorkingDirectories: z
        .boolean()
        .optional()
        .describe(
          "@internal For the program that starts Claude Code: read only from --settings at the launch; ignored in settings sent to a running session and in user, project, local and managed settings. Refuse reads outside the working directories, other than a shell command's, in every permission mode.",
        ),
      blockWritesOutsideWorkingDirectories: z
        .boolean()
        .optional()
        .describe(
          'Refuse file-tool writes (Write, Edit, NotebookEdit) outside the working directories in every permission mode; true in any settings source wins.',
        ),
      denyInsteadOfPrompting: z
        .boolean()
        .optional()
        .describe(
          "Never wait for a person to answer a tool permission prompt: a call that would prompt is denied at once, the model is told, and the turn carries on. This is what --permission-prompts none does for -p, in every kind of session, subagents and agent teams included. Allow rules, the permission mode, auto mode's classifier and PermissionRequest hooks decide first, as they do without it; it only ever denies, and allows nothing.",
        ),
      additionalDirectories: z
        .array(z.string())
        .transform(dirs => dirs.filter(dir => !dir.includes('\0')))
        .optional()
        .describe('Additional directories to include in the permission scope'),
    })
    .passthrough(),
)

/**
 * Schema for extra marketplaces defined in repository settings
 * Same as KnownMarketplace but without lastUpdated (which is managed automatically)
 */
export const ExtraKnownMarketplaceSchema = lazySchema(() =>
  z.object({
    source: MarketplaceSourceSchema().describe(
      'Where to fetch the marketplace from',
    ),
    installLocation: z
      .string()
      .optional()
      .describe(
        'Local cache path where marketplace manifest is stored (auto-generated if not provided)',
      ),
    autoUpdate: z
      .boolean()
      .optional()
      .describe(
        'Whether to automatically update this marketplace and its installed plugins on startup',
      ),
    // Official 2.1.325 #2361: deprecated and ignored so existing settings load.
    pluginDigests: z
      .record(z.string(), z.array(z.string()).catch([]))
      .optional()
      .catch(undefined)
      .describe(
        'Deprecated and ignored: settings that hold it still load. A plugin takes the organization tier when managed settings enable it, declare its marketplace with a remote source and list it in prependPlugins or appendPlugins.',
      ),
  }),
)

/**
 * Schema for allowed MCP server entry in enterprise allowlist.
 * Supports matching by serverName, serverCommand, or serverUrl (mutually exclusive).
 */
export const AllowedMcpServerEntrySchema = lazySchema(() =>
  z
    .object({
      serverName: z
        .string()
        .regex(
          /^[a-zA-Z0-9_-]+$/,
          'Server name can only contain letters, numbers, hyphens, and underscores',
        )
        .optional()
        .describe('Name of the MCP server that users are allowed to configure'),
      serverCommand: z
        .array(z.string())
        .min(1, 'Server command must have at least one element (the command)')
        .optional()
        .describe(
          'Command array [command, ...args] to match exactly for allowed stdio servers',
        ),
      serverUrl: z
        .string()
        .optional()
        .describe(
          'URL pattern with wildcard support (e.g., "https://*.example.com/*") for allowed remote MCP servers',
        ),
      // Future extensibility: allowedTransports, requiredArgs, maxInstances, etc.
    })
    .refine(
      data => {
        const defined = count(
          [
            data.serverName !== undefined,
            data.serverCommand !== undefined,
            data.serverUrl !== undefined,
          ],
          Boolean,
        )
        return defined === 1
      },
      {
        message:
          'Entry must have exactly one of "serverName", "serverCommand", or "serverUrl"',
      },
    ),
)

/**
 * Schema for denied MCP server entry in enterprise denylist.
 * Supports matching by serverName, serverCommand, or serverUrl (mutually exclusive).
 */
export const DeniedMcpServerEntrySchema = lazySchema(() =>
  z
    .object({
      serverName: z
        .string()
        .regex(
          /^[a-zA-Z0-9_-]+$/,
          'Server name can only contain letters, numbers, hyphens, and underscores',
        )
        .optional()
        .describe('Name of the MCP server that is explicitly blocked'),
      serverCommand: z
        .array(z.string())
        .min(1, 'Server command must have at least one element (the command)')
        .optional()
        .describe(
          'Command array [command, ...args] to match exactly for blocked stdio servers',
        ),
      serverUrl: z
        .string()
        .optional()
        .describe(
          'URL pattern with wildcard support (e.g., "https://*.example.com/*") for blocked remote MCP servers',
        ),
      // Future extensibility: reason, blockedSince, etc.
    })
    .refine(
      data => {
        const defined = count(
          [
            data.serverName !== undefined,
            data.serverCommand !== undefined,
            data.serverUrl !== undefined,
          ],
          Boolean,
        )
        return defined === 1
      },
      {
        message:
          'Entry must have exactly one of "serverName", "serverCommand", or "serverUrl"',
      },
    ),
)

/**
 * Unified schema for settings files
 *
 * ⚠️ BACKWARD COMPATIBILITY NOTICE ⚠️
 *
 * This schema defines the structure of user settings files (.claude/settings.json).
 * We support backward-compatible changes! Here's how:
 *
 * ✅ ALLOWED CHANGES:
 * - Adding new optional fields (always use .optional())
 * - Adding new enum values (keeping existing ones)
 * - Adding new properties to objects
 * - Making validation more permissive
 * - Using union types for gradual migration (e.g., z.union([oldType, newType]))
 *
 * ❌ BREAKING CHANGES TO AVOID:
 * - Removing fields (mark as deprecated instead)
 * - Removing enum values
 * - Making optional fields required
 * - Making types more restrictive
 * - Renaming fields without keeping the old name
 *
 * TO ENSURE BACKWARD COMPATIBILITY:
 * 1. Run: npm run test:file -- test/utils/settings/backward-compatibility.test.ts
 * 2. If tests fail, you've introduced a breaking change
 * 3. When adding new fields, add a test to BACKWARD_COMPATIBILITY_CONFIGS
 *
 * The settings system handles backward compatibility automatically:
 * - When updating settings, invalid fields are preserved in the file (see settings.ts lines 233-249)
 * - Type coercion via z.coerce (e.g., env vars convert numbers to strings)
 * - .passthrough() preserves unknown fields in permissions object
 * - Invalid settings are simply not used, but remain in the file to be fixed by the user
 */

/**
 * Surfaces lockable by `strictPluginOnlyCustomization`. Exported so the
 * schema preprocess (below) and the runtime helper (pluginOnlyPolicy.ts)
 * share one source of truth.
 */
export const CUSTOMIZATION_SURFACES = [
  'skills',
  'agents',
  'hooks',
  'mcp',
] as const

const MAX_INT32_MS = 2_147_483_647
const POLICY_HELPER_MAX_RETRIES = 5
const POLICY_HELPER_FORBIDDEN_CHARS_RE = /[\p{Cc}\u2028\u2029]|\p{DI}/u
const POLICY_HELPER_WIN32_EXE_SUFFIX_RE = /\.(exe|ps1)$/i
const POLICY_HELPER_PS1_SUFFIX_RE = /\.ps1$/i
const POLICY_HELPER_PS1_WILDCARD_RE = /[[\]`*?]/
const POLICY_HELPER_PS1_WILDCARD_ERROR =
  'a .ps1 path must not contain "[", "]", "`", "*", or "?" on Windows (PowerShell resolves them as wildcard syntax)'
const POLICY_HELPER_BOTH_PATH_AND_SCRIPT_ERROR =
  'exactly one of path/script must be configured'
const POLICY_HELPER_SCRIPT_INTERPRETER_PAIR_ERROR =
  '"script" and "interpreter" must be configured together'
const POLICY_HELPER_WINDOWS_ASCII_SCRIPT_ERROR =
  'script must be ASCII-only on Windows (PowerShell decodes stdin with the console OEM code page); spell non-ASCII characters as escapes, e.g. [char]0x00E9'
const POLICY_HELPER_ENTRY_REQUIRED_ERROR =
  'Entry must carry "path" (a helper executable) or "script" + "interpreter" (an inline helper), and/or "defaultSettings" (a static settings payload)'

const POLICY_HELPER_PLATFORMS = ['macos', 'linux', 'windows', 'wsl'] as const
type PolicyHelperPlatform = (typeof POLICY_HELPER_PLATFORMS)[number]

const POLICY_HELPER_MAP_KEYS = [...POLICY_HELPER_PLATFORMS, 'default'] as const
const POLICY_HELPER_ENTRY_FIELDS = [
  'path',
  'script',
  'interpreter',
  'outputBehavior',
  'onFailure',
  'retries',
  'timeoutMs',
  'refreshIntervalMs',
  'defaultSettings',
] as const
const POLICY_HELPER_ENVELOPE_FIELDS = [
  'managedSettings',
  'appendSystemPrompt',
] as const
const POLICY_HELPER_CLEAR_FIELDS = [
  'path',
  'script',
  'defaultSettings',
] as const

function isWin32DeviceNamespace(filePath: string): boolean {
  return /^[\\/]{2}[?.][\\/]/.test(filePath)
}

function isWin32UncPath(filePath: string): boolean {
  const normalized = filePath.replaceAll('/', '\\')
  if (isWin32DeviceNamespace(normalized)) return false
  return /^\\{2}[^\\]/.test(normalized)
}

function isPosixNetOrNetworkServersMount(filePath: string): boolean {
  if (!filePath.startsWith('/')) return false
  const parts: string[] = []
  for (const segment of filePath.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
    if (
      (parts.length === 2 && parts[0]?.toLowerCase() === 'net') ||
      (parts.length === 3 &&
        parts[0]?.toLowerCase() === 'network' &&
        parts[1]?.toLowerCase() === 'servers')
    ) {
      return true
    }
  }
  return false
}

function isMacosSpecialRoot(filePath: string): boolean {
  if (!/\/\.(?:vol|file|nofollow|resolve)(?:\/|$)/i.test(filePath)) return false
  if (!filePath.startsWith('/')) return false
  const parts: string[] = []
  for (const segment of filePath.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
    if (
      parts.length === 1 &&
      /^\.(?:vol|file|nofollow|resolve)$/i.test(segment)
    ) {
      return true
    }
  }
  return false
}

function isPosixNetworkAutomountRoot(filePath: string): boolean {
  return (
    isPosixNetOrNetworkServersMount(filePath) ||
    /^\/network\/servers(\/|$)/i.test(filePath) ||
    isMacosSpecialRoot(filePath)
  )
}

function isPosixMagicLinkRoot(filePath: string): boolean {
  return /^\/(proc|dev\/(fd|stdin|stdout|stderr))(\/|$)/i.test(filePath)
}

function isNormalizedPolicyHelperPath(
  filePath: string,
  mode: 'win32' | 'posix',
  opts: {
    rejectDriveRelative?: boolean
    rejectUnc?: boolean
    rejectNetworkRoot?: boolean
    rejectMagicLinkRoot?: boolean
  } = {},
): boolean {
  if (mode === 'win32') {
    const normalizedSep = filePath.replaceAll('/', '\\')
    if (isWin32DeviceNamespace(normalizedSep)) return false
    const isUnc = isWin32UncPath(normalizedSep)
    if (opts.rejectUnc && isUnc) return false
    if (opts.rejectDriveRelative) {
      if (
        !/^[A-Za-z]:\\/.test(normalizedSep) &&
        !isUnc &&
        /^(\\|[A-Za-z]:)/.test(normalizedSep)
      ) {
        return false
      }
    }
    if (win32Path.normalize(normalizedSep) !== normalizedSep) return false
    const parts = normalizedSep.split('\\')
    if (parts.some(seg => seg === '.' || seg === '..')) return false
    if (
      parts.some(
        (seg, idx) =>
          /[. ]$/.test(seg) ||
          (seg.includes(':') && !(idx === 0 && /^[A-Za-z]:$/.test(seg))),
      )
    ) {
      return false
    }
    const rest = normalizedSep.startsWith('\\\\')
      ? normalizedSep.slice(2)
      : normalizedSep
    if (/\\{2}/.test(rest)) return false
    return (
      !normalizedSep.endsWith('\\') || /^([A-Za-z]:)?\\$/.test(normalizedSep)
    )
  }
  if (opts.rejectNetworkRoot && isPosixNetworkAutomountRoot(filePath)) {
    return false
  }
  if (opts.rejectMagicLinkRoot && isPosixMagicLinkRoot(filePath)) {
    return false
  }
  if (posixPath.normalize(filePath) !== filePath) return false
  if (filePath.split('/').some(seg => seg === '.' || seg === '..')) return false
  if (/\/{2}/.test(filePath)) return false
  return !filePath.endsWith('/') || filePath === '/'
}

function isWellFormedUtf16(value: string): boolean {
  if (typeof value.isWellFormed === 'function') {
    return value.isWellFormed()
  }
  return !/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(
    value,
  )
}

function nullableOptional<T extends z.ZodType>(schema: T) {
  return z
    .preprocess(
      value => (value === null ? undefined : value),
      schema.optional(),
    )
    .optional()
}

function clampedIntMin(minValue: number) {
  return z
    .number()
    .int()
    .min(minValue)
    .transform(value => Math.min(value, MAX_INT32_MS))
}

function isClearedPolicyHelperEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    POLICY_HELPER_CLEAR_FIELDS.some(key => record[key] === null) &&
    POLICY_HELPER_CLEAR_FIELDS.every(
      key => record[key] === null || record[key] === undefined,
    )
  )
}

export const PolicyHelperSchema = lazySchema(() =>
  z.object({
    path: z.string().describe('Absolute path to the helper executable'),
    timeoutMs: nullableOptional(clampedIntMin(1000)),
    refreshIntervalMs: nullableOptional(
      z.union([z.literal(0), clampedIntMin(60_000)]),
    ),
  }),
)

function createPolicyHelperPathSchema(platform: PolicyHelperPlatform) {
  const mode = platform === 'windows' ? 'win32' : 'posix'
  const opts = {
    rejectDriveRelative: platform === 'windows',
    rejectUnc: platform === 'windows',
    rejectNetworkRoot: platform !== 'windows',
    rejectMagicLinkRoot: platform !== 'windows',
    requireWin32ExecutableSuffix: platform === 'windows',
  }
  return z
    .string()
    .max(1024, { message: 'path must be at most 1024 characters' })
    .refine(value => !POLICY_HELPER_FORBIDDEN_CHARS_RE.test(value), {
      message:
        'path must not contain control, line/paragraph-separator, or invisible (default-ignorable) characters',
    })
    .refine(
      value => (mode === 'win32' ? win32Path : posixPath).isAbsolute(value),
      { message: 'path must be absolute' },
    )
    .refine(
      value =>
        !(mode === 'win32' && opts.requireWin32ExecutableSuffix) ||
        POLICY_HELPER_WIN32_EXE_SUFFIX_RE.test(value),
      { message: 'path must end in .exe or .ps1 on Windows' },
    )
    .refine(
      value =>
        mode !== 'win32' ||
        !(
          POLICY_HELPER_PS1_SUFFIX_RE.test(value) &&
          POLICY_HELPER_PS1_WILDCARD_RE.test(value)
        ),
      { message: POLICY_HELPER_PS1_WILDCARD_ERROR },
    )
    .refine(value => isNormalizedPolicyHelperPath(value, mode, opts), {
      message:
        mode === 'win32'
          ? 'path must be in normalized form: no "." or ".." segments, no doubled or trailing separators, no component ending in "." or a space, no ":" outside the drive letter, no device-namespace (\\\\?\\) prefix, no drive-relative (\\dir or C:name) or UNC (\\\\server\\share) form'
          : 'path must be in normalized form: no "." or ".." segments, no doubled or trailing separators, and not under a network automount root (/net/<host>, /Network/Servers, or macOS /.vol /.file /.nofollow /.resolve) or a kernel magic-link root (/proc, /dev/fd)',
    })
    .describe('Absolute path to the helper executable')
}

function createPolicyHelperScriptSchema(platform: PolicyHelperPlatform) {
  return z
    .string({ message: 'script must be a string' })
    .min(1, { message: 'script must not be empty' })
    .max(65_536, { message: 'script must be at most 65536 characters' })
    .refine(value => !value.includes('\0'), {
      message: 'script must not contain NUL bytes',
    })
    .refine(value => isWellFormedUtf16(value), {
      message: 'script must be valid UTF-8 (no lone surrogates)',
    })
    .refine(value => platform !== 'windows' || !/[\u0080-\uffff]/.test(value), {
      message: POLICY_HELPER_WINDOWS_ASCII_SCRIPT_ERROR,
    })
    .describe(
      'Inline helper script, delivered to the fixed interpreter over stdin (never written to disk)',
    )
}

function createPolicyHelperInterpreterSchema(platform: PolicyHelperPlatform) {
  return (
    platform === 'windows'
      ? z.literal('pwsh', {
          message:
            "interpreter must be 'pwsh' on windows ('sh' is not supported there)",
        })
      : z.literal('sh', {
          message: "interpreter must be 'sh' on macos/linux/wsl",
        })
  ).describe(
    "Fixed interpreter for `script`: 'sh' (/bin/sh) on macos/linux/wsl entries; 'pwsh' (PowerShell at its fixed install locations, never PATH) on the windows entry",
  )
}

const PolicyHelperOutputBehaviorSchema = () =>
  z
    .enum(['replace', 'merge'])
    .describe(
      "How the helper's managedSettings compose with the settings of the source that delivered this entry: 'replace' (default) — the output is the policy; 'merge' — the output is deep-merged over that source's own settings the way merged managed sources compose (helper scalars win, arrays union, objects merge — except fallbackModel, forceLoginOrgUUID, gatewayInternalNetworks, sandbox.filesystem.allowRead, sandbox.credentials.awsPairs, sandbox.ripgrep and the restriction allowlists such as allowedMcpServers, allowedProviders, availableModels and allowedHttpHookUrls, which are the helper's whole value when it emits one; tighten a permission with a deny), so a failed helper costs only the delta",
    )

const PolicyHelperOnFailureSchema = () =>
  z.preprocess(
    value =>
      value === undefined || value === 'continue' || value === 'refuse'
        ? value
        : 'refuse',
    z
      .enum(['continue', 'refuse'])
      .describe(
        `What happens when this entry's helper fails at startup (bad path, missing file or interpreter, non-zero exit, timeout, oversize or invalid output) and no static settings payload (this entry's own, the linux entry's on WSL, or the map's "default") applies in its place: 'refuse' — Claude Code does not start, naming the failure; 'continue' — Claude Code starts without the helper's output, on the delivering source's own settings, with a /status notice. Default: 'refuse' when the entry comes from MDM or the managed settings file, 'continue' when it comes from remote managed settings. Any other value is treated as 'refuse', with a /status notice. The install and update commands start no session and are never refused over a remote entry: they report the refusal in /status. An entry whose other fields fail validation runs no helper; from MDM or the managed settings file, any value but 'continue' on it then refuses to start Claude Code until the entry is fixed, unless a static settings payload (the entry's own, kept when it validates, the linux entry's for a wsl one, or the map's "default") serves in its place. From remote, a non-interactive session runs the helper off settings verified this session without the interactive approval, so 'refuse' there too means the helper ran and failed; a launch whose remote settings could not be verified this session (offline, fetch failed) starts without the helper regardless; and a failure first reached after the session has started (settings verified or approved mid-session, which on a machine that only ever runs non-interactively is every launch) ends a session no person watches (non-interactive, a background session no client is attached to, or a teammate session) as the refused start would have, and leaves a watched interactive one (a terminal, with or without remote control, or an attached background session) running under a /status notice with its next start refused. Background refresh failures always keep the last good output whatever this says`,
      ),
  )

const PolicyHelperRetriesSchema = () =>
  z
    .number()
    .int()
    .min(0)
    .transform(value => Math.min(value, POLICY_HELPER_MAX_RETRIES))
    .describe(
      "How many more times to run this entry's helper when a run fails to execute — it could not be launched, exited non-zero, or was stopped at timeoutMs — before that counts as a failure (a non-negative integer; default 0, a single attempt; above 5 is treated as 5). Attempts are separated by a short randomized backoff (from 250 ms, doubling per attempt, at most 4 s each) and each attempt gets the full timeoutMs, so a start that waits on the helper can wait up to (retries + 1) × timeoutMs plus the backoff. Output the helper did produce and that was refused — oversized, not a JSON object, an invalid envelope, or settings that fail validation — is not retried, and neither is an invalid path. Applies alike at startup and on each background refresh; only once the attempts are used up do the entry's failure rules (a static settings payload in its place, onFailure, the refresh notice) apply, naming the last attempt's failure",
    )

const PolicyHelperDefaultPayloadSchema = lazySchema(() =>
  z.record(z.string(), z.unknown()).superRefine((record, ctx) => {
    for (const key of ['policyHelper', 'policyHelpers'] as const) {
      if (record[key] !== undefined && record[key] !== null) {
        ctx.addIssue({
          code: 'custom',
          message: `must not contain "${key}" — the default payload is applied as managed settings and cannot configure further policy helpers`,
        })
      }
    }
    for (const key of POLICY_HELPER_ENTRY_FIELDS) {
      if (record[key] !== undefined && record[key] !== null) {
        ctx.addIssue({
          code: 'custom',
          message: `must not contain "${key}" — a static payload is a managed-settings object, not a policyHelpers entry; entry fields (${POLICY_HELPER_ENTRY_FIELDS.join('/')}) belong on the per-OS entries (policyHelpers.${POLICY_HELPER_PLATFORMS.join('/')})`,
        })
      }
    }
    for (const key of POLICY_HELPER_ENVELOPE_FIELDS) {
      if (record[key] !== undefined && record[key] !== null) {
        ctx.addIssue({
          code: 'custom',
          message: `must not contain "${key}" — a static payload is the managedSettings SUBTREE, not the helper's stdout envelope; paste the object your helper emits UNDER "managedSettings", not the envelope around it`,
        })
      }
    }
    for (const key of POLICY_HELPER_MAP_KEYS) {
      if (record[key] !== undefined && record[key] !== null) {
        ctx.addIssue({
          code: 'custom',
          message: `must not contain "${key}" — a static payload is the VALUE of a policyHelpers key (a managed-settings object), never another policyHelpers map; don't paste the map or its "${key}" line inside the slot`,
        })
      }
    }
  }),
)

function validatePolicyHelperEntryCombo(entry: {
  path?: string
  script?: string
  interpreter?: string
  defaultSettings?: Record<string, unknown>
}): string | null {
  const { path, script, interpreter, defaultSettings } = entry
  if (path !== undefined && script !== undefined) {
    return POLICY_HELPER_BOTH_PATH_AND_SCRIPT_ERROR
  }
  if ((script === undefined) !== (interpreter === undefined)) {
    return POLICY_HELPER_SCRIPT_INTERPRETER_PAIR_ERROR
  }
  if (
    path === undefined &&
    script === undefined &&
    defaultSettings === undefined
  ) {
    return POLICY_HELPER_ENTRY_REQUIRED_ERROR
  }
  return null
}

function createPolicyHelperPlatformEntrySchema(platform: PolicyHelperPlatform) {
  return PolicyHelperSchema()
    .omit({ path: true })
    .extend({
      path: nullableOptional(createPolicyHelperPathSchema(platform)),
      script: nullableOptional(createPolicyHelperScriptSchema(platform)),
      interpreter: nullableOptional(
        createPolicyHelperInterpreterSchema(platform),
      ),
      outputBehavior: nullableOptional(PolicyHelperOutputBehaviorSchema()),
      onFailure: nullableOptional(PolicyHelperOnFailureSchema()),
      retries: nullableOptional(PolicyHelperRetriesSchema()),
      defaultSettings: z
        .preprocess(
          value => (value === null ? undefined : value),
          PolicyHelperDefaultPayloadSchema().optional(),
        )
        .optional(),
    })
    .check(ctx => {
      if (ctx.issues.length > 0) return
      const err = validatePolicyHelperEntryCombo(ctx.value)
      if (err !== null) {
        ctx.issues.push({
          code: 'custom',
          message: err,
          input: ctx.value,
        })
      }
    })
}

function policyHelperPlatformSlot(platform: PolicyHelperPlatform) {
  return z
    .preprocess(value => {
      if (value === null) return undefined
      if (isClearedPolicyHelperEntry(value)) return undefined
      return value
    }, createPolicyHelperPlatformEntrySchema(platform).optional())
    .optional()
}

export const PolicyHelpersSchema = lazySchema(() =>
  z.object({
    macos: policyHelperPlatformSlot('macos'),
    linux: policyHelperPlatformSlot('linux'),
    windows: policyHelperPlatformSlot('windows'),
    wsl: policyHelperPlatformSlot('wsl'),
    default: z
      .preprocess(
        value => (value === null ? undefined : value),
        PolicyHelperDefaultPayloadSchema().optional(),
      )
      .optional(),
  }),
)

const INVALID_FOOTER_LINK_ENTRY = Object.freeze({
  type: 'invalid-entry-stripped' as const,
})

const FooterLinkEntrySchema = lazySchema(() =>
  z.union([
    z
      .object({
        type: z
          .literal('regex')
          .describe(
            'Config variant. This client understands "regex": matches turn output and builds a URL from named capture groups. Entries with other variants are preserved but skipped at runtime.',
          ),
        pattern: z
          .string()
          .describe(
            'Regex matched against turn output (tool results and assistant text)',
          ),
        url: z
          .string()
          .describe(
            'Link target. {name} placeholders are filled from named regex capture groups, e.g. (?<id>...) -> {id}. Values are URL-encoded; the origin must be literal in the template. The scheme must be https, http, or a recognized editor or workspace deep-link scheme: vscode, vscode-insiders, cursor, windsurf, zed, jetbrains, idea, slack, linear, notion, figma.',
          ),
        label: z
          .string()
          .optional()
          .describe(
            'Badge text. {name} placeholders filled from named capture groups; defaults to the full match.',
          ),
      })
      .passthrough(),
    z
      .object({
        type: z
          .string()
          .describe(
            'Config variant discriminator for entries this client does not understand; the entry is preserved as-is and skipped at runtime.',
          ),
      })
      .passthrough(),
  ]),
)

const GATEWAY_INTERNAL_NETWORKS_UNREADABLE = '(unreadable)'

const MANAGED_MCP_SERVER_NAME_ERROR =
  'server names may only contain letters, numbers, hyphens and underscores, and may not be constructor, prototype, __proto__, __defineGetter__, __defineSetter__, __lookupGetter__ or __lookupSetter__'

const MANAGED_MCP_SERVERS_RECORD_ERROR =
  '"managedMcpServers" must be an object keyed by server name (the .mcp.json mcpServers shape; Claude Desktop\'s array form of its same-named key is not accepted here: use the server name as the key and "type" instead of "transport"). No managed MCP servers are installed from it until it is fixed.'

const MANAGED_MCP_DISALLOWED_KEYS = [
  'command',
  'args',
  'env',
  'headersHelper',
] as const

const MANAGED_MCP_ALLOWED_TYPES = new Set(['http', 'streamable-http', 'sse'])
const MANAGED_MCP_CONTROL_OR_FORMAT_RE = /[\p{Cc}\p{Cf}\u2028\u2029]/u
const MANAGED_MCP_CONTROL_OR_FORMAT_GLOBAL_RE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu
const MANAGED_MCP_ENV_VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/
const MANAGED_MCP_URL_MAX_LEN = 65_536
const MANAGED_MCP_AUTH_META_URL_MAX_LEN = 4096
const MANAGED_MCP_REQUEST_TIMEOUT_CAP_MS = 300_000

function isValidManagedMcpServerName(name: string): boolean {
  return (
    /^[A-Za-z0-9_-]+$/.test(name) &&
    !(name in Object.prototype && name.startsWith('__')) &&
    name !== 'constructor' &&
    name !== 'prototype'
  )
}

function isHttpsUrlWithHost(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hostname !== ''
  } catch {
    return false
  }
}

function walkManagedMcpStrings(
  value: unknown,
  pathPrefix = '',
  depth = 0,
): Array<[string, string, boolean]> {
  if (typeof value === 'string') return [[pathPrefix, value, false]]
  if (depth > 4 || value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => {
    const escapedKey = key.replace(
      MANAGED_MCP_CONTROL_OR_FORMAT_GLOBAL_RE,
      ch => `\\u${(ch.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`,
    )
    const nextPath = pathPrefix ? `${pathPrefix}.${escapedKey}` : escapedKey
    return [
      [nextPath, key, true] as [string, string, boolean],
      ...walkManagedMcpStrings(child, nextPath, depth + 1),
    ]
  })
}

function foldManagedMcpServerConfig<
  T extends {
    timeout?: number
    request_timeout_ms?: number
    orgMaxPermission?: string | null
  },
>({ request_timeout_ms, ...rest }: T) {
  const result: Omit<T, 'request_timeout_ms'> & { timeout?: number } = {
    ...rest,
    ...(rest.timeout === undefined && request_timeout_ms !== undefined
      ? {
          timeout: Math.min(
            request_timeout_ms,
            MANAGED_MCP_REQUEST_TIMEOUT_CAP_MS,
          ),
        }
      : {}),
  }
  if (result.orgMaxPermission === 'allow') {
    delete result.orgMaxPermission
  }
  return result
}

const ManagedMcpOAuthSchema = lazySchema(() =>
  z.object({
    clientId: z.string().optional(),
    callbackPort: z.number().int().positive().optional(),
    authServerMetadataUrl: z
      .string()
      .refine(url => url.length <= MANAGED_MCP_AUTH_META_URL_MAX_LEN, {
        abort: true,
        message: 'authServerMetadataUrl is too long',
      })
      .url()
      .startsWith('https://', {
        message: 'authServerMetadataUrl must use https://',
      })
      .optional(),
    scopes: z.string().min(1).optional(),
    xaa: z.boolean().optional(),
  }),
)

const ManagedMcpToolEntrySchema = lazySchema(() =>
  z.object({
    name: z.string(),
    permission_policy: z
      .enum(['always_allow', 'always_ask', 'always_deny'])
      .optional(),
  }),
)

const ManagedMcpUrlFieldSchema = () =>
  z.string().refine(url => url.length <= MANAGED_MCP_URL_MAX_LEN, {
    abort: true,
    message: 'url is too long',
  })

const ManagedMcpCommonFields = () => ({
  url: ManagedMcpUrlFieldSchema(),
  headers: z.record(z.string(), z.string()).optional(),
  headersHelper: z.string().optional(),
  oauth: ManagedMcpOAuthSchema().optional(),
  timeout: z.number().int().positive().optional(),
  request_timeout_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .catch(undefined)
    .describe('@internal CCR backend wire hint; folded into timeout at parse.'),
  tools: z.array(ManagedMcpToolEntrySchema()).optional(),
  alwaysLoad: z.boolean().optional(),
  displayName: z.string().optional().catch(undefined),
  bareElicitationCapability: z.boolean().optional(),
  discoveryCache: z.boolean().optional(),
  role: z.literal('comms').optional().catch(undefined),
  toolPermissions: z
    .record(z.string(), z.enum(['allow', 'ask', 'blocked']))
    .optional(),
  orgMaxPermission: z.string().nullable().catch('malformed').optional(),
})

const ManagedMcpHttpServerSchema = lazySchema(() =>
  z
    .object({
      type: z
        .enum(['http', 'streamable-http'])
        .transform(() => 'http' as const),
      ...ManagedMcpCommonFields(),
    })
    .transform(foldManagedMcpServerConfig),
)

const ManagedMcpSseServerSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('sse'),
      ...ManagedMcpCommonFields(),
    })
    .transform(foldManagedMcpServerConfig),
)

export const ManagedMcpServerConfigSchema = lazySchema(() =>
  z
    .record(z.string(), z.unknown())
    .check(ctx => {
      const addIssue = (path: string[], message: string) => {
        ctx.issues.push({
          code: 'custom',
          path,
          message,
          input: ctx.value,
        })
      }
      for (const disallowed of MANAGED_MCP_DISALLOWED_KEYS) {
        if (Object.hasOwn(ctx.value, disallowed)) {
          addIssue(
            [disallowed],
            `"${disallowed}" is not allowed in managed settings: only http/sse URL servers can be delivered this way, and a managed settings document must not name a program to run`,
          )
        }
      }
      if (
        typeof ctx.value.type !== 'string' ||
        !MANAGED_MCP_ALLOWED_TYPES.has(ctx.value.type)
      ) {
        addIssue(
          ['type'],
          'managed settings can only deliver "http" or "sse" servers',
        )
      }
      const url = ctx.value.url
      if (typeof url === 'string' && !isHttpsUrlWithHost(url)) {
        addIssue(
          ['url'],
          'managed settings servers must use a valid https:// url',
        )
      }
      for (const [entryPath, str, isKey] of walkManagedMcpStrings(ctx.value)) {
        if (MANAGED_MCP_CONTROL_OR_FORMAT_RE.test(str)) {
          addIssue(
            entryPath.split('.'),
            'contains control or invisible format characters (in a key or a value); a managed settings document must not be able to print escape sequences',
          )
        } else if (!isKey && MANAGED_MCP_ENV_VAR_RE.test(str)) {
          addIssue(
            entryPath.split('.'),
            "${VAR} references are not expanded in managed settings; use a literal value (a managed settings document must not read the user's environment)",
          )
        }
      }
    })
    .pipe(z.union([ManagedMcpHttpServerSchema(), ManagedMcpSseServerSchema()])),
)

function createKnownMarketplacesRecordSchema(keyName: string) {
  return z.record(z.string(), ExtraKnownMarketplaceSchema()).check(ctx => {
    for (const [key, entry] of Object.entries(ctx.value)) {
      if (entry.source.source === 'settings' && entry.source.name !== key) {
        ctx.issues.push({
          code: 'custom',
          input: entry.source.name,
          path: [key, 'source', 'name'],
          message:
            `Settings-sourced marketplace name must match its ${keyName} key ` +
            `(got key "${key}" but source.name "${entry.source.name}")`,
        })
      }
    }
  })
}

export const SettingsSchema = lazySchema(() =>
  z
    .object({
      $schema: z
        .string()
        .optional()
        .describe('JSON Schema reference for Claude Code settings'),
      apiKeyHelper: z
        .string()
        .optional()
        .describe('Path to a script that outputs authentication values'),
      proxyAuthHelper: z
        .string()
        .optional()
        .describe(
          'Shell command that outputs a Proxy-Authorization header value (EAP)',
        ),
      awsCredentialExport: z
        .string()
        .optional()
        .describe('Path to a script that exports AWS credentials'),
      awsAuthRefresh: z
        .string()
        .optional()
        .describe('Path to a script that refreshes AWS authentication'),
      gcpAuthRefresh: z
        .string()
        .optional()
        .describe(
          'Command to refresh GCP authentication (e.g., gcloud auth application-default login)',
        ),
      policyHelper: z
        .preprocess(value => {
          if (value === null) return undefined
          if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            (value as Record<string, unknown>).path === null
          ) {
            return undefined
          }
          return value
        }, PolicyHelperSchema().optional())
        .describe(
          'Executable that computes managed settings at startup. Honored only from admin-controlled policy sources.',
        ),
      policyHelpers: z
        .preprocess(
          value => (value === null ? undefined : value),
          PolicyHelpersSchema().optional(),
        )
        .describe(
          '@internal Per-OS variant of policyHelper, keyed by platform: macos, linux, windows, wsl, plus an optional "default" entry that is a STATIC settings payload (a JSON object of managed settings, not a helper). Each per-OS entry carries a helper — a "path", or an inline "script" + "interpreter" delivered to a fixed interpreter over stdin, either with timeoutMs/refreshIntervalMs — its own static "defaultSettings" payload, or both; an entry may be payload-only. Selection for a platform walks its chain (the platform\'s own entry; on wsl the linux entry next): the first helper on the chain wins over policyHelper; if no helper is configured — or the selected helper fails at startup or refresh — the first payload applies (the chain\'s "defaultSettings" in platform-specific-first order, then the top-level "default", applied with no process spawned; unrecognized platforms reach only "default"); with no payload either, policyHelper. Honored from admin-controlled policy sources, and from remote managed settings — a payload of plain policy as delivered, like any other remote key; a helper, or a payload carrying anything the managed-settings approval dialog lists, only once the settings are verified this session and approved there (policyHelper itself is never honored from remote).',
        ),
      // Gated so the SDK generator (which runs without CLAUDE_CODE_ENABLE_XAA)
      // doesn't surface this in GlobalClaudeSettings. Read via getXaaIdpSettings().
      // .passthrough() on the outer object keeps an existing settings.json key
      // alive across env-var-off sessions — it's just not schema-validated then.
      ...(isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_XAA)
        ? {
            xaaIdp: z
              .object({
                issuer: z
                  .string()
                  .url()
                  .describe('IdP issuer URL for OIDC discovery'),
                clientId: z
                  .string()
                  .describe("Claude Code's client_id registered at the IdP"),
                callbackPort: z
                  .number()
                  .int()
                  .positive()
                  .optional()
                  .describe(
                    'Fixed loopback callback port for the IdP OIDC login. ' +
                      'Only needed if the IdP does not honor RFC 8252 port-any matching.',
                  ),
              })
              .optional()
              .describe(
                'XAA (SEP-990) IdP connection. Configure once; all XAA-enabled MCP servers reuse this.',
              ),
          }
        : {}),
      fileSuggestion: z
        .object({
          type: z.literal('command'),
          command: z.string(),
        })
        .optional()
        .describe('Custom file suggestion configuration for @ mentions'),
      respectGitignore: z
        .boolean()
        .optional()
        .describe(
          'Whether file picker should respect .gitignore files (default: true). ' +
            'Note: .ignore files are always respected.',
        ),
      breakReminder: z
        .object({
          enabled: z
            .boolean()
            .optional()
            .describe(
              'Show a friendly nudge after sustained continuous use (default false). Must be true for the reminder to fire.',
            ),
          intervalMinutes: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
              'Minutes of continuous use before the reminder fires (default 30). Re-fires every interval until you take a break.',
            ),
          breakThresholdMinutes: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
              'Minutes of inactivity that count as a break and reset the timer (default 10)',
            ),
          message: z
            .string()
            .optional()
            .describe(
              'Custom reminder text. Leave unset for a rotating set of friendly nudges.',
            ),
        })
        .optional()
        .describe(
          '@internal Opt-in break reminder. When enabled, shows a dismissible nudge after sustained continuous use. Never blocks — just a friendly heads-up.',
        ),
      quietHours: z
        .object({
          enabled: z
            .boolean()
            .optional()
            .describe(
              'Show a one-time nudge when you start or keep using the CLI inside your quiet-hours window (default false).',
            ),
          start: z
            .string()
            .regex(
              /^([01]?\d|2[0-3]):[0-5]\d$/,
              'Expected 24-hour local time "HH:MM" (e.g. "22:00")',
            )
            .optional()
            .describe(
              'Start of the quiet-hours window, 24-hour local time "HH:MM".',
            ),
          end: z
            .string()
            .regex(
              /^([01]?\d|2[0-3]):[0-5]\d$/,
              'Expected 24-hour local time "HH:MM" (e.g. "07:00")',
            )
            .optional()
            .describe(
              'End of the quiet-hours window, 24-hour local time "HH:MM". May be earlier than start for an overnight range.',
            ),
        })
        .optional()
        .describe(
          '@internal Opt-in quiet hours. When enabled, shows a single soft nudge per session while inside the configured local-time window. Never blocks.',
        ),
      cleanupPeriodDays: z
        .number()
        .nonnegative()
        .int()
        .optional()
        .describe(
          'Number of days to retain chat transcripts (default: 30). Setting to 0 disables session persistence entirely: no transcripts are written and existing transcripts are deleted at startup.',
        ),
      desktopSessionCleanupPeriodDays: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          'Retention ceiling in days for session transcripts created or last written by a desktop-host surface (Claude Desktop, Cowork), which are otherwise exempt from the cleanupPeriodDays sweep. 0 (the default) means no ceiling: such transcripts are kept until deleted another way. Unlike cleanupPeriodDays, 0 is allowed because this setting never disables writes — it only bounds an exemption from deletion. The ceiling is a hard cap: it also bounds an active archive grace, so the grace window of a release marker never keeps files past the ceiling. Ignored when cleanupPeriodDays is managed by org policy. A ceiling at or below cleanupPeriodDays effectively disables the exemption: those transcripts age out on the regular cleanupPeriodDays schedule, so the effective retention is whichever of the two periods is longer.',
        ),
      syncClaudeAiSkills: z
        .preprocess(value => {
          if (value === undefined) return undefined
          if (value === true) return true
          return false
        }, z.boolean().optional())
        .describe(
          'Set to false to turn off syncing of the skills you have on claude.ai. An invalid value is treated as false until it is fixed.',
        ),
      syncClaudeAiPlugins: z
        .boolean()
        .optional()
        .describe(
          'Set to false to turn off syncing of the plugins you have enabled on claude.ai. In your user settings (or managed settings): nothing more is downloaded, previously synced plugins (~/.claude/plugins/synced) are hidden from every session started afterwards and moved to ~/.claude/plugins/.trash at the next launch (deleted after cleanupPeriodDays; re-downloaded, not restored, if you re-enable). In .claude/settings.local.json or --settings: downloads stop and synced plugins are hidden for sessions in that workspace or invocation only (nothing is moved). Not read from project settings (.claude/settings.json). Only false is honored — the feature is enabled server-side for your account, so setting true does not turn it on early. While it is on, synced plugins load in every session like plugins you installed yourself (a plugin you installed with the same name takes precedence), are re-synced at each launch, and are removed when you disable them on claude.ai. Only applies when signed in with your Claude account.',
        ),
      wslInheritsWindowsSettings: z
        .boolean()
        .optional()
        .describe(
          'When set to true in either admin-only Windows source — the HKLM SOFTWARE/Policies/ClaudeCode registry key or C:/Program Files/ClaudeCode/managed-settings.json — WSL reads managed settings from the full Windows policy chain (HKLM, C:/Program Files/ClaudeCode via DrvFs, HKCU) in addition to /etc/claude-code. Windows sources take priority. The flag is also required in HKCU itself for HKCU policy to apply on WSL (double opt-in: admin enables the chain, user confirms HKCU). On native Windows the flag has no effect.',
        ),
      env: EnvironmentVariablesSchema()
        .optional()
        .describe('Environment variables to set for Claude Code sessions'),
      // Official 2.1.327 (#374): billing group / project attribution tag for
      // Claude apps gateways that set `admin.billing_group_tag`.
      attributionProject: z
        .string()
        .optional()
        .describe(
          'Billing group or project identifier sent in request tags when a Claude apps gateway sets admin.billing_group_tag.',
        ),
      attributionProjectPolicy: z
        .object({
          default: z.string().optional(),
        })
        .passthrough()
        .optional()
        .describe(
          'Managed policy default for attributionProject when no lower-level setting specifies one.',
        ),
      // Attribution for commits and PRs
      attribution: z
        .object({
          commit: z
            .string()
            .optional()
            .describe(
              'Attribution text for git commits, including any trailers. ' +
                'Empty string hides attribution.',
            ),
          pr: z
            .string()
            .optional()
            .describe(
              'Attribution text for pull request descriptions. ' +
                'Empty string hides attribution.',
            ),
        })
        .optional()
        .describe(
          'Customize attribution text for commits and PRs. ' +
            'Each field defaults to the standard Claude Code attribution if not set.',
        ),
      includeCoAuthoredBy: z
        .boolean()
        .optional()
        .describe(
          'Deprecated: Use attribution instead. ' +
            "Whether to include Claude's co-authored by attribution in commits and PRs (defaults to true)",
        ),
      includeGitInstructions: z
        .boolean()
        .optional()
        .describe(
          "Include built-in commit and PR workflow instructions in Claude's system prompt (default: true)",
        ),
      permissions: PermissionsSchema()
        .optional()
        .describe('Tool usage permissions configuration'),
      additionalDirectoryConfigRoots: z
        .record(z.string(), z.string().catch(''))
        .optional()
        .catch(undefined)
        .describe(
          "@internal For the program that starts Claude Code only: read from --settings and from settings that program sends while the session runs; ignored in settings files. Maps an added folder (--add-dir, or a claim's additional_directories) by its absolute path, also matched by its real path, to the absolute path of the checkout whose .claude skills, commands, agents and plugin settings that folder then reads instead of its own; file access stays with the folder. Full contract, with when to send it and what makes a root unusable: apps/cli/docs/desktop-host-contract.md, entry additionalDirectoryConfigRoots.",
        ),
      modelType: z
        .enum(['anthropic', 'openai', 'gemini', 'grok'])
        .optional()
        .describe(
          'API provider type. "anthropic" uses the Anthropic API (default), "openai" uses the OpenAI Chat Completions API, "gemini" uses the Gemini API, and "grok" uses the xAI Grok API (OpenAI-compatible). ' +
            'When set to "openai", configure OPENAI_API_KEY, OPENAI_BASE_URL, and OPENAI_MODEL. When set to "gemini", configure GEMINI_API_KEY and optional GEMINI_BASE_URL. When set to "grok", configure GROK_API_KEY (or XAI_API_KEY), optional GROK_BASE_URL, GROK_MODEL, and GROK_MODEL_MAP.',
        ),
      model: z
        .string()
        .optional()
        .describe('Override the default model used by Claude Code'),
      // densable fallbackModel: array of model names/aliases tried in order
      fallbackModel: z
        .array(z.string())
        .optional()
        .describe(
          'Fallback model(s) tried in order when the primary model is overloaded or unavailable. ' +
            'Each element accepts a model name or alias; "default" expands to the default model. ' +
            'CLI --fallback-model takes precedence when set.',
        ),
      // Enterprise allowlist of models
      availableModels: z
        .array(z.string())
        .optional()
        .describe(
          'Allowlist of models that users can select. ' +
            'Accepts family aliases ("opus" allows any opus version), ' +
            'version prefixes ("opus-4-5" allows only that version), ' +
            'and full model IDs. ' +
            'If undefined, all models are available. If empty array, only the default model is available. ' +
            'Typically set in managed settings by enterprise administrators.',
        ),
      // densable 2.1.283 availableModelsMatch — managed policySettings only
      availableModelsMatch: z
        .enum(['prefix', 'exact'])
        .optional()
        .describe(
          'How availableModels entries match model IDs. "prefix" (the default) lets an entry also allow any model ID that extends it, so "claude-opus-5" allows "claude-opus-5-5". "exact" keeps that matching but stops a model ID entry from allowing other versions: "claude-opus-5" allows Opus 5 and its dated and -fast IDs, but not Opus 5.5 or a later release until it is listed, and a -latest ID needs a -latest entry. Family aliases ("opus") still allow the whole family; aliases whose model depends on the release or settings (best, opusplan, default) are ignored. With "exact" and a list that names at least one model, the Default option also uses only a listed model; if none can be used, Claude Code will not start. Haiku background models, and hooks and other helper requests that pick their own model, are not restricted (deniedModels covers them; allowManagedHooksOnly limits hooks). Read from managed settings only.',
        ),
      deniedModels: z
        .array(z.string())
        .optional()
        .describe(
          'Models users cannot select, even when availableModels allows them. A family alias ("opus") blocks that family. A model ID blocks that version in every spelling: dates, -fast and provider prefixes are ignored, so "claude-opus-5-5" blocks every Opus 5.5 ID but not Opus 5. An ID with no minor version ("claude-opus-5") also blocks later minor versions, as it allows them in availableModels. Aliases whose model depends on the release or settings (best, opusplan, default) are ignored. The Default option steps down past a blocked model; if the Default has no allowed model to step down to, Claude Code will not start. Read from managed settings only.',
        ),
      // densable enforceAvailableModels — constrain Default selection to allowlist
      enforceAvailableModels: z
        .boolean()
        .optional()
        .describe(
          'When true and availableModels is a non-empty array, the Default model selection is also constrained: ' +
            'if the default model for the user tier is not in availableModels, Default resolves to the first allowlisted model.',
        ),
      modelOverrides: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Override mapping from Anthropic model ID (e.g. "claude-opus-4-6") to provider-specific ' +
            'model ID (e.g. a Bedrock inference profile ARN). Typically set in managed settings by ' +
            'enterprise administrators.',
        ),
      // densable 2.1.243 #2 — curated /model picker (managed / --settings / user).
      modelPicker: z
        .object({
          options: z
            .array(
              z.object({
                model: z.string(),
                label: z.string().optional(),
                description: z.string().optional(),
              }),
            )
            .describe('Rows to show in the /model picker, in order.'),
          replaceBuiltInOptions: z
            .boolean()
            .optional()
            .describe(
              'When true, the picker shows only the Default row and these options — the built-in ' +
                'lineup, gateway-discovered models and ANTHROPIC_CUSTOM_MODEL_OPTION are hidden. When false or unset, these options are added after the built-in lineup.',
            ),
        })
        .optional()
        .describe(
          'Curate the /model picker: an ordered list of models with your own labels, independent of the built-in lineup and of Claude Code releases. availableModels still applies to these rows. Honored from managed, --settings/SDK, and user settings only (not from a project checkout); the highest-precedence of those that defines modelPicker wins outright (no merging across sources). Typically set in managed settings by enterprise administrators.',
        ),
      // densable 2.1.243 #4 — managed contracted rates (compile is managed-trusted only).
      modelPricing: z
        .object({
          multiplier: z.number().optional(),
          overrides: z
            .record(
              z.string(),
              z.object({
                input: z.number(),
                output: z.number(),
                cacheRead: z.number().optional(),
                cacheWrite: z.number().optional(),
              }),
            )
            .optional(),
        })
        .optional()
        .describe(
          "Price usage at your organization's contracted rates instead of list price. " +
            'Affects every spend figure Claude Code reports: /cost, the status line, and the SDK total_cost_usd. ' +
            'Typically set in managed settings by enterprise administrators.',
        ),
      modelCatalogUrl: z
        .string()
        .optional()
        .describe(
          '@internal URL of the published model-catalog document Claude Code reads for sessions the model-selector service does not serve per user: first-party sessions with no claude.ai login ' +
            '(an API key or Console key, an apiKeyHelper, workload identity — unless the service accepts ' +
            'that credential directly); Bedrock, Vertex, Foundry and Mantle sessions where the release turns the document on for the provider or CLAUDE_CODE_MODEL_CATALOG=1 opts the session in; and ANTHROPIC_BASE_URL gateway sessions and Claude Platform on AWS / Google Cloud sessions once Anthropic enables the document for them (a release that opens them, then GrowthBook tengu_delegated_quail at shadow or primary, or at any value for a file:// URL behind an ANTHROPIC_BASE_URL gateway; until that release they do not read the hosted document). Until then there, and always on the Claude apps gateway provider (its own /v1/models is the ' +
            'model list), a URL of the organization’s own set here is read whatever the flag says, only for ' +
            'what a row states about its own model: it moves no picker row, alias or default. ' +
            'What a row states includes a new model’s settings and, from an in-date copy that Anthropic signed, its prompt text. ' +
            'Sessions with a claude.ai login (the service serves them) never read it. The document is the signed JSON document Anthropic publishes at https://downloads.claude.ai/model-catalog/v1/catalog.json, or a mirror of it. Defaults to that hosted URL; a self-hosted mirror is any other https:// or http:// URL, or a file:// URL naming a local path for devices without egress. The hosted document is verified against the signing keys built into Claude Code; a self-hosted one is verified against those keys or against modelCatalogPublicKey. Only honored from managed settings (server-managed, MDM / OS policy, or managed-settings.json); also settable with the CLAUDE_CODE_MODEL_CATALOG_URL environment variable, which managed settings override and which is verified against the built-in keys only. Reading the document at all is controlled by Anthropic per release; CLAUDE_CODE_MODEL_CATALOG=off disables it locally.',
        ),
      modelCatalogPublicKey: z
        .string()
        .optional()
        .describe(
          '@internal PEM-encoded RSA public key (SubjectPublicKeyInfo, "-----BEGIN PUBLIC KEY-----", at least 2048 bits) that a self-hosted model-catalog document named by modelCatalogUrl must be signed with: the ".raw-sig.json" sidecar next to the document (the same format Claude Code release manifests use, RSASSA-PKCS1-v1_5 / SHA-512 over the context prefix and the exact document bytes) is verified against this key. Consulted only for a modelCatalogUrl ' +
            'set in the same managed settings — not for the hosted URL and not for a URL set only by ' +
            'CLAUDE_CODE_MODEL_CATALOG_URL, which are verified against the keys built into Claude Code. A value that is not such a key disables the self-hosted source. Only honored from managed settings.',
        ),
      // Whether to automatically approve all MCP servers in the project
      enableAllProjectMcpServers: z
        .boolean()
        .optional()
        .describe(
          'Whether to automatically approve all MCP servers in the project',
        ),
      // List of approved MCP servers from .mcp.json
      enabledMcpjsonServers: z
        .preprocess(
          val =>
            typeof val === 'string' && /^[A-Za-z0-9_-]+$/.test(val)
              ? [val]
              : val,
          z.array(z.string()),
        )
        .optional()
        .describe('List of approved MCP servers from .mcp.json'),
      // List of rejected MCP servers from .mcp.json
      disabledMcpjsonServers: z
        .preprocess(
          val =>
            typeof val === 'string' && /^[A-Za-z0-9_-]+$/.test(val)
              ? [val]
              : val,
          z.array(z.string()),
        )
        .optional()
        .describe('List of rejected MCP servers from .mcp.json'),
      // Official residual — disable Claude.ai connectors (any settings source).
      disableClaudeAiConnectors: z
        .boolean()
        .optional()
        .describe(
          'When true in any settings source, claude.ai MCP cloud connectors are not auto-fetched.',
        ),
      // Official residual — per-skill listing overrides (on / name-only / user-invocable-only / off).
      skillOverrides: z
        .record(
          z.string(),
          z.enum([
            'on',
            'name-only',
            'user-invocable-only',
            'off',
            // Fork-compat alias (treated as "on" for model listing).
            'model-invocable',
          ]),
        )
        .optional()
        .describe(
          'Per-skill listing overrides keyed by skill name. "name-only" lists the skill without its description; ' +
            '"user-invocable-only" hides it from the model but keeps /name; "off" hides it from both. Absent = on.',
        ),
      // Official cae — settings half of DISABLE_BUNDLED_SKILLS.
      disableBundledSkills: z
        .boolean()
        .optional()
        .describe(
          'When true, skip registration of skills that ship with the CLI (bundled skills).',
        ),
      managedMcpServers: z
        .record(
          z.string().refine(isValidManagedMcpServerName, {
            error: MANAGED_MCP_SERVER_NAME_ERROR,
          }),
          ManagedMcpServerConfigSchema(),
          { error: MANAGED_MCP_SERVERS_RECORD_ERROR },
        )
        .optional()
        .describe(
          'MCP servers the organization provides to every user, keyed by server name, each with the .mcp.json entry shape; only "http" and "sse" servers are accepted (nothing that names a program to run, no ${VAR} references). Honored from managed settings only; users cannot remove them, deniedMcpServers still applies, and they need no allowedMcpServers entry. Not read in Claude Desktop\'s Code tab on a third-party deployment or in Cowork sessions, where Claude Desktop supplies and locks the session\'s MCP servers itself.',
        ),
      // Enterprise allowlist of MCP servers
      allowedMcpServers: z
        .array(AllowedMcpServerEntrySchema())
        .optional()
        .describe(
          'Enterprise allowlist of MCP servers that can be used. ' +
            'Applies to all scopes including enterprise servers from managed-mcp.json. ' +
            'If undefined, all servers are allowed. If empty array, no servers are allowed. ' +
            'Denylist takes precedence - if a server is on both lists, it is denied.',
        ),
      // Enterprise denylist of MCP servers
      deniedMcpServers: z
        .array(DeniedMcpServerEntrySchema())
        .optional()
        .describe(
          'Enterprise denylist of MCP servers that are explicitly blocked. ' +
            'If a server is on the denylist, it will be blocked across all scopes including enterprise. ' +
            'Denylist takes precedence over allowlist - if a server is on both lists, it is denied.',
        ),
      hooks: HooksSchema()
        .optional()
        .describe('Custom commands to run before/after tool executions'),
      worktree: z
        .object({
          symlinkDirectories: z
            .array(z.string())
            .optional()
            .describe(
              'Directories to symlink from main repository to worktrees to avoid disk bloat. ' +
                'Must be explicitly configured - no directories are symlinked by default. ' +
                'Common examples: "node_modules", ".cache", ".bin"',
            ),
          sparsePaths: z
            .array(z.string())
            .optional()
            .describe(
              'Directories to include when creating worktrees, via git sparse-checkout (cone mode). ' +
                'Dramatically faster in large monorepos — only the listed paths are written to disk.',
            ),
          bgIsolation: z
            .enum(['worktree', 'none'])
            .optional()
            .describe(
              'How background sessions isolate their changes. ' +
                '"worktree" (default): each bg session gets an isolated git worktree. ' +
                '"none": bg sessions edit the working copy directly without EnterWorktree.',
            ),
          baseRef: z
            .enum(['fresh', 'head'])
            .optional()
            .describe(
              'Base ref for new worktrees. "fresh" (default): branch from origin/<default>. ' +
                '"head": branch from local HEAD (keeps unpushed commits).',
            ),
        })
        .optional()
        .describe('Git worktree configuration for --worktree flag.'),
      // Whether to disable all hooks and statusLine
      disableAllHooks: z
        .boolean()
        .optional()
        .describe('Disable all hooks and statusLine execution'),
      disableReplyCheck: z
        .boolean()
        .optional()
        .describe(
          "Disable the reply check in Claude Tag sessions on a self-hosted runner. The check re-prompts Claude, at most four times a turn, when a turn ends without a call to one of Claude Tag's reply tools. It is not a hook, so disableAllHooks does not affect it. Disabling it also stops two messages to Claude that Anthropic's service can request for such a session: a nudge after a long stretch of work with no visible update, and a reminder added to prompts. Claude Code's built-in reminder to give progress updates, on models that have it, is then no longer held back. Set it in managed settings; false there keeps the check on. Everywhere else it is ignored and the check stays on. Has no effect on sessions that Anthropic hosts.",
        ),
      // Official residual — disable `claude agents` agent view.
      disableAgentView: z.boolean().optional().describe(
        // densable 2.1.289 SEA copy — fleet breadth, not agents-only.
        'Disable agent view (`claude agents`, `--bg`, /background, the on-demand daemon). Typically set in managed settings. Equivalent to CLAUDE_CODE_DISABLE_AGENT_VIEW=1.',
      ),
      // Official residual — managed policy can force Remote Control off.
      disableRemoteControl: z
        .boolean()
        .optional()
        .describe(
          'When true (typically managed settings), Remote Control / bridge is disabled by organization policy.',
        ),
      // Official residual — settings half of DISABLE_WORKFLOWS.
      disableWorkflows: z
        .boolean()
        .optional()
        .describe(
          'When true, disable dynamic workflows. Also forced off by CLAUDE_CODE_DISABLE_WORKFLOWS.',
        ),
      // Official residual — settings half of DISABLE_ARTIFACT.
      disableArtifact: z
        .boolean()
        .optional()
        .describe(
          'When true, disable the Artifact tool. Also forced off by CLAUDE_CODE_DISABLE_ARTIFACT.',
        ),
      // Official residual — user opt-in for Artifact tool when available.
      enableArtifact: z
        .boolean()
        .optional()
        .describe(
          'When set, opt into/out of the Artifact tool. Unset uses the product default.',
        ),
      // Official residual — user opt-in for dynamic workflows when available.
      enableWorkflows: z
        .boolean()
        .optional()
        .describe(
          'When set, opt into/out of dynamic workflows. Unset uses the product default.',
        ),
      // densable tKn — skip the Workflow usage-consent prompt.
      skipWorkflowUsageWarning: z
        .boolean()
        .optional()
        .describe(
          'When true, skip the one-time Workflow usage-consent prompt (densable tKn).',
        ),
      // densable 2.1.219 #5/#18 — settings key; /config row hidden while set.
      // "medium" (the default) aims for fewer than 15 agents; large < 50.
      workflowSizeGuideline: z
        .enum(['unrestricted', 'small', 'medium', 'large'])
        .optional()
        .describe(
          'Advisory size guideline for the dynamic workflows Claude writes: "small" aims for fewer than 5 agents, "medium" (the default) fewer than 15, "large" fewer than 50, and "unrestricted" sends no guideline. A value here — including from managed settings — takes precedence over the "Dynamic workflow size" choice in /config, and that /config row is hidden while a settings file provides the key. This is a guideline, not an enforced limit.',
        ),
      // Official residual — ultracode/workflow keyword trigger.
      workflowKeywordTriggerEnabled: z
        .boolean()
        .optional()
        .describe(
          'Whether the ultracode/workflow keyword trigger is enabled. Default: true.',
        ),
      // Official cYn — settings half of skill shell disable.
      disableSkillShellExecution: z
        .boolean()
        .optional()
        .describe(
          'When true, strip ```! / !` skill shell commands instead of executing them. ' +
            'Also forced on when CLAUDE_CODE_IS_COWORK is set. Policy settings take precedence.',
        ),
      disableWindowsBashCommandSplit: z
        .boolean()
        .optional()
        .describe(
          'Windows only. Set to true to keep every Bash command in a single argument to bash, so that endpoint security tools that match text in process command lines see it whole. Otherwise Claude Code may split a long command over several arguments. With true, a command of about 7,000 characters or more, or fewer if it is full of quotes, may reach bash cut short, and then usually fails with a syntax error. Only honored from managed settings; ignored in user, project, local and --settings sources.',
        ),
      // Which shell backs input-box `!` (see resolveDefaultShell)
      defaultShell: z
        .enum(['bash', 'powershell'])
        .optional()
        .describe(
          'Default shell for input-box ! commands. ' +
            "Defaults to 'powershell' on Windows when the PowerShell tool is enabled, otherwise 'bash'. Set explicitly to override.",
        ),
      // Official 2.1.186: `!` bash output auto-triggers a Claude response
      respondToBashCommands: z
        .boolean()
        .optional()
        .describe(
          'Whether Claude responds after an input-box ! bash command runs. ' +
            'Set to false to add the command output to context without a response. ' +
            'Default: true.',
        ),
      // densable 2.1.283 y5t — Bash file-edit diffs in tool_response
      bashEditDiffEnabled: z
        .boolean()
        .optional()
        .describe(
          'Whether the Bash tool shows a diff of the files a Bash command changed (PostToolUse Bash hooks get the changed-file list in tool_response). Set to false to turn that off. Default: on when the Bash tool handles file edits. Only user, flag or policy settings can turn it on outside auto and bypassPermissions modes.',
        ),
      // densable 2.1.283 zae / Uqe — inline Bash/PowerShell output cap
      bashOutputMaxChars: z
        .number()
        .int()
        .positive()
        .optional()
        .catch(undefined)
        .describe(
          "How many characters of a successful Bash or PowerShell command's output Claude receives inline (default 30000; values clamp to 4000-128000). Output past this is saved to a file and Claude receives a short preview plus the path. When set, this also replaces BASH_MAX_OUTPUT_LENGTH, which on its own only sizes the read-back window.",
        ),
      // densable 2.1.283 — no-op after TaskOutput removal; do not revive the tool
      taskOutputMaxChars: z
        .number()
        .int()
        .positive()
        .optional()
        .catch(undefined)
        .describe(
          "Deprecated: no longer has any effect (the TaskOutput tool was removed). Read a background task's output file with the Read tool instead.",
        ),
      // Official 2.1.200: AskUserQuestion no longer auto-continues by default.
      askUserQuestionTimeout: z
        .enum(['60s', '5m', '10m', 'never'])
        .optional()
        .catch(undefined)
        .describe(
          "Idle time before Claude's questions auto-continue with any answers " +
            'selected so far. Defaults to never — auto-continue only runs ' +
            'when explicitly set to 60s/5m/10m.',
        ),
      // densable 2.1.224 #5 — remote dialog + HELD cross-session message deadline
      dialogExpiry: z
        .enum(['60s', '5m', '10m', 'never'])
        .optional()
        .catch(undefined)
        .describe(
          'Max time a permission/user dialog forwarded to a remote client stays parked awaiting an answer, and how long a HELD cross-session message awaits approval, before either resolves to its safe no-action default (cancelled / dropped-with-denial). Defaults to 5m to match the long-standing remote-dialog deadline; "never" disables the deadline. Local-only permission prompts (no remote client) are unaffected. The CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS env var, when set, overrides this. Read from trusted sources only (never a checked-in repo settings file).',
        ),
      // densable 2.1.224 #5 — inbound cross-session peer messages (SendMessage)
      crossSessionInbound: z
        .enum(['accept', 'hold', 'refuse'])
        .optional()
        .describe(
          "Inbound cross-session peer messages (SendMessage from your other sessions): 'accept' delivers them, 'hold' parks them for your review without letting Claude act, 'refuse' opts this session out. An explicit value always wins. Unset (mode parity): a message auto-delivers only when the sending session's permission-mode class matches yours (bypass↔bypass or prompting↔prompting); a mismatched sender's message is held for your approval; a sender that asserts no class is held only while this session bypasses permission prompts.",
        ),
      // Official 2.1.325 #2298 + 2.1.331: teammateMode settings field
      teammateMode: z
        .enum(['tmux', 'iterm2', 'windows-terminal', 'in-process', 'auto'])
        .optional()
        .catch(undefined)
        .describe(
          'How spawned teammates execute (tmux, iterm2, in-process, auto)',
        ),
      // Official 2.1.331: remoteMessageReceipts (cross-session / cloud / RC delivery notices)
      remoteMessageReceipts: z
        .enum(['on', 'always', 'off'])
        .optional()
        .catch(undefined)
        .describe(
          "@internal Delivery notices for messages between this session and cloud or Remote Control sessions. 'on' (default): notices, local ones too, start at most 30 turns an hour and one for each recipient that holds. 'always': neither limit, so two sessions can keep waking each other. 'off': no notices about those sessions, and no reports on messages received through them; the limits still apply to local ones. Read only from managed and user settings; --settings counts only with 'off'.",
        ),
      // densable Ktr / vCe — ProposeGoal ask policy
      modelProposedGoals: z
        .enum(['auto', 'alwaysAsk', 'disabled'])
        .optional()
        .describe(
          'When the model may propose a session goal: auto (ask unless the tool sets ask_user=false), alwaysAsk, or disabled.',
        ),
      // Only run hooks defined in managed settings (managed-settings.json)
      allowManagedHooksOnly: z
        .boolean()
        .optional()
        .describe(
          'When true (and set in managed settings), only hooks from managed settings run. ' +
            'User, project, and local hooks are ignored.',
        ),
      // densable 2.1.229 #4 — block marketplace plugin source:"command"
      disableCommandPluginSources: z
        .boolean()
        .optional()
        .describe(
          'When true (and set in managed settings), marketplace plugins with source "command" are not installed or updated and their commands are not run. When unset, allowManagedHooksOnly also disables command-sourced plugins (densable _le). Invalid values are treated as true (fail closed).',
        ),
      // densable A8 — CLI-flag sideload bypass of strictKnownMarketplaces
      disableSideloadFlags: z
        .boolean()
        .optional()
        .describe(
          'When true (and set in managed settings), rejects the --plugin-dir, --plugin-url, --agents, and non-sdk --mcp-config CLI flags at startup. Closes the CLI-flag bypass of strictKnownMarketplaces. Pair with allowedMcpServers for per-server MCP control; this setting does not gate other MCP entry points (SDK setMcpServers, claude mcp add, .mcp.json). Also blocks surfaces that spawn the CLI with these flags internally (see settings documentation). Only honored from managed settings; ignored in user/project/local settings.',
        ),
      // Allowlist of URL patterns HTTP hooks may target (follows allowedMcpServers precedent)
      allowedHttpHookUrls: z
        .array(z.string())
        .optional()
        .describe(
          'Allowlist of URL patterns that HTTP hooks may target. ' +
            'Supports * as a wildcard (e.g. "https://hooks.example.com/*"). ' +
            'When set, HTTP hooks with non-matching URLs are blocked. ' +
            'If undefined, all URLs are allowed. If empty array, no HTTP hooks are allowed. ' +
            'Arrays merge across settings sources (same semantics as allowedMcpServers).',
        ),
      // Allowlist of env var names HTTP hooks may interpolate into headers
      httpHookAllowedEnvVars: z
        .array(z.string())
        .optional()
        .describe(
          'Allowlist of environment variable names HTTP hooks may interpolate into headers. ' +
            "When set, each hook's effective allowedEnvVars is the intersection with this list. " +
            'If undefined, no restriction is applied. ' +
            'Arrays merge across settings sources (same semantics as allowedMcpServers).',
        ),
      // Only use permission rules defined in managed settings (managed-settings.json)
      allowManagedPermissionRulesOnly: z
        .boolean()
        .optional()
        .describe(
          'When true (and set in managed settings), only permission rules (allow/deny/ask) from managed settings are respected. ' +
            'User, project, local, and CLI argument permission rules are ignored.',
        ),
      // Only read MCP allowlist policy from managed settings
      allowManagedMcpServersOnly: z
        .boolean()
        .optional()
        .describe(
          'When true (and set in managed settings), allowedMcpServers is only read from managed settings. ' +
            'deniedMcpServers still merges from all sources, so users can deny servers for themselves. ' +
            'Users can still add their own MCP servers, but only the admin-defined allowlist applies.',
        ),
      desktopMcpServersListScope: z
        .string()
        .optional()
        .catch('all')
        .meta({ default: undefined })
        .describe(
          'Claude desktop app only. Where your allow list and deny list apply to MCP servers added in the Claude desktop app. "code" (default): Your allow list also governs MCP servers added in the Claude desktop app, in Code tab sessions and the Artifact pane. "all": Your allow list and your deny list also govern MCP servers added in the Claude desktop app, in every tab (including Chat and Cowork). "off": Your allow list doesn\'t govern MCP servers added in the Claude desktop app. Read only from managed settings. Any other value counts as `all`. Where sources are merged or mixed, `off` counts as `all`. Leave the key out, or set it only in the managed source that holds your list. `deniedMcpServers` applies in Code tab sessions and the Artifact pane with every value, and in every tab with `all`. MCP servers sent to SSH hosts are not governed by these lists in this release. The Claude Code CLI reads nothing from this key, but written alone in a higher managed source it makes that source lead, and Claude Code skips the managed sources beneath it. Write it only beside the list it scopes.',
        ),
      // When true (and set in managed settings), claude.ai cloud MCP connectors
      // load alongside managed-mcp.json instead of being suppressed by its
      // exclusive-control lockdown. Default off preserves the lockdown.
      // Read from managed settings only.
      allowAllClaudeAiMcps: z
        .boolean()
        .optional()
        .describe(
          'When true (and set in managed settings), claude.ai cloud MCP connectors load alongside ' +
            'managed-mcp.json instead of being suppressed by its exclusive-control lockdown. ' +
            'Default off preserves the lockdown. Read from managed settings only.',
        ),
      allowClaudeInChromeWithManagedMcp: z
        .boolean()
        .optional()
        .describe(
          "When true (and set in device managed settings: MDM, the managed-settings.json file, or a policy helper those configure), the built-in Claude in Chrome MCP server can run alongside managed-mcp.json instead of being blocked by its exclusive-control lockdown. deniedMcpServers and the organization's Claude in Chrome setting still block it. Default off preserves the lockdown.",
        ),
      // Force customizations through plugins only (LinkedIn ask via GTM)
      strictPluginOnlyCustomization: z
        .preprocess(
          // Forwards-compat: drop unknown surface names so a future enum
          // value (e.g. 'commands') doesn't fail safeParse and null out the
          // ENTIRE managed-settings file (settings.ts:101). ["skills",
          // "commands"] on an old client → ["skills"] → locks what it knows,
          // ignores what it doesn't. Degrades to less-locked, never to
          // everything-unlocked.
          v =>
            Array.isArray(v)
              ? v.filter(x =>
                  (CUSTOMIZATION_SURFACES as readonly string[]).includes(x),
                )
              : v,
          z.union([z.boolean(), z.array(z.enum(CUSTOMIZATION_SURFACES))]),
        )
        .optional()
        // Non-array invalid values ("skills" string, {object}) pass through
        // the preprocess unchanged and would fail the union → null the whole
        // managed-settings file. .catch drops the field to undefined instead.
        // Degrades to unlocked-for-this-field, never to everything-broken.
        // Doctor flags the raw value.
        .catch(undefined)
        .describe(
          'When set in managed settings, blocks non-plugin customization sources for the listed surfaces. ' +
            'Array form locks specific surfaces (e.g. ["skills", "hooks"]); `true` locks all four; `false` is an explicit no-op. ' +
            'Blocked: ~/.claude/{surface}/, .claude/{surface}/ (project), settings.json hooks, .mcp.json. ' +
            'NOT blocked: managed (policySettings) sources, plugin-provided customizations. ' +
            'Composes with strictKnownMarketplaces for end-to-end admin control — plugins gated by ' +
            'marketplace allowlist, everything else blocked here.',
        ),
      // Status line for custom status line display
      statusLine: z
        .object({
          type: z.literal('command'),
          command: z.string(),
          padding: z.number().optional(),
          refreshInterval: z.number().optional(),
        })
        .optional()
        .describe('Custom status line display configuration'),
      // Toggle for the fork's built-in status line (BuiltinStatusLine + CachePill).
      // Toggled by the /statusline command. Default false → no rendering.
      statusLineEnabled: z
        .boolean()
        .optional()
        .describe(
          'Whether to render the fork built-in status line (model + ctx + 5h/7d limits + cost + cache pill). Toggled with /statusline.',
        ),
      prUrlTemplate: z
        .string()
        .optional()
        .describe(
          'URL template for PR links in the footer link badges and inline messages. The detected git PR is rendered as the first footer-link badge. Placeholders: {host} {owner} {repo} {number} {url}. Example: "https://reviews.example.com/{owner}/{repo}/pull/{number}"',
        ),
      footerLinksRegexes: z
        .array(FooterLinkEntrySchema().catch(INVALID_FOOTER_LINK_ENTRY))
        .transform(entries =>
          entries.filter(entry => entry !== INVALID_FOOTER_LINK_ENTRY),
        )
        .optional()
        .catch(undefined)
        .describe(
          'Extra clickable footer badges that appear when a regex matches turn output (tool results and assistant responses). Read from user, flag, and managed settings only; ignored in project .claude/settings.json and local .claude/settings.local.json. At most 5 badges render; the oldest is displaced by newer matches and /clear removes them. Use to surface IDs printed by project CLIs as session links.',
        ),
      // Official 2.1.323 (#2210): Deprecated — kept in schema for backward compatibility
      // so existing settings files still load, but has no runtime effect.
      subagentStatusLine: z
        .object({
          type: z.literal('command'),
          command: z.string(),
        })
        .optional()
        .catch(undefined)
        .describe(
          'Deprecated: no longer has any effect. Subagent rows always use the default look.',
        ),
      // Enabled plugins using marketplace-first format
      enabledPlugins: z
        .record(
          z.string(),
          z.union([z.array(z.string()), z.boolean(), z.undefined()]),
        )
        .optional()
        .describe(
          'Enabled plugins using plugin-id@marketplace-id format. Example: { "formatter@anthropic-tools": true }. Also supports extended format with version constraints.',
        ),
      prependPlugins: z
        .array(z.string())
        .optional()
        .catch(undefined)
        .describe(
          'Managed plugins (plugin@marketplace ids that managed enabledPlugins sets true) whose hooks run first, outermost, in the listed order: the first id listed sees every event before any other plugin and every result after it. Managed plugins not listed here or in appendPlugins follow the listed ones; user, project and marketplace plugins come after those; then appendPlugins; then the built-in plugins. The bundled cc-plugin-sec-default@builtin seats itself outermost (on a machine with managed settings and for Team and Enterprise organizations) unless this list is set, in which case list it where it should sit or leave it out. Name it there as sec-default@builtin, the id every release reads, for as long as any machine in the organization may run a release from before its rename; a release that knows the new id reads either. Any other id that is not an enabled managed plugin is skipped; an id listed in both keys is prepended. Only honored from managed settings (or, on a machine with none, from user settings for your own plugins); ignored in project, local and --settings sources.',
        ),
      appendPlugins: z
        .array(z.string())
        .optional()
        .catch(undefined)
        .describe(
          'Managed plugins (plugin@marketplace ids that managed enabledPlugins sets true) whose hooks run last among plugins, innermost, in the listed order: the last id listed sits just above the built-in plugins and sees each event as every other plugin left it. Only honored from managed settings (or, on a machine with none, from user settings for your own plugins); ignored in project, local and --settings sources.',
        ),
      // Extra marketplaces for this repository (usually for project settings)
      extraKnownMarketplaces: createKnownMarketplacesRecordSchema(
        'extraKnownMarketplaces',
      )
        .optional()
        .describe(
          'Additional marketplaces to make available for this repository. Typically used in repository .claude/settings.json to ensure team members have required plugin sources. Alias: additionalMarketplaces (densable 2.1.232).',
        ),
      // Official 2.1.331 includes alias keys directly in SettingsSchema so strict
      // validation and generated JSON schemas recognize them; applySettingsKeyAliases
      // still normalizes them to canonical keys when loading settings files.
      additionalMarketplaces: createKnownMarketplacesRecordSchema(
        'additionalMarketplaces',
      )
        .optional()
        .describe(
          'Alias for extraKnownMarketplaces: this key is read exactly as if it were spelled ' +
            'extraKnownMarketplaces. Do not set both in one file — if both appear, this key is ignored ' +
            'with a warning. Claude Code may rewrite this key as extraKnownMarketplaces when it updates the file. Clients older than this alias ignore it, so prefer extraKnownMarketplaces while older Claude Code versions still share the same settings.',
        ),
      // Enterprise strict list of allowed marketplace sources (policy settings only)
      // When set, ONLY these exact sources can be added. Check happens BEFORE download.
      strictKnownMarketplaces: z
        .array(MarketplaceSourceSchema())
        .optional()
        .describe(
          // densable 2.1.223 owner/* — policy github entries may use "owner/*"
          'Enterprise strict list of allowed marketplace sources. When set in managed settings, ' +
            'ONLY these sources can be added as marketplaces. Entries match exactly, except that ' +
            'a github entry may use the owner-wildcard form {"source":"github","repo":"owner/*"} ' +
            'to allow every repository under that owner. The check happens BEFORE downloading, so ' +
            'blocked sources never touch the filesystem. ' +
            'Note: this is a policy gate only — it does NOT register marketplaces. ' +
            'To pre-register allowed marketplaces for users, also set extraKnownMarketplaces. ' +
            'Alias: allowedMarketplaces (densable 2.1.232).',
        ),
      allowedMarketplaces: z
        .array(MarketplaceSourceSchema())
        .optional()
        .describe(
          'Alias for strictKnownMarketplaces (managed settings only): this key is read exactly as if it ' +
            'were spelled strictKnownMarketplaces. Do not set both in one file — if both appear, this key ' +
            'is ignored with a warning. Clients older than this alias ignore it, so keep using strictKnownMarketplaces when the allowlist must also bind older Claude Code versions.',
        ),
      // Enterprise blocklist of marketplace sources (policy settings only)
      // When set, these exact sources are blocked. Check happens BEFORE download.
      blockedMarketplaces: z
        .array(MarketplaceSourceSchema())
        .optional()
        .describe(
          // densable 2.1.223 owner/* — policy github entries may use "owner/*"
          'Enterprise blocklist of marketplace sources. When set in managed settings, ' +
            'these sources are blocked from being added as marketplaces. Entries match exactly, ' +
            'except that a github entry may use the owner-wildcard form {"source":"github","repo":"owner/*"} ' +
            'to block every repository under that owner. The check happens BEFORE downloading, so ' +
            'blocked sources never touch the filesystem.',
        ),
      // densable 2.1.212: claudeai | console | gateway (Cloud gateway OIDC device flow)
      forceLoginMethod: z
        .enum(['claudeai', 'console', 'gateway'])
        .optional()
        .catch(undefined)
        .describe(
          'Force a specific login method: "claudeai" for a Claude subscription (individual, Team, or Enterprise plans), "console" for Console billing, "gateway" for the Cloud gateway OIDC device flow',
        ),
      // densable forceLoginGatewayUrl — pre-fill / auto-connect URL with forceLoginMethod:"gateway"
      forceLoginGatewayUrl: z
        .string()
        .url()
        .optional()
        .catch(undefined)
        .describe(
          '@internal Cloud gateway URL to pre-fill and auto-connect to during login. Typically set in local managed settings alongside forceLoginMethod: "gateway" so users never type the URL. Hidden from public SDK types until Cloud gateway is documented.',
        ),
      gatewayInternalNetworks: z
        .array(z.string())
        .optional()
        .catch([GATEWAY_INTERNAL_NETWORKS_UNREADABLE])
        .meta({ default: undefined })
        .describe(
          "IPv4 CIDR blocks (at most 4, each /8 to /32, not overlapping) your Cloud gateway sits in: the public block your organization numbers its internal network from, which lets /login reach a gateway there. A block must lie entirely outside private space, where /login accepts a gateway without this key. /login accepts a gateway inside a listed block over a direct connection only, and only when this machine's own address on that connection is inside the same block, so /login must happen from a machine whose own address is inside the block (not through a proxy, VPN pool, container or NAT segment outside it). A bar against copied settings files, not proof of location. Honored only from admin-controlled managed settings (MDM / managed-settings.json / policy helper); ignored in user, project, and remote-delivered settings.",
        ),
      // Official 2.1.328 (`chunk@284022131.js@266422`): managed source composition & SDK parent tier layering
      parentSettingsBehavior: z
        .enum(['first-wins', 'merge'])
        .optional()
        .describe(
          'Controls whether the SDK parent tier (Options.managedSettings / --managed-settings) layers under this admin tier: "first-wins" (default) or "merge".',
        ),
      managedSourcesBehavior: z
        .enum(['first-wins', 'merge'])
        .optional()
        .describe(
          'Controls how managed settings sources compose: "first-wins" (default) or "merge" (server-managed > MDM > managed-settings.json).',
        ),
      // Organization UUID to use for OAuth login (will be added as URL param to authorization URL)
      forceLoginOrgUUID: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          'Organization UUID to require for OAuth login. Accepts a single UUID ' +
            'string or an array of UUIDs (any one is permitted). When set in ' +
            'managed settings, login fails if the authenticated account does not ' +
            'belong to a listed organization.',
        ),
      allowNestedModelAccessUnderForceLogin: z
        .boolean()
        .optional()
        .describe(
          "Self-hosted runner hosts only. Set to true to let a Claude Code started by a runner session's command use the runner's model access (--nested-model-access) when this machine's managed settings set forceLoginOrgUUID or forceLoginMethod. It asks the runner which organization the session owner's sign-in belongs to, and stops if the pin does not permit it or the runner does not answer. Without this key it is left signed out. Any program on the machine can pretend to be the runner, so with this key the pin is not a security boundary: set it on runner hosts only, never in a profile that reaches people's own computers. Honored only from this machine's own administrator sources (MDM, the managed settings file, or a policy helper that they name); ignored in server-managed, user, project, local and --settings sources.",
        ),
      allowedProviders: z
        .preprocess(
          val =>
            Array.isArray(val)
              ? val.filter(
                  item =>
                    typeof item === 'string' &&
                    [
                      'anthropic',
                      'bedrock',
                      'vertex',
                      'foundry',
                      'anthropicAws',
                      'anthropicGoogleCloud',
                      'mantle',
                      'customEndpoint',
                    ].includes(item),
                )
              : val,
          z
            .array(
              z.enum([
                'anthropic',
                'bedrock',
                'vertex',
                'foundry',
                'anthropicAws',
                'anthropicGoogleCloud',
                'mantle',
                'customEndpoint',
              ]),
            )
            .optional()
            .catch(undefined),
        )
        .describe(
          'Managed settings only (managed-settings.json, MDM, or server-managed). The API providers Claude Code may use on this machine: "anthropic", "bedrock", "vertex", "foundry", "anthropicAws", "anthropicGoogleCloud", "mantle", "customEndpoint", or "gateway". Server-managed settings from the admin console do not apply to Pro/Max/Ultra logins, cloud providers, or non-Anthropic ANTHROPIC_BASE_URL endpoints.',
        ),
      forceRemoteSettingsRefresh: z
        .boolean()
        .optional()
        .describe(
          'When set in managed settings, the CLI blocks startup until remote managed settings are freshly fetched, and exits if the fetch fails',
        ),
      bedrockDeclinedUpgrades: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Per-tier declined Bedrock model upgrade keys (e.g., sonnet -> "fromKey-to-toKey")',
        ),
      vertexDeclinedUpgrades: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Per-tier declined Vertex model upgrade keys (e.g., sonnet -> "fromKey-to-toKey")',
        ),
      otelHeadersHelper: z
        .string()
        .optional()
        .describe('Path to a script that outputs OpenTelemetry headers'),
      /**
       * densable processWrapper (S3l) — shell wrapper for subprocesses.
       * Also available as CLAUDE_CODE_PROCESS_WRAPPER env; settings form is
       * dangerous shell surface for managed-settings approval.
       */
      processWrapper: z
        .string()
        .optional()
        .describe(
          'Shell command/path that wraps process spawns (managed settings; dangerous shell surface)',
        ),
      outputStyle: z
        .string()
        .optional()
        .describe('Controls the output style for assistant responses'),
      /**
       * densable viewMode — default transcript view on startup.
       * `focus` mirrors AppState.briefTranscript via J7t residual.
       */
      viewMode: z
        .enum(['default', 'verbose', 'focus'])
        .optional()
        .catch(undefined)
        .describe('Default transcript view mode on startup'),
      /**
       * densable briefTranscript — focus-view transcript preference (settings).
       * AppState.briefTranscript mirrors session toggles via Xat.
       */
      briefTranscript: z
        .boolean()
        .optional()
        .describe('When true, focus-style brief transcript view is preferred.'),
      language: z
        .string()
        .optional()
        .describe(
          'Preferred language for Claude responses and voice dictation (e.g., "japanese", "spanish")',
        ),
      skipWebFetchPreflight: z
        .boolean()
        .optional()
        .describe(
          'Skip the WebFetch blocklist check for enterprise environments with restrictive security policies',
        ),
      webSearchAdapter: z
        .enum(['api', 'bing', 'brave', 'exa', 'tavily'])
        .optional()
        .describe(
          'Web search backend adapter. "tavily" uses Tavily Search API (default), ' +
            '"api" uses Anthropic server-side search, "bing" scrapes Bing HTML, ' +
            '"brave" uses Brave Search API, "exa" uses Exa AI.',
        ),
      webFetchAdapter: z
        .enum(['tavily', 'http'])
        .optional()
        .describe(
          'Web fetch backend. "tavily" uses Tavily Extract API which returns Markdown directly (default), ' +
            '"http" fetches the URL directly via HTTP.',
        ),
      tavilyEndpointUrl: z
        .string()
        .optional()
        .describe(
          'Custom Tavily API endpoint URL. Defaults to https://tavily.claude-code-best.win. ' +
            'Used by both WebSearch and WebFetch when tavily adapter is selected.',
        ),
      braveApiKey: z
        .string()
        .optional()
        .describe(
          'Brave Search API key. Required when using the brave web search adapter.',
        ),
      webFetchHttpTimeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'HTTP timeout in milliseconds for the HTTP direct web fetch backend. Defaults to 60000 (60s).',
        ),
      exaApiKey: z
        .string()
        .optional()
        .describe(
          'Exa AI API key. Required when using the exa web search adapter.',
        ),
      exaEndpointUrl: z
        .string()
        .optional()
        .describe(
          'Custom Exa AI MCP endpoint URL. Defaults to https://mcp.exa.ai/mcp.',
        ),
      sandbox: SandboxSettingsSchema()
        .extend({
          windows: z
            .object({
              backend: z
                .enum(['sandboxuser', 'mxc'])
                .optional()
                .describe(
                  'Windows only: how sandboxed commands are confined ("sandboxuser" default, or experimental "mxc" BaseContainer). Read from user, managed/policy, or --settings only; project/local ignored.',
                ),
            })
            .optional()
            .describe('@internal Settings of the sandbox on native Windows.'),
        })
        .optional(),
      feedbackSurveyRate: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          'Probability (0–1) that the session quality survey appears when eligible. 0.05 is a reasonable starting point.',
        ),
      feedbackDrafts: z
        .enum(['notify', 'quiet', 'off'])
        .optional()
        .describe(
          'Model-drafted feedback (the SendFeedback tool). "notify" (default) shows a one-line notice when a draft is queued; "quiet" shows only the footer counter; "off" disables the tool entirely so drafts are never queued.',
        ),
      spinnerTipsEnabled: z
        .boolean()
        .optional()
        .describe('Whether to show tips in the spinner'),
      // densable 2.1.234 autoContinueAtUsageLimit (userSettings). Absent key ⇒
      // effective true via autoContinueKeyPresence==="absent" (SEA BXa/Wqn).
      autoContinueAtUsageLimit: z
        .boolean()
        .optional()
        .describe(
          'Continue the current task automatically when the claude.ai usage limit resets',
        ),
      // densable 2.1.239 $c / bvr — default true. Off → pause instead of switch.
      switchModelsOnFlag: z
        .boolean()
        .optional()
        .describe(
          'When safeguards flag a message, automatically switch to a different model to keep chatting. When off, your session will pause instead.',
        ),
      // densable 2.1.239 UJr / LJr default false. /config row gated tengu_sepia_moth.
      precomputeCompactionEnabled: z
        .boolean()
        .optional()
        .describe(
          'Precompute the compaction summary in the background before it is needed. Only applies when auto-compact is on.',
        ),
      precomputeArmTokens: z
        .number()
        .int()
        .positive()
        .optional()
        .catch(undefined)
        .describe(
          '@internal Read from the flag settings only, for a host that sends /compact below the automatic threshold: the main conversation starts its background compaction summary at this many tokens, when that is sooner than it would by itself, so that /compact finds it ready. A window set below the billing boundary compacts without a background summary, and this does not change that.',
        ),
      autoCompactRaisedForLoad: z
        .boolean()
        .optional()
        .catch(undefined)
        .describe(
          "@internal Read from the flag settings only, in Claude Desktop's Code tab: true lets a conversation compact at twice what is still in each request after a summary (system prompt, tools, instruction files), where that is above its auto-compact threshold.",
        ),
      autoCompactOfferAnswer: z
        .object({
          model: z.string().min(1).max(200),
          choice: z.enum(['accept', 'keep', 'undo']),
          tokens: z.number().int().positive(),
          at: z.number().int().positive(),
        })
        .optional()
        .catch(undefined)
        .describe(
          "@internal Read from the flag settings only, in Claude Desktop's Code tab: the person's answer to the app's offer of a lower auto-compact window, which Claude Code records on this computer. `tokens` is the window they chose or kept, and `at` is when they answered (epoch ms)",
        ),
      // Official 2.1.299 (#567): idleCompaction setting (defaults to true).
      idleCompaction: z
        .boolean()
        .optional()
        .describe(
          'Set to false to stop Claude Code from compacting a long conversation while the session is idle. Defaults to true.',
        ),
      // densable 2.1.239 timestamps /config → showMessageTimestamps. GB tengu_silk_hinge.
      showMessageTimestamps: z
        .boolean()
        .optional()
        .describe('Stamp each message with its arrival time'),
      // Official settings.tui ("default" | "fullscreen") — explicit TUI renderer.
      // Consumed by isFullscreenEnvEnabled(); "default" forces classic layout,
      // "fullscreen" forces alt-screen / no-flicker. Absent → env / auto default.
      tui: z
        .enum(['default', 'fullscreen'])
        .optional()
        .describe(
          'Terminal UI renderer. "default" uses the classic scrolling layout; ' +
            '"fullscreen" pins input to the bottom with virtualized scrollback. ' +
            'Overrides auto-detection when set; CLAUDE_CODE_NO_FLICKER still wins.',
        ),
      // Official 2.1.210 settings densable — wheel accel on/off (default true).
      // Consumed by ScrollKeybindingHandler initAndLogWheelAccel / FSp.
      wheelScrollAccelerationEnabled: z
        .boolean()
        .optional()
        .describe(
          'Whether mouse-wheel scroll acceleration is enabled in fullscreen. ' +
            'When false, each wheel event scrolls a fixed base number of rows.',
        ),
      // densable autoScrollEnabled (fullscreen). Consumed by REPL uT / OJh.
      autoScrollEnabled: z
        .boolean()
        .optional()
        .describe(
          'Auto-scroll the conversation view to bottom (fullscreen mode only)',
        ),
      spinnerVerbs: z
        .object({
          mode: z.enum(['append', 'replace']),
          verbs: z.array(z.string()),
        })
        .optional()
        .describe(
          'Customize spinner verbs. mode: "append" adds verbs to defaults, "replace" uses only your verbs.',
        ),
      spinnerTipsOverride: z
        .object({
          excludeDefault: z.boolean().optional(),
          tips: z
            .array(
              z.union([
                z.string(),
                z
                  .object({
                    id: z.string().optional(),
                    text: z.string().optional(),
                    cooldownSessions: z.number().optional(),
                    priority: z.number().optional(),
                  })
                  .passthrough(),
              ]),
            )
            .optional(),
          tipsFile: z.string().optional(),
          label: z.string().optional(),
        })
        .optional()
        .describe(
          'Override spinner tips. tips: strings or {id, text, cooldownSessions, priority}. tipsFile/label: user or managed only. excludeDefault: if true, only show override tips (default: false).',
        ),
      syntaxHighlightingDisabled: z
        .boolean()
        .optional()
        .describe('Whether to disable syntax highlighting in diffs'),
      // densable 2.1.282/283 maxProseWidth (C().int().min(40).optional().catch(void 0))
      maxProseWidth: z
        .number()
        .int()
        .min(40)
        .optional()
        .catch(undefined)
        .describe(
          "Maximum width, in terminal columns, of the prose in Claude's responses (paragraphs, headings, lists, blockquotes). In a wider terminal the prose wraps at this width while tables and code blocks keep the full width; only the display wraps, the response text itself gains no line breaks. Minimum 40. Unset (the default) uses the full terminal width.",
        ),
      // densable 2.1.235 #1 — underline-as-you-type spellcheck (aspell/hunspell/ispell).
      // Whole block from highest-precedence of user/flag/managed only; project/local ignored.
      spellcheck: z
        .object({
          enabled: z
            .boolean()
            .optional()
            .catch(undefined)
            .describe(
              'Turn on spell checking of the prompt input (default: false)',
            ),
          checker: z
            .string()
            .optional()
            .catch(undefined)
            .describe(
              'Which spell checker to run: "aspell", "hunspell", "ispell", or "auto" (default) for the first of those found on PATH',
            ),
          language: z
            .string()
            .optional()
            .catch(undefined)
            .describe(
              'Dictionary to use, passed to the checker as-is (aspell --lang, hunspell -d, ispell -d), e.g. "en_GB"; names are checker-specific (letters, digits and _ - . , only). Default: the checker\'s own default',
            ),
          color: z
            .string()
            .optional()
            .catch(undefined)
            .describe(
              'Color of misspelled words (they are also underlined): a terminal color name such as "red" or "magenta", "#rrggbb", "rgb(r,g,b)", "ansi256(n)" or "ansi:<name>". Default: the theme\'s error color',
            ),
        })
        .passthrough()
        .optional()
        .catch(undefined)
        .describe(
          'Underline misspelled words in the prompt input as you type, using an installed aspell, hunspell or ispell (off unless "enabled" is true; does nothing if none is installed). Read from user, flag and managed settings only (the whole block from the highest-precedence of those applies); ignored in project .claude/settings.json and .claude/settings.local.json.',
        ),
      terminalTitleFromRename: z
        .boolean()
        .optional()
        .describe(
          'Whether /rename updates the terminal tab title (defaults to true). Set to false to keep auto-generated topic titles.',
        ),
      // densable 2.1.243 #3 — main vs subagent prompt-cache TTL.
      promptCacheTtl: z
        .enum(['5m', '1h'])
        .optional()
        .catch(undefined)
        .describe(
          'Prompt cache TTL for the main conversation (interactive, -p and SDK turns, plus the helpers that run inline with it): "5m" or "1h". Unset = automatic: 1 hour on a Claude subscription within its usage limits, 5 minutes on an API key, Bedrock, Vertex or Foundry. 1-hour cache writes are billed at a higher rate; the cache stays warm across longer breaks. The CLAUDE_CODE_PROMPT_CACHE_TTL environment variable takes precedence.',
        ),
      subagentPromptCacheTtl: z
        .enum(['5m', '1h'])
        .optional()
        .catch(undefined)
        .describe(
          'Prompt cache TTL for subagents: "5m" or "1h". Unset = automatic (typically 5 minutes). The CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL environment variable takes precedence.',
        ),
      alwaysThinkingEnabled: z
        .boolean()
        .optional()
        .describe(
          'When false, thinking is disabled. When absent or true, thinking is ' +
            'enabled automatically for supported models.',
        ),
      /**
       * densable remoteControlAtStartup — auto-start Remote Control for sessions.
       * Repo-scoped project/local settings may only *disable* (false); enabling
       * must be user/security-sensitive scope (/config or user settings). See
       * getRemoteControlAtStartup X_t.
       */
      remoteControlAtStartup: z
        .boolean()
        .optional()
        .describe(
          'When true, auto-start Remote Control for sessions. Only user-scope ' +
            'settings can enable this; project/local true is ignored. false from ' +
            'any scope disables.',
        ),
      remoteControl: z
        .object({
          shareHostProfile: z
            .enum(['off', 'basic', 'full'])
            .optional()
            .catch(undefined)
            .describe(
              "@internal What a Remote Control environment reports about this machine when it registers: 'off' reports nothing, 'basic' the OS, architecture and detected developer tools, 'full' also the names of MCP servers configured on this machine (never a repository's .mcp.json). When unset, the level comes from the feature rollout, which may be any of the three. Managed, --settings and user settings choose the level (the most restrictive wins); project and local settings can only lower it, never raise it. Read when Remote Control starts; lowering it later applies from the next registration, raising it from the next start.",
            ),
        })
        .optional()
        .describe('@internal Remote Control (`claude remote-control`) options'),
      isolatePeerMachines: z
        .boolean()
        .optional()
        .describe(
          'Require explicit approval before SendMessage can reach a peer session on another machine via Remote Control',
        ),
      daemonColdStart: z
        .enum(['transient', 'ask'])
        .optional()
        .describe(
          "When no background service is running: 'transient' spawns one for this login session; 'ask' offers to install it persistently",
        ),
      effortLevel: z
        .enum(
          process.env.USER_TYPE === 'ant'
            ? ['low', 'medium', 'high', 'xhigh', 'max']
            : ['low', 'medium', 'high', 'xhigh'],
        )
        .optional()
        .catch(undefined)
        .describe('Persisted effort level for supported models.'),
      maxEffortLevel: z
        .enum(['low', 'medium', 'high', 'xhigh', 'max'])
        .optional()
        .catch(undefined)
        .describe(
          "Maximum effort level. Anything above it (an /effort or /model pick, --effort, CLAUDE_CODE_EFFORT_LEVEL, a model default) is clamped to it, on every provider including Bedrock, Vertex and Foundry. Combines with an organization's per-model effort cap by taking the lower of the two; across settings files the lowest value wins, and modelSettings.<model>.maxEffortLevel replaces it per model. Enforced client-side: an effort supplied through CLAUDE_CODE_EXTRA_BODY is not clamped.",
        ),
      // densable 2.1.277 /config "Project instructions" — agents-md compositor mode.
      instructionFiles: z
        .enum([
          'claude-md',
          'claude-md-or-agents-md',
          'claude-md-and-agents-md',
          'managed-only',
        ])
        .optional()
        .describe(
          '"claude-md": CLAUDE.md only, loaded by the engine as today. "claude-md-or-agents-md" (default): a project with no CLAUDE.md of its own gets its AGENTS.md files instead, loaded exactly where and how CLAUDE.md would be. "claude-md-and-agents-md": AGENTS.md files are loaded beside CLAUDE.md (a file CLAUDE.md already imports or links to is not loaded twice). "managed-only": the project\'s and your own instruction files are dropped; the organization\'s managed CLAUDE.md and memory stay.',
        ),
      modelSettings: z
        .record(
          z.string(),
          z
            .object({
              effortLevel: z
                .enum(
                  process.env.USER_TYPE === 'ant'
                    ? ['low', 'medium', 'high', 'xhigh', 'max']
                    : ['low', 'medium', 'high', 'xhigh'],
                )
                .optional()
                .catch(undefined)
                .describe('Persisted effort level for this model.'),
              maxEffortLevel: z
                .enum(['low', 'medium', 'high', 'xhigh', 'max'])
                .optional()
                .catch(undefined)
                .describe(
                  'Maximum effort level for this model. Within one settings file it replaces the top-level maxEffortLevel for the model ("max" exempts it); across settings files the lowest applicable value wins. Keyed like effortLevel: the canonical model name also matches its dated, [1m], Bedrock and Vertex spellings.',
                ),
              autoCompactWindow: z
                .union([
                  z.literal('auto'),
                  z.number().int().min(100_000).max(1_000_000),
                ])
                .optional()
                .catch(undefined)
                .describe(
                  'Auto-compact window for this model, in tokens (100000 to 1000000), or "auto" for the window tuned for the model. Within one settings file it replaces the top-level autoCompactWindow for the model. /autocompact saves here. The canonical model name as key also matches its dated, [1m], Bedrock and Vertex spellings.',
                ),
            })
            .optional()
            .catch(undefined),
        )
        .optional()
        .catch(undefined)
        .describe('Per-model settings keyed by canonical model name.'),
      // densable settings.ultracode — session-scoped via --settings / apply_flag_settings.
      // Interactive /effort ultracode never persists this; bootstrap maps it to wire
      // effort (catalog top tier; densable hardcodes xhigh) + AppState.ultracode.
      ultracode: z
        .boolean()
        .optional()
        .catch(undefined)
        .describe(
          'Enable ultracode for the session: catalog top effort plus standing dynamic-workflow orchestration. ' +
            'Session-scoped — typically provided via --settings or the apply_flag_settings control request; ' +
            'interactive toggles never persist it. Requires workflows enabled and an effort-capable model.',
        ),
      advisorModel: z
        .string()
        .optional()
        .describe('Advisor model for the server-side advisor tool.'),
      // densable 2.1.234 /autocompact — token window before auto-summarizing.
      // Actual threshold is min(this, model max context). Env
      // CLAUDE_CODE_AUTO_COMPACT_WINDOW takes precedence when set.
      autoCompactWindow: z
        .number()
        .int()
        .min(100_000)
        .max(1_000_000)
        .optional()
        .describe(
          'Auto-compact window in tokens (100000–1000000). Omit for model-tuned auto. Overridden by CLAUDE_CODE_AUTO_COMPACT_WINDOW.',
        ),
      // densable Yo("autoCompactEnabled", true) / bridge ne tN flagSettings stamp.
      // Session-inline via setFlagSettingsInline; not a durable userSettings key.
      // When set, beats legacy GlobalConfig.autoCompactEnabled for compact gates.
      autoCompactEnabled: z
        .boolean()
        .optional()
        .describe(
          'Enable automatic conversation compaction. Session/flag settings beat the legacy global config default when set.',
        ),
      // densable 2.1.289 Yo("theme","dark") / W2("theme") — settings first,
      // legacy GlobalConfig.theme only as fallback.
      theme: z
        .string()
        .optional()
        .describe(
          'Color theme: "auto", a built-in theme name, or "custom:<slug>".',
        ),
      // Official 2.1.331 USER_INTENT_SETTING_KEYS (XJe @305509367..305515974):
      editorMode: z
        .enum(EDITOR_MODES)
        .optional()
        .catch(undefined)
        .describe('Key binding mode for the prompt input'),
      verbose: z
        .boolean()
        .optional()
        .describe('Show full tool output instead of truncated summaries'),
      preferredNotifChannel: z
        .enum(NOTIFICATION_CHANNELS)
        .optional()
        .catch(undefined)
        .describe('Preferred OS notification channel'),
      fileCheckpointingEnabled: z
        .boolean()
        .optional()
        .describe(
          "Snapshot files before edits so /rewind can restore them. In a session an SDK starts, only an administrator's false applies",
        ),
      showTurnDuration: z
        .boolean()
        .optional()
        .describe('Show "Cooked for Nm Ns" after each assistant turn'),
      terminalProgressBarEnabled: z
        .boolean()
        .optional()
        .describe('Emit OSC 9;4 progress sequences during long operations'),
      todoFeatureEnabled: z
        .boolean()
        .optional()
        .describe('Enable the todo / task tracking panel'),
      autoUploadSessions: z
        .boolean()
        .optional()
        .describe(
          'Mirror local sessions to claude.ai as view-only (no remote control)',
        ),
      inputNeededNotifEnabled: z
        .boolean()
        .optional()
        .describe(
          'Push to mobile when a permission prompt or question is waiting',
        ),
      agentPushNotifEnabled: z
        .boolean()
        .optional()
        .describe('Allow Claude to push proactive mobile notifications'),
      clawdFileProgressEnabled: z
        .boolean()
        .optional()
        .describe(
          "@internal Whether to show Clawd, Claude Code's mascot, carrying the file on the progress line when a file goes to or from a connector",
        ),
      fastMode: z
        .boolean()
        .optional()
        .describe(
          'When true, fast mode is enabled. When absent or false, fast mode is off.',
        ),
      fastModePerSessionOptIn: z
        .boolean()
        .optional()
        .describe(
          'When true, fast mode does not persist across sessions. Each session starts with fast mode off.',
        ),
      promptSuggestionEnabled: z
        .boolean()
        .optional()
        .describe(
          'When false, prompt suggestions are disabled. When absent or true, ' +
            'prompt suggestions are enabled.',
        ),
      // densable 2.1.217 #1
      emojiCompletionEnabled: z
        .boolean()
        .optional()
        .describe(
          'When false, the :emoji: shortcode typeahead (the suggestion popup and the :name: inline replacement) is disabled. When absent or true, it is enabled.',
        ),
      awaySummaryEnabled: z
        .boolean()
        .optional()
        .describe(
          '@internal When false, the session recap (shown when you return after being away for 5+ minutes) is disabled. When absent or true, recap is enabled. Hidden from public SDK types until external launch.',
        ),
      responseComparisonEnabled: z
        .boolean()
        .optional()
        .describe(
          '@internal Set to false to stop Claude Code from showing two answers to one message and asking which is better. When absent or true, it may do so on some turns. Hidden from public SDK types until external launch.',
        ),
      // densable `non_deferrable_builtins` / eGu — opt-out list for TX defer policy
      non_deferrable_builtins: z
        .array(z.string())
        .optional()
        .describe(
          'Built-in tool names that must never be deferred (always sent with full schema). Merged with GrowthBook tengu_non_deferrable_builtins.',
        ),
      showClearContextOnPlanAccept: z
        .boolean()
        .optional()
        .describe(
          'When true, the plan-approval dialog offers a "clear context" option. Defaults to false.',
        ),
      agent: z
        .string()
        .optional()
        .describe(
          'Name of an agent (built-in or custom) to use for the main thread. ' +
            "Applies the agent's system prompt, tool restrictions, and model.",
        ),
      companyAnnouncements: z
        .array(z.string())
        .optional()
        .describe(
          'Company announcements to display at startup (one will be randomly selected if multiple are provided)',
        ),
      pluginConfigs: z
        .record(
          z.string(),
          z.object({
            mcpServers: z
              .record(
                z.string(),
                z.record(
                  z.string(),
                  z.union([
                    z.string(),
                    z.number(),
                    z.boolean(),
                    z.array(z.string()),
                  ]),
                ),
              )
              .optional()
              .describe(
                'User configuration values for MCP servers keyed by server name',
              ),
            options: z
              .record(
                z.string(),
                z.union([
                  z.string(),
                  z.number(),
                  z.boolean(),
                  z.array(z.string()),
                ]),
              )
              .optional()
              .describe(
                'Non-sensitive option values from plugin manifest userConfig, keyed by option name. Sensitive values go to secure storage instead.',
              ),
          }),
        )
        .optional()
        .describe(
          'Per-plugin configuration including MCP server user configs, keyed by plugin ID (plugin@marketplace format). ' +
            'Official 2.1.207: only user, --settings (flag), and managed settings are honored; ' +
            'project .claude/settings.json and settings.local.json are ignored for this key.',
        ),
      remote: z
        .object({
          defaultEnvironmentId: z
            .string()
            .optional()
            .describe('Default environment ID to use for remote sessions'),
        })
        .optional()
        .describe('Remote session configuration'),
      autoUpdatesChannel: z
        .enum(['latest', 'stable', 'rc'])
        .optional()
        .describe('Release channel for auto-updates (latest or stable)'),
      ...(feature('LODESTONE')
        ? {
            disableDeepLinkRegistration: z
              .enum(['disable'])
              .optional()
              .describe(
                'Prevent claude-cli:// protocol handler registration with the OS',
              ),
          }
        : {}),
      minimumVersion: z
        .string()
        .optional()
        .describe(
          'Minimum version to stay on - prevents downgrades when switching to stable channel',
        ),
      requiredMinimumVersion: z
        .string()
        .optional()
        .describe(
          'Minimum Claude Code version required to start. If the running version is older, Claude Code exits at startup with instructions to update. Only enforced from managed (policy) settings.',
        ),
      requiredMaximumVersion: z
        .string()
        .optional()
        .describe(
          'Maximum Claude Code version allowed to start. If the running version is newer, Claude Code exits at startup with instructions to install an approved version. Only enforced from managed (policy) settings.',
        ),
      downloadsMirrorUrl: z
        .string()
        .optional()
        .describe(
          'Anthropic-run mirror from which native installs download Claude Code releases (claude install, claude update, and auto-updates), instead of https://downloads.claude.ai. Must be exactly https://claude.fedstart.com/claude-downloads (Claude for Government). Any other value stops installs and updates with an error. CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC normally turns auto-updates off, but not with this mirror set. Only read from managed (policy) settings.',
        ),
      plansDirectory: z
        .string()
        .optional()
        .describe(
          'Custom directory for plan files, relative to project root. ' +
            'If not set, defaults to ~/.claude/plans/',
        ),
      ...(process.env.USER_TYPE === 'ant'
        ? {
            classifierPermissionsEnabled: z
              .boolean()
              .optional()
              .describe(
                'Enable AI-based classification for Bash(prompt:...) permission rules',
              ),
          }
        : {}),
      ...(feature('PROACTIVE') || feature('KAIROS')
        ? {
            minSleepDurationMs: z
              .number()
              .nonnegative()
              .int()
              .optional()
              .describe(
                'Minimum duration in milliseconds that the Sleep tool must sleep for. ' +
                  'Useful for throttling proactive tick frequency.',
              ),
            maxSleepDurationMs: z
              .number()
              .int()
              .min(-1)
              .optional()
              .describe(
                'Maximum duration in milliseconds that the Sleep tool can sleep for. ' +
                  'Set to -1 for indefinite sleep (waits for user input). ' +
                  'Useful for limiting idle time in remote/managed environments.',
              ),
          }
        : {}),
      ...(feature('VOICE_MODE')
        ? {
            voiceEnabled: z
              .boolean()
              .optional()
              .describe('Enable voice mode (hold-to-talk dictation)'),
            voice: z
              .object({
                enabled: z
                  .boolean()
                  .optional()
                  .describe('Enable voice mode (hold-to-talk dictation)'),
              })
              .optional(),
            voiceProvider: z
              .enum(['anthropic', 'doubao'])
              .optional()
              .describe(
                'Voice STT backend: "anthropic" (default) or "doubao" (Doubao ASR)',
              ),
          }
        : {}),
      ...(feature('KAIROS')
        ? {
            assistant: z
              .boolean()
              .optional()
              .describe(
                'Start Claude in assistant mode (custom system prompt, brief view, scheduled check-in skills)',
              ),
            assistantName: z
              .string()
              .optional()
              .describe(
                'Display name for the assistant, shown in the claude.ai session list',
              ),
          }
        : {}),
      // Teams/Enterprise opt-IN for channel notifications. Default OFF.
      // MCP servers that declare the claude/channel capability can push
      // inbound messages into the conversation; for managed orgs this only
      // works when explicitly enabled. Which servers can connect at all is
      // still governed by allowedMcpServers/deniedMcpServers. Not
      // feature-spread: KAIROS_CHANNELS is external:true, and the spread
      // wrecks type inference for allowedChannelPlugins (the .passthrough()
      // catch-all gives {} instead of the array type).
      channelsEnabled: z
        .boolean()
        .optional()
        .describe(
          'Teams/Enterprise opt-in for channel notifications (MCP servers with the ' +
            'claude/channel capability pushing inbound messages). Default off. ' +
            'Set true to allow; users then select servers via --channels.',
        ),
      // Org-level channel plugin allowlist. When set, REPLACES the
      // Anthropic ledger — admin owns the trust decision. Undefined means
      // fall back to the ledger. Plugin-only entry shape (same as the
      // ledger); server-kind entries still need the dev flag.
      allowedChannelPlugins: z
        .array(
          z.object({
            marketplace: z.string(),
            plugin: z.string(),
          }),
        )
        .optional()
        .describe(
          'Teams/Enterprise allowlist of channel plugins. When set, ' +
            'replaces the default Anthropic allowlist — admins decide which ' +
            'plugins may push inbound messages. Undefined falls back to the default. ' +
            'Requires channelsEnabled: true.',
        ),
      ...(feature('KAIROS') || feature('KAIROS_BRIEF')
        ? {
            defaultView: z
              .enum(['chat', 'transcript'])
              .optional()
              .describe(
                'Default transcript view: chat (SendUserMessage checkpoints only) or transcript (full)',
              ),
          }
        : {}),
      prefersReducedMotion: z
        .boolean()
        .optional()
        .describe(
          'Reduce or disable animations for accessibility (spinner shimmer, flash effects, etc.)',
        ),
      // densable 2.1.283 h1e / timeFormat ($e([G(h1e),o()]))
      timeFormat: z
        .union([
          z.enum(['auto', '12-hour', '24-hour', '24-hour-utc']),
          z.string(),
        ])
        .optional()
        .describe(
          'Clock format for times shown in the UI: "auto" (default, follows the locale), "12-hour", "24-hour", "24-hour-utc" ("18:05Z"), or a strftime pattern such as "%H:%M" (any value containing "%"; other values read as "auto"). A pattern replaces the time everywhere; message timestamps show only the pattern, so include %Y-%m-%d for the date. /config offers the presets; a pattern is set here.',
        ),
      timeZone: z
        .string()
        .optional()
        .describe(
          'IANA time zone for times shown in the UI, e.g. "UTC" or "Europe/Dublin". Default: the system time zone. An unknown name falls back to the system time zone.',
        ),
      doneMeansMerged: z
        .boolean()
        .optional()
        .describe(
          '@internal When true, Claude keeps working until the PR is ready for you to merge, a cron/Monitor is armed to resume later, or it hands you a self-contained next step.',
        ),
      /**
       * Official axScreenReader — render screen-reader friendly output.
       * Overridden by CLAUDE_AX_SCREEN_READER env and --ax-screen-reader flag.
       */
      axScreenReader: z
        .boolean()
        .optional()
        .describe(
          'Render screen-reader friendly output (flat text, no decorative borders or animations). Overridden by the CLAUDE_AX_SCREEN_READER env var and the --ax-screen-reader CLI flag.',
        ),
      /**
       * densable 2.1.238 — prompt editing key conventions (SEA keybindingFlavor).
       * Only Ctrl+W is flavored; Meta/Ctrl+Backspace stay classic word delete.
       */
      keybindingFlavor: z
        .enum(['classic', 'readline'])
        .optional()
        .describe(
          'Which conventions the prompt\'s editing keys follow: "readline" matches Bash and other readline programs (Ctrl+W deletes back to the previous whitespace); "classic" (default) keeps Claude Code\'s long-standing behavior (Ctrl+W deletes the previous word)',
        ),
      /**
       * Official vimInsertModeRemaps — INSERT two-key sequences → NORMAL.
       * e.g. {"jj":"<Esc>"}. Only "<Esc>" targets; keys exactly two printable chars.
       */
      vimInsertModeRemaps: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Vim INSERT-mode key-sequence remaps, e.g. {"jj": "<Esc>"}. Each key is exactly two printable characters typed in sequence; "<Esc>" (return to NORMAL mode) is the only supported target. Applies when editorMode is "vim".',
        ),
      /**
       * @internal Official totalTokensReminder — emit `<total_tokens>N tokens left</total_tokens>`.
       * Env CLAUDE_CODE_TOTAL_TOKENS_REMINDER overrides. Defaults to off.
       */
      totalTokensReminder: z
        .enum(['off', 'infinite', 'fixed', 'countdown', 'padded-countdown'])
        .optional()
        .describe(
          "@internal Emit a <total_tokens>N tokens left</total_tokens> block in the system prompt, after each tool result, and (when totalTokensReminderAfterUserTurn is on) after each regular user prompt. 'infinite' uses the literal value Infinite, 'fixed' uses 5000000, 'countdown' uses the live remaining context-window tokens, 'padded-countdown' counts down from totalTokensReminderBudget. Defaults to off. Env var CLAUDE_CODE_TOTAL_TOKENS_REMINDER overrides.",
        ),
      totalTokensReminderBudget: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "@internal Starting budget (tokens) for totalTokensReminder 'padded-countdown' mode. Defaults to 15000000. Server-controlled via GrowthBook; env var CLAUDE_CODE_TOTAL_TOKENS_REMINDER_BUDGET overrides.",
        ),
      totalTokensReminderAfterUserTurn: z
        .boolean()
        .optional()
        .describe(
          "@internal When true, emit the totalTokensReminder block after each regular user prompt and (for 'padded-countdown') re-anchor the task budget. Defaults to off. Env var CLAUDE_CODE_TOTAL_TOKENS_REMINDER_AFTER_USER_TURN overrides; server-controlled via GrowthBook tengu_lapis_anchor_user_turn.",
        ),
      autoMemoryEnabled: z
        .boolean()
        .optional()
        .describe(
          'Enable auto-memory for this project. When false, Claude will not read from or write to the auto-memory directory.',
        ),
      autoMemoryDirectory: z
        .string()
        .optional()
        .describe(
          'Custom directory path for auto-memory storage. Supports ~/ prefix for home directory expansion. Ignored if set in projectSettings (checked-in .claude/settings.json) for security. When unset, defaults to ~/.claude/projects/<sanitized-cwd>/memory/.',
        ),
      autoDreamEnabled: z
        .boolean()
        .optional()
        .describe(
          'Enable background memory consolidation (auto-dream). When set, overrides the server-side default.',
        ),
      showThinkingSummaries: z
        .boolean()
        .optional()
        .describe(
          'Show thinking summaries in the transcript view (ctrl+o). Default: false.',
        ),
      skipDangerousModePermissionPrompt: z
        .boolean()
        .optional()
        .describe(
          'Whether the user has accepted the bypass permissions mode dialog',
        ),
      ...(feature('TRANSCRIPT_CLASSIFIER')
        ? {
            skipAutoPermissionPrompt: z
              .boolean()
              .optional()
              .describe(
                'Whether the user has accepted the auto mode opt-in dialog',
              ),
            useAutoModeDuringPlan: z
              .boolean()
              .optional()
              .describe(
                'Whether plan mode uses auto mode semantics when auto mode is available (default: true)',
              ),
            autoMode: z
              .object({
                allow: z
                  .array(z.string())
                  .optional()
                  .describe('Rules for the auto mode classifier allow section'),
                soft_deny: z
                  .array(z.string())
                  .optional()
                  .describe('Rules for the auto mode classifier deny section'),
                hard_deny: z
                  .array(z.string())
                  .optional()
                  .describe(
                    'Hard deny rules for the auto mode classifier (always block; user intent does not clear)',
                  ),
                ...(process.env.USER_TYPE === 'ant'
                  ? {
                      // Back-compat alias for ant users; external users use soft_deny
                      deny: z.array(z.string()).optional(),
                    }
                  : {}),
                environment: z
                  .array(z.string())
                  .optional()
                  .describe(
                    'Entries for the auto mode classifier environment section',
                  ),
                // Official 2.1.193: suspend every Bash/PowerShell allow rule in auto mode
                classifyAllShell: z
                  .boolean()
                  .optional()
                  .describe(
                    'When true, every Bash/PowerShell allow rule is suspended while auto mode is active so all shell commands are routed through the classifier (higher safety, more classifier calls). Default: false.',
                  ),
              })
              .optional()
              .describe('Auto mode classifier prompt customization'),
          }
        : {}),
      disableAutoMode: z
        .enum(['disable'])
        .optional()
        .describe('Disable auto mode'),
      // Official 2.1.331: remoteTools.allowUnattendedServing
      remoteTools: z
        .object({
          allowUnattendedServing: z
            .boolean()
            .optional()
            .describe(
              '@internal When false in managed or user settings, a cloud session in auto mode may not run commands on this computer without a person approving each one, whatever consent the computer has given; a project, local or --settings value is ignored. Default: true.',
            ),
        })
        .optional()
        .describe(
          '@internal How this computer serves tool calls to cloud sessions',
        ),
      sshConfigs: z
        .array(
          z.object({
            id: z
              .string()
              .describe(
                'Unique identifier for this SSH config. Used to match configs across settings sources.',
              ),
            name: z.string().describe('Display name for the SSH connection'),
            sshHost: z
              .string()
              .describe(
                'SSH host in format "user@hostname" or "hostname", or a host alias from ~/.ssh/config',
              ),
            sshPort: z
              .number()
              .int()
              .optional()
              .describe('SSH port (default: 22)'),
            sshIdentityFile: z
              .string()
              .optional()
              .describe('Path to SSH identity file (private key)'),
            startDirectory: z
              .string()
              .optional()
              .describe(
                'Default working directory on the remote host. ' +
                  'Supports tilde expansion (e.g. ~/projects). ' +
                  'If not specified, defaults to the remote user home directory. ' +
                  'Can be overridden by the [dir] positional argument in `claude ssh <config> [dir]`.',
              ),
          }),
        )
        .optional()
        .describe(
          'SSH connection configurations for remote environments. ' +
            'Typically set in managed settings by enterprise administrators ' +
            'to pre-configure SSH connections for team members.',
        ),
      sshHostCommands: z
        .unknown()
        .meta({ type: 'array' })
        .optional()
        .describe(
          "SSH connections in Claude Desktop whose host comes from a command. A list of entries, each with `id`, `name` and `command`, and optionally `sshIdentityFile` and `startDirectory`. Desktop runs `command` on this computer when you create the connection or another host for it, not each time you connect. `command` is a program name or absolute path (single-quote a path with spaces), then plain arguments. Nothing else can be quoted. For pipes, variables or a leading `~`, use a script. On Windows, the program must be a full path from a drive letter, such as `C:/tools/acme.exe`, ending in `.exe`, `.cmd` or `.bat`. Quoted paths and Windows need Claude Desktop v4.16336.0 or later. The command must print only the host on standard output: `host` or `user@host` on one line, or a JSON object with `sshHost` and, optionally, `sshPort` and `startDirectory`. Desktop reads this key only from user settings and from this computer's managed settings. Claude Code itself does not use it.",
        ),
      /**
       * densable claudeMd — org-managed CLAUDE.md-style instructions.
       * Only honored from managed/policy settings; enters hFt dangerous projection
       * for settings-approval (2.1.218 #32).
       */
      claudeMd: z
        .string()
        .optional()
        .describe(
          'CLAUDE.md-style instructions injected as organization-managed memory. ' +
            'Only honored from managed/policy settings.',
        ),
      claudeMdExcludes: z
        .array(z.string())
        .optional()
        .describe(
          'Glob patterns or absolute paths of CLAUDE.md files to exclude from loading. ' +
            'Patterns are matched against absolute file paths using picomatch. ' +
            'Only applies to User, Project, and Local memory types (Managed/policy files cannot be excluded). ' +
            'Examples: "/home/user/monorepo/CLAUDE.md", "**/code/CLAUDE.md", "**/some-dir/.claude/rules/**"',
        ),
      cacheThreshold: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe(
          'Prompt cache hit rate threshold (0-100) for context analysis. Default: 70.',
        ),
      pluginTrustMessage: z
        .string()
        .optional()
        .describe(
          'Custom message to append to the plugin trust warning shown before installation. ' +
            'Only read from policy settings (managed-settings.json / MDM). ' +
            'Useful for enterprise administrators to add organization-specific context ' +
            '(e.g., "All plugins from our internal marketplace are vetted and approved.").',
        ),
      // Official 2.1.x: managed allowlist for contextual plugin install tips
      pluginSuggestionMarketplaces: z
        .array(z.string())
        .optional()
        .describe(
          'Marketplace names whose plugins may surface as contextual install suggestions ' +
            '(relevance-based tips). No marketplace-declared suggestions surface without this ' +
            'allowlist; the built-in first-party frontend-design tips are unaffected. ' +
            'Only honored from managed settings; ignored in user/project/local settings.',
        ),
      /**
       * Workspace API key stored in settings.json for /login UI convenience.
       *
       * ⚠️ SECURITY NOTICE: stored in plaintext in ~/.claude.json — ensure this
       * file is gitignored and has restricted permissions (chmod 600 on POSIX).
       * Use ANTHROPIC_API_KEY env var in CI/CD or shared environments instead.
       *
       * Must start with "sk-ant-api03-". Read via getGlobalConfig().workspaceApiKey
       * or the ANTHROPIC_API_KEY env var (env var takes precedence).
       */
      workspaceApiKey: z
        .string()
        .optional()
        .describe(
          'Workspace API key (sk-ant-api03-*) saved via /login UI. ' +
            'Stored in plaintext — keep this file gitignored and restrict its permissions. ' +
            'ANTHROPIC_API_KEY environment variable takes precedence when both are set.',
        ),
      skillListingMaxDescChars: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Per-skill description character cap in the skill listing sent to Claude (default: 1536). Descriptions longer than this are truncated. Raise to opt in to higher per-turn context cost.',
        ),
      skillListingBudgetFraction: z
        .number()
        .gt(0)
        .lte(1)
        .optional()
        .describe(
          'Fraction of the context window (in characters) reserved for the skill listing sent to Claude (default: 0.01 = 1%). When the listing exceeds this, descriptions are shortened to fit. Raise to opt in to higher per-turn context cost.',
        ),
    })
    .passthrough(),
)

/**
 * Internal type for plugin hooks - includes plugin context for execution.
 * Not a Zod schema since it's not user-facing (plugins provide native hooks).
 */
export type PluginHookMatcher = {
  matcher?: string
  hooks: HookCommand[]
  pluginRoot: string
  pluginName: string
  pluginId: string // format: "pluginName@marketplaceName"
}

/**
 * Internal type for skill hooks - includes skill context for execution.
 * Not a Zod schema since it's not user-facing (skills provide native hooks).
 */
export type SkillHookMatcher = {
  matcher?: string
  hooks: HookCommand[]
  skillRoot: string
  skillName: string
}

export type AllowedMcpServerEntry = z.infer<
  ReturnType<typeof AllowedMcpServerEntrySchema>
>
export type DeniedMcpServerEntry = z.infer<
  ReturnType<typeof DeniedMcpServerEntrySchema>
>
export type SettingsJson = z.infer<ReturnType<typeof SettingsSchema>>

/**
 * Type guard for MCP server entry with serverName
 */
export function isMcpServerNameEntry(
  entry: AllowedMcpServerEntry | DeniedMcpServerEntry,
): entry is { serverName: string } {
  return 'serverName' in entry && entry.serverName !== undefined
}

/**
 * Type guard for MCP server entry with serverCommand
 */
export function isMcpServerCommandEntry(
  entry: AllowedMcpServerEntry | DeniedMcpServerEntry,
): entry is { serverCommand: string[] } {
  return 'serverCommand' in entry && entry.serverCommand !== undefined
}

/**
 * Type guard for MCP server entry with serverUrl
 */
export function isMcpServerUrlEntry(
  entry: AllowedMcpServerEntry | DeniedMcpServerEntry,
): entry is { serverUrl: string } {
  return 'serverUrl' in entry && entry.serverUrl !== undefined
}

/**
 * User configuration values for MCPB MCP servers
 */
export type UserConfigValues = Record<
  string,
  string | number | boolean | string[]
>

/**
 * Plugin configuration stored in settings.json
 */
export type PluginConfig = {
  mcpServers?: {
    [serverName: string]: UserConfigValues
  }
}
