/**
 * BgEngine — cross-platform background session engine abstraction.
 *
 * Implementations:
 *   TmuxEngine    — macOS/Linux with tmux installed
 *   DetachedEngine — Windows, or macOS/Linux without tmux (fallback)
 */

export interface SessionEntry {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  kind: string
  name?: string
  logPath?: string
  entrypoint?: string
  status?: string
  waitingFor?: string
  updatedAt?: number
  bridgeSessionId?: string
  agent?: string
  tmuxSessionName?: string
  engine?: 'tmux' | 'detached'
  pinned?: boolean
  gitBranch?: string
  prNumber?: number
  prRepository?: string
  /** PR review state — set when session has open PR needing review */
  prReviewState?: 'pending' | 'changes_requested' | 'approved' | 'draft'
  messagingSocketPath?: string
  lastMessage?: string
}

export interface BgStartOptions {
  sessionName: string
  args: string[]
  env: Record<string, string | undefined>
  logPath: string
  cwd: string
}

export interface BgStartResult {
  pid: number
  sessionName: string
  logPath: string
  engineUsed: 'tmux' | 'detached'
}

/** Result of engine attach (portable stand-in for official APC attach). */
export type BgAttachResult = {
  outcome: 'detached' | 'error'
  /** True when detach is the GCp-equivalent interactive detach. */
  viaApc?: boolean
  msg?: string
}

export interface BgEngine {
  readonly name: 'tmux' | 'detached'
  /** Whether the engine provides a TTY for interactive REPL input. */
  readonly supportsInteractiveInput: boolean
  available(): Promise<boolean>
  start(opts: BgStartOptions): Promise<BgStartResult>
  /**
   * Attach to a live session. DetachedEngine returns a TailAttachResult so
   * attachHandler can gate AgentsView (official GCp). Tmux may return void.
   */
  attach(session: SessionEntry): Promise<BgAttachResult | undefined>
}
