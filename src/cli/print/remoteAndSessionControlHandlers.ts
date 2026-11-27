/**
 * Headless streaming session/remote control request handlers:
 * claim_session, set_cwd, register_repo_root, seed_read_state, stop_task,
 * background_tasks, generate_session_title, side_question, set_proactive, remote_control.
 */
import type {
  ControlRequestDispatchContext,
  HeadlessStreamingContext,
} from './streamingTypes.js'
import {
  isClaimSessionRequest,
  takeHeldBackMcpConfigs,
  getSpareClaimState,
  markSpareClaimFailed,
} from 'src/cli/spareClaim.js'
import {
  handleClaimSessionRequest,
  applyClaimWorkspaceTrust,
} from 'src/cli/claimSession.js'
import {
  getMainThreadQueueLength,
  enqueue,
  getCommandQueue,
} from 'src/utils/messageQueueManager.js'
import { retireDepartedAdditionalDirectories } from 'src/utils/settings/applySettingsChange.js'
import { getMcpToolsCommandsAndResources } from 'src/services/mcp/client.js'
import uniqBy from 'lodash-es/uniqBy.js'
import { refreshActivePlugins } from '../../utils/plugins/refresh.js'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { sanitizeSessionTitle } from 'src/utils/sessionTitleSanitize.js'
import {
  cacheSessionTitle,
  saveAiGeneratedTitle,
} from 'src/utils/sessionStorage.js'
import { parseAgentsFromJson } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  PERMISSION_MODES,
  type PermissionMode as InternalPermissionMode,
} from 'src/types/permissions.js'
import {
  setPermissionModeWithGuards,
  isAutoModeGateEnabled,
} from 'src/utils/permissions/permissionSetup.js'
import {
  processSessionStartHooks,
  takeInitialUserMessage,
} from 'src/utils/sessionStart.js'
import { sleep } from 'src/utils/sleep.js'
import { getCwd } from 'src/utils/cwd.js'
import { buildSdkInitializeResponse } from 'src/cli/headless/HeadlessControlPlane.js'
import { hasUnsafePathChars } from 'src/commands/cd/cdPermission.js'
import { isRemoteControlOriginForSetCwd } from './startupAndAccount.js'
import { logEvent } from 'src/services/analytics/index.js'
import { handleRegisterRepoRoot } from 'src/commands/add-dir/registerRepoRoot.js'
import { expandPath } from 'src/utils/path.js'
import { applyPermissionUpdate } from 'src/utils/permissions/PermissionUpdate.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  setAdditionalDirectoriesForClaudeMd,
  getSessionId,
  setMainLoopModelOverride,
} from 'src/bootstrap/state.js'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import { clearMemoryFileCaches } from 'src/utils/claudemd.js'
import { clearCommandsCache } from '../../commands.js'
import { executeDirectoryAddedHooks } from 'src/utils/hooks.js'
import { stat, readFile } from 'fs/promises'
import { stopTask } from '../../tasks/stopTask.js'
import {
  backgroundTaskByToolUseId,
  backgroundAll,
} from '../../tasks/LocalShellTask/LocalShellTask.js'
import {
  createAbortController,
  createAbortErrorReason,
} from 'src/utils/abortController.js'
import { generateSessionTitle } from 'src/utils/sessionTitle.js'
import { type UUID, randomUUID } from 'crypto'
import { getReplBridgeHandle } from 'src/bridge/replBridgeHandle.js'
import { logError } from 'src/utils/log.js'
import { getLastCacheSafeParams } from 'src/utils/forkedAgent.js'
import { buildSideQuestionFallbackParams } from 'src/utils/queryContext.js'
import { resolvePrintSystemPrompt } from './outputFormatting.js'
import { runSideQuestion } from 'src/utils/sideQuestion.js'
import { feature } from 'bun:bundle'
import { proactiveModule } from './featureLoaders.js'
import { getRemoteSessionUrl } from 'src/constants/product.js'
import { buildBridgeConnectUrl } from 'src/bridge/bridgeStatusUtil.js'
import { decideReplBridgeSetModel } from 'src/utils/model/printSetModel.js'
import {
  parseEffortValue,
  isUltracodeEffortAlias,
  getUltracodeEffortForModel,
  sessionEffortEquals,
  levelSessionEffort,
} from 'src/utils/effort.js'
import { getMainLoopModel } from 'src/utils/model/model.js'
import { extractInboundMessageFields } from 'src/bridge/inboundMessages.js'
import { markSessionStoppedForPluginInput } from 'src/utils/plugins/functionHooksModules.js'
import {
  isFastModeEnabled,
  clearFastModeCooldown,
  applyFastModeOnModelSwitch,
} from 'src/utils/fastMode.js'
import { notifySessionMetadataChanged } from 'src/utils/sessionState.js'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { getSessionIngressAuthToken } from 'src/utils/sessionIngressAuth.js'

export async function handleRemoteAndSessionControlRequest(
  streamCtx: HeadlessStreamingContext,
  ctrlDispatch: ControlRequestDispatchContext,
): Promise<boolean> {
  const { msg, req, inFlightControlRequests, deferControlLifecycleUntilDone } =
    ctrlDispatch
  if (isClaimSessionRequest(req)) {
    // densable ne @210326103 + print host @199134207
    try {
      const claim = await handleClaimSessionRequest(req, {
        isBusy: () =>
          (streamCtx.running && streamCtx.runPhase !== 'waiting_for_agents') ||
          getMainThreadQueueLength() > 0,
        isFreshSession: () => !ctrlDispatch.isInitialized(),
        permissionModeSuppliedOnInvocation:
          streamCtx.options.permissionModeSuppliedOnInvocation !== false,
        getToolPermissionContext: () =>
          streamCtx.getAppState().toolPermissionContext,
        setToolPermissionContext: ctx => {
          streamCtx.setAppState(prev =>
            prev.toolPermissionContext === ctx
              ? prev
              : { ...prev, toolPermissionContext: ctx },
          )
        },
        retireDepartedAdditionalDirectories: directories => {
          streamCtx.setAppState(prev => {
            const next = retireDepartedAdditionalDirectories(
              prev.toolPermissionContext,
              directories,
            )
            return next === prev.toolPermissionContext
              ? prev
              : { ...prev, toolPermissionContext: next }
          })
        },
        startDeferredMcpServers: async () => {
          // densable A.startDeferredMcpServers / Xt @192086918
          const held = takeHeldBackMcpConfigs()
          const already = new Set([
            ...streamCtx.getAppState().mcp.clients.map(c => c.name),
            ...streamCtx.dynamicMcpState.clients.map(c => c.name),
            ...Object.keys(streamCtx.dynamicMcpState.configs),
          ])
          const toStart = Object.fromEntries(
            Object.entries(held).filter(([name]) => !already.has(name)),
          )
          if (Object.keys(toStart).length === 0) return
          await getMcpToolsCommandsAndResources(
            ({ client, tools, commands }) => {
              streamCtx.setAppState(prev => ({
                ...prev,
                mcp: {
                  ...prev.mcp,
                  clientsInitialized: true,
                  clients: prev.mcp.clients.some(c => c.name === client.name)
                    ? prev.mcp.clients.map(c =>
                        c.name === client.name ? client : c,
                      )
                    : [...prev.mcp.clients, client],
                  tools: uniqBy([...prev.mcp.tools, ...tools], 'name'),
                  commands: uniqBy([...prev.mcp.commands, ...commands], 'name'),
                },
              }))
            },
            toStart,
          )
        },
        rehomePluginsAndMcp: async () => {
          try {
            await refreshActivePlugins(streamCtx.setAppState, {
              applyStagedInstalls: false,
            })
          } catch (e) {
            logForDebugging(
              `claim_session: re-homing plugins/MCP for the claimed directory failed (continuing): ${errorMessage(e)}`,
              { level: 'error' },
            )
          }
        },
        applyPromptOptions: se => {
          if (se.systemPrompt !== undefined) {
            streamCtx.options.systemPrompt =
              Array.isArray(se.systemPrompt) &&
              se.systemPrompt.length === 1 &&
              se.systemPrompt[0] === ''
                ? ''
                : Array.isArray(se.systemPrompt)
                  ? se.systemPrompt.join('\n')
                  : se.systemPrompt
          }
          if (se.appendSystemPrompt !== undefined) {
            streamCtx.options.appendSystemPrompt = se.appendSystemPrompt
          }
          if (typeof se.title === 'string') {
            const title = sanitizeSessionTitle(se.title)
            if (title) {
              cacheSessionTitle(title)
            }
          }
          if (se.agents) {
            const stdinAgents = parseAgentsFromJson(
              se.agents as Parameters<typeof parseAgentsFromJson>[0],
              'flagSettings',
            )
            const seen = new Set(streamCtx.currentAgents.map(a => a.agentType))
            streamCtx.currentAgents = [
              ...streamCtx.currentAgents,
              ...stdinAgents.filter(a => !seen.has(a.agentType)),
            ]
          }
        },
        currentPermissionMode: () =>
          streamCtx.getAppState().toolPermissionContext.mode,
        checkPermissionMode: se => {
          if (!(PERMISSION_MODES as readonly string[]).includes(se)) {
            return `Invalid permission mode '${se}'. Valid modes: ${PERMISSION_MODES.join(', ')}`
          }
          const ctx = streamCtx.getAppState().toolPermissionContext
          const result = setPermissionModeWithGuards(
            se as InternalPermissionMode,
            ctx,
            () => {},
          )
          return result.ok ? undefined : result.error
        },
        applyPermissionMode: se => {
          let error: string | undefined
          const result = setPermissionModeWithGuards(
            se as InternalPermissionMode,
            streamCtx.getAppState().toolPermissionContext,
            updater => {
              streamCtx.setAppState(prev => {
                const next = updater(prev.toolPermissionContext)
                return next === prev.toolPermissionContext
                  ? prev
                  : {
                      ...prev,
                      toolPermissionContext: next,
                    }
              })
            },
          )
          if (!result.ok) error = result.error
          return error
        },
        recheckAutoModeGate: () => {
          if (
            streamCtx.getAppState().toolPermissionContext.mode === 'auto' &&
            !isAutoModeGateEnabled()
          ) {
            streamCtx.setAppState(prev => ({
              ...prev,
              toolPermissionContext: {
                ...prev.toolPermissionContext,
                mode: 'default',
              },
            }))
          }
        },
        setSdkMcpServers: se => {
          const keep = new Set(se)
          for (const name of Object.keys(streamCtx.sdkMcpConfigs)) {
            if (!keep.has(name)) delete streamCtx.sdkMcpConfigs[name]
          }
          for (const name of se) {
            streamCtx.sdkMcpConfigs[name] ??= { type: 'sdk', name }
          }
          void streamCtx.updateSdkMcp()
        },
        sdkMcpSettled: () =>
          Object.keys(streamCtx.sdkMcpConfigs).every(name =>
            streamCtx.sdkClients.some(
              c => c.name === name && c.type === 'connected',
            ),
          ),
        startSessionStartHooks: () => {
          void processSessionStartHooks('startup')
            .then(messages => {
              const texts: string[] = []
              for (const m of messages) {
                const att = (m as { attachment?: { content?: unknown } })
                  .attachment
                if (att && typeof att.content === 'string' && att.content) {
                  texts.push(att.content)
                } else if (att && Array.isArray(att.content)) {
                  texts.push(
                    att.content.filter(x => typeof x === 'string').join('\n'),
                  )
                }
              }
              const initial = takeInitialUserMessage()
              if (initial) texts.push(initial)
              return texts.filter(Boolean)
            })
            .catch(ve => {
              logForDebugging(
                `claim_session: SessionStart hooks failed (continuing without their output): ${errorMessage(ve)}`,
                { level: 'error' },
              )
              return [] as string[]
            })
            .then(async texts => {
              if (texts.length === 0) return
              const remaining = [...texts]
              const queued = new Promise<string | undefined>(resolve => {
                streamCtx.claimFirstTurnAck = et => {
                  if ('cannotQueue' in et) {
                    resolve(et.cannotQueue)
                    return
                  }
                  const queuedText =
                    typeof et.queued === 'string' ? et.queued : ''
                  const i = remaining.indexOf(queuedText)
                  if (i !== -1) remaining.splice(i, 1)
                  if (remaining.length === 0) resolve(undefined)
                }
              })
              for (const t of texts) {
                streamCtx.structuredIO.prependUserMessage(t)
              }
              const raced = await Promise.race([
                queued,
                sleep(streamCtx.CLAIM_SESSION_START_QUEUE_WAIT_MS, undefined, {
                  unref: true,
                }).then(
                  () =>
                    `not queued after ${streamCtx.CLAIM_SESSION_START_QUEUE_WAIT_MS}ms`,
                ),
              ])
              streamCtx.claimFirstTurnAck = undefined
              if (raced !== undefined) {
                logForDebugging(
                  `claim_session: the session's own first-turn messages will not run ahead of the host's messages (${raced}); releasing the host's messages`,
                  { level: 'warn' },
                )
              }
            })
            .catch(ve => {
              streamCtx.claimFirstTurnAck = undefined
              logForDebugging(
                `claim_session: queueing the session's own first-turn messages failed (continuing): ${errorMessage(ve)}`,
                { level: 'error' },
              )
            })
        },
        applyWorkspaceTrust: se =>
          applyClaimWorkspaceTrust(se, { cwd: getCwd() }),
        announceStartingChange: () => {},
        buildInitializePayload: async workspaceTrustRecorded => {
          const payload = await buildSdkInitializeResponse(
            streamCtx.currentCommands,
            streamCtx.currentAgents,
            streamCtx.modelInfos,
            streamCtx.options,
            streamCtx.getAppState,
          )
          return {
            ...payload,
            ...(workspaceTrustRecorded !== undefined
              ? { workspace_trust_recorded: workspaceTrustRecorded }
              : {}),
          }
        },
      })
      if (claim.kind === 'ok') {
        streamCtx.sendControlResponseSuccess(
          msg,
          claim.response as Record<string, unknown>,
        )
      } else {
        streamCtx.sendControlResponseError(msg, claim.message)
      }
    } catch (ie) {
      const detail = errorMessage(ie)
      const safe = hasUnsafePathChars(detail)
        ? '(error detail withheld)'
        : detail
      if (getSpareClaimState() === 'claiming') {
        markSpareClaimFailed()
        streamCtx.sendControlResponseError(
          msg,
          `claim_failed: ${safe} — discard this spare`,
        )
      } else {
        streamCtx.sendControlResponseError(
          msg,
          `rejected: ${safe} — the spare is still parked`,
        )
      }
    }
  } else if (msg.request.subtype === 'set_cwd') {
    // #1959: Remote Control sessions stay in the folder they were started in.
    if (
      isRemoteControlOriginForSetCwd({
        sdkUrl: streamCtx.options.sdkUrl,
        hasBridgeHandle: Boolean(streamCtx.bridgeHandle),
      })
    ) {
      logEvent('tengu_set_cwd_remote_refused', {})
      streamCtx.sendControlResponseSuccess(msg, {
        status: 'rejected',
        reason: 'remote_origin',
        message:
          'This Remote Control session stays in the folder it was started in. To work in another folder, start a new session there.',
      })
      return true
    }
    // densable 2.1.218 fCb — headless /cd twin for SDK hosts.
    // Busy = running && runPhase !== waiting_for_agents || mainThreadQueue > 0
    // (densable oSm). Trust delegated via needs_trust; move notice enqueued meta.
    const setCwdReq = msg.request as {
      subtype: 'set_cwd'
      path: string
      trust_accepted?: boolean
      trusted_directory?: string
    }
    try {
      const { handleSetCwdControlRequest, buildSetCwdMoveNoticeCommand } =
        await import('../../commands/cd/cdCommand.js')
      const result = await handleSetCwdControlRequest(setCwdReq, {
        isBusy: () =>
          (streamCtx.running && streamCtx.runPhase !== 'waiting_for_agents') ||
          getMainThreadQueueLength() > 0,
        toolPermissionContext: streamCtx.getAppState().toolPermissionContext,
        retireDepartedAdditionalDirectories: directories => {
          streamCtx.setAppState(prev => {
            const next = retireDepartedAdditionalDirectories(
              prev.toolPermissionContext,
              directories,
            )
            return next === prev.toolPermissionContext
              ? prev
              : { ...prev, toolPermissionContext: next }
          })
        },
        enqueueMoveNotice: (modelMessage: string) => {
          enqueue(buildSetCwdMoveNoticeCommand(modelMessage))
          void streamCtx.run()
        },
      })
      if (result.kind === 'response') {
        streamCtx.sendControlResponseSuccess(msg, { ...result.response })
      } else {
        streamCtx.sendControlResponseError(msg, result.message)
      }
    } catch (err) {
      let safeWire: ((path: string, fallback: string) => string) | null = null
      try {
        const mod = await import('../../commands/cd/cdPermission.js')
        safeWire = mod.safeWireMessage
      } catch {
        safeWire = null
      }
      const detail = errorMessage(err)
      const safeDetail = safeWire
        ? safeWire(
            detail,
            '(error detail withheld: it contains control or invisible characters)',
          )
        : '(error detail unavailable)'
      const cwdNow = getCwd()
      const stay = safeWire
        ? safeWire(
            `The session's working directory is ${cwdNow}.`,
            'The session stayed in its previous working directory.',
          )
        : 'The session stayed in its previous working directory.'
      streamCtx.sendControlResponseError(
        msg,
        `set_cwd: relocation failed — ${safeDetail}. ${stay}`,
      )
    }
  } else if (
    (msg.request as { subtype?: string }).subtype === 'register_repo_root'
  ) {
    // densable 2.1.219 He / register_repo_root — SDK twin of /add-dir
    // for strict subdirs of cwd or launch --add-dir roots.
    const regReq = msg.request as {
      subtype: 'register_repo_root'
      directory: string
      reload_claude_md?: boolean
      reload_plugins?: boolean
      reload_skills?: boolean
    }
    deferControlLifecycleUntilDone(async () => {
      try {
        const result = await handleRegisterRepoRoot(
          {
            directory: expandPath(regReq.directory),
            reload_claude_md: regReq.reload_claude_md,
            reload_plugins: regReq.reload_plugins,
            reload_skills: regReq.reload_skills,
          },
          {
            getCwd,
            getToolPermissionContext: () =>
              streamCtx.getAppState().toolPermissionContext,
            applyAddDirectory: (canonicalPath: string) => {
              streamCtx.setAppState(prev => ({
                ...prev,
                toolPermissionContext: applyPermissionUpdate(
                  prev.toolPermissionContext,
                  {
                    type: 'addDirectories',
                    directories: [canonicalPath],
                    destination: 'session',
                  },
                ),
              }))
            },
            getBootstrapAdditionalDirs: getAdditionalDirectoriesForClaudeMd,
            setBootstrapAdditionalDirs: setAdditionalDirectoriesForClaudeMd,
            refreshSandbox: () => {
              SandboxManager.refreshConfig()
            },
            clearMemoryFileCaches,
            clearCommandsCache,
            reloadPlugins: async () => {
              await refreshActivePlugins(streamCtx.setAppState, {
                applyStagedInstalls: false,
              })
            },
            logDebug: (m, opts) => {
              logForDebugging(
                m,
                opts as
                  | {
                      level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'
                    }
                  | undefined,
              )
            },
            startKeepAlive: () => {
              // densable bs() — keep_alive while DirectoryAdded hooks run
              const timer = setInterval(() => {
                try {
                  streamCtx.output.enqueue({ type: 'keep_alive' })
                } catch {
                  // stream may be closed
                }
              }, 30_000)
              timer.unref?.()
              return () => clearInterval(timer)
            },
            executeDirectoryAddedHooks: (directory, source) =>
              executeDirectoryAddedHooks(directory, source),
          },
        )
        if (result.ok) {
          streamCtx.sendControlResponseSuccess(msg, {
            directory: result.directory,
          })
        } else {
          streamCtx.sendControlResponseError(msg, result.error)
        }
      } catch (err) {
        streamCtx.sendControlResponseError(msg, errorMessage(err))
      }
    })
  } else if (msg.request.subtype === 'seed_read_state') {
    // Client observed a Read that was later removed from context (e.g.
    // by snip), so transcript-based seeding missed it. Queued into
    // pendingSeeds; applied at the next clone-replace boundary.
    try {
      // expandPath: all other readFileState writers normalize (~, relative,
      // session cwd vs process cwd). FileEditTool looks up by expandPath'd
      // key — a verbatim client path would miss.
      const normalizedPath = expandPath(msg.request.path)
      // Check disk mtime before reading content. If the file changed
      // since the client's observation, readFile would return C_current
      // but we'd store it with the client's M_observed — getChangedFiles
      // then sees disk > cache.timestamp, re-reads, diffs C_current vs
      // C_current = empty, emits no attachment, and the model is never
      // told about the C_observed → C_current change. Skipping the seed
      // makes Edit fail "file not read yet" → forces a fresh Read.
      // Math.floor matches FileReadTool and getFileModificationTime.
      const diskMtime = Math.floor((await stat(normalizedPath)).mtimeMs)
      if (diskMtime <= msg.request.mtime) {
        const raw = await readFile(normalizedPath, 'utf-8')
        // Strip BOM + normalize CRLF→LF to match readFileInRange and
        // readFileSyncWithMetadata. FileEditTool's content-compare
        // fallback (for Windows mtime bumps without content change)
        // compares against LF-normalized disk reads.
        const content = (
          raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
        ).replaceAll('\r\n', '\n')
        streamCtx.pendingSeeds.set(normalizedPath, {
          content,
          timestamp: diskMtime,
          offset: undefined,
          limit: undefined,
        })
      }
    } catch {
      // ENOENT etc — skip seeding but still succeed
    }
    streamCtx.sendControlResponseSuccess(msg)
  } else if (msg.request.subtype === 'stop_task') {
    const { task_id: taskId } = msg.request
    try {
      // densable: host/SDK stop is true user stop (jCe + killedBy user)
      await stopTask(taskId, {
        getAppState: streamCtx.getAppState,
        setAppState: streamCtx.setAppState,
        source: 'user',
        killedBy: 'user',
      })
      streamCtx.sendControlResponseSuccess(msg, {})
    } catch (error) {
      streamCtx.sendControlResponseError(msg, errorMessage(error))
    }
  } else if (msg.request.subtype === 'background_tasks') {
    // Official 2.1.x: Ctrl+B over stream-json. With tool_use_id, target
    // that originating tool_use's task; without, backgroundAll.
    try {
      const toolUseId = msg.request.tool_use_id
      if (typeof toolUseId === 'string' && toolUseId.length > 0) {
        const backgrounded = backgroundTaskByToolUseId(
          toolUseId,
          streamCtx.getAppState,
          streamCtx.setAppState,
        )
        streamCtx.sendControlResponseSuccess(msg, { backgrounded })
      } else {
        backgroundAll(streamCtx.getAppState, streamCtx.setAppState)
        streamCtx.sendControlResponseSuccess(msg, {})
      }
    } catch (error) {
      streamCtx.sendControlResponseError(msg, errorMessage(error))
    }
  } else if (req.subtype === 'generate_session_title') {
    // densable ra: fire-and-forget with lifecycle completed only after work.
    // Haiku must not block the stdin loop, but must not mark complete early.
    const description = req.description as string
    const persist = req.persist as boolean
    // #1544: Use an independent AbortController not tied to turn Stop
    // so interrupting/stopping the turn does not abort title generation.
    const titleSignal = createAbortController().signal
    deferControlLifecycleUntilDone(async () => {
      try {
        const title = await generateSessionTitle(description, titleSignal)
        if (title && persist) {
          try {
            saveAiGeneratedTitle(getSessionId() as UUID, title)
            getReplBridgeHandle()?.adoptLocalAiTitle?.()
          } catch (e) {
            logError(e)
          }
        }
        streamCtx.sendControlResponseSuccess(msg, { title })
      } catch (e) {
        // Unreachable in practice — generateSessionTitle wraps its
        // own body and returns null, saveAiGeneratedTitle is wrapped
        // above. Propagate (not swallow) so unexpected failures are
        // visible to the SDK caller (hostComms.ts catches and logs).
        streamCtx.sendControlResponseError(msg, errorMessage(e))
      }
    })
  } else if (req.subtype === 'side_question') {
    // densable ra: same F&F + lifecycle-after-work as generate_session_title.
    //
    // The snapshot captured by stopHooks (for querySource === 'sdk')
    // holds the exact systemPrompt/userContext/systemContext/messages
    // sent on the last main-thread turn. Reusing them gives a byte-
    // identical prefix → prompt cache hit.
    //
    // Fallback (resume before first turn completes — no snapshot yet):
    // rebuild from scratch. buildSideQuestionFallbackParams mirrors
    // QueryEngine's system prompt assembly (including
    // --system-prompt / --append-system-prompt) so the rebuilt prefix
    // matches in the common case. May still miss the cache for
    // coordinator mode or memory-mechanics extras — acceptable, the
    // alternative is the side question failing entirely.
    const question = req.question as string
    inFlightControlRequests
      .get(msg.request_id)
      ?.abort(createAbortErrorReason('remote-cancel'))
    deferControlLifecycleUntilDone(async () => {
      const sideAbort = createAbortController()
      inFlightControlRequests.set(msg.request_id, sideAbort)
      try {
        const saved = getLastCacheSafeParams()
        const cacheSafeParams = saved
          ? {
              ...saved,
              // If the last turn was interrupted, the snapshot holds an
              // already-aborted controller; createChildAbortController in
              // createSubagentContext would propagate it and the fork
              // would die before sending a request. The controller is
              // not part of the cache key — swapping in a fresh one is
              // safe. Same guard as generate_session_title above.
              toolUseContext: {
                ...saved.toolUseContext,
                abortController: sideAbort,
              },
            }
          : await buildSideQuestionFallbackParams({
              tools: streamCtx.buildAllTools(streamCtx.getAppState()),
              commands: streamCtx.currentCommands,
              mcpClients: [
                ...streamCtx.getAppState().mcp.clients,
                ...streamCtx.sdkClients,
                ...streamCtx.dynamicMcpState.clients,
              ],
              messages: streamCtx.mutableMessages,
              readFileState: streamCtx.readFileState,
              toolState: streamCtx.sessionToolState,
              taskRegistry: streamCtx.sessionTaskRegistry,
              getAppState: streamCtx.getAppState,
              setAppState: streamCtx.setAppState,
              customSystemPrompt: resolvePrintSystemPrompt(
                streamCtx.options.systemPrompt,
              ),
              appendSystemPrompt: streamCtx.options.appendSystemPrompt,
              thinkingConfig: streamCtx.options.thinkingConfig,
              agents: streamCtx.currentAgents,
            })
        if (!saved) {
          cacheSafeParams.toolUseContext = {
            ...cacheSafeParams.toolUseContext,
            abortController: sideAbort,
          }
        }
        const result = await runSideQuestion({
          question,
          cacheSafeParams,
        })
        streamCtx.sendControlResponseSuccess(msg, { response: result.response })
      } catch (e) {
        streamCtx.sendControlResponseError(msg, errorMessage(e))
      } finally {
        if (inFlightControlRequests.get(msg.request_id) === sideAbort) {
          inFlightControlRequests.delete(msg.request_id)
        }
      }
    })
  } else if (
    (feature('PROACTIVE') || feature('KAIROS')) &&
    (msg.request as { subtype: string }).subtype === 'set_proactive'
  ) {
    const req = msg.request as unknown as {
      subtype: string
      enabled: boolean
    }
    if (req.enabled) {
      if (!proactiveModule!.isProactiveActive()) {
        proactiveModule!.activateProactive('command')
        streamCtx.scheduleProactiveTick!()
      }
    } else {
      proactiveModule!.deactivateProactive()
    }
    streamCtx.sendControlResponseSuccess(msg)
  } else if (req.subtype === 'remote_control') {
    if (req.enabled as boolean) {
      if (streamCtx.bridgeHandle) {
        // Already connected
        streamCtx.sendControlResponseSuccess(msg, {
          session_url: getRemoteSessionUrl(
            streamCtx.bridgeHandle.bridgeSessionId,
            streamCtx.bridgeHandle.sessionIngressUrl,
          ),
          connect_url: buildBridgeConnectUrl(
            streamCtx.bridgeHandle.environmentId,
            streamCtx.bridgeHandle.sessionIngressUrl,
          ),
          environment_id: streamCtx.bridgeHandle.environmentId,
        })
      } else {
        // initReplBridge surfaces gate-failure reasons via
        // onStateChange('failed', detail) before returning null.
        // Capture so the control-response error is actionable
        // ("/login", "disabled by your organization's policy", etc.)
        // instead of a generic "initialization failed".
        let bridgeFailureDetail: string | undefined
        try {
          const {
            initReplBridge,
            HEADLESS_BRIDGE_WORKSPACE_DIFF_COMPUTE_BUDGET,
          } = await import('src/bridge/initReplBridge.js')
          const { getReplDiffHost } = await import('src/utils/replDiffTab.js')
          if (!streamCtx.workSecretSession) {
            const { createHeadlessWorkSecretSession } = await import(
              'src/bridge/serverConfigSession.js'
            )
            // densable print La/du + permission into createHeadlessWorkSecretSession.
            const effortSeedLatch = { seedSetUltracode: false }
            streamCtx.workSecretSession = createHeadlessWorkSecretSession({
              stores: {
                getAppState: streamCtx.getAppState,
                setAppState: streamCtx.setAppState,
                getDynamicMcpState: () => streamCtx.dynamicMcpState,
              },
              getAppendSystemPrompt: () => streamCtx.options.appendSystemPrompt,
              setAppendSystemPrompt: value => {
                streamCtx.options.appendSystemPrompt = value
              },
              sdkHostConfigs: () => streamCtx.sdkMcpConfigs,
              awaitHostApplyQuiescence: async () => {},
              permission: {
                get: () => streamCtx.getAppState().toolPermissionContext,
                set: updater => {
                  streamCtx.setAppState(prev => ({
                    ...prev,
                    toolPermissionContext: updater(prev.toolPermissionContext),
                  }))
                },
              },
              applyModelPick: model => {
                const decision = decideReplBridgeSetModel(
                  model,
                  streamCtx.activeUserSpecifiedModel,
                )
                if (!decision.ok) {
                  return {
                    ok: false as const,
                    error: decision.error,
                  }
                }
                streamCtx.activeUserSpecifiedModel = decision.model
                setMainLoopModelOverride(decision.model)
                streamCtx.setAppState(prev => ({
                  ...prev,
                  mainLoopModelForSession: decision.model,
                }))
                return { ok: true as const }
              },
              applyEffortSeed: effort => {
                // densable RSo — parse level; unrecognized refuses.
                // Seed path must NOT N9 (invent-ban); Host apply_flag
                // remains orthogonal and keeps its own N9 sites.
                const parsed = parseEffortValue(effort)
                const ultracode = isUltracodeEffortAlias(effort)
                if (parsed === undefined && !ultracode) {
                  return {
                    ok: false as const,
                    error: 'unrecognized effort',
                  }
                }
                const clearUltracode =
                  !ultracode && effortSeedLatch.seedSetUltracode
                effortSeedLatch.seedSetUltracode = ultracode
                // Gold RSo: ultracode alias still writes sessionEffort
                // (xhigh / catalog top) + latch — not blank wire.
                const ultracodeWire = ultracode
                  ? getUltracodeEffortForModel(getMainLoopModel())
                  : undefined
                streamCtx.setAppState(prev => {
                  let next = prev
                  if (
                    parsed !== undefined &&
                    !sessionEffortEquals(
                      prev.sessionEffort,
                      levelSessionEffort(parsed),
                    )
                  ) {
                    next = {
                      ...next,
                      sessionEffort: levelSessionEffort(parsed),
                    }
                  } else if (
                    ultracodeWire !== undefined &&
                    !sessionEffortEquals(
                      prev.sessionEffort,
                      levelSessionEffort(ultracodeWire),
                    )
                  ) {
                    next = {
                      ...next,
                      sessionEffort: levelSessionEffort(ultracodeWire),
                    }
                  }
                  if (ultracode && !next.ultracode) {
                    next = { ...next, ultracode: true }
                  } else if (clearUltracode && next.ultracode) {
                    next = { ...next, ultracode: false }
                  }
                  return next
                })
                return { ok: true as const }
              },
              getSessionEffort: () => streamCtx.getAppState().sessionEffort,
            })
          }
          const handle = await initReplBridge({
            host: getReplDiffHost(),
            workspaceDiffComputeBudget:
              HEADLESS_BRIDGE_WORKSPACE_DIFF_COMPUTE_BUDGET,
            // Official 2.1.323 #2119 + 2.1.328 #592 (`runningHold`):
            // report `'running'` only when a turn or background subagent
            // is truly active so idle Desktop/VS Code sessions turning
            // RC on stay `'idle'`.
            backgroundHold: {
              holdsRunning: () =>
                Object.values(streamCtx.getAppState().tasks ?? {}).some(
                  t =>
                    (t.type === 'local_agent' ||
                      t.type === 'in_process_teammate') &&
                    t.status === 'running',
                ),
              isTurnUnderWay: () => Boolean(streamCtx.abortController),
              queuedTurnCount: () => getCommandQueue().length,
            },
            initialWorkerState:
              Boolean(streamCtx.abortController) ||
              Object.values(streamCtx.getAppState().tasks ?? {}).some(
                t =>
                  (t.type === 'local_agent' ||
                    t.type === 'in_process_teammate') &&
                  t.status === 'running',
              )
                ? 'running'
                : 'idle',
            onProjectsBindingHint: () => {
              streamCtx.workSecretSession?.resyncProjectsReplyMount()
            },
            getToolPermissionContext: () =>
              streamCtx.getAppState().toolPermissionContext,
            onInboundMessage(msg) {
              const fields = extractInboundMessageFields(msg)
              if (!fields) return
              const {
                content,
                uuid,
                clientPlatform,
                fileAttachments,
                textNotTyped,
                priority,
                origin,
              } = fields
              enqueue({
                value: content,
                mode: 'prompt' as const,
                uuid,
                // Official 2.1.328 (#429): preserve `priority` (e.g.
                // `'later'`) and `origin` on cross-session inbound
                // messages so they wait for the running turn in RC / Desktop.
                ...(priority !== undefined ? { priority } : {}),
                ...(origin !== undefined ? { origin } : {}),
                skipSlashCommands: true,
                // Official: stamp clientPlatform so concurrent re-queue
                // and drain can round-trip remote platform identity.
                ...(clientPlatform !== undefined ? { clientPlatform } : {}),
                ...(fileAttachments.length > 0 ? { fileAttachments } : {}),
                ...(textNotTyped ? { textNotTyped: true } : {}),
              })
              void streamCtx.run()
            },
            onPermissionResponse(response) {
              // Forward bridge permission responses into the
              // stdin processing loop so they resolve pending
              // permission requests from the SDK consumer.
              streamCtx.structuredIO.injectControlResponse(response)
            },
            onInterrupt() {
              markSessionStoppedForPluginInput()
              streamCtx.abortController?.abort()
            },
            onSetModel(model) {
              // densable 2.1.238 SDK onSetModel — allowlist/step-down only
              // (no print RGf). Restricted → `{ok:false}` so Zkd emits
              // error control_response. Unrecognized ids still apply.
              const decision = decideReplBridgeSetModel(
                model,
                streamCtx.activeUserSpecifiedModel,
              )
              if (!decision.ok) {
                logForDebugging(
                  `[bridge:sdk] onSetModel rejected: ${decision.error}`,
                )
                return { ok: false as const, error: decision.error }
              }
              streamCtx.activeUserSpecifiedModel = decision.model
              setMainLoopModelOverride(decision.model)
              // densable 2.1.219 #12 — mde() + remote MB on bridge set_model
              if (isFastModeEnabled()) {
                clearFastModeCooldown()
              }
              // densable 2.1.218 #31 — bridge onSetModel uU/dU (remote)
              streamCtx.setAppState(prev => {
                const applied = applyFastModeOnModelSwitch(
                  decision.model,
                  prev.fastMode,
                  { remoteSession: true },
                )
                return {
                  ...prev,
                  mainLoopModelForSession: decision.model,
                  ...(applied.changed
                    ? { fastMode: applied.nextFastMode }
                    : null),
                }
              })
              notifySessionMetadataChanged({ model: decision.model })
              if (decision.injectBreadcrumbs) {
                streamCtx.injectModelSwitchBreadcrumbs(
                  decision.requestedArg,
                  decision.model,
                )
              }
            },
            onSetMaxThinkingTokens(maxTokens) {
              if (maxTokens === null) {
                streamCtx.options.thinkingConfig = undefined
              } else if (maxTokens === 0) {
                streamCtx.options.thinkingConfig = { type: 'disabled' }
              } else {
                streamCtx.options.thinkingConfig = {
                  type: 'enabled',
                  budgetTokens: maxTokens,
                }
              }
            },
            onStateChange(state, detail) {
              if (state === 'failed') {
                bridgeFailureDetail = detail
              }
              logForDebugging(
                `[bridge:sdk] State change: ${state}${detail ? ` — ${detail}` : ''}`,
              )
              streamCtx.output.enqueue({
                type: 'system' as StdoutMessage['type'],
                subtype: 'bridge_state' as string,
                state,
                detail,
                uuid: randomUUID(),
                session_id: getSessionId(),
              } as StdoutMessage)
            },
            initialMessages:
              streamCtx.mutableMessages.length > 0
                ? streamCtx.mutableMessages
                : undefined,
          })
          if (!handle) {
            streamCtx.sendControlResponseError(
              msg,
              bridgeFailureDetail ?? 'Remote Control initialization failed',
            )
          } else {
            streamCtx.bridgeHandle = handle
            streamCtx.bridgeLastForwardedIndex =
              streamCtx.mutableMessages.length
            // densable vt.apply — seed meta/hearth mounts for this RC session.
            streamCtx.workSecretSession?.apply(
              {},
              {
                bridgeSessionId: handle.bridgeSessionId,
                getWorkerBearerToken: () => getSessionIngressAuthToken(),
              },
            )
            // Forward permission requests to the bridge
            streamCtx.structuredIO.setOnControlRequestSent(request => {
              handle.sendControlRequest(request)
            })
            // Cancel stale bridge permission prompts when the SDK
            // consumer resolves a can_use_tool request first.
            streamCtx.structuredIO.setOnControlRequestResolved(requestId => {
              handle.sendControlCancelRequest(requestId)
            })
            streamCtx.sendControlResponseSuccess(msg, {
              session_url: getRemoteSessionUrl(
                handle.bridgeSessionId,
                handle.sessionIngressUrl,
              ),
              connect_url: buildBridgeConnectUrl(
                handle.environmentId,
                handle.sessionIngressUrl,
              ),
              environment_id: handle.environmentId,
            })
          }
        } catch (err) {
          streamCtx.sendControlResponseError(msg, errorMessage(err))
        }
      }
    } else {
      // Disable
      if (streamCtx.bridgeHandle) {
        streamCtx.structuredIO.setOnControlRequestSent(undefined)
        streamCtx.structuredIO.setOnControlRequestResolved(undefined)
        await streamCtx.bridgeHandle.teardown()
        streamCtx.bridgeHandle = null
      }
      if (streamCtx.workSecretSession) {
        await streamCtx.workSecretSession.undo()
      }
      streamCtx.sendControlResponseSuccess(msg)
    }
  } else {
    return false
  }
  return true
}
