import { posix } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
// Types extracted to src/types/permissions.ts to break import cycles
import type {
  AdditionalWorkingDirectory,
  WorkingDirectorySource,
} from '../../types/permissions.js'
import { logForDebugging } from '../debug.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'
import type { EditableSettingSource } from '../settings/constants.js'
import { isLocalSettingsGitTracked } from '../settings/localSettingsGitTracked.js'
import {
  getSettingsFilePathForSource,
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import { getSettingSourceDisplayNameLowercase } from '../settings/constants.js'
import { jsonStringify } from '../slowOperations.js'
import { toPosixPath } from './filesystem.js'
import { isModeBlockedByHeldToAuto } from './PermissionMode.js'
import type { PermissionRuleValue } from './PermissionRule.js'
import type {
  PermissionUpdate,
  PermissionUpdateDestination,
} from './PermissionUpdateSchema.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from './permissionRuleParser.js'
import {
  addPermissionRulesToSettings,
  shouldAllowManagedPermissionRulesOnly,
} from './permissionsLoader.js'

// Re-export for backwards compatibility
export type { AdditionalWorkingDirectory, WorkingDirectorySource }

/** Official 2.1.323 #2176 (`d6t` / `cDo` / `Gma`) session-only downgrade reasons. */
export type AllowRuleSessionOnlyReason =
  | 'holds_secret'
  | 'scan_failed'
  | 'tracked_by_git'

export const SESSION_ONLY_ALLOW_REASON_MESSAGES: Record<
  AllowRuleSessionOnlyReason,
  string
> = {
  holds_secret:
    'Allowed for this session only. The rule looks like it contains a secret, so it isn’t saved to settings.',
  scan_failed:
    'Allowed for this session only. The rule couldn’t be checked for secrets, so it isn’t saved to settings.',
  tracked_by_git:
    'Allowed for this session only. Git tracks .claude/settings.local.json, so the rule isn’t saved there.',
}

const SECRET_VALUE_START = `(?:\\$?["'])*(?!\\d+:\\d|op://)[^\\s"'\`$\\%*<({|;&~./=-]`
const SECRET_KEY_NAMES =
  '(?:password|passwd|passphrase|_pass|(?<![a-z])(?<!--)secret(?:[_-]?key(?:_base)?)?|(?<!(?:max|min|next|starting|page|continuation)[_-])token|api[_-]?key|access[_-]?key|private[_-]?key)'

// Official 2.1.323 `wp` + high-confidence credential token patterns (#2176).
const ALLOW_RULE_SECRET_PATTERNS: readonly RegExp[] = [
  new RegExp(`${SECRET_KEY_NAMES}=${SECRET_VALUE_START}`, 'i'),
  new RegExp(
    `\\$env:\\w{0,40}?${SECRET_KEY_NAMES}\\s*=\\s*${SECRET_VALUE_START}`,
    'i',
  ),
  new RegExp(`${SECRET_KEY_NAMES}["']\\s*:\\s*${SECRET_VALUE_START}`, 'i'),
  new RegExp(
    `--(?!no-)[\\w-]{0,40}${SECRET_KEY_NAMES.replace('|private[_-]?key', '')}\\s+${SECRET_VALUE_START}`,
    'i',
  ),
  new RegExp(
    `--[\\w-]{0,40}private[_-]?key\\s+(?!(?=\\S{1,39}(?:\\s|$))\\S*[/.]|\\S{0,300}\\.(?:pem|key|p8|p12|pfx|der)(?:["')\\s]|$))${SECRET_VALUE_START}`,
    'i',
  ),
  new RegExp(
    `(?:authorization:\\s*(?:(?:bearer|basic|token|apikey)\\s+|(?!(?:bearer|basic|token|apikey)\\b))|api-key:\\s*|token:\\s+)${SECRET_VALUE_START}`,
    'i',
  ),
  new RegExp(`\\bsshpass\\s+-p\\s*${SECRET_VALUE_START}`),
  new RegExp(
    `\\b(?:mysql|mysqldump|mysqladmin|mariadb)\\b[^|;&]{0,400}?\\s-p${SECRET_VALUE_START}`,
  ),
  new RegExp(
    `\\bredis-cli\\b[^|;&]{0,400}?\\s(?:-a|--pass)\\s+${SECRET_VALUE_START}`,
  ),
  new RegExp(
    `\\bdocker\\s+login\\b[^|;&]{0,400}?\\s-p\\s*${SECRET_VALUE_START}`,
  ),
  new RegExp(
    `\\bcurl\\b[^|;]{0,400}?\\s(?:-u|--user)[\\s=]*["']?[^\\s:"'$]{1,100}:${SECRET_VALUE_START}`,
  ),
  // High-confidence provider token formats (Anthropic, OpenAI, GitHub, AWS, Slack, Google, PEM)
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{24,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bxox[bpoas]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  // URL embedded credentials: https://user:secret@host
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@'"]+:[^/\s@'"$]{6,}@[^\s/'"]+/i,
]

const fallbackPermissionUpdateHost: object = {}
const secretScannerOverrideByHost = new HostSlot<{
  scanner: ((text: string) => boolean) | undefined
}>(() => ({ scanner: undefined }))

function getSecretScannerOverrideSlot(): {
  scanner: ((text: string) => boolean) | undefined
} {
  try {
    const host = getBootstrapSessionHost()
    if (host) return secretScannerOverrideByHost.of(host)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return secretScannerOverrideByHost.of(fallbackPermissionUpdateHost)
}

export function _setAllowRuleSecretScannerForTesting(
  scanner: ((text: string) => boolean) | undefined,
): void {
  getSecretScannerOverrideSlot().scanner = scanner
}

function scanAllowRuleForSecret(
  rule: PermissionRuleValue,
): 'holds_secret' | 'scan_failed' | undefined {
  const text = `${rule.toolName} ${rule.ruleContent ?? ''}`
  try {
    const override = getSecretScannerOverrideSlot().scanner
    if (override) {
      return override(text) ? 'holds_secret' : undefined
    }
    const normalized = text.includes('\x00')
      ? text.replaceAll('\x00', '')
      : text
    for (const pattern of ALLOW_RULE_SECRET_PATTERNS) {
      if (pattern.test(text) || pattern.test(normalized)) {
        return 'holds_secret'
      }
    }
    return undefined
  } catch {
    return 'scan_failed'
  }
}

function isLocalSettingsTrackedForAllowPersistence(): boolean {
  try {
    return isLocalSettingsGitTracked({ onIndeterminate: 'untracked' })
  } catch {
    return false
  }
}

/**
 * Official 2.1.323 `cDo` (#2176): returns why an allow rule should be kept
 * session-only instead of persisted to `destination`, or `undefined` if it may
 * be saved to settings.
 */
export function classifyAllowRuleSessionOnlyReason(
  rule: PermissionRuleValue,
  destination: PermissionUpdateDestination,
): AllowRuleSessionOnlyReason | undefined {
  if (destination === 'session' || destination === 'cliArg') {
    return undefined
  }
  const reason: AllowRuleSessionOnlyReason | undefined =
    scanAllowRuleForSecret(rule) ??
    (destination === 'localSettings' &&
    isLocalSettingsTrackedForAllowPersistence()
      ? 'tracked_by_git'
      : undefined)
  if (reason === undefined) {
    return undefined
  }
  if (supportsPersistence(destination)) {
    const existing = getSettingsForSource(destination)?.permissions?.allow
    if (existing?.includes(permissionRuleValueToString(rule)) === true) {
      return undefined
    }
  }
  return reason
}

/**
 * Official 2.1.323 `d6t` (#2176): splits allow rules that look like secrets or
 * would be written to a git-tracked `.claude/settings.local.json` out of the
 * persisted update and redirects them to `destination: 'session'`.
 */
export function downgradePermissionUpdateForPersistence(
  update: PermissionUpdate,
): {
  updates: PermissionUpdate[]
  reason: AllowRuleSessionOnlyReason | undefined
} {
  if (
    update.type === 'removeRules' &&
    update.behavior === 'allow' &&
    update.destination !== 'session' &&
    update.destination !== 'cliArg'
  ) {
    return {
      updates: [update, { ...update, destination: 'session' }],
      reason: undefined,
    }
  }
  if (
    (update.type !== 'addRules' && update.type !== 'replaceRules') ||
    update.behavior !== 'allow'
  ) {
    return { updates: [update], reason: undefined }
  }
  const persistable: PermissionRuleValue[] = []
  const sessionOnly: PermissionRuleValue[] = []
  let firstReason: AllowRuleSessionOnlyReason | undefined
  for (const rule of update.rules) {
    const reason = classifyAllowRuleSessionOnlyReason(rule, update.destination)
    firstReason ??= reason
    if (reason === undefined) {
      persistable.push(rule)
    } else {
      sessionOnly.push(rule)
    }
  }
  if (firstReason === undefined) {
    return { updates: [update], reason: undefined }
  }
  const updates: PermissionUpdate[] = []
  if (persistable.length > 0 || update.type === 'replaceRules') {
    updates.push({ ...update, rules: persistable })
  }
  if (sessionOnly.length > 0) {
    updates.push({
      type: 'addRules',
      rules: sessionOnly,
      behavior: 'allow',
      destination: 'session',
    })
  }
  return { updates, reason: firstReason }
}

/**
 * Official 2.1.323 `sz` (#2176): downgrades a batch of permission updates for
 * persistence and returns the combined update list plus the first user-facing
 * downgrade reason (if any).
 */
export function downgradePermissionUpdatesForPersistence(
  updates: readonly PermissionUpdate[],
): {
  updates: PermissionUpdate[]
  reason: AllowRuleSessionOnlyReason | undefined
} {
  const out: PermissionUpdate[] = []
  let firstReason: AllowRuleSessionOnlyReason | undefined
  for (const update of updates) {
    const downgraded = downgradePermissionUpdateForPersistence(update)
    firstReason ??= downgraded.reason
    out.push(...downgraded.updates)
  }
  return { updates: out, reason: firstReason }
}

export function extractRules(
  updates: PermissionUpdate[] | undefined,
): PermissionRuleValue[] {
  if (!updates) return []

  return updates.flatMap(update => {
    switch (update.type) {
      case 'addRules':
        return update.rules
      default:
        return []
    }
  })
}

export function hasRules(updates: PermissionUpdate[] | undefined): boolean {
  return extractRules(updates).length > 0
}

/**
 * Applies a single permission update to the context and returns the updated context
 * @param context The current permission context
 * @param update The permission update to apply
 * @returns The updated permission context
 */
export function applyPermissionUpdate(
  context: ToolPermissionContext,
  update: PermissionUpdate,
): ToolPermissionContext {
  // Official 2.1.323 #2176: allow rules containing secrets or targeting a
  // git-tracked settings.local.json are downgraded to session scope.
  // Removing a persisted allow rule must also remove any downgraded session copy.
  if (
    (update.type === 'addRules' ||
      update.type === 'replaceRules' ||
      update.type === 'removeRules') &&
    update.behavior === 'allow' &&
    supportsPersistence(update.destination)
  ) {
    const { updates, reason } = downgradePermissionUpdateForPersistence(update)
    if (reason !== undefined) {
      logForDebugging(
        `Allow rule downgraded to session-only (${reason}): ${SESSION_ONLY_ALLOW_REASON_MESSAGES[reason]}`,
      )
    }
    if (updates.length > 1 || reason !== undefined) {
      let next = context
      for (const u of updates) {
        next = applySinglePermissionUpdate(next, u)
      }
      return next
    }
  }
  return applySinglePermissionUpdate(context, update)
}

function applySinglePermissionUpdate(
  context: ToolPermissionContext,
  update: PermissionUpdate,
): ToolPermissionContext {
  switch (update.type) {
    case 'setMode':
      // Official 2.1.331 `RIo`: bridge child sessions held to auto cannot enter
      // modes outside the auto ceiling (`bypassPermissions` or `acceptEdits`).
      if (isModeBlockedByHeldToAuto(update.mode)) {
        logForDebugging(
          update.mode === 'bypassPermissions'
            ? 'Ignoring permission update: Bypass permissions mode is not available in a session held to auto mode'
            : `Ignoring permission update: setMode '${update.mode}' rejected in a session held to auto mode`,
        )
        return context
      }
      // Official 2.1.325 #2295 (SEA @284784602): reject unavailable bypassPermissions
      // and clear stale `prePlanMode` whenever leaving plan mode so a subsequent
      // plan exit cannot revert the session to an earlier permission mode.
      if (
        update.mode === 'bypassPermissions' &&
        !context.isBypassPermissionsModeAvailable
      ) {
        logForDebugging(
          "Ignoring permission update: setMode 'bypassPermissions' rejected — mode is not available (disableBypassPermissionsMode set, or session not launched in bypassPermissions mode)",
        )
        return context
      }
      logForDebugging(
        `Applying permission update: Setting mode to '${update.mode}'`,
      )
      return {
        ...context,
        mode: update.mode,
        ...(update.mode !== 'plan' &&
          context.prePlanMode !== undefined && { prePlanMode: undefined }),
      }

    case 'addRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Applying permission update: Adding ${update.rules.length} ${update.behavior} rule(s) to destination '${update.destination}': ${jsonStringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: [
            ...(context[ruleKind][update.destination] || []),
            ...ruleStrings,
          ],
        },
      }
    }

    case 'replaceRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Replacing all ${update.behavior} rules for destination '${update.destination}' with ${update.rules.length} rule(s): ${jsonStringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: ruleStrings, // Replace all rules for this source
        },
      }
    }

    case 'addDirectories': {
      logForDebugging(
        `Applying permission update: Adding ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} with destination '${update.destination}': ${jsonStringify(update.directories)}`,
      )
      const newAdditionalDirs = new Map(context.additionalWorkingDirectories)
      for (const directory of update.directories) {
        newAdditionalDirs.set(directory, {
          path: directory,
          source: update.destination,
        })
      }
      return {
        ...context,
        additionalWorkingDirectories: newAdditionalDirs,
      }
    }

    case 'removeRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Applying permission update: Removing ${update.rules.length} ${update.behavior} rule(s) from source '${update.destination}': ${jsonStringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      // Filter out the rules to be removed
      const existingRules = context[ruleKind][update.destination] || []
      const rulesToRemove = new Set(ruleStrings)
      const filteredRules = existingRules.filter(
        rule => !rulesToRemove.has(rule),
      )

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: filteredRules,
        },
      }
    }

    case 'removeDirectories': {
      logForDebugging(
        `Applying permission update: Removing ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'}: ${jsonStringify(update.directories)}`,
      )
      const newAdditionalDirs = new Map(context.additionalWorkingDirectories)
      for (const directory of update.directories) {
        newAdditionalDirs.delete(directory)
      }
      return {
        ...context,
        additionalWorkingDirectories: newAdditionalDirs,
      }
    }

    default:
      return context
  }
}

/**
 * Applies multiple permission updates to the context and returns the updated context
 * @param context The current permission context
 * @param updates The permission updates to apply
 * @returns The updated permission context
 */
export function applyPermissionUpdates(
  context: ToolPermissionContext,
  updates: PermissionUpdate[],
): ToolPermissionContext {
  let updatedContext = context
  for (const update of updates) {
    updatedContext = applyPermissionUpdate(updatedContext, update)
  }

  return updatedContext
}

export function supportsPersistence(
  destination: PermissionUpdateDestination,
): destination is EditableSettingSource {
  return (
    destination === 'localSettings' ||
    destination === 'userSettings' ||
    destination === 'projectSettings'
  )
}

export type PersistPermissionUpdatesOptions = {
  /** Official 2.1.326 #16 (`_W`): called with user-facing warning when a settings file couldn't be written. */
  onPersistError?: (warning: string) => void
  origin?: 'user' | 'hook'
}

export type PersistPermissionUpdatesResult = {
  persisted: boolean
  warning?: string
  failedFiles: string[]
}

/**
 * Persists a permission update to the appropriate settings source.
 * Official 2.1.326 #16 (`VKe` -> `_W`): returns persistence outcome and invokes
 * `onPersistError` when the settings file cannot be written.
 */
export function persistPermissionUpdate(
  update: PermissionUpdate,
  options?: PersistPermissionUpdatesOptions,
): PersistPermissionUpdatesResult {
  return persistPermissionUpdates([update], options)
}

function persistSinglePermissionUpdate(update: PermissionUpdate): boolean {
  if (!supportsPersistence(update.destination)) return true
  // official nf: setMode bypassPermissions is session-scoped
  if (update.type === 'setMode' && update.mode === 'bypassPermissions') {
    logForDebugging(
      `setMode:'bypassPermissions' is session-scoped; not persisting as defaultMode to ${update.destination}`,
    )
    return true
  }

  logForDebugging(
    `Persisting permission update: ${update.type} to source '${update.destination}'`,
  )

  switch (update.type) {
    case 'addRules': {
      logForDebugging(
        `Persisting ${update.rules.length} ${update.behavior} rule(s) to ${update.destination}`,
      )
      return addPermissionRulesToSettings(
        {
          ruleValues: update.rules,
          ruleBehavior: update.behavior,
        },
        update.destination,
      )
    }

    case 'addDirectories': {
      logForDebugging(
        `Persisting ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} to ${update.destination}`,
      )
      const existingSettings = getSettingsForSource(update.destination)
      const existingDirs =
        existingSettings?.permissions?.additionalDirectories || []

      // Add new directories, avoiding duplicates
      const dirsToAdd = update.directories.filter(
        dir => !existingDirs.includes(dir),
      )

      if (dirsToAdd.length > 0) {
        const updatedDirs = [...existingDirs, ...dirsToAdd]
        const { error } = updateSettingsForSource(update.destination, {
          permissions: {
            additionalDirectories: updatedDirs,
          },
        })
        return error === null
      }
      return true
    }

    case 'removeRules': {
      // Handle rule removal
      logForDebugging(
        `Removing ${update.rules.length} ${update.behavior} rule(s) from ${update.destination}`,
      )
      const existingSettings = getSettingsForSource(update.destination)
      const existingPermissions = existingSettings?.permissions || {}
      const existingRules = existingPermissions[update.behavior] || []

      // Convert rules to normalized strings for comparison
      // Normalize via parse→serialize roundtrip so "Bash(*)" and "Bash" match
      const rulesToRemove = new Set(
        update.rules.map(permissionRuleValueToString),
      )
      const filteredRules = existingRules.filter(rule => {
        const normalized = permissionRuleValueToString(
          permissionRuleValueFromString(rule),
        )
        return !rulesToRemove.has(normalized)
      })

      const { error } = updateSettingsForSource(update.destination, {
        permissions: {
          [update.behavior]: filteredRules,
        },
      })
      return error === null
    }

    case 'removeDirectories': {
      logForDebugging(
        `Removing ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} from ${update.destination}`,
      )
      const existingSettings = getSettingsForSource(update.destination)
      const existingDirs =
        existingSettings?.permissions?.additionalDirectories || []

      // Remove specified directories
      const dirsToRemove = new Set(update.directories)
      const filteredDirs = existingDirs.filter(dir => !dirsToRemove.has(dir))

      const { error } = updateSettingsForSource(update.destination, {
        permissions: {
          additionalDirectories: filteredDirs,
        },
      })
      return error === null
    }

    case 'setMode': {
      logForDebugging(
        `Persisting mode '${update.mode}' to ${update.destination}`,
      )
      const res = updateSettingsForSource(update.destination, {
        permissions: {
          defaultMode: update.mode,
        },
      })
      return (res?.error ?? null) === null
    }

    case 'replaceRules': {
      logForDebugging(
        `Replacing all ${update.behavior} rules in ${update.destination} with ${update.rules.length} rule(s)`,
      )
      const ruleStrings = update.rules.map(permissionRuleValueToString)
      const res = updateSettingsForSource(update.destination, {
        permissions: {
          [update.behavior]: ruleStrings,
        },
      })
      return (res?.error ?? null) === null
    }

    default:
      return true
  }
}

/**
 * Official 2.1.326 #16 (`_W`): persists permission updates to settings files,
 * tracks any write failures, and warns naming the unwritable settings file(s).
 */
export function persistPermissionUpdates(
  updates: PermissionUpdate[],
  options?: PersistPermissionUpdatesOptions,
): PersistPermissionUpdatesResult {
  const origin = options?.origin ?? 'user'
  const failedTargets: string[] = []
  let allTargetsNamedFile = true
  let managedOnlyBlocked = false

  for (const rawUpdate of updates) {
    const { updates: downgraded, reason } =
      downgradePermissionUpdateForPersistence(rawUpdate)
    if (reason !== undefined) {
      logForDebugging(
        `Not persisting allow rule(s) to '${rawUpdate.destination}' (${reason}): ${SESSION_ONLY_ALLOW_REASON_MESSAGES[reason]}`,
      )
    }
    for (const u of downgraded) {
      const ok = persistSinglePermissionUpdate(u)
      if (ok || !supportsPersistence(u.destination)) continue
      if (u.type === 'addRules' && shouldAllowManagedPermissionRulesOnly()) {
        logForDebugging('Rule not saved: managed rules only', { level: 'warn' })
        if (origin !== 'hook' || u.behavior !== 'allow') {
          managedOnlyBlocked = true
        }
        continue
      }
      const filePath = getSettingsFilePathForSource(u.destination)
      if (filePath === undefined) {
        allTargetsNamedFile = false
        failedTargets.push(getSettingSourceDisplayNameLowercase(u.destination))
      } else {
        failedTargets.push(filePath)
      }
    }
  }

  const uniqueFailed = Array.from(new Set(failedTargets))
  const parts: string[] = []
  if (managedOnlyBlocked) {
    parts.push(
      "Your permission change wasn't saved: Your organization allows only its own managed permission rules. Ask an admin to add the rule to managed settings.",
    )
  }
  if (uniqueFailed.length > 0) {
    parts.push(
      `Couldn't save this change to ${uniqueFailed.join(' and ')}, so it may stop applying when settings change or Claude Code restarts.`,
    )
    if (allTargetsNamedFile) {
      parts.push(
        `Check that ${uniqueFailed.length > 1 ? 'each file' : 'the file'} holds valid JSON and that you can write to it and its folder, then restart Claude Code and make the change again.`,
      )
    }
  }
  const warning = parts.length > 0 ? parts.join(' ') : undefined
  if (warning !== undefined) {
    logForDebugging(`[permissions] ${warning}`, { level: 'warn' })
    options?.onPersistError?.(warning)
  }
  return {
    persisted: uniqueFailed.length === 0 && !managedOnlyBlocked,
    ...(warning !== undefined ? { warning } : {}),
    failedFiles: uniqueFailed,
  }
}

/**
 * Creates a Read rule suggestion for a directory.
 * @param dirPath The directory path to create a rule for
 * @param destination The destination for the permission rule (defaults to 'session')
 * @returns A PermissionUpdate for a Read rule, or undefined for the root directory
 */
export function createReadRuleSuggestion(
  dirPath: string,
  destination: PermissionUpdateDestination = 'session',
): PermissionUpdate | undefined {
  // Convert to POSIX format for pattern matching (handles Windows internally)
  const pathForPattern = toPosixPath(dirPath)

  // Root directory is too broad to be a reasonable permission target
  if (pathForPattern === '/') {
    return undefined
  }

  // For absolute paths, prepend an extra / to create //path/** pattern
  const ruleContent = posix.isAbsolute(pathForPattern)
    ? `/${pathForPattern}/**`
    : `${pathForPattern}/**`

  return {
    type: 'addRules',
    rules: [
      {
        toolName: 'Read',
        ruleContent,
      },
    ],
    behavior: 'allow',
    destination,
  }
}
