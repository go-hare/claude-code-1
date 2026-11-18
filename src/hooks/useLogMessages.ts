import type { UUID } from 'crypto'
import { useEffect, useRef } from 'react'
import { useAppState } from '../state/AppState.js'
import type { Message } from '../types/message.js'
import { isAgentSwarmsEnabled } from '../utils/agentSwarmsEnabled.js'
import { findLastCompactBoundaryIndex } from '../utils/messages.js'
import {
  cleanMessagesForLogging,
  isChainParticipant,
  isLoggableMessage,
  recordTranscript,
} from '../utils/sessionStorage.js'

export type TranscriptWriter = typeof recordTranscript

type ParentWaitState = {
  next?: {
    messages: Message[]
    ignore: boolean
    teamName?: string
    selfAgentName?: string
  }
}

/**
 * Gold `MDe` state machine: tracks `holdFloor` across `ignore` (resume)
 * periods, `lastTailUuid` + `lastLoggable` for `isNonLoggableTailIntact`,
 * and `parentWait` serialization across full-array/compaction writes.
 */
export class TranscriptLogger {
  lastRecordedLength = 0
  lastParentUuid: UUID | undefined = undefined
  firstMessageUuid: UUID | undefined = undefined
  lastTailUuid: UUID | undefined = undefined
  lastLoggable: { index: number; uuid: UUID } | undefined = undefined
  callSequence = 0
  holdFloor = 0
  parentWait: ParentWaitState | undefined = undefined
  private readonly writeTranscript: TranscriptWriter

  constructor(writeTranscript: TranscriptWriter = recordTranscript) {
    this.writeTranscript = writeTranscript
  }

  write(
    messages: Message[],
    opts: {
      ignore?: boolean
      teamName?: string
      selfAgentName?: string
    } = {},
  ): Promise<void> | undefined {
    const { ignore = false, teamName, selfAgentName } = opts
    if (ignore) {
      this.holdFloor = messages.length
      return
    }
    if (this.parentWait !== undefined) {
      this.parentWait.next = { messages, ignore, teamName, selfAgentName }
      return
    }

    const currentFirstUuid = messages[0]?.uuid as UUID | undefined
    const prevLength = this.lastRecordedLength
    const wasFirstRender = this.firstMessageUuid === undefined
    const prevTail = messages[prevLength - 1]
    const tailIntact =
      prevLength === 0 ||
      (prevTail !== undefined &&
        prevTail.uuid === this.lastTailUuid &&
        !isLoggableMessage(prevTail)) ||
      this.isNonLoggableTailIntact(messages, prevLength)

    const isIncremental =
      currentFirstUuid !== undefined &&
      !wasFirstRender &&
      currentFirstUuid === this.firstMessageUuid &&
      prevLength <= messages.length &&
      tailIntact
    const isSameHeadShrink =
      currentFirstUuid !== undefined &&
      !wasFirstRender &&
      currentFirstUuid === this.firstMessageUuid &&
      prevLength > messages.length

    const startIndex = isIncremental ? prevLength : 0
    const floorIndex =
      isIncremental || wasFirstRender
        ? this.holdFloor
        : findLastCompactBoundaryIndex(messages)
    const effectiveStart = Math.max(startIndex, floorIndex)

    if (!isIncremental) {
      this.holdFloor = messages.length
    }
    this.lastTailUuid = messages[messages.length - 1]?.uuid as UUID | undefined

    let g = messages.length - 1
    while (g >= effectiveStart && !isLoggableMessage(messages[g]!)) {
      g--
    }
    if (g >= effectiveStart) {
      this.lastLoggable = {
        index: g,
        uuid: messages[g]!.uuid as UUID,
      }
    } else if (!isIncremental) {
      this.lastLoggable = undefined
    }

    if (messages.length <= effectiveStart) {
      return
    }

    const slice =
      effectiveStart === 0 ? messages : messages.slice(effectiveStart)
    const parentHint = isIncremental ? this.lastParentUuid : undefined
    const canSyncWalk = isIncremental || wasFirstRender || isSameHeadShrink
    const waitState: ParentWaitState | undefined = canSyncWalk ? undefined : {}

    const seq = ++this.callSequence
    const promise = this.writeTranscript(
      slice,
      isAgentSwarmsEnabled()
        ? {
            teamName,
            agentName: selfAgentName,
          }
        : {},
      parentHint,
      messages,
    ).then(
      lastRecordedUuid => {
        if (seq === this.callSequence && lastRecordedUuid && !canSyncWalk) {
          this.lastParentUuid = lastRecordedUuid as UUID
        }
        this.endParentWait(waitState)
      },
      () => {
        this.endParentWait(waitState)
      },
    )

    this.parentWait = waitState
    if (canSyncWalk) {
      const last = cleanMessagesForLogging(slice, messages).findLast(
        m => isChainParticipant(m) && isLoggableMessage(m),
      )
      if (last) {
        this.lastParentUuid = last.uuid as UUID
      }
    }
    this.lastRecordedLength = messages.length
    this.firstMessageUuid = currentFirstUuid
    return promise
  }

  private endParentWait(waitState: ParentWaitState | undefined): void {
    if (waitState === undefined || this.parentWait !== waitState) return
    this.parentWait = undefined
    const next = waitState.next
    if (next === undefined) return
    void this.write(next.messages, {
      ignore: next.ignore,
      teamName: next.teamName,
      selfAgentName: next.selfAgentName,
    })
  }

  isNonLoggableTailIntact(messages: Message[], prevLength: number): boolean {
    const last = this.lastLoggable
    if (last !== undefined && messages[last.index]?.uuid !== last.uuid) {
      return false
    }
    for (let i = last === undefined ? 0 : last.index + 1; i < prevLength; i++) {
      const m = messages[i]
      if (m === undefined || isLoggableMessage(m)) {
        return false
      }
    }
    return true
  }
}

/**
 * Hook that logs messages to the transcript
 * conversation ID that only changes when a new conversation is started.
 *
 * @param messages The current conversation messages
 * @param ignore When true, messages will not be recorded to the transcript
 */
export function useLogMessages(messages: Message[], ignore: boolean = false) {
  const teamContext = useAppState(s => s.teamContext)
  const loggerRef = useRef<TranscriptLogger | null>(null)
  if (loggerRef.current === null) {
    loggerRef.current = new TranscriptLogger()
  }

  useEffect(() => {
    void loggerRef.current?.write(messages, {
      ignore,
      teamName: teamContext?.teamName,
      selfAgentName: teamContext?.selfAgentName,
    })
  }, [messages, ignore, teamContext?.teamName, teamContext?.selfAgentName])
}
