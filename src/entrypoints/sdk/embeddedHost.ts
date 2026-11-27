/**
 * Public Multi-Tenant Embedded Host SDK (Official 2.1.331 architecture).
 *
 * Hosts multiple concurrent, fully isolated Claude Code tenants inside a single
 * Node.js or Bun process using `SessionHost` + `AsyncLocalStorage` (`sessionContextAls`,
 * `cwdAls`), per-host `StorageV5` pinning, CCS/diskless guards, cross-process
 * `Tool.create(deps)` + `RemoteNativeToolRunner` routing, `RootSessionSlot`
 * project forking, and `TurnHandoffManager` state transitions.
 */

import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { cwd as processCwd } from 'node:process'
import {
  getTurnHandoffManager,
  type TurnHandoffManager,
} from '../../cli/turnHandoffStateMachine.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  attachRemoteNativeToolBridge as attachBridgeToSession,
  type RemoteNativeToolBridgeHandle,
} from '../../services/tools/remoteNativeToolBridge.js'
import type {
  Tool,
  ToolCallProgress,
  ToolPermissionContext,
  ToolProgressData,
  ToolResult,
  ToolUseContext,
} from '../../Tool.js'
import type { AgentId } from '../../types/ids.js'
import type { AssistantMessage } from '../../types/message.js'
import {
  runCleanupFunctions,
  runPreExitFlush,
} from '../../utils/cleanupRegistry.js'
import { runWithCwd } from '../../utils/cwd.js'
import { isAbortError } from '../../utils/errors.js'
import { FileStateCache } from '../../utils/fileStateCache.js'
import {
  acquireSharedBackendMode,
  runWithSession,
} from '../../utils/sessionContextAls.js'
import {
  createSessionHost,
  type HostClock,
  holdGatewayHostStrict,
  releaseGatewayHost,
  type SessionHost,
  setGatewayRequiredByHostPolicyReader,
  setHostOtelState,
  setHostRendersChromeSetupOffer,
  setTenantMcpClientsAccessor,
  type ToolsMachineInfo,
} from '../../utils/sessionHost.js'
import { createRootSession, type Session } from '../../utils/sessionRoot.js'
import {
  createMemoryStorageV5Backend,
  pinCredentialsStore,
  pinInjectedStorageV5,
  type StorageV5,
} from '../../utils/storageV5/index.js'
import {
  assertNativeToolCanRunLocally,
  createDefaultCanUseTool,
  createExplicitToolDeps,
  createToolCallContext,
  dispatchRemoteNativeToolCall,
  getRemoteNativeToolRunner,
  hasRemoteNativeToolCheck,
  NativeToolElsewhereError,
  NeverRunsInThisProcessError,
  type RemoteNativeToolCheck,
  type RemoteNativeToolRunner,
  registerRemoteNativeToolRunner,
  resolveToolUseContext,
  sanitizeRemoteWireText,
  type ToolCallContext,
  type ToolCallExecutionOptions,
  type ToolDeps,
} from '../../utils/toolCreateRuntime.js'

const DEFAULT_DISKLESS_CWD = '/workspace'
const DEFAULT_READ_FILE_STATE_MAX_ENTRIES = 100
const DEFAULT_READ_FILE_STATE_MAX_BYTES = 25 * 1024 * 1024

function normalizeDirectRemoteNativeToolError(err: unknown): Error {
  if (
    err instanceof NativeToolElsewhereError ||
    err instanceof NeverRunsInThisProcessError ||
    isAbortError(err)
  ) {
    return err instanceof Error
      ? err
      : new NativeToolElsewhereError(String(err))
  }
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : String(err)
  const sanitized = sanitizeRemoteWireText(rawMessage)
  if (err instanceof Error && Object.isExtensible(err)) {
    const desc = Object.getOwnPropertyDescriptor(err, 'message')
    if (desc === undefined || desc.configurable !== false) {
      try {
        Object.defineProperty(err, 'message', {
          value: sanitized,
          writable: true,
          configurable: true,
        })
        return err
      } catch {
        // Fall through to sanitized NativeToolElsewhereError
      }
    }
  }
  return new NativeToolElsewhereError(sanitized)
}

// ============================================================================
// Public Types
// ============================================================================

export type EmbeddedRemoteNativeToolConfig = {
  runner: RemoteNativeToolRunner
  remoteCheck?: RemoteNativeToolCheck
}

export type EmbeddedHostOptions = {
  /** Logical identifier for this tenant/host (defaults to a random UUID). */
  tenantId?: string
  /**
   * Run this host in diskless / CCS tenant mode (`launchOptions.diskless()`).
   * Defaults to `false`. When `true` and no `storageV5` is provided, an
   * isolated in-memory `StorageV5` backend is created automatically unless
   * `autoMemoryStorage === false`.
   */
  diskless?: boolean
  /**
   * Automatically create an isolated `createMemoryStorageV5Backend()` when
   * `diskless` is `true` and `storageV5` is omitted. Defaults to `true`.
   */
  autoMemoryStorage?: boolean
  /** Custom `StorageV5` backend pinned exclusively to this host via ALS. */
  storageV5?: StorageV5
  /** Optional custom clock injected into `SessionHost.clock`. */
  clock?: HostClock
  /**
   * Alias for `diskless` (in official 2.1.331 `isCcsTenant()` reads
   * `launchOptions.diskless()`). Ignored if `diskless` is explicitly set.
   */
  ccsTenant?: boolean
  desktopAppHostsTenant?: boolean
  toolsMayBeOnHost?: boolean
  toolsConfirmedOnHost?: boolean
  toolsMachine?: ToolsMachineInfo
  hostPolicyVerdict?: boolean
  hostOtelState?: unknown
  sdkPerTaskStopAffordance?: boolean
  hostRendersChromeSetupOffer?: boolean
  gatewayRequiredByHostPolicy?: (host: string) => boolean
  strictGatewayHosts?: readonly string[]
  tenantMcpClientsAccessor?: () => readonly unknown[]
  /**
   * Opt this host into shared-backend mode (acquires a ref-counted lease while
   * active, released cleanly on `dispose()`). Defaults to `true`.
   */
  sharedBackend?: boolean
}

export type EmbeddedSessionOptions = {
  sessionId?: string
  cwd?: string
  projectDir?: string
  permissionContext?: ToolPermissionContext
  remoteNativeToolBridge?: RemoteNativeToolBridgeHandle
  remoteNativeTools?: Record<string, EmbeddedRemoteNativeToolConfig>
}

export type EmbeddedExecuteToolOptions = {
  signal?: AbortSignal
  toolUseId?: string
  agentId?: string
  permissionCheckedFor?: RemoteNativeToolRunner | null
  runnerCheckedHere?: RemoteNativeToolRunner
}

export type EmbeddedExecutableTool<
  TInput = unknown,
  TOutput = unknown,
  P extends ToolProgressData = ToolProgressData,
> =
  | {
      readonly name: string
      readonly outputSchema?: Tool['outputSchema']
      readonly outputSchemaAcrossProcesses?: Tool['outputSchemaAcrossProcesses']
      readonly isReadOnly?: (input: TInput) => boolean
      readonly fromAnotherProcess?: Tool['fromAnotherProcess']
      readonly create?: (deps: ToolDeps) => {
        call: (
          args: TInput,
          callCtx: ToolCallContext<P>,
        ) => Promise<ToolResult<TOutput>>
      }
      readonly call: (
        args: TInput,
        context: ToolUseContext,
        canUseTool: CanUseToolFn,
        parentMessage: AssistantMessage,
        onProgress?: ToolCallProgress<P>,
        opts?: ToolCallExecutionOptions,
      ) => Promise<ToolResult<TOutput>>
    }
  | {
      readonly name: string
      readonly outputSchema?: Tool['outputSchema']
      readonly outputSchemaAcrossProcesses?: Tool['outputSchemaAcrossProcesses']
      readonly isReadOnly?: (input: TInput) => boolean
      readonly fromAnotherProcess?: Tool['fromAnotherProcess']
      readonly create: (deps: ToolDeps) => {
        call: (
          args: TInput,
          callCtx: ToolCallContext<P>,
        ) => Promise<ToolResult<TOutput>>
      }
      readonly call?: undefined
    }

export type EmbeddedSession = {
  readonly session: Session
  readonly host: EmbeddedHost
  readonly sessionId: string
  readonly cwd: string
  readonly disposed: boolean
  run<T>(fn: () => T | Promise<T>): Promise<T>
  forkProject(projectDir: string): EmbeddedSession
  registerRemoteNativeTool(
    toolName: string,
    runner: RemoteNativeToolRunner,
    opts?: { remoteCheck?: RemoteNativeToolCheck },
  ): () => void
  attachRemoteNativeToolBridge(bridge: RemoteNativeToolBridgeHandle): () => void
  createToolDeps(overrides?: Partial<ToolDeps>): ToolDeps
  executeTool<
    TInput,
    TOutput = unknown,
    P extends ToolProgressData = ToolProgressData,
  >(
    tool: EmbeddedExecutableTool<TInput, TOutput, P>,
    input: TInput,
    opts?: EmbeddedExecuteToolOptions,
  ): Promise<ToolResult<TOutput>>
  getTurnHandoffManager(): TurnHandoffManager
  dispose(): Promise<void>
}

export type EmbeddedHost = {
  readonly host: SessionHost
  readonly tenantId: string
  readonly diskless: boolean
  readonly storageV5: StorageV5 | undefined
  readonly disposed: boolean
  createSession(options?: EmbeddedSessionOptions): EmbeddedSession
  run<T>(fn: () => T | Promise<T>): Promise<T>
  listSessions(): readonly EmbeddedSession[]
  dispose(): Promise<void>
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeNfc(value: string): string {
  return value.normalize('NFC')
}

function resolveDefaultSessionCwd(diskless: boolean): string {
  if (diskless) {
    return DEFAULT_DISKLESS_CWD
  }
  if (typeof process === 'undefined' || typeof process.cwd !== 'function') {
    return ''
  }
  const caller = process.env.CLAUDE_CODE_CALLER_CWD?.trim()
  const raw = caller && caller.length > 0 ? caller : processCwd()
  try {
    return normalizeNfc(realpathSync(raw))
  } catch {
    return normalizeNfc(raw)
  }
}

// ============================================================================
// Factory Implementation
// ============================================================================

/**
 * Create an isolated, multi-tenant `EmbeddedHost` backed by its own
 * `SessionHost`, per-host `StorageV5`, CCS launch options, and cleanup lifecycle.
 */
export function createEmbeddedHost(
  options: EmbeddedHostOptions = {},
): EmbeddedHost {
  const tenantId = options.tenantId ?? randomUUID()
  const diskless = Boolean(options.diskless ?? options.ccsTenant ?? false)
  const ownsStorageV5 =
    options.storageV5 === undefined &&
    diskless &&
    options.autoMemoryStorage !== false
  const storageV5: StorageV5 | undefined =
    options.storageV5 !== undefined
      ? options.storageV5
      : ownsStorageV5
        ? createMemoryStorageV5Backend()
        : undefined
  const strictGatewayHosts = options.strictGatewayHosts
    ? [...options.strictGatewayHosts]
    : []
  const sdkPerTaskStopAffordance = options.sdkPerTaskStopAffordance
  const participateInSharedBackend = options.sharedBackend !== false

  const sessionHost = createSessionHost(
    options.clock !== undefined ? { clock: options.clock } : undefined,
  )

  sessionHost.launchOptions.replaceDiskless(diskless)
  if (options.desktopAppHostsTenant !== undefined) {
    sessionHost.launchOptions.replaceDesktopAppHostsTenant(
      options.desktopAppHostsTenant,
    )
  }
  if (options.toolsMayBeOnHost !== undefined) {
    sessionHost.launchOptions.replaceToolsMayBeOnHost(options.toolsMayBeOnHost)
  }
  if (options.toolsConfirmedOnHost !== undefined) {
    sessionHost.launchOptions.replaceToolsConfirmedOnHost(
      options.toolsConfirmedOnHost,
    )
  }
  if (options.toolsMachine !== undefined) {
    sessionHost.launchOptions.replaceToolsMachine(options.toolsMachine)
  }
  if (options.hostPolicyVerdict !== undefined) {
    sessionHost.settingsSource.replaceHostPolicyVerdict(
      options.hostPolicyVerdict,
    )
  }

  const hostDefaultCwd = resolveDefaultSessionCwd(diskless)
  const hostRootSession = createRootSession({
    host: sessionHost,
    id: `host-root:${tenantId}`,
    project: {
      originalCwd: hostDefaultCwd,
      projectRoot: hostDefaultCwd,
      cwd: hostDefaultCwd,
    },
  })

  if (sdkPerTaskStopAffordance !== undefined) {
    hostRootSession.surfaceCapabilities.declarePerTaskStopAffordance(
      sdkPerTaskStopAffordance,
    )
  }

  // Initialize HostSlot-backed state exclusively on this SessionHost inside ALS.
  runWithSession(hostRootSession, () => {
    pinInjectedStorageV5(storageV5)
    pinCredentialsStore(undefined)
    if (options.hostOtelState !== undefined) {
      setHostOtelState(options.hostOtelState)
    }
    if (options.hostRendersChromeSetupOffer !== undefined) {
      setHostRendersChromeSetupOffer(options.hostRendersChromeSetupOffer)
    }
    if (options.gatewayRequiredByHostPolicy !== undefined) {
      setGatewayRequiredByHostPolicyReader(options.gatewayRequiredByHostPolicy)
    }
    for (const hostName of strictGatewayHosts) {
      holdGatewayHostStrict(hostName)
    }
    if (options.tenantMcpClientsAccessor !== undefined) {
      setTenantMcpClientsAccessor(options.tenantMcpClientsAccessor)
    }
  })

  const releaseSharedBackendLease = participateInSharedBackend
    ? acquireSharedBackendMode()
    : undefined

  let hostDisposed = false
  let hostDisposePromise: Promise<void> | undefined
  const activeSessions = new Set<EmbeddedSession>()

  function assertHostActive(): void {
    if (hostDisposed) {
      throw new Error(`EmbeddedHost "${tenantId}" has been disposed`)
    }
  }

  function wrapSession(
    session: Session,
    permissionContext: ToolPermissionContext | undefined,
    initialBridge: RemoteNativeToolBridgeHandle | undefined,
    initialRemoteTools:
      | Record<string, EmbeddedRemoteNativeToolConfig>
      | undefined,
    onDisposed?: () => void,
  ): EmbeddedSession {
    let sessionDisposed = false
    let sessionDisposePromise: Promise<void> | undefined
    const detachers = new Set<() => void>()
    const childForks = new Set<EmbeddedSession>()
    const readFileState = new FileStateCache(
      DEFAULT_READ_FILE_STATE_MAX_ENTRIES,
      DEFAULT_READ_FILE_STATE_MAX_BYTES,
    )

    function assertSessionActive(): void {
      if (sessionDisposed || hostDisposed) {
        throw new Error(`EmbeddedSession "${session.id}" has been disposed`)
      }
    }

    function registerDetacher(rawDetach: () => void): () => void {
      let called = false
      const detach = () => {
        if (called) return
        called = true
        detachers.delete(detach)
        rawDetach()
      }
      detachers.add(detach)
      return detach
    }

    const embeddedSession: EmbeddedSession = {
      session,
      get host(): EmbeddedHost {
        return embeddedHost
      },
      get sessionId(): string {
        return session.id
      },
      get cwd(): string {
        return session.project.cwd
      },
      get disposed(): boolean {
        return sessionDisposed || hostDisposed
      },

      async run<T>(fn: () => T | Promise<T>): Promise<T> {
        assertSessionActive()
        const sessionCwd = session.project.cwd
        return await runWithSession(session, () =>
          sessionCwd.length > 0 ? runWithCwd(sessionCwd, fn) : fn(),
        )
      },

      forkProject(projectDir: string): EmbeddedSession {
        assertSessionActive()
        const normalizedDir = normalizeNfc(projectDir)
        const forked = session.withProject({
          cwd: normalizedDir,
          projectRoot: normalizedDir,
          originalCwd: normalizedDir,
        })
        const child = wrapSession(
          forked,
          permissionContext,
          undefined,
          undefined,
          () => {
            childForks.delete(child)
          },
        )
        childForks.add(child)
        return child
      },

      registerRemoteNativeTool(
        toolName: string,
        runner: RemoteNativeToolRunner,
        opts?: { remoteCheck?: RemoteNativeToolCheck },
      ): () => void {
        assertSessionActive()
        const rawUnregister = registerRemoteNativeToolRunner(
          session,
          toolName,
          runner,
          opts?.remoteCheck,
        )
        return registerDetacher(rawUnregister)
      },

      attachRemoteNativeToolBridge(
        bridge: RemoteNativeToolBridgeHandle,
      ): () => void {
        assertSessionActive()
        const rawDetach = attachBridgeToSession(session, bridge)
        return registerDetacher(rawDetach)
      },

      createToolDeps(overrides?: Partial<ToolDeps>): ToolDeps {
        assertSessionActive()
        return createExplicitToolDeps({
          session,
          cwd: () => session.project.cwd,
          storageV5,
          readFileState,
          ...(permissionContext !== undefined
            ? {
                permissions: () => permissionContext,
                unlayeredPermissions: () => permissionContext,
              }
            : {}),
          ...overrides,
        })
      },

      async executeTool<
        TInput,
        TOutput = unknown,
        P extends ToolProgressData = ToolProgressData,
      >(
        tool: EmbeddedExecutableTool<TInput, TOutput, P>,
        input: TInput,
        opts?: EmbeddedExecuteToolOptions,
      ): Promise<ToolResult<TOutput>> {
        assertSessionActive()
        return await embeddedSession.run(async () => {
          const deps = embeddedSession.createToolDeps(
            opts?.agentId !== undefined
              ? { agentId: opts.agentId as AgentId }
              : undefined,
          )
          const callCtx = createToolCallContext<P>({
            signal: opts?.signal,
            toolUseId: opts?.toolUseId ?? randomUUID(),
            canUseTool: createDefaultCanUseTool(),
          })
          const resolvedRunnerCheckedHere =
            typeof opts?.runnerCheckedHere === 'function'
              ? opts.runnerCheckedHere
              : undefined
          const execOpts: ToolCallExecutionOptions | undefined =
            opts?.permissionCheckedFor !== undefined ||
            resolvedRunnerCheckedHere !== undefined
              ? {
                  ...(opts?.permissionCheckedFor !== undefined
                    ? { permissionCheckedFor: opts.permissionCheckedFor }
                    : {}),
                  ...(resolvedRunnerCheckedHere !== undefined
                    ? { runnerCheckedHere: resolvedRunnerCheckedHere }
                    : {}),
                }
              : undefined

          const currentRunner = getRemoteNativeToolRunner(session, tool.name)
          const effectiveRunner =
            resolvedRunnerCheckedHere !== undefined &&
            currentRunner !== undefined &&
            hasRemoteNativeToolCheck(session, tool.name)
              ? resolvedRunnerCheckedHere
              : currentRunner

          if (
            opts?.permissionCheckedFor !== undefined &&
            (opts.permissionCheckedFor ?? undefined) !== effectiveRunner
          ) {
            throw new NativeToolElsewhereError(
              `${tool.name} was not run: where it runs changed after its permission was checked. Send the call again.`,
              'NOT_RUN',
            )
          }

          if (effectiveRunner !== undefined) {
            const dispatchCtx = resolveToolUseContext(deps, callCtx)
            if (
              tool.outputSchema !== undefined ||
              tool.outputSchemaAcrossProcesses !== undefined
            ) {
              return (await dispatchRemoteNativeToolCall(
                tool as unknown as Tool,
                effectiveRunner,
                input as Record<string, unknown>,
                dispatchCtx.abortController.signal,
                dispatchCtx,
                execOpts,
              )) as ToolResult<TOutput>
            }
            let remoteResult: Awaited<ReturnType<RemoteNativeToolRunner>>
            try {
              remoteResult =
                (await effectiveRunner(
                  tool.name,
                  input,
                  dispatchCtx.abortController.signal,
                  dispatchCtx,
                )) ?? {}
            } catch (err) {
              throw normalizeDirectRemoteNativeToolError(err)
            }
            remoteResult.afterRead?.ok?.()
            const rawOutput = remoteResult.output
            const mergedData = (
              remoteResult.fieldsFromThisSide === undefined ||
              rawOutput === null ||
              typeof rawOutput !== 'object' ||
              Array.isArray(rawOutput)
                ? rawOutput
                : {
                    ...(rawOutput as Record<string, unknown>),
                    ...remoteResult.fieldsFromThisSide,
                  }
            ) as TOutput
            const hydrated =
              tool.fromAnotherProcess?.(
                mergedData as never,
                input as never,
                execOpts,
                undefined,
                dispatchCtx.agentId,
              ) ?? {}
            const combinedMessages = [
              ...(hydrated.newMessages ?? []),
              ...(remoteResult.newMessages ?? []),
            ]
            return {
              data: (hydrated.data ?? mergedData) as TOutput,
              ...(combinedMessages.length > 0
                ? { newMessages: combinedMessages }
                : {}),
              ...(remoteResult.subagentFrameResult !== undefined
                ? { subagentFrameResult: remoteResult.subagentFrameResult }
                : {}),
            }
          }

          assertNativeToolCanRunLocally(tool.name, session)

          if (typeof tool.call === 'function') {
            const toolUseContext = resolveToolUseContext(deps, callCtx)
            return await tool.call(
              input,
              toolUseContext,
              callCtx.canUseTool ?? createDefaultCanUseTool(),
              callCtx.parentMessage as AssistantMessage,
              undefined,
              execOpts,
            )
          }

          if (typeof tool.create === 'function') {
            const instance = tool.create(deps)
            return await instance.call(input, callCtx)
          }

          throw new Error(
            `Tool "${tool.name}" defines neither call() nor create()`,
          )
        })
      },

      getTurnHandoffManager(): TurnHandoffManager {
        assertSessionActive()
        return getTurnHandoffManager(session)
      },

      dispose(): Promise<void> {
        if (sessionDisposePromise !== undefined) {
          return sessionDisposePromise
        }
        sessionDisposed = true
        sessionDisposePromise = (async () => {
          activeSessions.delete(embeddedSession)
          onDisposed?.()
          const forksToDispose = [...childForks]
          childForks.clear()
          for (const fork of forksToDispose) {
            if (!fork.disposed) {
              try {
                await fork.dispose()
              } catch {
                // Ensure all child forks dispose cleanly
              }
            }
          }
          const pendingDetachers = [...detachers]
          detachers.clear()
          for (const detach of pendingDetachers) {
            try {
              detach()
            } catch {
              // Ensure all detachers run cleanly on dispose
            }
          }
        })()
        return sessionDisposePromise
      },
    }

    activeSessions.add(embeddedSession)

    if (initialBridge !== undefined) {
      embeddedSession.attachRemoteNativeToolBridge(initialBridge)
    }
    if (initialRemoteTools !== undefined) {
      for (const [toolName, config] of Object.entries(initialRemoteTools)) {
        embeddedSession.registerRemoteNativeTool(toolName, config.runner, {
          remoteCheck: config.remoteCheck,
        })
      }
    }

    return embeddedSession
  }

  const embeddedHost: EmbeddedHost = {
    host: sessionHost,
    tenantId,
    diskless,
    storageV5,
    get disposed(): boolean {
      return hostDisposed
    },

    createSession(
      sessionOptions: EmbeddedSessionOptions = {},
    ): EmbeddedSession {
      assertHostActive()
      const sessionId = sessionOptions.sessionId ?? randomUUID()
      const sessionCwd =
        sessionOptions.cwd !== undefined
          ? normalizeNfc(sessionOptions.cwd)
          : sessionOptions.projectDir !== undefined
            ? normalizeNfc(sessionOptions.projectDir)
            : hostDefaultCwd
      const projectRoot =
        sessionOptions.projectDir !== undefined
          ? normalizeNfc(sessionOptions.projectDir)
          : sessionCwd

      const session = createRootSession({
        host: sessionHost,
        id: sessionId,
        project: {
          originalCwd: sessionCwd,
          projectRoot,
          cwd: sessionCwd,
        },
      })

      if (sdkPerTaskStopAffordance !== undefined) {
        session.surfaceCapabilities.declarePerTaskStopAffordance(
          sdkPerTaskStopAffordance,
        )
      }

      return wrapSession(
        session,
        sessionOptions.permissionContext,
        sessionOptions.remoteNativeToolBridge,
        sessionOptions.remoteNativeTools,
      )
    },

    async run<T>(fn: () => T | Promise<T>): Promise<T> {
      assertHostActive()
      return await runWithSession(hostRootSession, () =>
        hostDefaultCwd.length > 0 ? runWithCwd(hostDefaultCwd, fn) : fn(),
      )
    },

    listSessions(): readonly EmbeddedSession[] {
      return [...activeSessions]
    },

    dispose(): Promise<void> {
      if (hostDisposePromise !== undefined) {
        return hostDisposePromise
      }
      hostDisposed = true
      hostDisposePromise = (async () => {
        let firstError: unknown
        let hasError = false

        const recordError = (err: unknown) => {
          if (!hasError) {
            hasError = true
            firstError = err
          }
        }

        // 1. Dispose all child sessions (detaching remote runners & bridges).
        const sessionsToDispose = [...activeSessions]
        activeSessions.clear()
        const sessionResults = await Promise.allSettled(
          sessionsToDispose.map(s => s.dispose()),
        )
        for (const r of sessionResults) {
          if (r.status === 'rejected') {
            recordError(r.reason)
          }
        }

        // 2. Drain this host's cleanup & pre-exit flush bags inside its ALS scope.
        try {
          await runWithSession(hostRootSession, () => runPreExitFlush())
        } catch (err) {
          recordError(err)
        }
        try {
          await runWithSession(hostRootSession, () => runCleanupFunctions())
        } catch (err) {
          recordError(err)
        }

        // 3. Clear pinned host-level overrides to allow GC and prevent stale refs.
        try {
          runWithSession(hostRootSession, () => {
            pinInjectedStorageV5(undefined)
            pinCredentialsStore(undefined)
            setTenantMcpClientsAccessor(undefined)
            setGatewayRequiredByHostPolicyReader(undefined)
            for (const hostName of strictGatewayHosts) {
              releaseGatewayHost(hostName)
            }
            setHostOtelState(undefined)
            setHostRendersChromeSetupOffer(false)
          })
        } catch (err) {
          recordError(err)
        }

        // 3b. Close auto-created memory StorageV5 (never close caller-supplied storageV5).
        if (ownsStorageV5 && storageV5 !== undefined) {
          try {
            await storageV5.close()
          } catch (err) {
            recordError(err)
          }
        }

        // 4. Release shared-backend lease cleanly (idempotent).
        releaseSharedBackendLease?.()

        if (hasError) {
          throw firstError
        }
      })()
      return hostDisposePromise
    },
  }

  return embeddedHost
}
