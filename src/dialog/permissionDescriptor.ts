/**
 * densable iK — base permission dialog descriptor.
 * Specialized builds (ABi/Sum/kum/…) spread this and add kind-specific fields.
 * File Lno/X_w lives in filePermissionPreview.ts (async).
 */
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import { getPlan, getPlanFilePath } from '../utils/plans.js'
import {
  computeIsAskCappedByOrg,
  computeShowAlwaysAllow,
  extractChromeHostTarget,
  formatBrowserVerbPhrase,
} from './permissionBrowser.js'
import {
  paramFormatHintsFromSchema,
  type ParamFormatHints,
} from './permissionMcpTable.js'
import {
  resolvePermissionRequestSource,
  type PermissionRequestSourceContext,
} from './permissionRequestSource.js'

const RENDER_FAIL = 'parameters could not be rendered — deny unless expected'

export type PermissionDescriptorBase = {
  requestId: string
  toolName: string
  input: unknown
  description: string
  permissionResult: unknown
  userFacingName: string
  hasMcpSuffix: boolean
  renderedToolUseMessage: string | unknown
  toolUseRenderFailed?: boolean
  paramFormatHints?: ParamFormatHints
  messageId: string
  isMcp: boolean
  showAlwaysAllow: boolean
  isAskCappedByOrg: boolean
  requestSource: ReturnType<typeof resolvePermissionRequestSource>
}

type BuildInput = {
  confirm: ToolUseConfirm
  theme?: string
}

/** densable iK(e) */
export function buildPermissionDescriptorBase(
  input: BuildInput,
): PermissionDescriptorBase {
  const { confirm } = input
  const tool = confirm.tool
  const isMcp = tool.isMcp === true
  let userFacingName: string
  if (isMcp && tool.mcpInfo) {
    userFacingName = formatMcpUserFacingName(tool)
  } else {
    try {
      const name = tool.userFacingName(confirm.input as never) || tool.name
      userFacingName =
        isMcp && name.endsWith(' (MCP)') ? name.slice(0, -6) : name
    } catch {
      userFacingName = tool.name
    }
  }

  let renderedToolUseMessage: string | unknown = ''
  let toolUseRenderFailed: boolean | undefined
  if (!isMcp) {
    try {
      const rendered =
        tool.renderToolUseMessage?.(confirm.input as never, {
          theme: (input.theme ?? 'dark') as never,
          verbose: true,
        }) ?? null
      renderedToolUseMessage =
        typeof rendered === 'string' ? rendered : rendered
    } catch {
      renderedToolUseMessage = RENDER_FAIL
      toolUseRenderFailed = true
    }
  }

  const messageId =
    confirm.assistantMessage?.message?.id != null
      ? String(confirm.assistantMessage.message.id)
      : ''

  const requestSource = resolvePermissionRequestSource(
    confirm.toolUseContext as PermissionRequestSourceContext,
  )

  return {
    requestId: confirm.toolUseID,
    toolName: tool.name,
    input: confirm.input,
    description: confirm.description ?? '',
    permissionResult: confirm.permissionResult,
    userFacingName,
    hasMcpSuffix: isMcp,
    renderedToolUseMessage,
    toolUseRenderFailed,
    paramFormatHints: paramFormatHintsFromSchema(tool.inputJSONSchema),
    messageId,
    isMcp,
    showAlwaysAllow: computeShowAlwaysAllow({
      permissionResult: confirm.permissionResult,
      tool,
      input: confirm.input,
      requestSource,
    }),
    isAskCappedByOrg: computeIsAskCappedByOrg(tool),
    requestSource,
  }
}

function formatMcpUserFacingName(tool: ToolUseConfirm['tool']): string {
  try {
    const name = tool.userFacingName({} as never) || tool.name
    return name.endsWith(' (MCP)') ? name.slice(0, -6) : name
  } catch {
    return tool.name
  }
}

/** densable ABi — permission_bash */
export function buildBashPermissionDescriptor(
  input: BuildInput,
): PermissionDescriptorBase & {
  command: string
  classifierState: string
} {
  const base = buildPermissionDescriptorBase(input)
  const cmd = input.confirm.input as { command?: unknown }
  const command =
    typeof cmd.command === 'string' && cmd.command.length <= 100_000
      ? cmd.command
      : ''
  return {
    ...base,
    command,
    classifierState:
      input.confirm.classifierCheckInProgress === true
        ? 'checking'
        : input.confirm.classifierAutoApproved === true
          ? 'approved'
          : 'none',
  }
}

/** densable Cum — permission_powershell */
export function buildPowerShellPermissionDescriptor(
  input: BuildInput,
): PermissionDescriptorBase & { command: string } {
  const base = buildPermissionDescriptorBase(input)
  const cmd = input.confirm.input as { command?: unknown }
  const command =
    typeof cmd.command === 'string' && cmd.command.length <= 100_000
      ? cmd.command
      : ''
  return { ...base, command }
}

/** densable Sum — permission_webfetch */
export function buildWebFetchPermissionDescriptor(
  input: BuildInput,
): PermissionDescriptorBase & {
  hostname: string
  showAlwaysAllow: boolean
  isAskCappedByOrg: boolean
  requestSource: ReturnType<typeof resolvePermissionRequestSource>
} {
  const base = buildPermissionDescriptorBase(input)
  const url = (input.confirm.input as { url?: unknown }).url
  let hostname = ''
  if (typeof url === 'string') {
    try {
      hostname = new URL(url).hostname
    } catch {
      hostname = ''
    }
  }
  const requestSource = resolvePermissionRequestSource(
    input.confirm.toolUseContext as PermissionRequestSourceContext,
  )
  return {
    ...base,
    hostname,
    showAlwaysAllow: computeShowAlwaysAllow({
      permissionResult: input.confirm.permissionResult,
      tool: input.confirm.tool,
      input: input.confirm.input,
      requestSource,
    }),
    isAskCappedByOrg: computeIsAskCappedByOrg(input.confirm.tool),
    requestSource,
  }
}

/** densable xno Fwl — permission_enter_plan_mode (iK + xSl requestSource) */
export function buildEnterPlanModePermissionDescriptor(
  input: BuildInput,
): PermissionDescriptorBase & {
  requestSource: ReturnType<typeof resolvePermissionRequestSource>
} {
  const base = buildPermissionDescriptorBase(input)
  return {
    ...base,
    requestSource: resolvePermissionRequestSource(
      input.confirm.toolUseContext as PermissionRequestSourceContext,
    ),
  }
}

/** densable kum — permission_skill */
export function buildSkillPermissionDescriptor(
  input: BuildInput,
): PermissionDescriptorBase & { skill: string; skillDescription?: string } {
  const base = buildPermissionDescriptorBase(input)
  const skillInput = input.confirm.input as { skill?: unknown }
  const meta = input.confirm.permissionResult as {
    metadata?: { command?: { name?: string; description?: string } }
  }
  const fromMeta = meta?.metadata?.command
  const skill =
    (typeof skillInput.skill === 'string' ? skillInput.skill : undefined) ??
    (typeof fromMeta?.name === 'string' ? fromMeta.name : undefined) ??
    ''
  const skillDescription =
    typeof fromMeta?.description === 'string' ? fromMeta.description : undefined
  return { ...base, skill, skillDescription }
}

/** densable vum — permission_browser (Cno) */
export function buildBrowserPermissionDescriptor(
  input: BuildInput,
): PermissionDescriptorBase & {
  verbPhrase: string
  chrome?: ReturnType<typeof extractChromeHostTarget>
  showAlwaysAllow: boolean
  isAskCappedByOrg: boolean
  requestSource: ReturnType<typeof resolvePermissionRequestSource>
} {
  const base = buildPermissionDescriptorBase(input)
  const requestSource = resolvePermissionRequestSource(
    input.confirm.toolUseContext as PermissionRequestSourceContext,
  )
  return {
    ...base,
    verbPhrase: formatBrowserVerbPhrase(
      input.confirm.tool.name,
      input.confirm.input,
    ),
    chrome: extractChromeHostTarget(
      input.confirm.permissionResult,
      input.confirm.input,
    ),
    showAlwaysAllow: computeShowAlwaysAllow({
      permissionResult: input.confirm.permissionResult,
      tool: input.confirm.tool,
      input: input.confirm.input,
      requestSource,
    }),
    isAskCappedByOrg: computeIsAskCappedByOrg(input.confirm.tool),
    requestSource,
  }
}

/** densable wum — permission_ask_user_question */
export function buildAskUserQuestionPermissionDescriptor(
  input: BuildInput,
): PermissionDescriptorBase & {
  questions: unknown[]
  metadataSource?: unknown
} {
  const base = buildPermissionDescriptorBase(input)
  const parsed = input.confirm.input as {
    questions?: unknown[]
    metadata?: { source?: unknown }
  }
  return {
    ...base,
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    metadataSource: parsed.metadata?.source,
  }
}

/**
 * densable teu payload extras — plan / planFilePath / usage.
 * SDK injects plan fields on confirm.input; DualInk getPlan /
 * getPlanFilePath is the disk fallback. Do not invent storageV5.
 */
export function buildExitPlanModePermissionDescriptor(
  input: BuildInput,
): PermissionDescriptorBase & {
  plan: string
  planFilePath: string
  usage?: unknown
} {
  const base = buildPermissionDescriptorBase(input)
  const parsed = input.confirm.input as {
    plan?: unknown
    planFilePath?: unknown
    usage?: unknown
  }
  const planFromInput =
    typeof parsed.plan === 'string' ? parsed.plan : undefined
  const pathFromInput =
    typeof parsed.planFilePath === 'string' ? parsed.planFilePath : undefined
  return {
    ...base,
    plan: planFromInput ?? getPlan() ?? '',
    planFilePath: pathFromInput ?? getPlanFilePath(),
    ...(parsed.usage !== undefined ? { usage: parsed.usage } : {}),
  }
}
