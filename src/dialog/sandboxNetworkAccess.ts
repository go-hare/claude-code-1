/**
 * densable K8c / FRr — sandbox_network_access via requestDialog (+ optional bridge race).
 *
 * Gold: Zxs / K8c.ask → requestDialog(FRr,{host,port},{signal,queueBehind:!0}).
 * Same-host inFlight coalescing; bridge abort → cancelled then o??false.
 */
import { randomUUID } from 'crypto'
import { WEB_FETCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebFetchTool/prompt.js'
import { SANDBOX_NETWORK_ACCESS_TOOL_NAME } from '../cli/structuredIO.js'
import {
  normalizeSandboxSessionHost,
  SandboxManager,
} from '../utils/sandbox/sandbox-adapter.js'
import type { NetworkHostPattern } from '../utils/sandbox/sandbox-adapter.js'
import type { PermissionUpdate } from '../utils/permissions/PermissionUpdateSchema.js'
import type { RequestDialog } from './requestDialog.js'
import { sandboxNetworkAccessSpec } from './specs/jsuKinds.js'

export type SandboxNetworkAccessResult =
  | {
      allow: boolean
      persistToSettings: boolean
      persistRow?: { applies: PermissionUpdate[] }
    }
  | 'cancelled'

export type SandboxBridgePermissionCallbacks = {
  sendRequest: (
    requestId: string,
    toolName: string,
    input: Record<string, unknown>,
    parentToolUseId: string,
    description: string,
  ) => void
  onResponse: (
    requestId: string,
    callback: (response: { behavior: string }) => void,
  ) => () => void
  cancelRequest: (requestId: string) => void
}

export type SandboxNetworkAccessAskerDeps = {
  requestDialog: RequestDialog
  getBridge: () => SandboxBridgePermissionCallbacks | null | undefined
  applyPermissionUpdate: (update: PermissionUpdate) => void
}

/**
 * densable m2A — yes-dont-ask-again mints WebFetch domain: persistRow for K8c.
 * Bracket IPv6 via normalizeSandboxSessionHost (KXt).
 */
export function mintSandboxNetworkPersistRow(host: string): {
  applies: PermissionUpdate[]
} {
  return {
    applies: [
      {
        type: 'addRules',
        rules: [
          {
            toolName: WEB_FETCH_TOOL_NAME,
            ruleContent: `domain:${normalizeSandboxSessionHost(host)}`,
          },
        ],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
  }
}

/**
 * densable m2A / FRr answer arm — attach persistRow when UI chose durable allow.
 */
export function withSandboxNetworkPersistRow(
  response: SandboxNetworkAccessResult,
  host: string,
): SandboxNetworkAccessResult {
  if (
    response === 'cancelled' ||
    !response.allow ||
    !response.persistToSettings
  ) {
    return response
  }
  return {
    allow: true,
    persistToSettings: true,
    persistRow: mintSandboxNetworkPersistRow(host),
  }
}

/** densable K8c — gold prompt has no Vce/msf emit (REPL watches DialogStore FRr). */
export class SandboxNetworkAccessAsker {
  private readonly deps: SandboxNetworkAccessAskerDeps
  private readonly inFlight = new Map<string, Promise<boolean>>()

  constructor(deps: SandboxNetworkAccessAskerDeps) {
    this.deps = deps
  }

  /** densable kc.current.clear — drop coalesced promises (e.g. session reset). */
  clear(): void {
    this.inFlight.clear()
  }

  /**
   * densable K8c.ask(hostPattern, raceBridge=true).
   * Returns whether the connection is allowed.
   */
  ask(hostPattern: NetworkHostPattern, raceBridge = true): Promise<boolean> {
    const host = hostPattern.host
    const existing = this.inFlight.get(host)
    if (existing) return existing
    const pending = this.prompt(hostPattern, raceBridge).finally(() => {
      this.inFlight.delete(host)
    })
    this.inFlight.set(host, pending)
    return pending
  }

  private async prompt(
    { host, port }: NetworkHostPattern,
    raceBridge: boolean,
  ): Promise<boolean> {
    const abort = new AbortController()
    let bridgeAllow: boolean | undefined
    let cleanupBridge: (keepRemote: boolean) => void = () => {}

    const bridge = raceBridge ? this.deps.getBridge() : undefined
    if (bridge) {
      const bridgeRequestId = randomUUID()
      bridge.sendRequest(
        bridgeRequestId,
        SANDBOX_NETWORK_ACCESS_TOOL_NAME,
        { host },
        randomUUID(),
        `Allow network connection to ${host}?`,
      )
      const unsubscribe = bridge.onResponse(bridgeRequestId, response => {
        bridgeAllow = response.behavior === 'allow'
        abort.abort()
      })
      cleanupBridge = (keepRemote: boolean) => {
        unsubscribe()
        if (!keepRemote) bridge.cancelRequest(bridgeRequestId)
      }
    }

    const result = (await this.deps.requestDialog(
      sandboxNetworkAccessSpec,
      { host, port },
      { signal: abort.signal, queueBehind: true },
    )) as SandboxNetworkAccessResult

    cleanupBridge(bridgeAllow !== undefined)

    if (result === 'cancelled') {
      if (bridgeAllow) SandboxManager.addSessionAllowedHost(host)
      return bridgeAllow ?? false
    }

    const { allow, persistToSettings, persistRow } = result
    if (
      persistToSettings &&
      allow &&
      persistRow !== undefined &&
      Array.isArray(persistRow.applies)
    ) {
      for (const update of persistRow.applies) {
        this.deps.applyPermissionUpdate(update)
      }
      SandboxManager.addSessionAllowedHost(host)
    } else if (allow) {
      SandboxManager.addSessionAllowedHost(host)
    }
    return allow
  }
}
