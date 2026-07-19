/**
 * densable subagentStatusLine residual (vHa / Fnf / Nnf / fRb / CHa / wHa).
 *
 * settings.subagentStatusLine.command receives a JSON payload of visible
 * panel agent tasks on stdin and emits NDJSON lines `{id, content}` that
 * become AppState.taskDecorations (rendered in CoordinatorTaskPanel rows).
 */
import { z } from 'zod'
import { getProjectRoot, getSessionId } from '../bootstrap/state.js'
import type { AppState } from '../state/AppState.js'
import {
  isPanelAgentTask,
  type LocalAgentTaskState,
} from '../tasks/LocalAgentTask/LocalAgentTask.js'
import type { TaskState } from '../tasks/types.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import {
  shouldAllowManagedHooksOnly,
  shouldDisableAllHooksIncludingManaged,
} from './hooks/hooksConfigSnapshot.js'
import { shouldSkipHookDueToTrust } from './hooks.js'
import { getContextWindowForModel } from './context.js'
import { getPlatform } from './platform.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from './settings/settings.js'
import { jsonStringify } from './slowOperations.js'
import { subprocessEnv } from './subprocessEnv.js'

/** densable cRb — command timeout (ms). */
export const SUBAGENT_STATUS_LINE_TIMEOUT_MS = 5000

/** densable Mnf — sliding window of token samples kept per task. */
export const TOKEN_SAMPLE_WINDOW = 16

/** densable pRb — first tick delay after effect starts (ms). */
export const SUBAGENT_STATUS_LINE_INITIAL_DELAY_MS = 300

/** densable Bnf — poll interval while panel tasks exist (ms). */
export const SUBAGENT_STATUS_LINE_POLL_MS = 5000

/** densable Hke-equivalent — left gutter width reserved for bullet/pointer. */
export const AGENT_PANEL_GUTTER_WIDTH = 4

const lineSchema = z.object({
  id: z.string(),
  content: z.string(),
})

export type TaskDecoration = { content: string }

export type SubagentStatusTaskRow = {
  id: string
  name: string | undefined
  type: string
  status: string
  description: string
  label: string
  startTime: number
  model: string | undefined
  contextWindowSize: number | undefined
  tokenCount: number
  tokenSamples: number[]
  cwd: string
}

export type SubagentStatusLineInput = {
  session_id: string
  transcript_path?: string
  cwd: string
  columns: number
  tasks: SubagentStatusTaskRow[]
}

/**
 * densable vHa — resolve command string.
 * Managed-only mode reads policySettings; otherwise merged settings.
 */
export function getSubagentStatusLineCommand(): string | undefined {
  const cfg = shouldAllowManagedHooksOnly()
    ? getSettingsForSource('policySettings')?.subagentStatusLine
    : getSettings_DEPRECATED()?.subagentStatusLine
  return cfg?.type === 'command' ? cfg.command : undefined
}

/**
 * densable CHa — visible panel agent tasks (not main-session, not hard-dismissed).
 */
export function getVisiblePanelAgentTasks(
  tasks: AppState['tasks'] | { [id: string]: TaskState },
): LocalAgentTaskState[] {
  return Object.values(tasks).filter(
    (t): t is LocalAgentTaskState =>
      isPanelAgentTask(t) && t.evictAfter !== 0,
  )
}

/** densable dRb — preferred label for a panel agent row. */
export function taskLabelForStatusLine(task: LocalAgentTaskState): string {
  if (task.progress?.summary) return task.progress.summary
  return task.description
}

/**
 * densable Nnf — push current tokenCount samples; drop entries for gone tasks;
 * keep at most TOKEN_SAMPLE_WINDOW samples per id.
 */
export function updateTokenSamples(
  samples: Map<string, number[]>,
  rows: ReadonlyArray<{ id: string; tokenCount: number }>,
): void {
  const live = new Set<string>()
  for (const { id, tokenCount } of rows) {
    live.add(id)
    let arr = samples.get(id)
    if (!arr) {
      arr = []
      samples.set(id, arr)
    }
    arr.push(tokenCount)
    if (arr.length > TOKEN_SAMPLE_WINDOW) {
      arr.splice(0, arr.length - TOKEN_SAMPLE_WINDOW)
    }
  }
  for (const id of samples.keys()) {
    if (!live.has(id)) samples.delete(id)
  }
}

/** densable fRb — shallow equality of decoration maps by content. */
export function taskDecorationsEqual(
  a: { [id: string]: TaskDecoration },
  b: { [id: string]: TaskDecoration },
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (a[k]?.content !== b[k]?.content) return false
  }
  return true
}

/**
 * densable Fnf — run subagentStatusLine command once for the given tasks.
 * Returns {} on disable / trust / error / empty.
 */
export async function executeSubagentStatusLine(
  tasks: LocalAgentTaskState[],
  columns: number,
  nameByAgentId: Map<string, string>,
  tokenSamples: Map<string, number[]>,
): Promise<{ [id: string]: TaskDecoration }> {
  if (shouldDisableAllHooksIncludingManaged()) {
    return {}
  }
  if (shouldSkipHookDueToTrust()) {
    logForDebugging(
      'Skipping subagentStatusLine execution - workspace trust not accepted',
    )
    return {}
  }
  const command = getSubagentStatusLineCommand()
  if (command === undefined || tasks.length === 0) {
    return {}
  }

  const cwd = getCwd()
  const payload: SubagentStatusLineInput = {
    session_id: getSessionId(),
    cwd,
    columns,
    tasks: tasks.map(g => {
      const model = g.model
      return {
        id: g.id,
        name: nameByAgentId.get(g.id),
        type: g.type,
        status: g.status,
        description: g.description,
        label: taskLabelForStatusLine(g),
        startTime: g.startTime,
        model,
        contextWindowSize: model
          ? getContextWindowForModel(model)
          : undefined,
        tokenCount: g.progress?.tokenCount ?? 0,
        tokenSamples: tokenSamples.get(g.id) ?? [],
        cwd,
      }
    }),
  }

  const isWindows = getPlatform() === 'windows'
  const projectDir = getProjectRoot()
  const env: NodeJS.ProcessEnv = {
    ...subprocessEnv(),
    CLAUDE_PROJECT_DIR: isWindows
      ? projectDir.replaceAll('\\', '/')
      : projectDir,
  }

  try {
    const result = await execFileNoThrowWithCwd(
      isWindows ? command.replaceAll('\\', '/') : command,
      [],
      {
        timeout: SUBAGENT_STATUS_LINE_TIMEOUT_MS,
        cwd,
        env,
        shell: true,
        input: jsonStringify(payload),
        preserveOutputOnError: true,
      },
    )
    if (result.code !== 0) {
      logForDebugging(
        `subagentStatusLine exited ${result.code}: ${result.error ?? result.stderr}`,
        { level: 'error' },
      )
      return {}
    }
    return parseSubagentStatusLineStdout(result.stdout)
  } catch (err) {
    logForDebugging(`subagentStatusLine failed: ${String(err)}`, {
      level: 'error',
    })
    return {}
  }
}

/** Parse NDJSON stdout into decoration map (invalid lines skipped). */
export function parseSubagentStatusLineStdout(
  stdout: string,
): { [id: string]: TaskDecoration } {
  const out: { [id: string]: TaskDecoration } = {}
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      logForDebugging(
        `subagentStatusLine emitted non-JSON line: ${line}`,
        { level: 'error' },
      )
      continue
    }
    const parsed = lineSchema.safeParse(raw)
    if (!parsed.success) {
      logForDebugging(
        `subagentStatusLine emitted invalid schema: ${parsed.error.message}`,
        { level: 'error' },
      )
      continue
    }
    out[parsed.data.id] = { content: parsed.data.content }
  }
  return out
}
