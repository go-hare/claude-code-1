import { feature } from 'bun:bundle';
import React from 'react';
import { Text } from '@anthropic/ink';
import { z } from 'zod/v4';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { TOOL_SUMMARY_MAX_LENGTH } from 'src/constants/toolLimits.js';
import type {
  ToolCallContext,
  ToolDef,
  ToolDeps,
  ToolResultBlockParam,
  ToolUseContext,
  ValidationResult,
} from 'src/Tool.js';
import { buildTool, resolveToolUseContext } from 'src/Tool.js';
import { spawnShellTask } from 'src/tasks/LocalShellTask/LocalShellTask.js';
import { killTask } from 'src/tasks/LocalShellTask/killShellTasks.js';
import { addKeepaliveReason, monitorKeepaliveReason, removeKeepaliveReason } from 'src/utils/task/framework.js';
import { isBackgroundTasksDisabled } from 'src/utils/residualFinalEnvGates.js';
import { createTaskRegistry } from 'src/utils/taskRegistry.js';
import { bashToolHasPermission } from '../BashTool/bashPermissions.js';
import { BashTool } from '../BashTool/BashTool.js';
import { BASH_TOOL_NAME } from '../BashTool/toolName.js';
import {
  clearSandboxStateAtCheck,
  getSandboxPolicyRefusal,
  KEPT_IN_SANDBOX_SINCE_CHECK_NOTE,
  recordSandboxStateAtCheck,
  SANDBOX_GONE_SINCE_CHECK_MESSAGE,
  SandboxPolicyRefusalError,
  shouldKeepRewrittenCommandInSandbox,
  shouldUseSandbox,
} from '../BashTool/shouldUseSandbox.js';
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js';
import { getAskRules, getDenyRules } from 'src/utils/permissions/permissions.js';
import type { PermissionRule } from 'src/utils/permissions/PermissionRule.js';
import type { ToolPermissionContext } from 'src/Tool.js';
import { lazySchema } from 'src/utils/lazySchema.js';
import { formatDuration, truncate } from 'src/utils/format.js';
import { getAgentContext } from 'src/utils/agentContext.js';
import { isAgentStopPending } from 'src/utils/agentStopBag.js';
import type { AgentId } from 'src/types/ids.js';
import { exec } from 'src/utils/Shell.js';
import { logEvent } from 'src/services/analytics/index.js';
import { CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG, hasNoHiddenControlChars } from 'src/utils/controlChars.js';
import {
  clampMonitorSpawn,
  createMonitorStreamPump,
  isMonitorTimeoutBounded,
  monitorBoundedTimeoutCap,
  monitorExpiredEvent,
  notifyMonitorStreamEvent,
  type MonitorStreamPump,
} from 'src/utils/monitorStreamNotify.js';
import {
  formatMonitorWebSocketPreconditionError,
  MonitorWsPreconditionError,
  monitorWebSocketPrecondition,
  spawnMonitorWebSocket,
} from 'src/utils/monitorWsSpawn.js';
import { leftoverPolicyLimitsDp } from 'src/cli/leftoverTulip.js';
import { getPlatform } from 'src/utils/platform.js';
import {
  isWindowsBackendUnset,
  SandboxManager,
  WINDOWS_BACKEND_UNSET_MESSAGE,
  WINDOWS_MXC_BASH_REFUSAL_MESSAGE,
} from 'src/utils/sandbox/sandbox-adapter.js';
import { findGitBashPathOrNull } from 'src/utils/windowsPaths.js';

const MONITOR_TOOL_NAME = 'Monitor';
const DEFAULT_MONITOR_TIMEOUT_MS = 300_000;
const MAX_MONITOR_TIMEOUT_MS = 3_600_000;
const WILDCARD_RULE_CONTENT_RE = /^[\s*]+$/;

/**
 * Official 2.1.331 `sc()` (@312918900) / `Je.isEnabled()` (@326869100):
 * Monitor is enabled on non-Windows platforms, and on Windows only when Bash
 * is not withheld for the MXC sandbox backend and Git Bash is available.
 */
export function isMonitorPlatformEnabled(
  platform: string = getPlatform(),
  gitBashPath: string | null = platform === 'windows' ? findGitBashPathOrNull() : '',
  bashWithheldForMxc?: boolean,
): boolean {
  if (platform !== 'windows') return true;
  const withheld = bashWithheldForMxc ?? SandboxManager.isBashToolWithheldForMxcBackend();
  if (withheld) return false;
  return gitBashPath !== null;
}

export function getMonitorCommandSandboxRefusal(useSandbox: boolean, command: string): string | null {
  if (SandboxManager.isBashRefusedByMxcBackend()) {
    return WINDOWS_MXC_BASH_REFUSAL_MESSAGE;
  }
  if (
    getPlatform() === 'windows' &&
    SandboxManager.isSandboxEnabledInSettings() &&
    SandboxManager.isPlatformInEnabledList() &&
    isWindowsBackendUnset() &&
    !SandboxManager.areUnsandboxedCommandsAllowed()
  ) {
    return WINDOWS_BACKEND_UNSET_MESSAGE;
  }
  return getSandboxPolicyRefusal(useSandbox, command, false, 'bash');
}

function findWholeOrWildcardBashRule(
  toolPermissionContext: ToolPermissionContext,
  rules: readonly PermissionRule[],
): PermissionRule | null {
  // Official 2.1.331 `U` / `kws` / `g5i` (@314161000, @309925939):
  // Ignore `source === 'toolsNarrowing'` and match either whole-tool Bash
  // rules (no ruleContent) OR wildcard `Bash(*)` / `Bash( * )` / `Bash(**)` rules.
  const filtered = rules.filter(rule => rule.source !== 'toolsNarrowing');
  const toolAliases = (toolPermissionContext as { toolAliases?: Record<string, string> }).toolAliases;
  const alias = toolAliases?.[BASH_TOOL_NAME];
  const bashNames = alias !== undefined ? [BASH_TOOL_NAME, alias] : [BASH_TOOL_NAME];
  for (const name of bashNames) {
    const whole = filtered.find(rule => rule.ruleValue.toolName === name && rule.ruleValue.ruleContent === undefined);
    if (whole !== undefined) return whole;
  }
  return (
    filtered.find(
      rule =>
        bashNames.includes(rule.ruleValue.toolName) &&
        rule.ruleValue.ruleContent !== undefined &&
        WILDCARD_RULE_CONTENT_RE.test(rule.ruleValue.ruleContent),
    ) ?? null
  );
}

/** Official 2.1.331 `iWn` (@314161000) — check whole-tool & wildcard `Bash(*)` deny/ask rules for code-exec tools. */
function checkBashRuleForCodeExec(
  toolPermissionContext: ToolPermissionContext,
  surfaceLabel: string,
): { rule: PermissionRule; verdict: PermissionResult } | null {
  const denyRule = findWholeOrWildcardBashRule(toolPermissionContext, getDenyRules(toolPermissionContext));
  if (denyRule !== null) {
    return {
      rule: denyRule,
      verdict: {
        behavior: 'deny',
        message: `Permission to use ${surfaceLabel} has been denied: it runs code as ${BASH_TOOL_NAME} does, and a rule denies ${BASH_TOOL_NAME}.`,
        decisionReason: { type: 'rule', rule: denyRule },
      },
    };
  }
  const askRule = findWholeOrWildcardBashRule(toolPermissionContext, getAskRules(toolPermissionContext));
  if (askRule !== null) {
    return {
      rule: askRule,
      verdict: {
        behavior: 'ask',
        message: `${surfaceLabel} runs code as ${BASH_TOOL_NAME} does, and a rule asks before ${BASH_TOOL_NAME} runs.`,
        decisionReason: { type: 'rule', rule: askRule },
      },
    };
  }
  return null;
}

/** Official 2.1.331 `vIn` — compliance (`allow_web_fetch`) + literal-IP SSRF + sandbox network policy. */
function checkMonitorWsPrecondition(url: string) {
  const policyDenied = leftoverPolicyLimitsDp('allow_web_fetch', 'Arbitrary-URL egress', 'is');
  if (policyDenied !== null) {
    return {
      kind: 'compliance' as const,
      host: '',
      detail: policyDenied,
    };
  }
  return monitorWebSocketPrecondition(url);
}

type MonitorPermissionDeps = Pick<ToolDeps, 'permissions' | 'unlayeredPermissions'>;

function readBashCommandClamps(deps?: Partial<MonitorPermissionDeps>): unknown[] | undefined {
  const unlayered = deps?.unlayeredPermissions?.() as { bashCommandClamps?: unknown[] } | undefined;
  if (Array.isArray(unlayered?.bashCommandClamps) && unlayered.bashCommandClamps.length > 0) {
    return unlayered.bashCommandClamps;
  }
  const layered = deps?.permissions?.() as { bashCommandClamps?: unknown[] } | undefined;
  if (Array.isArray(layered?.bashCommandClamps) && layered.bashCommandClamps.length > 0) {
    return layered.bashCommandClamps;
  }
  return undefined;
}

/** Official 2.1.331 `mtl` + `qe` + `Ue` — deny bashCommandClamp / precondition / Bash(*) deny, else ask. */
function checkMonitorWebSocketPermission(
  ws: { url: string; protocols?: string[] },
  deps?: Partial<MonitorPermissionDeps>,
): PermissionResult {
  const clamps = readBashCommandClamps(deps);
  if (clamps !== undefined) {
    return {
      behavior: 'deny',
      message:
        'Permission to use Monitor websocket has been denied: this agent carries a per-spawn bashCommandClamp, which scopes shell execution to a fixed set of Bash command forms — this surface cannot match them. Use the clamped Bash forms instead.',
      decisionReason: {
        type: 'other',
        reason: 'bashCommandClamp',
      },
    };
  }
  const precondition = checkMonitorWsPrecondition(ws.url);
  if (precondition !== null) {
    return {
      behavior: 'deny',
      message: formatMonitorWebSocketPreconditionError(precondition),
      decisionReason: {
        type: 'other',
        reason:
          precondition.kind === 'compliance'
            ? 'organization policy disables model-chosen URL egress'
            : precondition.kind === 'ssrf'
              ? 'SSRF-blocked address range'
              : precondition.detail,
      },
    };
  }
  const protocols =
    ws.protocols !== undefined && ws.protocols.length > 0 ? ` (subprotocols: ${ws.protocols.join(', ')})` : '';
  const askResult: PermissionResult = {
    behavior: 'ask',
    message: `Monitor will open a WebSocket to ${ws.url}${protocols}`,
    suggestions: [],
  };
  const permCtx = deps?.permissions?.();
  if (!permCtx) {
    return askResult;
  }
  const bashRule = checkBashRuleForCodeExec(permCtx, MONITOR_TOOL_NAME);
  if (bashRule === null) {
    return askResult;
  }
  return bashRule.verdict.behavior === 'deny' ? bashRule.verdict : { ...askResult, matchedAskRule: bashRule.rule };
}

function isAsciiWsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') &&
      !parsed.username &&
      !parsed.password &&
      !/[\t\n\r]/.test(url) &&
      // biome-ignore lint/suspicious/noControlCharactersInRegex: gold ASCII ws URL
      /^[\x00-\x7F]*$/.test(url)
    );
  } catch {
    return false;
  }
}

function sourceFields() {
  return {
    // densable 2.1.223 #5 — same eHe/xRd schema gate as Bash/PowerShell so
    // hidden C0/C1 cannot slip into the Monitor permission dialog.
    command: z
      .string()
      .refine(hasNoHiddenControlChars, CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG)
      .optional()
      .describe('Shell command or script. Each stdout line is an event; exit ends the watch.'),
    ws: z
      .object({
        url: z
          .string()
          .refine(
            hasNoHiddenControlChars,
            'url contains control characters that would be hidden in the approval dialog',
          )
          .refine(isAsciiWsUrl, 'url must be a valid ASCII ws:// or wss:// URL with no userinfo or whitespace'),
        protocols: z
          .array(z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, 'protocol must be an RFC 6455 token'))
          .refine(p => new Set(p).size === p.length, 'protocols must be unique')
          .optional(),
      })
      .optional()
      .describe(
        'WebSocket to open. Each text frame is an event; binary frames are reported as a placeholder line. Socket close ends the watch. Cannot be combined with command.',
      ),
  };
}

const unboundedInputSchema = lazySchema(() =>
  z
    .strictObject({
      ...sourceFields(),
      description: z
        .string()
        .describe('Short human-readable description of what you are monitoring (shown in notifications).'),
      timeout_ms: z
        .number()
        .min(1000)
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
    })
    .refine(data => Number(Boolean(data.command)) + Number(Boolean(data.ws)) === 1, {
      message: 'exactly one of command or ws',
    })
    .refine(data => data.persistent || data.timeout_ms <= MAX_MONITOR_TIMEOUT_MS, {
      message: `timeout_ms must be ≤ ${MAX_MONITOR_TIMEOUT_MS}`,
      path: ['timeout_ms'],
    }),
);

function buildBoundedInputSchema() {
  const cap = monitorBoundedTimeoutCap();
  return z
    .object({
      ...sourceFields(),
      description: z
        .string()
        .describe('Short human-readable description of what you are monitoring (shown in notifications).'),
      timeout_ms: z
        .number()
        .min(1000)
        .max(MAX_MONITOR_TIMEOUT_MS, `timeout_ms must be ≤ ${MAX_MONITOR_TIMEOUT_MS}`)
        .optional()
        .default(DEFAULT_MONITOR_TIMEOUT_MS)
        .describe(
          `Kill the monitor after this deadline. Default ${DEFAULT_MONITOR_TIMEOUT_MS}ms. Deadlines above ${cap}ms are capped to ${cap}ms. You are notified at expiry and can re-arm.`,
        ),
    })
    .refine(data => Number(Boolean(data.command)) + Number(Boolean(data.ws)) === 1, {
      message: 'exactly one of command or ws',
    });
}

export function buildMonitorInputSchema(bounded = isMonitorTimeoutBounded()): InputSchema {
  return bounded ? buildBoundedInputSchema() : unboundedInputSchema();
}

type InputSchema = ReturnType<typeof unboundedInputSchema> | ReturnType<typeof buildBoundedInputSchema>;
export type MonitorInput = Omit<z.infer<ReturnType<typeof unboundedInputSchema>>, 'persistent'> & {
  persistent?: boolean;
};

const outputSchema = lazySchema(() =>
  z.object({
    taskId: z.string().describe('ID of the background monitor task.'),
    timeoutMs: z.number().optional().describe('Timeout deadline in milliseconds (0 when persistent).'),
    persistent: z.boolean().optional().describe('No timeout — runs until TaskStop or session end.'),
    outputFile: z.string().optional(),
    keptInSandboxByCheck: z
      .boolean()
      .optional()
      .describe(
        'True when the command ran in the sandbox only because its permission check relied on the sandbox; the settings would otherwise have exempted it.',
      ),
  }),
);
type OutputSchema = ReturnType<typeof outputSchema>;
export type MonitorOutput = z.infer<OutputSchema>;

function buildMonitorPrompt(): string {
  const bgDisabled = isBackgroundTasksDisabled();
  const bounded = isMonitorTimeoutBounded();
  const oneShotBullet = bgDisabled
    ? '- **One** ("tell me when the server is ready / the build finishes") → run the command in the **foreground with Bash**, exiting when the condition is true, e.g. `until grep -q "Ready in" dev.log; do sleep 0.5; done`.'
    : '- **One** ("tell me when the server is ready / the build finishes") → use **Bash with `run_in_background`** and a command that exits when the condition is true, e.g. `until grep -q "Ready in" dev.log; do sleep 0.5; done`. You get a single completion notification when it exits.';
  const oneShotFallback = bgDisabled
    ? 'use a foreground Bash `until` loop instead'
    : 'use Bash `run_in_background` with an `until` loop instead (one notification, ends in seconds)';
  return `Start a background monitor that streams events from a long-running script or WebSocket (\`ws\`). Each stdout line (or WebSocket frame) is an event — you keep working and notifications arrive in the chat. Events arrive on their own schedule and are not replies from the user, even if one lands while you're waiting for the user to answer a question.

Pick by how many notifications you need:
${oneShotBullet}
- **One per occurrence, ${bounded ? 'until the monitor expires (re-arm to continue)' : 'indefinitely'}** ("tell me every time an ERROR line appears") → Monitor with an unbounded command (\`tail -f\`, \`inotifywait -m\`, \`while true\`) or \`ws\`.
- **One per occurrence, until a known end** ("emit each CI step result, stop when the run completes") → Monitor with a command that emits lines and then exits.

Your script's stdout is the event stream. Each line becomes a notification. Exit ends the watch.

  # Each matching log line is an event
  tail -f /var/log/app.log | grep --line-buffered "ERROR"

  # Each file change is an event
  inotifywait -m --format '%e %f' /watched/dir

**Don't use an unbounded command for a single notification.** \`tail -f\`, \`inotifywait -m\`, and \`while true\` never exit on their own, so the monitor stays armed until timeout even after the event has fired. For "tell me when X is ready," ${oneShotFallback}.

**Script quality:**
- Every pipe stage must flush per line or matches sit in its buffer unseen: \`grep\` needs \`--line-buffered\`, \`awk\` needs \`fflush()\`.
- In poll loops, handle transient failures (\`curl ... || true\`) — one failed request shouldn't kill the monitor.
- Write a specific \`description\` — it appears in every notification ("errors in deploy.log" not "watching logs").
- Only stdout is the event stream. Stderr does not trigger notifications; you see only its last lines in the notice sent when the script ends — merge stderr with \`2>&1\` when needed.

**Coverage — silence is not success.** When watching a job or process for an outcome, your filter must match every terminal state, not just the happy path. Stdout lines within 200ms are batched into a single notification.`;
}

/**
 * Official 2.1.331 `Fe` (@326865200): compare `taskOutput.totalBytes` against
 * `taskOutput.pipedStdoutBytes` (or the fallback UTF-16 `.length` counter) in
 * the same UTF-16 code-unit basis so CJK / multi-byte UTF-8 stdout never
 * causes false-positive or false-negative stderr detection.
 */
export function hasMonitorStderrOutput(
  taskOutput: {
    totalBytes: number;
    pipedStdoutBytes?: number;
    getStderr: () => string;
  },
  fallbackPipedStdoutChars: number,
): boolean {
  const pipedStdout =
    typeof taskOutput.pipedStdoutBytes === 'number' ? taskOutput.pipedStdoutBytes : fallbackPipedStdoutChars;
  return taskOutput.totalBytes > pipedStdout || taskOutput.getStderr().length > 0;
}

export const MonitorTool = buildTool({
  name: MONITOR_TOOL_NAME,
  searchHint:
    'watch, monitor, or keep an eye on a process/log/command or WebSocket — stream each stdout line as a live notification',
  whenToUse: `When you are about to check a log, process or job again and again to catch each new event, use it and not repeated ${BASH_TOOL_NAME} calls or sleeps.`,
  // densable 2.1.248 #1 Unt — official enablesCodeExecution:!0 @189896058
  enablesCodeExecution: true,
  backgrounding: 'never',
  maxResultSizeChars: 10_000,
  shouldDefer: true,
  strict: true,

  get inputSchema(): InputSchema {
    return buildMonitorInputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },

  isEnabled() {
    return isMonitorPlatformEnabled();
  },

  async description(): Promise<string> {
    return buildMonitorPrompt();
  },
  async prompt(): Promise<string> {
    return buildMonitorPrompt();
  },

  isConcurrencySafe() {
    return true;
  },

  isReadOnly() {
    // Monitor executes shell commands which may have side effects
    return false;
  },

  toAutoClassifierInput(input: MonitorInput) {
    if (input.ws !== undefined) {
      const subprotocols =
        input.ws.protocols !== undefined && input.ws.protocols.length > 0
          ? ` (subprotocols: ${input.ws.protocols.map(p => `"${p}"`).join(', ')})`
          : '';
      return `websocket ${input.ws.url}${subprotocols}`;
    }
    return input.command ?? '';
  },

  async preparePermissionMatcher(input: MonitorInput) {
    const command =
      typeof input === 'object' &&
      input !== null &&
      'command' in input &&
      typeof input.command === 'string' &&
      input.command !== ''
        ? input.command
        : undefined;
    if (command === undefined) {
      return () => false;
    }
    if (!BashTool.preparePermissionMatcher) {
      return () => false;
    }
    return BashTool.preparePermissionMatcher({ command });
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

  create(deps: ToolDeps) {
    return {
      permissionCheckFailureDecision(_input: MonitorInput, _callCtx: ToolCallContext): PermissionResult | undefined {
        // Official 2.1.331 `Wls` (@316633649): fail closed when a permission check
        // crashes under an active per-spawn `bashCommandClamp`.
        const clamps = readBashCommandClamps(deps);
        if (clamps !== undefined) {
          return {
            behavior: 'deny',
            message: `The ${MONITOR_TOOL_NAME} permission check crashed and this agent carries a per-spawn bashCommandClamp; denying rather than running an unverified command.`,
            decisionReason: {
              type: 'other',
              reason: 'bashCommandClamp permission check crashed',
            },
          };
        }
        return undefined;
      },

      async checkPermissions(input: MonitorInput, callCtx: ToolCallContext): Promise<PermissionResult> {
        if (input.ws !== undefined) {
          return checkMonitorWebSocketPermission(input.ws, deps);
        }
        const sandboxAtStart = shouldUseSandbox({ command: input.command });
        try {
          const bashRule = checkBashRuleForCodeExec(deps.permissions(), MONITOR_TOOL_NAME);
          if (bashRule?.verdict.behavior === 'deny') {
            return bashRule.verdict;
          }
          // densable 2.1.289 @194307650 `Dzn({ ...n, command: n.command }, r.shellPermission)` —
          // preserve `description`, `timeout_ms`, and `persistent` in `updatedInput` so toolExecution
          // never overwrites MonitorInput with `{ command }` alone (`Monitor event: "undefined"`).
          // 2.1.290 `Ne` (@297418221): suspend sandbox auto-allow so Monitor doesn't silently bypass rules.
          const bashInput = {
            ...input,
            command: input.command ?? '',
          } as unknown as Parameters<typeof bashToolHasPermission>[0];
          const baseContext = resolveToolUseContext(deps, callCtx);
          const suspendedContext: ToolUseContext = {
            ...baseContext,
            permissionLayers: [...(baseContext.permissionLayers ?? []), { kind: 'sandbox_auto_allow_suspended' }],
          };
          const perm = await bashToolHasPermission(bashInput, suspendedContext);
          const mergedPerm: PermissionResult =
            (perm.behavior === 'allow' || perm.behavior === 'ask') && perm.updatedInput !== undefined
              ? {
                  ...perm,
                  updatedInput: { ...input, ...perm.updatedInput },
                }
              : perm;
          if (bashRule === null || mergedPerm.behavior === 'deny') {
            return mergedPerm;
          }
          if (mergedPerm.behavior === 'ask') {
            const { suggestions: _suggestions, ...rest } = mergedPerm;
            return { ...rest, matchedAskRule: bashRule.rule };
          }
          return bashRule.verdict;
        } finally {
          // Official 2.1.331 `He` / `fNn` (@326863500): pin check-time sandbox state
          // so hook/settings changes cannot silently drop sandboxing between check and call.
          recordSandboxStateAtCheck(
            callCtx.toolUseId,
            { command: input.command },
            sandboxAtStart || shouldUseSandbox({ command: input.command }),
          );
        }
      },

      async validateInput(input: MonitorInput, _callCtx: ToolCallContext): Promise<ValidationResult> {
        const hasCommand = Boolean(input.command && input.command.trim() !== '');
        const hasWs = input.ws !== undefined;
        if (hasCommand === hasWs) {
          return {
            result: false,
            message: 'exactly one of command or ws',
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
        if (input.command !== undefined) {
          // Official 2.1.331 `ze` (@326864650): enforce Windows strict-sandbox / MXC policy refusal.
          const policyRefusal = getMonitorCommandSandboxRefusal(
            shouldUseSandbox({ command: input.command }),
            input.command,
          );
          if (policyRefusal !== null) {
            return {
              result: false,
              message: policyRefusal,
              errorCode: 14,
            };
          }
        }
        return { result: true };
      },

      async call(input: MonitorInput, callCtx: ToolCallContext) {
        const { command, description, timeout_ms = DEFAULT_MONITOR_TIMEOUT_MS, persistent = false, ws } = input;
        const { abortController, toolUseId } = callCtx;
        const setAppState = deps.setAppStateForTasks ?? deps.setAppState;
        const effectiveAgentId = (deps.agentId ?? getAgentContext()?.agentId) as AgentId | undefined;
        if (effectiveAgentId !== undefined && isAgentStopPending(effectiveAgentId)) {
          throw new Error('This agent has been stopped and its stop is still completing; it cannot start monitors.');
        }
        const registry = deps.taskRegistry ?? createTaskRegistry(deps.getAppState, setAppState);
        // densable `p=RQ()`, `S=b6o(n,p)` then `vIt({...n,...S,bounded:p})` / `xe(...,p)`.
        const bounded = isMonitorTimeoutBounded();
        const S = clampMonitorSpawn({ timeout_ms, persistent }, bounded);

        logEvent('tengu_monitor_tool_used', {});

        if (ws !== undefined) {
          // Official 2.1.331 `Ke` (@326868480): re-check compliance (`allow_web_fetch`),
          // SSRF, and sandbox network policy right before opening the WebSocket.
          const wsPrecondition = checkMonitorWsPrecondition(ws.url);
          if (wsPrecondition !== null) {
            throw new MonitorWsPreconditionError(formatMonitorWebSocketPreconditionError(wsPrecondition));
          }
          const handle = await spawnMonitorWebSocket({
            url: ws.url,
            protocols: ws.protocols,
            description,
            timeoutMs: S.timeout_ms,
            persistent: S.persistent,
            bounded,
            toolUseId,
            agentId: effectiveAgentId,
            setAppState,
            taskRegistry: registry,
          });
          return {
            data: {
              taskId: handle.taskId,
              timeoutMs: S.persistent ? 0 : S.timeout_ms,
              persistent: S.persistent,
            },
          };
        }

        if (!command) {
          throw new Error('exactly one of command or ws');
        }

        // Official 2.1.331 `Ve` (@326866000): pin check-to-run sandbox decision and
        // enforce Windows strict-sandbox / MXC policy refusal before spawning.
        const keepInSandboxSinceCheck = shouldKeepRewrittenCommandInSandbox(toolUseId, { command });
        clearSandboxStateAtCheck(toolUseId);
        const effectiveUseSandbox = shouldUseSandbox(
          { command },
          { disableUnsandboxedCommands: keepInSandboxSinceCheck },
        );
        const policyRefusal = getMonitorCommandSandboxRefusal(effectiveUseSandbox, command);
        if (policyRefusal !== null) {
          throw new SandboxPolicyRefusalError(policyRefusal);
        }
        if (keepInSandboxSinceCheck && !effectiveUseSandbox) {
          throw new SandboxPolicyRefusalError(SANDBOX_GONE_SINCE_CHECK_MESSAGE);
        }
        const keptInSandboxByCheck = keepInSandboxSinceCheck && effectiveUseSandbox && !shouldUseSandbox({ command });

        // densable xe / w1n: pipe stdout into the stream pump (j6 Monitor event).
        const taskRef: { id?: string } = {};
        let pump: MonitorStreamPump | undefined;
        if (feature('MONITOR_TOOL')) {
          pump = createMonitorStreamPump({
            description,
            agentId: effectiveAgentId,
            taskRef,
            killTask: () => {
              const id = taskRef.id;
              if (!id) return false;
              killTask(id, registry);
              return true;
            },
          });
        }

        // Official 2.1.331 (`Zoe.#g` / `Fe`): track piped stdout in UTF-16 code units
        // (same unit as TaskOutput.totalBytes) so CJK/UTF-8 output never skews stderr detection.
        let pipedStdoutChars = 0;
        const onMonitorStdout = feature('MONITOR_TOOL')
          ? (chunk: string) => {
              pipedStdoutChars += chunk.length;
              pump?.onData(chunk);
            }
          : undefined;

        const shellCommand = await exec(command, callCtx.signal, 'bash', {
          onStdout: onMonitorStdout,
          preventCwdChanges: true,
          shouldUseSandbox: effectiveUseSandbox,
          agentWorktree: deps.agentWorktree,
          useToolMemoryCgroup: true,
        });
        if (shellCommand.status === 'completed') {
          const completed = await shellCommand.result;
          if (completed.preSpawnError) {
            shellCommand.cleanup();
            pump?.dropAndClose();
            throw new Error(completed.preSpawnError);
          }
        }
        if (shellCommand.status === 'killed') {
          await shellCommand.result;
          shellCommand.cleanup();
          pump?.dropAndClose();
          if (effectiveAgentId !== undefined && isAgentStopPending(effectiveAgentId)) {
            throw new Error('This agent has been stopped and its stop is still completing; it cannot start monitors.');
          }
          throw new Error('This call was interrupted before the monitor started; nothing is running.');
        }
        if (effectiveAgentId !== undefined && isAgentStopPending(effectiveAgentId)) {
          shellCommand.kill();
          shellCommand.cleanup();
          pump?.dropAndClose();
          throw new Error('This agent has been stopped and its stop is still completing; it cannot start monitors.');
        }

        // Spawn as a background task with kind: 'monitor'
        const handle = await spawnShellTask(
          {
            command,
            description,
            shellCommand,
            toolUseId: toolUseId,
            agentId: effectiveAgentId,
            innerCall: callCtx.innerCall ?? deps.innerCall,
            kind: 'monitor',
          },
          {
            abortController,
            getAppState: deps.getAppState,
            setAppState,
          },
        );
        taskRef.id = handle.taskId;

        if (feature('MONITOR_TOOL')) {
          if (pump) {
            const stream = pump;
            // Official 2.1.331 `Ve` / `Fe`: use the canonical `monitor:<id>` keepalive
            // key (deduplicated via Set with spawnShellTask's attachShellKeepalive)
            // instead of registering a second duplicate `monitor:<id>:stream` entry.
            const keepaliveReason = monitorKeepaliveReason(handle.taskId);
            if (effectiveAgentId) {
              addKeepaliveReason(effectiveAgentId, keepaliveReason, registry);
            }
            const timeoutId = S.persistent
              ? undefined
              : setTimeout(() => {
                  if (stream.isClosed()) return;
                  stream.flush();
                  if (stream.isClosed()) return;
                  // Official 2.1.331 (`Fe` @326865200): compare totalBytes against
                  // pipedStdoutBytes in matching units to detect stderr reliably.
                  const stderrOutputFile = hasMonitorStderrOutput(shellCommand.taskOutput, pipedStdoutChars)
                    ? shellCommand.taskOutput.path
                    : undefined;
                  notifyMonitorStreamEvent(
                    description,
                    monitorExpiredEvent(S.timeout_ms, stream.eventCount(), bounded, stderrOutputFile),
                    handle.taskId,
                    {
                      isHousekeeping: true,
                      agentId: effectiveAgentId,
                    },
                  );
                  killTask(handle.taskId, registry);
                }, S.timeout_ms);
            timeoutId?.unref?.();
            void shellCommand.result.then(async () => {
              if (timeoutId) clearTimeout(timeoutId);
              try {
                await stream.reportExit(handle);
              } catch {
                // best-effort
              } finally {
                if (effectiveAgentId) {
                  removeKeepaliveReason(effectiveAgentId, keepaliveReason, registry);
                }
              }
            });
          }
        }

        return {
          data: {
            taskId: handle.taskId,
            timeoutMs: S.persistent ? 0 : S.timeout_ms,
            persistent: S.persistent,
            ...(keptInSandboxByCheck ? { keptInSandboxByCheck: true } : {}),
          },
        };
      },
    };
  },

  renderToolUseMessage(input: Partial<MonitorInput>) {
    return input.description || null;
  },

  mapToolResultToToolResultBlockParam(content: MonitorOutput, toolUseId: string): ToolResultBlockParam {
    const deadline = content.persistent
      ? 'persistent — runs until TaskStop or session end'
      : isMonitorTimeoutBounded()
        ? `expires in ${formatDuration(content.timeoutMs ?? DEFAULT_MONITOR_TIMEOUT_MS, { hideTrailingZeros: true })} unless the source ends first; you get one notice at expiry — re-arm if you still need the watch`
        : `timeout ${content.timeoutMs ?? DEFAULT_MONITOR_TIMEOUT_MS}ms`;
    const keptNote = content.keptInSandboxByCheck === true ? ` ${KEPT_IN_SANDBOX_SINCE_CHECK_NOTE}` : '';
    return {
      tool_use_id: toolUseId,
      type: 'tool_result',
      content: `Monitor started (task ${content.taskId}, ${deadline}). You will be notified on each event. Keep working — do not poll or sleep. Events may arrive while you are waiting for the user — an event is not their reply.${keptNote}`,
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
} satisfies ToolDef<InputSchema, MonitorOutput>);
