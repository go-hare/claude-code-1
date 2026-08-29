/**
 * claude-agent-acp permission-extension.md + permissions/options 1:1
 * for the overlapping wire surface. Official option ids, honest durable
 * labels, ExitPlanMode keep-context. Clear-context handoff and AskUserQuestion
 * elicitation are not advertised (no query() host; SDK 0.19 has no elicitation).
 */
import os from 'node:os'
import path from 'node:path'
import type { PermissionOption } from '@agentclientprotocol/sdk'
import type { PermissionUpdate } from '../../types/permissions.js'
import {
  normalizeDurablePermissionChangeSet,
  type DurablePermissionChangeSet,
} from './permissionNormalization.js'

export const ACP_ALLOW_ONCE = 'allow-once' as const
export const ACP_ALLOW_WITH_UPDATES = 'allow-with-updates' as const
export const ACP_ALLOW_SKILL_EXACT = 'allow-skill-exact' as const
export const ACP_ALLOW_SKILL_PREFIX = 'allow-skill-prefix' as const
export const ACP_REJECT = 'reject' as const

export const ACP_EXIT_PLAN_AUTO = 'exit-plan-auto' as const
export const ACP_EXIT_PLAN_BYPASS = 'exit-plan-bypass' as const
export const ACP_EXIT_PLAN_ACCEPT_EDITS = 'exit-plan-accept-edits' as const
export const ACP_EXIT_PLAN_DEFAULT = 'exit-plan-default' as const

const EXIT_PLAN_MODE_BY_ID: Record<string, string> = {
  [ACP_EXIT_PLAN_AUTO]: 'auto',
  [ACP_EXIT_PLAN_BYPASS]: 'bypassPermissions',
  [ACP_EXIT_PLAN_ACCEPT_EDITS]: 'acceptEdits',
  [ACP_EXIT_PLAN_DEFAULT]: 'default',
}

export type PermissionOptionContext = {
  toolName: string
  displayName?: string
  input: Record<string, unknown>
  cwd: string
  durableChangeSet?: DurablePermissionChangeSet
  allowPersistentOptions?: boolean
}

export function sessionToolRule(
  toolName: string,
  behavior: 'allow' | 'deny',
): PermissionUpdate {
  return {
    type: 'addRules',
    rules: [{ toolName }],
    behavior,
    destination: 'session',
  }
}

export function localAllowRule(
  toolName: string,
  ruleContent?: string,
): PermissionUpdate {
  return {
    type: 'addRules',
    rules: [
      {
        toolName,
        ...(ruleContent === undefined ? {} : { ruleContent }),
      },
    ],
    behavior: 'allow',
    destination: 'localSettings',
  }
}

export function durableUpdatesForAllow(
  toolName: string,
  suggestions: PermissionUpdate[] | undefined,
  input: Record<string, unknown> = {},
): PermissionUpdate[] {
  if (suggestions && suggestions.length > 0) return suggestions
  if (toolName === 'WebFetch') {
    const hostname = webFetchHostname(input)
    if (hostname) return [localAllowRule('WebFetch', `domain:${hostname}`)]
  }
  return [localAllowRule(toolName)]
}

export function skillExactUpdates(
  input: Record<string, unknown>,
): PermissionUpdate[] {
  return [localAllowRule('Skill', skillName(input))]
}

export function skillPrefixUpdates(
  input: Record<string, unknown>,
): PermissionUpdate[] | undefined {
  const skill = skillName(input)
  const spaceIndex = skill.indexOf(' ')
  if (spaceIndex <= 0) return undefined
  return [localAllowRule('Skill', `${skill.slice(0, spaceIndex)}:*`)]
}

function allowOnce(name = 'Yes'): PermissionOption {
  return { optionId: ACP_ALLOW_ONCE, name, kind: 'allow_once' }
}

function allowWithUpdates(name: string): PermissionOption {
  return {
    optionId: ACP_ALLOW_WITH_UPDATES,
    name,
    kind: 'allow_always',
  }
}

function rejectOnce(name = 'No'): PermissionOption {
  return { optionId: ACP_REJECT, name, kind: 'reject_once' }
}

function withOptionalUpdate(
  changeSet: DurablePermissionChangeSet | undefined,
  updateName: string | undefined,
  allowName = 'Yes',
  rejectName = 'No',
): PermissionOption[] {
  const options = [allowOnce(allowName)]
  if (changeSet && updateName) options.push(allowWithUpdates(updateName))
  options.push(rejectOnce(rejectName))
  return options
}

function withGeneratedUpdate(
  name: string,
  rejectName = 'No',
): PermissionOption[] {
  return [allowOnce(), allowWithUpdates(name), rejectOnce(rejectName)]
}

function sortPermissionOptions(
  options: PermissionOption[],
): PermissionOption[] {
  return [...options].sort(
    (left, right) => permissionOptionOrder(left) - permissionOptionOrder(right),
  )
}

function permissionOptionOrder(option: PermissionOption): number {
  switch (option.kind) {
    case 'allow_once':
      return 0
    case 'allow_always':
      return 1
    case 'reject_once':
    case 'reject_always':
      return 3
    default:
      return 2
  }
}

function plainString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function skillName(input: Record<string, unknown>): string {
  return plainString(input.skill) ?? ''
}

function webFetchHostname(input: Record<string, unknown>): string | undefined {
  const url = plainString(input.url)
  if (!url) return undefined
  try {
    const hostname = new URL(url).hostname
    return hostname || undefined
  } catch {
    return undefined
  }
}

function exactLocalAllowRule(
  changeSet: DurablePermissionChangeSet | undefined,
  toolName: string,
  ruleContent?: string,
): boolean {
  if (!changeSet || changeSet.updates.length !== 1) return false
  const update = changeSet.updates[0]
  if (
    update?.type !== 'addRules' ||
    update.behavior !== 'allow' ||
    update.destination !== 'localSettings' ||
    update.rules.length !== 1
  ) {
    return false
  }
  const rule = update.rules[0]
  return (
    rule?.toolName === toolName &&
    (ruleContent === undefined
      ? rule.ruleContent === undefined
      : plainString(rule.ruleContent) === ruleContent)
  )
}

function isMcpAllowChangeSet(
  changeSet: DurablePermissionChangeSet | undefined,
  toolName: string,
): boolean {
  return (
    !!changeSet &&
    changeSet.updates.length > 0 &&
    changeSet.updates.every(
      update =>
        update.type === 'addRules' &&
        update.behavior === 'allow' &&
        update.rules.length > 0 &&
        update.rules.every(
          rule => rule.toolName === toolName && rule.ruleContent === undefined,
        ),
    )
  )
}

function permissionRulePrefix(value: string): string {
  return value.endsWith(':*') ? value.slice(0, -2) : value
}

function displayList(values: string[]): string {
  if (values.join(', ').length > 50) return 'similar'
  if (values.length === 1) return values[0]!
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`
}

function displayPaths(paths: string[]): string {
  const normalizedPaths = [
    ...new Set(paths.map(value => path.normalize(value))),
  ]
  const segments = normalizedPaths.map(value =>
    value.split(path.sep).filter(Boolean),
  )
  const suffix = (index: number, depth: number): string =>
    segments[index]!.slice(-depth).join(path.sep) || normalizedPaths[index]!
  const names = normalizedPaths.map((value, index) => {
    const parts = segments[index]!
    let name = path.basename(value) || value
    for (let depth = 1; depth <= parts.length; depth++) {
      const candidate = suffix(index, depth)
      if (
        normalizedPaths.every(
          (_, other) => other === index || suffix(other, depth) !== candidate,
        )
      ) {
        name = candidate
        break
      }
      if (depth === parts.length) name = value
    }
    return name.endsWith(path.sep) ? name : `${name}${path.sep}`
  })
  if (names.length <= 2) return displayList(names)
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

function shellSuggestionsLabel(
  toolName: 'Bash' | 'PowerShell',
  changeSet: DurablePermissionChangeSet,
): string | undefined {
  const representable = changeSet.updates.every(update => {
    if (update.type === 'addDirectories')
      return update.destination === 'session'
    if (update.type !== 'addRules' || update.behavior !== 'allow') return false
    return update.rules.every(
      rule =>
        (rule.toolName === toolName || rule.toolName === 'Read') &&
        plainString(rule.ruleContent) !== undefined,
    )
  })
  if (!representable) return undefined

  const rules = changeSet.updates
    .filter(update => update.type === 'addRules')
    .flatMap(update => update.rules)
  const readPaths = rules
    .filter(rule => rule.toolName === 'Read')
    .map(rule => rule.ruleContent?.replace(/\/\*\*$/, ''))
    .filter((value): value is string => !!value)
  const commands = [
    ...new Set(
      rules
        .filter(rule => rule.toolName === toolName && rule.ruleContent)
        .map(rule => permissionRulePrefix(rule.ruleContent!)),
    ),
  ]
  const directories = changeSet.updates
    .filter(update => update.type === 'addDirectories')
    .flatMap(update => update.directories)
  const hasPaths = readPaths.length > 0 || directories.length > 0

  if (
    readPaths.length > 0 &&
    directories.length === 0 &&
    commands.length === 0
  ) {
    return `Yes, allow reading from ${displayPaths(readPaths)} from this project`
  }
  if (
    directories.length > 0 &&
    readPaths.length === 0 &&
    commands.length === 0
  ) {
    return `Yes, and always allow access to ${displayPaths(directories)} from this project`
  }
  if (commands.length > 0 && !hasPaths) {
    return `Yes, and don't ask again for ${displayList(commands)} commands`
  }
  if (hasPaths && commands.length === 0) {
    return `Yes, and always allow access to ${displayPaths([...directories, ...readPaths])} from this project`
  }
  if (hasPaths && commands.length > 0) {
    const paths = [...directories, ...readPaths]
    return paths.length === 1 && commands.length === 1
      ? `Yes, and allow access to ${displayPaths(paths)} and ${displayList(commands)} commands`
      : `Yes, and allow ${displayPaths(paths)} access and ${displayList(commands)} commands`
  }
  return undefined
}

function isFileSessionChangeSet(
  changeSet: DurablePermissionChangeSet | undefined,
  operation: 'read' | 'write',
): boolean {
  return (
    !!changeSet &&
    changeSet.updates.every(update => {
      if (update.destination !== 'session') return false
      if (update.type === 'setMode') {
        return operation === 'write' && update.mode === 'acceptEdits'
      }
      if (update.type === 'addDirectories') return operation === 'write'
      if (update.type !== 'addRules' || update.behavior !== 'allow')
        return false
      return update.rules.every(rule =>
        operation === 'read'
          ? rule.toolName === 'Read'
          : rule.toolName === 'Edit',
      )
    })
  )
}

function isInside(directory: string, candidate: string): boolean {
  const from = path.resolve(directory)
  const to = path.resolve(candidate)
  const relative = path.relative(from, to)
  // Win32 path.relative() across drives returns an absolute path.
  if (path.isAbsolute(relative)) return false
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..')
  )
}

function hasSessionAllowRuleFor(
  changeSet: DurablePermissionChangeSet | undefined,
  toolName: string,
): boolean {
  return !!changeSet?.updates.some(
    update =>
      update.type === 'addRules' &&
      update.destination === 'session' &&
      update.behavior === 'allow' &&
      update.rules.some(rule => rule.toolName === toolName),
  )
}

function hasBroadSessionAllowRuleFor(
  changeSet: DurablePermissionChangeSet,
  toolName: string,
): boolean {
  return changeSet.updates.some(
    update =>
      update.type === 'addRules' &&
      update.destination === 'session' &&
      update.behavior === 'allow' &&
      update.rules.some(
        rule => rule.toolName === toolName && rule.ruleContent === undefined,
      ),
  )
}

function hasAcceptEditsMode(changeSet: DurablePermissionChangeSet): boolean {
  return changeSet.updates.some(
    update =>
      update.type === 'setMode' &&
      update.destination === 'session' &&
      update.mode === 'acceptEdits',
  )
}

function permissionPath(ruleContent: string | undefined): string | undefined {
  const value = plainString(ruleContent)
  if (!value) return undefined
  return value.replace(/[/\\]\*\*$/, '')
}

function effectCoversFilePath(
  changeSet: DurablePermissionChangeSet,
  filePath: string,
  operation: 'read' | 'write',
  cwd: string,
): boolean {
  const directory = path.dirname(filePath)
  const comparable = (candidate: string): boolean => {
    const resolved = path.resolve(cwd, candidate)
    return resolved === directory || isInside(resolved, filePath)
  }
  const paths = changeSet.updates.flatMap(update => {
    if (update.type === 'addDirectories') return update.directories
    if (update.type !== 'addRules' || update.behavior !== 'allow') return []
    return update.rules
      .filter(rule =>
        operation === 'read'
          ? rule.toolName === 'Read'
          : rule.toolName === 'Edit',
      )
      .map(rule => permissionPath(rule.ruleContent))
      .filter((value): value is string => value !== undefined)
  })
  return paths.some(comparable)
}

function fileSessionLabel(
  context: PermissionOptionContext,
  filePath: string | undefined,
  operation: 'read' | 'write',
): string | undefined {
  if (!isFileSessionChangeSet(context.durableChangeSet, operation)) {
    return undefined
  }
  const resolvedFilePath = filePath
    ? path.resolve(context.cwd, filePath)
    : undefined
  const isClaudePath =
    operation === 'write' &&
    !!resolvedFilePath &&
    (isInside(path.join(context.cwd, '.claude'), resolvedFilePath) ||
      isInside(path.join(os.homedir(), '.claude'), resolvedFilePath))
  const broadRule = hasBroadSessionAllowRuleFor(
    context.durableChangeSet!,
    operation === 'read' ? 'Read' : 'Edit',
  )
  if (resolvedFilePath) {
    const coversCurrentPath =
      effectCoversFilePath(
        context.durableChangeSet!,
        resolvedFilePath,
        operation,
        context.cwd,
      ) ||
      broadRule ||
      (operation === 'write' &&
        !isClaudePath &&
        hasAcceptEditsMode(context.durableChangeSet!))
    if (!coversCurrentPath) return undefined
  } else if (
    !broadRule &&
    !(operation === 'write' && hasAcceptEditsMode(context.durableChangeSet!))
  ) {
    return undefined
  }
  if (
    operation === 'write' &&
    resolvedFilePath &&
    isClaudePath &&
    hasSessionAllowRuleFor(context.durableChangeSet, 'Edit')
  ) {
    return 'Yes, and allow Claude to edit its own settings for this session'
  }
  if (!resolvedFilePath || isInside(context.cwd, resolvedFilePath)) {
    return operation === 'read'
      ? 'Yes, during this session'
      : 'Yes, allow all edits during this session'
  }
  const directory = path.dirname(resolvedFilePath)
  const directoryName = path.basename(directory) || 'this directory'
  return operation === 'read'
    ? `Yes, allow reading from ${directoryName}${path.sep} during this session`
    : `Yes, allow all edits in ${directoryName}${path.sep} during this session`
}

function buildFilePermissionOptions(
  context: PermissionOptionContext,
  filePath: string | undefined,
  operation: 'read' | 'write',
): PermissionOption[] {
  return withOptionalUpdate(
    context.durableChangeSet,
    fileSessionLabel(context, filePath, operation),
  )
}

function buildWebFetchPermissionOptions(
  context: PermissionOptionContext,
): PermissionOption[] {
  const url = plainString(context.input.url)
  if (url && context.allowPersistentOptions !== false) {
    try {
      const hostname = new URL(url).hostname
      if (hostname) {
        return withGeneratedUpdate(`Yes, and don't ask again for ${hostname}`)
      }
    } catch {
      // Invalid input cannot produce the domain-specific option.
    }
  }
  return [allowOnce(), rejectOnce()]
}

function buildSkillPermissionOptions(
  context: PermissionOptionContext,
): PermissionOption[] {
  const skill = plainString(context.input.skill)
  const options: PermissionOption[] = [allowOnce()]
  if (skill && context.allowPersistentOptions !== false) {
    options.push({
      optionId: ACP_ALLOW_SKILL_EXACT,
      name: `Yes, and don't ask again for ${skill}`,
      kind: 'allow_always',
    })
    const spaceIndex = skill.indexOf(' ')
    if (spaceIndex > 0) {
      const prefix = `${skill.slice(0, spaceIndex)}:*`
      options.push({
        optionId: ACP_ALLOW_SKILL_PREFIX,
        name: `Yes, and don't ask again for ${prefix} commands`,
        kind: 'allow_always',
      })
    }
  }
  options.push(rejectOnce())
  return options
}

function buildFallbackPermissionOptions(
  context: PermissionOptionContext,
): PermissionOption[] {
  const toolLabel = plainString(context.displayName) ?? context.toolName
  if (context.toolName.startsWith('mcp__')) {
    const changeSet =
      context.allowPersistentOptions !== false &&
      isMcpAllowChangeSet(context.durableChangeSet, context.toolName)
        ? context.durableChangeSet
        : undefined
    return withOptionalUpdate(
      changeSet,
      changeSet
        ? `Yes, and don't ask again for ${toolLabel} commands`
        : undefined,
    )
  }
  if (context.allowPersistentOptions !== false) {
    return withGeneratedUpdate(
      `Yes, and don't ask again for ${toolLabel} commands`,
    )
  }
  return [allowOnce(), rejectOnce()]
}

function buildSandboxNetworkPermissionOptions(
  context: PermissionOptionContext,
): PermissionOption[] {
  const host = plainString(context.input.host)
  const name =
    host &&
    exactLocalAllowRule(context.durableChangeSet, context.toolName, host)
      ? `Yes, and don't ask again for ${host}`
      : undefined
  return withOptionalUpdate(context.durableChangeSet, name)
}

function isComputerUseMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp__computer-use__')
}

function buildComputerUseMcpPermissionOptions(
  context: PermissionOptionContext,
): PermissionOption[] {
  const toolLabel = plainString(context.displayName) ?? context.toolName
  const changeSet =
    context.allowPersistentOptions !== false &&
    isMcpAllowChangeSet(context.durableChangeSet, context.toolName)
      ? context.durableChangeSet
      : undefined
  return withOptionalUpdate(
    changeSet,
    changeSet ? `Yes, and don't ask again for ${toolLabel}` : undefined,
  )
}

export function buildStandardPermissionOptions(args: {
  toolName: string
  input: Record<string, unknown>
  allowPersistent: boolean
  suggestions?: PermissionUpdate[]
  displayName?: string
  cwd?: string
  durableChangeSet?: DurablePermissionChangeSet
}): PermissionOption[] {
  const context: PermissionOptionContext = {
    toolName: args.toolName,
    displayName: args.displayName,
    input: args.input,
    cwd: args.cwd ?? '',
    durableChangeSet:
      args.durableChangeSet ??
      normalizeDurablePermissionChangeSet(
        args.suggestions,
        !args.allowPersistent,
      ),
    allowPersistentOptions: args.allowPersistent,
  }
  return sortPermissionOptions(buildUnsortedPermissionOptions(context))
}

function buildUnsortedPermissionOptions(
  context: PermissionOptionContext,
): PermissionOption[] {
  if (isComputerUseMcpTool(context.toolName)) {
    return buildComputerUseMcpPermissionOptions(context)
  }
  switch (context.toolName) {
    case 'AskUserQuestion':
      throw new Error(
        'AskUserQuestion must be handled by ACP elicitation, not permission options',
      )
    case 'Bash':
    case 'PowerShell': {
      const name = context.durableChangeSet
        ? shellSuggestionsLabel(context.toolName, context.durableChangeSet)
        : undefined
      return withOptionalUpdate(context.durableChangeSet, name)
    }
    case 'Read':
      return buildFilePermissionOptions(
        context,
        plainString(context.input.file_path),
        'read',
      )
    case 'Glob':
      return buildFilePermissionOptions(
        context,
        plainString(context.input.path) ?? context.cwd,
        'read',
      )
    case 'Grep':
      return buildFilePermissionOptions(
        context,
        plainString(context.input.path) ?? context.cwd,
        'read',
      )
    case 'Edit':
    case 'Write':
      return buildFilePermissionOptions(
        context,
        plainString(context.input.file_path),
        'write',
      )
    case 'NotebookEdit':
      return buildFilePermissionOptions(
        context,
        plainString(context.input.notebook_path),
        'write',
      )
    case 'WebFetch':
      return buildWebFetchPermissionOptions(context)
    case 'Skill':
      return buildSkillPermissionOptions(context)
    case 'EnterPlanMode':
      return [
        allowOnce('Yes, enter plan mode'),
        rejectOnce('No, start implementing now'),
      ]
    case 'SandboxNetworkAccess':
      return buildSandboxNetworkPermissionOptions(context)
    default:
      return buildFallbackPermissionOptions(context)
  }
}

/**
 * Official ExitPlanMode keep-context: one elevated mode
 * (auto > bypassPermissions > acceptEdits), plus manual + reject.
 * Clear-context options are not advertised — they require a query() handoff.
 */
export function buildExitPlanPermissionOptions(
  availableModeIds: readonly string[],
): PermissionOption[] {
  const available = new Set(availableModeIds)
  // Last-resort acceptEdits is only for an empty advertisement (gold) or
  // when acceptEdits is actually listed. A non-empty set that omitted it
  // used to still offer exit-plan-accept-edits and let the client escalate.
  const elevated: PermissionOption | undefined = available.has('auto')
    ? {
        kind: 'allow_always',
        name: 'Yes, and use auto mode',
        optionId: ACP_EXIT_PLAN_AUTO,
      }
    : available.has('bypassPermissions')
      ? {
          kind: 'allow_always',
          name: 'Yes, and bypass permissions',
          optionId: ACP_EXIT_PLAN_BYPASS,
        }
      : available.has('acceptEdits') || available.size === 0
        ? {
            kind: 'allow_always',
            name: 'Yes, auto-accept edits',
            optionId: ACP_EXIT_PLAN_ACCEPT_EDITS,
          }
        : undefined

  return sortPermissionOptions([
    ...(elevated ? [elevated] : []),
    {
      kind: 'allow_once',
      name: 'Yes, manually approve edits',
      optionId: ACP_EXIT_PLAN_DEFAULT,
    },
    rejectOnce('No, keep planning'),
  ])
}

export function resolveExitPlanModeId(optionId: string): string | undefined {
  return EXIT_PLAN_MODE_BY_ID[optionId]
}

export type DecodedPermissionSelection =
  | { kind: 'allow-once' }
  | { kind: 'allow-durable' }
  | { kind: 'allow-skill-exact' }
  | { kind: 'allow-skill-prefix' }
  | { kind: 'reject-once' }
  | { kind: 'reject-durable' }

export function isOfferedOption(
  optionId: string,
  options: readonly PermissionOption[],
): boolean {
  return options.some(option => option.optionId === optionId)
}

export function decodeStandardPermissionOption(
  optionId: string,
): DecodedPermissionSelection | undefined {
  if (optionId === ACP_ALLOW_ONCE) return { kind: 'allow-once' }
  if (optionId === ACP_ALLOW_WITH_UPDATES) return { kind: 'allow-durable' }
  if (optionId === ACP_ALLOW_SKILL_EXACT) return { kind: 'allow-skill-exact' }
  if (optionId === ACP_ALLOW_SKILL_PREFIX) return { kind: 'allow-skill-prefix' }
  if (optionId === ACP_REJECT) return { kind: 'reject-once' }
  return undefined
}
