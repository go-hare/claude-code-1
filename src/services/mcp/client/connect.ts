import { feature } from 'bun:bundle'
import {
  Client,
  SdkHttpError,
  SseError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type Transport,
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import {
  createDensableMcpClient,
  isJavaMcpFormUrlElicitationReject,
  JAVA_MCP_BARE_ELICITATION_HINT,
} from '../mcpV2Client.js'
import { extractMcpConnectionErrorCode } from '../mcpConnectionIssue.js'
import { readClientProtocolEra } from '../channelPermissions.js'
import {
  captureConnectClockSnapshot,
  classifyMcpAutoProbeFallback,
  createMcpConnectionTimeoutError,
  detectConnectSuspendedMessage,
  formatMcpProbeFallbackDebugMessage,
  formatPinnedLegacyRetryPreserveTimeoutLog,
  getMcpClientConnectTimeoutMs,
  getMcpPinnedLegacyRetryTimeoutMs,
  getMcpTimeoutMs,
  isMcpCcrProxyServerConfig,
  isRememberedLegacyStdio,
  loadRememberedLegacyStdioFromDisk,
  type ModernCompatTransportLike,
  recordRememberedLegacyStdio,
  resolveMcpNegotiationTransportKind,
  resolveMcpProtocolNegotiationPlan,
  type McpProtocolNegotiationPlan,
  shouldPreserveConnectTimeoutAfterPinnedLegacyRetry,
  truncateMcpErrorSnippet,
  wrapModernProtocolResultCompat,
  getLegacySseErrorStatus,
  isLegacySseAuthChallenge,
  isLegacySseFallbackEligible,
  type McpProbeFallbackReason,
  type McpProbeTimedOutTransport,
} from '../mcpConnectTimeout.js'
import {
  CLAUDEAI_CONNECTORS_DISABLED_ERROR_CODE,
  isSdkServerWithConnectorsOff,
} from '../claudeai.js'
import { getPlatform } from '../../../utils/platform.js'
import { registerCleanup } from '../../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../../utils/debug.js'
import { errorMessage } from '../../../utils/errors.js'
import { maybeNotifyIDEConnected } from '../../../utils/ide.js'
import { logMCPDebug, logMCPError } from '../../../utils/log.js'
import {
  getBootstrapSession,
  runWithSession,
} from '../../../utils/sessionRoot.js'
import { getSessionIngressAuthToken } from '../../../utils/sessionIngressAuth.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../analytics/index.js'
import { sleep } from '../../../utils/sleep.js'
import {
  clearMcpOAuthStubIfTokenless,
  IssuerEchoCrossOriginError,
  markStoredTokenRejectedForRedial,
} from '../auth.js'
import { wrapStatelessClaudeAiProxyTransport } from '../claudeAiProxyStateless.js'
import {
  armAllCallWatchdogs,
  createMcpTransportErrorState,
} from '../transportErrorState.js'
import { getMcpServerUrlOrigin, isMcpServerAllowedByPolicy } from '../config.js'
import { connectAuthStatusCode } from '../connectAuthClassify.js'
import { classifyFirstPartyAuthRejection } from '../mcpFirstPartyAutoAuth.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../types.js'
import {
  getMaxMcpDescriptionLengthForConfig,
  gracefulShutdownWindowsStdio,
  isTerminalConnectionError,
} from '../clientHelpers.js'
import {
  connectAuthRejectedResult,
  getConnectionTimeoutMs,
  getServerCacheKey,
  handleRemoteAuthFailure,
  isClaudeAiBearerRejectedError,
  isMcpSessionExpiredError,
  maybeConnectAuthHeaderRejection,
  mcpBaseUrlAnalytics,
} from '../connectionHelpers.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import {
  bindMcpClientHandlersToSession,
  buildMcpRootsList,
} from './errorsAndKeys.js'
import {
  connectToServer,
  fetchCommandsForClient,
  fetchMcpSkillsForClient,
  fetchResourcesForClient,
  fetchToolsForClient,
  getHostMcpClientState,
  notifyMcpServerConnected,
} from './hostState.js'
import {
  type McpTransportBuildState,
  buildInitialMcpTransport,
  recreateMcpTransportForPinnedLegacy,
} from './connectTransports.js'

/**
 * TODO (ollie): The memoization here increases complexity by a lot, and im not sure it really improves performance
 * Attempts to connect to a single MCP server
 * @param name Server name
 * @param serverRef Scoped server configuration
 * @returns A wrapped client (either connected or failed)
 */
export async function connectToServerImpl(
  name: string,
  serverRef: ScopedMcpServerConfig,
  serverStats?: {
    totalServers: number
    stdioCount: number
    sseCount: number
    httpCount: number
    sseIdeCount: number
    wsIdeCount: number
  },
): Promise<MCPServerConnection> {
  const hostState = getHostMcpClientState()
  const capturedSession = getBootstrapSession()
  const connectStartTime = Date.now()
  const connectClockSnapshot = captureConnectClockSnapshot()
  // #644/#645: never spawn or dial a server blocked by managed policy.
  if (
    serverRef.type !== 'sdk' &&
    !isMcpServerAllowedByPolicy(name, serverRef)
  ) {
    return {
      name,
      type: 'failed',
      config: serverRef,
      error: 'Blocked by enterprise managed policy',
      errorCode: 'POLICY_BLOCKED',
    }
  }
  const transportState: McpTransportBuildState = {
    inProcessServer: undefined,
    connectAuthFlags: undefined,
    connectAuthProvider: undefined,
    useFirstPartyAuth: false,
    lacksHelperHeaders: false,
    firstPartyBearerBag: { last: 'none' },
  }
  let capturedStartupStderr = ''
  try {
    // If we have the session ingress JWT, we will connect via the session ingress rather than
    // to remote MCP's directly.
    const sessionIngressToken = getSessionIngressAuthToken()
    const initialTransport = await buildInitialMcpTransport(
      name,
      serverRef,
      sessionIngressToken,
      transportState,
    )
    let transport: Transport = initialTransport.transport
    const legacySseFallback = initialTransport.legacySseFallback
    // Set up stderr logging for stdio transport before connecting in case there are any stderr
    // outputs emitted during the connection start (this can be useful for debugging failed connections).
    // Store handler reference for cleanup to prevent memory leaks
    let stderrHandler: ((data: Buffer) => void) | undefined
    let stderrOutput = ''
    if (serverRef.type === 'stdio' || !serverRef.type) {
      const stdioTransport = transport as StdioClientTransport
      if (stdioTransport.stderr) {
        stderrHandler = (data: Buffer) => {
          // Cap stderr accumulation to prevent unbounded memory growth
          if (stderrOutput.length < 64 * 1024 * 1024) {
            try {
              stderrOutput += data.toString()
            } catch {
              // Ignore errors from exceeding max string length
            }
          }
        }
        stdioTransport.stderr.on('data', stderrHandler)
      }
    }

    // densable n_f(type, {inProcess, ccrProxy: pMn(config)}) for Pwi.
    // sdk is handled earlier; n_f still maps it to sdk-control.
    const negotiationTransportKind = resolveMcpNegotiationTransportKind(
      serverRef.type,
      {
        inProcess: transportState.inProcessServer !== undefined,
        ccrProxy: isMcpCcrProxyServerConfig(serverRef),
      },
    )

    // densable 2.1.232/238: Pwi(kind, serverConfig) — GB denylist after auto.
    // SEA 325 #263 / #1628: lazily load persisted 7-day verdicts from disk
    // once, then skip the probe for 7 days if this stdio server previously
    // timed out/failed probe.
    if (negotiationTransportKind === 'stdio') {
      await loadRememberedLegacyStdioFromDisk(undefined, { once: true })
    }
    const protocolPlan: McpProtocolNegotiationPlan =
      negotiationTransportKind === 'stdio' &&
      isRememberedLegacyStdio(
        serverRef as {
          type?: string
          command?: string
          args?: readonly string[]
          env?: Record<string, string>
        },
      )
        ? { mode: 'legacy' }
        : resolveMcpProtocolNegotiationPlan(
            negotiationTransportKind,
            process.env,
            (key, def) => getFeatureValue_CACHED_MAY_BE_STALE(key, def),
            serverRef,
          )
    // densable k(Z) — factory takes versionNegotiation plan (BVa)
    // densable ze capability ternary + Lr initialize rewrite live in factory.
    let bareElicitationRetry = false
    const createMcpSdkClient = (
      plan: typeof protocolPlan = protocolPlan,
      opts: { forceBare?: boolean } = {},
    ): Client => {
      const c = createDensableMcpClient(plan, serverRef, {
        forceBare: opts.forceBare === true || bareElicitationRetry,
      })
      bindMcpClientHandlersToSession(c, capturedSession)
      // densable: setRequestHandler("roots/list", ...)
      c.setRequestHandler('roots/list', async () => {
        logMCPDebug(name, `Received ListRoots request from server`)
        return buildMcpRootsList()
      })
      return c
    }

    // densable C — reassigned on pinned-legacy reconnect / bare elicitation retry.
    let client = createMcpSdkClient()

    // Add debug logging for client events if available
    if (serverRef.type === 'http') {
      logMCPDebug(name, `Client created, setting up request handler`)
    }

    // Add a timeout to connection attempts to prevent tests from hanging indefinitely
    logMCPDebug(
      name,
      `Starting connection with timeout of ${getConnectionTimeoutMs()}ms`,
    )

    // For HTTP transport, try a basic connectivity test first
    if (serverRef.type === 'http') {
      logMCPDebug(name, `Testing basic HTTP connectivity to ${serverRef.url}`)
      try {
        const testUrl = new URL(serverRef.url)
        logMCPDebug(
          name,
          `Parsed URL: host=${testUrl.hostname}, port=${testUrl.port || 'default'}, protocol=${testUrl.protocol}`,
        )

        // Log DNS resolution attempt
        if (
          testUrl.hostname === '127.0.0.1' ||
          testUrl.hostname === 'localhost'
        ) {
          logMCPDebug(name, `Using loopback address: ${testUrl.hostname}`)
        }
      } catch (urlError) {
        logMCPDebug(name, `Failed to parse URL: ${urlError}`)
      }
    }

    const initializeTimeoutMs = getMcpClientConnectTimeoutMs(protocolPlan.mode)
    const outerTimeoutMs = getConnectionTimeoutMs()
    // probeFellBack retained for densable analytics shape (negotiation.probeFellBack).
    let probeFellBack: McpProbeFallbackReason | undefined
    // densable `oe` — Re() timeout only transport.close().
    let handshakeConnectTimedOut = false

    const raceConnect = async (
      c: Client,
      t: Transport,
      initTimeoutMs: number,
      raceTimeoutMs: number,
    ): Promise<void> => {
      const connectPromise = c.connect(t, { timeout: initTimeoutMs })
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(() => {
          const elapsed = Date.now() - connectStartTime
          logMCPDebug(
            name,
            `Connection timeout triggered after ${elapsed}ms (limit: ${raceTimeoutMs}ms)`,
          )
          if (transportState.inProcessServer) {
            transportState.inProcessServer.close().catch(() => {})
          }
          t.close().catch(() => {})
          handshakeConnectTimedOut = true
          // densable oMf — tag CONNECT_TIMEOUT when GB default true
          reject(
            createMcpConnectionTimeoutError(
              `MCP server "${name}" connection timed out after ${outerTimeoutMs}ms`,
            ),
          )
        }, raceTimeoutMs)
        connectPromise.then(
          () => {
            clearTimeout(timeoutId)
          },
          _error => {
            clearTimeout(timeoutId)
          },
        )
      })
      await Promise.race([connectPromise, timeoutPromise])
    }

    const recreateTransportForPinnedLegacy = (): Promise<Transport> =>
      recreateMcpTransportForPinnedLegacy(
        name,
        serverRef,
        sessionIngressToken,
        transportState,
      )
    const canRecreateForPinnedLegacy =
      serverRef.type === 'http' ||
      serverRef.type === 'claudeai-proxy' ||
      serverRef.type === 'stdio' ||
      !serverRef.type

    // densable N_f(u,S,v) — claudeai-proxy send-intercept only (never stdio).
    if (serverRef.type === 'claudeai-proxy') {
      wrapStatelessClaudeAiProxyTransport(transport, serverRef, msg =>
        logMCPDebug(name, msg),
      )
    }
    if (protocolPlan.mode === 'auto') {
      wrapModernProtocolResultCompat(
        transport as unknown as ModernCompatTransportLike,
        name,
        msg => logMCPDebug(name, msg),
      )
    }

    const recreateTransportAndClientForBareElicitation =
      async (): Promise<void> => {
        bareElicitationRetry = true
        await transport.close().catch(() => {})
        if (stderrHandler) {
          const stdioT = transport as StdioClientTransport
          stdioT.stderr?.off('data', stderrHandler)
        }
        if (stderrOutput) {
          logMCPDebug(
            name,
            `stderr of the stdio server that refused elicitation form and url, before restarting it: ${stderrOutput}`,
          )
          stderrOutput = ''
        }
        transport = await recreateTransportForPinnedLegacy()
        if (serverRef.type === 'claudeai-proxy') {
          wrapStatelessClaudeAiProxyTransport(
            transport,
            serverRef,
            msg => logMCPDebug(name, msg),
            { includeDiscover: false },
          )
        }
        if (
          (serverRef.type === 'stdio' || !serverRef.type) &&
          transport instanceof StdioClientTransport &&
          transport.stderr
        ) {
          stderrHandler = (data: Buffer) => {
            if (stderrOutput.length < 64 * 1024 * 1024) {
              try {
                stderrOutput += data.toString()
              } catch {
                // ignore
              }
            }
          }
          transport.stderr.on('data', stderrHandler)
        }
        // densable ze(Ee?TDt()) — bare elicitation bag on Java reject retry.
        client = createMcpSdkClient({ mode: 'legacy' }, { forceBare: true })
      }

    try {
      try {
        await raceConnect(
          client,
          transport,
          initializeTimeoutMs,
          outerTimeoutMs,
        )
      } catch (firstError) {
        const alreadyHttpInited =
          transport instanceof StreamableHTTPClientTransport &&
          (transport as { protocolVersion?: unknown }).protocolVersion !==
            undefined
        const gbLegacySse =
          getFeatureValue_CACHED_MAY_BE_STALE(
            'tengu_mcp_legacy_sse_fallback',
            true,
          ) === true
        if (
          legacySseFallback !== undefined &&
          !alreadyHttpInited &&
          isLegacySseFallbackEligible(firstError) &&
          gbLegacySse
        ) {
          const snippet =
            firstError instanceof Error
              ? firstError.message
              : String(firstError)
          logMCPDebug(
            name,
            `initialize POST rejected (${snippet.slice(0, 200)}); trying legacy HTTP+SSE`,
          )
          const post405 =
            firstError instanceof SdkHttpError && firstError.status === 405
          await transport.close().catch(() => {})
          const dial = new AbortController()
          let sseConnected = false
          transport = legacySseFallback({
            postMethodNotAllowed: post405,
            dialSignal: dial.signal,
            dialConnected: () => sseConnected,
          })
          client = createMcpSdkClient()
          const remainingMs = Math.min(
            5_000,
            Math.max(
              1_000,
              getConnectionTimeoutMs() - (Date.now() - connectStartTime),
            ),
          )
          // densable De = R?.sawAuthChallenge; Trn stamps the field.
          const sawAuthChallengeBeforeFallback =
            (
              transportState.connectAuthProvider as
                | { sawAuthChallenge?: boolean }
                | undefined
            )?.sawAuthChallenge === true
          handshakeConnectTimedOut = false
          try {
            await raceConnect(client, transport, remainingMs, remainingMs)
            sseConnected = true
            logMCPDebug(name, 'connected over legacy HTTP+SSE')
          } catch (sseError) {
            await transport.close().catch(() => {})
            dial.abort()
            const newAuthChallenge =
              !sawAuthChallengeBeforeFallback &&
              (
                transportState.connectAuthProvider as
                  | { sawAuthChallenge?: boolean }
                  | undefined
              )?.sawAuthChallenge === true
            const isAuthChallenge = isLegacySseAuthChallenge(
              sseError,
              getLegacySseErrorStatus(sseError),
              newAuthChallenge,
            )
            if (handshakeConnectTimedOut && post405 && newAuthChallenge) {
              logMCPDebug(
                name,
                'legacy HTTP+SSE stream GET answered with an auth challenge; its auth flow outran the fallback budget, so routing to needs-auth',
              )
              throw new UnauthorizedError(
                `MCP server "${name}" requires authorization: its legacy HTTP+SSE stream answered with an auth challenge and the authorization flow did not finish within the connect budget`,
              )
            }
            if (
              handshakeConnectTimedOut ||
              (sseError instanceof SseError && !isAuthChallenge) ||
              (isAuthChallenge && !post405)
            ) {
              const snippet = truncateMcpErrorSnippet(
                sseError instanceof Error ? sseError.message : String(sseError),
              )
              logMCPDebug(
                name,
                `legacy HTTP+SSE not confirmed (${snippet}); surfacing the POST failure`,
              )
              throw firstError
            }
            throw sseError
          }
        } else {
          const decision = classifyMcpAutoProbeFallback(
            protocolPlan,
            firstError,
            {
              transportType: serverRef.type,
              transport: transport as McpProbeTimedOutTransport,
              canRecreateTransport: canRecreateForPinnedLegacy,
              elapsedMs: Date.now() - connectStartTime,
            },
          )
          if (decision.shouldFallback && negotiationTransportKind === 'stdio') {
            recordRememberedLegacyStdio(
              serverRef as {
                type?: string
                command?: string
                args?: readonly string[]
                env?: Record<string, string>
              },
            )
          }
          if (!decision.shouldFallback) {
            // densable bn → reconnect once without elicitation form/url.
            if (
              canRecreateForPinnedLegacy &&
              !bareElicitationRetry &&
              isJavaMcpFormUrlElicitationReject(
                firstError,
                serverRef,
                transport,
              )
            ) {
              logMCPDebug(
                name,
                'server rejected elicitation form and url at initialize (Java MCP SDK 0.17.0 or older); reconnecting once without elicitation form and url',
              )
              await recreateTransportAndClientForBareElicitation()
              const bareTimeoutMs =
                getMcpPinnedLegacyRetryTimeoutMs(connectStartTime)
              await raceConnect(client, transport, bareTimeoutMs, bareTimeoutMs)
            } else {
              throw firstError
            }
          } else {
            probeFellBack = decision.reason
            logMCPDebug(
              name,
              formatMcpProbeFallbackDebugMessage(
                decision.reason,
                serverRef.type || 'stdio',
              ),
            )
            if (decision.reason === 'closed' && stderrOutput) {
              logMCPDebug(name, `Probe-closed server stderr: ${stderrOutput}`)
              stderrOutput = ''
            }
            await transport.close().catch(() => {})
            if (stderrHandler) {
              const stdioT = transport as StdioClientTransport
              stdioT.stderr?.off('data', stderrHandler)
            }
            transport = await recreateTransportForPinnedLegacy()
            // densable reconnect `_9a(u,M)` — init intercept only (discover omitted).
            if (serverRef.type === 'claudeai-proxy') {
              wrapStatelessClaudeAiProxyTransport(
                transport,
                serverRef,
                msg => logMCPDebug(name, msg),
                { includeDiscover: false },
              )
            }
            if (
              (serverRef.type === 'stdio' || !serverRef.type) &&
              transport instanceof StdioClientTransport &&
              transport.stderr
            ) {
              stderrHandler = (data: Buffer) => {
                if (stderrOutput.length < 64 * 1024 * 1024) {
                  try {
                    stderrOutput += data.toString()
                  } catch {
                    // ignore
                  }
                }
              }
              transport.stderr.on('data', stderrHandler)
            }
            // densable C=k({mode:"legacy"}) — new client, pinned legacy mode.
            client = createMcpSdkClient({ mode: 'legacy' })
            const retryTimeoutMs =
              getMcpPinnedLegacyRetryTimeoutMs(connectStartTime)
            let outerTimedOut = false
            try {
              // densable: race remaining budget; oMf message still cites y0()
              const connectPromise = client.connect(transport, {
                timeout: retryTimeoutMs,
              })
              await Promise.race([
                connectPromise,
                new Promise<never>((_, reject) => {
                  const timeoutId = setTimeout(() => {
                    outerTimedOut = true
                    transport.close().catch(() => {})
                    reject(
                      createMcpConnectionTimeoutError(
                        `MCP server "${name}" connection timed out after ${outerTimeoutMs}ms`,
                      ),
                    )
                  }, retryTimeoutMs)
                  connectPromise.then(
                    () => clearTimeout(timeoutId),
                    () => clearTimeout(timeoutId),
                  )
                }),
              ])
            } catch (retryError) {
              if (
                canRecreateForPinnedLegacy &&
                !bareElicitationRetry &&
                isJavaMcpFormUrlElicitationReject(
                  retryError,
                  serverRef,
                  transport,
                )
              ) {
                logMCPDebug(
                  name,
                  'server rejected elicitation form and url on the reconnect (Java MCP SDK 0.17.0 or older); reconnecting once more without elicitation form and url',
                )
                await recreateTransportAndClientForBareElicitation()
                const bareTimeoutMs =
                  getMcpPinnedLegacyRetryTimeoutMs(connectStartTime)
                await raceConnect(
                  client,
                  transport,
                  bareTimeoutMs,
                  bareTimeoutMs,
                )
              } else if (
                shouldPreserveConnectTimeoutAfterPinnedLegacyRetry(
                  decision.reason,
                  retryError,
                  { outerTimedOut },
                )
              ) {
                const snippet = truncateMcpErrorSnippet(
                  retryError instanceof Error
                    ? retryError.message
                    : String(retryError),
                )
                logMCPDebug(
                  name,
                  formatPinnedLegacyRetryPreserveTimeoutLog(snippet),
                )
                throw firstError
              } else {
                throw retryError
              }
            }
          }
        }
      }
      // silence unused until analytics wiring; densable passes probeFellBack out.
      void probeFellBack
      void bareElicitationRetry

      if (stderrOutput) {
        logMCPError(name, `Server stderr: ${stderrOutput}`)
        stderrOutput = '' // Release accumulated string to prevent memory growth
      }
      const elapsed = Date.now() - connectStartTime
      logMCPDebug(
        name,
        `Successfully connected (transport: ${serverRef.type || 'stdio'}) in ${elapsed}ms`,
      )
    } catch (caught) {
      const elapsed = Date.now() - connectStartTime
      // densable: !Ee && bn → rewrite failed-connect message to Java bare hint.
      const error =
        !bareElicitationRetry &&
        isJavaMcpFormUrlElicitationReject(caught, serverRef, transport)
          ? new Error(JAVA_MCP_BARE_ELICITATION_HINT, { cause: caught })
          : caught
      // SSE-specific error logging
      if (serverRef.type === 'sse' && error instanceof Error) {
        logMCPDebug(
          name,
          `SSE Connection failed after ${elapsed}ms: ${jsonStringify({
            url: serverRef.url,
            error: error.message,
            errorType: error.constructor.name,
            stack: error.stack,
          })}`,
        )
        logMCPError(name, error)

        const classified = maybeConnectAuthHeaderRejection(
          error,
          transportState.connectAuthFlags,
        )
        if (classified) {
          return connectAuthRejectedResult(name, serverRef, 'sse', classified)
        }
        if (transportState.useFirstPartyAuth) {
          const firstParty = classifyFirstPartyAuthRejection({
            error,
            statusCode: connectAuthStatusCode(error),
            serverRef,
            firstPartyBearer: transportState.firstPartyBearerBag.last,
          })
          if (firstParty) {
            return connectAuthRejectedResult(name, serverRef, 'sse', firstParty)
          }
        }
        if (error instanceof UnauthorizedError) {
          return markStoredTokenRejectedForRedial(name, serverRef, () =>
            handleRemoteAuthFailure(name, serverRef, 'sse', {
              lacksHelperHeaders: transportState.lacksHelperHeaders,
            }),
          )
        }
      } else if (serverRef.type === 'http' && error instanceof Error) {
        const errorObj = error as Error & {
          cause?: unknown
          code?: string
          errno?: string | number
          syscall?: string
        }
        logMCPDebug(
          name,
          `HTTP Connection failed after ${elapsed}ms: ${error.message} (code: ${errorObj.code || 'none'}, errno: ${errorObj.errno || 'none'})`,
        )
        logMCPError(name, error)

        const classified = maybeConnectAuthHeaderRejection(
          error,
          transportState.connectAuthFlags,
        )
        if (classified) {
          return connectAuthRejectedResult(name, serverRef, 'http', classified)
        }
        if (transportState.useFirstPartyAuth) {
          const firstParty = classifyFirstPartyAuthRejection({
            error,
            statusCode: connectAuthStatusCode(error),
            serverRef,
            firstPartyBearer: transportState.firstPartyBearerBag.last,
          })
          if (firstParty) {
            return connectAuthRejectedResult(
              name,
              serverRef,
              'http',
              firstParty,
            )
          }
        }
        if (error instanceof UnauthorizedError) {
          return markStoredTokenRejectedForRedial(name, serverRef, () =>
            handleRemoteAuthFailure(name, serverRef, 'http', {
              lacksHelperHeaders: transportState.lacksHelperHeaders,
            }),
          )
        }
      } else if (
        serverRef.type === 'claudeai-proxy' &&
        error instanceof Error
      ) {
        logMCPDebug(
          name,
          `claude.ai proxy connection failed after ${elapsed}ms: ${error.message}`,
        )
        // densable: CLAUDEAI_BEARER_REJECTED on connect is session-token scope
        // (/login), not connector OAuth needs-auth cache.
        if (isClaudeAiBearerRejectedError(error)) {
          logMCPDebug(
            name,
            'claude.ai session token rejected during connect — run /login',
          )
        } else {
          logMCPError(name, error)
        }

        // StreamableHTTPError has a `code` property with the HTTP status;
        // SdkHttpError carries `status`. Both 401 and 403 are user_auth
        // failures (early abort to needs-auth instead of retrying).
        const errorCode =
          error instanceof SdkHttpError
            ? error.status
            : (error as Error & { code?: number }).code
        if (
          (errorCode === 401 || errorCode === 403) &&
          !isClaudeAiBearerRejectedError(error)
        ) {
          return handleRemoteAuthFailure(name, serverRef, 'claudeai-proxy')
        }
      } else if (serverRef.type === 'sse-ide' || serverRef.type === 'ws-ide') {
        logEvent('tengu_mcp_ide_server_connection_failed', {
          connectionDurationMs: elapsed,
        })
      }
      if (transportState.inProcessServer) {
        transportState.inProcessServer.close().catch(() => {})
      }
      transport.close().catch(() => {})
      if (stderrOutput) {
        logMCPError(name, `Server stderr: ${stderrOutput}`)
        // Official 2.1.326 #84: retain startup stderr snippet so `/mcp` can
        // explain why a local (stdio) MCP server failed to start.
        capturedStartupStderr = stderrOutput.trim().slice(-2000)
      }
      throw error
    }

    const capabilities = client.getServerCapabilities()
    if (isSdkServerWithConnectorsOff(serverRef, capabilities)) {
      client.close().catch(() => {})
      logMCPDebug(name, 'Skipping connection (disableClaudeAiConnectors)')
      logEvent(
        'mcp_connectors_off_in_desktop' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        {},
      )
      return {
        name,
        config: serverRef,
        type: 'failed',
        error: 'Disabled by disableClaudeAiConnectors setting',
        errorCode: CLAUDEAI_CONNECTORS_DISABLED_ERROR_CODE,
      }
    }
    const serverVersion = client.getServerVersion()
    const rawInstructions = client.getInstructions()
    const maxInstructionsLength = getMaxMcpDescriptionLengthForConfig(serverRef)
    let instructions = rawInstructions
    if (rawInstructions && rawInstructions.length > maxInstructionsLength) {
      instructions =
        rawInstructions.slice(0, maxInstructionsLength) + '… [truncated]'
      logMCPDebug(
        name,
        `Server instructions truncated from ${rawInstructions.length} to ${maxInstructionsLength} chars`,
      )
    }

    // Log successful connection details
    logMCPDebug(
      name,
      `Connection established with capabilities: ${jsonStringify({
        hasTools: !!capabilities?.tools,
        hasPrompts: !!capabilities?.prompts,
        hasResources: !!capabilities?.resources,
        hasResourceSubscribe: !!capabilities?.resources?.subscribe,
        serverVersion: serverVersion || 'unknown',
      })}`,
    )
    logForDebugging(
      `[MCP] Server "${name}" connected with subscribe=${!!capabilities?.resources?.subscribe}`,
    )

    // Register default elicitation handler that returns cancel during the
    // window before registerElicitationHandler overwrites it in
    // onConnectionAttempt (useManageMCPConnections).
    // densable: setRequestHandler("elicitation/create", ...)
    client.setRequestHandler('elicitation/create', async request => {
      logMCPDebug(
        name,
        `Elicitation request received during initialization: ${jsonStringify(request)}`,
      )
      return { action: 'cancel' as const }
    })

    if (serverRef.type === 'sse-ide' || serverRef.type === 'ws-ide') {
      const ideConnectionDurationMs = Date.now() - connectStartTime
      logEvent('tengu_mcp_ide_server_connection_succeeded', {
        connectionDurationMs: ideConnectionDurationMs,
        serverVersion:
          serverVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      try {
        void maybeNotifyIDEConnected(client)
      } catch (error) {
        logMCPError(name, `Failed to send ide_connected notification: ${error}`)
      }
    }

    // Enhanced connection drop detection and logging for all transport types
    const connectionStartTime = Date.now()
    let hasErrorOccurred = false

    // Store original handlers
    const originalOnerror = client.onerror
    const originalOnclose = client.onclose

    // Official transportErrorState (O): mid-call drop detection for concurrent tools.
    const transportErrorState = createMcpTransportErrorState()

    // The SDK's transport calls onerror on connection failures but doesn't call onclose,
    // which CC uses to trigger reconnection. We bridge this gap by tracking consecutive
    // terminal errors and manually closing after MAX_ERRORS_BEFORE_RECONNECT failures.
    let consecutiveConnectionErrors = 0
    const MAX_ERRORS_BEFORE_RECONNECT = 3

    // Guard against re-entry: close() aborts in-flight streams which may fire
    // onerror again before the close chain completes.
    let hasTriggeredClose = false

    // client.close() → transport.close() → transport.onclose → SDK's _onclose():
    // rejects all pending request handlers (so hung callTool() promises fail with
    // McpError -32000 "Connection closed") and then invokes our client.onclose
    // handler below (which clears the memo cache so the next call reconnects).
    // Calling client.onclose?.() directly would only clear the cache — pending
    // tool calls would stay hung.
    const closeTransportAndRejectPending = (reason: string) => {
      if (hasTriggeredClose) return
      hasTriggeredClose = true
      logMCPDebug(name, `Closing transport (${reason})`)
      void client.close().catch(e => {
        logMCPDebug(name, `Error during close: ${errorMessage(e)}`)
      })
    }

    // Enhanced error handler with detailed logging
    client.onerror = (error: Error) => {
      const transportType = serverRef.type || 'stdio'
      if (
        (transportType === 'sse' ||
          transportType === 'http' ||
          transportType === 'claudeai-proxy') &&
        error instanceof SyntaxError
      ) {
        hasErrorOccurred = true
        closeTransportAndRejectPending(
          transportState.connectAuthProvider?.authChallengeOpen === true &&
            transportErrorState.activeCallWatchdogs.size <= 1
            ? 'malformed message after an auth challenge'
            : 'malformed JSON-RPC message (response truncated)',
        )
        if (originalOnerror) {
          originalOnerror(error)
        }
        return
      }
      const uptime = Date.now() - connectionStartTime
      hasErrorOccurred = true

      // Log the connection drop with context
      logMCPDebug(
        name,
        `${transportType.toUpperCase()} connection dropped after ${Math.floor(uptime / 1000)}s uptime`,
      )

      // Log specific error details for debugging
      if (error.message) {
        if (error.message.includes('ECONNRESET')) {
          logMCPDebug(
            name,
            `Connection reset - server may have crashed or restarted`,
          )
        } else if (error.message.includes('ETIMEDOUT')) {
          logMCPDebug(
            name,
            `Connection timeout - network issue or server unresponsive`,
          )
        } else if (error.message.includes('ECONNREFUSED')) {
          logMCPDebug(name, `Connection refused - server may be down`)
        } else if (error.message.includes('EPIPE')) {
          logMCPDebug(
            name,
            `Broken pipe - server closed connection unexpectedly`,
          )
        } else if (error.message.includes('EHOSTUNREACH')) {
          logMCPDebug(name, `Host unreachable - network connectivity issue`)
        } else if (error.message.includes('ESRCH')) {
          logMCPDebug(
            name,
            `Process not found - stdio server process terminated`,
          )
        } else if (error.message.includes('spawn')) {
          logMCPDebug(
            name,
            `Failed to spawn process - check command and permissions`,
          )
        } else {
          logMCPDebug(name, `Connection error: ${error.message}`)
        }
      }

      // For HTTP transports, detect session expiry (404 + JSON-RPC -32001)
      // and close the transport so pending tool calls reject and the next
      // call reconnects with a fresh session ID.
      if (
        (transportType === 'http' || transportType === 'claudeai-proxy') &&
        isMcpSessionExpiredError(error)
      ) {
        logMCPDebug(
          name,
          `MCP session expired (server returned 404 with session-not-found), triggering reconnection`,
        )
        closeTransportAndRejectPending('session expired')
        if (originalOnerror) {
          originalOnerror(error)
        }
        return
      }

      // For remote transports (SSE/HTTP), track terminal connection errors
      // and trigger reconnection via close if we see repeated failures.
      if (
        transportType === 'sse' ||
        transportType === 'http' ||
        transportType === 'claudeai-proxy'
      ) {
        // The SDK's StreamableHTTP transport fires this after exhausting its
        // own SSE reconnect attempts (default maxRetries: 2) — but it never
        // calls onclose, so pending callTool() promises hang indefinitely.
        // This is the definitive "transport gave up" signal.
        if (error.message.includes('Maximum reconnection attempts')) {
          closeTransportAndRejectPending('SSE reconnection exhausted')
          if (originalOnerror) {
            originalOnerror(error)
          }
          return
        }

        if (isTerminalConnectionError(error)) {
          consecutiveConnectionErrors++
          transportErrorState.consecutiveErrors = consecutiveConnectionErrors
          // Official M(): arm in-flight callTool watchdogs so they abort if
          // no progress arrives within 90s (response presumed lost).
          armAllCallWatchdogs(transportErrorState)
          logMCPDebug(
            name,
            `Terminal connection error ${consecutiveConnectionErrors}/${MAX_ERRORS_BEFORE_RECONNECT}`,
          )

          if (consecutiveConnectionErrors >= MAX_ERRORS_BEFORE_RECONNECT) {
            consecutiveConnectionErrors = 0
            transportErrorState.consecutiveErrors = 0
            closeTransportAndRejectPending('max consecutive terminal errors')
          }
        } else {
          // Non-terminal error (e.g., transient issue), reset counter
          consecutiveConnectionErrors = 0
          transportErrorState.consecutiveErrors = 0
        }
      }

      // Call original handler
      if (originalOnerror) {
        originalOnerror(error)
      }
    }

    // Enhanced close handler with connection drop context
    client.onclose = () => {
      const uptime = Date.now() - connectionStartTime
      const transportType = serverRef.type ?? 'unknown'

      logMCPDebug(
        name,
        `${transportType.toUpperCase()} connection closed after ${Math.floor(uptime / 1000)}s (${hasErrorOccurred ? 'with errors' : 'cleanly'})`,
      )

      // Clear the memoization cache so next operation reconnects
      const key = getServerCacheKey(name, serverRef)

      // Also clear fetch caches (keyed by server name). Reconnection
      // creates a new connection object; without clearing, the next
      // fetch would return stale tools/resources from the old connection.
      fetchToolsForClient.cache.delete(name)
      fetchResourcesForClient.cache.delete(name)
      fetchCommandsForClient.cache.delete(name)
      if (feature('MCP_SKILLS')) {
        fetchMcpSkillsForClient!.cache.delete(name)
      }

      connectToServer.cache.delete(key)
      logMCPDebug(name, `Cleared connection cache for reconnection`)

      if (originalOnclose) {
        originalOnclose()
      }
    }

    const cleanup = async () => {
      // In-process servers (e.g. Chrome MCP) don't have child processes or stderr
      if (transportState.inProcessServer) {
        try {
          await transportState.inProcessServer.close()
        } catch (error) {
          logMCPDebug(name, `Error closing in-process server: ${error}`)
        }
        try {
          await client.close()
        } catch (error) {
          logMCPDebug(name, `Error closing client: ${error}`)
        }
        return
      }

      // Remove stderr event listener to prevent memory leaks
      if (stderrHandler && (serverRef.type === 'stdio' || !serverRef.type)) {
        const stdioTransport = transport as StdioClientTransport
        stdioTransport.stderr?.off('data', stderrHandler)
      }

      // For stdio transports, explicitly terminate the child process with proper signals
      // NOTE: StdioClientTransport.close() only sends an abort signal, but many MCP servers
      // (especially Docker containers) need explicit SIGINT/SIGTERM signals to trigger graceful shutdown
      if (serverRef.type === 'stdio') {
        try {
          const stdioTransport = transport as StdioClientTransport
          const stdioTransportWithProc = stdioTransport as unknown as {
            _process?: import('child_process').ChildProcess
            serverProcess?: import('child_process').ChildProcess
          }
          const stdioProc =
            stdioTransportWithProc.serverProcess ??
            stdioTransportWithProc._process
          const childPid = stdioTransport.pid

          if (stdioProc && getPlatform() === 'windows') {
            logMCPDebug(name, 'Closing MCP server stdin')
            await gracefulShutdownWindowsStdio(stdioProc)
          } else if (childPid) {
            logMCPDebug(name, 'Sending SIGINT to MCP server process')

            // First try SIGINT (like Ctrl+C)
            try {
              process.kill(childPid, 'SIGINT')
            } catch (error) {
              logMCPDebug(name, `Error sending SIGINT: ${error}`)
              return
            }

            // Wait for graceful shutdown with rapid escalation (total 500ms to keep CLI responsive)
            // biome-ignore lint/suspicious/noAsyncPromiseExecutor: async needed for sequential await inside executor
            await new Promise<void>(async resolve => {
              let resolved = false

              // Set up a timer to check if process still exists
              const checkInterval = setInterval(() => {
                try {
                  // process.kill(pid, 0) checks if process exists without killing it
                  process.kill(childPid, 0)
                } catch {
                  // Process no longer exists
                  if (!resolved) {
                    resolved = true
                    clearInterval(checkInterval)
                    clearTimeout(failsafeTimeout)
                    logMCPDebug(name, 'MCP server process exited cleanly')
                    resolve()
                  }
                }
              }, 50)

              // Absolute failsafe: clear interval after 600ms no matter what
              const failsafeTimeout = setTimeout(() => {
                if (!resolved) {
                  resolved = true
                  clearInterval(checkInterval)
                  logMCPDebug(
                    name,
                    'Cleanup timeout reached, stopping process monitoring',
                  )
                  resolve()
                }
              }, 600)

              try {
                // Wait 100ms for SIGINT to work (usually much faster)
                await sleep(100)

                if (!resolved) {
                  // Check if process still exists
                  try {
                    process.kill(childPid, 0)
                    // Process still exists, SIGINT failed, try SIGTERM
                    logMCPDebug(
                      name,
                      'SIGINT failed, sending SIGTERM to MCP server process',
                    )
                    try {
                      process.kill(childPid, 'SIGTERM')
                    } catch (termError) {
                      logMCPDebug(name, `Error sending SIGTERM: ${termError}`)
                      resolved = true
                      clearInterval(checkInterval)
                      clearTimeout(failsafeTimeout)
                      resolve()
                      return
                    }
                  } catch {
                    // Process already exited
                    resolved = true
                    clearInterval(checkInterval)
                    clearTimeout(failsafeTimeout)
                    resolve()
                    return
                  }

                  // Wait 400ms for SIGTERM to work (slower than SIGINT, often used for cleanup)
                  await sleep(400)

                  if (!resolved) {
                    // Check if process still exists
                    try {
                      process.kill(childPid, 0)
                      // Process still exists, SIGTERM failed, force kill with SIGKILL
                      logMCPDebug(
                        name,
                        'SIGTERM failed, sending SIGKILL to MCP server process',
                      )
                      try {
                        process.kill(childPid, 'SIGKILL')
                      } catch (killError) {
                        logMCPDebug(name, `Error sending SIGKILL: ${killError}`)
                      }
                    } catch {
                      // Process already exited
                      resolved = true
                      clearInterval(checkInterval)
                      clearTimeout(failsafeTimeout)
                      resolve()
                    }
                  }
                }

                // Final timeout - always resolve after 500ms max (total cleanup time)
                if (!resolved) {
                  resolved = true
                  clearInterval(checkInterval)
                  clearTimeout(failsafeTimeout)
                  resolve()
                }
              } catch {
                // Handle any errors in the escalation sequence
                if (!resolved) {
                  resolved = true
                  clearInterval(checkInterval)
                  clearTimeout(failsafeTimeout)
                  resolve()
                }
              }
            })
          }
        } catch (processError) {
          logMCPDebug(name, `Error terminating process: ${processError}`)
        }
      }

      // Close the client connection (which also closes the transport)
      try {
        await client.close()
      } catch (error) {
        logMCPDebug(name, `Error closing client: ${error}`)
      }
    }

    // Register cleanup for all transport types - even network transports might need cleanup
    // This ensures all MCP servers get properly terminated, not just stdio ones
    const cleanupUnregister = registerCleanup(cleanup)

    // Create the wrapped cleanup that includes unregistering
    const wrappedCleanup = async () => {
      hostState.liveMcpClients.delete(client)
      cleanupUnregister?.()
      await cleanup()
    }
    hostState.liveMcpClients.add(client)

    const connectionDurationMs = Date.now() - connectStartTime
    logEvent('tengu_mcp_server_connection_succeeded', {
      connectionDurationMs,
      transportType: (serverRef.type ??
        'stdio') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      totalServers: serverStats?.totalServers,
      stdioCount: serverStats?.stdioCount,
      sseCount: serverStats?.sseCount,
      httpCount: serverStats?.httpCount,
      sseIdeCount: serverStats?.sseIdeCount,
      wsIdeCount: serverStats?.wsIdeCount,
      ...mcpBaseUrlAnalytics(serverRef),
    })

    // densable 2.1.233 #6 — hNf: subscriptions/listen re-open / park watcher.
    // densable opS uses timeout:k0() ≡ getMcpTimeoutMs() (MCP_TIMEOUT / y0).
    // No-ops on legacy era without autoOpenedSubscription (list_changed via
    // unsolicited notifications + setNotificationHandler still works).
    try {
      const { attachMcpListenReopenWatcher } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../mcpListenReopen.js') as typeof import('../mcpListenReopen.js')
      attachMcpListenReopenWatcher(
        client as import('../mcpListenReopen.js').McpListenCapableClient,
        name,
        { timeoutMs: getMcpTimeoutMs() },
      )
    } catch (err) {
      logMCPDebug(
        name,
        `subscriptions/listen re-open watcher attach failed: ${errorMessage(err)}`,
      )
    }

    const connectedClientResult: ConnectedMCPServer = {
      name,
      client,
      type: 'connected' as const,
      capabilities: capabilities ?? {},
      serverInfo: serverVersion,
      instructions,
      config: serverRef,
      cleanup: wrappedCleanup,
      transportErrorState,
      // densable M.protocolEra — i3r/Yrf era gate. Unset is not modern.
      protocolEra: readClientProtocolEra(client),
    }
    // Official 2.1.325 #2305 (`Hmi()?.(Os)`): immediately run session-level
    // connected-client wiring (e.g. headless elicitation handler) before
    // returning so a reconnect mid-tool-call never falls back to the cancel
    // placeholder.
    try {
      const wiring = hostState.connectedClientWiring
      if (wiring) {
        const wiringSession =
          hostState.connectedClientWiringSession ?? capturedSession
        runWithSession(wiringSession, () => wiring(connectedClientResult))
      }
    } catch (wiringErr) {
      logMCPError(
        name,
        `connected-client wiring failed (placeholder retained, adoption will retry): ${errorMessage(wiringErr)}`,
      )
    }
    if (serverRef.type === 'http' || serverRef.type === 'sse') {
      await clearMcpOAuthStubIfTokenless(name, serverRef)
    }
    // Official 2.1.325 #2308: notify background MCP task pollers that a fresh
    // connection for this server is live so they resume updating.
    notifyMcpServerConnected(connectedClientResult)
    return connectedClientResult
  } catch (error) {
    const connectionDurationMs = Date.now() - connectStartTime
    logEvent('tengu_mcp_server_connection_failed', {
      connectionDurationMs,
      totalServers: serverStats?.totalServers || 1,
      stdioCount:
        serverStats?.stdioCount || (serverRef.type === 'stdio' ? 1 : 0),
      sseCount: serverStats?.sseCount || (serverRef.type === 'sse' ? 1 : 0),
      httpCount: serverStats?.httpCount || (serverRef.type === 'http' ? 1 : 0),
      sseIdeCount:
        serverStats?.sseIdeCount || (serverRef.type === 'sse-ide' ? 1 : 0),
      wsIdeCount:
        serverStats?.wsIdeCount || (serverRef.type === 'ws-ide' ? 1 : 0),
      transportType: (serverRef.type ??
        'stdio') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...mcpBaseUrlAnalytics(serverRef),
    })
    logMCPDebug(
      name,
      `Connection failed after ${connectionDurationMs}ms: ${errorMessage(error)}`,
    )
    logMCPError(name, `Connection failed: ${errorMessage(error)}`)

    if (transportState.inProcessServer) {
      transportState.inProcessServer.close().catch(() => {})
    }
    // densable 2.1.219: surface errorCode (HTTP / errno / ENDPOINT_NOT_FOUND)
    // so mcp list / /mcp can show status — issue (fSp/mSp).
    let errorText = errorMessage(error)
    const issuerEchoDenied =
      error instanceof IssuerEchoCrossOriginError ||
      (error instanceof Error &&
        error.cause instanceof IssuerEchoCrossOriginError)
    let errorCode = issuerEchoDenied
      ? 'ISSUER_ECHO_DENIED'
      : extractMcpConnectionErrorCode(error, {
          transportType: serverRef.type,
          hasSessionId: false,
        })
    if (errorCode === 'CONNECT_TIMEOUT') {
      const suspendedMessage = detectConnectSuspendedMessage(
        name,
        connectClockSnapshot,
      )
      if (suspendedMessage !== undefined) {
        errorCode = 'CONNECT_SUSPENDED'
        errorText = suspendedMessage
      }
    }
    if (errorCode === 'ENDPOINT_NOT_FOUND' && 'url' in serverRef) {
      // densable 2.1.234 #13 cHr — connection-failure details show only origin
      const origin = getMcpServerUrlOrigin(serverRef) ?? '(unparseable url)'
      errorText = `MCP endpoint not found at ${origin}. Check the URL in your MCP config.`
    }
    if (
      (serverRef.type === undefined || serverRef.type === 'stdio') &&
      capturedStartupStderr &&
      !errorText.includes(capturedStartupStderr)
    ) {
      errorText = errorText
        ? `${errorText}\n${capturedStartupStderr}`
        : capturedStartupStderr
    }
    return {
      name,
      type: 'failed' as const,
      config: serverRef,
      error: errorText,
      ...(errorCode !== undefined ? { errorCode } : {}),
    }
  }
}
