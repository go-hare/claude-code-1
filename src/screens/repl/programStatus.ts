import {
  Jk,
  PROGRAM_STATUS_KEEP_ALL,
  type ProgramStatusOptions,
  programStatus,
  sanitizeProgramStatusId,
  type TabStatusKind,
  tD,
  TerminalWriteContext,
  useTabStatus,
  wrapForMultiplexer,
} from '@anthropic/ink'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import type { TaskState } from '../../tasks/types.js'
import { getGlobalConfig } from '../../utils/config.js'
import type { MessageQueueInstance } from '../../utils/messageQueueManager.js'
import type { TranscriptProjection } from './TranscriptProjection.js'

// #257 (2.1.326, official $Fe/VFe/GFe): Program Status Protocol (OSC 7501)
export type ProgramStatusChild = {
  id: string
  title?: string
  state: 'working' | 'blocked'
  kind?: 'question' | 'permission'
}

export type ProgramStatusPayload = {
  state: 'working' | 'done' | 'blocked' | 'idle' | 'error'
  kind?: 'permission' | 'question' | 'auth'
  progress?: number
  title?: string
  msg?: string
}

const PROGRAM_STATUS_MAX_CHILDREN = 32

function sanitizeOsc7501Field(
  value: string | undefined,
  maxLen = 80,
): string | undefined {
  if (!value) return undefined
  let stripped = ''
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f || code === 0x3a || code === 0x3b) {
      stripped += ' '
    } else {
      stripped += value[i]!
    }
  }
  const cleaned = stripped.replace(/\s+/g, ' ').trim()
  if (!cleaned) return undefined
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned
}

function isRunningProgramStatusBgOp(task: TaskState): boolean {
  if (task.status !== 'running') return false
  if (task.type === 'local_bash') {
    return task.isBackgrounded === true
  }
  return (
    task.type === 'monitor_mcp' ||
    task.type === 'monitor_ws' ||
    task.type === 'mcp_task'
  )
}

/**
 * #257 (2.1.326, official GFe): collect running agents, background commands,
 * monitors, and MCP tasks as OSC 7501 children (capped at 32).
 */
export function collectProgramStatusChildren(
  tasks: Record<string, TaskState>,
): ProgramStatusChild[] {
  const agents: ProgramStatusChild[] = []
  const bgOps: ProgramStatusChild[] = []
  for (const task of Object.values(tasks)) {
    const id = sanitizeOsc7501Field(task.id, 48)
    if (!id) continue
    if (
      (task.type === 'local_agent' && task.agentType !== 'main-session') ||
      task.type === 'in_process_teammate' ||
      task.type === 'remote_agent' ||
      task.type === 'local_workflow'
    ) {
      if (task.status === 'running' || task.status === 'paused') {
        agents.push({
          id,
          title: sanitizeOsc7501Field(task.description),
          state: task.status === 'paused' ? 'blocked' : 'working',
        })
      }
    } else if (isRunningProgramStatusBgOp(task)) {
      bgOps.push({
        id,
        title: sanitizeOsc7501Field(task.description),
        state: 'working',
      })
    }
  }
  const byId = (a: ProgramStatusChild, b: ProgramStatusChild) =>
    a.id.localeCompare(b.id)
  return [...agents.sort(byId), ...bgOps.sort(byId)].slice(
    0,
    PROGRAM_STATUS_MAX_CHILDREN,
  )
}

/**
 * #257 (2.1.326, official VFe): format the awaited background-work summary when
 * background commands, monitors, or MCP tasks are still running after a turn.
 */
export function collectProgramStatusAwaited(
  tasks: Record<string, TaskState>,
): string | undefined {
  let commands = 0
  let monitors = 0
  let mcpTasks = 0
  for (const task of Object.values(tasks)) {
    if (!isRunningProgramStatusBgOp(task)) continue
    if (task.type === 'local_bash') {
      if (task.kind === 'monitor') monitors++
      else commands++
    } else if (task.type === 'monitor_mcp' || task.type === 'monitor_ws') {
      monitors++
    } else if (task.type === 'mcp_task') {
      mcpTasks++
    }
  }
  const parts: string[] = []
  if (commands > 0)
    parts.push(`${commands} ${commands === 1 ? 'command' : 'commands'}`)
  if (monitors > 0)
    parts.push(`${monitors} ${monitors === 1 ? 'monitor' : 'monitors'}`)
  if (mcpTasks > 0)
    parts.push(`${mcpTasks} ${mcpTasks === 1 ? 'MCP task' : 'MCP tasks'}`)
  return parts.length > 0 ? `${parts.join(', ')} still running` : undefined
}

/**
 * #257 (2.1.326, official $Fe): resolve top-level OSC 7501 state — reporting
 * `working` (with `awaited`) instead of `done` while awaiting background work.
 */
export function buildProgramStatusState(input: {
  status: TabStatusKind
  hasQueued?: boolean
  awaited?: string
  hasCompletedTurn?: boolean
  lastTurnError?: string
  blockedKind?: 'permission' | 'question'
  blockedMsg?: string
}): ProgramStatusPayload {
  if (input.status === 'busy' || (input.status === 'idle' && input.hasQueued)) {
    return { state: 'working' }
  }
  if (input.status === 'waiting') {
    return {
      state: 'blocked',
      kind: input.blockedKind,
      msg: sanitizeOsc7501Field(input.blockedMsg),
    }
  }
  if (input.lastTurnError) {
    return { state: 'error', msg: sanitizeOsc7501Field(input.lastTurnError) }
  }
  if (input.hasCompletedTurn) {
    return input.awaited !== undefined
      ? { state: 'working', msg: sanitizeOsc7501Field(input.awaited) }
      : { state: 'done' }
  }
  return input.awaited !== undefined
    ? { state: 'working', msg: sanitizeOsc7501Field(input.awaited) }
    : { state: 'idle' }
}

/** Encode an OSC 7501 Program Status Protocol escape sequence via spec-compliant `programStatus()`. */
export function encodeOsc7501Status(
  payload: ProgramStatusPayload & { id?: string },
): string {
  const state: ProgramStatusOptions['state'] =
    payload.state === 'working' ||
    payload.state === 'blocked' ||
    payload.state === 'done'
      ? payload.state
      : payload.state === 'error'
        ? 'done'
        : 'clear'
  const id = payload.id
    ? (sanitizeProgramStatusId(payload.id) ?? payload.id)
    : undefined
  return programStatus({
    state,
    id,
    kind: payload.kind,
    progress: payload.progress,
    title: payload.title,
    msg: payload.msg,
  })
}

export function useReplProgramStatus(params: {
  titleDisabled: boolean
  sessionStatus: TabStatusKind
  waitingFor: string | undefined
  tasks: Record<string, TaskState>
  transcriptProjection: TranscriptProjection
  messageQueue: MessageQueueInstance
}): { showStatusInTerminalTab: boolean } {
  const {
    titleDisabled,
    sessionStatus,
    waitingFor,
    tasks,
    transcriptProjection,
    messageQueue,
  } = params

  // 3P default: off — OSC 21337 is ant-only while the spec stabilizes.
  const tabStatusGateEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_terminal_sidebar',
    false,
  )
  const showStatusInTerminalTab =
    tabStatusGateEnabled && (getGlobalConfig().showStatusInTerminalTab ?? false)
  useTabStatus(titleDisabled || !showStatusInTerminalTab ? null : sessionStatus)

  // #188 / #257 (2.1.326): Program Status Protocol (OSC 7501) reporting — gated on
  // terminal capability (`tD().now('programStatus')` / `onSettle`), routed through
  // `Jk().programStatus.show` + `.update` so spec-compliant base64 `title`/`msg` and
  // `app=claude-code` are emitted and children are cleared cleanly.
  const writeRawOsc7501 = React.useContext(TerminalWriteContext)
  const [programStatusSupported, setProgramStatusSupported] = useState(() =>
    tD().now('programStatus'),
  )
  useEffect(() => {
    return tD().onSettle('programStatus', supported => {
      setProgramStatusSupported(supported)
    })
  }, [])
  useEffect(() => {
    if (titleDisabled || !programStatusSupported || !writeRawOsc7501) return
    const awaited =
      sessionStatus !== 'busy' ? collectProgramStatusAwaited(tasks) : undefined
    const rootPayload = buildProgramStatusState({
      status: sessionStatus,
      hasQueued: messageQueue.getMainThreadLength() > 0,
      awaited,
      hasCompletedTurn: transcriptProjection
        .getCurrent()
        .some(m => m.type === 'assistant'),
      blockedKind:
        waitingFor === 'input needed'
          ? 'question'
          : waitingFor
            ? 'permission'
            : undefined,
      blockedMsg: waitingFor ?? undefined,
    })
    const rootState: ProgramStatusOptions['state'] =
      rootPayload.state === 'working' ||
      rootPayload.state === 'blocked' ||
      rootPayload.state === 'done'
        ? rootPayload.state
        : rootPayload.state === 'error'
          ? 'done'
          : 'clear'
    const root: ProgramStatusOptions = {
      state: rootState,
      kind: rootPayload.kind,
      progress: rootPayload.progress,
      title: rootPayload.title,
      msg: rootPayload.msg,
    }
    const children: ProgramStatusOptions[] = collectProgramStatusChildren(
      tasks,
    ).map(child => ({
      id: sanitizeProgramStatusId(child.id) ?? child.id,
      state: child.state,
      kind: child.kind,
      title: child.title,
    }))
    const controller = Jk().programStatus
    const unsub = controller.show({
      root,
      main: { drops: 0, children },
    })
    const seq = controller.update(PROGRAM_STATUS_KEEP_ALL)
    if (seq) {
      writeRawOsc7501(wrapForMultiplexer(seq))
    }
    return () => {
      unsub()
    }
  }, [
    titleDisabled,
    programStatusSupported,
    writeRawOsc7501,
    sessionStatus,
    tasks,
    transcriptProjection,
    waitingFor,
    messageQueue,
  ])
  useEffect(() => {
    return () => {
      if (!writeRawOsc7501) return
      const clearSeq = Jk().programStatus.leave(tD().now('programStatus'))
      if (clearSeq) {
        writeRawOsc7501(wrapForMultiplexer(clearSeq))
      }
    }
  }, [writeRawOsc7501])

  return { showStatusInTerminalTab }
}
