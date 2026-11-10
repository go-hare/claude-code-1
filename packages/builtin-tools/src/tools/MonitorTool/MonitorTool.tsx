import React from 'react';
import { Text } from '@anthropic/ink';
import { z } from 'zod/v4';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { TOOL_SUMMARY_MAX_LENGTH } from 'src/constants/toolLimits.js';
import type { ToolResultBlockParam, ToolUseContext, ValidationResult } from 'src/Tool.js';
import { buildTool } from 'src/Tool.js';
import { spawnShellTask } from 'src/tasks/LocalShellTask/LocalShellTask.js';
import { bashToolHasPermission } from '../BashTool/bashPermissions.js';
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js';
import { lazySchema } from 'src/utils/lazySchema.js';
import { truncate } from 'src/utils/format.js';
import { exec } from 'src/utils/Shell.js';
import { getTaskOutputPath } from 'src/utils/task/diskOutput.js';
import { logEvent } from 'src/services/analytics/index.js';
import { CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG, hasNoHiddenControlChars } from 'src/utils/controlChars.js';

const MONITOR_TOOL_NAME = 'Monitor';
const DEFAULT_MONITOR_TIMEOUT_MS = 300_000;
const MAX_MONITOR_TIMEOUT_MS = 3_600_000;

const inputSchema = lazySchema(() =>
  z.strictObject({
    // densable 2.1.223 #5 — same eHe/xRd schema gate as Bash/PowerShell so
    // hidden C0/C1 cannot slip into the Monitor permission dialog.
    command: z
      .string()
      .refine(hasNoHiddenControlChars, CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG)
      .describe(
        'The shell command to run as a long-running monitor. Should produce streaming output (e.g., tail -f, watch, polling loops).',
      ),
    description: z
      .string()
      .describe(
        'Clear, concise description of what this monitor watches. Used as the label in the background tasks UI.',
      ),
    timeout_ms: z
      .number()
      .min(1000)
      .max(MAX_MONITOR_TIMEOUT_MS, `timeout_ms must be ≤ ${MAX_MONITOR_TIMEOUT_MS}`)
      .optional()
      .default(DEFAULT_MONITOR_TIMEOUT_MS)
      .describe(
        `Kill the monitor after this deadline. Default ${DEFAULT_MONITOR_TIMEOUT_MS}ms, max ${MAX_MONITOR_TIMEOUT_MS}ms. Ignored when persistent is true.`,
      ),
    persistent: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Run for the lifetime of the session (no timeout). Use for session-length watches like PR monitoring or log tails. Stop with TaskStop.',
      ),
  }),
);
type InputSchema = ReturnType<typeof inputSchema>;
export type MonitorInput = z.infer<InputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    taskId: z.string(),
    timeoutMs: z.number().optional(),
    persistent: z.boolean().optional(),
    outputFile: z.string().optional(),
  }),
);
type OutputSchema = ReturnType<typeof outputSchema>;
export type MonitorOutput = z.infer<OutputSchema>;

export const MonitorTool = buildTool({
  name: MONITOR_TOOL_NAME,
  searchHint: 'start long-running background monitor for streaming events',
  // densable 2.1.248 #1 Unt — official enablesCodeExecution:!0 @189896058
  enablesCodeExecution: true,
  backgrounding: 'never',
  maxResultSizeChars: 10_000,
  shouldDefer: true,
  strict: true,

  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },

  async description() {
    return 'Start a long-running background monitor';
  },
  async prompt() {
    return `Use Monitor to start a long-running background process that streams output (watching logs, polling APIs, tailing files, etc.). The command runs in the background and you receive a notification when it exits. Use the Read tool with the output file path to check its output at any time.

Guidelines:
- Use Monitor for commands that produce ongoing streaming output: \`tail -f\`, log watchers, file watchers, API polling loops, \`watch\` commands
- Do NOT use Monitor for one-shot commands that finish quickly — use Bash for those
- Do NOT use Monitor for commands that need interactive input — they will hang
- The description should clearly explain what is being monitored
- You'll get a task notification when the monitor process exits (stream ends, script fails, or killed)
- To check output at any time, use Read on the output file path returned by this tool

Examples:
- Watching a log file: command="tail -f /var/log/app.log", description="Watch app log for errors"
- Polling an API: command="while true; do curl -s http://localhost:3000/health; sleep 5; done", description="Poll health endpoint every 5s"
- Watching for file changes: command="inotifywait -m -r ./src", description="Watch src directory for file changes"`;
  },

  isConcurrencySafe() {
    return true;
  },

  isReadOnly() {
    // Monitor executes shell commands which may have side effects
    return false;
  },

  toAutoClassifierInput(input: MonitorInput) {
    return `Monitor: ${input.command}`;
  },

  async checkPermissions(input: MonitorInput, context: ToolUseContext): Promise<PermissionResult> {
    // Reuse bash permission checking for the underlying command
    return bashToolHasPermission({ command: input.command }, context);
  },

  userFacingName() {
    return MONITOR_TOOL_NAME;
  },

  getToolUseSummary(input: Partial<MonitorInput> | undefined) {
    if (!input?.description) {
      return null;
    }
    return truncate(input.description, TOOL_SUMMARY_MAX_LENGTH);
  },

  getActivityDescription(input: Partial<MonitorInput> | undefined) {
    return input?.description ? `Monitoring: ${input.description}` : 'Monitoring';
  },

  async validateInput(input: MonitorInput): Promise<ValidationResult> {
    if (!input.command || input.command.trim() === '') {
      return {
        result: false,
        message: 'Monitor command cannot be empty.',
        errorCode: 1,
      };
    }
    if (!input.description || input.description.trim() === '') {
      return {
        result: false,
        message: 'Monitor description cannot be empty.',
        errorCode: 2,
      };
    }
    return { result: true };
  },

  async call(input: MonitorInput, context: ToolUseContext) {
    const { command, description, timeout_ms = DEFAULT_MONITOR_TIMEOUT_MS, persistent = false } = input;
    const { abortController, setAppState, toolUseId, agentId } = context;

    logEvent('tengu_monitor_tool_used', {});

    // Create the shell command via exec
    const shellCommand = await exec(command, abortController.signal, 'bash');

    // Spawn as a background task with kind: 'monitor'
    const handle = await spawnShellTask(
      {
        command,
        description,
        shellCommand,
        toolUseId: toolUseId,
        agentId,
        kind: 'monitor',
      },
      {
        abortController,
        getAppState: context.getAppState,
        setAppState,
      },
    );

    const outputFile = getTaskOutputPath(handle.taskId);

    return {
      data: {
        taskId: handle.taskId,
        timeoutMs: persistent ? 0 : timeout_ms,
        persistent,
        outputFile,
      },
    };
  },

  renderToolUseMessage(input: Partial<MonitorInput>) {
    return input.description || null;
  },

  mapToolResultToToolResultBlockParam(content: MonitorOutput, toolUseId: string): ToolResultBlockParam {
    return {
      tool_use_id: toolUseId,
      type: 'tool_result',
      content: `Monitor started (task ${content.taskId}). Output file: ${content.outputFile}`,
    };
  },

  renderToolResultMessage(output: MonitorOutput) {
    const timeoutMs = output.timeoutMs ?? DEFAULT_MONITOR_TIMEOUT_MS;
    return (
      <MessageResponse>
        <Text>
          Monitor started{' '}
          <Text dimColor>
            {'· task '}
            {output.taskId}
            {' · '}
            {output.persistent ? 'persistent' : `timeout ${timeoutMs / 1000}s`}
          </Text>
        </Text>
      </MessageResponse>
    );
  },
});
