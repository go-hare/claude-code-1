/**
 * densable 2.1.283 `runPermissionRuleEdit` / `ae` @205317865.
 */
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { getErrnoCode } from '../../utils/errors.js'
import {
  getSettingSourceDisplayNameLowercase,
  isSettingSourceEnabled,
  type EditableSettingSource,
} from '../../utils/settings/constants.js'
import {
  getAdminManagedPolicyUnreadableError,
  getSettingsFilePathForSource,
  getSettingsForSource,
  persistSettingsForSource,
} from '../../utils/settings/settings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { validatePermissionRule } from '../../utils/settings/permissionValidation.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from '../../utils/permissions/permissionRuleParser.js'
import {
  addPermissionRulesToSettings,
  shouldAllowManagedPermissionRulesOnly,
} from '../../utils/permissions/permissionsLoader.js'
import type { PermissionBehavior } from '../../utils/permissions/PermissionRule.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { join } from 'path'

const EDITABLE_SOURCES = [
  'userSettings',
  'projectSettings',
  'localSettings',
] as const satisfies readonly EditableSettingSource[]

const MAX_RULE_CHARS = 10_000
const MAX_RULES = 100

const behaviorSchema = lazySchema(() =>
  z.enum(['allow', 'deny', 'ask'], {
    error: 'behavior must be one of: allow, deny, ask',
  }),
)

const destinationSchema = lazySchema(() => z.enum(EDITABLE_SOURCES))

const addSchema = lazySchema(() =>
  z.object({
    op: z.literal('add'),
    rules: z
      .array(
        z
          .string()
          .max(MAX_RULE_CHARS, 'each rule must be at most 10000 characters'),
      )
      .min(1, 'rules must be an array of 1 to 100 strings')
      .max(MAX_RULES, 'rules must be an array of 1 to 100 strings'),
    behavior: behaviorSchema(),
    destination: destinationSchema(),
  }),
)

const removeSchema = lazySchema(() =>
  z.object({
    op: z.literal('remove'),
    rule: z
      .string()
      .min(1, 'rule must be a non-empty string of at most 10000 characters')
      .max(
        MAX_RULE_CHARS,
        'rule must be a non-empty string of at most 10000 characters',
      ),
    behavior: behaviorSchema(),
    source: destinationSchema(),
  }),
)

const editSchema = lazySchema(() =>
  z.discriminatedUnion('op', [addSchema(), removeSchema()]),
)

export type PermissionRuleEditResult =
  | { ok: true; warnings: string[]; stored: string[] }
  | { ok: false; error: string }

function formatEditError(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'the edit is not a valid permission-rule edit'
  const path = issue.path.map(String).join('.')
  if (path === 'destination' || path === 'source') {
    return path === 'destination'
      ? `destination must be one of: ${EDITABLE_SOURCES.join(', ')}`
      : `rules from this source cannot be removed here (removable sources: ${EDITABLE_SOURCES.join(', ')})`
  }
  if (path === 'op') return 'op must be one of: add, remove'
  if (path.startsWith('rules') && issue.code === 'invalid_type') {
    return 'rules must be an array of 1 to 100 strings'
  }
  if (path === 'rule' && issue.code === 'invalid_type') {
    return 'rule must be a non-empty string of at most 10000 characters'
  }
  const first = issue.path[0] === undefined ? '' : String(issue.path[0])
  return path && !issue.message.startsWith(first)
    ? `${path}: ${issue.message}`
    : issue.message
}

function managedEditRefusal(): string | null {
  if (shouldAllowManagedPermissionRulesOnly()) {
    return 'host managed settings allow only managed permission rules; rules cannot be added or removed'
  }
  if (getAdminManagedPolicyUnreadableError() !== null) {
    return 'host managed settings could not be read, so permission rules cannot be edited'
  }
  return null
}

function sourceEnabledRefusal(source: EditableSettingSource): string | null {
  return isSettingSourceEnabled(source)
    ? null
    : `${getSettingSourceDisplayNameLowercase(source)} are not loaded here, so their rules cannot be edited`
}

function canonical(rule: string): string {
  return permissionRuleValueToString(permissionRuleValueFromString(rule))
}

function rulesFor(
  source: EditableSettingSource,
  behavior: PermissionBehavior,
): string[] {
  return getSettingsForSource(source)?.permissions?.[behavior] ?? []
}

function launchDirLocalSettingsPath(): string {
  return join(getOriginalCwd(), '.claude', 'settings.local.json')
}

function launchDirLocalSettings(): ReturnType<typeof getSettingsForSource> {
  const cwdPath = getSettingsFilePathForSource('localSettings')
  const launchPath = launchDirLocalSettingsPath()
  if (cwdPath && cwdPath === launchPath) {
    return getSettingsForSource('localSettings')
  }
  return null
}

async function unreadableSourceFile(
  source: EditableSettingSource,
): Promise<string | null> {
  if (getSettingsForSource(source) !== null) return null
  const path = getSettingsFilePathForSource(source)
  if (path === undefined) return null
  try {
    const size = (await getFsImplementation().stat(path)).size
    return size > 0
      ? `the ${getSettingSourceDisplayNameLowercase(source)} file has errors and could not be loaded; fix it by hand first`
      : null
  } catch (error) {
    // Gold `U(n)?0:1` — errno (ENOENT/EACCES) is treated as size 0.
    const size = getErrnoCode(error) ? 0 : 1
    return size > 0
      ? `the ${getSettingSourceDisplayNameLowercase(source)} file has errors and could not be loaded; fix it by hand first`
      : null
  }
}

function prepareAdd(edit: z.infer<ReturnType<typeof addSchema>>):
  | { ok: false; error: string }
  | {
      ok: true
      ruleValues: ReturnType<typeof permissionRuleValueFromString>[]
      behavior: PermissionBehavior
      destination: EditableSettingSource
      warnings: string[]
    } {
  const { rules, behavior, destination } = edit
  const ruleValues: ReturnType<typeof permissionRuleValueFromString>[] = []
  const warnings: string[] = []
  for (const raw of rules) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return { ok: false, error: 'rules must not be empty' }
    }
    const valid = validatePermissionRule(trimmed, behavior)
    if (!valid.valid) {
      return {
        ok: false,
        error: valid.suggestion
          ? `${valid.error} — ${valid.suggestion}`
          : (valid.error ?? 'invalid permission rule'),
      }
    }
    if (valid.warning !== undefined) warnings.push(valid.warning)
    const value = permissionRuleValueFromString(trimmed)
    if (
      value.ruleContent === undefined &&
      trimmed.includes('(') &&
      trimmed.includes('*') &&
      !/\s/.test(value.toolName)
    ) {
      const stored = permissionRuleValueToString(value)
      warnings.push(
        `"${trimmed}" was saved as the tool-wide rule "${stored}", which matches every use of the tool. To limit it, put a specific pattern inside the parentheses.`,
      )
    }
    ruleValues.push(value)
  }
  return { ok: true, ruleValues, behavior, destination, warnings }
}

function prepareRemove(
  edit: z.infer<ReturnType<typeof removeSchema>>,
  existing: string[],
):
  | { ok: false; error: string }
  | {
      ok: true
      rule: {
        source: EditableSettingSource
        ruleBehavior: PermissionBehavior
        ruleValue: ReturnType<typeof permissionRuleValueFromString>
      }
      storedRaw: string
    } {
  const { rule, behavior, source } = edit
  const match = existing.find(entry => entry === rule)
  if (match === undefined) {
    return {
      ok: false,
      error: `rule not found: no ${behavior} rule with this exact value in ${getSettingSourceDisplayNameLowercase(source)} (rules are matched verbatim, as the listing reports them; the file may have been changed outside this dialog)`,
    }
  }
  const key = canonical(match)
  if (existing.some(entry => entry !== match && canonical(entry) === key)) {
    return {
      ok: false,
      error:
        'this rule cannot be removed here: the same settings file holds another spelling of the same rule, and removing one would silently remove both — edit the file by hand to clean these up',
    }
  }
  return {
    ok: true,
    rule: {
      source,
      ruleBehavior: behavior,
      ruleValue: permissionRuleValueFromString(match),
    },
    storedRaw: match,
  }
}

async function persistRemove(
  source: EditableSettingSource,
  behavior: PermissionBehavior,
  storedRaw: string,
  storageV5: unknown,
): Promise<boolean> {
  const existing = rulesFor(source, behavior)
  const key = canonical(storedRaw)
  const next = existing.filter(entry => canonical(entry) !== key)
  const { error } = await persistSettingsForSource(
    source,
    { permissions: { [behavior]: next } },
    undefined,
    storageV5,
  )
  return error === null
}

export async function runPermissionRuleEdit(
  raw: unknown,
  storageV5?: unknown,
): Promise<PermissionRuleEditResult> {
  const fail = (error: string): PermissionRuleEditResult => ({
    ok: false,
    error,
  })
  const managed = managedEditRefusal()
  if (managed !== null) return fail(managed)
  const parsed = editSchema().safeParse(raw)
  if (!parsed.success) return fail(formatEditError(parsed.error))
  const edit = parsed.data
  if (edit.op === 'add') {
    const prepared = prepareAdd(edit)
    if (!prepared.ok) return fail(prepared.error)
    const { destination, behavior, ruleValues } = prepared
    const enabled = sourceEnabledRefusal(destination)
    if (enabled !== null) return fail(enabled)
    const unreadable = await unreadableSourceFile(destination)
    if (unreadable !== null) return fail(unreadable)
    const existing = new Set(rulesFor(destination, behavior).map(canonical))
    const duplicate = ruleValues.find(value =>
      existing.has(permissionRuleValueToString(value)),
    )
    if (duplicate !== undefined) {
      return fail(
        `"${permissionRuleValueToString(duplicate)}" is already in the ${behavior} rules in ${getSettingSourceDisplayNameLowercase(destination)}`,
      )
    }
    if (destination === 'localSettings') {
      const launch = launchDirLocalSettings()
      if (launch) {
        const launchSet = new Set(
          (launch.permissions?.[behavior] ?? []).map(canonical),
        )
        const fromLaunch = ruleValues.find(value =>
          launchSet.has(permissionRuleValueToString(value)),
        )
        if (fromLaunch !== undefined) {
          return fail(
            `"${permissionRuleValueToString(fromLaunch)}" is already in effect from the launch directory’s own .claude/settings.local.json`,
          )
        }
      }
    }
    addPermissionRulesToSettings(
      { ruleValues, ruleBehavior: behavior },
      destination,
    )
    resetSettingsCache()
    const after = new Set(rulesFor(destination, behavior).map(canonical))
    const missing = ruleValues.filter(
      value => !after.has(permissionRuleValueToString(value)),
    )
    if (missing.length > 0) {
      return fail(
        missing.length === ruleValues.length
          ? `the rules could not be written to ${getSettingSourceDisplayNameLowercase(destination)}: the settings write was refused or failed`
          : `${missing.length} of ${ruleValues.length} rules could not be written to ${getSettingSourceDisplayNameLowercase(destination)}: the settings write was refused or failed for those`,
      )
    }
    return {
      ok: true,
      warnings: prepared.warnings,
      stored: ruleValues.map(permissionRuleValueToString),
    }
  }

  const { behavior, source } = edit
  const enabled = sourceEnabledRefusal(source)
  if (enabled !== null) return fail(enabled)
  const unreadable = await unreadableSourceFile(source)
  if (unreadable !== null) return fail(unreadable)
  const existing = rulesFor(source, behavior)
  if (
    source === 'localSettings' &&
    !existing.includes(edit.rule) &&
    (launchDirLocalSettings()?.permissions?.[behavior] ?? []).includes(
      edit.rule,
    )
  ) {
    return fail(
      'that rule is defined in the launch directory’s own .claude/settings.local.json, which is not edited here; edit that file directly',
    )
  }
  const prepared = prepareRemove(edit, existing)
  if (!prepared.ok) return fail(prepared.error)
  if (source === 'localSettings') {
    const launchRules = launchDirLocalSettings()?.permissions?.[behavior] ?? []
    if (
      launchRules.some(
        entry =>
          entry !== prepared.storedRaw &&
          canonical(entry) === canonical(prepared.storedRaw),
      )
    ) {
      return fail(
        'this rule cannot be removed here: the launch directory’s own .claude/settings.local.json holds another spelling of the same rule, and removing one would silently remove both — edit that file by hand to clean these up',
      )
    }
  }
  const removed = await persistRemove(
    source,
    behavior,
    prepared.storedRaw,
    storageV5,
  )
  resetSettingsCache()
  const stillThere = rulesFor(source, behavior).some(
    entry => canonical(entry) === canonical(prepared.storedRaw),
  )
  if (!removed || stillThere) {
    return fail(
      `the rule could not be removed from ${getSettingSourceDisplayNameLowercase(source)}: the settings write was refused or failed, so it is still in its settings file`,
    )
  }
  return { ok: true, warnings: [], stored: [] }
}
