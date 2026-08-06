/**
 * densable EEf / vEf — remote request_user_dialog host dispatch.
 *
 * Binary class path (~245779201): parks each request_id with AbortController,
 * looks up R5b[dialog_kind], invokes requestDialog(spec, payload, {signal}),
 * maps result → RemoteUserDialogResponse via sendResponse.
 *
 * densable R5b only registers O5 = refusal_fallback_prompt for this remote
 * path (other kinds cancel immediately).
 */

import { useCallback, useEffect, useRef } from 'react'
import type { SDKControlRequest } from '../entrypoints/sdk/controlTypes.js'
import type { RemoteUserDialogResponse } from '../remote/RemoteSessionManager.js'
import {
  REFUSAL_FALLBACK_DIALOG_KIND,
  type RefusalFallbackResult,
} from '../utils/printRequestDialog.js'
import { logForDebugging } from '../utils/debug.js'

export type RemoteRequestDialog = (
  spec: {
    kind: string
    default: unknown
    result?: () => {
      safeParse: (v: unknown) => { success: boolean; data?: unknown }
    }
  },
  payload: unknown,
  options?: { signal?: AbortSignal },
) => Promise<unknown>

type DialogHandler = (
  requestDialog: RemoteRequestDialog | undefined,
  payload: unknown,
  options: { signal: AbortSignal },
) => Promise<RemoteUserDialogResponse>

/** densable O5.payload shape (refusal_fallback_prompt). */
function parseRefusalFallbackPayload(payload: unknown): {
  originalModel: string
  fallbackModel: string
  apiRefusalCategory?: string | null
  guidanceText?: string
  retractedMessageUuids?: string[]
} | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  if (
    typeof p.originalModel !== 'string' ||
    typeof p.fallbackModel !== 'string'
  ) {
    return null
  }
  return {
    originalModel: p.originalModel,
    fallbackModel: p.fallbackModel,
    ...(p.apiRefusalCategory === undefined
      ? {}
      : { apiRefusalCategory: p.apiRefusalCategory as string | null }),
    ...(typeof p.guidanceText === 'string'
      ? { guidanceText: p.guidanceText }
      : {}),
    ...(Array.isArray(p.retractedMessageUuids)
      ? {
          retractedMessageUuids: p.retractedMessageUuids.filter(
            (u): u is string => typeof u === 'string',
          ),
        }
      : {}),
  }
}

const REFUSAL_FALLBACK_SPEC = {
  kind: REFUSAL_FALLBACK_DIALOG_KIND,
  default: 'cancelled' as const satisfies RefusalFallbackResult,
  result: () => ({
    safeParse: (v: unknown) => {
      if (v === 'retry_fallback' || v === 'edit_prompt' || v === 'cancelled') {
        return { success: true as const, data: v }
      }
      return { success: false as const }
    },
  }),
}

/** densable R5b — only O5 for remote EEf. Exported for unit tests. */
export const REMOTE_USER_DIALOG_HANDLERS: Record<string, DialogHandler> = {
  [REFUSAL_FALLBACK_DIALOG_KIND]: async (requestDialog, payload, options) => {
    const parsed = parseRefusalFallbackPayload(payload)
    if (!parsed) return { behavior: 'cancelled' }
    if (!requestDialog) return { behavior: 'cancelled' }
    const choice = await requestDialog(REFUSAL_FALLBACK_SPEC, parsed, options)
    if (choice === 'cancelled') return { behavior: 'cancelled' }
    return { behavior: 'completed', result: choice }
  },
}

export type UseRemoteUserDialogArgs = {
  sessionKey: string | undefined
  sendResponse: (requestId: string, result: RemoteUserDialogResponse) => void
  requestDialog?: RemoteRequestDialog
}

export type UseRemoteUserDialogResult = {
  /** densable EEf.dispatch — feed a full control_request envelope. */
  dispatch: (request: SDKControlRequest) => void
  /** densable EEf.cancel — abort parked dialog AbortController. */
  cancel: (requestId: string) => void
}

/**
 * densable EEf — host-side request_user_dialog dispatch for remote sessions.
 */
export function useRemoteUserDialog({
  sessionKey,
  sendResponse,
  requestDialog,
}: UseRemoteUserDialogArgs): UseRemoteUserDialogResult {
  const sendResponseRef = useRef(sendResponse)
  sendResponseRef.current = sendResponse
  const requestDialogRef = useRef(requestDialog)
  requestDialogRef.current = requestDialog
  const controllersRef = useRef(new Map<string, AbortController>())

  const dispatch = useCallback((request: SDKControlRequest) => {
    if (request.request.subtype !== 'request_user_dialog') return
    const { request: inner, request_id: requestId } = request
    const handler = REMOTE_USER_DIALOG_HANDLERS[inner.dialog_kind]
    if (!handler) {
      // densable: unknown kind → immediate cancel response
      logForDebugging(
        `[useRemoteUserDialog] Unknown dialog_kind ${inner.dialog_kind} — cancelling`,
      )
      sendResponseRef.current(requestId, { behavior: 'cancelled' })
      return
    }
    const controllers = controllersRef.current
    const ac = new AbortController()
    controllers.set(requestId, ac)
    void handler(requestDialogRef.current, inner.payload, {
      signal: ac.signal,
    })
      .then(result => {
        if (!controllers.delete(requestId)) return
        sendResponseRef.current(requestId, result)
      })
      .catch(() => {
        if (!controllers.delete(requestId)) return
        sendResponseRef.current(requestId, { behavior: 'cancelled' })
      })
  }, [])

  const cancel = useCallback((requestId: string) => {
    const ac = controllersRef.current.get(requestId)
    if (ac) {
      controllersRef.current.delete(requestId)
      ac.abort()
    }
  }, [])

  useEffect(() => {
    const controllers = controllersRef.current
    return () => {
      for (const [id, ac] of controllers) {
        controllers.delete(id)
        ac.abort()
      }
    }
  }, [sessionKey])

  return { dispatch, cancel }
}
