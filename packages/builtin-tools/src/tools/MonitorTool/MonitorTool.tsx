import { feature } from 'bun:bundle';
import React from 'react';
import { Text } from '@anthropic/ink';
import { z } from 'zod/v4';
import { TOOL_SUMMARY_MAX_LENGTH } from 'src/constants/toolLimits.js';
import type { ToolResultBlockParam, ToolUseContext, ValidationResult } from 'src/Tool.js';
import { buildTool } from 'src/Tool.js';
import { spawnShellTask } from 'src/tasks/LocalShellTask/LocalShellTask.js';
import { killTask } from 'src/tasks/LocalShellTask/killShellTasks.js';
import {
  createMonitorEventSink,
  enqueueMonitorEventNotification,
} from 'src/tasks/LocalShellTask/monitorEventNotify.js';
import { bashToolHasPermission } from '../BashTool/bashPermissions.js';
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js';
import { lazySchema } from 'src/utils/lazySchema.js';
import { truncate } from 'src/utils/format.js';
import { exec } from 'src/utils/Shell.js';
import { getTaskOutputPath } from 'src/utils/task/diskOutput.js';
import { logEvent } from 'src/services/analytics/index.js';

const MONITOR_TOOL_NAME = 'Monitor';

/** densable V5u — default monitor timeout (5 min). */
export const MONITOR_DEFAULT_TIMEOUT_MS = 300_000;
/** densable Rss — max timeout_ms when not persistent (1 hour). */
export const MONITOR_MAX_TIMEOUT_MS = 3_600_000;

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z
      .string()
      .describe(
        'The shell command to run as a long-running monitor. Should produce streaming output (e.g., tail -f, watch, polling loops). Each stdout line is an event; exit ends the watch.',
      ),
    description: z
      .string()
      .describe('Short human-readable description of what you are monitoring (shown in notifications).'),
    // densable NVg: timeout_ms min 1000 optional default V5u; persistent optional default false
    timeout_ms: z
      .number()
      .min(1000)
      .optional()
      .default(MONITOR_DEFAULT_TIMEOUT_MS)
      .describe(
        `Kill the monitor after this deadline. Default ${MONITOR_DEFAULT_TIMEOUT_MS}ms, max ${MONITOR_MAX_TIMEOUT_MS}ms. Ignored when persistent is true.`,
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
    outputFile: z.string(),
    /** densable jVg: timeoutMs:i?0:o */
    timeoutMs: z.number(),
    persistent: z.boolean(),
  }),
);
type OutputSchema = ReturnType<typeof outputSchema>;
export type MonitorOutput = z.infer<OutputSchema>;

/**
 * densable $Vg — persistent OR timeout_ms <= Rss.
 */
export function isValidMonitorTimeout(input: { persistent?: boolean; timeout_ms?: number }): boolean {
  if (input.persistent) return true;
  const ms = input.timeout_ms ?? MONITOR_DEFAULT_TIMEOUT_MS;
  return ms <= MONITOR_MAX_TIMEOUT_MS;
}

export const MonitorTool = buildTool({
  name: MONITOR_TOOL_NAME,
  searchHint: 'start long-running background monitor for streaming events',
  maxResultSizeChars: 10_000,
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
    return `Use Monitor to start a long-running background process that streams output (watching logs, polling APIs, tailing files, etc.). The command runs in the background. Streaming output is rate-limited into "Monitor event" task notifications; you also receive a notification when the process exits. Use the Read tool with the output file path to check full output at any time.

Guidelines:
- Use Monitor for commands that produce ongoing streaming output: \`tail -f\`, log watchers, file watchers, API polling loops, \`watch\` commands
- Do NOT use Monitor for one-shot commands that finish quickly — use Bash for those
- Do NOT use Monitor for commands that need interactive input — they will hang
- The description should clearly explain what is being monitored
- You'll get mid-stream "Monitor event" notifications (rate-limited) and a final notification when the process exits
- High-rate output is suppressed and may auto-stop the monitor — prefer selective filters
- Default timeout is ${MONITOR_DEFAULT_TIMEOUT_MS}ms (max ${MONITOR_MAX_TIMEOUT_MS}ms). Set persistent=true for session-length watches; stop with TaskStop
- To check output at any time, use Read on the output file path returned by this tool

Examples:
- Watching a log file: command="tail -f /var/log/app.log", description="Watch app log for errors"
- Polling an API: command="while true; do curl -s http://localhost:3000/health; sleep 5; done", description="Poll health endpoint every 5s"
- Watching for file changes: command="inotifywait -m -r ./src", description="Watch src directory for file changes"`;
  },

  // densable isEnabled: Pte() && up(). Residual also keeps MONITOR_TOOL feature
  // as a ship gate so builds without live GB still expose Monitor.
  isEnabled() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const {
        isAmberSentinelEnabled,
        isMonitorPlatformSupported,
      } = require('src/utils/amberSentinelGate.js') as typeof import('src/utils/amberSentinelGate.js');
      let pte = isAmberSentinelEnabled();
      // feature() only in if/ternary (bun:bundle compile constraint)
      if (feature('MONITOR_TOOL')) pte = true;
      return pte && isMonitorPlatformSupported();
    } catch {
      if (feature('MONITOR_TOOL')) return true;
      return false;
    }
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

  getActivityDescription(input: MonitorInput) {
    if (!input?.description) {
      return 'Starting monitor';
    }
    return `Monitoring: ${truncate(input.description, TOOL_SUMMARY_MAX_LENGTH)}`;
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
    // densable $Vg
    if (!isValidMonitorTimeout(input)) {
      return {
        result: false,
        message: `Monitor timeout_ms must be <= ${MONITOR_MAX_TIMEOUT_MS}ms unless persistent is true.`,
        errorCode: 3,
      };
    }
    return { result: true };
  },

  async call(input: MonitorInput, context: ToolUseContext) {
    const { command, description } = input;
    const persistent = input.persistent === true;
    const timeoutMs = persistent ? 0 : (input.timeout_ms ?? MONITOR_DEFAULT_TIMEOUT_MS);
    const { abortController, setAppState, toolUseId, agentId } = context;

    logEvent('tengu_monitor_tool_used', {});

    // densable jVg: Aio({description, agentId, taskRef, killTask}) → onStdout:d.onData
    // Mutable taskRef filled after spawnShellTask so Nre can stamp <task-id>.
    const taskRef: { id?: string } = {};
    const eventSink = createMonitorEventSink({
      description,
      agentId,
      taskRef,
      killTask: () => {
        if (taskRef.id) killTask(taskRef.id, setAppState);
      },
    });

    // Pipe-mode exec so stdout chunks reach Aio (file-mode has no onStdout path).
    const shellCommand = await exec(command, abortController.signal, 'bash', {
      onStdout: eventSink.onData,
    });

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

    taskRef.id = handle.taskId;

    // densable jVg: if !persistent, setTimeout → Nre timed out + jLe
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (!persistent && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (eventSink.isKilled()) return;
        const id = taskRef.id;
        if (!id) return;
        enqueueMonitorEventNotification(description, '[Monitor timed out \u2014 re-arm if needed.]', id, {
          isHousekeeping: true,
          agentId,
        });
        killTask(id, setAppState);
      }, timeoutMs);
      timeoutId.unref?.();
    }

    // densable: on exit clear timeout, flush line batcher, detach monitor KA via kill paths
    void shellCommand.result.then(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      eventSink.finish();
    });

    const outputFile = getTaskOutputPath(handle.taskId);

    return {
      data: {
        taskId: handle.taskId,
        outputFile,
        timeoutMs,
        persistent,
      },
    };
  },

  renderToolUseMessage(input: MonitorInput, { verbose }) {
    const desc = truncate(input.description || input.command, 80);
    return `Monitor: ${desc}`;
  },

  mapToolResultToToolResultBlockParam(content: MonitorOutput, toolUseId: string): ToolResultBlockParam {
    const timeoutNote = content.persistent ? 'persistent (no timeout)' : `timeout ${content.timeoutMs}ms`;
    return {
      tool_use_id: toolUseId,
      type: 'tool_result',
      content: `Monitor started (task ${content.taskId}, ${timeoutNote}). Output file: ${content.outputFile}`,
    };
  },

  renderToolResultMessage(output: MonitorOutput) {
    const timeoutNote = output.persistent ? 'persistent' : `timeout ${output.timeoutMs}ms`;
    return (
      <Text>
        Monitor started (task {output.taskId}, {timeoutNote}). Output: {output.outputFile}
      </Text>
    );
  },
});
