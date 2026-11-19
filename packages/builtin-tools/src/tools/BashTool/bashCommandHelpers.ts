import type { z } from 'zod/v4'
import {
  isUnsafeCompoundCommand_DEPRECATED,
  splitCommand_DEPRECATED,
} from 'src/utils/bash/commands.js'
import {
  buildParsedCommandFromRoot,
  type IParsedCommand,
  ParsedCommand,
} from 'src/utils/bash/ParsedCommand.js'
import { type Node, PARSE_ABORTED } from 'src/utils/bash/parser.js'
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js'
import type { PermissionUpdate } from 'src/utils/permissions/PermissionUpdateSchema.js'
import { createPermissionRequestMessage } from 'src/utils/permissions/permissions.js'
import { BashTool } from './BashTool.js'
import { bashCommandIsSafeAsync_DEPRECATED } from './bashSecurity.js'
import { commandWritesToGitInternalPaths } from './readOnlyValidation.js'

type CommandIdentityCheckers = {
  isNormalizedCdCommand: (command: string) => boolean
  isNormalizedGitCommand: (command: string) => boolean
}

async function segmentedCommandPermissionResult(
  input: z.infer<typeof BashTool.inputSchema>,
  segments: string[],
  rawPipeSegments: string[],
  bashToolHasPermissionFn: (
    input: z.infer<typeof BashTool.inputSchema>,
  ) => Promise<PermissionResult>,
  checkers: CommandIdentityCheckers,
): Promise<PermissionResult> {
  const segmentResults = new Map<string, PermissionResult>()

  // Official 2.1.325 #2325/#2326 (`U_r` @290072000): evaluate every segment
  // first (including bare output-redirection segments whose stripped form is
  // empty, using `rawPipeSegments[i]`) so deny rules ALWAYS take precedence
  // over ask checks like `multi-cd` or `cd+git`.
  for (let i = 0; i < segments.length; i++) {
    const trimmedSegment = segments[i]!.trim()
    if (!trimmedSegment) {
      const rawSeg = (rawPipeSegments[i] ?? '').trim()
      if (!rawSeg) continue
      const rawResult = await bashToolHasPermissionFn({
        ...input,
        command: rawSeg,
      })
      segmentResults.set(
        rawSeg,
        rawResult.behavior === 'passthrough'
          ? {
              behavior: 'ask',
              message: createPermissionRequestMessage(BashTool.name, {
                type: 'other',
                reason:
                  'Bare output redirection in a compound command requires approval',
              }),
              decisionReason: {
                type: 'other',
                reason:
                  'Bare output redirection in a compound command requires approval',
              },
            }
          : rawResult,
      )
      continue
    }

    const segmentResult = await bashToolHasPermissionFn({
      ...input,
      command: trimmedSegment,
    })
    segmentResults.set(trimmedSegment, segmentResult)
  }

  // Check if any segment is denied (takes precedence over ask checks)
  const deniedSegment = Array.from(segmentResults.entries()).find(
    ([, result]) => result.behavior === 'deny',
  )

  if (deniedSegment) {
    const [segmentCommand, segmentResult] = deniedSegment
    return {
      behavior: 'deny',
      message:
        segmentResult.behavior === 'deny'
          ? segmentResult.message
          : `Permission denied for: ${segmentCommand}`,
      decisionReason: {
        type: 'subcommandResults',
        reasons: segmentResults,
      },
    }
  }

  // Check for multiple cd commands across all segments and subcommands (#2326)
  let cdCount = 0
  let hasGit = false
  for (const segment of segments) {
    const subcommands = splitCommand_DEPRECATED(segment)
    for (const sub of subcommands) {
      const trimmed = sub.trim()
      if (checkers.isNormalizedCdCommand(trimmed)) {
        cdCount++
      }
      if (checkers.isNormalizedGitCommand(trimmed)) {
        hasGit = true
      }
    }
  }
  if (cdCount > 1) {
    const decisionReason = {
      type: 'other' as const,
      reason:
        'Multiple directory changes in one command require approval for clarity',
      bashMissKind: 'multi-cd',
    }
    return {
      behavior: 'ask',
      decisionReason,
      message: createPermissionRequestMessage(BashTool.name, decisionReason),
    }
  }

  // Official: structure-create + git is checked before the plain cd+git path.
  if (hasGit && commandWritesToGitInternalPaths(input.command)) {
    const decisionReason = {
      type: 'other' as const,
      reason:
        'This command creates git repository structure files (HEAD/objects/refs/hooks) and then runs git, which can execute hooks/fsmonitor from the created files.',
      bashMissKind: 'cd-git-compound',
    }
    return {
      behavior: 'ask',
      decisionReason,
      message: createPermissionRequestMessage(BashTool.name, decisionReason),
    }
  }
  if (cdCount > 0 && hasGit) {
    const decisionReason = {
      type: 'other' as const,
      // Official 2.1.x wording for the cd+git hook/fsmonitor surface.
      reason:
        'This command changes directory before running git, which can execute untrusted hooks from the target directory. Approve only if you trust it.',
      bashMissKind: 'cd-git-compound',
    }
    return {
      behavior: 'ask',
      decisionReason,
      message: createPermissionRequestMessage(BashTool.name, decisionReason),
    }
  }

  // Official 2.1.325 #2326: require at least one evaluated segment and refuse
  // to auto-allow if any pipe stage is a bare variable assignment (`FOO=bar | cmd`).
  const hasAssignmentOnlyStage = segments.some(seg =>
    /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=[^\s]*$/.test(seg.trim()),
  )
  if (hasAssignmentOnlyStage) {
    const decisionReason = {
      type: 'other' as const,
      reason:
        "The parts of this pipe can't be checked one by one, so the command needs approval",
      bashMissKind: 'assigned-variable',
    }
    return {
      behavior: 'ask',
      decisionReason,
      message: createPermissionRequestMessage(BashTool.name, decisionReason),
      suggestions: [],
    }
  }

  const allAllowed =
    segmentResults.size > 0 &&
    Array.from(segmentResults.values()).every(
      result => result.behavior === 'allow',
    )

  if (allAllowed) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'subcommandResults',
        reasons: segmentResults,
      },
    }
  }

  // Collect suggestions from segments that need approval
  const suggestions: PermissionUpdate[] = []
  for (const [, result] of segmentResults) {
    if (
      result.behavior !== 'allow' &&
      'suggestions' in result &&
      result.suggestions
    ) {
      suggestions.push(...result.suggestions)
    }
  }

  const decisionReason = {
    type: 'subcommandResults' as const,
    reasons: segmentResults,
  }

  return {
    behavior: 'ask',
    message: createPermissionRequestMessage(BashTool.name, decisionReason),
    decisionReason,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  }
}

/**
 * Builds a command segment, stripping output redirections to avoid
 * treating filenames as commands in permission checking.
 * Uses ParsedCommand to preserve original quoting.
 */
async function buildSegmentWithoutRedirections(
  segmentCommand: string,
): Promise<string> {
  // Fast path: skip parsing if no redirection operators present
  if (!segmentCommand.includes('>')) {
    return segmentCommand
  }

  // Use ParsedCommand to strip redirections while preserving quotes
  const parsed = await ParsedCommand.parse(segmentCommand)
  return parsed?.withoutOutputRedirections() ?? segmentCommand
}

/**
 * Wrapper that resolves an IParsedCommand (from a pre-parsed AST root if
 * available, else via ParsedCommand.parse) and delegates to
 * bashToolCheckCommandOperatorPermissions.
 */
export async function checkCommandOperatorPermissions(
  input: z.infer<typeof BashTool.inputSchema>,
  bashToolHasPermissionFn: (
    input: z.infer<typeof BashTool.inputSchema>,
  ) => Promise<PermissionResult>,
  checkers: CommandIdentityCheckers,
  astRoot: Node | null | typeof PARSE_ABORTED,
): Promise<PermissionResult> {
  const parsed =
    astRoot && astRoot !== PARSE_ABORTED
      ? buildParsedCommandFromRoot(input.command, astRoot)
      : await ParsedCommand.parse(input.command)
  if (!parsed) {
    return { behavior: 'passthrough', message: 'Failed to parse command' }
  }
  return bashToolCheckCommandOperatorPermissions(
    input,
    bashToolHasPermissionFn,
    checkers,
    parsed,
  )
}

/**
 * Checks if the command has special operators that require behavior beyond
 * simple subcommand checking.
 */
async function bashToolCheckCommandOperatorPermissions(
  input: z.infer<typeof BashTool.inputSchema>,
  bashToolHasPermissionFn: (
    input: z.infer<typeof BashTool.inputSchema>,
  ) => Promise<PermissionResult>,
  checkers: CommandIdentityCheckers,
  parsed: IParsedCommand,
): Promise<PermissionResult> {
  // 1. Check for unsafe compound commands (subshells, command groups).
  const tsAnalysis = parsed.getTreeSitterAnalysis()
  const isUnsafeCompound = tsAnalysis
    ? tsAnalysis.compoundStructure.hasSubshell ||
      tsAnalysis.compoundStructure.hasCommandGroup
    : isUnsafeCompoundCommand_DEPRECATED(input.command)
  if (isUnsafeCompound) {
    // This command contains an operator like `>` that we don't support as a subcommand separator
    // Check if bashCommandIsSafe_DEPRECATED has a more specific message
    const safetyResult = await bashCommandIsSafeAsync_DEPRECATED(input.command)

    const decisionReason = {
      type: 'other' as const,
      reason:
        safetyResult.behavior === 'ask' && safetyResult.message
          ? safetyResult.message
          : 'This command uses shell operators that require approval for safety',
      bashMissKind: 'shell-operators',
    }
    return {
      behavior: 'ask',
      message: createPermissionRequestMessage(BashTool.name, decisionReason),
      decisionReason,
      // This is an unsafe compound command, so we don't want to suggest rules since we wont be able to allow it
    }
  }

  // 2. Check for piped commands using ParsedCommand (preserves quotes)
  const pipeSegments = parsed.getPipeSegments()

  // If no pipes (single segment), let normal flow handle it
  if (pipeSegments.length <= 1) {
    return {
      behavior: 'passthrough',
      message: 'No pipes found in command',
    }
  }

  // Strip output redirections from each segment while preserving quotes
  const segments = await Promise.all(
    pipeSegments.map(segment => buildSegmentWithoutRedirections(segment)),
  )

  // Handle as segmented command
  return segmentedCommandPermissionResult(
    input,
    segments,
    pipeSegments,
    bashToolHasPermissionFn,
    checkers,
  )
}
