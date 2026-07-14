/**
 * Official Imn nested-chain idle densable subset.
 *
 * waitingOnUser = requires_action && mainLoopRefcount - nestedBlockedChainCount <= 0
 * notifyNestedPromptBlocking is a no-op when CLAUDE_CODE_DISABLE_NESTED_CHAIN_IDLE.
 * Full session-state machine remains denser in sessionState.ts; this class is pure.
 */

import { isNestedChainIdleDisabled } from './residualMoreEnvGates.js'

export type NestedChainIdleState = 'idle' | 'running' | 'requires_action'

export type NestedChainIdleTrackerOptions = {
  onWaitingOnUserChanged?: (waiting: boolean) => void
  /** Invoked once when nestedBlockedChainCount exceeds mainLoopRefcount. */
  onChainExcess?: (info: {
    nestedBlockedChainCount: number
    mainLoopRefcount: number
    sessionState: NestedChainIdleState
  }) => void
  /** Injected for tests; defaults to isNestedChainIdleDisabled(). */
  isDisabled?: () => boolean
}

/**
 * Official nested-chain idle tracker densable (Imn methods for nested chains).
 */
export class NestedChainIdleTracker {
  currentState: NestedChainIdleState = 'idle'
  mainLoopRefcount = 0
  nestedBlockedChains: Record<string, number> = {}
  nestedBlockedChainCount = 0
  droppedChainAgentIds: Record<string, boolean> = {}
  lastWaitingOnUser = false
  chainExcessLogged = false

  private readonly onWaitingOnUserChanged?: (waiting: boolean) => void
  private readonly onChainExcess?: NestedChainIdleTrackerOptions['onChainExcess']
  private readonly isDisabled: () => boolean

  constructor(options: NestedChainIdleTrackerOptions = {}) {
    this.onWaitingOnUserChanged = options.onWaitingOnUserChanged
    this.onChainExcess = options.onChainExcess
    this.isDisabled = options.isDisabled ?? (() => isNestedChainIdleDisabled())
  }

  /**
   * Official waitingOnUser:
   * requires_action && mainLoopRefcount - nestedBlockedChainCount <= 0
   */
  get waitingOnUser(): boolean {
    return (
      this.currentState === 'requires_action' &&
      this.mainLoopRefcount - this.nestedBlockedChainCount <= 0
    )
  }

  setMainLoopRefcount(n: number): void {
    this.mainLoopRefcount = n
    this.emitIfWaitingChanged()
  }

  setState(state: NestedChainIdleState): void {
    this.currentState = state
    // Official notifyStateChanged seeds lastWaitingOnUser before listeners.
    this.lastWaitingOnUser = this.waitingOnUser
  }

  emitIfWaitingChanged(): void {
    this.checkChainInvariant()
    const waiting = this.waitingOnUser
    if (waiting !== this.lastWaitingOnUser) {
      this.lastWaitingOnUser = waiting
      this.onWaitingOnUserChanged?.(waiting)
    }
  }

  /** Official reteeWaitingOnUser — force re-emit current value. */
  reteeWaitingOnUser(): void {
    this.onWaitingOnUserChanged?.(this.waitingOnUser)
  }

  checkChainInvariant(): void {
    if (this.nestedBlockedChainCount - this.mainLoopRefcount > 0) {
      if (!this.chainExcessLogged) {
        this.chainExcessLogged = true
        this.onChainExcess?.({
          nestedBlockedChainCount: this.nestedBlockedChainCount,
          mainLoopRefcount: this.mainLoopRefcount,
          sessionState: this.currentState,
        })
      }
    } else {
      this.chainExcessLogged = false
    }
  }

  /**
   * Official notifyNestedPromptBlocking — no-op when DISABLE_NESTED_CHAIN_IDLE
   * or agent was dropped.
   */
  notifyNestedPromptBlocking(agentId: string): void {
    if (this.isDisabled()) return
    if (this.droppedChainAgentIds[agentId]) return
    const prev = this.nestedBlockedChains[agentId] ?? 0
    this.nestedBlockedChains[agentId] = prev + 1
    if (prev === 0) this.nestedBlockedChainCount++
    this.emitIfWaitingChanged()
  }

  notifyNestedPromptUnblocking(agentId: string): void {
    const next = (this.nestedBlockedChains[agentId] ?? 0) - 1
    if (next > 0) {
      this.nestedBlockedChains[agentId] = next
    } else if (this.nestedBlockedChains[agentId] !== undefined) {
      delete this.nestedBlockedChains[agentId]
      if (this.nestedBlockedChainCount > 0) this.nestedBlockedChainCount--
    }
    this.emitIfWaitingChanged()
  }

  dropNestedBlockedChain(agentId: string): void {
    this.droppedChainAgentIds[agentId] = true
    if (this.nestedBlockedChains[agentId] !== undefined) {
      delete this.nestedBlockedChains[agentId]
      if (this.nestedBlockedChainCount > 0) this.nestedBlockedChainCount--
      this.emitIfWaitingChanged()
    }
  }

  reset(): void {
    this.currentState = 'idle'
    this.mainLoopRefcount = 0
    this.nestedBlockedChains = {}
    this.nestedBlockedChainCount = 0
    this.droppedChainAgentIds = {}
    this.lastWaitingOnUser = false
    this.chainExcessLogged = false
  }
}
