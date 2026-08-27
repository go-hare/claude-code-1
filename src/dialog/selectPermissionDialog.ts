/**
 * densable foo / Fwl / Lno / Bash·sed — select permission dialog kind + descriptor.
 *
 * Order mirrors densable foo:
 *   1) Fwl(tool) specialized
 *   2) Mno file → await Lno → permission_file
 *   3) Bash → sed ISl → permission_file | else Byr/ABi
 *   4) else bEt/iK
 */
import { feature } from 'bun:bundle'
import { AskUserQuestionTool } from '@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import { EnterPlanModeTool } from '@claude-code/builtin-tools/tools/EnterPlanModeTool/EnterPlanModeTool.js'
import { ExitPlanModeV2Tool } from '@claude-code/builtin-tools/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js'
import { MonitorTool } from '@claude-code/builtin-tools/tools/MonitorTool/MonitorTool.js'
import { PowerShellTool } from '@claude-code/builtin-tools/tools/PowerShellTool/PowerShellTool.js'
import { SkillTool } from '@claude-code/builtin-tools/tools/SkillTool/SkillTool.js'
import { WebFetchTool } from '@claude-code/builtin-tools/tools/WebFetchTool/WebFetchTool.js'
import {
  applySedSubstitution,
  parseSedEditCommand,
} from '@claude-code/builtin-tools/tools/BashTool/sedEditParser.js'
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import { CLAUDE_IN_CHROME_MCP_SERVER_NAME } from '../utils/claudeInChrome/common.js'
import { isENOENT } from '../utils/errors.js'
import { readFileSync } from '../utils/fileRead.js'
import { normalizeNameForMCP } from '../services/mcp/normalization.js'
import type { DialogKindSpec } from './requestDialog.js'
import {
  buildAskUserQuestionPermissionDescriptor,
  buildBashPermissionDescriptor,
  buildPermissionDescriptorBase,
  buildPowerShellPermissionDescriptor,
  buildSkillPermissionDescriptor,
  buildWebFetchPermissionDescriptor,
} from './permissionDescriptor.js'
import {
  buildFilePermissionDescriptor,
  isFilePermissionTool,
  tryGetToolPath,
} from './filePermissionPreview.js'
import {
  permissionAskUserQuestionSpec,
  permissionBashSpec,
  permissionBrowserSpec,
  permissionEnterPlanModeSpec,
  permissionExitPlanModeV2Spec,
  permissionFileSpec,
  permissionMonitorSpec,
  permissionPowerShellSpec,
  permissionPromptSpec,
  permissionSkillSpec,
  permissionWebFetchSpec,
  permissionWorkflowSpec,
  type PermissionPromptResult,
} from './specs/permissionKinds.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const WorkflowTool = feature('WORKFLOW_SCRIPTS')
  ? (
      require('../workflow/wiring.js') as typeof import('../workflow/wiring.js')
    ).createWorkflowToolCore()
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

export type SelectedPermissionDialog = {
  spec: DialogKindSpec<Record<string, unknown>, PermissionPromptResult>
  descriptor: Record<string, unknown>
}

const CHROME_MCP_PREFIX = `mcp__${normalizeNameForMCP(CLAUDE_IN_CHROME_MCP_SERVER_NAME)}__`

function isClaudeInChromeTool(tool: ToolUseConfirm['tool']): boolean {
  return tool.name.startsWith(CHROME_MCP_PREFIX)
}

/**
 * densable Fwl(tool) — specialized non-file / non-bash arms.
 */
export function selectPermissionDialogFwl(
  confirm: ToolUseConfirm,
): SelectedPermissionDialog | null {
  const tool = confirm.tool
  const buildInput = { confirm }

  if (tool === WebFetchTool) {
    return {
      spec: permissionWebFetchSpec as never,
      descriptor: buildWebFetchPermissionDescriptor(buildInput),
    }
  }
  if (isClaudeInChromeTool(tool)) {
    return {
      spec: permissionBrowserSpec as never,
      descriptor: buildPermissionDescriptorBase(buildInput),
    }
  }
  if (tool === AskUserQuestionTool) {
    return {
      spec: permissionAskUserQuestionSpec as never,
      descriptor: buildAskUserQuestionPermissionDescriptor(buildInput),
    }
  }
  if (tool === EnterPlanModeTool) {
    return {
      spec: permissionEnterPlanModeSpec as never,
      descriptor: buildPermissionDescriptorBase(buildInput),
    }
  }
  if (tool === ExitPlanModeV2Tool) {
    return {
      spec: permissionExitPlanModeV2Spec as never,
      descriptor: buildPermissionDescriptorBase(buildInput),
    }
  }
  if (tool === SkillTool) {
    return {
      spec: permissionSkillSpec as never,
      descriptor: buildSkillPermissionDescriptor(buildInput),
    }
  }
  if (tool === PowerShellTool) {
    return {
      spec: permissionPowerShellSpec as never,
      descriptor: buildPowerShellPermissionDescriptor(buildInput),
    }
  }
  if (tool === MonitorTool) {
    const input = confirm.input as { command?: unknown }
    const intervalMs =
      typeof (confirm.input as { intervalMs?: unknown }).intervalMs === 'number'
        ? (confirm.input as { intervalMs: number }).intervalMs
        : 0
    return {
      spec: permissionMonitorSpec as never,
      descriptor: {
        ...buildPermissionDescriptorBase(buildInput),
        command: typeof input.command === 'string' ? input.command : '',
        intervalMs,
      },
    }
  }
  // densable Fwl WorkflowTool arm (feature-gated like SEA Iji/bfm)
  if (WorkflowTool !== null && tool === WorkflowTool) {
    return {
      spec: permissionWorkflowSpec as never,
      descriptor: buildPermissionDescriptorBase(buildInput),
    }
  }
  return null
}

/**
 * densable foo full order (async): Fwl → file Lno → Bash/sed → bEt.
 */
export async function selectPermissionFoo(
  confirm: ToolUseConfirm,
): Promise<SelectedPermissionDialog> {
  const fwl = selectPermissionDialogFwl(confirm)
  if (fwl) return fwl
  const file = await selectFilePermissionDialog(confirm)
  if (file) return file
  const bash = await selectBashPermissionDialog(confirm)
  if (bash) return bash
  return {
    spec: permissionPromptSpec as never,
    descriptor: buildPermissionDescriptorBase({ confirm }),
  }
}

/** densable Fwl ?? bEt — sync path (no file Lno / bash sed). */
export function selectPermissionDialog(
  confirm: ToolUseConfirm,
): SelectedPermissionDialog {
  return (
    selectPermissionDialogFwl(confirm) ?? {
      spec: permissionPromptSpec as never,
      descriptor: buildPermissionDescriptorBase({ confirm }),
    }
  )
}

/**
 * densable `forRemoteExecution` — not declared on the tip `ToolUseContext`;
 * read through the same cast `permissionQueueBehind` uses.
 */
function isRemoteWorkspace(confirm: ToolUseConfirm): boolean {
  const ctx = confirm.toolUseContext as
    | { forRemoteExecution?: boolean }
    | undefined
  return ctx?.forRemoteExecution === true
}

/**
 * densable foo file arm: await Lno → S4t.
 */
export async function selectFilePermissionDialog(
  confirm: ToolUseConfirm,
): Promise<SelectedPermissionDialog | null> {
  if (!isFilePermissionTool(confirm.tool)) return null
  const filePath = tryGetToolPath(confirm.tool, confirm.input)
  if (filePath === null) return null
  const remoteWorkspace = isRemoteWorkspace(confirm)
  const descriptor = await buildFilePermissionDescriptor({
    confirm,
    filePath,
    remoteWorkspace,
  })
  return {
    spec: permissionFileSpec as never,
    descriptor,
  }
}

/**
 * densable foo Bash arm (pf):
 * - sed in-place → await ISl-equivalent → permission_file
 * - else → permission_bash / ABi
 */
export async function selectBashPermissionDialog(
  confirm: ToolUseConfirm,
): Promise<SelectedPermissionDialog | null> {
  if (confirm.tool !== BashTool) return null
  const command =
    typeof (confirm.input as { command?: unknown }).command === 'string'
      ? (confirm.input as { command: string }).command
      : ''
  const remoteWorkspace = isRemoteWorkspace(confirm)
  const sedInfo = remoteWorkspace ? null : parseSedEditCommand(command)
  if (sedInfo !== null) {
    const descriptor = await buildSedFilePermissionDescriptor(confirm, sedInfo)
    return { spec: permissionFileSpec as never, descriptor }
  }
  return {
    spec: permissionBashSpec as never,
    descriptor: buildBashPermissionDescriptor({ confirm }),
  }
}

/** densable ISl — sed → permission_file descriptor (local preview). */
async function buildSedFilePermissionDescriptor(
  confirm: ToolUseConfirm,
  sedInfo: {
    filePath: string
    pattern: string
    replacement: string
    flags: string
    extendedRegex: boolean
  },
): Promise<Record<string, unknown>> {
  const base = buildPermissionDescriptorBase({ confirm })
  const filePath = sedInfo.filePath
  let oldContent = ''
  let fileExists = false
  let networkOrLarge = false
  try {
    oldContent = readFileSync(filePath)
    fileExists = true
  } catch (e) {
    if (!isENOENT(e)) {
      networkOrLarge = true
      fileExists = true
    }
  }

  let newContent = ''
  let applyFailed = false
  if (fileExists && !networkOrLarge) {
    try {
      newContent = applySedSubstitution(oldContent, sedInfo)
    } catch {
      applyFailed = true
    }
  }

  const tooLarge =
    oldContent.length > 200_000 ||
    newContent.length > 200_000 ||
    networkOrLarge ||
    applyFailed

  const content = tooLarge
    ? {
        kind: 'no-changes' as const,
        message: networkOrLarge
          ? `Network path — diff not previewed. The sed command will run against ${filePath} on approval.`
          : applyFailed
            ? `The edit is too large to preview — the sed command will run against ${filePath} on approval.`
            : `The edit is too large to preview — the sed command will run against ${filePath} on approval.`,
      }
    : !fileExists
      ? {
          kind: 'no-changes' as const,
          message: 'File does not exist',
        }
      : newContent === oldContent
        ? {
            kind: 'no-changes' as const,
            message: 'Pattern did not match any content',
          }
        : {
            kind: 'file-edit-diff' as const,
            filePath,
            edits: [
              {
                old_string: oldContent,
                new_string: newContent,
                replace_all: false,
              },
            ],
          }

  return {
    ...base,
    title: 'Edit file',
    subtitle: filePath,
    question: {
      kind: 'file-action',
      verbPhrase: 'make this edit to',
      fileName: filePath.split(/[/\\]/).pop() ?? filePath,
    },
    content,
    contentWithheld: tooLarge || networkOrLarge,
    filePath,
    operationType: 'write' as const,
    symlinkTarget: null,
  }
}
