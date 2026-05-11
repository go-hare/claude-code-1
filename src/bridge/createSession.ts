import {
  archiveBridgeSessionRuntime,
  createBridgeSessionRuntime,
  getBridgeSessionRuntime,
  updateBridgeSessionTitleRuntime,
} from '../runtime/capabilities/bridge/SessionApi.js'

export const createBridgeSession = createBridgeSessionRuntime
export const getBridgeSession = getBridgeSessionRuntime

export async function archiveBridgeSession(
  sessionId: string,
  opts?: {
    baseUrl?: string
    getAccessToken?: () => string | undefined
    timeoutMs?: number
  },
): Promise<void> {
  await archiveBridgeSessionRuntime(sessionId, opts)
}

export async function updateBridgeSessionTitle(
  sessionId: string,
  title: string,
  opts?: { baseUrl?: string; getAccessToken?: () => string | undefined },
): Promise<void> {
  await updateBridgeSessionTitleRuntime(sessionId, title, opts)
}
