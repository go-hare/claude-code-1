import { feature } from 'bun:bundle';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { copyFile, stat as fsStat, truncate as fsTruncate, link } from 'fs/promises';
import * as React from 'react';
import { validateCoordinatorWriteAccess } from 'src/coordinator/writeGuard.js';
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js';
import type { AppState } from 'src/state/AppState.js';
import { z } from 'zod/v4';
import { getKairosActive } from 'src/bootstrap/state.js';
import { getCwd } from 'src/utils/cwd.js';
import { TOOL_SUMMARY_MAX_LENGTH } from 'src/constants/toolLimits.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { notifyVscodeFileUpdated } from 'src/services/mcp/vscodeSdkMcp.js';
import type { SetToolJSXFn, ToolCallProgress, ToolUseContext, ValidationResult } from 'src/Tool.js';
import { buildTool, findToolByName, type ToolDef } from 'src/Tool.js';
import { formatDuration } from 'src/utils/format.js';
import {
  backgroundExistingForegroundTask,
  markTaskNotified,
  registerForeground,
  spawnShellTask,
  unregisterForeground,
} from 'src/tasks/LocalShellTask/LocalShellTask.js';
import {
  isBackgroundedToDeliverMessage,
  isBackgroundedByTurnAbort,
  isLocalShellTask,
  type LocalShellTaskState,
  backgroundShellReapedAtFinalResponse,
} from 'src/tasks/LocalShellTask/guards.js';
import { isInterruptAbortReason } from 'src/utils/abortController.js';
import { getAgentContext } from 'src/utils/agentContext.js';
import type { AgentId } from 'src/types/ids.js';
import type { AssistantMessage } from 'src/types/message.js';
import { parseForSecurity } from 'src/utils/bash/ast.js';
import { PARSE_ABORTED, parseCommandRaw } from 'src/utils/bash/parser.js';
import { splitCommand_DEPRECATED, splitCommandWithOperators } from 'src/utils/bash/commands.js';
import { tryParseShellCommand } from 'src/utils/bash/shellQuote.js';
import { matchingRuleForInput } from 'src/utils/permissions/filesystem.js';
import { extractClaudeCodeHints } from 'src/utils/claudeCodeHints.js';
import { detectCodeIndexingFromCommand } from 'src/utils/codeIndexing.js';
import { clampTimeoutForAutoBackground, resolveSubagentAutoBackgroundCapMs } from 'src/utils/autoBackgroundTimeout.js';
import { CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG, hasNoHiddenControlChars } from 'src/utils/controlChars.js';
import {
  isBackgroundTasksDisabled as isBackgroundTasksDisabledEnv,
  isBashSandboxShowIndicatorEnabled,
} from 'src/utils/residualFinalEnvGates.js';
import { isENOENT, ShellError } from 'src/utils/errors.js';
import { detectFileEncoding, detectLineEndings, getFileModificationTime, writeTextContent } from 'src/utils/file.js';
import { fileHistoryEnabled, fileHistoryTrackEdit } from 'src/utils/fileHistory.js';
import { truncate } from 'src/utils/format.js';
import { getFsImplementation } from 'src/utils/fsOperations.js';
import { lazySchema } from 'src/utils/lazySchema.js';
import { expandPath } from 'src/utils/path.js';
import { remoteHostForwardRefusal } from 'src/services/tools/remoteToolHost.js';
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js';
import { maybeRecordPluginHint } from 'src/utils/plugins/hintRecommendation.js';
import { exec } from 'src/utils/Shell.js';
import type { ExecResult } from 'src/utils/ShellCommand.js';
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js';
import { semanticBoolean } from 'src/utils/semanticBoolean.js';
import { semanticNumber } from 'src/utils/semanticNumber.js';
import { EndTruncatingAccumulator } from 'src/utils/stringUtils.js';
import { getTaskOutputPath } from 'src/utils/task/diskOutput.js';
import {
  backgroundTaskEnding,
  formatBackgroundShellCopy,
  formatBackgroundTaskResult,
  isBashTaskGetDeliveryEnabled,
} from 'src/utils/bashTaskDelivery.js';
import { TaskOutput } from 'src/utils/task/TaskOutput.js';
import { isOutputLineTruncated } from 'src/utils/terminal.js';
import {
  buildLargeToolResultMessage,
  ensureToolResultsDir,
  generatePreview,
  getToolResultPath,
  PREVIEW_SIZE_BYTES,
} from 'src/utils/toolResultStorage.js';
import { userFacingName as fileEditUserFacingName } from '../FileEditTool/UI.js';
import { trackGitOperations } from '../shared/gitOperationTracking.js';
import { bashToolHasPermission, commandHasAnyCd } from './bashPermissions.js';
import { interpretCommandResult } from './commandSemantics.js';
import { getDefaultTimeoutMs, getMaxTimeoutMs, getSimplePrompt } from './prompt.js';
import { checkReadOnlyConstraints } from './readOnlyValidation.js';
import { validateCoordinatorBashWriteAccess } from './coordinatorWriteValidation.js';
import { parseSedEditCommand } from './sedEditParser.js';
import { extractSandboxViolationSuffix, mergeBashStderr } from './sandboxViolationResult.js';
import { createOutputFileCleanup, persistLargeOutputFile } from './outputFileCleanup.js';
import { getSandboxPolicyRefusal, SandboxPolicyRefusalError, shouldUseSandbox } from './shouldUseSandbox.js';
import { BASH_TOOL_NAME } from './toolName.js';
import {
  extractHookIfFallbackCommands,
  HOOK_IF_FALLBACK_NODE_TYPES,
  matchBashHookIfPattern,
} from './hookIfFallback.js';
import {
  diffBashEditDiffSnapshot,
  formatBashEditDiffForToolResult,
  isBashEditDiffEnabled,
  isGitStateSwitchCommand,
  takeBashEditDiffSnapshot,
} from './bashEditDiff.js';
import {
  BackgroundHint,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseQueuedMessage,
} from './UI.js';
import {
  buildImageToolResult,
  isImageOutput,
  resetCwdIfOutsideProject,
  resizeShellImageOutput,
  stdErrAppendShellResetMessage,
  stripEmptyLines,
} from './utils.js';

const EOL = '\n';

// Progress display constants
const PROGRESS_THRESHOLD_MS = 2000; // Show progress after 2 seconds
// In assistant mode, blocking bash auto-backgrounds after this many ms in the main agent
const ASSISTANT_BLOCKING_BUDGET_MS = 15_000;
/** densable `kpe` — bash persist cap (64 MiB). */
const MAX_PERSISTED_SIZE = 64 * 1024 * 1024;

// Search commands for collapsible display (grep, find, etc.)
const BASH_SEARCH_COMMANDS = new Set(['find', 'grep', 'rg', 'ag', 'ack', 'locate', 'which', 'whereis']);

// Read/view commands for collapsible display (cat, head, etc.)
const BASH_READ_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  // Analysis commands
  'wc',
  'stat',
  'file',
  'strings',
  // Data processing — commonly used to parse/transform file content in pipes
  'jq',
  'awk',
  'cut',
  'sort',
  'uniq',
  'tr',
]);

// Directory-listing commands for collapsible display (ls, tree, du).
// Split from BASH_READ_COMMANDS so the summary says "Listed N directories"
// instead of the misleading "Read N files".
const BASH_LIST_COMMANDS = new Set(['ls', 'tree', 'du']);

// Commands that are semantic-neutral in any position — pure output/status commands
// that don't change the read/search nature of the overall pipeline.
// e.g. `ls dir && echo "---" && ls dir2` is still a read-only compound command.
const BASH_SEMANTIC_NEUTRAL_COMMANDS = new Set([
  'echo',
  'printf',
  'true',
  'false',
  ':', // bash no-op
]);

// Commands that typically produce no stdout on success
const BASH_SILENT_COMMANDS = new Set([
  'mv',
  'cp',
  'rm',
  'mkdir',
  'rmdir',
  'chmod',
  'chown',
  'chgrp',
  'touch',
  'ln',
  'cd',
  'export',
  'unset',
  'wait',
]);

/**
 * Checks if a bash command is a search or read operation.
 * Used to determine if the command should be collapsed in the UI.
 * Returns an object indicating whether it's a search or read operation.
 *
 * For pipelines (e.g., `cat file | bq`), ALL parts must be search/read commands
 * for the whole command to be considered collapsible.
 *
 * Semantic-neutral commands (echo, printf, true, false, :) are skipped in any
 * position, as they're pure output/status commands that don't affect the read/search
 * nature of the pipeline (e.g. `ls dir && echo "---" && ls dir2` is still a read).
 */
export function isSearchOrReadBashCommand(command: string): {
  isSearch: boolean;
  isRead: boolean;
  isList: boolean;
} {
  let partsWithOperators: string[];
  try {
    partsWithOperators = splitCommandWithOperators(command);
  } catch {
    // If we can't parse the command due to malformed syntax,
    // it's not a search/read command
    return { isSearch: false, isRead: false, isList: false };
  }

  if (partsWithOperators.length === 0) {
    return { isSearch: false, isRead: false, isList: false };
  }

  let hasSearch = false;
  let hasRead = false;
  let hasList = false;
  let hasNonNeutralCommand = false;
  let skipNextAsRedirectTarget = false;

  for (const part of partsWithOperators) {
    if (skipNextAsRedirectTarget) {
      skipNextAsRedirectTarget = false;
      continue;
    }

    if (part === '>' || part === '>>' || part === '>&') {
      skipNextAsRedirectTarget = true;
      continue;
    }

    if (part === '||' || part === '&&' || part === '|' || part === ';') {
      continue;
    }

    const baseCommand = part.trim().split(/\s+/)[0];
    if (!baseCommand) {
      continue;
    }

    if (BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
      continue;
    }

    hasNonNeutralCommand = true;

    const isPartSearch = BASH_SEARCH_COMMANDS.has(baseCommand);
    const isPartRead = BASH_READ_COMMANDS.has(baseCommand);
    const isPartList = BASH_LIST_COMMANDS.has(baseCommand);

    if (!isPartSearch && !isPartRead && !isPartList) {
      return { isSearch: false, isRead: false, isList: false };
    }

    if (isPartSearch) hasSearch = true;
    if (isPartRead) hasRead = true;
    if (isPartList) hasList = true;
  }

  // Only neutral commands (e.g., just "echo foo") -- not collapsible
  if (!hasNonNeutralCommand) {
    return { isSearch: false, isRead: false, isList: false };
  }

  return { isSearch: hasSearch, isRead: hasRead, isList: hasList };
}

/**
 * Checks if a bash command is expected to produce no stdout on success.
 * Used to show "Done" instead of "(No output)" in the UI.
 */
function isSilentBashCommand(command: string): boolean {
  let partsWithOperators: string[];
  try {
    partsWithOperators = splitCommandWithOperators(command);
  } catch {
    return false;
  }

  if (partsWithOperators.length === 0) {
    return false;
  }

  let hasNonFallbackCommand = false;
  let lastOperator: string | null = null;
  let skipNextAsRedirectTarget = false;

  for (const part of partsWithOperators) {
    if (skipNextAsRedirectTarget) {
      skipNextAsRedirectTarget = false;
      continue;
    }

    if (part === '>' || part === '>>' || part === '>&') {
      skipNextAsRedirectTarget = true;
      continue;
    }

    if (part === '||' || part === '&&' || part === '|' || part === ';') {
      lastOperator = part;
      continue;
    }

    const baseCommand = part.trim().split(/\s+/)[0];
    if (!baseCommand) {
      continue;
    }

    if (lastOperator === '||' && BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
      continue;
    }

    hasNonFallbackCommand = true;

    if (!BASH_SILENT_COMMANDS.has(baseCommand)) {
      return false;
    }
  }

  return hasNonFallbackCommand;
}

// Commands that should not be auto-backgrounded
const DISALLOWED_AUTO_BACKGROUND_COMMANDS = [
  'sleep', // Sleep should run in foreground unless explicitly backgrounded by user
];

// Check if background tasks are disabled at module load time
// Official DISABLE_BACKGROUND_TASKS densable — captured once at module load
// so the schema omits run_in_background for the whole process.
// eslint-disable-next-line custom-rules/no-process-env-top-level -- Intentional: schema must be defined at module load
const isBackgroundTasksDisabled = isBackgroundTasksDisabledEnv();

const fullInputSchema = lazySchema(() =>
  z.strictObject({
    // densable 2.1.216: command.refine(r0e, Ya_) — same C0/C1 gate as PowerShell.
    command: z
      .string()
      .refine(hasNoHiddenControlChars, CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG)
      .describe('The command to execute'),
    timeout: semanticNumber(z.number().optional()).describe(
      `Optional timeout in milliseconds (max ${getMaxTimeoutMs()})`,
    ),
    description: z
      .string()
      .optional()
      .describe(`Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.

For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):
- ls → "List files in current directory"
- git status → "Show working tree status"
- npm install → "Install package dependencies"

For commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:
- find . -name "*.tmp" -exec rm {} \\; → "Find and delete all .tmp files recursively"
- git reset --hard origin/main → "Discard all local changes and match remote main"
- curl -s url | jq '.data[]' → "Fetch JSON from URL and extract data array elements"`),
    run_in_background: semanticBoolean(z.boolean().optional()).describe(
      `Set to true to run this command in the background. Use Read to read the output later.`,
    ),
    dangerouslyDisableSandbox: semanticBoolean(z.boolean().optional()).describe(
      'Set this to true to dangerously override sandbox mode and run commands without sandboxing.',
    ),
    _simulatedSedEdit: z
      .object({
        filePath: z.string(),
        newContent: z.string(),
      })
      .optional()
      .describe('Internal: pre-computed sed edit result from preview'),
  }),
);

// Always omit _simulatedSedEdit from the model-facing schema. It is an internal-only
// field set by SedEditPermissionRequest after the user approves a sed edit preview.
// Exposing it in the schema would let the model bypass permission checks and the
// sandbox by pairing an innocuous command with an arbitrary file write.
// Also conditionally remove run_in_background when background tasks are disabled.
/**
 * Official 2.1.325 `vIo` (`coerceInput` for BashTool):
 * - `timeout_ms` -> `timeout` when `timeout` is absent
 * - `command_description` -> `description` (or `command_description_dropped` if `description` already present)
 */
export function coerceBashInput(raw: unknown): { input: z.infer<InputSchema>; shapeClass: string } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const next: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const shapes: string[] = [];
  if ('timeout_ms' in next && !('timeout' in next)) {
    const val = next.timeout_ms;
    if (typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val))) {
      next.timeout = val;
      delete next.timeout_ms;
      shapes.push('timeout_ms');
    }
  }
  if ('command_description' in next) {
    if (!('description' in next) && typeof next.command_description === 'string') {
      next.description = next.command_description;
      shapes.push('command_description');
    } else {
      shapes.push('command_description_dropped');
    }
    delete next.command_description;
  }
  return shapes.length > 0 ? { input: next as z.infer<InputSchema>, shapeClass: shapes.join(',') } : null;
}

const inputSchema = lazySchema(() =>
  isBackgroundTasksDisabled
    ? fullInputSchema().omit({
        run_in_background: true,
        _simulatedSedEdit: true,
      })
    : fullInputSchema().omit({ _simulatedSedEdit: true }),
);
type InputSchema = ReturnType<typeof inputSchema>;

// Use fullInputSchema for the type to always include run_in_background
// (even when it's omitted from the schema, the code needs to handle it)
export type BashToolInput = z.infer<ReturnType<typeof fullInputSchema>>;

const COMMON_BACKGROUND_COMMANDS = [
  'npm',
  'yarn',
  'pnpm',
  'node',
  'python',
  'python3',
  'go',
  'cargo',
  'make',
  'docker',
  'terraform',
  'webpack',
  'vite',
  'jest',
  'pytest',
  'curl',
  'wget',
  'build',
  'test',
  'serve',
  'watch',
  'dev',
] as const;

function getCommandTypeForLogging(command: string): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  const parts = splitCommand_DEPRECATED(command);
  if (parts.length === 0) return 'other' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;

  // Check each part of the command to see if any match common background commands
  for (const part of parts) {
    const baseCommand = part.split(' ')[0] || '';
    if (COMMON_BACKGROUND_COMMANDS.includes(baseCommand as (typeof COMMON_BACKGROUND_COMMANDS)[number])) {
      return baseCommand as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    }
  }

  return 'other' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
}

const outputSchema = lazySchema(() =>
  z.object({
    stdout: z.string().describe('The standard output of the command'),
    stderr: z.string().describe('The standard error output of the command'),
    rawOutputPath: z.string().optional().describe('Path to raw output file for large MCP tool outputs'),
    interrupted: z.boolean().describe('Whether the command was interrupted'),
    isImage: z.boolean().optional().describe('Flag to indicate if stdout contains image data'),
    backgroundTaskId: z.string().optional().describe('ID of the background task if command is running in background'),
    backgroundedByUser: z
      .boolean()
      .optional()
      .describe('True if the user manually backgrounded the command with Ctrl+B'),
    assistantAutoBackgrounded: z
      .boolean()
      .optional()
      .describe('True if assistant-mode auto-backgrounded a long-running blocking command'),
    backgroundedToDeliverMessage: z.boolean().optional(),
    backgroundedByTurnAbort: z.boolean().optional(),
    timedOutAfterMs: z.number().optional(),
    backgroundCwdHint: z
      .string()
      .optional()
      .describe(
        'Model-facing note that the session cwd was not changed by a backgrounded command containing a directory-change builtin (cd/pushd/popd/chdir)',
      ),
    backgroundEndsWithFinalResponse: z
      .literal(true)
      .optional()
      .describe(
        'True when this backgrounded command is owned by a synchronous subagent and is therefore terminated when that agent gives its final response; absent when the command survives (main loop, async subagents)',
      ),
    dangerouslyDisableSandbox: z.boolean().optional().describe('Flag to indicate if sandbox mode was overridden'),
    returnCodeInterpretation: z
      .string()
      .optional()
      .describe('Semantic interpretation for non-error exit codes with special meaning'),
    noOutputExpected: z
      .boolean()
      .optional()
      .describe('Whether the command is expected to produce no output on success'),
    structuredContent: z.array(z.any()).optional().describe('Structured content blocks'),
    persistedOutputPath: z
      .string()
      .optional()
      .describe('Path to the persisted full output in tool-results dir (set when output is too large for inline)'),
    persistedOutputSize: z
      .number()
      .optional()
      .describe('Total size of the output in bytes (set when output is too large for inline)'),
    bashEditDiff: z
      .object({
        files: z.array(
          z.object({
            filePath: z.string(),
            hunks: z.array(
              z.object({
                oldStart: z.number(),
                oldLines: z.number(),
                newStart: z.number(),
                newLines: z.number(),
                lines: z.array(z.string()),
              }),
            ),
            created: z.boolean().optional(),
            deleted: z.boolean().optional(),
          }),
        ),
        moreFiles: z.number(),
        changedFiles: z
          .array(z.string())
          .optional()
          .describe(
            'Absolute paths of every changed file known, shown or not, at most 200; for PostToolUse Bash hooks',
          ),
        skipped: z.boolean().optional(),
        unavailable: z.boolean().optional(),
        shared: z.boolean().optional(),
      })
      .optional()
      .describe(
        'Diff of files a Bash command changed (PostToolUse hooks get changedFiles). Not always shown to the model.',
      ),
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;
export type Out = z.infer<OutputSchema>;

// Re-export BashProgress from centralized types to break import cycles
export type { BashProgress } from 'src/types/tools.js';

import type { BashProgress } from 'src/types/tools.js';

/**
 * Checks if a command is allowed to be automatically backgrounded
 * @param command The command to check
 * @returns false for commands that should not be auto-backgrounded (like sleep)
 */
function isAutobackgroundingAllowed(command: string): boolean {
  const parts = splitCommand_DEPRECATED(command);
  if (parts.length === 0) return true;

  // Get the first part which should be the base command
  const baseCommand = parts[0]?.trim();
  if (!baseCommand) return true;

  return !DISALLOWED_AUTO_BACKGROUND_COMMANDS.includes(baseCommand);
}

/**
 * Detect standalone or leading `sleep N` patterns that should use Monitor
 * instead. Catches `sleep 5`, `sleep 5 && check`, `sleep 5; check` — but
 * not sleep inside pipelines, subshells, or scripts (those are fine).
 */
export function detectBlockedSleepPattern(command: string): string | null {
  const parts = splitCommand_DEPRECATED(command);
  if (parts.length === 0) return null;

  const first = parts[0]?.trim() ?? '';
  // Bare `sleep N` or `sleep N.N` as the first subcommand.
  // Float durations (sleep 0.5) are allowed — those are legit pacing, not polls.
  const m = /^sleep\s+(\d+)\s*$/.exec(first);
  if (!m) return null;
  const secs = parseInt(m[1]!, 10);
  if (secs < 2) return null; // sub-2s sleeps are fine (rate limiting, pacing)

  // `sleep N` alone → "what are you waiting for?"
  // `sleep N && check` → "use Monitor { command: check }"
  const rest = parts.slice(1).join(' ').trim();
  return rest ? `sleep ${secs} followed by: ${rest}` : `standalone sleep ${secs}`;
}

/**
 * Checks if a command contains tools that shouldn't run in sandbox
 * This includes:
 * - Dynamic config-based disabled commands and substrings (tengu_sandbox_disabled_commands)
 * - User-configured commands from settings.json (sandbox.excludedCommands)
 *
 * User-configured commands support the same pattern syntax as permission rules:
 * - Exact matches: "npm run lint"
 * - Prefix patterns: "npm run test:*"
 */

type SimulatedSedEditResult = {
  data: Out;
};

type SimulatedSedEditContext = Pick<ToolUseContext, 'readFileState' | 'updateFileHistoryState'>;

/**
 * Applies a simulated sed edit directly instead of running sed.
 * This is used by the permission dialog to ensure what the user previews
 * is exactly what gets written to the file.
 */
async function applySedEdit(
  simulatedEdit: { filePath: string; newContent: string },
  toolUseContext: SimulatedSedEditContext,
  parentMessage?: AssistantMessage,
): Promise<SimulatedSedEditResult> {
  const { filePath, newContent } = simulatedEdit;
  const absoluteFilePath = expandPath(filePath);
  const fs = getFsImplementation();

  // Read original content for VS Code notification
  const encoding = detectFileEncoding(absoluteFilePath);
  let originalContent: string;
  try {
    originalContent = await fs.readFile(absoluteFilePath, { encoding });
  } catch (e) {
    if (isENOENT(e)) {
      return {
        data: {
          stdout: '',
          stderr: `sed: ${filePath}: No such file or directory\nExit code 1`,
          interrupted: false,
        },
      };
    }
    throw e;
  }

  // Track file history before making changes (for undo support)
  if (fileHistoryEnabled() && parentMessage) {
    await fileHistoryTrackEdit(toolUseContext.updateFileHistoryState, absoluteFilePath, parentMessage.uuid);
  }

  const coordinatorWriteValidation = validateCoordinatorWriteAccess({
    filePath: absoluteFilePath,
    sourceTool: 'BashTool(sed)',
  });
  if (!coordinatorWriteValidation.result) {
    return {
      data: {
        stdout: '',
        stderr: `${coordinatorWriteValidation.message}\nExit code 1`,
        interrupted: false,
      },
    };
  }

  // Detect line endings and write new content
  const endings = detectLineEndings(absoluteFilePath);
  writeTextContent(absoluteFilePath, newContent, encoding, endings);

  // Notify VS Code about the file change
  notifyVscodeFileUpdated(absoluteFilePath, originalContent, newContent);

  // Update read timestamp to invalidate stale writes
  toolUseContext.readFileState.set(absoluteFilePath, {
    content: newContent,
    timestamp: getFileModificationTime(absoluteFilePath),
    offset: undefined,
    limit: undefined,
  });

  // Return success result matching sed output format (sed produces no output on success)
  return {
    data: {
      stdout: '',
      stderr: '',
      interrupted: false,
    },
  };
}

type ParsedBashFileRead = {
  filePath: string;
  startLine: number | undefined;
  endLine: number | undefined;
  tailLines?: number;
  numbered?: boolean;
  requiresExitZero?: boolean;
  contentNotInModelContext?: boolean;
};

const BASH_DEFAULT_HEAD_TAIL_LINES = 10;
const SED_RANGE_RE = /^(\d+),(\d+)p$/;
const SED_SINGLE_LINE_RE = /^(\d+)p$/;
const NOOP_PREFIX_RE = /^\s*(echo|printf|true|:)\b/;
const CAT_LIKE_ALLOWED_FLAGS = new Map<string, Set<string>>([
  ['cat', new Set(['-n', '--number'])],
  ['nl', new Set()],
  ['bat', new Set(['-n', '--number', '-p', '--plain'])],
  ['batcat', new Set(['-n', '--number', '-p', '--plain'])],
]);
const GREP_CONTEXT_SHORT_RE = /^-[ABC]\d+$/;
const RG_CONTEXT_LONG_RE = /^--(?:after-context|before-context|context)=\d+$/;
const GREP_FLAGS_RE = /^-[niwxEFGPHh]+$/;
const GREP_LONG_FLAGS = new Set([
  '--line-number',
  '--ignore-case',
  '--word-regexp',
  '--line-regexp',
  '--extended-regexp',
  '--fixed-strings',
  '--basic-regexp',
  '--perl-regexp',
  '--with-filename',
  '--no-filename',
  '--color=never',
  '--color=auto',
]);
const RG_FLAGS_RE = /^-[iSswxFnNHUP]+$/;
const RG_LONG_FLAGS = new Set([
  '--ignore-case',
  '--smart-case',
  '--case-sensitive',
  '--word-regexp',
  '--line-regexp',
  '--fixed-strings',
  '--line-number',
  '--no-line-number',
  '--with-filename',
  '--no-filename',
  '--multiline',
  '--pcre2',
]);

function tokenizeSimpleSubcommand(subcommand: string): string[] | null {
  const parsed = tryParseShellCommand(subcommand);
  if (!parsed.success) return null;
  if (parsed.tokens.some(t => typeof t !== 'string')) return null;
  return parsed.tokens as string[];
}

function parseSedSingleFileRead(subcommand: string): ParsedBashFileRead | null {
  const tokens = tokenizeSimpleSubcommand(subcommand);
  if (!tokens || tokens[0] !== 'sed') return null;
  let quiet = false;
  let script: string | null = null;
  let filePath: string | null = null;
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.startsWith('-')) {
      if (tok.startsWith('--')) {
        if (tok === '--in-place' || tok.startsWith('--in-place=')) return null;
        if (tok === '--expression') return null;
        if (tok === '--quiet' || tok === '--silent') quiet = true;
      } else {
        if (tok.includes('i')) return null;
        if (tok === '-e') return null;
        if (tok.includes('n')) quiet = true;
      }
      continue;
    }
    if (script === null) script = tok;
    else if (filePath === null) filePath = tok;
    else return null;
  }
  if (!quiet || script === null || filePath === null) return null;
  const rangeMatch = SED_RANGE_RE.exec(script);
  if (rangeMatch) {
    return {
      filePath,
      startLine: Number(rangeMatch[1]),
      endLine: Number(rangeMatch[2]),
    };
  }
  const singleMatch = SED_SINGLE_LINE_RE.exec(script);
  if (singleMatch) {
    const line = Number(singleMatch[1]);
    return { filePath, startLine: line, endLine: line };
  }
  return null;
}

function parseCatLikeSingleFileRead(subcommand: string): ParsedBashFileRead | null {
  const tokens = tokenizeSimpleSubcommand(subcommand);
  if (!tokens) return null;
  const allowedFlags = CAT_LIKE_ALLOWED_FLAGS.get(tokens[0] ?? '');
  if (allowedFlags === undefined) return null;
  let filePath: string | null = null;
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.startsWith('-') && tok !== '-') {
      if (!allowedFlags.has(tok)) return null;
      continue;
    }
    if (filePath !== null) return null;
    filePath = tok;
  }
  if (filePath === null || filePath === '-') return null;
  const numbered = tokens[0] === 'nl' || tokens.includes('-n') || tokens.includes('--number');
  return {
    filePath,
    startLine: undefined,
    endLine: undefined,
    ...(numbered ? { numbered } : {}),
  };
}

function parseHeadTailArgs(tokens: string[], defaultCount: number): { count: number; filePath: string } | null {
  let count: number | null = null;
  let filePath: string | null = null;
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok === '-n' || tok === '--lines') {
      const next = tokens[++i];
      if (next === undefined || !/^\d+$/.test(next)) return null;
      count = Number(next);
      continue;
    }
    if (tok.startsWith('--lines=')) {
      const raw = tok.slice(8);
      if (!/^\d+$/.test(raw)) return null;
      count = Number(raw);
      continue;
    }
    if (/^-n\d+$/.test(tok)) {
      count = Number(tok.slice(2));
      continue;
    }
    if (/^-\d+$/.test(tok)) {
      count = Number(tok.slice(1));
      continue;
    }
    if (tok.startsWith('-')) return null;
    if (filePath !== null) return null;
    filePath = tok;
  }
  if (filePath === null || filePath === '-' || count === 0) return null;
  return { count: count ?? defaultCount, filePath };
}

function parseHeadSingleFileRead(subcommand: string): ParsedBashFileRead | null {
  const tokens = tokenizeSimpleSubcommand(subcommand);
  if (!tokens || tokens[0] !== 'head') return null;
  const parsed = parseHeadTailArgs(tokens, BASH_DEFAULT_HEAD_TAIL_LINES);
  if (!parsed) return null;
  return { filePath: parsed.filePath, startLine: 1, endLine: parsed.count };
}

function parseTailSingleFileRead(subcommand: string): ParsedBashFileRead | null {
  const tokens = tokenizeSimpleSubcommand(subcommand);
  if (!tokens || tokens[0] !== 'tail') return null;
  const parsed = parseHeadTailArgs(tokens, BASH_DEFAULT_HEAD_TAIL_LINES);
  if (!parsed) return null;
  return {
    filePath: parsed.filePath,
    startLine: undefined,
    endLine: undefined,
    tailLines: parsed.count,
  };
}

function parseGrepSingleFileRead(subcommand: string): ParsedBashFileRead | null {
  const tokens = tokenizeSimpleSubcommand(subcommand);
  if (!tokens) return null;
  const isRg = tokens[0] === 'rg';
  if (!isRg && tokens[0] !== 'grep' && tokens[0] !== 'egrep' && tokens[0] !== 'fgrep') {
    return null;
  }
  const shortRe = isRg ? RG_FLAGS_RE : GREP_FLAGS_RE;
  const longSet = isRg ? RG_LONG_FLAGS : GREP_LONG_FLAGS;
  let pattern: string | null = null;
  let filePath: string | null = null;
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.startsWith('-') && tok !== '-') {
      if (tok === '-A' || tok === '-B' || tok === '-C') {
        const next = tokens[++i];
        if (next === undefined || !/^\d+$/.test(next)) return null;
        continue;
      }
      if (isRg && (tok === '--after-context' || tok === '--before-context' || tok === '--context')) {
        const next = tokens[++i];
        if (next === undefined || !/^\d+$/.test(next)) return null;
        continue;
      }
      if (GREP_CONTEXT_SHORT_RE.test(tok) || RG_CONTEXT_LONG_RE.test(tok) || shortRe.test(tok) || longSet.has(tok)) {
        continue;
      }
      return null;
    }
    if (pattern === null) pattern = tok;
    else if (filePath === null) filePath = tok;
    else return null;
  }
  if (pattern === null || filePath === null || filePath === '-') return null;
  if (/[*?[{]/.test(filePath)) return null;
  return {
    filePath,
    startLine: undefined,
    endLine: undefined,
    requiresExitZero: true,
    contentNotInModelContext: true,
  };
}

/** #313 SEA `Nxs`: parse single-file cat/head/tail/sed -n/grep commands. */
export function parseSingleFileReadCommands(command: string): ParsedBashFileRead[] {
  if (/[|<>]/.test(command)) return [];
  let subcommands: string[];
  try {
    subcommands = splitCommand_DEPRECATED(command);
  } catch {
    return [];
  }
  if (subcommands.length === 0) return [];
  const out: ParsedBashFileRead[] = [];
  for (const sub of subcommands) {
    const parsed =
      parseSedSingleFileRead(sub) ??
      parseCatLikeSingleFileRead(sub) ??
      parseHeadSingleFileRead(sub) ??
      parseTailSingleFileRead(sub) ??
      (subcommands.length === 1 ? parseGrepSingleFileRead(sub) : null);
    if (parsed) {
      out.push(parsed);
    } else if (subcommands.length > 1 && !NOOP_PREFIX_RE.test(sub)) {
      return [];
    }
  }
  return out;
}

function extractSliceForBashRead(
  content: string,
  parsed: ParsedBashFileRead,
): { content: string; offset: number | undefined; limit: number | undefined } | null {
  if (parsed.tailLines !== undefined) {
    const lines = content.split('\n');
    if (lines.length > 0 && lines.at(-1) === '') lines.pop();
    if (lines.length === 0) return null;
    const count = Math.min(parsed.tailLines, lines.length);
    const offset = lines.length - count + 1;
    return {
      content: lines.slice(offset - 1).join('\n'),
      offset,
      limit: count,
    };
  }
  if (parsed.startLine === undefined) {
    return { content, offset: undefined, limit: undefined };
  }
  const lines = content.split('\n');
  const start = Math.max(1, parsed.startLine);
  const end = Math.max(start, parsed.endLine ?? start);
  if (start > lines.length) return null;
  return {
    content: lines.slice(start - 1, end).join('\n'),
    offset: start,
    limit: end - start + 1,
  };
}

function stripLineNumberPrefix(line: string): string {
  const m = /^[ \t]*\d+[ \t]/.exec(line);
  return m ? line.slice(m[0].length) : /^[ \t]*$/.test(line) ? '' : line;
}

/** #403 SEA `mpi`: verify file content was actually printed in Bash stdout. */
export function isContentPrintedInStdout(stdout: string, fileSlice: string, numbered?: boolean): boolean {
  const needle = fileSlice.replace(/^(\s*\n)+/, '').trimEnd();
  const haystack = stdout.replaceAll('\r\n', '\n');
  if (haystack.includes(needle)) return true;
  if (numbered === true) {
    return haystack.split('\n').map(stripLineNumberPrefix).join('\n').includes(needle);
  }
  return false;
}

const BASH_READ_TRACK_MAX_BYTES = 10 * 1024 * 1024;

/**
 * #313 / #403 SEA `xIo`: track single-file reads from BashTool (`cat`, `head`,
 * `tail`, `sed -n`, `grep`/`rg`) in `readFileState` (only when printed to stdout)
 * and trigger `nestedMemoryAttachmentTriggers` (unless read-denied).
 */
export async function trackBashSingleFileReads(
  command: string,
  readFileState: ToolUseContext['readFileState'],
  signal: AbortSignal,
  exitCode: number,
  stdoutForVerify: string | undefined,
  nestedMemoryOpts?: {
    triggers: Set<string>;
    permissions: () => ToolUseContext['getAppState'] extends () => infer S
      ? S extends { toolPermissionContext: infer P }
        ? P
        : never
      : never;
  },
): Promise<void> {
  const entries = parseSingleFileReadCommands(command).filter(
    h => Boolean(h.filePath) && (!h.requiresExitZero || exitCode === 0),
  );
  if (entries.length === 0) return;
  const fs = getFsImplementation();
  await Promise.all(
    entries.map(async h => {
      const absPath = expandPath(h.filePath);
      try {
        if (readFileState.get(absPath)) {
          if (
            nestedMemoryOpts &&
            matchingRuleForInput(absPath, nestedMemoryOpts.permissions(), 'read', 'deny') === null
          ) {
            nestedMemoryOpts.triggers.add(absPath);
          }
          return;
        }
        const stats = await fs.stat(absPath);
        if (!stats.isFile() || stats.size > BASH_READ_TRACK_MAX_BYTES) return;
        if (signal.aborted) return;
        const raw = await fs.readFile(absPath, { encoding: 'utf8' });
        const normalized = raw.replaceAll('\r\n', '\n');
        const sliced = extractSliceForBashRead(normalized, h);
        if (sliced === null || (!sliced.content.trim() && normalized.trim())) {
          return;
        }
        if (
          stdoutForVerify !== undefined &&
          !h.contentNotInModelContext &&
          !isContentPrintedInStdout(stdoutForVerify, sliced.content, h.numbered)
        ) {
          return;
        }
        readFileState.set(absPath, {
          content: sliced.content,
          timestamp: Math.floor(stats.mtimeMs),
          offset: sliced.offset,
          limit: sliced.limit,
          ...(h.contentNotInModelContext || stdoutForVerify === undefined ? { contentNotInModelContext: true } : {}),
        });
        if (
          nestedMemoryOpts &&
          matchingRuleForInput(absPath, nestedMemoryOpts.permissions(), 'read', 'deny') === null
        ) {
          nestedMemoryOpts.triggers.add(absPath);
        }
      } catch {
        // Ignore stat/read failures for non-existent or unreadable paths
      }
    }),
  );
}

export function findMatchingBackgroundShellTask(
  {
    command,
    cwd,
    agentId,
    toolUseId,
  }: {
    command: string;
    cwd: string;
    agentId: string | undefined;
    toolUseId: string | undefined;
  },
  tasks: AppState['tasks'],
): LocalShellTaskState | undefined {
  if (toolUseId === undefined) return undefined;
  const trimmed = command.trim();
  return Object.values(tasks)
    .filter(isLocalShellTask)
    .find(task => {
      const taskCwd = (task as LocalShellTaskState & { cwd?: string }).cwd;
      return (
        task.isBackgrounded &&
        task.status === 'running' &&
        task.shellCommand?.status === 'backgrounded' &&
        (task.caller === 'turn' || task.caller === 'agent') &&
        task.toolUseId !== undefined &&
        (task.shell === undefined || task.shell === 'bash') &&
        task.agentId === agentId &&
        (taskCwd === undefined || taskCwd === cwd) &&
        task.command.trim() === trimmed
      );
    });
}

export const BashTool = buildTool({
  name: BASH_TOOL_NAME,
  searchHint: 'execute shell commands',
  // densable 2.1.248 #1 Unt — official enablesCodeExecution:!0 @187127917
  enablesCodeExecution: true,
  // densable li remoteExecution + backgrounding self
  remoteExecution: {
    supported: true,
    refusedInputFields: ['dangerouslyDisableSandbox', 'run_in_background', '_simulatedSedEdit'],
    decidingInputFields: ['command', 'run_in_background', 'dangerouslyDisableSandbox'],
  },
  backgrounding: 'self',
  // 30K chars - tool result persistence threshold
  maxResultSizeChars: 30_000,
  strict: true,
  async description({ description }) {
    return description || 'Run shell command';
  },
  async prompt() {
    return getSimplePrompt();
  },
  isConcurrencySafe(input) {
    return this.isReadOnly?.(input) ?? false;
  },
  isReadOnly(input) {
    const compoundCommandHasCd = commandHasAnyCd(input.command);
    const result = checkReadOnlyConstraints(input, compoundCommandHasCd);
    return result.behavior === 'allow';
  },
  toAutoClassifierInput(input) {
    return input.command;
  },
  async preparePermissionMatcher({ command }) {
    // Hook `if` filtering is "no match → skip hook" (deny-like semantics), so
    // compound commands must fire the hook if ANY subcommand matches. Without
    // splitting, `ls && git push` would bypass a `Bash(git *)` security hook.
    const parsed = await parseForSecurity(command);
    let subcommands: string[];
    let fallback = false;
    if (parsed.kind === 'simple') {
      // Match on argv (strips leading VAR=val) so `FOO=bar git push` still
      // matches `Bash(git *)`.
      subcommands = parsed.commands.map(c => c.argv.join(' '));
    } else if (
      parsed.kind === 'too-complex' &&
      !parsed.differential &&
      HOOK_IF_FALLBACK_NODE_TYPES.has(parsed.nodeType ?? '')
    ) {
      // densable 2.1.243 #26 `P7r`: `$()` / backticks + extra args are
      // too-complex for argv, but must not match every `if` (e.g. Bash(cat *)).
      const root = await parseCommandRaw(command);
      if (root === null || root === PARSE_ABORTED) {
        return () => true;
      }
      const extracted = extractHookIfFallbackCommands(command, root);
      if (extracted === null || extracted.length === 0) {
        return () => true;
      }
      subcommands = extracted;
      fallback = true;
    } else {
      return () => true;
    }
    return pattern => matchBashHookIfPattern(pattern, subcommands, fallback);
  },
  isSearchOrReadCommand(input) {
    const parsed = inputSchema().safeParse(input);
    if (!parsed.success) return { isSearch: false, isRead: false, isList: false };
    return isSearchOrReadBashCommand(parsed.data.command);
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  coerceInput: coerceBashInput,
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName(input) {
    if (!input) {
      return 'Bash';
    }
    // Env var FIRST: shouldUseSandbox → splitCommand_DEPRECATED → shell-quote's
    // `new RegExp` per call. userFacingName runs per-render for every bash
    // message in history; with ~50 msgs + one slow-to-tokenize command, this
    // exceeds the shimmer tick → transition abort → infinite retry (#21605).
    return isBashSandboxShowIndicatorEnabled() && shouldUseSandbox(input) ? 'SandboxedBash' : 'Bash';
  },
  getToolUseSummary(input) {
    if (!input?.command) {
      return null;
    }
    const { command, description } = input;
    if (description) {
      return description;
    }
    return truncate(command, TOOL_SUMMARY_MAX_LENGTH);
  },
  getActivityDescription(input) {
    if (!input?.command) {
      return 'Running command';
    }
    const desc = input.description ?? truncate(input.command, TOOL_SUMMARY_MAX_LENGTH);
    return `Running ${desc}`;
  },
  async validateInput(input: BashToolInput, context?: ToolUseContext): Promise<ValidationResult> {
    // densable BT() && dK(n).requested — named host is not forwarded (errorCode 11)
    const hostRefusal = remoteHostForwardRefusal(input, BASH_TOOL_NAME);
    if (hostRefusal) return { ...hostRefusal, errorCode: 11 };
    const policyRefusal = getSandboxPolicyRefusal(shouldUseSandbox(input), input.command, false, 'bash');
    if (policyRefusal !== null) {
      return { result: false, message: policyRefusal, errorCode: 14 };
    }
    if (feature('MONITOR_TOOL') && !isBackgroundTasksDisabled && !input.run_in_background) {
      const sleepPattern = detectBlockedSleepPattern(input.command);
      if (sleepPattern !== null) {
        return {
          result: false,
          message: `Blocked: ${sleepPattern}. Run blocking commands in the background with run_in_background: true — you'll get a completion notification when done. For streaming events (watching logs, polling APIs), use the Monitor tool. If you genuinely need a delay (rate limiting, deliberate pacing), keep it under 2 seconds.`,
          errorCode: 10,
        };
      }
    }
    if (context?.getAppState && context.options?.tools) {
      const matchingBg = findMatchingBackgroundShellTask(
        {
          command: input.command,
          cwd: getCwd(),
          agentId: context.agentId,
          toolUseId: context.toolUseId,
        },
        context.getAppState().tasks,
      );
      if (matchingBg !== undefined && findToolByName(context.options.tools, 'TaskStop') !== undefined) {
        return {
          result: false,
          errorCode: 15,
          message: `Not started: this same command, in this directory, was moved to the background and has been running for ${formatDuration(Date.now() - matchingBg.startTime, { mostSignificantOnly: true })} (ID: ${matchingBg.id}). Its output is being written to: ${matchingBg.outputFile}. Let it finish, or, to run it again now, stop it first with TaskStop.`,
        };
      }
    }
    return { result: true };
  },
  async checkPermissions(input, context): Promise<PermissionResult> {
    return bashToolHasPermission(input, context);
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseQueuedMessage,
  renderToolResultMessage,
  // BashToolResultMessage shows <OutputLine content={stdout}> + stderr.
  // UI never shows persistedOutputPath wrapper, backgroundInfo — those are
  // model-facing (mapToolResult... below).
  extractSearchText({ stdout, stderr }) {
    return stderr ? `${stdout}\n${stderr}` : stdout;
  },
  mapToolResultToToolResultBlockParam(
    {
      interrupted,
      stdout,
      stderr,
      isImage,
      backgroundTaskId,
      backgroundedByUser,
      assistantAutoBackgrounded: _assistantAutoBackgrounded,
      backgroundedToDeliverMessage,
      backgroundedByTurnAbort,
      timedOutAfterMs,
      backgroundEndsWithFinalResponse,
      backgroundCwdHint,
      structuredContent,
      persistedOutputPath,
      persistedOutputSize,
      bashEditDiff,
    },
    toolUseID,
  ): ToolResultBlockParam {
    // Handle structured content
    if (structuredContent && structuredContent.length > 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: structuredContent,
      };
    }

    // For image data, format as image content block for Claude
    if (isImage) {
      const block = buildImageToolResult(stdout, toolUseID);
      if (block) {
        const trimmedStderr = typeof stderr === 'string' ? stderr.trim() : '';
        if (trimmedStderr) {
          return {
            ...block,
            content: [...(Array.isArray(block.content) ? block.content : []), { type: 'text', text: trimmedStderr }],
          };
        }
        return block;
      }
    }

    let processedStdout = stdout;
    if (stdout) {
      // Replace any leading newlines or lines with only whitespace
      processedStdout = stdout.replace(/^(\s*\n)+/, '');
      // Still trim the end as before
      processedStdout = processedStdout.trimEnd();
    }

    // For large output that was persisted to disk, build <persisted-output>
    // message for the model. The UI never sees this — it uses data.stdout.
    if (persistedOutputPath) {
      const preview = generatePreview(processedStdout, PREVIEW_SIZE_BYTES);
      processedStdout = buildLargeToolResultMessage({
        filepath: persistedOutputPath,
        originalSize: persistedOutputSize ?? 0,
        isJson: false,
        preview: preview.preview,
        hasMore: preview.hasMore,
        truncatedAtBytes: (persistedOutputSize ?? 0) >= MAX_PERSISTED_SIZE ? MAX_PERSISTED_SIZE : undefined,
      });
    }

    let errorMessage = stderr.trim();
    if (interrupted) {
      if (stderr) errorMessage += EOL;
      errorMessage += '<error>Command was aborted before completion</error>';
    }

    let backgroundInfo = '';
    if (backgroundTaskId) {
      backgroundInfo = formatBackgroundShellCopy({
        backgroundTaskId,
        outputPath: getTaskOutputPath(backgroundTaskId),
        backgroundedByUser,
        backgroundedToDeliverMessage,
        backgroundedByTurnAbort,
        reapedAtFinalResponse: backgroundEndsWithFinalResponse,
        timedOutAfterMs,
      });
      if (backgroundCwdHint) {
        backgroundInfo += `\n${backgroundCwdHint}`;
      }
      if (isBashTaskGetDeliveryEnabled()) {
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: formatBackgroundTaskResult(
            backgroundTaskId,
            [errorMessage, backgroundInfo].filter(Boolean).join('\n'),
            {
              backgroundedByUser,
              ending: backgroundTaskEnding(backgroundEndsWithFinalResponse === true),
            },
          ),
        };
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [processedStdout, errorMessage, backgroundInfo, formatBashEditDiffForToolResult(bashEditDiff)]
        .filter(Boolean)
        .join('\n'),
      is_error: interrupted,
    };
  },
  async call(
    input: BashToolInput,
    toolUseContext,
    _canUseTool?: CanUseToolFn,
    _parentMessage?: AssistantMessage,
    onProgress?: ToolCallProgress<BashProgress>,
  ) {
    const policyRefusal = getSandboxPolicyRefusal(shouldUseSandbox(input), input.command, false, 'bash');
    if (policyRefusal !== null) {
      throw new SandboxPolicyRefusalError(policyRefusal);
    }

    const { abortController, getAppState, setAppState, setToolJSX } = toolUseContext;
    const outputCleanup = createOutputFileCleanup({ get: id => getAppState().tasks[id] });

    const stdoutAccumulator = new EndTruncatingAccumulator();
    let stderrForShellReset = '';
    let sandboxViolationSuffix = '';
    let interpretationResult: ReturnType<typeof interpretCommandResult> | undefined;

    let progressCounter = 0;
    let wasInterrupted = false;
    let result: ExecResult;

    const isMainThread = !toolUseContext.agentId;
    const preventCwdChanges = !isMainThread;
    const permissionMode = getAppState().toolPermissionContext.mode;
    const captureEditDiff =
      isBashEditDiffEnabled(permissionMode) && !input.run_in_background && !input._simulatedSedEdit;
    const skipGitSwitch = captureEditDiff && isGitStateSwitchCommand(input.command);
    const editDiffSnapshot = captureEditDiff && !skipGitSwitch ? await takeBashEditDiffSnapshot(getCwd()) : null;
    const coordinatorWriteValidation = await validateCoordinatorBashWriteAccess(input.command, toolUseContext.agentId);
    if (!coordinatorWriteValidation.result) {
      return {
        data: {
          stdout: '',
          stderr: `${coordinatorWriteValidation.message}\nExit code 1`,
          interrupted: false,
        },
      };
    }

    let persistedOutputPath: string | undefined;
    let persistedOutputSize: number | undefined;
    let isImage = false;
    let compressedStdout = '';
    let strippedStdout = '';
    let stdout = '';
    try {
      try {
        // Use the new async generator version of runShellCommand
        const commandGenerator = runShellCommand({
          input,
          abortController,
          // Use the always-shared task channel so async agents' background
          // bash tasks are actually registered (and killable on agent exit).
          setAppState: toolUseContext.setAppStateForTasks ?? setAppState,
          getAppState,
          setToolJSX,
          preventCwdChanges,
          isMainThread,
          toolUseId: toolUseContext.toolUseId,
          agentId: toolUseContext.agentId,
          agentContext: (
            toolUseContext as {
              agentContext?: {
                isAsync?: boolean;
                isMainSession?: boolean;
                agentId?: string;
              };
            }
          ).agentContext,
          innerCall: toolUseContext.innerCall,
          // densable 2.1.217 VRu/ZRu — pin isolation worktree into shell gates
          agentWorktree: toolUseContext.agentWorktree,
        });

        // Consume the generator and capture the return value
        let generatorResult;
        do {
          generatorResult = await commandGenerator.next();
          if (!generatorResult.done && onProgress) {
            const progress = generatorResult.value;
            onProgress({
              toolUseID: `bash-progress-${progressCounter++}`,
              data: {
                type: 'bash_progress',
                output: progress.output,
                fullOutput: progress.fullOutput,
                elapsedTimeSeconds: progress.elapsedTimeSeconds,
                totalLines: progress.totalLines,
                totalBytes: progress.totalBytes,
                taskId: progress.taskId,
                timeoutMs: progress.timeoutMs,
              },
            });
          }
        } while (!generatorResult.done);

        // Get the final result from the generator's return value
        result = generatorResult.value;
        outputCleanup.track(result);

        trackGitOperations(input.command, result.code, result.stdout);

        const isInterrupt = result.interrupted && abortController.signal.reason === 'interrupt';

        // stderr is interleaved in stdout (merged fd) — result.stdout has both
        stdoutAccumulator.append((result.stdout || '').trimEnd() + EOL);

        // Interpret the command result using semantic rules
        interpretationResult = interpretCommandResult(input.command, result.code, result.stdout || '', '');

        // Check for git index.lock error (stderr is in stdout now)
        if (result.stdout && result.stdout.includes(".git/index.lock': File exists")) {
          logEvent('tengu_git_index_lock_error', {});
        }

        if (interpretationResult.isError && !isInterrupt) {
          // Only add exit code if it's actually an error
          if (result.code !== 0) {
            stdoutAccumulator.append(`Exit code ${result.code}`);
          }
        }

        if (!preventCwdChanges) {
          const appState = getAppState();
          if (resetCwdIfOutsideProject(appState.toolPermissionContext)) {
            stderrForShellReset = stdErrAppendShellResetMessage('');
          }
        }

        // Annotate output with sandbox violations if any (stderr is in stdout)
        const originalStdout = result.stdout || '';
        const outputWithSbFailures = SandboxManager.annotateStderrWithSandboxFailures(input.command, originalStdout);
        // densable 2.1.243 #35: keep the appended <sandbox_violations> on
        // success (exit 0) — error path already throws with the full annotate.
        sandboxViolationSuffix = extractSandboxViolationSuffix(originalStdout, outputWithSbFailures);

        if (result.preSpawnError) {
          throw new Error(result.preSpawnError);
        }
        if (interpretationResult.isError && !isInterrupt) {
          // stderr is merged into stdout (merged fd); outputWithSbFailures
          // already has the full output. Pass '' for stdout to avoid
          // duplication in getErrorParts() and processBashCommand.
          throw new ShellError('', outputWithSbFailures, result.code, result.interrupted);
        }
        wasInterrupted = result.interrupted;
      } finally {
        if (setToolJSX) setToolJSX(null);
      }

      // Get final string from accumulator
      stdout = stdoutAccumulator.toString();

      // Large output: the file on disk has more than getMaxOutputLength() bytes.
      // stdout already contains the first chunk (from getStdout()). Copy the
      // output file to the tool-results dir so the model can read it via
      // FileRead. If > 64 MB, truncate after copying.
      const persisted = await persistLargeOutputFile(result, outputCleanup);
      persistedOutputPath = persisted.persistedOutputPath;
      persistedOutputSize = persisted.persistedOutputSize;

      const commandType = input.command.split(' ')[0];

      logEvent('tengu_bash_tool_command_executed', {
        command_type: commandType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        stdout_length: stdout.length,
        stderr_length: 0,
        exit_code: result.code,
        interrupted: wasInterrupted,
      });

      // Log code indexing tool usage
      const codeIndexingTool = detectCodeIndexingFromCommand(input.command);
      if (codeIndexingTool) {
        logEvent('tengu_code_indexing_tool_used', {
          tool: codeIndexingTool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source: 'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          success: result.code === 0,
        });
      }

      strippedStdout = stripEmptyLines(stdout);

      // Claude Code hints protocol: CLIs/SDKs gated on CLAUDECODE=1 emit a
      // `<claude-code-hint />` tag to stderr (merged into stdout here). Scan,
      // record for useClaudeCodeHintRecommendation to surface, then strip
      // so the model never sees the tag — a zero-token side channel.
      // Stripping runs unconditionally (subagent output must stay clean too);
      // only the dialog recording is main-thread-only.
      const extracted = extractClaudeCodeHints(strippedStdout, input.command);
      strippedStdout = extracted.stripped;
      if (isMainThread && extracted.hints.length > 0) {
        for (const hint of extracted.hints) maybeRecordPluginHint(hint);
      }

      isImage = isImageOutput(strippedStdout);

      // Cap image dimensions + size if present (CC-304 — see
      // resizeShellImageOutput). Scope the decoded buffer so it can be reclaimed
      // before we build the output Out object.
      compressedStdout = strippedStdout;
      if (isImage) {
        const resized = await resizeShellImageOutput(strippedStdout, result.outputFilePath, persistedOutputSize);
        if (resized) {
          compressedStdout = resized;
        } else {
          // Parse failed or file too large (e.g. exceeds MAX_IMAGE_FILE_SIZE).
          // Keep isImage in sync with what we actually send so the UI label stays
          // accurate — mapToolResultToToolResultBlockParam's defensive
          // fallthrough will send text, not an image block.
          isImage = false;
        }
      }
    } finally {
      await outputCleanup.dispose();
    }

    const backgroundEndsWithFinalResponse = backgroundShellReapedAtFinalResponse(
      result.backgroundTaskId,
      getAgentContext(),
    )
      ? (true as const)
      : undefined;
    const backgroundCwdHint =
      result.backgroundTaskId && commandHasAnyCd(input.command)
        ? `Session cwd remains ${getCwd()}; directory changes made by the backgrounded command do not apply to subsequent commands.`
        : undefined;
    if (!result.backgroundTaskId && !wasInterrupted) {
      await trackBashSingleFileReads(
        input.command,
        toolUseContext.readFileState,
        toolUseContext.abortController.signal,
        result.code,
        persistedOutputPath !== undefined || isImage ? undefined : compressedStdout,
        toolUseContext.nestedMemoryAttachmentTriggers
          ? {
              triggers: toolUseContext.nestedMemoryAttachmentTriggers,
              permissions: () => toolUseContext.getAppState().toolPermissionContext,
            }
          : undefined,
      );
    }

    const data: Out = {
      stdout: compressedStdout,
      stderr: mergeBashStderr(stderrForShellReset, sandboxViolationSuffix, EOL),
      interrupted: wasInterrupted,
      isImage,
      returnCodeInterpretation: interpretationResult?.message,
      noOutputExpected: isSilentBashCommand(input.command),
      backgroundTaskId: result.backgroundTaskId,
      backgroundedByUser: result.backgroundedByUser,
      assistantAutoBackgrounded: result.assistantAutoBackgrounded,
      backgroundedToDeliverMessage: result.backgroundedToDeliverMessage,
      backgroundedByTurnAbort: result.backgroundedByTurnAbort,
      timedOutAfterMs: result.timedOutAfterMs,
      backgroundEndsWithFinalResponse,
      backgroundCwdHint,
      dangerouslyDisableSandbox:
        'dangerouslyDisableSandbox' in input ? (input.dangerouslyDisableSandbox as boolean | undefined) : undefined,
      persistedOutputPath,
      persistedOutputSize,
      bashEditDiff: skipGitSwitch
        ? { files: [], moreFiles: 0, skipped: true }
        : editDiffSnapshot === 'unavailable'
          ? { files: [], moreFiles: 0, unavailable: true }
          : editDiffSnapshot && !wasInterrupted && !result.backgroundTaskId
            ? await diffBashEditDiffSnapshot(editDiffSnapshot)
            : undefined,
    };

    return {
      data,
    };
  },
  renderToolUseErrorMessage,
  isResultTruncated(output: Out): boolean {
    return isOutputLineTruncated(output.stdout) || isOutputLineTruncated(output.stderr);
  },
} satisfies ToolDef<InputSchema, Out, BashProgress>);

async function* runShellCommand({
  input,
  abortController,
  setAppState,
  getAppState,
  setToolJSX,
  preventCwdChanges,
  isMainThread,
  toolUseId,
  agentId,
  agentContext,
  innerCall,
  agentWorktree,
}: {
  input: BashToolInput;
  abortController: AbortController;
  setAppState: (f: (prev: AppState) => AppState) => void;
  getAppState: () => AppState;
  setToolJSX?: SetToolJSXFn;
  preventCwdChanges?: boolean;
  isMainThread?: boolean;
  toolUseId?: string;
  agentId?: AgentId;
  agentContext?: {
    isAsync?: boolean;
    isMainSession?: boolean;
    agentId?: string;
  };
  innerCall?: boolean;
  /** densable agentWorktree for VRu/ZRu shell isolation gates. */
  agentWorktree?: string;
}): AsyncGenerator<
  {
    type: 'progress';
    output: string;
    fullOutput: string;
    elapsedTimeSeconds: number;
    totalLines: number;
    totalBytes?: number;
    taskId?: string;
    timeoutMs?: number;
  },
  ExecResult,
  void
> {
  const { command, description, timeout, run_in_background } = input;
  // Official IDr + pSo (#1672): main agent clamps via env; async subagents cap at 180s across all providers.
  const shouldAutoBackground = !isBackgroundTasksDisabled && isAutobackgroundingAllowed(command);
  const baseTimeoutMs = Math.min(timeout || getDefaultTimeoutMs(), getMaxTimeoutMs());
  const subagentCapMs = resolveSubagentAutoBackgroundCapMs({
    agentId,
    agentContext,
    innerCall,
  });
  const timeoutMs =
    clampTimeoutForAutoBackground({
      requestedTimeoutMs: baseTimeoutMs,
      isMainAgent: isMainThread === true,
      canAutoBackground: shouldAutoBackground,
      subagentCapMs,
    }) ?? baseTimeoutMs;

  let fullOutput = '';
  let lastProgressOutput = '';
  let lastTotalLines = 0;
  let lastTotalBytes = 0;
  let backgroundShellId: string | undefined;
  let assistantAutoBackgrounded = false;
  let timedOutAfterMs: number | undefined;

  // Progress signal: resolved by onProgress callback from the shared poller,
  // waking the generator to yield a progress update.
  let resolveProgress: (() => void) | null = null;
  function createProgressSignal(): Promise<null> {
    return new Promise<null>(resolve => {
      resolveProgress = () => resolve(null);
    });
  }

  const shellCommand = await exec(command, abortController.signal, 'bash', {
    timeout: timeoutMs,
    onProgress(lastLines, allLines, totalLines, totalBytes, isIncomplete) {
      lastProgressOutput = lastLines;
      fullOutput = allLines;
      lastTotalLines = totalLines;
      lastTotalBytes = isIncomplete ? totalBytes : 0;
      // Wake the generator so it yields the new progress data
      const resolve = resolveProgress;
      if (resolve) {
        resolveProgress = null;
        resolve();
      }
    },
    preventCwdChanges,
    shouldUseSandbox: shouldUseSandbox(input),
    shouldAutoBackground,
    // densable VRu — block shell when cwd is outside agent isolation worktree
    agentWorktree,
    // densable 2.1.233 #3 useToolMemoryCgroup:!0
    useToolMemoryCgroup: true,
  });

  // Start the command execution
  const resultPromise = shellCommand.result;

  // Helper to spawn a background task and return its ID
  async function spawnBackgroundTask(): Promise<string> {
    const handle = await spawnShellTask(
      {
        command,
        description: description || command,
        shellCommand,
        toolUseId,
        agentId,
        innerCall,
        timeout: timeoutMs,
      },
      {
        abortController,
        getAppState,
        setAppState,
      },
    );
    return handle.taskId;
  }

  // Helper to start backgrounding with optional logging
  function startBackgrounding(eventName: string, backgroundFn?: (shellId: string) => void): void {
    // If a foreground task is already registered (via registerForeground in the
    // progress loop), background it in-place instead of re-spawning. Re-spawning
    // would overwrite tasks[taskId], emit a duplicate task_started SDK event,
    // and leak the first cleanup callback.
    if (foregroundTaskId) {
      if (
        !backgroundExistingForegroundTask(
          foregroundTaskId,
          shellCommand,
          description || command,
          setAppState,
          toolUseId,
          getAppState,
        )
      ) {
        return;
      }
      backgroundShellId = foregroundTaskId;
      logEvent(eventName, {
        command_type: getCommandTypeForLogging(command),
      });
      backgroundFn?.(foregroundTaskId);
      return;
    }

    // No foreground task registered — spawn a new background task
    // Note: spawn is essentially synchronous despite being async
    void spawnBackgroundTask().then(shellId => {
      backgroundShellId = shellId;

      // Wake the generator's Promise.race so it sees backgroundShellId.
      // Without this, if the poller has stopped ticking for this task
      // (no output + shared-poller race with sibling stopPolling calls)
      // and the process is hung on I/O, the race at line ~1357 never
      // resolves and the generator deadlocks despite being backgrounded.
      const resolve = resolveProgress;
      if (resolve) {
        resolveProgress = null;
        resolve();
      }

      logEvent(eventName, {
        command_type: getCommandTypeForLogging(command),
      });

      if (backgroundFn) {
        backgroundFn(shellId);
      }
    });
  }

  // Set up auto-backgrounding on timeout if enabled
  // Only background commands that are allowed to be auto-backgrounded (not sleep, etc.)
  if (shellCommand.onTimeout && shouldAutoBackground) {
    shellCommand.onTimeout(backgroundFn => {
      timedOutAfterMs = timeoutMs;
      startBackgrounding('tengu_bash_command_timeout_backgrounded', backgroundFn);
    });
  }

  // In assistant mode, the main agent should stay responsive. Auto-background
  // blocking commands after ASSISTANT_BLOCKING_BUDGET_MS so the agent can keep
  // coordinating instead of waiting. The command keeps running — no state loss.
  if (
    feature('KAIROS') &&
    getKairosActive() &&
    isMainThread &&
    !isBackgroundTasksDisabled &&
    run_in_background !== true
  ) {
    setTimeout(() => {
      if (shellCommand.status === 'running' && backgroundShellId === undefined) {
        assistantAutoBackgrounded = true;
        timedOutAfterMs = ASSISTANT_BLOCKING_BUDGET_MS;
        startBackgrounding('tengu_bash_command_assistant_auto_backgrounded');
      }
    }, ASSISTANT_BLOCKING_BUDGET_MS).unref();
  }

  // Handle Claude asking to run it in the background explicitly
  // When explicitly requested via run_in_background, always honor the request
  // regardless of the command type (isAutobackgroundingAllowed only applies to automatic backgrounding)
  // Skip if background tasks are disabled - run in foreground instead
  if (run_in_background === true && !isBackgroundTasksDisabled) {
    const shellId = await spawnBackgroundTask();

    logEvent('tengu_bash_command_explicitly_backgrounded', {
      command_type: getCommandTypeForLogging(command),
    });

    return {
      stdout: '',
      stderr: '',
      code: 0,
      interrupted: false,
      backgroundTaskId: shellId,
    };
  }

  // Wait for the initial threshold before showing progress
  const startTime = Date.now();
  let foregroundTaskId: string | undefined;
  let interruptBackgroundingStarted = false;
  let wakeInitialWait: (() => void) | null = null;
  const isTurnInterrupt = () => abortController.signal.aborted && isInterruptAbortReason(abortController.signal.reason);
  const onAbort = () => {
    if (!isTurnInterrupt()) return;
    wakeInitialWait?.();
    const resolve = resolveProgress;
    if (resolve) {
      resolveProgress = null;
      resolve();
    }
  };
  abortController.signal.addEventListener('abort', onAbort);

  try {
    {
      const initialResult = await Promise.race([
        resultPromise,
        new Promise<null>(resolve => {
          const t = setTimeout((r: (v: null) => void) => r(null), PROGRESS_THRESHOLD_MS, resolve);
          t.unref();
        }),
        new Promise<null>(resolve => {
          if (isTurnInterrupt()) {
            resolve(null);
          } else {
            wakeInitialWait = () => resolve(null);
          }
        }),
      ]);
      wakeInitialWait = null;

      if (initialResult !== null) {
        shellCommand.cleanup();
        return initialResult;
      }

      if (backgroundShellId) {
        return {
          stdout: timedOutAfterMs !== undefined ? fullOutput : '',
          stderr: '',
          code: 0,
          interrupted: false,
          backgroundTaskId: backgroundShellId,
          backgroundedByTurnAbort: isBackgroundedByTurnAbort(getAppState().tasks[backgroundShellId]),
          assistantAutoBackgrounded,
          timedOutAfterMs,
          ...(isBackgroundedToDeliverMessage(getAppState().tasks[backgroundShellId])
            ? { backgroundedToDeliverMessage: true }
            : {}),
        };
      }
    }

    // Start polling the output file for progress. The poller's #tick calls
    // onProgress every second, which resolves progressSignal below.
    TaskOutput.startPolling(shellCommand.taskOutput.taskId);

    // Progress loop: wake is driven by the shared poller calling onProgress,
    // which resolves the progressSignal (or immediately on turn interrupt).
    try {
      while (true) {
        const progressSignal =
          !interruptBackgroundingStarted && isTurnInterrupt() ? Promise.resolve(null) : createProgressSignal();
        const result = await Promise.race([resultPromise, progressSignal]);

        if (result !== null) {
          // Race: backgrounding fired (15s timer / onTimeout / Ctrl+B) but the
          // command completed before the next poll tick. #handleExit sets
          // backgroundTaskId but skips outputFilePath (it assumes the background
          // message or <task_notification> will carry the path). Strip
          // backgroundTaskId so the model sees a clean completed command,
          // reconstruct outputFilePath for large outputs, and suppress the
          // redundant <task_notification> from the .then() handler.
          // Check result.backgroundTaskId (not the closure var) to also cover
          // Ctrl+B, which calls shellCommand.background() directly.
          if (result.backgroundTaskId !== undefined) {
            markTaskNotified(result.backgroundTaskId, setAppState);
            const fixedResult: ExecResult = {
              ...result,
              backgroundTaskId: undefined,
            };
            // Mirror ShellCommand.#handleExit's large-output branch that was
            // skipped because #backgroundTaskId was set.
            const { taskOutput } = shellCommand;
            if (taskOutput.stdoutToFile && !taskOutput.outputFileRedundant) {
              fixedResult.outputFilePath = taskOutput.path;
              fixedResult.outputFileSize = taskOutput.outputFileSize;
              fixedResult.outputTaskId = taskOutput.taskId;
            }
            shellCommand.cleanup();
            return fixedResult;
          }
          // Command has completed - return the actual result
          // If we registered as a foreground task, unregister it
          if (foregroundTaskId) {
            unregisterForeground(foregroundTaskId, setAppState);
          }
          // Clean up stream resources for foreground commands
          // (backgrounded commands are cleaned up by LocalShellTask)
          shellCommand.cleanup();
          // Official 2.1.309 #1163 (`P6o` @289027877): diagnose disk-full on failed
          // foreground commands that spilled stdout to a temp output file.
          let finalResult = result;
          if (shellCommand.taskOutput.stdoutToFile && result.code !== 0 && !result.interrupted) {
            const { diagnoseDiskFullOnCommandFailure } = await import('./utils.js');
            const diskNote = await diagnoseDiskFullOnCommandFailure(
              shellCommand.taskOutput.path,
              result.stdout === '',
            ).catch(() => null);
            if (diskNote) {
              finalResult = {
                ...result,
                stdout: result.stdout ? `${diskNote}\n${result.stdout}` : diskNote,
              };
            }
          }
          return finalResult;
        }

        // Check if command was backgrounded (either via old mechanism or new backgroundAll)
        if (backgroundShellId) {
          return {
            stdout: interruptBackgroundingStarted || timedOutAfterMs !== undefined ? fullOutput : '',
            stderr: '',
            code: 0,
            interrupted: false,
            backgroundTaskId: backgroundShellId,
            backgroundedByTurnAbort:
              interruptBackgroundingStarted || isBackgroundedByTurnAbort(getAppState().tasks[backgroundShellId]),
            assistantAutoBackgrounded,
            timedOutAfterMs,
            ...(isBackgroundedToDeliverMessage(getAppState().tasks[backgroundShellId])
              ? { backgroundedToDeliverMessage: true }
              : {}),
          };
        }

        // User submitted a new message - background instead of killing (densable QEr @191286300)
        if (!interruptBackgroundingStarted && isTurnInterrupt()) {
          interruptBackgroundingStarted = true;
          if (!isBackgroundTasksDisabled) {
            startBackgrounding('tengu_bash_command_interrupt_backgrounded');
            if (backgroundShellId) {
              return {
                stdout: fullOutput,
                stderr: '',
                code: 0,
                interrupted: false,
                backgroundTaskId: backgroundShellId,
                backgroundedByTurnAbort: true,
                assistantAutoBackgrounded,
                timedOutAfterMs,
              };
            }
            continue;
          }
          if (shellCommand.status === 'running') {
            shellCommand.kill();
          }
          continue;
        }

        // Check if this foreground task was backgrounded via backgroundAll()
        if (foregroundTaskId) {
          // shellCommand.status becomes 'backgrounded' when background() is called
          if (shellCommand.status === 'backgrounded') {
            return {
              stdout: timedOutAfterMs !== undefined ? fullOutput : '',
              stderr: '',
              code: 0,
              interrupted: false,
              backgroundTaskId: foregroundTaskId,
              timedOutAfterMs,
              ...(isBackgroundedToDeliverMessage(getAppState().tasks[foregroundTaskId])
                ? { backgroundedToDeliverMessage: true }
                : isBackgroundedByTurnAbort(getAppState().tasks[foregroundTaskId])
                  ? { backgroundedByTurnAbort: true }
                  : { backgroundedByUser: true }),
            };
          }
        }

        // Time for a progress update
        const elapsed = Date.now() - startTime;
        const elapsedSeconds = Math.floor(elapsed / 1000);

        // Register foreground task & show minimal backgrounding UI if available (skip if disabled)
        if (
          !isBackgroundTasksDisabled &&
          !interruptBackgroundingStarted &&
          backgroundShellId === undefined &&
          elapsedSeconds >= PROGRESS_THRESHOLD_MS / 1000
        ) {
          // Register this command as a foreground task so it can be backgrounded via Ctrl+B / detach
          if (!foregroundTaskId) {
            foregroundTaskId = registerForeground(
              {
                command,
                description: description || command,
                shellCommand,
                agentId,
                innerCall,
              },
              setAppState,
              toolUseId,
              getAppState,
            );
          }

          if (setToolJSX) {
            setToolJSX({
              jsx: <BackgroundHint toolUseId={toolUseId} />,
              shouldHidePromptInput: false,
              shouldContinueAnimation: true,
              showSpinner: true,
            });
          }
        }
        yield {
          type: 'progress',
          fullOutput,
          output: lastProgressOutput,
          elapsedTimeSeconds: elapsedSeconds,
          totalLines: lastTotalLines,
          totalBytes: lastTotalBytes,
          taskId: shellCommand.taskOutput.taskId,
          ...(timeout ? { timeoutMs } : undefined),
        };
      }
    } finally {
      TaskOutput.stopPolling(shellCommand.taskOutput.taskId);
      if (!backgroundShellId && shellCommand.status !== 'backgrounded') {
        if (foregroundTaskId) {
          unregisterForeground(foregroundTaskId, setAppState);
        }
        shellCommand.cleanup();
      }
    }
  } finally {
    abortController.signal.removeEventListener('abort', onAbort);
  }
}
