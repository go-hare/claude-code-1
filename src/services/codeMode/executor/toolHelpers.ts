/**
 * Code Mode tool-side helpers: path expansion/normalization, Edit closest-match
 * diagnostics, MCP auth/status helpers, approval feedback & media extraction,
 * and effective tool pool resolution.
 */
import type { REPLMediaBlock } from '@claude-code/builtin-tools/tools/REPLTool/REPLTool.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@claude-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  Tool,
  ToolPermissionContext,
  ToolUseContext,
} from '../../../Tool.js'
import { getAgentContext } from '../../../utils/agentContext.js'
import { getCwd } from '../../../utils/cwd.js'
import { getDenyRuleForTool } from '../../../utils/permissions/permissions.js'
import {
  applyPluginToolListDenyRules,
  applyPluginToolListFilter,
} from '../../../utils/plugins/pluginToolList.js'
import {
  restrictedAlwaysCodeRunningNames,
  restrictedDenyToolNames,
} from '../../../utils/restricted.js'
import { McpAuthError } from '../../mcp/connectionHelpers.js'
import { mcpInfoFromString } from '../../mcp/mcpStringUtils.js'

/**
 * Official 2.1.328 (#580): An `@`-mentioned small file must still be attached
 * in Code Mode even if a script previously read or wrote it.
 */
export function shouldAttachSmallMentionedFileInCodeMode(opts: {
  isCodeMode: boolean
  isSmallFile: boolean
  previouslyTouchedByScript: boolean
}): boolean {
  if (!opts.isSmallFile) return false
  if (opts.isCodeMode && opts.previouslyTouchedByScript) {
    return true
  }
  return true
}

/**
 * Official 2.1.328 (#582): Do not auto-start a Claude turn in Code Mode when
 * Esc interrupted a script and was followed by a local slash command (e.g. `/model`).
 */
export function shouldAutoStartCodeModeTurnAfterCommand(opts: {
  interruptedByEsc: boolean
  commandName?: string
  isLocalCommand?: boolean
}): boolean {
  if (
    opts.interruptedByEsc &&
    (opts.isLocalCommand || Boolean(opts.commandName))
  ) {
    return false
  }
  return !opts.interruptedByEsc
}

/**
 * Official 2.1.328 (#649): Diff pending/connected MCP servers for Code Mode
 * dynamic status notices without mutating the static cached system prompt.
 */
export function diffCodeModeMcpServerStatus(
  prevConnected: ReadonlySet<string>,
  currentClients: ReadonlyArray<{ name: string; type: string }>,
): {
  connected: Set<string>
  pending: string[]
  added: string[]
  removed: string[]
} {
  const connected = new Set<string>()
  const pending: string[] = []
  for (const c of currentClients) {
    if (c.type === 'connected') connected.add(c.name)
    else if (c.type === 'pending') pending.push(c.name)
  }
  const added = [...connected].filter(n => !prevConnected.has(n)).sort()
  const removed = [...prevConnected].filter(n => !connected.has(n)).sort()
  return { connected, pending: pending.sort(), added, removed }
}

/**
 * Official 2.1.328 (#650): Shorter token-efficient tool descriptions for Code Mode.
 */
export function buildConciseCodeModeToolDescription(
  toolName: string,
  fullDescription: string,
  maxChars = 160,
): string {
  const firstParagraph = fullDescription.split(/\r?\n\r?\n/)[0]?.trim() ?? ''
  const singleLine = firstParagraph.replace(/\s+/g, ' ')
  if (!singleLine) return toolName
  return singleLine.length > maxChars
    ? `${singleLine.slice(0, maxChars - 1)}…`
    : singleLine
}

/**
 * Official 2.1.328 `Qi` (#652): Edit diagnostics for Code Mode —
 * 1) No-op edits (`old_string === new_string`) return `{ changed: false, noOp: true }`
 *    without throwing or stopping the script.
 * 2) Multiple matches report all matching line numbers.
 * 3) Failed edits find the closest matching window in the file and show the
 *    first differing line (`yours:` vs `file:`) and whether only whitespace differs.
 */
const EDIT_CLOSEST_WIDTH = 160
const EDIT_MAX_MATCH_LINES = 20

function clipEditLine(line: string, offset = 0): string {
  const slice = line.slice(offset)
  const clipped =
    slice.length > EDIT_CLOSEST_WIDTH
      ? `${slice.slice(0, EDIT_CLOSEST_WIDTH)}…`
      : slice
  return JSON.stringify((offset > 0 ? '…' : '') + clipped)
}

function lineBigrams(line: string): Map<string, number> {
  const t = line.trim().slice(0, 400)
  const map = new Map<string, number>()
  for (let i = 0; i + 1 < t.length; i++) {
    const bg = t.slice(i, i + 2)
    map.set(bg, (map.get(bg) ?? 0) + 1)
  }
  return map
}

function bigramOverlap(a: Map<string, number>, b: Map<string, number>): number {
  let score = 0
  for (const [k, v] of a) {
    const bv = b.get(k)
    if (bv !== undefined) score += Math.min(v, bv)
  }
  return score
}

export function findClosestEditMatchHint(
  fileContent: string,
  oldString: string,
): string {
  if (!oldString) return ''
  const parts = fileContent.split(oldString)
  if (parts.length - 1 > 1) {
    const matches: number[] = []
    let line = 1
    const oldLines = oldString.split('\n').length - 1
    for (
      let i = 0;
      i < parts.length - 1 && matches.length < EDIT_MAX_MATCH_LINES;
      i++
    ) {
      line += parts[i]!.split('\n').length - 1 + (i > 0 ? oldLines : 0)
      matches.push(line)
    }
    const extra = parts.length - 1 - matches.length
    return `lines with a match: ${[...new Set(matches)].join(', ')}${extra > 0 ? `, and ${extra} more matches` : ''}`
  }
  if (parts.length - 1 === 1) return ''

  const needleLines = oldString.replace(/\n$/, '').split('\n')
  const fileLines = fileContent.replace(/\n$/, '').split('\n')
  if (fileLines.length === 0) return ''

  const needleBigrams = needleLines.slice(0, 40).map(lineBigrams)
  const fileBigrams = fileLines.map(lineBigrams)
  let bestStart = 0
  let bestScore = -1
  for (let start = 0; start < fileLines.length; start++) {
    let score = 0
    for (
      let j = 0;
      j < needleBigrams.length && start + j < fileLines.length;
      j++
    ) {
      score += bigramOverlap(needleBigrams[j]!, fileBigrams[start + j]!)
    }
    if (score > bestScore) {
      bestScore = score
      bestStart = start
    }
  }

  let diffIdx = needleLines.findIndex((nl, idx) => {
    const fl = fileLines[bestStart + idx] ?? ''
    return needleLines.length === 1
      ? !fl.includes(nl)
      : idx === 0
        ? !fl.endsWith(nl)
        : idx === needleLines.length - 1
          ? !fl.startsWith(nl)
          : fl !== nl
  })
  if (diffIdx === -1) diffIdx = needleLines.length - 1
  const yours = needleLines[diffIdx] ?? ''
  const actual = fileLines[bestStart + diffIdx]
  let common = 0
  while (common < yours.length && yours[common] === actual?.[common]) common++
  const offset = Math.max(0, common - EDIT_CLOSEST_WIDTH / 2)
  const whitespaceOnly =
    actual !== undefined &&
    yours.replace(/\s/g, '') === actual.replace(/\s/g, '')
  return [
    `the closest text differs at line ${bestStart + diffIdx + 1}${whitespaceOnly ? ', only in white space' : ''}`,
    `  yours: ${clipEditLine(yours, offset)}`,
    `  file:  ${actual === undefined ? '(end of file)' : clipEditLine(actual, offset)}`,
  ].join('\n')
}

export function isNoOpCodeModeEdit(input: Record<string, unknown>): boolean {
  return (
    typeof input.old_string === 'string' &&
    typeof input.new_string === 'string' &&
    input.old_string === input.new_string
  )
}

/**
 * Official 2.1.325 #2314: expand leading `~` / `~/` / `~\` against `homedir()`
 * and resolve relative paths against the live working directory (`getCwd()`,
 * which follows `EnterWorktree` / `ExitWorktree`), preventing `~` paths from
 * being written literally inside the project directory.
 */
export function expandCodeModePath(
  rawPath: string,
  cwd: string = getCwd(),
  home: string = homedir(),
): string {
  if (rawPath === '~') {
    return home
  }
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) {
    return join(home, rawPath.slice(2))
  }
  if (isAbsolute(rawPath)) {
    return rawPath
  }
  return resolve(cwd, rawPath)
}

const CODE_MODE_PATH_KEYS: ReadonlySet<string> = new Set([
  'file_path',
  'path',
  'notebook_path',
])

const CODE_MODE_PATH_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'NotebookEdit',
])

/**
 * Official 2.1.325 #2314: normalize path arguments (`~` expansion + live
 * worktree cwd resolution) for file-oriented tools called from Code Mode.
 */
export function normalizeCodeModeToolInput(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string = getCwd(),
  home: string = homedir(),
): Record<string, unknown> {
  if (!CODE_MODE_PATH_TOOLS.has(toolName)) {
    return input
  }
  let changed = false
  const next: Record<string, unknown> = { ...input }
  for (const key of CODE_MODE_PATH_KEYS) {
    const val = next[key]
    if (typeof val === 'string' && val.length > 0) {
      const expanded = expandCodeModePath(val, cwd, home)
      if (expanded !== val) {
        next[key] = expanded
        changed = true
      }
    }
  }
  return changed ? next : input
}

/**
 * Official 2.1.325 #2314: extract a worktree path from an `EnterWorktree`
 * tool result so Code Mode follows the newly entered worktree immediately.
 */
export function extractEnteredWorktreePath(
  toolName: string,
  data: unknown,
): string | undefined {
  if (toolName !== 'EnterWorktree' || !data || typeof data !== 'object') {
    return undefined
  }
  const rec = data as Record<string, unknown>
  if (typeof rec.worktreePath === 'string' && rec.worktreePath.length > 0) {
    return rec.worktreePath
  }
  if (typeof rec.path === 'string' && rec.path.length > 0) {
    return rec.path
  }
  return undefined
}

/**
 * Official 2.1.325 #2314: when an MCP tool call inside Code Mode fails with an
 * expired sign-in (`McpAuthError`), mark that MCP server as `needs-auth` in
 * AppState so `/mcp` reflects its expired status instead of showing `connected`.
 */
export function syncExpiredMcpAuthInCodeMode(
  toolName: string,
  error: unknown,
  setAppState: ToolUseContext['setAppState'],
): string | undefined {
  const serverName =
    error instanceof McpAuthError
      ? error.serverName
      : error instanceof Error &&
          /requires re-authorization|token expired|needs-auth/i.test(
            error.message,
          )
        ? mcpInfoFromString(toolName)?.serverName
        : undefined
  if (!serverName) return undefined
  setAppState(prev => {
    const idx = prev.mcp.clients.findIndex(c => c.name === serverName)
    if (idx === -1) return prev
    const existing = prev.mcp.clients[idx]!
    if (existing.type === 'needs-auth') return prev
    const nextClients = [...prev.mcp.clients]
    nextClients[idx] = {
      name: existing.name,
      type: 'needs-auth',
      config: existing.config,
    }
    return {
      ...prev,
      mcp: {
        ...prev.mcp,
        clients: nextClients,
      },
    }
  })
  return serverName
}

/**
 * Official 2.1.325 #2315: extract words typed by the user alongside a "Yes"
 * permission approval or plan approval (`ExitPlanMode`) so Code Mode forwards
 * them back to Claude.
 */
export function extractApprovalUserFeedback(
  permission: unknown,
  toolResultData?: unknown,
): string | undefined {
  const parts: string[] = []
  if (permission && typeof permission === 'object') {
    const p = permission as Record<string, unknown>
    for (const key of [
      'userFeedback',
      'approvalFeedback',
      'feedback',
    ] as const) {
      const v = p[key]
      if (typeof v === 'string' && v.trim().length > 0) {
        parts.push(v.trim())
      }
    }
    // Some permission dialogs carry typed allow-with-message on `message`
    if (
      p.behavior === 'allow' &&
      typeof p.message === 'string' &&
      p.message.trim().length > 0
    ) {
      parts.push(p.message.trim())
    }
  }
  if (toolResultData && typeof toolResultData === 'object') {
    const d = toolResultData as Record<string, unknown>
    for (const key of ['userFeedback', 'feedback', 'approvalNote'] as const) {
      const v = d[key]
      if (typeof v === 'string' && v.trim().length > 0) {
        parts.push(v.trim())
      }
    }
  }
  if (parts.length === 0) return undefined
  return [...new Set(parts)].join('\n')
}

export function extractMediaBlocksFromToolData(
  data: unknown,
): REPLMediaBlock[] {
  const blocks: REPLMediaBlock[] = []
  if (!data || typeof data !== 'object') return blocks
  const rec = data as Record<string, unknown>
  // FileReadTool image/pdf shape: { type: 'image'|'pdf', file: { base64, type } }
  if (
    (rec.type === 'image' || rec.type === 'pdf') &&
    rec.file &&
    typeof rec.file === 'object'
  ) {
    const f = rec.file as { base64?: unknown; type?: unknown }
    if (typeof f.base64 === 'string' && f.base64.length > 0) {
      blocks.push({
        type: rec.type === 'pdf' ? 'document' : 'image',
        source: {
          type: 'base64',
          media_type:
            typeof f.type === 'string'
              ? f.type
              : rec.type === 'pdf'
                ? 'application/pdf'
                : 'image/png',
          data: f.base64,
        },
      })
    }
  }
  return blocks
}

const CODE_MODE_VISIBLE_TOOL_NAMES = new Set([
  'REPL',
  'Eval',
  'StructuredOutput',
])

function isWithheldOutsideCodeModeLaunchList(
  permissionContext: ToolPermissionContext,
  tool: { name: string; mcpInfo?: unknown; isMcp?: boolean },
): boolean {
  const kept = permissionContext.toolsKeptByLaunchList
  if (
    kept === undefined ||
    tool.name.startsWith('mcp__') ||
    tool.isMcp === true ||
    tool.mcpInfo !== undefined ||
    tool.name === SYNTHETIC_OUTPUT_TOOL_NAME ||
    kept.includes(tool.name)
  ) {
    return false
  }
  return true
}

function synthesizeCodeModeRestrictedDenyNames(
  tools: readonly { name: string; enablesCodeExecution?: boolean }[],
  permissionContext: ToolPermissionContext,
): Set<string> {
  if (
    !(
      permissionContext.restricted === true &&
      permissionContext.toolsKeptByLaunchList === undefined
    )
  ) {
    return new Set()
  }
  const codeRunning = new Set([
    ...tools.filter(t => t.enablesCodeExecution).map(t => t.name),
    ...restrictedAlwaysCodeRunningNames(),
  ])
  return new Set(restrictedDenyToolNames(codeRunning, new Set()))
}

function parseSubagentDisallowedTools(
  disallowedTools: readonly string[] | undefined,
): {
  bareDisallowed: Set<string>
  disallowedMcpServers: Set<string>
  disallowAllMcp: boolean
} {
  const bareDisallowed = new Set<string>()
  const disallowedMcpServers = new Set<string>()
  let disallowAllMcp = false
  for (const rawSpec of disallowedTools ?? []) {
    if (typeof rawSpec !== 'string') continue
    const spec = rawSpec.trim()
    if (!spec) continue
    // Official `Clt` (`chunk@303112704.js @179720`): scoped rules like
    // `"Bash(rm:*)"` carry ruleContent and are enforced at permission time —
    // they MUST NOT ban the entire `Bash` tool from the subagent's tool pool.
    if (spec.includes('(')) continue
    bareDisallowed.add(spec)
    if (spec === 'mcp__*' || spec === 'mcp__*__*') {
      disallowAllMcp = true
    } else if (spec.startsWith('mcp__')) {
      const rest = spec.slice(5)
      if (!rest.includes('__')) {
        disallowedMcpServers.add(rest)
      } else if (rest.endsWith('__*')) {
        disallowedMcpServers.add(rest.slice(0, -3))
      }
    }
  }
  return { bareDisallowed, disallowedMcpServers, disallowAllMcp }
}

function isToolDisallowedForSubagent(
  tool: Tool,
  parsed: ReturnType<typeof parseSubagentDisallowedTools>,
): boolean {
  if (parsed.bareDisallowed.has(tool.name)) return true
  const isMcp =
    tool.isMcp === true ||
    tool.mcpInfo !== undefined ||
    tool.name.startsWith('mcp__')
  if (!isMcp) return false
  if (parsed.disallowAllMcp) return true
  if (parsed.disallowedMcpServers.size > 0) {
    const serverName =
      tool.mcpInfo?.serverName ?? mcpInfoFromString(tool.name)?.serverName
    if (
      serverName !== undefined &&
      parsed.disallowedMcpServers.has(serverName)
    ) {
      return true
    }
  }
  return false
}

function matchesSubagentAllowList(
  tool: Tool,
  allowList: ReadonlySet<string>,
): boolean {
  if (allowList.has(tool.name)) return true
  for (const entry of allowList) {
    const trimmed = entry.trim()
    const baseName = trimmed.includes('(')
      ? trimmed.slice(0, trimmed.indexOf('(')).trim()
      : trimmed
    if (baseName === '*' || baseName === tool.name) return true
    if (
      baseName === 'mcp__*' &&
      (tool.isMcp === true || tool.name.startsWith('mcp__'))
    ) {
      return true
    }
    if (baseName.startsWith('mcp__')) {
      const prefix = baseName.endsWith('__*')
        ? baseName.slice(0, -1)
        : !baseName.slice(5).includes('__')
          ? `${baseName}__`
          : undefined
      if (prefix !== undefined && tool.name.startsWith(prefix)) return true
    }
  }
  return false
}

/**
 * Resolve the effective tool pool callable from a Code Mode script, honoring:
 * - explicit deny rules & MCP server-prefix deny rules (`getDenyRuleForTool`)
 * - `--tools` launch list (`toolsKeptByLaunchList`)
 * - `--restricted` mode (`synthesizeCodeModeRestrictedDenyNames`)
 * - plugin `tool.list` removals & deny rules
 * - org-blocked MCP tools (`effectiveMaxPermission === 'blocked'`)
 * - subagent `tools` allowlist + blanket `disallowedTools` (without banning
 *   whole tools on scoped rules like `"Bash(rm:*)"`) + live MCP tools.
 */
export function resolveCodeModeEffectiveTools(
  baseReplToolName: string,
  resolveAvailableTools: () => readonly Tool[],
  context: ToolUseContext,
): Tool[] {
  const appState = context.getAppState?.()
  const rawPermCtx = appState?.toolPermissionContext
  const effectivePermCtx = rawPermCtx
    ? applyPluginToolListDenyRules(rawPermCtx)
    : undefined
  const contextTools = context.options?.tools
  const liveMcpTools = appState?.mcp?.tools ?? []
  const hasExplicitPrimitiveTools =
    Array.isArray(contextTools) &&
    contextTools.some(
      t =>
        !CODE_MODE_VISIBLE_TOOL_NAMES.has(t.name) &&
        t.name !== baseReplToolName,
    )

  const enabledBaseTools = () =>
    resolveAvailableTools().filter(
      t => typeof t.isEnabled !== 'function' || t.isEnabled(),
    )

  let rawTools: readonly Tool[]
  if (context.agentId !== undefined) {
    if (hasExplicitPrimitiveTools) {
      // Restricted/read-only subagent with an explicit tool pool: never union
      // `resolveAvailableTools()` (which always includes Write/Edit).
      rawTools = contextTools
    } else {
      const agentCtx = getAgentContext()
      const subagentName =
        agentCtx?.agentType === 'subagent' ? agentCtx.subagentName : undefined
      const activeAgents = context.options?.agentDefinitions?.activeAgents
      const agentDef =
        subagentName && Array.isArray(activeAgents)
          ? activeAgents.find(a => a.agentType === subagentName)
          : undefined
      if (agentDef) {
        const parsedDisallowed = parseSubagentDisallowedTools(
          agentDef.disallowedTools,
        )
        const allowList =
          agentDef.tools &&
          !(agentDef.tools.length === 1 && agentDef.tools[0] === '*')
            ? new Set(agentDef.tools)
            : undefined
        const candidates = [...enabledBaseTools(), ...liveMcpTools]
        rawTools = candidates.filter(t => {
          if (isToolDisallowedForSubagent(t, parsedDisallowed)) return false
          if (allowList && !matchesSubagentAllowList(t, allowList)) return false
          return true
        })
      } else if (Array.isArray(contextTools)) {
        rawTools = [...contextTools, ...liveMcpTools]
      } else {
        rawTools = []
      }
    }
  } else if (hasExplicitPrimitiveTools) {
    // Explicit restricted tool list on main thread (e.g. `--tools Read,Grep`)
    rawTools = [...contextTools, ...liveMcpTools]
  } else {
    // Main thread with Code Mode hiding primitives from `context.options.tools`
    rawTools = [...enabledBaseTools(), ...(contextTools ?? []), ...liveMcpTools]
  }

  const pluginFiltered = applyPluginToolListFilter(rawTools)
  const restrictedDenySet = effectivePermCtx
    ? synthesizeCodeModeRestrictedDenyNames(pluginFiltered, effectivePermCtx)
    : new Set<string>()

  const seen = new Set<string>()
  const deduped: Tool[] = []
  for (const tool of pluginFiltered) {
    if (seen.has(tool.name)) continue
    if (tool.name !== SYNTHETIC_OUTPUT_TOOL_NAME) {
      if (tool.mcpInfo?.effectiveMaxPermission === 'blocked') continue
      if (restrictedDenySet.has(tool.name)) continue
      if (
        effectivePermCtx &&
        ((effectivePermCtx.alwaysDenyRules &&
          getDenyRuleForTool(effectivePermCtx, tool)) ||
          isWithheldOutsideCodeModeLaunchList(effectivePermCtx, tool))
      ) {
        continue
      }
    }
    seen.add(tool.name)
    deduped.push(tool)
  }
  return deduped
}
