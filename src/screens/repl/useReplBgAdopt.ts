import { feature } from 'bun:bundle'
import type * as React from 'react'
import { useEffect } from 'react'
import { getOriginalCwd } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Store } from '../../state/store.js'
import { restoreRemoteAgentTasks } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js'
import type { Message as MessageType } from '../../types/message.js'
import { isBgSession } from '../../utils/concurrentSessions.js'
import type {
  MessageQueueInstance,
  SetAppState,
} from '../../utils/messageQueueManager.js'
import type { DeferredAdoptResumeRefs } from './types.js'

/**
 * Handles background-session checkpoint adoption (`adopt.json`) on mount,
 * including Stage-1 transcript cleanup in `removeTask`, plus cold `--resume`
 * initial-messages file state and orphan agent recovery.
 */
export function useReplBgAdopt(params: {
  store: Store<AppState>
  setAppState: SetAppState
  messageQueue: MessageQueueInstance
  messagesRef: React.RefObject<MessageType[]>
  deferredResumeRefs: React.RefObject<DeferredAdoptResumeRefs>
  initialMessages: MessageType[] | undefined
  restoreReadFileState: (messages: MessageType[], cwd: string) => void
}): void {
  const {
    store,
    setAppState,
    messageQueue,
    messagesRef,
    deferredResumeRefs,
    initialMessages,
    restoreReadFileState,
  } = params

  // Official e4d on bg mount — claim adopt.json once, rehydrate agents (r4d/PSu)
  // then shells (k$a/Lvu) + cron (s4d) + workflows (i4d/o4d/ess) + t4d/BSe + prefill.
  // Orphan auto-resume (ese) after claim prefill — scan → classify → deferred Aye.
  useEffect(() => {
    if (feature('BG_SESSIONS')) {
      if (!isBgSession()) return
      const jobDir = process.env.CLAUDE_JOB_DIR
      if (!jobDir) return
      let cancelled = false
      void (async () => {
        try {
          const {
            claimAdoptJson,
            ADOPT_CLAIM_WAIT_MS,
            rehydrateAdoptedShells,
            rehydrateAdoptedAgents,
            rehydrateAdoptedWorkflows,
            stashDeferredAdoptResume,
          } = await import('../../utils/bgCheckpoint.js')
          const expectHandoff =
            process.env.CLAUDE_BG_SOURCE === 'left_arrow' ||
            process.env.CLAUDE_BG_SOURCE === 'exit'
          const claimed = await claimAdoptJson(jobDir, {
            waitMs: expectHandoff ? ADOPT_CLAIM_WAIT_MS : 0,
          })
          if (cancelled || !claimed.ok) return
          const payload = claimed.payload

          let adoptedAgentIds = new Set<string>()
          let adoptedAgentEntries: import('../../utils/bgCheckpoint.js').AdoptedAgentEntry[] =
            []
          if (payload.agents?.length && !cancelled) {
            try {
              const agentResult = await rehydrateAdoptedAgents(
                payload.agents,
                setAppState as unknown as (
                  u: (p: { tasks: Record<string, unknown> }) => {
                    tasks: Record<string, unknown>
                  },
                ) => void,
              )
              adoptedAgentIds = agentResult.adoptedAgentIds
              adoptedAgentEntries = agentResult.adoptedEntries
            } catch {
              // best-effort
            }
          }

          if (payload.shells?.length && !cancelled) {
            try {
              await rehydrateAdoptedShells(
                payload.shells,
                setAppState as unknown as (
                  u: (p: { tasks: Record<string, unknown> }) => {
                    tasks: Record<string, unknown>
                  },
                ) => void,
                {
                  adoptedAgentIds,
                  skipOrphanAgentShells: true,
                  getAppState: () => store.getState(),
                },
              )
            } catch {
              // best-effort
            }
          }

          if (payload.cron?.length) {
            const { addSessionCronTask } = await import(
              '../../bootstrap/state.js'
            )
            for (const c of payload.cron) {
              if (!c?.id || !c.cron || !c.prompt) continue
              if (c.agentId !== undefined && !adoptedAgentIds.has(c.agentId))
                continue
              try {
                addSessionCronTask({
                  id: c.id,
                  cron: c.cron,
                  prompt: c.prompt,
                  createdAt: c.createdAt ?? Date.now(),
                  recurring: c.recurring,
                  agentId: c.agentId,
                })
              } catch {
                // skip individual
              }
            }
          }

          let adoptedWorkflowEntries: import('../../utils/bgCheckpoint.js').AdoptedWorkflowEntry[] =
            []
          if (payload.workflows?.length && !cancelled) {
            try {
              const wfResult = await rehydrateAdoptedWorkflows(
                payload.workflows,
                setAppState as unknown as (
                  u: (p: { tasks: Record<string, unknown> }) => {
                    tasks: Record<string, unknown>
                  },
                ) => void,
              )
              adoptedWorkflowEntries = wfResult.adoptedEntries
            } catch {
              // best-effort
            }
          }

          if (payload.frameLive?.length && !cancelled) {
            try {
              const ar = await import(
                '../../services/artifactAutoReact/index.js'
              )
              const { ADOPT_STALE_MS } = await import(
                '../../utils/bgCheckpoint.js'
              )
              const entries = ar.markStaleFrameLive(
                payload.frameLive,
                Date.now(),
                ADOPT_STALE_MS,
              )
              await ar.rearmCarriedFrameLiveViaAgi(entries, {
                setAppState,
                autoReactEnabled: ar.mI(),
                jobDir,
                owner: process.pid.toString(),
                armedVia: 'session_resume',
                publishContext: 'bg_session',
                forceLocalArmWithoutSocket: true,
              })
            } catch {
              // best-effort
            }
          }

          if (
            !cancelled &&
            (adoptedAgentEntries.length > 0 ||
              adoptedWorkflowEntries.length > 0)
          ) {
            stashDeferredAdoptResume(
              jobDir,
              adoptedAgentEntries,
              adoptedWorkflowEntries,
            )
            const { scheduleDeferredAdoptResume } = await import(
              '../../utils/bgCheckpoint.js'
            )
            void scheduleDeferredAdoptResume({
              jobDir,
              getState: () => store.getState(),
              subscribe: listener => store.subscribe(listener),
              isJobDirCurrent: dir => process.env.CLAUDE_JOB_DIR === dir,
              // Official w5u + Stage-1 fix: drop adopted taskId AND its transcript entry.
              removeTask: taskId => {
                try {
                  setAppState(prev => {
                    if (!prev.tasks || !(taskId in prev.tasks)) return prev
                    const { [taskId]: _removed, ...rest } = prev.tasks
                    const transcripts = prev.transcripts
                    if (!transcripts || !(taskId in transcripts)) {
                      return { ...prev, tasks: rest }
                    }
                    const { [taskId]: _removedTranscript, ...restTranscripts } =
                      transcripts
                    return {
                      ...prev,
                      tasks: rest,
                      transcripts: restTranscripts,
                    }
                  })
                } catch {
                  /* best-effort */
                }
              },
              getWorkflowResumeContext: () => {
                const ctx = deferredResumeRefs.current.getToolUseContext
                const can = deferredResumeRefs.current.canUseTool
                const model = deferredResumeRefs.current.mainLoopModel
                if (!ctx || !can || !model) return null
                return {
                  toolUseContext: ctx(
                    messagesRef.current,
                    [],
                    new AbortController(),
                    model,
                  ),
                  canUseTool: can as (
                    input: unknown,
                    toolUseContext: unknown,
                  ) => Promise<unknown> | unknown,
                }
              },
              resumeAgent: async entry => {
                const resume = deferredResumeRefs.current.resumeAgentBackground
                const ctx = deferredResumeRefs.current.getToolUseContext
                const can = deferredResumeRefs.current.canUseTool
                const model = deferredResumeRefs.current.mainLoopModel
                if (!resume || !ctx || !can || !model) {
                  throw new Error('resume agent context not ready')
                }
                await resume({
                  agentId: entry.agentId,
                  prompt: entry.description ?? '(resumed agent)',
                  toolUseContext: ctx(
                    messagesRef.current,
                    [],
                    new AbortController(),
                    model,
                  ) as never,
                  canUseTool: can,
                  continueInterruptedTurn: true,
                })
              },
            }).catch(() => {
              // best-effort
            })
          }

          if (payload.prefill?.text) {
            const {
              buildInterruptedOutputHintContent,
              checkInterruptedOutputBoundary,
            } = await import('../../utils/replyOnResume.js')
            const check = checkInterruptedOutputBoundary(
              payload.prefill,
              payload.prefill.boundaryUuid,
            )
            if (check.accept) {
              const hint = buildInterruptedOutputHintContent(
                payload.prefill.text,
              )
              messageQueue.enqueue({
                mode: 'prompt',
                value: hint,
                priority: 'next',
                isMeta: true,
              })
            }
          }

          if (!cancelled) {
            try {
              const { runOrphanAgentResumePass } = await import(
                '../../utils/orphanAgentResume.js'
              )
              const liveIds = new Set<string>()
              const liveTaskIds = new Set<string>()
              try {
                const tasksSnap = store.getState().tasks ?? {}
                for (const t of Object.values(tasksSnap) as Array<{
                  type?: string
                  agentId?: string
                  id?: string
                }>) {
                  if (typeof t?.id === 'string') liveTaskIds.add(t.id)
                  if (t?.type === 'local_agent') {
                    if (typeof t.agentId === 'string') liveIds.add(t.agentId)
                    if (typeof t.id === 'string') liveIds.add(t.id)
                  }
                }
              } catch {
                /* ignore */
              }
              void runOrphanAgentResumePass({
                messages: messagesRef.current as never,
                liveAgentIds: liveIds,
                liveTaskIds,
                getState: () => store.getState(),
                subscribe: listener => store.subscribe(listener),
                isCurrent: () => !cancelled,
                resumeAgent: async entry => {
                  const resume =
                    deferredResumeRefs.current.resumeAgentBackground
                  const ctx = deferredResumeRefs.current.getToolUseContext
                  const can = deferredResumeRefs.current.canUseTool
                  const model = deferredResumeRefs.current.mainLoopModel
                  if (!resume || !ctx || !can || !model) {
                    throw new Error('resume agent context not ready')
                  }
                  const r = await resume({
                    agentId: entry.agentId,
                    prompt: entry.description ?? '(resumed agent)',
                    toolUseContext: ctx(
                      messagesRef.current,
                      [],
                      new AbortController(),
                      model,
                    ) as never,
                    canUseTool: can,
                    continueInterruptedTurn: true,
                  })
                  const rec =
                    r && typeof r === 'object'
                      ? (r as {
                          alreadyCompleted?: boolean
                          outputFile?: string
                        })
                      : undefined
                  return {
                    alreadyCompleted: rec?.alreadyCompleted === true,
                    outputFile:
                      typeof rec?.outputFile === 'string' && rec.outputFile
                        ? rec.outputFile
                        : entry.outputFile,
                  }
                },
              }).catch(() => {
                /* best-effort */
              })
            } catch {
              /* best-effort */
            }
          }
        } catch {
          // best-effort claim
        }
      })()
      return () => {
        cancelled = true
      }
    }
  }, [setAppState, store, messageQueue, messagesRef, deferredResumeRefs])

  // Extract read file state from initialMessages on mount (CLI --resume / ResumeConversation)
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      restoreReadFileState(initialMessages, getOriginalCwd())
      void restoreRemoteAgentTasks({
        abortController: new AbortController(),
        getAppState: () => store.getState(),
        setAppState,
      })
      void (async () => {
        try {
          const { runOrphanAgentResumePass } = await import(
            '../../utils/orphanAgentResume.js'
          )
          const liveIds = new Set<string>()
          const liveTaskIds = new Set<string>()
          try {
            const tasksSnap = store.getState().tasks ?? {}
            for (const t of Object.values(tasksSnap) as Array<{
              type?: string
              agentId?: string
              id?: string
            }>) {
              if (typeof t?.id === 'string') liveTaskIds.add(t.id)
              if (t?.type === 'local_agent') {
                if (typeof t.agentId === 'string') liveIds.add(t.agentId)
                if (typeof t.id === 'string') liveIds.add(t.id)
              }
            }
          } catch {
            /* ignore */
          }
          await runOrphanAgentResumePass({
            messages: initialMessages as never,
            liveAgentIds: liveIds,
            liveTaskIds,
            getState: () => store.getState(),
            subscribe: listener => store.subscribe(listener),
            resumeAgent: async entry => {
              for (let i = 0; i < 40; i++) {
                if (
                  deferredResumeRefs.current.resumeAgentBackground &&
                  deferredResumeRefs.current.getToolUseContext &&
                  deferredResumeRefs.current.canUseTool &&
                  deferredResumeRefs.current.mainLoopModel
                ) {
                  break
                }
                await new Promise<void>(r => setTimeout(r, 50))
              }
              const resumeFn = deferredResumeRefs.current.resumeAgentBackground
              const ctx = deferredResumeRefs.current.getToolUseContext
              const can = deferredResumeRefs.current.canUseTool
              const model = deferredResumeRefs.current.mainLoopModel
              if (!resumeFn || !ctx || !can || !model) {
                throw new Error('resume agent context not ready')
              }
              const r = await resumeFn({
                agentId: entry.agentId,
                prompt: entry.description ?? '(resumed agent)',
                toolUseContext: ctx(
                  initialMessages,
                  [],
                  new AbortController(),
                  model,
                ) as never,
                canUseTool: can,
                continueInterruptedTurn: true,
              })
              const rec =
                r && typeof r === 'object'
                  ? (r as {
                      alreadyCompleted?: boolean
                      outputFile?: string
                    })
                  : undefined
              return {
                alreadyCompleted: rec?.alreadyCompleted === true,
                outputFile:
                  typeof rec?.outputFile === 'string' && rec.outputFile
                    ? rec.outputFile
                    : entry.outputFile,
              }
            },
          })
        } catch {
          /* best-effort */
        }
      })()
    }
    // Only run on mount - initialMessages shouldn't change during component lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
