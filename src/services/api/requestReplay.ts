/**
 * Official 2.1.300 (#816) — local session transcript request replay capture.
 *
 * Records each API request's system prompt, tools (`api-request-shape`),
 * deduplicated message blobs (`api-request-blob`), and request parameters
 * (`api-request`) so a shared transcript can reproduce a request.
 */

import { createHash, randomUUID } from 'crypto'
import { getSessionId } from '../../bootstrap/state.js'
import type { AgentId } from '../../types/ids.js'
import { logError } from '../../utils/log.js'
import {
  type RequestReplayRecords,
  writeRequestReplayRecords,
} from '../../utils/sessionStorage.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const MAX_CHAINS = 64

type ReplayChainState = {
  lastId: string
  lastHashes: string[]
  sessionId: string
}

const chains = new Map<string, ReplayChainState>()
const unrecordableShapes = new Set<string>()

function hashReplayPayload(value: unknown): string {
  return createHash('sha256').update(jsonStringify(value)).digest('hex')
}

export function buildRequestReplayRecords(input: {
  params: Record<string, unknown>
  querySource?: string
  agentId?: AgentId
  sessionId?: string
  version?: string
  previousChain?: ReplayChainState
}): { records: RequestReplayRecords; nextHashes: string[]; requestId: string } {
  const sessionId = input.sessionId ?? getSessionId()
  const system = input.params.system ?? null
  const tools = input.params.tools ?? null
  const messages = Array.isArray(input.params.messages)
    ? (input.params.messages as unknown[])
    : []

  const shape = { system, tools }
  const shapeHash = hashReplayPayload(shape)

  const filteredParams: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input.params)) {
    if (
      k === 'system' ||
      k === 'tools' ||
      k === 'messages' ||
      v === undefined
    ) {
      continue
    }
    filteredParams[k] = v
  }

  const messageHashes = messages.map(msg => hashReplayPayload(msg))
  let keep = 0
  if (
    input.previousChain !== undefined &&
    input.previousChain.sessionId === sessionId
  ) {
    const limit = Math.min(
      input.previousChain.lastHashes.length,
      messageHashes.length,
    )
    while (
      keep < limit &&
      input.previousChain.lastHashes[keep] === messageHashes[keep]
    ) {
      keep++
    }
  }

  const requestId = randomUUID()
  const records: RequestReplayRecords = {
    target: {
      sessionId,
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    },
    shapeHash,
    shape,
    blobCandidates: messages.slice(keep).map((message, idx) => ({
      hash: messageHashes[keep + idx]!,
      message,
    })),
    request: {
      type: 'api-request',
      sessionId,
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      id: requestId,
      timestamp: new Date().toISOString(),
      version: input.version ?? MACRO.VERSION,
      ...(input.querySource !== undefined
        ? { querySource: input.querySource }
        : {}),
      shapeHash,
      params: filteredParams,
      ...(keep > 0 && input.previousChain !== undefined
        ? { base: input.previousChain.lastId }
        : {}),
      keep,
      tail: messageHashes.slice(keep),
    },
  }

  return { records, nextHashes: messageHashes, requestId }
}

export function recordApiRequestForReplay(input: {
  params: Record<string, unknown>
  querySource?: string
  agentId?: AgentId
}): Promise<void> | undefined {
  try {
    const sessionId = getSessionId()
    const chainKey = input.agentId ?? sessionId
    const previousChain = chains.get(chainKey)
    const { records, nextHashes, requestId } = buildRequestReplayRecords({
      params: input.params,
      querySource: input.querySource,
      agentId: input.agentId,
      sessionId,
      previousChain,
    })

    if (unrecordableShapes.has(records.shapeHash)) {
      return undefined
    }

    return writeRequestReplayRecords(records).then(
      result => {
        if (result === 'written') {
          if (getSessionId() === sessionId) {
            chains.delete(chainKey)
            chains.set(chainKey, {
              lastId: requestId,
              lastHashes: nextHashes,
              sessionId,
            })
            if (chains.size > MAX_CHAINS) {
              const oldest = chains.keys().next().value
              if (oldest !== undefined) chains.delete(oldest)
            }
          }
        } else if (result === 'shape_too_large') {
          unrecordableShapes.add(records.shapeHash)
        }
      },
      err => {
        logError(err)
      },
    )
  } catch (err) {
    logError(err)
    return undefined
  }
}

export function clearRequestReplayChainsForTest(): void {
  chains.clear()
  unrecordableShapes.clear()
}
