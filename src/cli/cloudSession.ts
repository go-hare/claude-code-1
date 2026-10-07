/**
 * densable 2.1.283 `--cloud` commander + `os()` / `hZn` / `iXe` / print-attach BODY.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - commander `--cloud [description|session_id|url]` @81206980 / @192115985
 * - `os()` @191780828
 * - `hZn` @188907230
 * - `iXe` / `xi` @191760290
 * - print attach send @192081124 (`runHeadlessCloudAttach` destructure + `QFe`)
 * - interactive create/attach gates @192151632 / @81214948
 * - `In` @202416789 / `EVo` create @202420586 / `vVo` attach @202432597
 * - `Wo` / `Lo` TTY+string refuse @202418900 / @202415169
 * - `Dn` features @202421000 (LaunchOptions slots only)
 *
 * HTTP client is existing first-party `fetchSession` + `sendEventToRemoteSession`
 * (`TI` / `QFe`) and CCR `teleportToRemote` / poll.
 * gold `m_n` @202374511 = `{done: new tn(e).done}` — local twin is
 * `startHeadlessCloudSession` wrapping `runHeadlessCloudHost`. SDK `{done}`
 * host STAYS here. leftover `Yo`/`tn.initializeWorker` compositor BODY is
 * leftoverHeadlessAttach.ts / leftoverHeadlessWorker.ts.
 */

import { Option } from '@commander-js/extra-typings'
import axios from 'axios'
import { tryQuoteShellArgs } from 'src/utils/bash/shellQuote.js'
import { getOauthConfig } from 'src/constants/oauth.js'
import { getRemoteSessionUrl } from 'src/constants/product.js'
import { StructuredIO } from 'src/cli/structuredIO.js'
import { ndjsonSafeStringify } from 'src/cli/ndjsonSafeStringify.js'
import { getOauthAccountInfo, validateForceLoginOrg } from 'src/utils/auth.js'
import { homedir, hostname } from 'os'
import { randomUUID } from 'crypto'
import { isDeepStrictEqual } from 'util'
import { getOriginalCwd } from 'src/bootstrap/state.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { isEssentialTrafficOnly } from 'src/utils/privacyLevel.js'
import { toCompatSessionId } from 'src/bridge/sessionIdCompat.js'
import { findGitRoot, getBranch } from 'src/utils/git.js'
import {
  errorMessage,
  isAbortError,
  TeleportOperationError,
} from 'src/utils/errors.js'
import { getMcpPrefix } from 'src/services/mcp/mcpStringUtils.js'
import {
  getClaudeCodeMcpConfigs,
  isMcpServerDisabled,
} from 'src/services/mcp/config.js'
import { logForDebugging, setHasFormattedOutput } from 'src/utils/debug.js'
import { getBootstrapSession } from 'src/utils/sessionRoot.js'
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import { writeToStdout } from 'src/utils/process.js'
import { sleep } from 'src/utils/sleep.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getBootstrapSessionHost } from '../utils/sessionHost.js'
import {
  isTrustedDeviceActiveForOrg,
  trustedDeviceTokenForBind as d5oTrustedDeviceTokenForBind,
} from '../bridge/trustedDevice.js'
import {
  isEventualHavenEnabledSync,
  isHostedServeDialogsEnabled,
  isRepositoryTrustPollEnabled,
  isSettingsToCloudEnabled,
  isViolinBassbarEnabledSync,
  isViolinWoodEnabled,
  isViolinWoodEnabledSync,
} from './violinWood.js'
import { PERMISSION_MODES, type PermissionMode } from '../types/permissions.js'
import { isSubprocessEnvScrubEnabled } from './spareClaim.js'
import { getMainLoopModel } from '../utils/model/model.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import {
  hasSdkOauthRefresh,
  SDK_OAUTH_REFRESH_ENTRYPOINTS,
} from 'src/utils/residualFinalEnvGates.js'
import { setSdkOauthTokenRefreshCallback } from 'src/utils/sdkOauthTokenRefresh.js'
import {
  interruptRemoteSession,
  pollRemoteSessionEvents,
  teleportToRemote,
} from 'src/utils/teleport.js'
import {
  fetchSession,
  sendEventToRemoteSession,
  sendPayloadToRemoteSession,
} from 'src/utils/teleport/api.js'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import type {
  StdinMessage,
  StdoutMessage,
} from 'src/entrypoints/sdk/controlTypes.js'

import {
  oZe,
  type DeviceBindAttestation,
  type DeviceBindKey,
} from './deviceBind.js'
import {
  cannotServeCloudSession,
  checkLocalServeIdentity,
  isLocalServeLinkAllowed,
  type ServeIdentityFail,
  type ServeIdentityOk,
} from './serveIdentity.js'
import {
  reportRemoteCreateSessionError,
  UNABLE_TO_CREATE_CLOUD_SESSION_ERROR,
} from './cloudCreateError.js'
import { servingOffReason } from './servingOff.js'
import { unattendedServingConsentCopy } from './unattendedServingCopy.js'
import {
  logDeviceBridgeStarted,
  noteBridgeTrustedDevicesRequired,
} from './deviceBridgeRegister.js'
import { headlessCloudWatchdogMs } from './cloudWatchdog.js'
import {
  PEER_HELD_FOR_INIT_CAP,
  notePeerFrameBeforeInit,
} from './headlessFramesDrop.js'
import { attachHeadlessFeatures } from './headlessFeatureAttach.js'
import { createCloudHooksPack } from './cloudHooksPack.js'
import { createCloudToolsPack } from './cloudToolsPack.js'
import { createSettingsToCloudPack } from './settingsToCloudPack.js'
import { composeExtraReachForCloudHooks } from './extraReach.js'
import { emptyReachMemory, mergeReachEnv } from './reachEnvBag.js'
import { legacyConfigFileCache } from './legacyConfigFile.js'
import { createServedAskLimiter } from './servedAskLimiter.js'
import {
  asLinkDeviceHttpResult,
  linkSessionDeviceWithRetry,
} from './linkDeviceRetry.js'

export {
  $ar,
  Far,
  tTn,
  DEVICE_BIND_KID_PREFIX,
  Xwt,
} from './deviceBind.js'

export {
  askAttachDirSyncConsent,
  ATTACH_SYNC_COMPLIANCE_LINE,
  DIR_SYNC_ATTACH_ON_LINE,
  DIR_SYNC_ATTACH_PREPARE_READY_LINE,
  isDirSyncEngineOn,
  startAttachSync,
  type AttachDirSyncPrepareHandle,
} from './attachDirSync.js'

export {
  releaseDirectorySyncHandle,
  takeDirectorySyncHandle,
  type DirectorySyncHandleRelease,
  type DirectorySyncHandleTake,
} from './dirSyncLookup.js'

export {
  serveOnlyLinkStillBound,
  type ServeOnlyLinkSnapshot,
} from './cloudRefuse.js'

export {
  bindReasonCopy,
  cannotServeCloudSession,
  checkLocalServeIdentity,
  describeServeIdentityRefusal,
  isLocalServeLinkAllowed,
  parseAttachServeRequest,
  type ServeIdentityFail,
  type ServeIdentityOk,
  type ServeIdentityRefusal,
} from './serveIdentity.js'

export {
  reportRemoteCreateSessionError,
  UNABLE_TO_CREATE_CLOUD_SESSION_ERROR,
} from './cloudCreateError.js'
export { servingOffReason } from './servingOff.js'
export {
  createSettingsToCloudPack,
  settingsToCloudHomeSeed,
  settingsToCloudOff,
  settingsToCloudReport,
} from './settingsToCloudPack.js'
export {
  cloudPluginAdmissionOff,
  isCloudPluginForwardingOptedOut,
  logCcrCloudPluginsForward,
  PLUGIN_FORWARD_UNDECIDED_COPY,
  pluginDistrustCopy,
} from './cloudPluginForward.js'
export {
  deviceBridgeRejectKey,
  logDeviceBridgeLivenessEvent,
  logDeviceBridgeTransportEvent,
  remoteToolsBridgeBaseUrl,
} from './deviceBridgeLogs.js'
export {
  asLinkDeviceHttpResult,
  classifyLinkDeviceResponse,
  linkSessionDeviceCaught,
  linkSessionDeviceWithRetry,
} from './linkDeviceRetry.js'
export { logRemoteHeadlessClientWorkerInitialize } from './leftoverHeadlessCopy.js'
export {
  UNATTENDED_SERVING_CONSENT_TERMS,
  UNATTENDED_SERVING_CONSENT_VERSION,
  unattendedServingConsentCopy,
} from './unattendedServingCopy.js'
export {
  HEADLESS_FEATURE_KEYS,
  attachHeadlessFeatures,
  noteHeadlessFeatureHookError,
} from './headlessFeatureAttach.js'
export {
  announceServingState,
  createCloudToolsPack,
  toolsAnnounceOffReason,
  toolsFeatureOff,
} from './cloudToolsPack.js'
export {
  HOOKS_FORWARD_IDLE_COPY,
  HOOKS_FORWARD_NOT_REGISTERED_COPY,
  HOOKS_FORWARD_UNDECIDED_COPY,
  createCloudHooksPack,
  hooksFeatureOff,
  hooksOffReasonFromStanding,
  isCloudHooksForwardingEnabled,
  reportCloudHooksFromStanding,
} from './cloudHooksPack.js'
export {
  logDeviceBridgeStarted,
  noteBridgeTrustedDevicesRequired,
  SERVING_OFF_BRIDGE_TRUSTED_DEVICES,
  startDeviceBridgeRegistration,
} from './deviceBridgeRegister.js'
export {
  HEADLESS_CLOUD_WATCHDOG_MS_ATTACHED,
  HEADLESS_CLOUD_WATCHDOG_MS_UNATTACHED,
  headlessCloudWatchdogMs,
} from './cloudWatchdog.js'
export {
  SERVED_ASK_DEFAULT_MAX_MS,
  SERVED_ASK_INFLIGHT_CAP,
  SERVED_ASK_RECENT_CAP,
  createServedAskLimiter,
  servedHostMaxAskMs,
} from './servedAskLimiter.js'
export {
  PEER_HELD_FOR_INIT_CAP,
  createHeadlessPeerInitBag,
  notePeerFrameBeforeInit,
  peerFramesDroppedBeforeInit,
} from './headlessFramesDrop.js'
export {
  CLOUD_HOOK_FORWARDED_CAP,
  CLOUD_HOOK_PER_EVENT_CAP,
  CLOUD_HOOK_READONLY_TEMPLATES,
  CLOUD_HOOK_SOURCE_COPY,
  CLOUD_HOOK_TEMPLATE_CAP,
  CLOUD_HOOK_UNVERIFIABLE_TARGET,
  HOOKS_STAY_UNPLACEABLE_COPY,
  cloudHookTemplatesOverCapCopy,
  cloudHooksEventOverCapCopy,
  cloudHooksOfferedOverCapCopy,
  cloudHookSourceCopy,
  composeExtraReachBag,
  composeExtraReachForCloudHooks,
  duplicateCloudScriptCopy,
  duplicateHookConfiguredOnceCopy,
  extraReachHasUnplaceableRoot,
  extraReachVolumeRoots,
  hooksCouldRunForCloudCopy,
  hooksCouldRunForCloudFromPack,
  leftoverHookAttestationBag,
  cloudHooksNotOfferedFromFileCopy,
  cloudDeviceMarkNotHonouredInCheckoutCopy,
  gitHookEnvClearedRefuseCopy,
  gitExecPathInLaunchDirRefuseCopy,
  gitHooksPathOnRefuseCopy,
  gitConfigIncludedFromLaunchDirRefuseCopy,
  gitConfigRunsFromCheckoutRefuseCopy,
  phpLoadsRelativeFileRefuseCopy,
  pythonInteractiveStdinRefuseCopy,
  pythonImportsWorkingDirRefuseCopy,
  namesPathRefuseCopy,
  readsClaudeProjectDirRefuseCopy,
  addressesWorkingDirectoryRefuseCopy,
  cshPathWorkingDirRefuseCopy,
  couldNotBeReadAsShellRefuseCopy,
  includesRelativeBuildFileRefuseCopy,
  couldNotBeReadToEndAsShellCopy,
  shellCodeNestedTooDeepRefuseCopy,
  CLOUD_HOOK_HOLD_REASON,
  cloudHookHoldReasonToken,
  isPlaceableAbsolutePath,
  mapExtraReachRoot,
} from './extraReach.js'
export {
  LEGACY_CONFIG_RETRY_MS,
  createLegacyConfigLocator,
  legacyConfigFileCache,
  pinnedLegacyEnv,
  refreshLegacyConfigIfDue,
} from './legacyConfigFile.js'
export {
  emptyReachMemory,
  isReachEnvScopePinned,
  mergeReachEnv,
  reachEnvShellPrefix,
} from './reachEnvBag.js'
export {
  FORWARDED_HOOK_INTERNAL_ERROR_RETRY,
  HEADLESS_CLOUD_FRAME_KEEP,
  HEADLESS_SERVICE_EVENT_NAMES,
  completeHostAllowWithShownInput,
  createForwardedHookWait,
  isFailedForwardedHookCall,
  isHeadlessServiceEvent,
  isReplayedForwardedHookCall,
  lookupHeadlessCloudFrameKeep,
  unrefTimeout,
} from './leftoverHookWait.js'
import { CLOUD_ATTACH_SYNC_CONSENT_COPY } from './leftoverCloudCopy.js'
export {
  ATTACH_DIR_SYNC_ELSEWHERE_UNKNOWN,
  CCR_DIR_SYNC_MODE_PROMPT,
  CLOUD_ATTACH_SYNC_CONSENT_COPY,
  CLOUD_CLIENT_CLOSED_BEFORE_REQUEST_COMPLETED,
  CLOUD_CLIENT_CLOSED_BEFORE_SEND_CONFIRMED,
  CLOUD_PRINT_NEEDS_TASK,
  CLOUD_SESSION_FAILED_TO_START,
  CLOUD_TRANSCRIPT_JSONL,
  CLOUD_WORKER_TIMEOUT_NO_ANSWER,
  CONSENT_ATTACH_SYNC_BODY,
  CONSENT_ATTACH_SYNC_BODY_KEY,
  CONSENT_ATTACH_SYNC_DETAIL,
  CONSENT_ATTACH_SYNC_DETAIL_KEY,
  CONSENT_ATTACH_SYNC_TITLE,
  CONSENT_ATTACH_SYNC_TITLE_KEY,
  CONSENT_SYNC_BODY,
  CONSENT_SYNC_BODY_KEY,
  CONSENT_SYNC_DETAIL,
  CONSENT_SYNC_DETAIL_KEY,
  CONSENT_SYNC_TITLE,
  CONSENT_SYNC_TITLE_KEY,
  CONTENT_BLOCK_MUST_BE_OBJECT_TEXT_STRING,
  DROPPING_CONTROL_REQUEST_WITHOUT_ID_OR_REQUEST,
  EDE_DIAGNOSTIC_PREFIX,
  emptyTranscriptPath,
  FAILED_HOST_ERROR,
  HEADLESS_CLOUD_SYNC_QUESTION_ABANDONED,
  logSyncQuestionAbandoned,
  savedHooksAnswerIgnoredUnlocated,
  savedHooksAnswerIgnoredWritable,
  SESSION_STREAM_NOT_CONNECTED,
  TENGU_DEVICE_HOOK_SERVED,
  TENGU_DEVICE_HOOKS_CLIENT_REGISTER,
  TENGU_DEVICE_HOOKS_CONSENT_NOTICE,
  TENGU_DEVICE_HOOKS_LAPSE_LINE,
  TENGU_DEVICE_HOOKS_REACH_PINNED,
  TENGU_DEVICE_HOOKS_SOURCE_PINNED,
  UNTRUSTED_DEVICE,
  attachDirSyncElsewhereUnknownReason,
  classifyAttachDirSyncElsewhereUnknown,
  isFailedHostError,
  logCcrDirSyncModePrompt,
  logDeviceHookServed,
  logDroppedControlRequestWithoutIdOrRequest,
} from './leftoverCloudCopy.js'

/** gold `xi` @191760290 */
export const CLOUD_SESSION_ID_RE = /^(?:session|cse)_[A-Za-z0-9_]+$/

/** gold `s` in hZn module @188907206 */
export const CLOUD_REATTACH_HINT =
  'To reattach to a cloud session, pass its id: `claude --cloud <session-id>` (find IDs at claude.ai/code).'

/** gold Lo @202415169 */
export const HEADLESS_CLOUD_STDIN_TTY_ERROR =
  'Error: headless --cloud reads the SDK host messages from stdin as stream-json; stdin is a terminal here.'

export const CLOUD_OPTION_FLAGS =
  '--cloud [description|session_id|url]' as const

export const CLOUD_OPTION_HELP =
  'Create a cloud session with the given description, or attach to an existing one by session ID or claude.ai/code URL.'

export const REMOTE_ALIAS_HELP = 'Deprecated alias for --cloud'

export const FORWARD_HOME_SETTINGS_HELP =
  "Whether this launch sends this machine's settings (CLAUDE.md, rules, output styles, preferences, portable permission rules) into the cloud session it creates or attaches to: false = not this launch; true = yes for this launch, standing in for the machine's stored choice (not saved). Requires --cloud or --environment."

export const ATTACH_SERVE_HELP =
  'Attach a serve-only helper to a bound cloud session (spawned by the desktop app; not for interactive use).'

export const ENVIRONMENT_OPTION_HELP =
  'Create a new cloud session that runs on the given self-hosted environment (ccpool_...).'

export const POOL_ALIAS_HELP = 'Deprecated alias for --environment'

export const CORRELATION_ID_HELP =
  'Opaque id echoed back to the environment orchestrator on the work order (requires --environment).'

export const REF_OPTION_HELP =
  'Branch, tag, or SHA to check out in the remote session; defaults to local current branch. Requires --cloud or --environment.'

export const ON_BRANCH_OPTION_HELP =
  'Work directly on <branch> in the remote session (checkout and push to it). On self-hosted environments this includes pushing to the default branch when it is not protected — use GitHub branch protection to restrict. Mutually exclusive with --ref. Requires --cloud or --environment.'

/** gold `a=100` A7e @188910210 */
const CLOUD_ARG_QUOTE_MAX = 100

export type CloudCliOptions = {
  teleport?: string | true
  cloud?: string | true
  remote?: string | true
  attachServe?: string
  environment?: string
  pool?: string
  ref?: string
  onBranch?: string
  correlationId?: string
  forwardHomeSettings?: string
  print?: boolean | string
  initOnly?: boolean
  continue?: boolean
  resume?: string | true
  fromPr?: string | boolean
  sessionId?: string
  dangerouslySkipPermissions?: boolean
  permissionMode?: string
  inheritPermissionMode?: string
  project?: unknown
}

export type ParseCloudLaunchContext = {
  prompt?: string
  sessionId?: string
  outputFormat?: string
  inputFormat?: string
  hasSdkUrl: boolean
  nonInteractive: boolean
  hasConnect: boolean
  hasSSH: boolean
  hasAssistant?: boolean
  /** gold `f8r()` @188907206 — currently false */
  cloudPrintEnabled?: boolean
  cloudSessionsByDefault?: boolean
  /** gold `Wd` @180782399 — MAIN wires `isViolinWoodEnabled` from violinWood.ts */
  isViolinWoodEnabled?: () => Promise<boolean>
}

export type CloudLaunchValue = {
  teleport: string | true | null
  remote: string | null
  cloudAttachId: string | null
  poolId: string | null
  poolPromotedRemote: boolean
  poolRef: string | null
  poolOnBranch: string | null
  forwardHomeSettings: boolean
  homeSettingsConsent: 'forward' | null
  projectFlag: string | null
  projectBrowse: string | null
  projectForRemoteControl: boolean
  correlationId: string | null
  headlessCloud: boolean
  headlessCloudPrint: boolean
  serveOnly: boolean
  cloudDefault: 'none' | 'declined' | 'applied'
  persistentVolume: boolean
  monorepo: boolean
}

export type ParseCloudLaunchResult =
  | { ok: true; value: CloudLaunchValue }
  | { ok: false; error: string }

export type CloudCombineFlags = {
  print?: boolean | string
  nonInteractive: boolean
  continue?: boolean
  resume?: string | true
  fromPr?: string | boolean
  hasTeleport: boolean
  hasConnect: boolean
  hasSSH: boolean
  hasAssistant: boolean
  hasPool: boolean
  isCloudAttach: boolean
  headlessCloud: boolean
  headlessCloudPrint: boolean
  loneWordValue?: string
}

/** gold `iXe` @191760331 */
export function parseCloudSessionId(value: string): string | null {
  if (CLOUD_SESSION_ID_RE.test(value)) return value
  if (value.includes('/') && !/\s/.test(value)) {
    for (const part of value.split(/[/?#]/)) {
      if (CLOUD_SESSION_ID_RE.test(part)) return part
    }
  }
  return null
}

/** gold `I4` @179765162 */
export function isSelfHostedEnvironmentId(value: string | undefined): boolean {
  return value !== undefined && value.startsWith('ccpool_')
}

/** gold `Vl` @191780697 */
export function parseForwardHomeSettingsFlag(
  value: string | undefined,
): boolean | null | 'invalid' {
  switch (value) {
    case undefined:
      return null
    case 'true':
    case '1':
      return true
    case 'false':
    case '0':
      return false
    default:
      return 'invalid'
  }
}

/** gold `m8r` @188907xxx */
export function isHeadlessCloudSdkHost(flags: {
  print?: boolean | string
  initOnly?: boolean
  nonInteractive: boolean
  inputFormat?: string
  outputFormat?: string
  hasSdkUrl: boolean
}): boolean {
  return (
    !flags.print &&
    !flags.initOnly &&
    flags.nonInteractive &&
    !flags.hasSdkUrl &&
    flags.inputFormat === 'stream-json' &&
    flags.outputFormat === 'stream-json'
  )
}

/** gold `g8r` */
export function isHeadlessCloudPrintArm(flags: {
  print?: boolean | string
  initOnly?: boolean
  hasSdkUrl: boolean
  outputFormat?: string
}): boolean {
  return (
    Boolean(flags.print) &&
    !flags.initOnly &&
    !flags.hasSdkUrl &&
    flags.outputFormat !== 'stream-json'
  )
}

/** gold `A7e` */
export function quoteCloudArg(value: string): string {
  const truncated =
    value.length > CLOUD_ARG_QUOTE_MAX
      ? `${value.slice(0, CLOUD_ARG_QUOTE_MAX)}…`
      : value
  const quoted = tryQuoteShellArgs([truncated])
  return quoted.success ? quoted.quoted : JSON.stringify(truncated)
}

export function cloudSessionViewUrl(sessionId: string): string {
  const base = getRemoteSessionUrl(sessionId)
  return `${base}?${new URLSearchParams({ from: 'cli', m: '0' })}`
}

/** gold `hZn` @188907230 */
export function cloudCombineError(n: CloudCombineFlags): string | null {
  let flag = '--cloud'
  let reattach = `\n${CLOUD_REATTACH_HINT}`
  if (n.hasPool) {
    flag = '--environment'
    reattach = ''
  }
  if (n.print && !n.hasPool && !n.isCloudAttach && !n.headlessCloudPrint) {
    if (n.loneWordValue !== undefined) {
      return `Error: --cloud ${quoteCloudArg(n.loneWordValue)} is not a cloud session ID or URL.\nWith --print, --cloud sends the prompt to an existing cloud session: pass its ID (session_... or cse_...) or its claude.ai/code URL. To start a new cloud session from a description instead, drop --print.`
    }
    return `Error: ${flag} cannot be combined with --print.\nStarting a new cloud session with ${flag} is interactive only: drop --print, or drop ${flag} to run locally. To message an existing cloud session instead, pass its ID: \`claude -p "message" --cloud <session-id>\` (find IDs at claude.ai/code).`
  }
  if (
    n.nonInteractive &&
    !n.hasPool &&
    !n.isCloudAttach &&
    !n.headlessCloud &&
    !n.headlessCloudPrint
  ) {
    if (n.loneWordValue !== undefined) {
      return `Error: --cloud ${quoteCloudArg(n.loneWordValue)} is not a cloud session ID or URL.\nWithout an interactive terminal, --cloud can only send the prompt to an existing cloud session: pass its ID (session_... or cse_...) or its claude.ai/code URL. To start a new cloud session, run from a TTY.`
    }
    return `Error: ${flag} requires an interactive terminal.\nNon-interactive invocations (piped stdout, --init-only, --sdk-url) run locally and would silently ignore ${flag}. Drop ${flag}, or run from a TTY.`
  }
  if (n.continue) {
    return `Error: ${flag} cannot be combined with --continue.${reattach}`
  }
  if (n.hasConnect || n.hasSSH || n.hasAssistant || n.hasTeleport) {
    const other = n.hasConnect
      ? 'a cc:// connect URL'
      : n.hasSSH
        ? '`claude ssh`'
        : n.hasAssistant
          ? '`claude assistant`'
          : '--teleport'
    return `Error: ${flag} cannot be combined with ${other} — both select a remote backend; pick one.`
  }
  if (n.resume || n.fromPr) {
    const other = n.resume ? '--resume' : '--from-pr'
    return `Error: ${flag} cannot be combined with ${other}.${reattach}`
  }
  return null
}

/**
 * gold `os()` @191780828 — commander flags → cloud launch plan.
 * `cloudPrintEnabled` is gold `f8r()` (false). Headless SDK-host needs violin-wood.
 */
export async function parseCloudLaunch(
  e: CloudCliOptions,
  o: ParseCloudLaunchContext,
): Promise<ParseCloudLaunchResult> {
  const teleport = e.teleport ?? null
  const rawCloud = e.cloud ?? e.remote
  let remote: string | null = rawCloud === true ? '' : (rawCloud ?? null)
  let serveOnly = false
  if (e.attachServe !== undefined) {
    if (rawCloud !== undefined) {
      return {
        ok: false,
        error: 'Error: --attach-serve cannot be combined with --cloud/--remote',
      }
    }
    if (parseCloudSessionId(e.attachServe) === null) {
      return {
        ok: false,
        error: `Error: --attach-serve expects a session id (cse_...), got ${quoteCloudArg(e.attachServe)}`,
      }
    }
    remote = e.attachServe
    serveOnly = true
  }
  const cloudAttachId =
    typeof rawCloud === 'string'
      ? parseCloudSessionId(rawCloud)
      : serveOnly
        ? parseCloudSessionId(e.attachServe ?? '')
        : null
  const loneWordValue =
    typeof rawCloud === 'string' &&
    cloudAttachId === null &&
    !e.initOnly &&
    /^\s*\S+\s*$/.test(rawCloud)
      ? rawCloud
      : undefined

  let poolId: string | null = null
  let poolPromotedRemote = false
  let poolRef: string | null = null
  let poolOnBranch: string | null = null
  {
    const environment = e.environment ?? e.pool
    if (environment !== undefined) {
      if (!isSelfHostedEnvironmentId(environment)) {
        return {
          ok: false,
          error: `Error: --environment expects a self-hosted environment id (ccpool_...), got ${quoteCloudArg(environment)}`,
        }
      }
      if (e.resume || e.continue || teleport) {
        return {
          ok: false,
          error:
            'Error: --environment cannot be combined with --resume, --continue, or --teleport',
        }
      }
      if (e.initOnly || o.sessionId) {
        return {
          ok: false,
          error: `Error: --environment cannot be combined with ${e.initOnly ? '--init-only' : '--session-id'}`,
        }
      }
      if (cloudAttachId !== null) {
        return {
          ok: false,
          error:
            'Error: --environment creates a new session; it cannot be combined with --cloud <session_id|url>',
        }
      }
      if (
        (e.print || o.nonInteractive) &&
        typeof rawCloud === 'string' &&
        rawCloud.length > 0
      ) {
        return {
          ok: false,
          error:
            'Error: non-interactive --environment reads the prompt from the positional or stdin; drop --cloud/--remote <description>.',
        }
      }
      if ((e.print || o.nonInteractive) && o.outputFormat === 'stream-json') {
        return {
          ok: false,
          error:
            'Error: --environment does not support --output-format stream-json',
        }
      }
      if (
        typeof rawCloud === 'string' &&
        rawCloud.length > 0 &&
        typeof o.prompt === 'string' &&
        o.prompt.length > 0
      ) {
        return {
          ok: false,
          error:
            'Error: --environment with --cloud <description> cannot also take a positional prompt. Pass the task as the description, or drop --cloud.',
        }
      }
      poolId = environment
      if (remote === null || remote === '') {
        const prompt = typeof o.prompt === 'string' ? o.prompt : ''
        if (
          !(e.print || o.nonInteractive) &&
          parseCloudSessionId(prompt) !== null
        ) {
          return {
            ok: false,
            error:
              'Error: --environment creates a new session; it cannot be combined with a session id or url',
          }
        }
        remote = prompt
        poolPromotedRemote = true
      }
    }
    const ref = e.ref
    if (ref !== undefined) {
      if (poolId === null && remote === null) {
        return {
          ok: false,
          error: `Error: --ref sets the base branch for a cloud session; pass --cloud or --environment${e.project !== undefined ? ' — --project no longer starts cloud sessions' : ''}`,
        }
      }
      if (cloudAttachId !== null) {
        return {
          ok: false,
          error:
            'Error: --ref sets the base for a new cloud session; it cannot be combined with --cloud <session_id|url>',
        }
      }
      if (ref === '') {
        return {
          ok: false,
          error: 'Error: --ref requires a non-empty branch, tag, or SHA',
        }
      }
      poolRef = ref
    }
    const onBranch = e.onBranch
    if (onBranch !== undefined) {
      if (poolId === null && remote === null) {
        return {
          ok: false,
          error: `Error: --on-branch resumes work on a branch in a cloud session; pass --cloud or --environment${e.project !== undefined ? ' — --project no longer starts cloud sessions' : ''}`,
        }
      }
      if (cloudAttachId !== null) {
        return {
          ok: false,
          error:
            'Error: --on-branch resumes a branch in a new cloud session; it cannot be combined with --cloud <session_id|url>',
        }
      }
      if (poolRef !== null) {
        return {
          ok: false,
          error:
            "Error: --on-branch and --ref both set the cloud session's base branch; pass one or the other",
        }
      }
      if (onBranch === '') {
        return {
          ok: false,
          error: 'Error: --on-branch requires a non-empty branch name',
        }
      }
      poolOnBranch = onBranch
    }
  }

  let correlationId: string | null = null
  {
    const id = e.correlationId
    if (id !== undefined) {
      if (poolId === null) {
        return {
          ok: false,
          error: 'Error: --correlation-id requires --environment',
        }
      }
      if (!/^[\x21-\x2C\x2E-\x7E][\x21-\x7E]{0,511}$/.test(id)) {
        return {
          ok: false,
          error:
            'Error: --correlation-id must be 1-512 printable ASCII characters with no spaces and no leading "-"',
        }
      }
      correlationId = id
    }
  }

  const violinWood = await (
    o.isViolinWoodEnabled ?? (async () => false)
  )().catch(() => false)
  const headlessCloud =
    remote !== null &&
    poolId === null &&
    isHeadlessCloudSdkHost({
      print: e.print,
      initOnly: e.initOnly,
      nonInteractive: o.nonInteractive,
      inputFormat: o.inputFormat,
      outputFormat: o.outputFormat,
      hasSdkUrl: o.hasSdkUrl,
    }) &&
    violinWood
  const cloudPrintEnabled = o.cloudPrintEnabled ?? false
  const headlessCloudPrint =
    cloudPrintEnabled &&
    remote !== null &&
    (typeof rawCloud !== 'string' || rawCloud.trim() !== '') &&
    poolId === null &&
    cloudAttachId === null &&
    loneWordValue === undefined &&
    isHeadlessCloudPrintArm({
      print: e.print,
      initOnly: e.initOnly,
      hasSdkUrl: o.hasSdkUrl,
      outputFormat: o.outputFormat,
    })
  if (
    headlessCloudPrint &&
    typeof rawCloud === 'string' &&
    rawCloud.trim() !== '' &&
    typeof o.prompt === 'string' &&
    o.prompt.trim() !== ''
  ) {
    return {
      ok: false,
      error: `Error: the task was given twice: as --cloud's value (${quoteCloudArg(rawCloud)}) and as the prompt. With --print, give it in one place; to name the session, use -n/--name.`,
    }
  }
  if (serveOnly && !headlessCloud) {
    return {
      ok: false,
      error:
        'Error: --attach-serve requires the serve-only headless launch (non-interactive, --input-format stream-json and --output-format stream-json) and an enabled headless cloud client; it never falls back to a plain attach',
    }
  }
  const forwardParsed = parseForwardHomeSettingsFlag(e.forwardHomeSettings)
  if (forwardParsed === 'invalid') {
    return {
      ok: false,
      error: `Error: --forward-home-settings takes true or false, not ${quoteCloudArg(String(e.forwardHomeSettings))}.`,
    }
  }
  const forwardHomeSettings = forwardParsed !== false
  const homeSettingsConsent = forwardParsed === true ? 'forward' : null
  if (
    forwardParsed !== null &&
    poolId === null &&
    remote === null &&
    cloudAttachId === null
  ) {
    return {
      ok: false,
      error:
        "Error: --forward-home-settings says whether this machine's settings go into a cloud session; pass --cloud (a new session, or one to attach to) or --environment",
    }
  }
  if (remote !== null) {
    const combined = cloudCombineError({
      print: e.print,
      nonInteractive: o.nonInteractive,
      continue: e.continue,
      resume: e.resume,
      fromPr: e.fromPr,
      hasTeleport: teleport !== null,
      hasConnect: o.hasConnect,
      hasSSH: o.hasSSH,
      hasAssistant: o.hasAssistant === true,
      hasPool: poolId !== null,
      isCloudAttach: cloudAttachId !== null,
      headlessCloud,
      headlessCloudPrint,
      loneWordValue,
    })
    if (combined) return { ok: false, error: combined }
  }

  let cloudDefault: CloudLaunchValue['cloudDefault'] = 'none'
  if (
    o.cloudSessionsByDefault &&
    remote === null &&
    cloudCombineError({
      print: e.print,
      nonInteractive: o.nonInteractive || Boolean(e.initOnly),
      continue: e.continue,
      resume: e.resume,
      fromPr: e.fromPr,
      hasTeleport: teleport !== null,
      hasConnect: o.hasConnect,
      hasSSH: o.hasSSH,
      hasAssistant: false,
      hasPool: false,
      isCloudAttach: false,
      headlessCloud: false,
      headlessCloudPrint: false,
    }) === null &&
    !o.sessionId
  ) {
    cloudDefault = 'applied'
  }
  if (cloudDefault === 'applied') remote = ''

  return {
    ok: true,
    value: {
      teleport,
      remote,
      cloudAttachId,
      poolId,
      poolPromotedRemote,
      poolRef,
      poolOnBranch,
      forwardHomeSettings,
      homeSettingsConsent,
      projectFlag: null,
      projectBrowse: null,
      projectForRemoteControl: false,
      correlationId,
      headlessCloud,
      headlessCloudPrint,
      serveOnly,
      cloudDefault,
      persistentVolume: false,
      monorepo: false,
    },
  }
}

export function isCloudRemoteLaunch(value: CloudLaunchValue): boolean {
  return (
    value.remote !== null ||
    value.cloudAttachId !== null ||
    value.poolId !== null ||
    value.poolPromotedRemote
  )
}

/** gold commander registration @192115985 — `--cloud` is public (not hideHelp). */
export function registerCloudCliOptions(program: {
  addOption: (option: Option) => unknown
}): void {
  program.addOption(new Option(CLOUD_OPTION_FLAGS, CLOUD_OPTION_HELP))
  program.addOption(
    new Option(
      '--forward-home-settings <true|false>',
      FORWARD_HOME_SETTINGS_HELP,
    )
      .choices(['true', 'false', '1', '0'])
      .hideHelp(),
  )
  program.addOption(
    new Option(
      '--remote [description|session_id|url]',
      REMOTE_ALIAS_HELP,
    ).hideHelp(),
  )
  program.addOption(
    new Option('--attach-serve <session_id>', ATTACH_SERVE_HELP).hideHelp(),
  )
  program.addOption(
    new Option('--environment <environment_id>', ENVIRONMENT_OPTION_HELP),
  )
  program.addOption(new Option('--pool <pool_id>', POOL_ALIAS_HELP).hideHelp())
  program.addOption(
    new Option('--correlation-id <id>', CORRELATION_ID_HELP).hideHelp(),
  )
  program.addOption(new Option('--ref <ref>', REF_OPTION_HELP).hideHelp())
  program.addOption(
    new Option('--on-branch <branch>', ON_BRANCH_OPTION_HELP).hideHelp(),
  )
}

export type HeadlessCloudPrintResult =
  | { kind: 'sent'; sessionId: string; url: string }
  | { kind: 'error'; message: string; json?: Record<string, unknown> }

/**
 * gold print-attach BODY @192081124: `--cloud <session_id>` + `--print` POSTs
 * a user event via `QFe` / `sendEventToRemoteSession`.
 */
export async function runHeadlessCloudPrintAttach(opts: {
  sessionId: string
  prompt: string | null
  outputFormat?: string
}): Promise<HeadlessCloudPrintResult> {
  if (opts.outputFormat === 'stream-json') {
    return {
      kind: 'error',
      message:
        'Error: --cloud <session_id> does not support --output-format stream-json',
    }
  }
  const prompt =
    typeof opts.prompt === 'string' && opts.prompt.trim() !== ''
      ? opts.prompt
      : null
  if (prompt === null) {
    return {
      kind: 'error',
      message:
        'Error: non-interactive --cloud <session_id> requires a prompt (positional or stdin).',
    }
  }
  let archivedReason: string | null = null
  try {
    const session = await fetchSession(opts.sessionId)
    if (session.session_status === 'archived') {
      archivedReason = `cloud session ${opts.sessionId} is archived and cannot accept new messages`
    }
  } catch (error) {
    archivedReason = errorMessage(error)
  }
  const sent =
    archivedReason !== null
      ? { ok: false as const, reason: archivedReason }
      : await sendEventToRemoteSession(opts.sessionId, prompt)
  if (!sent.ok) {
    const message = `Error: failed to send message to cloud session ${opts.sessionId}: ${sent.reason}`
    return {
      kind: 'error',
      message,
      json: {
        ok: false,
        session_id: opts.sessionId,
        error: sent.reason,
      },
    }
  }
  const url = cloudSessionViewUrl(opts.sessionId)
  return {
    kind: 'sent',
    sessionId: opts.sessionId,
    url,
  }
}

export function formatHeadlessCloudPrintSuccess(result: {
  sessionId: string
  url: string
}): string {
  return `Sent to cloud session.\nSession ID: ${result.sessionId}\nView: ${result.url}\n`
}

export function formatCreatedCloudSession(opts: {
  id: string
  title: string
  includeSessionId?: boolean
}): string {
  const lines = [`Created cloud session: ${opts.title}`]
  if (opts.includeSessionId) lines.push(`Session ID: ${opts.id}`)
  lines.push(`View: ${cloudSessionViewUrl(opts.id)}`)
  lines.push(`Resume with: claude --teleport ${opts.id}`)
  return `${lines.join('\n')}\n`
}

export const CLOUD_ATTACH_DISABLED_ERROR =
  'Error: Attaching to an existing cloud session is not enabled for your account.'

export const CLOUD_REQUIRES_DESCRIPTION_ERROR =
  'Error: --cloud requires a description.\nUsage: claude --cloud "your task description"'

export const ENVIRONMENT_PIPED_STDIN_ERROR =
  'Error: --environment with --cloud <description> cannot also take piped stdin. Pass the task as the description, or drop --cloud.'

/** densable `Xqr` @191774059 */
export function cloudBindUnavailableError(reason: string): string {
  return `Error: a cloud session started from here could not be bound to this machine: ${reason}. Nothing was created.`
}

/**
 * densable `xJ(e,o)` @191826591 — branch_mode for tengu_remote_create_session.
 */
export function cloudBranchMode(
  onBranch?: string | null,
  ref?: string | null,
): 'on_branch' | 'ref' | 'default' {
  return onBranch ? 'on_branch' : ref ? 'ref' : 'default'
}

/**
 * densable `xo` @202415355 — Jwt wrap used by zo bindPreflight.
 */
export async function xoBindPreflight(): Promise<string | undefined> {
  return bindPreflight()
}

/**
 * densable `qt` fields + zo CCR extras @202423559.
 * zo create: `allowBundle:!0, seedDirSync:!0, staysAttached:!0`.
 * (bare `wXn`/`qt` staysAttached:!1 is not this EVo path.)
 */
export function headlessCloudTeleportPayload(
  args: {
    poolOnBranch?: string | null
    poolRef?: string | null
    sessionNameArg?: string
    appendSystemPrompt?: string
    customSystemPrompt?: string
    appendSubagentSystemPrompt?: string
    forwardHomeSettings?: boolean
    homeSettingsConsent?: 'forward' | null
  },
  currentBranch?: string,
): {
  initialMessage: null
  source: 'remote'
  branchName: string | undefined
  branchFromHead: boolean
  title: string | undefined
  reuseOutcomeBranch: string | undefined
  explicitRef: string | undefined
  allowBundle: true
  staysAttached: true
  seedDirSync: true
  appendSystemPrompt: string | undefined
  customSystemPrompt: string | undefined
  appendSubagentSystemPrompt: string | undefined
  forwardHomeSettings: boolean | undefined
  homeSettingsConsent: 'forward' | undefined
} {
  const n = args.poolOnBranch ?? args.poolRef ?? undefined
  return {
    initialMessage: null,
    source: 'remote',
    branchName: (n ?? currentBranch) || undefined,
    branchFromHead: n === undefined,
    title: args.sessionNameArg || undefined,
    reuseOutcomeBranch: args.poolOnBranch ?? undefined,
    explicitRef: n,
    allowBundle: true,
    staysAttached: true,
    seedDirSync: true,
    appendSystemPrompt: args.appendSystemPrompt,
    customSystemPrompt: args.customSystemPrompt,
    appendSubagentSystemPrompt: args.appendSubagentSystemPrompt,
    forwardHomeSettings: args.forwardHomeSettings,
    homeSettingsConsent: args.homeSettingsConsent ?? undefined,
  }
}

/**
 * densable `Uar` @196066295.
 */
export function resolveBindAccount(opts: {
  storedAccountUuid?: string
  hostAccountUuid?: string
}):
  | { status: 'missing' }
  | { status: 'mismatch' }
  | { status: 'resolved'; accountUuid: string; source: 'stored' | 'env' } {
  const stored = opts.storedAccountUuid
  const host = opts.hostAccountUuid
  if (!host) {
    return stored
      ? { status: 'resolved', accountUuid: stored, source: 'stored' }
      : { status: 'missing' }
  }
  if (!stored) {
    return { status: 'resolved', accountUuid: host, source: 'env' }
  }
  return stored.trim().toLowerCase() === host.toLowerCase()
    ? { status: 'resolved', accountUuid: stored, source: 'env' }
    : { status: 'mismatch' }
}

/**
 * densable `Jwt` @196071635 / `xo` @202415355.
 * After Uar resolve (stored / env / match), always `hasDeviceProof??K`.
 */
export async function bindPreflight(): Promise<string | undefined> {
  if (getOriginalCwd() === homedir()) return 'launched_from_home'
  let egress = true
  try {
    egress = !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EGRESS)
  } catch {
    egress = false
  }
  if (!egress) return 'egress'
  const stored = getOauthAccountInfo()?.accountUuid
  const host = process.env.CLAUDE_CODE_ACCOUNT_UUID
  const uar = resolveBindAccount({
    storedAccountUuid: stored,
    hostAccountUuid: host,
  })
  if (uar.status === 'missing') return 'account'
  if (uar.status === 'mismatch') return 'account_mismatch'
  const proof = await trustedDeviceTokenForBind()
  if (!proof.ok) return 'no_device_proof'
  return undefined
}

/**
 * densable `K` @196071485 — `(await trustedDeviceTokenForBind(void 0)).ok`.
 * Real enroll is `d5o` @180891821 on `src/bridge/trustedDevice.ts`.
 */
export async function trustedDeviceTokenForBind(
  _storageV5?: unknown,
): Promise<{ ok: boolean; error?: string }> {
  void _storageV5
  return d5oTrustedDeviceTokenForBind(undefined)
}

export const NON_INTERACTIVE_ENVIRONMENT_PROMPT_ERROR =
  'Error: non-interactive --environment requires a prompt (positional or stdin). Run from a TTY for an interactive cloud session.'

export function applyMayForwardHomeSettings(yr: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceMayForwardHomeSettings(yr)
}

export function applyHomeSettingsHostConsent(_r: 'forward' | null): void {
  getBootstrapSessionHost().launchOptions.replaceHomeSettingsHostConsent(_r)
}

/** gold `LXn` @191774xxx — create-entry initialize honours */
const HEADLESS_CLOUD_CREATE_HONOURS = [
  'systemPrompt',
  'appendSystemPrompt',
  'appendSubagentSystemPrompt',
] as const

/** gold `gt=12` / `No=40` in `y_n` */
const HEADLESS_CLOUD_NOTICE_LIST_CAP = 12
const HEADLESS_CLOUD_NOT_APPLIED_CAP = 40

/** gold `p=8` Feo list cap */
const CLOUD_HOST_REQUEST_LIST_CAP = 8

/** gold `v` / `E` / `w` / `C` / `j` / `A` @191125000 */
export const CLOUD_HOSTED_NOT_SUPPORTED =
  'is not supported in a cloud-hosted session'
export const CLOUD_HOSTED_LOCAL_PATH =
  "names a path on this machine; the agent's files are in the cloud container"
export const CLOUD_HOSTED_WHILE_DRIVING =
  'is not available while this process drives a cloud-hosted session'
export const CLOUD_HOSTED_BYPASS_PERMISSIONS =
  'bypassPermissions is not available in a cloud-hosted session'
export const CLOUD_HOSTED_FILE_REWIND =
  'file rewinding is not available in a cloud-hosted session: the cloud agent keeps no file checkpoints'
export const CLOUD_HOSTED_MCP_CHANGES =
  "MCP server changes are not available in a cloud-hosted session yet; this machine's MCP servers reach cloud sessions through the device link"
export const CLOUD_HOSTED_LOST_OPTIONS = (names: string[]): string =>
  `these options cannot apply to a cloud-hosted session, where the agent runs in the cloud container; remove: ${names.join(', ')}`
export const CLOUD_HOSTED_AGENT_TOOLS =
  'agent definitions that list tools or hooks, or set a permission mode, are not enforced by a cloud session'
export const CLOUD_HOSTED_JSON_SCHEMA =
  'structured output is not delivered to a cloud session yet'
export const CLOUD_HOSTED_INITIALIZE_UNREADABLE =
  'the initialize request could not be read (it does not match the control schema), so its options cannot be applied to a cloud session; nothing was started'

const CLOUD_FLAG_SETTINGS_ALLOWED = new Set([
  'model',
  'advisorModel',
  'effortLevel',
  'ultracode',
  'fastMode',
  'viewMode',
  'alwaysThinkingEnabled',
])

/** gold `f` @191130800 — initialize field fate */
const INITIALIZE_FIELD_FATE: Record<string, 'lost' | 'preference'> = {
  systemPrompt: 'lost',
  appendSystemPrompt: 'lost',
  agents: 'lost',
  jsonSchema: 'lost',
  skills: 'lost',
  title: 'preference',
  planModeInstructions: 'lost',
  systemPromptSnapshot: 'lost',
  toolAliases: 'lost',
  excludeDynamicSections: 'preference',
  appendSubagentSystemPrompt: 'lost',
  promptSuggestions: 'preference',
  agentProgressSummaries: 'preference',
  forwardSubagentText: 'lost',
  webSearchIsolationExemptMcpServers: 'lost',
  supportedDialogKinds: 'preference',
  perTaskStopAffordance: 'lost',
  rapidFollowupPreempt: 'preference',
  plugins: 'lost',
  workspaceTrust: 'preference',
  proactivity: 'preference',
  attachServeRequest: 'preference',
}

/** densable `$eo` @191131188 */
export function initializeFieldFate(name: string): 'lost' | 'preference' {
  return INITIALIZE_FIELD_FATE[name] ?? 'lost'
}

function formatCloudHostedList(names: string[]): string {
  const shown = names.slice(0, CLOUD_HOST_REQUEST_LIST_CAP)
  return names.length > CLOUD_HOST_REQUEST_LIST_CAP
    ? `${shown.join(', ')} (and ${names.length - CLOUD_HOST_REQUEST_LIST_CAP} more)`
    : shown.join(', ')
}

function subtypeLabel(subtype: unknown): string {
  return typeof subtype === 'string'
    ? subtype.slice(0, 64)
    : 'a request without a string subtype'
}

function hooksPresent(hooks: unknown): boolean {
  if (typeof hooks !== 'object' || hooks === null) return false
  return Object.values(hooks).some(v => Array.isArray(v) && v.length > 0)
}

function agentDefinitionEnforced(def: unknown): boolean {
  if (typeof def !== 'object' || def === null) return false
  const bag = def as Record<string, unknown>
  const tools = bag.tools
  const disallowed = bag.disallowedTools
  const hooks = bag.hooks
  const permissionMode = bag.permissionMode
  const star = (o: unknown) =>
    Array.isArray(o) && o.length === 1 && o[0] === '*'
  const nonempty = (o: unknown) => Array.isArray(o) && o.length > 0
  return (
    (tools !== undefined && !star(tools)) ||
    (nonempty(disallowed) && !star(disallowed)) ||
    hooksPresent(hooks) ||
    permissionMode === 'plan' ||
    permissionMode === 'dontAsk'
  )
}

function enforcedAgentNames(agents: unknown): string[] {
  if (agents === undefined) return []
  if (typeof agents !== 'object' || agents === null || Array.isArray(agents)) {
    return ['(unreadable)']
  }
  return Object.entries(agents)
    .filter(([, def]) => agentDefinitionEnforced(def))
    .map(([name]) => name)
}

function emptySystemPrompt(name: string, value: unknown): boolean {
  return (
    name === 'systemPrompt' &&
    Array.isArray(value) &&
    value.length === 1 &&
    value[0] === ''
  )
}

/**
 * densable `Ikn` @191132075.
 */
export function classifyCloudInitializeOptions(
  request: Record<string, unknown>,
  policy: 'strict' | 'lenient',
  honours: ReadonlySet<string> = new Set(),
):
  | { outcome: 'reject'; error: string; ignored: string[] }
  | { outcome: 'accept'; ignored: string[] } {
  const hookNames = hooksPresent(request.hooks) ? ['hooks'] : []
  const sdk = request.sdkMcpServers
  const sdkNames = Array.isArray(sdk) && sdk.length > 0 ? ['sdkMcpServers'] : []
  const jsonSchemaNames = request.jsonSchema !== undefined ? ['jsonSchema'] : []
  const agentNames = enforcedAgentNames(request.agents)
  const agentsTag = agentNames.length > 0 ? ['agents'] : []
  const blocked = [...hookNames, ...sdkNames, ...agentsTag, ...jsonSchemaNames]
  const ignored = Object.keys(INITIALIZE_FIELD_FATE).filter(
    key =>
      request[key] !== undefined &&
      !honours.has(key) &&
      !blocked.includes(key) &&
      !emptySystemPrompt(key, request[key]),
  )
  if (blocked.length > 0 && policy === 'strict') {
    return {
      outcome: 'reject',
      error: CLOUD_HOSTED_LOST_OPTIONS(
        blocked.map(name =>
          name === 'jsonSchema'
            ? `jsonSchema (${CLOUD_HOSTED_JSON_SCHEMA})`
            : name === 'agents'
              ? `agents (${formatCloudHostedList(agentNames)}: ${CLOUD_HOSTED_AGENT_TOOLS})`
              : name,
        ),
      ),
      ignored,
    }
  }
  return { outcome: 'accept', ignored: [...blocked, ...ignored] }
}

export type CloudHostedControlRoute =
  | { kind: 'local'; handler: string }
  | { kind: 'forward'; holdsLaterSends: boolean }
  | { kind: 'reject'; error: string }

/**
 * densable `D` @191126289 / `Feo` @191125901.
 */
export function routeCloudHostedControlRequest(
  request: { subtype?: string; mode?: string; settings?: unknown },
  { strict }: { strict: boolean },
): CloudHostedControlRoute | null {
  const subtype = request.subtype
  const forwardLater: CloudHostedControlRoute = {
    kind: 'forward',
    holdsLaterSends: true,
  }
  const forwardNow: CloudHostedControlRoute = {
    kind: 'forward',
    holdsLaterSends: false,
  }
  switch (subtype) {
    case 'initialize':
    case 'interrupt':
    case 'end_session':
    case 'cancel_async_message':
      return { kind: 'local', handler: subtype }
    case 'set_permission_mode':
      return strict && request.mode === 'bypassPermissions'
        ? { kind: 'reject', error: CLOUD_HOSTED_BYPASS_PERMISSIONS }
        : forwardLater
    case 'set_model':
    case 'set_max_thinking_tokens':
    case 'mcp_toggle':
    case 'mcp_reconnect':
    case 'reload_plugins':
    case 'reload_skills':
    case 'reload_output_styles':
    case 'set_mcp_permission_mode_override':
    case 'set_chrome_browser_hints':
    case 'set_prompt_suggestions_paused':
      return forwardLater
    case 'apply_flag_settings': {
      if (
        typeof request.settings !== 'object' ||
        request.settings === null ||
        Array.isArray(request.settings)
      ) {
        return {
          kind: 'reject',
          error: 'apply_flag_settings requires settings to be an object',
        }
      }
      const bad = Object.keys(request.settings).filter(
        key => !CLOUD_FLAG_SETTINGS_ALLOWED.has(key),
      )
      return bad.length > 0
        ? {
            kind: 'reject',
            error: `apply_flag_settings keys not available in a cloud-hosted session: ${formatCloudHostedList(bad)}`,
          }
        : forwardLater
    }
    case 'update_settings':
      return {
        kind: 'reject',
        error: 'update_settings is not available in a cloud-hosted session yet',
      }
    case 'get_memory_dialog':
    case 'get_skills_dialog':
    case 'get_status':
    case 'export_conversation':
    case 'get_chrome_dialog':
    case 'get_chrome_browsers':
    case 'select_chrome_browser':
    case 'get_sandbox_dialog':
      return {
        kind: 'reject',
        error: `${subtype} is not available in a cloud-hosted session`,
      }
    case 'rewind_conversation':
    case 'seed_read_state':
      return forwardLater
    case 'fork_conversation':
      return {
        kind: 'reject',
        error: 'fork_conversation is not available in a cloud-hosted session',
      }
    case 'rewind_files':
      return { kind: 'reject', error: CLOUD_HOSTED_FILE_REWIND }
    case 'get_context_usage':
    case 'get_session_cost':
    case 'mcp_status':
    case 'list_models':
    case 'get_usage':
    case 'get_binary_version':
    case 'file_suggestions':
    case 'read_file':
    case 'get_workspace_diff':
    case 'get_plan':
    case 'stop_task':
    case 'background_tasks':
    case 'get_settings':
    case 'get_hooks_listing':
    case 'list_permission_rules':
    case 'submit_feedback':
    case 'message_rated':
    case 'generate_session_title':
    case 'side_question':
    case 'mcp_call':
    case 'prefetch_attachments':
    case 'rename_session':
      return forwardNow
    case 'mcp_set_servers':
      return { kind: 'reject', error: CLOUD_HOSTED_MCP_CHANGES }
    case 'set_cwd':
    case 'claim_session':
    case 'add_directory':
    case 'register_repo_root':
      return {
        kind: 'reject',
        error: `${subtype} ${CLOUD_HOSTED_LOCAL_PATH}`,
      }
    case 'remote_control':
    case 'channel_enable':
    case 'ultrareview_launch':
    case 'claude_authenticate':
    case 'claude_oauth_callback':
    case 'claude_oauth_wait_for_completion':
    case 'mcp_authenticate':
    case 'mcp_clear_auth':
    case 'mcp_oauth_callback_url':
    case 'set_color':
      return {
        kind: 'reject',
        error: `${subtype} ${CLOUD_HOSTED_WHILE_DRIVING}`,
      }
    case 'mcp_message':
      return {
        kind: 'reject',
        error: 'SDK MCP servers are not available in a cloud-hosted session',
      }
    case 'mcp_read_resource':
      return {
        kind: 'reject',
        error:
          'mcp_read_resource is not available in a cloud-hosted session yet',
      }
    case 'poll_event':
      return {
        kind: 'reject',
        error: 'poll_event is not available in a cloud-hosted session yet',
      }
    case 'stage_file':
    case 'turn_handoff':
      return {
        kind: 'reject',
        error: `${subtype} is sent to a cloud agent by the service, not by a host`,
      }
    case 'register_device_hooks':
    case 'upload_device_hook_template':
    case 'remote_tools_announce':
      return {
        kind: 'reject',
        error: `${subtype} is sent to a cloud agent by the attached client, not by a host`,
      }
    case 'can_use_tool':
    case 'hook_callback':
    case 'elicitation':
    case 'request_user_dialog':
    case 'oauth_token_refresh':
    case 'host_auth_token_refresh':
    case 'remote_tool_call':
    case 'remote_plumbing_call':
    case 'remote_tools_probe':
    case 'remote_tools_reannounce':
    case 'remote_control_work_secret':
      return {
        kind: 'reject',
        error: `${subtype} is agent-originated and cannot be sent by a host`,
      }
    default:
      return null
  }
}

export function describeCloudHostedControlRoute(
  request: { subtype?: string; mode?: string; settings?: unknown },
  { strict }: { strict: boolean },
): { route: CloudHostedControlRoute; telemetrySubtype: string } {
  const route = routeCloudHostedControlRequest(request, { strict })
  if (route === null) {
    return {
      route: {
        kind: 'reject',
        error: `${subtypeLabel(request.subtype)} ${CLOUD_HOSTED_NOT_SUPPORTED}`,
      },
      telemetrySubtype: 'unknown',
    }
  }
  return { route, telemetrySubtype: request.subtype ?? 'unknown' }
}

export type HeadlessCloudNotice = {
  level: 'warning' | 'notice'
  text: string
}

export type HeadlessCloudNotApplied = {
  kind: 'lost' | 'kept' | 'preference'
  name: string
  why?: string
}

export type HeadlessCloudPolicy = {
  notices: HeadlessCloudNotice[]
  ignored: string[]
  forwarded: HeadlessCloudForwarded
  notApplied: HeadlessCloudNotApplied[]
}

export type HeadlessCloudForwarded = {
  appendSystemPrompt?: string
  customSystemPrompt?: string
  appendSubagentSystemPrompt?: string
  effort?: string
  fallbackModel?: string
  maxBudgetUsd?: number
  allowedTools?: string[]
  disallowedTools?: string[]
  thinking?: string
  proactivityLevel?: string
}

const HEADLESS_CLOUD_EMPTY_PROMPT_SENTINEL = '\n'

/**
 * densable `Hl` @191774650 — join non-empty systemPrompt parts.
 */
export function joinCloudSystemPrompt(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) {
    return typeof parts === 'string' && parts.trim() !== '' ? parts : undefined
  }
  const joined = parts
    .filter(
      (n): n is string =>
        typeof n === 'string' &&
        n !== '' &&
        n !== HEADLESS_CLOUD_EMPTY_PROMPT_SENTINEL,
    )
    .join('\n\n')
    .trim()
  return joined === '' ? undefined : joined
}

/**
 * densable `Jqr` @191774462 — initialize prompt overlays forwarded create options.
 */
export function overlayInitializeOnForwarded(
  forwarded: HeadlessCloudForwarded,
  initialize: {
    systemPrompt?: unknown
    appendSystemPrompt?: unknown
    appendSubagentSystemPrompt?: unknown
  } | null,
): HeadlessCloudForwarded {
  if (initialize === null) return forwarded
  const n =
    initialize.systemPrompt !== undefined
      ? joinCloudSystemPrompt(initialize.systemPrompt)
      : forwarded.customSystemPrompt
  const r =
    initialize.appendSystemPrompt !== undefined
      ? typeof initialize.appendSystemPrompt === 'string'
        ? initialize.appendSystemPrompt
        : undefined
      : forwarded.appendSystemPrompt
  const g =
    initialize.appendSubagentSystemPrompt !== undefined
      ? typeof initialize.appendSubagentSystemPrompt === 'string'
        ? initialize.appendSubagentSystemPrompt
        : undefined
      : forwarded.appendSubagentSystemPrompt
  const {
    customSystemPrompt: _h,
    appendSystemPrompt: _v,
    appendSubagentSystemPrompt: _C,
    ...rest
  } = forwarded
  return {
    ...rest,
    ...(n && { customSystemPrompt: n }),
    ...(r && { appendSystemPrompt: r }),
    ...(g && { appendSubagentSystemPrompt: g }),
  }
}

/** gold `h_n` @202417698 CE() catch fallback */
export const HEADLESS_CLOUD_AUTH_FAILED = 'Failed to authenticate'

/**
 * densable `h_n` @202417698 — wrap opener with auth/open_threw gold strings.
 * Gold `CE()` oauth compositor is not invented: `getCreds` seam default is a
 * no-op (undefined creds). Thrown `getCreds` maps to the gold auth string.
 */
export async function withHeadlessCloudAuth<T>(
  run: (creds?: unknown) => Promise<T>,
  opts?: { getCreds?: () => Promise<unknown> },
): Promise<T | { kind: 'failed'; message: string }> {
  let n: unknown
  try {
    if (opts?.getCreds !== undefined) {
      n = await opts.getCreds()
    }
  } catch (s) {
    const clipped = errorMessage(s).slice(0, 2000)
    logRemoteHeadlessFeatureBad('auth')
    return {
      kind: 'failed',
      message: `Error: ${clipped || HEADLESS_CLOUD_AUTH_FAILED}`,
    }
  }
  try {
    return await run(n)
  } catch (s) {
    const raw = errorMessage(s)
    const clipped = raw.slice(0, 2000)
    logRemoteHeadlessFeatureBad('open_threw')
    return {
      kind: 'failed',
      message: `Error: ${clipped || 'Unable to open the cloud session'}`,
    }
  }
}

export type SessionDeviceBindCredentials = {
  accessToken?: string
}

export type SessionDeviceBindResult =
  | { ok: true }
  | { ok: false; error: string; status?: number }

/**
 * gold `rs` / `w.post` @202318911 — POST
 * `${getOauthConfig().BASE_API_URL}/v1/code/sessions/${sessionId}/device`
 * with `target_device_id` + `bind_attestation` `{kid,signature}`.
 */
export async function postSessionDeviceBind(
  sessionId: string,
  attestation: DeviceBindAttestation,
  credentials?: SessionDeviceBindCredentials,
): Promise<SessionDeviceBindResult> {
  const url = `${getOauthConfig().BASE_API_URL}/v1/code/sessions/${sessionId}/device`
  const body = {
    target_device_id: attestation.deviceUUID,
    bind_attestation: {
      kid: attestation.kid,
      signature: attestation.signature,
    },
    bind_attestation_issued_at: attestation.issuedAt,
  }
  try {
    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        ...(credentials?.accessToken && {
          Authorization: `Bearer ${credentials.accessToken}`,
        }),
      },
      timeout: 10_000,
      validateStatus: () => true,
    })
    if (response.status >= 200 && response.status < 300) {
      return { ok: true }
    }
    return {
      ok: false,
      error: `http_${response.status}`,
      status: response.status,
    }
  } catch (err) {
    logForDebugging(`[attach-serve] link request failed: ${errorMessage(err)}`)
    return { ok: false, error: errorMessage(err) }
  }
}

/**
 * densable `We` @202316964 — local serve-link identity.
 * `Jwt` fail with `no_device_proof` is still `{ok:true}` for Yo serveOnly (`U=H.ok||local&&no_device_proof`).
 */
export async function localServeLinkIdentity(opts: {
  sessionId: string
}): Promise<ServeIdentityOk | ServeIdentityFail> {
  return checkLocalServeIdentity({
    sessionId: opts.sessionId,
    seams: {
      servingOff: servingOffReason,
      identity: async () => {
        const bind = await bindPreflight()
        if (bind !== undefined) return { ok: false, error: bind }
        return {
          ok: true,
          accountUuid: getOauthAccountInfo()?.accountUuid,
        }
      },
    },
  })
}

export type LinkForServingOpts = {
  sessionId: string
  /** gold `IL(e)` session UUID packed into Far/`$ar`; URL still uses sessionId. */
  sessionUuid?: string
  serveOnly: boolean
  orgUuid?: string
  accountUuid?: string
  deviceUUID?: string
  key?: DeviceBindKey
  request?: { workId: string; environmentId: string }
  capabilities?: string[]
  credentials?: SessionDeviceBindCredentials
  post?: (
    sessionId: string,
    attestation: DeviceBindAttestation,
    credentials?: SessionDeviceBindCredentials,
  ) => Promise<SessionDeviceBindResult>
}

/**
 * densable `Lt` @202316159 — POST `/v1/code/sessions/{id}/device` when Far
 * attestation is available from `opts.key`. Gold Yo:
 * `U=H.ok||(local&&no_device_proof)` then `linkForServing`.
 * Without key: keep current wrap — do not fake signature.
 */
export async function linkForServing(
  opts: LinkForServingOpts,
): Promise<{ ok: true; deviceId?: string } | { ok: false; message: string }> {
  if (!opts.serveOnly) return { ok: true }

  if (opts.key?.sign && opts.deviceUUID && opts.orgUuid && opts.accountUuid) {
    const sessionUuid = opts.sessionUuid ?? opts.sessionId
    const retried = await linkSessionDeviceWithRetry({
      sessionId: opts.sessionId,
      orgUuid: opts.orgUuid,
      credentials: opts.credentials,
      request: opts.request,
      prepared: {
        ok: true,
        local: {
          ok: true,
          sessionUuid,
          accountUuid: opts.accountUuid,
        },
        registered: { deviceUUID: opts.deviceUUID, key: opts.key },
      },
      seams: {
        post: async (_path, body, creds) => {
          const attestationFromBody = {
            deviceUUID: String(body.target_device_id ?? opts.deviceUUID),
            kid: String(
              (body.bind_attestation as { kid?: unknown } | undefined)?.kid ??
                '',
            ),
            signature: String(
              (body.bind_attestation as { signature?: unknown } | undefined)
                ?.signature ?? '',
            ),
            issuedAt: String(body.bind_attestation_issued_at ?? ''),
          } satisfies DeviceBindAttestation
          const posted = await (opts.post ?? postSessionDeviceBind)(
            opts.sessionId,
            attestationFromBody,
            creds as SessionDeviceBindCredentials | undefined,
          )
          return asLinkDeviceHttpResult(posted)
        },
      },
    })
    if (retried.ok) {
      logEvent('tengu_attach_serve_link', {
        outcome:
          'linked' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return { ok: true, deviceId: retried.deviceId }
    }
    logRemoteHeadlessFeatureBad('attach_serve_link')
    logEvent('tengu_attach_serve_link', {
      outcome: retried.refusal
        .kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { ok: false, message: retried.message }
  }

  const ident = await localServeLinkIdentity({ sessionId: opts.sessionId })
  if (isLocalServeLinkAllowed(ident)) {
    logEvent('tengu_attach_serve_link', {
      outcome:
        'linked' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { ok: true }
  }
  logRemoteHeadlessFeatureBad('attach_serve_link')
  logEvent('tengu_attach_serve_link', {
    outcome: ident.refusal
      .kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return {
    ok: false,
    message: ident.message,
  }
}

/**
 * densable `se` deviceBinding bag on zo @202423133.
 */
export type DeviceBindingState =
  | { status: 'unbound'; reason?: string }
  | { status: 'bound'; deviceId: string }

export function createDeviceBindingBag(
  accountUuid?: string,
  orgUuid?: string,
): {
  orgUuid?: string
  accountUuid?: string
  snapshot: () => DeviceBindingState
  status: () => DeviceBindingState['status']
  deviceId: () => string | undefined
  onBound: (deviceId: string) => void
  onUnbound: (reason?: string) => void
} {
  let state: DeviceBindingState = { status: 'unbound' }
  return {
    orgUuid,
    accountUuid,
    snapshot: () => state,
    status: () => state.status,
    deviceId: () => (state.status === 'bound' ? state.deviceId : undefined),
    onBound: deviceId => {
      state = { status: 'bound', deviceId }
    },
    onUnbound: reason => {
      state = { status: 'unbound', reason }
    },
  }
}

export function cloudCreatedUnboundError(
  sessionId: string,
  reason?: string,
  archived = false,
): string {
  const why = reason ?? 'the binding outcome was never reported'
  const rest = archived
    ? `It was archived (nothing was left running); it is listed under Archived at ${cloudSessionViewUrl(sessionId)}.`
    : `It was left running and could not be archived from here.`
  return `Error: cloud session ${sessionId} was created but this machine could not be bound to it: ${why}. ${rest}`
}

/**
 * densable `class Ke` @202327093 — agent→host permission/dialog queue.
 */
export class HeadlessCloudAgentRequests {
  inFlight = new Map<string, AbortController>()
  askedOfHost = new Set<string>()
  derivedIds = new Set<string>()
  retiredIds = new Set<string>()
  settledTotal = 0
  tearingDown = false
  askLimiter = createServedAskLimiter()
  get pendingCount(): number {
    return this.inFlight.size
  }
  get settledCount(): number {
    return this.settledTotal
  }
  cancel(id: string): void {
    this.retiredIds.add(id)
    this.inFlight.get(id)?.abort()
  }
  cancelAll(): void {
    this.tearingDown = true
    for (const c of this.inFlight.values()) c.abort()
  }
}

/**
 * densable `class at` @202352750 — host control_request router (Feo/D).
 */
export class HeadlessCloudHostRequests {
  pendingInterrupt: string | null = null
  announcedCancelled = new Set<string>()
  handleControlRequest(
    request: { subtype?: string; mode?: string; settings?: unknown },
    { strict }: { strict: boolean },
  ): 'dropped' | 'rejected' | 'forwarded' | 'local' {
    const { route, telemetrySubtype } = describeCloudHostedControlRoute(
      request,
      { strict },
    )
    void telemetrySubtype
    if (route.kind === 'reject') return 'rejected'
    if (route.kind === 'forward') return 'forwarded'
    return 'local'
  }
}

/** densable `Qt` @202374243 */
export const HEADLESS_CLOUD_QUEUE_CAP = 100

export type HeadlessCloudOutboundItem = {
  kind: 'message' | 'control'
  uuid?: string
  content?: unknown
  request?: { subtype?: string }
  holdsLaterSends?: boolean
}

type HeadlessCloudOwedEcho = { uuid: string; content: unknown }

type HeadlessCloudLedgerPhase =
  | 'queued'
  | 'posting'
  | 'delivered'
  | 'seeded'
  | 'withdrawn'
  | 'given_up'
  | 'failed'

type HeadlessCloudLedgerEntry = {
  kind: string
  phase: HeadlessCloudLedgerPhase
  content?: unknown
  stored?: unknown
  owed: number
  pendingEchoes: number
  delivered: boolean
  echoMayBeLost: boolean
  hadBefore: boolean
}

/**
 * densable `class dt` @202358643 — outbound uuid ledger.
 * Gold ct: `this.ledger=new dt(n*4+8, e.replayUserMessages)`.
 */
export class HeadlessCloudSendLedger {
  cap: number
  replay: boolean
  entries = new Map<string, HeadlessCloudLedgerEntry>()
  constructor(cap: number, replay: boolean) {
    this.cap = cap
    this.replay = replay
  }
  get size(): number {
    return this.entries.size
  }
  phaseOf(uuid: string): HeadlessCloudLedgerPhase | undefined {
    return this.entries.get(uuid)?.phase
  }
  wasTaken(uuid: string): boolean {
    const n = this.phaseOf(uuid)
    return (
      n === 'queued' || n === 'posting' || n === 'delivered' || n === 'seeded'
    )
  }
  accept(
    uuid: string,
    kind: string,
    content?: unknown,
  ): HeadlessCloudOwedEcho[] {
    const r = this.entries.get(uuid)
    const h = this.replay && kind === 'message' ? 1 : 0
    this.entries.delete(uuid)
    return this.set(uuid, {
      kind,
      phase: 'queued',
      content,
      stored: undefined,
      owed: (r?.owed ?? 0) + h,
      pendingEchoes: r?.pendingEchoes ?? 0,
      delivered: false,
      echoMayBeLost: r?.echoMayBeLost ?? false,
      hadBefore: false,
    })
  }
  seed(
    uuid: string,
    content?: unknown,
    stored?: unknown,
  ): HeadlessCloudOwedEcho[] {
    const r = this.entries.get(uuid)
    const h: HeadlessCloudOwedEcho[] =
      r !== undefined && r.owed > 0 && r.content !== undefined
        ? [{ uuid, content: r.content }]
        : []
    const g = stored !== undefined && content !== undefined
    return [
      ...this.set(uuid, {
        kind: 'message',
        phase: 'seeded',
        content: content ?? r?.content,
        stored: g ? content : undefined,
        owed: this.replay && !g ? 1 : 0,
        pendingEchoes: g ? 0 : 1,
        delivered: true,
        echoMayBeLost: false,
        hadBefore: false,
      }),
      ...h,
      ...(g && this.replay ? [{ uuid, content }] : []),
    ]
  }
  postStart(uuid: string): void {
    const n = this.entries.get(uuid)
    if (n === undefined) return
    n.phase = 'posting'
    if (n.kind === 'message') n.pendingEchoes += 1
  }
  hadBefore(uuid: string): boolean {
    return this.entries.get(uuid)?.hadBefore ?? false
  }
  postOk(
    uuid: string,
    kind: 'duplicate' | 'never' | 'streams' | 'ok' = 'ok',
  ): { echo: boolean } {
    const s = this.entries.get(uuid)
    if (s === undefined) return { echo: false }
    s.phase = 'delivered'
    s.delivered = true
    if (kind === 'duplicate') s.hadBefore = true
    if (kind === 'never') s.pendingEchoes = 0
    if (kind !== 'streams') s.stored ??= s.content
    return kind !== 'streams' || s.echoMayBeLost
      ? { echo: this.takeOwed(s) }
      : { echo: false }
  }
  postFail(uuid: string, posted?: boolean): { echo: boolean; error: boolean } {
    const s = this.entries.get(uuid)
    if (s === undefined) return { echo: false, error: true }
    if (s.delivered) return { echo: false, error: false }
    s.phase = 'failed'
    if (!posted) s.pendingEchoes = Math.max(0, s.pendingEchoes - 1)
    return { echo: this.takeOwed(s), error: true }
  }
  giveUp(uuid: string): { echo: boolean } {
    const n = this.entries.get(uuid)
    if (n === undefined) return { echo: false }
    n.phase = 'given_up'
    return { echo: this.takeOwed(n) }
  }
  streamEcho(
    uuid: string,
    content: unknown,
  ): {
    verdict: 'not_own' | 'claim' | 'consume' | 'peer'
    dequeue: boolean
    sent?: unknown
  } {
    const s = this.entries.get(uuid)
    if (s === undefined || s.kind !== 'message') {
      return { verdict: 'not_own', dequeue: false }
    }
    if (s.pendingEchoes > 0) {
      s.pendingEchoes = 0
      s.echoMayBeLost = false
      s.stored = content
      const h = s.phase === 'queued'
      s.delivered = true
      if (s.phase !== 'posting' && s.phase !== 'seeded') s.phase = 'delivered'
      if (s.owed > 0) {
        s.owed -= 1
        return { verdict: 'claim', sent: s.content, dequeue: h }
      }
      return { verdict: 'consume', dequeue: h }
    }
    return {
      verdict:
        s.delivered &&
        s.owed === 0 &&
        s.stored !== undefined &&
        isDeepStrictEqual(content, s.stored)
          ? 'consume'
          : 'peer',
      dequeue: false,
    }
  }
  settleOwed(): HeadlessCloudOwedEcho[] {
    return [...this.entries].flatMap(([e, n]) => {
      if (
        (n.phase !== 'delivered' && n.phase !== 'seeded') ||
        n.owed === 0 ||
        n.content === undefined
      ) {
        return []
      }
      n.owed -= 1
      return [{ uuid: e, content: n.content }]
    })
  }
  truncation(): HeadlessCloudOwedEcho[] {
    return [...this.entries].flatMap(([e, n]) => {
      if (n.pendingEchoes === 0) return []
      n.echoMayBeLost = true
      if (n.owed === 0 || n.content === undefined) return []
      n.owed -= 1
      return [{ uuid: e, content: n.content }]
    })
  }
  withdraw(uuid: string): boolean {
    const n = this.entries.get(uuid)
    if (n === undefined) return true
    if (n.phase === 'posting') {
      n.pendingEchoes = Math.max(0, n.pendingEchoes - 1)
      if (n.delivered) {
        n.phase = 'delivered'
        return false
      }
    }
    n.phase = 'withdrawn'
    n.owed = Math.max(0, n.owed - 1)
    return true
  }
  private takeOwed(e: HeadlessCloudLedgerEntry): boolean {
    if (e.owed === 0) return false
    e.owed -= 1
    return true
  }
  private set(
    uuid: string,
    n: HeadlessCloudLedgerEntry,
  ): HeadlessCloudOwedEcho[] {
    const s =
      !this.entries.has(uuid) && this.entries.size >= this.cap
        ? this.evictOne()
        : []
    this.entries.set(uuid, n)
    return s
  }
  private evictOne(): HeadlessCloudOwedEcho[] {
    const live = (w: HeadlessCloudLedgerEntry) =>
      w.phase === 'queued' || w.phase === 'posting'
    const h =
      this.oldestWhere(
        w => !live(w) && w.owed === 0 && w.pendingEchoes === 0,
      ) ??
      this.oldestWhere(w => !live(w) && w.owed === 0) ??
      this.oldestWhere(w => !live(w))
    if (h === null) return []
    const [g, v] = h
    this.entries.delete(g)
    return v.owed > 0 && v.content !== undefined
      ? [{ uuid: g, content: v.content }]
      : []
  }
  private oldestWhere(
    pred: (w: HeadlessCloudLedgerEntry) => boolean,
  ): [string, HeadlessCloudLedgerEntry] | null {
    return [...this.entries].find(([, n]) => pred(n)) ?? null
  }
}

/**
 * densable `class ct` @202362314 wrap on StructuredIO outbound.
 * Ledger is `dt`. postsInFlight / forwardsWaiting / abandonPostsInFlight
 * BODY; flush compositor stays off.
 */
export class HeadlessCloudOutbound {
  queueCap: number
  queue: HeadlessCloudOutboundItem[] = []
  flushing = false
  closedWhy: string | null = null
  closedCause: string | null = null
  ledger: HeadlessCloudSendLedger
  postsInFlight = new Set<HeadlessCloudOutboundItem>()
  forwardsInFlight = new Map<string, AbortController>()
  sendOutstanding = false
  outstandingSend: Promise<unknown> = Promise.resolve()
  forwardsWaiting = new Map<AbortController, HeadlessCloudOutboundItem>()
  renewalParked = new Set<HeadlessCloudOutboundItem>()
  sendCount = 0
  forwardCount = 0
  maxQueued = 0
  constructor(queueCap = HEADLESS_CLOUD_QUEUE_CAP, replay = false) {
    this.queueCap = queueCap
    this.ledger = new HeadlessCloudSendLedger(queueCap * 4 + 8, replay)
  }
  get queuedCount(): number {
    return this.queue.length + this.forwardsWaiting.size
  }
  get isFlushing(): boolean {
    return this.flushing
  }
  get stats(): { sends: number; forwards: number; maxQueued: number } {
    return {
      sends: this.sendCount,
      forwards: this.forwardCount,
      maxQueued: this.maxQueued,
    }
  }
  submit(item: HeadlessCloudOutboundItem): 'new' | 'refused' | 'redelivered' {
    if (
      item.kind !== 'control' &&
      item.uuid &&
      this.ledger.wasTaken(item.uuid)
    ) {
      return 'redelivered'
    }
    if (this.closedWhy !== null) return 'refused'
    if (this.queue.length >= this.queueCap) {
      this.failItem(
        item,
        'too many messages are waiting for the cloud session',
        {
          outcome: 'overflow',
        },
      )
      logEvent('tengu_remote_headless_client_queue_overflow', {
        kind: item.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return 'refused'
    }
    if (item.kind !== 'control' && item.uuid) {
      this.ledger.accept(item.uuid, item.kind, item.content)
    }
    this.queue.push(item)
    this.maxQueued = Math.max(this.maxQueued, this.queue.length)
    return 'new'
  }
  shift(): HeadlessCloudOutboundItem | undefined {
    const item = this.queue.shift()
    if (item?.kind === 'control') this.forwardCount += 1
    else if (item) {
      this.sendCount += 1
      this.postsInFlight.add(item)
      if (item.uuid) this.ledger.postStart(item.uuid)
    }
    return item
  }
  confirmPosted(item: HeadlessCloudOutboundItem): boolean {
    if (!this.postsInFlight.delete(item)) {
      this.logSend(item.kind, 'abandoned')
      return false
    }
    if (item.uuid) this.ledger.postOk(item.uuid)
    return true
  }
  abandonPostsInFlight(why: string): number {
    const n = [...this.postsInFlight]
    this.postsInFlight.clear()
    this.renewalParked.clear()
    n.forEach(s => this.failItem(s, why, { posted: true, unconfirmed: true }))
    this.ledger.settleOwed()
    return n.length
  }
  failItem(
    item: HeadlessCloudOutboundItem,
    why: string,
    {
      posted = false,
      unconfirmed = false,
      outcome = 'closed',
    }: { posted?: boolean; unconfirmed?: boolean; outcome?: string } = {},
  ): void {
    if (item.kind === 'control') {
      logEvent('tengu_remote_headless_client_host_request', {
        subtype: (item.request?.subtype ??
          'control') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        outcome:
          outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return
    }
    if (item.uuid) {
      if (posted) {
        const { error } = this.ledger.postFail(item.uuid, unconfirmed)
        if (!error) {
          logForDebugging(
            `[headlessCloudClient] POST for ${item.uuid} failed after its echo; treating it as delivered`,
          )
          return
        }
      } else {
        this.ledger.giveUp(item.uuid)
      }
    }
    this.logSend(item.kind, outcome)
    void why
  }
  logSend(
    kind: string,
    outcome: string,
    extra: Record<string, unknown> = {},
  ): void {
    logEvent('tengu_remote_headless_client_send', {
      kind: kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      outcome:
        outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...extra,
    })
  }
  close(why: string, cause?: string): number {
    if (this.closedWhy === null) {
      this.closedWhy = why
      this.closedCause = cause ?? null
    }
    const n = this.queue.length + this.forwardsWaiting.size
    this.queue = []
    this.forwardsWaiting.clear()
    if (n > 0) {
      logEvent('tengu_remote_headless_client_queue_dropped', {
        count: n as never,
        cause: (cause ??
          why) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    return n
  }
}

type HeadlessCloudFeaturePack = {
  feature?: string
  homeSeed?: unknown
  status?: unknown
  sessionCallbacks?: Record<string, unknown>
  report?: () => unknown
  beforeSend?: () => unknown
  dispose?: () => unknown
  onSession?: (session: unknown) => void
  onStreamConnected?: () => void
  onWorkerLive?: () => void
  onWorkerInit?: (init: unknown) => void
  onWorkerUp?: (up: unknown) => void
  onTurnInFlight?: () => void
  onTurnEnded?: () => void
  onSessionCleared?: (why: unknown) => void
  onMessageSent?: (msg: unknown) => void
  afterFirstReply?: (reply: unknown) => void
  onSettled?: (cb: () => void) => void
  onReportChanged?: (cb: () => void) => void
}

function containedFeature(run: () => unknown): void {
  try {
    const n = run()
    if (n instanceof Promise) void n.catch(() => undefined)
  } catch {
    /* gold Pe/ge swallow */
  }
}

/**
 * densable `class Ce` @202301495 — feature pack adopt/homeSeed/statusFeeds.
 */
export class HeadlessCloudFeatureHandles {
  attached: HeadlessCloudFeaturePack[] = []
  replied = false
  adopt(features: HeadlessCloudFeaturePack[]): void {
    this.attached = [...this.attached, ...features]
  }
  handles(): HeadlessCloudFeaturePack[] {
    return this.attached
  }
  homeSeed(): unknown {
    return this.attached.find(e => e.homeSeed !== undefined)?.homeSeed
  }
  statusFeeds(): unknown[] {
    return this.attached.flatMap(e =>
      e.status === undefined ? [] : [e.status],
    )
  }
  reports(): Record<string, unknown> {
    return Object.fromEntries(
      this.attached.flatMap(e => {
        if (e.report === undefined || e.feature === undefined) return []
        try {
          return [[e.feature, e.report()]] as Array<[string, unknown]>
        } catch {
          return []
        }
      }),
    )
  }
  noteSession(session: unknown): void {
    this.each(n => n.onSession?.(session))
  }
  noteStreamConnected(): void {
    this.each(e => e.onStreamConnected?.())
  }
  noteWorkerLive(): void {
    this.each(e => e.onWorkerLive?.())
  }
  noteWorkerInit(init: unknown): void {
    this.each(n => n.onWorkerInit?.(init))
  }
  noteWorkerUp(up: unknown): void {
    this.each(n => n.onWorkerUp?.(up))
  }
  noteTurnInFlight(): void {
    this.each(e => e.onTurnInFlight?.())
  }
  noteTurnEnded(): void {
    this.each(e => e.onTurnEnded?.())
  }
  sendWait(): (() => Promise<void>) | null {
    const e = this.attached.filter(n => n.beforeSend !== undefined)
    if (e.length === 0) return null
    return async () => {
      await Promise.all(
        e.map(n =>
          Promise.resolve()
            .then(() => n.beforeSend?.())
            .catch(() => undefined),
        ),
      )
    }
  }
  noteSessionCleared(why: unknown): void {
    this.each(n => n.onSessionCleared?.(why))
  }
  noteMessageSent(msg: unknown): void {
    this.each(n => n.onMessageSent?.(msg))
  }
  noteReply(reply: unknown): void {
    if (this.replied) return
    this.replied = true
    this.each(n => n.afterFirstReply?.(reply))
  }
  async dispose(): Promise<void> {
    const e = this.attached
    this.attached = []
    await Promise.all(
      e.map(n =>
        Promise.resolve()
          .then(() => n.dispose?.())
          .catch(() => undefined),
      ),
    )
  }
  each(fn: (pack: HeadlessCloudFeaturePack) => void): void {
    this.attached.forEach(n => containedFeature(() => fn(n)))
  }
  onEachSettled(cb: () => void): void {
    this.each(n => n.onSettled?.(() => containedFeature(cb)))
  }
  onEachReportChanged(cb: () => void): void {
    this.each(n => n.onReportChanged?.(() => containedFeature(cb)))
  }
}

/** densable `SXn` @202346113 — strip `cloud_session` key. */
export function stripCloudSessionKey<T extends Record<string, unknown>>(
  event: T,
): Omit<T, 'cloud_session'> | T {
  if (!Object.hasOwn(event, 'cloud_session')) return event
  const { cloud_session: _n, ...s } = event
  return s
}

/** densable `bXn` @202348264 — drop `[ede_diagnostic]` result.errors. */
export function stripEdeDiagnosticErrors<T extends { type?: string }>(
  event: T,
): T {
  if (event.type !== 'result' || !('errors' in event)) return event
  const n = (event as { errors?: unknown }).errors
  if (!Array.isArray(n)) return event
  const s = n.filter(
    r => !(typeof r === 'string' && r.startsWith('[ede_diagnostic]')),
  )
  return s.length === n.length ? event : { ...event, errors: s }
}

/** gold `f_n` @202311992 — hosted serve dialogs = wood ∧ chinrest. */
export async function hostedServeDialogsGateOn(): Promise<boolean> {
  return isHostedServeDialogsEnabled()
}

export type HeadlessCloudDialogs = {
  kinds: Set<string>
  request: (
    kind: {
      kind: string
      result?: readonly string[]
      default?: string
    },
    payload: unknown,
    opts?: { signal?: AbortSignal },
  ) => Promise<{ answer: string; answered: boolean }>
}

/** gold `Bo` keys — defined here so host args can name them without a qqr engine. */
export type HeadlessCloudArgvPolicyReason =
  | 'bypass'
  | 'attach_restriction'
  | 'tool_restriction'
  | 'deny_rule_unclosed'
  | 'sdk_mcp'
  | 'unsupported'

export type HeadlessCloudHostArgs = {
  inputPrompt: string | AsyncIterable<string>
  effectiveReplayUserMessages?: boolean
  effectiveIncludePartialMessages?: boolean
  effectiveModel?: string
  tools?: ReadonlyArray<{ name: string }>
  sessionNameArg?: string
  permissionModeCli?: string
  systemPrompt?: string
  appendSystemPrompt?: string
  appendSubagentSystemPrompt?: string
  poolOnBranch?: string | null
  poolRef?: string | null
  remote?: string | null
  storageV5?: unknown
  credentials?: unknown
  forwardHomeSettings?: boolean
  homeSettingsConsent?: 'forward' | null
  /** gold `host.dialogs` — headless CLI has none unless a host injects. */
  dialogs?: HeadlessCloudDialogs
  /**
   * gold `b_n` qqr reject reason. Default undefined skips Bo — no argv engine.
   */
  argvPolicyReject?: HeadlessCloudArgvPolicyReason
  argvPolicyMessage?: string
}

/** densable `QUe.kind` @202330210 */
export const CLOUD_SYNC_CONSENT_KIND = 'cloud_sync_consent'
/** densable `QUe.result` @202330206 — HeadlessCloudDialogs wrap. */
export const CLOUD_SYNC_CONSENT_RESULTS = [
  'sync',
  'device_tools',
  'not_now',
] as const
/** densable `QUe.default` @202330206 */
export const CLOUD_SYNC_CONSENT_DEFAULT = 'not_now' as const
/** densable unattended dialog kind @72162272 */
export const UNATTENDED_SERVING_CONSENT_KIND = 'unattended_serving_consent'

const HOME_SETTINGS_MODES = ['forward', 'keep_local'] as const

/**
 * densable `H0e` / `pQt` @185879805 — stored remoteHomeSettingsMode.
 */
export function storedHomeSettingsConsent(
  mode: unknown = getBootstrapSessionHost().launchOptions.homeSettingsHostConsent(),
): 'forward' | 'keep_local' | undefined {
  return HOME_SETTINGS_MODES.includes(
    mode as (typeof HOME_SETTINGS_MODES)[number],
  )
    ? (mode as 'forward' | 'keep_local')
    : undefined
}

/**
 * densable `nPe` @191773177 — CLI permission mode, drop bypass/bubble.
 */
export function parseHeadlessCloudPermissionMode(
  raw?: string,
): PermissionMode | undefined {
  if (!raw) return
  const parsed =
    raw === 'manual'
      ? 'default'
      : (PERMISSION_MODES as readonly string[]).includes(raw)
        ? (raw as PermissionMode)
        : 'default'
  if (parsed === 'bubble' || parsed === 'bypassPermissions') return
  return parsed
}

/** gold `VL` @175991767 — commander `--permission-mode` default is `"manual"`. */
export const HEADLESS_CLOUD_PERMISSION_MODE_CLI_DEFAULT = 'manual'

/**
 * densable `g_n` @202415477 — attach opening `set_permission_mode`.
 * serveOnly → []. `nPe` undefined or (`default` ∧ argv !== `"manual"`) → [].
 */
export function openingPermissionModeRequests(
  permissionModeCli: string | undefined,
  { serveOnly }: { serveOnly: boolean },
): Array<{
  request: { subtype: 'set_permission_mode'; mode: PermissionMode }
  required: boolean
  describe: string
}> {
  if (serveOnly) return []
  const s = parseHeadlessCloudPermissionMode(permissionModeCli)
  if (
    s === undefined ||
    (s === 'default' &&
      permissionModeCli !== HEADLESS_CLOUD_PERMISSION_MODE_CLI_DEFAULT)
  ) {
    return []
  }
  return [
    {
      request: { subtype: 'set_permission_mode', mode: s },
      required: s === 'plan' || s === 'dontAsk',
      describe: `--permission-mode ${s}`,
    },
  ]
}

/** densable `GQe` @191132797 */
export function replayCloudUserMessage(
  sessionId: string,
  uuid: string,
  content: unknown,
): {
  type: 'user'
  uuid: string
  session_id: string
  isReplay: true
  parent_tool_use_id: null
  message: { role: 'user'; content: unknown }
} {
  return {
    type: 'user',
    uuid,
    session_id: sessionId,
    isReplay: true,
    parent_tool_use_id: null,
    message: { role: 'user', content },
  }
}

/** densable `M_e` @175681559 */
export function cloudPlatformLabel(
  platform: NodeJS.Platform = process.platform,
): string {
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

/** densable `pWe` @196065422 — device display name. */
export function cloudDeviceDisplayName(
  host = hostname(),
  platform: NodeJS.Platform = process.platform,
): string {
  return `Claude Code on ${host} · ${cloudPlatformLabel(platform)}`
}

/** densable `ys` @202330520 — `_jt` folder cap. */
const DIR_SYNC_CONSENT_FOLDER_CAP = 1024

/** densable `X` @179761900 — Fnn max initial events when bound. */
export const BOUND_CREATE_MAX_EVENTS = 16

/** densable `Fe` @202330527 */
export function isDirSyncConsentFolder(folder: string): boolean {
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: gold Fe @202330527
  const stripped = folder.replace(/[\u200C\u200D\uFE0E\uFE0F]/gu, '')
  return (
    folder.length > 0 &&
    folder.length <= DIR_SYNC_CONSENT_FOLDER_CAP &&
    !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u.test(
      stripped,
    )
  )
}

export const CLOUD_SYNC_CONSENT_COPY = {
  title: 'Sync this project directory to the cloud?',
  body: 'Allow Claude Code to sync files from this project directory into cloud sessions, so Claude can work on them in the cloud.',
  detail:
    "Secrets, credentials, and gitignored files are never synced and all synced files are encrypted at rest. Whichever you choose, files Claude reads and command output from this computer become part of the cloud session: anyone you share the session with and, on Team or Enterprise plans, your organization's admins can see them.",
} as const

/**
 * densable `_jt` @202330701 — dir-sync consent copy. Invalid folder → null.
 * leftover `CLOUD_ATTACH_SYNC_CONSENT_COPY` is re-exported from leftoverCloudCopy.
 */
export function dirSyncConsentCopy(opts: {
  folder: string
  launchFolder?: string
  upload?: { fileCount?: number; totalBytes?: number }
  copy?: 'create' | 'attach'
}): {
  folder: string
  launchFolder?: string
  title: string
  body: string
  detail: string
  fileCount?: number
  totalBytes?: number
} | null {
  const r = opts.copy ?? 'create'
  if (
    !isDirSyncConsentFolder(opts.folder) ||
    (opts.launchFolder !== undefined &&
      opts.launchFolder !== opts.folder &&
      !isDirSyncConsentFolder(opts.launchFolder))
  ) {
    return null
  }
  const copy =
    r === 'attach' ? CLOUD_ATTACH_SYNC_CONSENT_COPY : CLOUD_SYNC_CONSENT_COPY
  return {
    folder: opts.folder,
    ...(opts.launchFolder !== opts.folder &&
      opts.launchFolder !== undefined && { launchFolder: opts.launchFolder }),
    title: copy.title,
    body: copy.body,
    detail: copy.detail,
    ...(opts.upload?.fileCount !== undefined && {
      fileCount: opts.upload.fileCount,
    }),
    ...(opts.upload?.totalBytes !== undefined && {
      totalBytes: opts.upload.totalBytes,
    }),
  }
}

/** densable `Bt` @202330960 / `Cgt.servers.max` */
const DEVICE_MCP_MAX_SERVERS = 64
/** densable `Ge` @202330968 / `Cgt` name max */
const DEVICE_MCP_NAME_CAP = 128
/** densable `Ss` @202330976 / `Cgt.machine_name.max` */
const DEVICE_MCP_MACHINE_CAP = 256
/** densable `Ve` @202330954 / `Cgt.tool_names.max` */
const DEVICE_MCP_TOOL_NAMES_CAP = 20
/** densable `BXn` @200427230 — withheld-diff name cap for `ws` / `Mqr.diffNamesCap` */
const DEVICE_MCP_DIFF_NAMES_CAP = 8
/** densable `vH` @179060173 — `Ate` input cap */
const DEVICE_MCP_ATE_INPUT_CAP = 256

export type DeviceMcpConsentServer = {
  name: string
  scope: 'user' | 'local' | 'plugin'
  transport: 'stdio' | 'http' | 'sse' | 'ws'
  tool_count: number
  tool_names: string[]
  tool_names_truncated: boolean
}

export type DeviceMcpConsentPayload = {
  v: 1
  machine_name: string
  reconsent: boolean
  changed_servers?: string[]
  servers: DeviceMcpConsentServer[]
}

export type DeviceMcpOfferedConfig = {
  scope?: string
  type?: string
  pluginSource?: string
}

export type DeviceMcpToolSnapshot =
  | 'unreadable'
  | {
      servers: Record<string, 'declined' | Record<string, unknown>>
      withheld?: Record<string, { added: string[]; changed: string[] }>
    }

export type DeviceMcpWithheldDiff = { added: string[]; changed: string[] }

/**
 * densable `I` @179058669 — presentable after stripping VS16 / Mongolian / braille blank.
 */
function isPresentableDeviceMcpText(e: string): boolean {
  return e.replace(/[\uFE0E\uFE0F\u180B-\u180F\u2800]/gu, '').trim().length > 0
}

/**
 * densable `YW` @179059615 — presentable after dropping replacement-char pairs.
 */
function isPresentableDeviceMcpName(e: string): boolean {
  const n: string[] = []
  let i = false
  for (const r of Array.from(e)) {
    if (r !== '\n' && !isPresentableDeviceMcpText(r)) {
      i = true
      continue
    }
    if (r === '\uFFFD' && i) {
      i = false
      continue
    }
    i = false
    n.push(r)
  }
  return isPresentableDeviceMcpText(n.join(''))
}

/** densable `Ate` @179060185 — collapse whitespace, cap, presentable. */
function presentableDeviceMcpName(e: string): string {
  const n = e.slice(0, DEVICE_MCP_ATE_INPUT_CAP)
  return n.replace(/\s+/g, ' ').trim()
}

/**
 * densable `Hke` @179060519 — NFC-unique names stay as `Ate`; collisions escape.
 */
function uniquePresentableDeviceMcpNames(
  e: string[],
  n: (d: string) => string,
): string[] {
  const i = new Map<string, Set<string>>()
  const r = (d: string) => n(d).normalize('NFC')
  for (const d of e) {
    const p = r(d)
    const m = i.get(p) ?? new Set<string>()
    m.add(d)
    i.set(p, m)
  }
  const c = new Map<string, Map<string, number>>()
  return e.map(d => {
    const p = r(d)
    if ((i.get(p)?.size ?? 0) <= 1) return n(d)
    const m = n(d)
    const g = c.get(m) ?? new Map<string, number>()
    c.set(m, g)
    const y = g.get(d) ?? g.size + 1
    g.set(d, y)
    return y > 1 ? `${m} (#${y})` : m
  })
}

/** densable `vs` @202332221 — user/local, or plugin via `b5` @176054301. */
function deviceMcpConsentScope(
  e: DeviceMcpOfferedConfig,
): 'user' | 'local' | 'plugin' | undefined {
  switch (e.scope) {
    case 'user':
    case 'local':
      return e.scope
    case 'dynamic':
      return e.pluginSource !== undefined ? 'plugin' : undefined
    default:
      return
  }
}

/** densable `Cs` @202332421 — serve transports only. */
function deviceMcpConsentTransport(
  e: DeviceMcpOfferedConfig,
): 'stdio' | 'http' | 'sse' | 'ws' | undefined {
  switch (e.type) {
    case undefined:
    case 'stdio':
      return 'stdio'
    case 'http':
    case 'sse':
    case 'ws':
      return e.type
    default:
      return
  }
}

/** densable `UXn` @200425541 */
function isDeviceMcpServeTransport(e: DeviceMcpOfferedConfig): boolean {
  return deviceMcpConsentTransport(e) !== undefined
}

/**
 * densable `m4r` @200422647 / `$Xn` @200425327 — not enterprise/managed,
 * project excluded (`Q=!1`).
 */
function isDeviceMcpOfferableScope(scope: string | undefined): boolean {
  if (scope === 'enterprise' || scope === 'managed') return false
  return scope !== 'project'
}

/**
 * densable `rPe` @200425373 — `$Xn && !o`. No first-party design host here.
 */
function isDeviceMcpOfferable(
  name: string,
  config: DeviceMcpOfferedConfig,
): boolean {
  return (
    isDeviceMcpOfferableScope(config.scope) &&
    !isMcpServerDisabled(name) &&
    isDeviceMcpServeTransport(config)
  )
}

/** densable `jXn` @200427242 */
function isDeviceMcpWithheldDiff(e: DeviceMcpWithheldDiff): boolean {
  return e.added.length > 0 || e.changed.length > 0
}

/** densable `Qr(withheld, jXn)` pickBy. */
function pickDeviceMcpWithheldDiffs(
  withheld: Record<string, DeviceMcpWithheldDiff> | undefined,
): Record<string, DeviceMcpWithheldDiff> {
  const out: Record<string, DeviceMcpWithheldDiff> = {}
  for (const [name, diff] of Object.entries(withheld ?? {})) {
    if (isDeviceMcpWithheldDiff(diff)) out[name] = diff
  }
  return out
}

/**
 * densable `ws` @202332555 — tool names from snapshot + withheld.added.
 */
function deviceMcpConsentTools(
  e: string,
  n: DeviceMcpToolSnapshot,
  s: DeviceMcpWithheldDiff | undefined,
  r: number,
): Pick<
  DeviceMcpConsentServer,
  'tool_count' | 'tool_names' | 'tool_names_truncated'
> {
  if (n === 'unreadable') {
    return { tool_count: 0, tool_names: [], tool_names_truncated: true }
  }
  const h = Object.hasOwn(n.servers, e) ? n.servers[e] : undefined
  const g = getMcpPrefix(e).slice(5)
  const v = [
    ...new Set(
      [
        ...(s?.added ?? []),
        ...(h === undefined || h === 'declined' ? [] : Object.keys(h)),
      ].map(E => (E.startsWith(g) ? E.slice(g.length) : E)),
    ),
  ]
  const w = v.filter(E =>
    isPresentableDeviceMcpName(presentableDeviceMcpName(E)),
  )
  const b = uniquePresentableDeviceMcpNames(w, presentableDeviceMcpName)
  return {
    tool_count: v.length,
    tool_names: b.slice(0, DEVICE_MCP_TOOL_NAMES_CAP),
    tool_names_truncated:
      b.length > DEVICE_MCP_TOOL_NAMES_CAP ||
      w.length < v.length ||
      (s !== undefined && Math.max(s.added.length, s.changed.length) >= r),
  }
}

/** densable `Cgt.payload().safeParse` @202330984 */
function isDeviceMcpConsentPayload(w: DeviceMcpConsentPayload): boolean {
  if (w.v !== 1) return false
  if (
    w.machine_name.length < 1 ||
    w.machine_name.length > DEVICE_MCP_MACHINE_CAP
  ) {
    return false
  }
  if (w.servers.length < 1 || w.servers.length > DEVICE_MCP_MAX_SERVERS) {
    return false
  }
  if (w.reconsent) {
    if (
      w.changed_servers === undefined ||
      w.changed_servers.length !== w.servers.length
    ) {
      return false
    }
  } else if (w.changed_servers !== undefined) {
    return false
  }
  return w.servers.every(b => {
    if (b.name.length < 1 || b.name.length > DEVICE_MCP_NAME_CAP) return false
    if (b.scope !== 'user' && b.scope !== 'local' && b.scope !== 'plugin') {
      return false
    }
    if (
      b.transport !== 'stdio' &&
      b.transport !== 'http' &&
      b.transport !== 'sse' &&
      b.transport !== 'ws'
    ) {
      return false
    }
    if (!Number.isInteger(b.tool_count) || b.tool_count < 0) return false
    if (b.tool_names.length > DEVICE_MCP_TOOL_NAMES_CAP) return false
    return b.tool_names.every(
      name => name.length >= 1 && name.length <= DEVICE_MCP_NAME_CAP,
    )
  })
}

/**
 * densable `Mqr` @202331650 — device MCP consent snapshot. Empty/over-cap → null.
 * Gold fields: v, machine_name, reconsent, changed_servers?, servers[].{name,scope,transport,tool_count,tool_names,tool_names_truncated}
 */
export function deviceMcpConsentSnapshot(opts: {
  machineName: string
  offered: Array<[string, DeviceMcpOfferedConfig]>
  snapshot?: DeviceMcpToolSnapshot
  withheld?: Record<string, DeviceMcpWithheldDiff>
  diffNamesCap?: number
}): DeviceMcpConsentPayload | null {
  const n = opts.offered
  const s = opts.snapshot ?? { servers: {} }
  const r = opts.withheld
  const h = opts.diffNamesCap ?? DEVICE_MCP_DIFF_NAMES_CAP
  const g = r === undefined ? n : n.filter(([b]) => Object.hasOwn(r, b))
  if (g.length === 0 || g.length > DEVICE_MCP_MAX_SERVERS) return null
  const v = g.flatMap(([b, E]) => {
    const D = deviceMcpConsentScope(E)
    const A = deviceMcpConsentTransport(E)
    if (D === undefined || A === undefined) return []
    return [
      {
        name: presentableDeviceMcpName(b),
        scope: D,
        transport: A,
        ...deviceMcpConsentTools(
          b,
          s,
          r !== undefined && Object.hasOwn(r, b) ? r[b] : undefined,
          h,
        ),
      },
    ]
  })
  const w: DeviceMcpConsentPayload = {
    v: 1,
    machine_name: opts.machineName,
    reconsent: r !== undefined,
    ...(r !== undefined && { changed_servers: v.map(b => b.name) }),
    servers: v,
  }
  const uniqueOffered =
    new Set(n.map(([b]) => presentableDeviceMcpName(b).normalize('NFC')))
      .size === n.length
  return v.length === g.length &&
    v.every(b => isPresentableDeviceMcpName(b.name)) &&
    uniqueOffered &&
    isDeviceMcpConsentPayload(w)
    ? w
    : null
}

export const DEVICE_MCP_CONSENT_KIND = 'device_mcp_consent'
/** densable `Cgt.result` @202331200 — HeadlessCloudDialogs wrap. */
export const DEVICE_MCP_CONSENT_RESULTS = ['allow', 'deny', 'not_now'] as const
/** densable `Cgt.default` @202331200 */
export const DEVICE_MCP_CONSENT_DEFAULT = 'not_now' as const
/** densable `Cgt.hideWhile` @202331193 */
export const DEVICE_MCP_CONSENT_HIDE_WHILE: readonly never[] = []

const DEVICE_MCP_NOT_ASKED = { kind: 'not_asked' as const }

/**
 * densable `_g` wrap: `settings.read` only. No `settings.set`.
 */
function readDeviceMcpSettings(): Record<string, unknown> {
  return getSettings_DEPRECATED() as Record<string, unknown>
}

/** densable `eBe` @200425760 — MCP list for device-bridge purpose. */
async function resolveDeviceMcpOffered(
  storageV5?: unknown,
): Promise<Array<[string, DeviceMcpOfferedConfig]>> {
  void storageV5
  void readDeviceMcpSettings()
  const { servers } = await getClaudeCodeMcpConfigs()
  return Object.entries(servers).filter(([name, config]) =>
    isDeviceMcpOfferable(name, config),
  )
}

/**
 * densable `Y` / `askHostDeviceMcpConsent` @211896000 export / Yo @202435689.
 * No dialogs / gate off → not asked → Yo maps to `'settled'`.
 * deny+write fail → `refusal_unsaved`. Writes only via seams (no settings.set).
 */
export async function askHostDeviceMcpConsent(opts: {
  dialogs?: HeadlessCloudDialogs
  storageV5?: unknown
  signal?: AbortSignal
  snapshot?: ReturnType<typeof deviceMcpConsentSnapshot>
  seams?: {
    gateOn?: () => Promise<boolean>
    servingOn?: () => boolean
    egressDenied?: () => boolean
    readSnapshot?: () => Promise<DeviceMcpToolSnapshot>
    readConsent?: () => Promise<
      'unset' | 'accepted' | 'declined' | 'unreadable'
    >
    resolveConfigs?: () => Promise<Record<string, DeviceMcpOfferedConfig>>
    machineName?: () => string
    writeSnapshot?: (next: {
      servers: Record<string, 'declined' | Record<string, unknown>>
      withheld: Record<string, DeviceMcpWithheldDiff>
    }) => Promise<boolean>
    writeConsent?: (choice: 'accepted' | 'declined') => Promise<boolean>
  }
}): Promise<'settled' | 'refusal_unsaved'> {
  let e: { kind: 'not_asked' } | { kind: 'asked'; refusalUnsaved: boolean } =
    DEVICE_MCP_NOT_ASKED
  const mapOutcome = () =>
    e.kind === 'asked' && e.refusalUnsaved ? 'refusal_unsaved' : 'settled'
  try {
    const g = opts.dialogs
    if (
      g === undefined ||
      !(await (opts.seams?.gateOn ?? hostedServeDialogsGateOn)().catch(
        () => false,
      )) ||
      !(opts.seams?.servingOn ?? (() => true))() ||
      (
        opts.seams?.egressDenied ??
        (() =>
          isEssentialTrafficOnly() || getAPIProvider() !== 'firstParty')
      )()
    ) {
      return mapOutcome()
    }
    const u =
      opts.seams?.readSnapshot ??
      (async () => {
        void readDeviceMcpSettings()
        return { servers: {}, withheld: {} } as DeviceMcpToolSnapshot
      })
    const b =
      opts.seams?.readConsent ??
      (async () => {
        void readDeviceMcpSettings()
        return 'unset' as const
      })
    const C = await b()
    if (C === 'declined' || C === 'unreadable') return mapOutcome()
    const w = await u()
    const s =
      C === 'unset'
        ? undefined
        : w === 'unreadable'
          ? {}
          : pickDeviceMcpWithheldDiffs(w.withheld)
    if (s !== undefined && Object.keys(s).length === 0) return mapOutcome()
    const A =
      opts.seams?.resolveConfigs !== undefined
        ? await opts.seams.resolveConfigs()
        : Object.fromEntries(await resolveDeviceMcpOffered(opts.storageV5))
    const M = Object.entries(A).filter(([n, O]) => isDeviceMcpOfferable(n, O))
    const v = M.map(([n]) => n).filter(
      n => s === undefined || Object.hasOwn(s, n),
    )
    if (v.length === 0) return mapOutcome()
    const H = s === undefined ? 'first' : 'reconsent'
    const a = (n: string) => {
      logEvent('tengu_device_mcp_host_consent', {
        action: n as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        mode: H as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        server_count: v.length,
      })
    }
    if (!g.kinds.has(DEVICE_MCP_CONSENT_KIND)) {
      a('unsupported_surface')
      return mapOutcome()
    }
    const k =
      opts.snapshot !== undefined
        ? opts.snapshot
        : deviceMcpConsentSnapshot({
            machineName: (
              opts.seams?.machineName ??
              (() => presentableDeviceMcpName(hostname()))
            )(),
            offered: M,
            snapshot: w,
            ...(s !== undefined && { withheld: s }),
            diffNamesCap: DEVICE_MCP_DIFF_NAMES_CAP,
          })
    if (k === null) {
      a('not_presentable')
      logEvent('tengu_feature_bad', {
        feature_name:
          'device_mcp_host_consent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'not_presentable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return mapOutcome()
    }
    a('shown')
    e = { kind: 'asked', refusalUnsaved: false }
    const { answer: S, answered: j } = await g.request(
      {
        kind: DEVICE_MCP_CONSENT_KIND,
        result: DEVICE_MCP_CONSENT_RESULTS,
        default: DEVICE_MCP_CONSENT_DEFAULT,
      },
      k,
      { signal: opts.signal },
    )
    if (!j) {
      a('unanswered')
      logEvent('tengu_feature_bad', {
        feature_name:
          'device_mcp_host_consent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'unanswered' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return mapOutcome()
    }
    if (S === 'not_now') {
      a('not_now')
      logEvent('tengu_feature_ok', {
        feature_name:
          'device_mcp_host_consent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return mapOutcome()
    }
    const f = S === 'allow' ? 'accepted' : 'declined'
    e = { kind: 'asked', refusalUnsaved: f === 'declined' }
    const o = await (s === undefined ? b() : u())
    if (o === 'unreadable' || (f === 'accepted' && o === 'declined')) {
      a(o === 'unreadable' ? 'not_saved' : 'superseded')
      logEvent('tengu_feature_bad', {
        feature_name:
          'device_mcp_host_consent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code: (o === 'unreadable'
          ? 'not_saved'
          : 'superseded') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return mapOutcome()
    }
    const D =
      f === 'declined' || typeof o !== 'object'
        ? v
        : v.filter(
            n =>
              s !== undefined &&
              Object.hasOwn(o.withheld ?? {}, n) &&
              isDeepStrictEqual(o.withheld?.[n], s[n]) &&
              o.servers[n] !== 'declined',
          )
    if (o === f || D.length === 0) {
      e = { kind: 'asked', refusalUnsaved: false }
      a('superseded')
      logEvent('tengu_feature_ok', {
        feature_name:
          'device_mcp_host_consent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return mapOutcome()
    }
    const y = () => {
      if (typeof o === 'object') {
        const n: Record<string, 'declined' | Record<string, unknown>> = {
          ...o.servers,
        }
        for (const name of D) {
          if (f === 'accepted') delete n[name]
          else n[name] = 'declined'
        }
        return (opts.seams?.writeSnapshot ?? (async () => false))({
          servers: n,
          withheld: {},
        })
      }
      return (opts.seams?.writeConsent ?? (async () => false))(f)
    }
    if (!((await y()) || (f === 'declined' && (await y())))) {
      a('not_saved')
      logEvent('tengu_feature_bad', {
        feature_name:
          'device_mcp_host_consent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'not_saved' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      logForDebugging(
        f === 'declined'
          ? '[headlessCloud] device-MCP refusal not saved; this computer offers none of its MCP servers for this attach'
          : '[headlessCloud] device-MCP answer not saved; asked again at the next attach',
        { level: 'warn' },
      )
      return mapOutcome()
    }
    e = { kind: 'asked', refusalUnsaved: false }
    a(S === 'allow' ? 'allowed' : 'denied')
    logEvent('tengu_feature_ok', {
      feature_name:
        'device_mcp_host_consent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return mapOutcome()
  } catch (u) {
    if (isAbortError(u)) {
      logForDebugging(
        `[headlessCloud] device-MCP question abandoned: ${errorMessage(u)}`,
      )
    } else {
      logEvent('tengu_feature_bad', {
        feature_name:
          'device_mcp_host_consent' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      logForDebugging(
        `[headlessCloud] device-MCP question failed: ${errorMessage(u)}`,
      )
    }
    return mapOutcome()
  }
}

const BOUND_CREATE_KEEP_SUBTYPES = new Set([
  'set_permission_mode',
  'set_mcp_permission_mode_override',
  'set_max_thinking_tokens',
  'mcp_toggle',
])

/** densable `J` @179762360 — control_request subtype on a create event. */
function boundCreateControlSubtype(event: {
  data?: { type?: string; request?: { subtype?: string } }
}): string | undefined {
  const n = event.data?.request
  return event.data?.type === 'control_request' &&
    typeof n?.subtype === 'string'
    ? n.subtype
    : undefined
}

/** densable `K` @179762400 — event kept on bound create. */
export function isBoundCreateKeptEvent(event: {
  data?: { type?: string; request?: { subtype?: string } }
}): boolean {
  if (event.data?.type === 'user') return true
  const n = boundCreateControlSubtype(event)
  return n !== undefined && BOUND_CREATE_KEEP_SUBTYPES.has(n)
}

/**
 * densable `Fnn` @179762510 — bound-create body extras.
 * Throws if bound and events > 16. Does not invent a signature.
 */
export function boundCreateSessionBody(opts: {
  deviceBinding?: {
    deviceUUID: string
    kid: string
    signature: string
    issuedAt: string
  }
  events?: Array<{ data: { type?: string; request?: { subtype?: string } } }>
  environmentVariables?: Record<string, string>
  title?: string
  requestElevatedTier?: boolean
  repositoriesTrusted?: boolean
  deferFirstPrompt?: boolean
}): Record<string, unknown> {
  const n = opts.deviceBinding
  const events = opts.events ?? []
  const o = n
    ? events.filter(
        r =>
          isBoundCreateKeptEvent(r) &&
          !(opts.deferFirstPrompt && r.data?.type === 'user'),
      )
    : events
  if (n && o.length > BOUND_CREATE_MAX_EVENTS) {
    throw new Error(
      `session create allows at most ${BOUND_CREATE_MAX_EVENTS} initial events, got ${o.length}`,
    )
  }
  const s = n ? {} : (opts.environmentVariables ?? {})
  return {
    ...(opts.title && { title: opts.title }),
    events: o.map(r => ({ payload: r.data })),
    ...(Object.keys(s).length > 0 && { environment_variables: s }),
    ...(n && {
      target_device_id: n.deviceUUID,
      bind_attestation: { kid: n.kid, signature: n.signature },
      bind_attestation_issued_at: n.issuedAt,
      ...(opts.requestElevatedTier && { security_tier: 'elevated' }),
      ...(opts.repositoriesTrusted && { repositories_trusted: true }),
    }),
  }
}

/** densable `xbo` @179761980 — redact bind signature for logs. */
export function redactBindAttestation<
  T extends { bind_attestation?: { signature?: string } },
>(e: T): T {
  const n = e.bind_attestation
  if (!n) return e
  return { ...e, bind_attestation: { ...n, signature: '<redacted>' } }
}

type BoundCreateAsk =
  | { kind: 'off' }
  | { kind: 'no_token' }
  | { kind: 'ask'; proofHeaders?: Record<string, string> }

type BoundCreateTrust =
  | { kind: 'off' }
  | { kind: 'send'; proofHeaders?: Record<string, string> }
  | { kind: 'not_sent'; why?: string }

function boundCreateResponseStatus(r: unknown): number | undefined {
  if (typeof r === 'object' && r !== null && 'status' in r) {
    const s = (r as { status: unknown }).status
    if (typeof s === 'number') return s
  }
}

function boundCreateRefusalLabel(r: unknown): string {
  if (typeof r === 'object' && r !== null && 'data' in r) {
    const data = (r as { data: unknown }).data
    if (typeof data === 'object' && data !== null && 'error' in data) {
      const reason = (data as { error?: { reason?: unknown } }).error?.reason
      if (typeof reason === 'string' && reason.length > 0) return reason
    }
  }
  return 'refused'
}

/**
 * densable `nzt` @185905017 — attested create POST after QGt prep.
 * Wrap: JGt + elevated-ask 4xx retry. No reregister / Far key store.
 */
async function nzt<T>(
  e: {
    buildBody: (attestation?: unknown, repositoriesTrusted?: boolean) => unknown
    post: (body: unknown, headers?: Record<string, string>) => Promise<T>
    dropRepositoriesTrustedOn4xx?: boolean
  },
  r: {
    ask: BoundCreateAsk
    trust: BoundCreateTrust
    firstPromptDeferred: boolean
    attestation: unknown
  },
): Promise<{
  response: T
  bind: { ok: true }
  attested: true
  firstPromptDeferred: boolean
}> {
  const { ask: s, trust: g, firstPromptDeferred: h, attestation: b } = r
  const D: { refusal?: string } = {}
  const throughJGt =
    g.kind === 'send' || e.dropRepositoriesTrustedOn4xx === true
  const postOnce = (
    trusted: boolean | undefined,
    headers?: Record<string, string>,
  ) => e.post(e.buildBody(b, trusted), headers)
  const viaJGt = (headers: Record<string, string> | undefined) =>
    postCreateDropRepositoriesTrusted(
      (trusted, hdrs) =>
        postOnce(trusted, hdrs) as Promise<
          T & { status: number; data?: unknown }
        >,
      headers,
      { kind: 'send' },
      D,
    ) as Promise<T>
  const askHeaders = s.kind === 'ask' ? s.proofHeaders : undefined
  let F = throughJGt
    ? await viaJGt(askHeaders)
    : await postOnce(undefined, askHeaders)
  const status = boundCreateResponseStatus(F)
  if (
    s.kind === 'ask' &&
    status !== undefined &&
    status >= 400 &&
    status < 500
  ) {
    const W = boundCreateRefusalLabel(F)
    logForDebugging(
      `[deviceBind] the create that asked for the elevated tier got ${status} (${W}); repeating the bound create without the ask`,
    )
    F = throughJGt
      ? await viaJGt(undefined)
      : await postOnce(undefined, undefined)
  }
  return {
    response: F,
    bind: { ok: true },
    attested: true,
    firstPromptDeferred: h,
  }
}

/**
 * densable `QGt` @185903716 — bound create POST wrap.
 * No key.sign → post unsigned (`bind: sign` fail path).
 */
export async function postBoundCreateSession<T>(opts: {
  prepared?:
    | { ok: true; value: { sign: () => Promise<unknown> } }
    | { ok: false }
  buildBody: (attestation?: unknown, repositoriesTrusted?: boolean) => unknown
  post: (body: unknown, headers?: Record<string, string>) => Promise<T>
  dropRepositoriesTrustedOn4xx?: boolean
  firstPromptDeferred?: boolean
  callerSendsFirstPrompt?: boolean
  drops?: { envVars?: boolean; events?: string[] }
  ask?: BoundCreateAsk
  trust?: BoundCreateTrust
}): Promise<{
  response: T
  bind: { ok: true } | { ok: false; error?: string } | undefined
  attested: boolean
  firstPromptDeferred: boolean
}> {
  if (!opts.prepared?.ok) {
    return {
      response: await opts.post(opts.buildBody(undefined)),
      bind: opts.prepared,
      attested: false,
      firstPromptDeferred: false,
    }
  }
  const w = await opts.prepared.value.sign()
  if (!w) {
    logForDebugging('[deviceBind] bound create unsigned: sign returned empty')
    return {
      response: await opts.post(opts.buildBody(undefined)),
      bind: { ok: false, error: 'sign' },
      attested: false,
      firstPromptDeferred: false,
    }
  }
  const s = opts.drops ?? { envVars: false, events: [] as string[] }
  const droppedEvents = s.events ?? []
  logEvent('tengu_device_bind_prepared', {
    dropped_env_vars: Boolean(s.envVars) as never,
    dropped_events: droppedEvents.length as never,
  })
  const D = [...(s.envVars ? ['environment_variables'] : []), ...droppedEvents]
  if (D.length > 0) {
    // biome-ignore format: gold QGt @185903716 source-locks D.join(", ")
    logForDebugging(`[deviceBind] bound create dropped ${D.join(", ")}`)
  }
  const ask = opts.ask ?? { kind: 'off' as const }
  const firstPromptDeferred = Boolean(
    opts.firstPromptDeferred ??
      (opts.callerSendsFirstPrompt === true && ask.kind !== 'off'),
  )
  if (firstPromptDeferred) {
    logForDebugging(
      '[deviceBind] bound create leaves the first prompt out: this client sends it signed once the permission mode it pushes has been stored',
    )
  }
  const q = opts.trust ?? { kind: 'off' as const }
  if (q.kind === 'not_sent') {
    logForDebugging(
      `[deviceBind] bound create goes without repositories_trusted (${q.why})`,
    )
  }
  return nzt(opts, {
    ask,
    trust: q,
    firstPromptDeferred,
    attestation: w,
  })
}

const REPO_TRUST_TAG_TRUSTED = 'config:repo-trusted'
const REPO_TRUST_TAG_NONE = 'config:no-git-repo'
const REPO_TRUST_TAG_DECLINED = 'config:repo-trust-declined'
/** densable `g` @200266839 */
export const REPO_TRUST_POLL_MS = 30000
const REQUEST_COMPUTER_FOLDER = 'request_computer_folder'
/** densable f7r — `repository_trust_required` | declined | unavailable */
const REPO_TRUST_TOOL_ERROR_RE = new RegExp(
  `^(?:<tool_use_error>)?\\s*${REQUEST_COMPUTER_FOLDER}: \\[repository_trust_(required|declined|unavailable)\\]`,
)

export type RepositoryTrustState =
  | 'trusted'
  | 'no_repository'
  | 'declined'
  | 'not_marked'

export type RepositoryTrustToolError = 'required' | 'declined' | 'unavailable'

/** densable `S`/`Ztr` @200266163 */
export function repositoryTrustFromTags(tags: unknown): RepositoryTrustState {
  const t = new Set(
    Array.isArray(tags)
      ? tags.filter((r): r is string => typeof r === 'string')
      : [],
  )
  if (t.has(REPO_TRUST_TAG_TRUSTED)) return 'trusted'
  if (t.has(REPO_TRUST_TAG_NONE)) return 'no_repository'
  return t.has(REPO_TRUST_TAG_DECLINED) ? 'declined' : 'not_marked'
}

/** densable `Ztr` @200266163 — `S(session.tags)`. */
export function repositoryTrustFromSession(session: {
  tags?: unknown
  session_context?: { tags?: unknown }
}): RepositoryTrustState {
  return repositoryTrustFromTags(session.tags ?? session.session_context?.tags)
}

/** densable `u7r` @200266196 */
export function repositoryTrustNeedsDecision(
  state: RepositoryTrustState,
): boolean {
  return state === 'not_marked' || state === 'declined'
}

/** densable `mVt` @200266252 */
export function repositoryTrustVisible(
  state: RepositoryTrustState,
  showNotMarked: boolean,
): RepositoryTrustState | undefined {
  return state === 'not_marked' && !showNotMarked ? undefined : state
}

/**
 * densable `An` @202438808 — `e===void 0?void 0:mVt(e.current(),Kle())`.
 * `Kle()` = trusted-device policy enforced (`isTrustedDeviceActiveForOrg`).
 */
export function repositoryTrustFromPoll(
  poll: { current: () => RepositoryTrustState | undefined } | undefined,
): RepositoryTrustState | undefined {
  if (poll === undefined) return undefined
  const state = poll.current()
  return state === undefined
    ? undefined
    : repositoryTrustVisible(state, isTrustedDeviceActiveForOrg())
}

/** densable `f7r` @200266544 — parse `repository_trust_required|declined|unavailable`. */
export function parseRepositoryTrustToolError(
  text: string,
): RepositoryTrustToolError | undefined {
  const n = REPO_TRUST_TOOL_ERROR_RE.exec(text)?.[1]
  return n === 'required' || n === 'declined' || n === 'unavailable'
    ? n
    : undefined
}

/**
 * densable `g7r` @200266839 — coalesced poll. Wrap: one in-flight, 30s reuse.
 */
export function coalescedSessionPoll<T>(opts: {
  read: () => Promise<T>
  initial?: Promise<T>
  now?: () => number
}): {
  current: () => T | undefined
  refresh: (force?: { force?: boolean }) => Promise<T | undefined>
  onChanged: (cb: () => void) => () => void
} {
  const now = opts.now ?? Date.now
  let o: T | undefined
  let n: number | undefined
  let s: Promise<T | undefined> | undefined
  const listeners = new Set<() => void>()
  const run = (i: Promise<T>): Promise<T | undefined> => {
    const d = i
      .then(
        l => {
          n = now()
          if (l !== o) {
            o = l
            for (const cb of listeners) cb()
          }
          return l
        },
        () => {
          n = now()
          return o
        },
      )
      .then(v => {
        if (s === d) s = undefined
        return v
      })
    s = d
    return d
  }
  const f = () => run(Promise.resolve().then(opts.read))
  if (opts.initial !== undefined) void run(opts.initial)
  return {
    current: () => o,
    refresh: i => {
      if (s !== undefined) {
        if (i?.force !== true) return s
        return s.then(() => f())
      }
      if (
        i?.force !== true &&
        n !== undefined &&
        now() - n < REPO_TRUST_POLL_MS
      ) {
        return Promise.resolve(o)
      }
      return f()
    },
    onChanged: cb => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}

/**
 * densable `ht` @202413000 — remoteFileMode. Catch → `"unspecified"`.
 */
export async function remoteFileMode(
  gitRoot?: string,
  lookup?: (root?: string) => Promise<string>,
): Promise<string> {
  try {
    if (gitRoot === undefined && lookup === undefined) return 'unspecified'
    return await (lookup ?? (async () => 'unspecified'))(gitRoot)
  } catch {
    return 'unspecified'
  }
}

export const DIR_SYNC_NOT_SEEDED =
  'File sync is not running for this session here: this process did not seed it from this checkout, so it has nothing to keep in sync'

export const DIR_SYNC_CUT_SHORT =
  'File sync setup was interrupted: the cloud session starts without your local changes; they go up when you next open this session from this directory.'

export const DIR_SYNC_CUT_BEFORE_ARMED =
  'File sync setup was interrupted before it began: the cloud session starts without your local changes and will not sync with this directory. Start a new cloud session here to sync.'

export const DIR_SYNC_LOOKUP_FAILED_LINE =
  "File sync is not on for this session here: this machine could not check whether it set the session's sync up."

export const DIR_SYNC_NOT_ARMED_LINE =
  'File sync is not on for this session from this directory: the session was not seeded and armed here.'

/** densable `yn` @202414080 */
export function dirSyncState(opts: {
  dirSync?: { sync: { state: () => Record<string, unknown> } }
  fileMode?: string
}): Record<string, unknown> {
  if (opts.dirSync !== undefined) return opts.dirSync.sync.state()
  return opts.fileMode === 'container_sync'
    ? { state: 'off', reason: 'not_seeded', message: DIR_SYNC_NOT_SEEDED }
    : { state: 'off', reason: 'not_opted_in' }
}

/** densable `mt` @202414430 */
export function dirSyncArmedExtras(
  e: Record<string, unknown>,
): Record<string, unknown> {
  if (e.state !== 'armed') return {}
  return {
    ...(e.firstUpload != null && { first_upload: e.firstUpload }),
    ...(e.syncedFiles != null && { synced_files: e.syncedFiles }),
    ...(e.writerElsewhere === true && { other_window: true }),
    ...(e.muted === true && { muted: true }),
    ...(e.direction !== undefined &&
      e.direction !== 'pending' && { direction: e.direction }),
  }
}

/** densable `He` @202414262 */
export function directorySyncEnvelope(opts: {
  dirSync?: {
    sync: { state: () => Record<string, unknown> }
    createFacts?: { origin?: string }
  }
  fileMode: string
}): Record<string, unknown> {
  const s = dirSyncState(opts)
  return {
    state: s.state,
    ...('reason' in s && s.reason !== undefined && { reason: s.reason }),
    ...('message' in s && s.message !== undefined && { message: s.message }),
    ...dirSyncArmedExtras(s),
    ...(opts.dirSync?.createFacts?.origin === 'upload' && {
      started_from_upload: true,
    }),
    file_mode: opts.fileMode,
    file_mode_source: 'stored',
  }
}

export type DirSyncPendingSeed = {
  state: () => 'started' | 'done' | 'cut' | 'arming' | string
  completion: Promise<unknown>
  cutShortLine?: string
  cutBeforeArmedLine?: string
}

const pendingDirSyncSeeds = new Map<string, DirSyncPendingSeed>()

export function takePendingDirSyncSeed(
  sessionId: string,
): DirSyncPendingSeed | null {
  const h = pendingDirSyncSeeds.get(sessionId) ?? null
  if (h) pendingDirSyncSeeds.delete(sessionId)
  return h
}

export function notePendingDirSyncSeed(
  sessionId: string,
  seed: DirSyncPendingSeed,
): void {
  pendingDirSyncSeeds.set(sessionId, seed)
}

/** densable `wn` @202414900 */
export const DIR_SYNC_SEED_WAIT_MS = 5000

/**
 * densable `_n` @202413423 — wait for pending dir-sync seed at exit.
 * No engine → takePendingSeed null → return.
 */
export async function waitDirSyncSeedAtExit(
  sessionId: string,
  abort: AbortController,
  timeoutMs = DIR_SYNC_SEED_WAIT_MS,
  seams?: { takePendingSeed?: (id: string) => DirSyncPendingSeed | null },
): Promise<HeadlessCloudNotice | undefined> {
  const h = (seams?.takePendingSeed ?? takePendingDirSyncSeed)(sessionId)
  if (h === null) return
  const g = h.state()
  if (g !== 'started' && g !== 'done') abort.abort()
  let v = false
  try {
    v = await Promise.race([
      h.completion.then(() => true),
      sleep(timeoutMs).then(() => false),
    ])
  } catch {
    v = false
  }
  switch (h.state()) {
    case 'started':
      if (!v) {
        logForDebugging(
          `[headlessCloud] the directory-sync seed was still uploading after ${timeoutMs}ms; cancelling it`,
        )
      }
      abort.abort()
      return {
        level: 'warning',
        text: h.cutShortLine ?? DIR_SYNC_CUT_SHORT,
      }
    case 'cut':
      logEvent('tengu_feature_bad', {
        feature_name:
          'ccr_dir_sync_seed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'cut_at_exit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return {
        level: 'warning',
        text: h.cutShortLine ?? DIR_SYNC_CUT_SHORT,
      }
    case 'done':
      return
    default:
      if (g !== 'arming') return
      logEvent('tengu_feature_bad', {
        feature_name:
          'ccr_dir_sync_seed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'cut_at_exit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return {
        level: 'warning',
        text: h.cutBeforeArmedLine ?? DIR_SYNC_CUT_BEFORE_ARMED,
      }
  }
}

/** gold `Z` @196039748 — `engine.line` for `created_empty_unfilled`. */
export const DIR_SYNC_CREATED_EMPTY_UNFILLED_LINE =
  "This cloud session was created empty and never received this project directory's files, so messages from here are kept on this machine, not sent to it. Start a new cloud session from this directory."

/** gold `OCo` @182124584 — `engine.line` for `engine_declined`. */
export const DIR_SYNC_ENGINE_DECLINED_LINE =
  'File sync is switched off on this machine by CLAUDE_CODE_DIR_SYNC_ENGINE, so this session does not sync here now; unset it and open the session again to resume.'

/** gold `N0t` @182124391 — `engine.line` for `engine_unsupported`. */
export const DIR_SYNC_ENGINE_UNSUPPORTED_LINE =
  'File sync is off for this session here: its local record was written by a sync engine this version of Claude Code does not have. Start a new cloud session from this directory to sync it.'

/** gold `Me` attach `ccr_dir_sync_pull` reasons — no FS engine takes these paths. */
export const CCR_DIR_SYNC_PULL_ATTACH_CREATED_EMPTY_UNFILLED =
  'attach_created_empty_unfilled'
export const CCR_DIR_SYNC_PULL_ATTACH_ENGINE_DECLINED = 'attach_engine_declined'
export const CCR_DIR_SYNC_PULL_ATTACH_ENGINE_UNSUPPORTED =
  'attach_engine_unsupported'
export const CCR_DIR_SYNC_PULL_ATTACH_FOLDER_RECORD_UNREADABLE =
  'attach_folder_record_unreadable'

export type LaptopDirSyncStoppedReason =
  | 'created_empty_unfilled'
  | 'engine_declined'
  | 'engine_unsupported'
  | 'arm_failed'
  | 'store_unreadable'

export type LaptopDirSyncAttachHandle = {
  sessionId: string
  gitRoot: string
  boundToThisMachine: Promise<boolean>
  createFacts: undefined
  engine: {
    kind: 'stopped'
    reason: LaptopDirSyncStoppedReason
    line: string
    level?: 'info'
  }
}

function logCcrDirSyncPull(
  reason: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
): void {
  logEvent('ccr_dir_sync_pull', { reason })
}

/**
 * gold `Me` @196043887 `attachLaptopDirSyncSession`.
 * gold `es()` off → return; no git root → return; `j4(D)!=="container_sync"` → return.
 * No FS engine: `container_sync` → gold `$Ce()` false `R(...)` stopped
 * `engine_declined` (`OCo`), not silent undefined. KEEP: no amati, no fake bind.
 */
export async function attachLaptopDirSyncSession(opts: {
  sessionId: string
  boundToThisMachine: boolean | Promise<boolean>
  woodOn?: boolean
  cwd?: string
  fileMode?: string
  remoteFileMode?: (gitRoot?: string) => Promise<string>
}): Promise<LaptopDirSyncAttachHandle | undefined> {
  // gold `es()` @180782505
  if (!(opts.woodOn ?? isViolinWoodEnabledSync())) return
  const launchFolder = opts.cwd ?? getOriginalCwd()
  const gitRoot = findGitRoot(launchFolder)
  if (gitRoot === null) return
  const fileMode =
    opts.fileMode ?? (await remoteFileMode(gitRoot, opts.remoteFileMode))
  if (fileMode !== 'container_sync') return
  logCcrDirSyncPull(
    CCR_DIR_SYNC_PULL_ATTACH_ENGINE_DECLINED as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  )
  void opts.boundToThisMachine
  return {
    sessionId: opts.sessionId,
    gitRoot,
    boundToThisMachine: Promise.resolve(false),
    createFacts: undefined,
    engine: {
      kind: 'stopped',
      reason: 'engine_declined',
      line: DIR_SYNC_ENGINE_DECLINED_LINE,
      level: 'info',
    },
  }
}

export const LATEST_EVENTS_PAGE = 5

/**
 * densable `PJ`/`hPe` wrap on poll host.
 * Gold hits `/events` desc; local uses `pollRemoteSessionEvents`.
 */
export type LatestCloudEventsPage = {
  events: Array<{ sequenceNum?: number; payload?: unknown }>
  newestSequenceNum?: number
  hasMore?: boolean
  droppedRows?: number
  lastEventId: string | null
}

/**
 * densable `hPe` wrap on poll host — do not copy PJ compositor.
 * Gold `hPe(e,1,{reportFeatureHealth:!1})`; local uses `pollRemoteSessionEvents`.
 */
export async function fetchLatestCloudEvents(
  sessionId: string,
  limit = LATEST_EVENTS_PAGE,
  opts?: { reportFeatureHealth?: boolean },
): Promise<LatestCloudEventsPage | null> {
  try {
    const page = await pollRemoteSessionEvents(sessionId, null, {
      skipMetadata: true,
    })
    const events = page.newEvents.slice(-limit).map((payload, i, arr) => {
      const fromEnd = arr.length - 1 - i
      const seq =
        page.lastEventId !== null && Number.isFinite(Number(page.lastEventId))
          ? Number(page.lastEventId) - fromEnd
          : undefined
      return { sequenceNum: seq, payload }
    })
    const newest =
      page.lastEventId !== null && Number.isFinite(Number(page.lastEventId))
        ? Number(page.lastEventId)
        : events.at(-1)?.sequenceNum
    return {
      events,
      newestSequenceNum: newest,
      lastEventId: page.lastEventId,
    }
  } catch {
    if (opts?.reportFeatureHealth !== false) {
      logEvent('tengu_feature_bad', {
        feature_name:
          'assistant_history_load' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'http_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    return null
  }
}

/**
 * densable `Cn` @202441657 — `hPe(e,1)`. Throw `the session history`.
 */
export async function newestCloudEventSequence(
  sessionId: string,
  fetchPage: typeof fetchLatestCloudEvents = fetchLatestCloudEvents,
): Promise<number> {
  const n = await fetchPage(sessionId, 1, {
    reportFeatureHealth: false,
  })
  if (n === null) throw new Error('the session history could not be read')
  const s = n.newestSequenceNum ?? n.events.at(-1)?.sequenceNum
  if (s) return s
  if (n.events.length > 0 || n.hasMore || (n.droppedRows ?? 0) > 0) {
    throw new Error('the newest event could not be read')
  }
  return 0
}

/**
 * densable `createServingReadiness` wrap — already-ready latch for xgt.
 */
export function createServingReadiness(): {
  whenReady: () => Promise<void>
  ready: () => void
} {
  let resolve: () => void = () => {}
  const p = new Promise<void>(r => {
    resolve = r
  })
  let done = false
  return {
    whenReady: () => p,
    ready: () => {
      if (done) return
      done = true
      resolve()
    },
  }
}

/**
 * densable `JGt` @185904619 — drop `repositories_trusted` after 4xx and retry.
 */
export async function postCreateDropRepositoriesTrusted<
  T extends { status: number; data?: unknown },
>(
  post: (trusted: boolean, headers?: Record<string, string>) => Promise<T>,
  headers: Record<string, string> | undefined,
  trust: { kind: string },
  refusal: { refusal?: string },
): Promise<T> {
  if (trust.kind !== 'send' || refusal.refusal !== undefined) {
    return post(false, headers)
  }
  const h = await post(true, headers)
  if (h.status < 400 || h.status >= 500) return h
  const b =
    typeof h.data === 'object' && h.data !== null && 'error' in h.data
      ? String(
          (h.data as { error?: { reason?: string } }).error?.reason ??
            'unnamed',
        )
      : 'unnamed'
  if (b === 'unnamed' && headers !== undefined) return h
  refusal.refusal = b
  logForDebugging(
    `[deviceBind] the create that carried repositories_trusted got ${h.status} (${b}); repeating it without the field`,
  )
  return post(false, headers)
}

const DEVICE_BRIDGE_SKIPPED_EGRESS =
  '[deviceBridge] skipped: non-essential egress disabled, non-first-party provider, or remote sessions policy-denied'

const DEVICE_BRIDGE_SKIPPED_TRUSTED =
  '[deviceBridge] skipped: the bridge cannot check a device proof and trusted devices are required or unknown'

const DEVICE_BRIDGE_GATE_OFF = '[deviceBridge] stopping: the gate turned off'

type DeviceBridgeBindAccount =
  | { status: 'missing' }
  | { status: 'mismatch' }
  | { status: 'resolved'; accountUuid: string; source: 'stored' | 'env' }

function defaultDeviceBridgeBindAccount(): DeviceBridgeBindAccount {
  return resolveBindAccount({
    storedAccountUuid: getOauthAccountInfo()?.accountUuid,
    hostAccountUuid: process.env.CLAUDE_CODE_ACCOUNT_UUID,
  })
}

/**
 * densable `xgt` @200247956 skip-path wrap — no laptop compositor / device-key.
 * Gold: !Wd → false; !Moe log; bridge+tMr log; no org/account
 * `tengu_device_bridge_skipped`; start `account_source`; stop/mute/gate_off.
 */
export function startLaptopRegistration(opts: {
  sessionId: string
  deviceId?: string
  transport?: 'bridge' | 'auto'
  isEnabled?: () => Promise<boolean>
  isEgressAllowed?: () => boolean
  isBridgeRefused?: () => boolean
  orgUuid?: string
  getAccount?: () => Promise<DeviceBridgeBindAccount>
  isMuted?: () => boolean
  isStillEnabled?: () => boolean
}): { started: Promise<boolean>; stop: (reason?: string) => Promise<void> } {
  let r = false
  let E = false
  const n = opts.transport ?? 'auto'
  const started = (async () => {
    const readiness = createServingReadiness()
    readiness.ready()
    const waitStarted = performance.now()
    await readiness.whenReady()
    const U = Math.round(performance.now() - waitStarted)
    const V = await (opts.isEnabled ?? isViolinWoodEnabled)().catch(() => false)
    if (!V) return false
    const T = opts.isEgressAllowed ?? isCloudEgressAllowed
    if (!T()) {
      logForDebugging(DEVICE_BRIDGE_SKIPPED_EGRESS)
      return false
    }
    if (r) return false
    if (
      n === 'bridge' &&
      (opts.isBridgeRefused ?? isTrustedDeviceActiveForOrg)()
    ) {
      logForDebugging(DEVICE_BRIDGE_SKIPPED_TRUSTED)
      noteBridgeTrustedDevicesRequired()
      return false
    }
    const A = await (
      opts.getAccount ?? (async () => defaultDeviceBridgeBindAccount())
    )()
    const I = opts.orgUuid ?? getOauthAccountInfo()?.organizationUuid
    if (!I || A.status !== 'resolved') {
      logEvent('tengu_device_bridge_skipped', {
        missing_org: (I === undefined) as never,
        missing_account: (A.status === 'missing') as never,
        account_mismatch: (A.status === 'mismatch') as never,
      })
      logForDebugging(
        `[deviceBridge] skipped: ${I ? `account ${A.status}` : 'no org'}`,
      )
      return false
    }
    let re = false
    const L = (opts.isMuted ?? (() => false))()
    if (L !== re) {
      re = L
      logForDebugging(
        `[deviceBridge] serving ${L ? 'muted' : 'unmuted'} by the emergency switch`,
      )
      logEvent('tengu_device_bridge_muted', { muted: L as never })
    }
    const be = opts.isStillEnabled ?? (() => isViolinWoodEnabledSync())
    if (!be()) {
      logForDebugging(DEVICE_BRIDGE_GATE_OFF)
      return false
    }
    if (r) return false
    E = true
    // gold i("tengu_device_bridge_started", {account_source, transport, redial, readiness_wait_ms})
    logDeviceBridgeStarted({
      account_source: A.source,
      transport: n,
      redial: false,
      readiness_wait_ms: U,
    })
    return true
  })()
  return {
    started,
    stop: async (reason?: string) => {
      r = true
      if (E) {
        logEvent('tengu_device_bridge_stopped', {
          reason: (reason ??
            'stop') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
    },
  }
}

const DEVICE_BRIDGE_DID_NOT_START =
  'the device bridge did not start (gate off or account not fully configured); the session stays bound without laptop tools'

/**
 * densable `Vo` @202432032 — laptop device-bridge wrap via `mn`/`xgt`/`ht`.
 */
export async function startLaptopDeviceBridge(opts: {
  sessionId: string
  deviceId?: string
  dirSync?: unknown
  started?: boolean
  remoteFileMode?: (gitRoot?: string) => Promise<string>
  deviceDisplayName?: () => string
}): Promise<{
  fileMode: string
  displayName: string
  started: boolean
  stop: (reason?: string) => Promise<void>
}> {
  const fileMode = await (opts.remoteFileMode ?? remoteFileMode)()
  const displayName = (opts.deviceDisplayName ?? cloudDeviceDisplayName)()
  const registration = startLaptopRegistration({
    sessionId: opts.sessionId,
    deviceId: opts.deviceId,
  })
  const started =
    opts.started === true || (await registration.started.catch(() => false))
  if (!started) {
    logForDebugging(`[headlessCloud] ${DEVICE_BRIDGE_DID_NOT_START}`)
  }
  logEvent('tengu_remote_headless_laptop_linked', {
    sync_state:
      'off' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    file_mode:
      fileMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    has_dir_sync: (opts.dirSync !== undefined) as never,
  })
  void opts.deviceId
  return { fileMode, displayName, started, stop: registration.stop }
}

/** densable `Jo` @202438808 */
export const DIR_SYNC_ELSEWHERE_LINE =
  "File sync for this session was set up from another directory on this machine: edits here are not uploaded, and Claude's changes are not written here."

export type DirSyncLookup =
  | { handle: { sync: { state: () => Record<string, unknown> } } }
  | {
      handle: undefined
      why:
        | 'lookup_failed'
        | 'elsewhere'
        | 'not_armed_here'
        | 'elsewhere_unknown'
        | 'not_looked'
    }

/**
 * densable `ei` @202439251 — lookup_failed / elsewhere / not_armed_here.
 */
export function dirSyncLookupState(
  e: DirSyncLookup,
  n?: string,
): Record<string, unknown> {
  if (e.handle === undefined) {
    switch (e.why) {
      case 'lookup_failed':
        return {
          state: 'off',
          reason: 'lookup_failed',
          message: DIR_SYNC_LOOKUP_FAILED_LINE,
        }
      case 'elsewhere':
        return {
          state: 'off',
          reason: 'seeded_elsewhere',
          message: DIR_SYNC_ELSEWHERE_LINE,
        }
      case 'not_armed_here':
      case 'elsewhere_unknown':
      case 'not_looked':
        return n === 'container_sync'
          ? {
              state: 'off',
              reason: 'not_seeded',
              message: DIR_SYNC_NOT_ARMED_LINE,
            }
          : { state: 'off', reason: 'not_opted_in' }
    }
  }
  const s = e.handle.sync.state()
  return {
    state: s.state,
    ...('reason' in s && { reason: s.reason }),
    ...('message' in s && { message: s.message }),
    ...dirSyncArmedExtras(s),
  }
}

/**
 * densable `oi` @202440611 — attach dir-sync lookup wrap.
 * Wood off / no host → `not_looked`. Me handle → `{handle}`.
 * Wood+host and Me undefined → `lookup_failed` (no FS engine).
 */
export async function attachDirSyncLookup(opts: {
  sessionId: string
  boundToThisMachine: boolean | Promise<boolean>
  sessionHost?: unknown
  woodOn?: boolean
}): Promise<
  | { handle: unknown; why?: undefined }
  | {
      handle: undefined
      why:
        | 'not_looked'
        | 'elsewhere'
        | 'elsewhere_unknown'
        | 'lookup_failed'
        | 'not_armed_here'
      line?: string
    }
> {
  const wood = opts.woodOn ?? isViolinWoodEnabledSync()
  if (!wood || opts.sessionHost === undefined) {
    return { handle: undefined, why: 'not_looked' }
  }
  const attached = await attachLaptopDirSyncSession({
    sessionId: opts.sessionId,
    boundToThisMachine: opts.boundToThisMachine,
    woodOn: wood,
  })
  if (attached !== undefined) return { handle: attached }
  logForDebugging(
    `[headlessCloud] directory-sync lookup failed: no laptop dir-sync engine`,
    { level: 'warn' },
  )
  void opts.boundToThisMachine
  return { handle: undefined, why: 'lookup_failed' }
}

/** densable `ii` @202441900 */
export const HEADLESS_CLOUD_STREAM_POSITION_RETRY_MS = 500

/**
 * densable `Tn`/`Cn` @202441256 — stream position from poll host.
 * Gold retries once after 500ms; wrap uses `pollRemoteSessionEvents` lastEventId.
 */
export async function readCloudStreamPosition(
  sessionId: string,
  opts?: { latestSequenceNum?: number; positionRetryMs?: number },
): Promise<number> {
  if (opts?.latestSequenceNum !== undefined) return opts.latestSequenceNum
  const retryMs =
    opts?.positionRetryMs ?? HEADLESS_CLOUD_STREAM_POSITION_RETRY_MS
  const read = async (): Promise<number> => {
    const page = await pollRemoteSessionEvents(sessionId, null, {
      skipMetadata: true,
    })
    const last = page.lastEventId
    if (last !== null && last !== undefined && last !== '') {
      const n = Number(last)
      if (Number.isFinite(n)) return n
    }
    if (page.newEvents.length > 0) {
      throw new Error('the newest event could not be read')
    }
    return 0
  }
  try {
    return await read()
  } catch (err) {
    logForDebugging(
      `[headlessCloud] stream position unreadable, retrying once: ${errorMessage(err)}`,
    )
    await sleep(retryMs)
    return read()
  }
}

type CloudTurnEvent = {
  source?: string
  payload?: { type?: string; parent_tool_use_id?: string }
}

/** densable `Ko` @202431620 */
export function classifyCloudTurnEvents(
  events: CloudTurnEvent[],
): 'over' | 'under_way' | undefined {
  for (const n of [...events].reverse()) {
    if (n.payload?.parent_tool_use_id) continue
    if (n.source === 'worker') {
      if (n.payload?.type === 'result') return 'over'
      if (n.payload?.type === 'assistant') return 'under_way'
    } else if (n.payload?.type === 'user') {
      return 'under_way'
    }
  }
  return undefined
}

/** densable `vn=50` / `Uo=5` @202415600 */
const CLOUD_TURN_PAGE = 50
const CLOUD_TURN_PAGES = 5

/**
 * densable `$o` @202431372 — turn-in-flight. Wrap: poll pages, Ko on payloads.
 */
export async function cloudTurnInFlight(
  sessionId: string,
): Promise<boolean | undefined> {
  try {
    let cursor: string | null = null
    for (let h = 1; h <= CLOUD_TURN_PAGES; h += 1) {
      const page = await pollRemoteSessionEvents(sessionId, cursor, {
        skipMetadata: true,
      })
      const events: CloudTurnEvent[] = page.newEvents.map(ev => ({
        source: 'worker',
        payload: ev as { type?: string; parent_tool_use_id?: string },
      }))
      const g = classifyCloudTurnEvents(events)
      if (g !== undefined) return g === 'under_way'
      if (!page.lastEventId || page.newEvents.length < CLOUD_TURN_PAGE) return
      cursor = page.lastEventId
    }
    return
  } catch {
    return
  }
}

/**
 * densable `TXn` @202294745 — registerDevice after bound.
 * No xgt compositor: logs gold strings, no-ops stop.
 */
export function registerAttachDevice(opts: {
  sessionId: string
  binding: Promise<AttachDeviceBinding>
}): {
  stop: () => Promise<void>
  notice: Promise<string | undefined>
} {
  let d = false
  const notice = opts.binding.then(
    n => {
      if (d || n.status !== 'bound') return
      return undefined
    },
    n => {
      logForDebugging(
        `[deviceBind] attach binding failed unexpectedly: ${errorMessage(n)}`,
      )
      return undefined
    },
  )
  void opts.sessionId
  return {
    notice,
    stop: async () => {
      d = true
    },
  }
}

/** densable `vjt` @191774191 */
export function cloudSessionEnvelope(opts: {
  sessionId: string
  viewUrl: string
  device: unknown
  directorySync: unknown
  repositoryTrust?: unknown
}): {
  id: string
  view_url: string
  device: unknown
  directory_sync: unknown
  client_version: 1
  repository_trust?: unknown
} {
  return {
    id: formatCloudSessionId(opts.sessionId),
    view_url: opts.viewUrl.slice(0, 200),
    device: opts.device,
    directory_sync: opts.directorySync,
    client_version: 1,
    ...(opts.repositoryTrust !== undefined && {
      repository_trust: opts.repositoryTrust,
    }),
  }
}

/**
 * densable `rXe` @200268932 — repository-trust poll when S9 (wood∧bridgepin).
 */
export function startRepositoryTrustPoll(opts: {
  sessionId: string
  enabled?: boolean
}):
  | {
      current: () => unknown
      refresh: (force?: { force?: boolean }) => Promise<unknown>
      stop: () => void
    }
  | undefined {
  if (!(opts.enabled ?? isRepositoryTrustPollEnabled())) return
  const poll = coalescedSessionPoll({
    read: async () => {
      const s = await fetchSession(opts.sessionId)
      return repositoryTrustFromSession(s)
    },
  })
  void poll.refresh()
  return {
    current: poll.current,
    refresh: poll.refresh,
    stop: () => undefined,
  }
}

export function mergeOpenedCloudSessionNotices<
  T extends { kind: string; notices?: HeadlessCloudNotice[] },
>(
  opened: T,
  report: {
    notices: HeadlessCloudNotice[]
    entries: HeadlessCloudNotApplied[]
  },
): T {
  if (opened.kind !== 'opened' || report.entries.length === 0) return opened
  return {
    ...opened,
    notices: [...(opened.notices ?? []), ...report.notices],
  }
}

/**
 * densable `si` @202440350 — wrap `getCutoffDate`. Missing host / throw → unknown.
 */
export async function retentionCutoffSweep(): Promise<
  { kind: 'never' } | { kind: 'unknown' } | { kind: 'before'; before: Date }
> {
  try {
    const host = (await import('../utils/cleanup.js')) as {
      getCutoffDate?: () => Date | null
      getRetentionCutoff?: () => Date | null
    }
    const e = host.getCutoffDate ?? host.getRetentionCutoff
    if (e === undefined) return { kind: 'unknown' }
    const n = e()
    return n === null ? { kind: 'never' } : { kind: 'before', before: n }
  } catch (err) {
    logForDebugging(
      `[headlessCloud] retention cutoff unreadable: ${errorMessage(err)}`,
      { level: 'warn' },
    )
    return { kind: 'unknown' }
  }
}

/** densable `Qn` @202312108 */
export function separateCopyCutoffAllows(
  createdAt: string,
  sweep:
    | { kind: 'never' }
    | { kind: 'unknown' }
    | { kind: 'before'; before: Date },
): boolean {
  switch (sweep.kind) {
    case 'never':
      return true
    case 'unknown':
      return false
    case 'before': {
      const s = Date.parse(createdAt)
      return Number.isFinite(s) && s - 86400000 > sweep.before.getTime()
    }
  }
}

/** densable `At` @202312176 */
export function dirSyncNotArmedHere(opts: { ownRecord?: boolean }): {
  handle: undefined
  why: 'not_armed_here'
  noRecordOnThisMachine?: true
} {
  return {
    handle: undefined,
    why: 'not_armed_here',
    ...(opts.ownRecord !== true && { noRecordOnThisMachine: true as const }),
  }
}

/** densable `Mt` @202312065 — serveOnly `separate_copy`. */
export function serveOnlySeparateCopy(opts: {
  serveOnly: boolean
  lookup: { handle?: unknown; why?: string; noRecordOnThisMachine?: boolean }
  sessionBefore?: { boundDeviceId?: string; createdAt: string }
  sweep:
    | { kind: 'never' }
    | { kind: 'unknown' }
    | { kind: 'before'; before: Date }
}): 'separate_copy' | undefined {
  return opts.serveOnly &&
    opts.lookup.handle === undefined &&
    opts.lookup.why === 'not_armed_here' &&
    opts.lookup.noRecordOnThisMachine === true &&
    opts.sessionBefore !== undefined &&
    opts.sessionBefore.boundDeviceId === undefined &&
    separateCopyCutoffAllows(opts.sessionBefore.createdAt, opts.sweep)
    ? 'separate_copy'
    : undefined
}

/** densable `Moe` @196051102 — HIPAA / non-firstParty / org policy. */
export function isCloudEgressAllowed(): boolean {
  return cloudEgressDenyReason() === undefined
}

/** densable `sZe` @196051134 */
export function cloudEgressDenyReason(): 'egress' | 'policy_org' | undefined {
  if (isEssentialTrafficOnly() || getAPIProvider() !== 'firstParty') {
    return 'egress'
  }
  // Product-cut: policy limits always allow remote sessions.
  return undefined
}

/** densable `RJ` @191773300 — `cse_` → `session_`, clip 128. */
export function formatCloudSessionId(sessionId: string): string {
  return toCompatSessionId(sessionId).slice(0, 128)
}

/** densable `Go` @202431901 — bare create needs a prompt. */
export function cloudBarePromptPresent(
  prompt: string | ReadonlyArray<{ type?: string; text?: unknown }>,
): boolean {
  if (typeof prompt === 'string') return prompt.trim() !== ''
  return prompt.some(
    n =>
      n.type !== 'text' || (typeof n.text === 'string' && n.text.trim() !== ''),
  )
}

/** gold `_kr` wrap — Yo linkPreparationOverlapOn. */
export function isLinkPreparationOverlapOn(): boolean {
  return isViolinBassbarEnabledSync()
}

/**
 * densable `qt` @202326531 — bare create teleport payload.
 * `staysAttached:!1` (EVo/zo staysAttached:!0 is `headlessCloudTeleportPayload`).
 */
export function headlessCloudBareTeleportPayload(args: {
  prompt: string
  promptUuid: string
  currentBranch?: string
  poolOnBranch?: string | null
  poolRef?: string | null
  title?: string
  permissionMode?: PermissionMode
  model?: string
}): {
  initialMessage: string
  initialMessageUuid: string
  source: 'remote'
  branchName: string | undefined
  branchFromHead: boolean
  title: string | undefined
  reuseOutcomeBranch: string | undefined
  explicitRef: string | undefined
  permissionMode: PermissionMode | undefined
  model: string | undefined
  allowBundle: true
  staysAttached: false
} {
  const n = args.poolOnBranch ?? args.poolRef ?? undefined
  return {
    initialMessage: args.prompt,
    initialMessageUuid: args.promptUuid,
    source: 'remote',
    branchName: (n ?? args.currentBranch) || undefined,
    branchFromHead: n === undefined,
    title: args.title,
    reuseOutcomeBranch: args.poolOnBranch ?? undefined,
    explicitRef: n,
    permissionMode: args.permissionMode,
    model: args.model,
    allowBundle: true,
    staysAttached: false,
  }
}

export type AttachDeviceBinding =
  | { status: 'disabled' }
  | { status: 'not_applicable' }
  | { status: 'created_unbound'; reason: string }
  | { status: 'bound'; deviceId: string }
  | { status: 'unbound'; reason: string }

/** densable `CVo` @202293200 */
export function sessionBindingSnapshot(session: {
  session_status: string
  bound_device_uuid?: string
}): { archived: boolean; boundDeviceId: string | undefined } {
  return {
    archived: session.session_status === 'archived',
    boundDeviceId: session.bound_device_uuid,
  }
}

/** densable `bge` @182146003 */
export const DEVICE_BIND_REASON_LINE: Record<string, string> = {
  egress: 'device traffic is disallowed here, or that check failed',
  account: 'no stored claude.ai login on this machine (run /login)',
  session_unreadable:
    'the session could not be read to check its binding (re-attach to retry)',
  other_device:
    'this session is bound to another device (a different machine or config directory)',
  session_unbound: 'this session was created without a device binding',
  device_tools_off: 'device tools are switched off for this client',
  trusted_devices_off:
    'trusted devices are not switched on for this account, so this machine has no device token to bind with',
}

export function deviceBindReasonLine(reason: string): string {
  return DEVICE_BIND_REASON_LINE[reason] ?? reason
}

/** densable `psn` @182145563 */
export function createdUnboundReasonLine(reason: string): string {
  return reason === 'trusted_devices_off'
    ? `This session began unbound (no sync-back or local commands): ${deviceBindReasonLine(reason)}`
    : `Start a new session to attach this machine; this one began unbound (no sync-back or local commands): ${deviceBindReasonLine(reason)}`
}

/**
 * densable `ti` @202439753 — bind status map bound/not_applicable/created_unbound.
 */
export function attachBindingKind(
  e: AttachDeviceBinding,
): 'bound' | 'none' | 'unknown' | 'elsewhere' {
  switch (e.status) {
    case 'bound':
      return 'bound'
    case 'not_applicable':
    case 'created_unbound':
      return 'none'
    case 'unbound':
      return e.reason === 'session_unreadable' ? 'unknown' : 'elsewhere'
    case 'disabled':
      return 'unknown'
  }
}

/**
 * densable `De` @202440286 — `{status:"unbound", reason, message}`.
 */
export function unboundDeviceEnvelope(reason: string): {
  status: 'unbound'
  reason: string
  message: string
} {
  return {
    status: 'unbound',
    reason,
    message: deviceBindReasonLine(reason),
  }
}

/**
 * densable `ni` @202439974 — `{status, device_id}`.
 */
export function attachBindingEnvelope(
  e: AttachDeviceBinding,
):
  | { status: 'bound'; device_id: string }
  | { status: 'unbound'; reason: string; message: string } {
  switch (e.status) {
    case 'bound':
      return { status: 'bound', device_id: e.deviceId }
    case 'unbound':
      return unboundDeviceEnvelope(e.reason)
    case 'created_unbound':
      return {
        status: 'unbound',
        reason: 'session_unbound',
        message: createdUnboundReasonLine(e.reason),
      }
    case 'not_applicable':
      return unboundDeviceEnvelope('session_unbound')
    case 'disabled':
      return unboundDeviceEnvelope('device_tools_off')
  }
}

/** densable `w_n` @202293280 */
export function isAttachBound(
  binding: Promise<AttachDeviceBinding>,
): Promise<boolean> {
  return binding.then(
    o => o.status === 'bound',
    () => false,
  )
}

/**
 * densable `kXn` @202292639 — attach resolveBinding.
 * No local device-key id (`oZe`) → `no_device_here` unless seams inject one.
 */
export async function resolveAttachDeviceBinding(opts: {
  sessionId: string
  session: Promise<{ archived: boolean; boundDeviceId?: string }>
  isEnabled?: () => Promise<boolean>
  isEgressAllowed?: () => boolean
  getAccount?: () => Promise<
    | { status: 'missing' }
    | { status: 'mismatch' }
    | { status: 'resolved'; accountUuid: string; source: 'stored' | 'env' }
  >
  readLocalDeviceId?: (accountUuid: string) => Promise<string | undefined>
  readUnboundCreateReason?: (sessionId: string) => Promise<string | undefined>
}): Promise<AttachDeviceBinding> {
  const o = opts.session.then(
    r => ({ read: true as const, session: r }),
    r => ({ read: false as const, error: r }),
  )
  if (!(await (opts.isEnabled ?? isViolinWoodEnabled)().catch(() => false))) {
    return { status: 'disabled' }
  }
  const d = await o
  if (!d.read) return { status: 'unbound', reason: 'session_unreadable' }
  if (d.session.archived) return { status: 'disabled' }
  if (d.session.boundDeviceId === undefined) {
    const r = await (opts.readUnboundCreateReason ?? (async () => undefined))(
      opts.sessionId,
    ).catch(() => undefined)
    logEvent('tengu_device_bind_attach', {
      outcome:
        'session_unbound' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      created_here: (r !== undefined) as never,
    })
    return r === undefined
      ? { status: 'not_applicable' }
      : { status: 'created_unbound', reason: r }
  }
  let s: boolean
  try {
    s = (opts.isEgressAllowed ?? isCloudEgressAllowed)()
  } catch {
    s = false
  }
  if (!s) return { status: 'unbound', reason: 'egress' }
  const n = await (
    opts.getAccount ??
    (async () =>
      resolveBindAccount({
        storedAccountUuid: getOauthAccountInfo()?.accountUuid,
        hostAccountUuid: process.env.CLAUDE_CODE_ACCOUNT_UUID,
      }))
  )()
  if (n.status === 'missing') return { status: 'unbound', reason: 'account' }
  if (n.status === 'mismatch') {
    return { status: 'unbound', reason: 'account_mismatch' }
  }
  const a = await (opts.readLocalDeviceId ?? (accountUuid => oZe(accountUuid)))(
    n.accountUuid,
  ).then(
    r => ({ read: true as const, deviceId: r?.toLowerCase() }),
    r => ({ read: false as const, error: r }),
  )
  if (!a.read) return { status: 'unbound', reason: 'local_device_unreadable' }
  if (a.deviceId === undefined) {
    return { status: 'unbound', reason: 'no_device_here' }
  }
  if (a.deviceId !== d.session.boundDeviceId.toLowerCase()) {
    return { status: 'unbound', reason: 'other_device' }
  }
  logEvent('tengu_device_bind_attach', {
    outcome:
      'bound' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return { status: 'bound', deviceId: a.deviceId }
}

type CloudSettingsBag = {
  permissions?: { defaultMode?: string }
}

/**
 * densable `Pe` @179172928 — settings defaultMode when claimable.
 */
export function settingsDefaultPermissionMode(
  settings: CloudSettingsBag,
): PermissionMode | undefined {
  const raw = settings.permissions?.defaultMode
  if (raw == null) return
  const n = parseHeadlessCloudPermissionMode(raw === 'manual' ? 'default' : raw)
  if (n == null) return
  return n
}

/**
 * densable `ocn` @179173067.
 */
export function considerSettingsPermissionMode(opts: {
  gateOn: boolean
  permissionModeTyped: boolean
  dangerouslySkipPermissions?: boolean
  scrubbed?: boolean
  settings: CloudSettingsBag
}): {
  considered: boolean
  settingsDefaultModePresent: boolean
  settingsDefault: PermissionMode | undefined
  permissionMode: PermissionMode | undefined
} {
  const l =
    !opts.permissionModeTyped &&
    !opts.dangerouslySkipPermissions &&
    !opts.scrubbed
  const m = l ? settingsDefaultPermissionMode(opts.settings) : undefined
  return {
    considered: opts.gateOn && l,
    settingsDefaultModePresent: opts.settings.permissions?.defaultMode != null,
    settingsDefault: m,
    permissionMode: opts.gateOn ? m : undefined,
  }
}

/**
 * densable `bjt` @191881566 — 283 body is `action:"none"`.
 */
export function decideHeadlessCloudPermissionMode(opts: {
  explicitMode?: PermissionMode
  droppedMode?: boolean
  pinnedDefault?: boolean
  settingsMode?: PermissionMode
  settingsModeForwardable?: boolean
}): { permissionMode: PermissionMode | undefined; action: 'none' } {
  const r = opts.droppedMode === true
  const i = opts.explicitMode
  const d = opts.pinnedDefault === true
  const a = opts.settingsMode
  const l = opts.settingsModeForwardable === true
  const h = !r && (i === undefined || (d && i === 'default'))
  return {
    permissionMode: h ? (l ? a : undefined) : i,
    action: 'none',
  }
}

export type HeadlessCloudModelGate = {
  model: string
  explicitMode: PermissionMode | undefined
  decision: { permissionMode: PermissionMode | undefined; action: 'none' }
}

/**
 * densable `$e` @202325567.
 */
export function headlessCloudModelGate(
  args: {
    permissionModeCli?: string
    forwardHomeSettings?: boolean
    homeSettingsConsent?: 'forward' | null
    effectiveModel?: string
  },
  opts: {
    settingsToCloudEnabled: boolean
    settings: CloudSettingsBag
    hostFillsDefault: boolean
  },
): HeadlessCloudModelGate {
  const g =
    opts.settingsToCloudEnabled &&
    args.forwardHomeSettings !== false &&
    (args.homeSettingsConsent ?? storedHomeSettingsConsent()) === 'forward'
  const v = considerSettingsPermissionMode({
    gateOn: g,
    permissionModeTyped: args.permissionModeCli !== undefined,
    dangerouslySkipPermissions: false,
    scrubbed: isSubprocessEnvScrubEnabled(),
    settings: opts.settings,
  })
  const w = args.effectiveModel ?? getMainLoopModel()
  const E = parseHeadlessCloudPermissionMode(args.permissionModeCli)
  const D = decideHeadlessCloudPermissionMode({
    explicitMode: E,
    droppedMode: args.permissionModeCli !== undefined && E === undefined,
    pinnedDefault:
      opts.hostFillsDefault && args.permissionModeCli !== 'default',
    settingsMode: v.settingsDefault,
    settingsModeForwardable: g,
  })
  return { model: w, explicitMode: E, decision: D }
}

/**
 * densable `SB` @180782560 — `Wd()&&u()`; `u` is `tengu_violin_strad`.
 */
export async function settingsToCloudEnabled(): Promise<boolean> {
  return isSettingsToCloudEnabled()
}

export type DirSyncConsentNotice = {
  level: 'notice'
  text: string
}

/**
 * densable `on` @202404312 — dir-sync consent. No dialogs → [].
 */
export async function promptDirSyncConsent(opts: {
  dialogs?: HeadlessCloudDialogs
  explicitRef?: { revision: string; flag: string }
  storageV5?: unknown
  signal?: AbortSignal
  seams?: {
    flagOn?: () => Promise<boolean>
  }
}): Promise<DirSyncConsentNotice[]> {
  const surface =
    'sdk_host' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  try {
    const flagOn = opts.seams?.flagOn ?? isViolinWoodEnabled
    if (opts.dialogs === undefined || !(await flagOn().catch(() => false))) {
      return []
    }
    if (!opts.dialogs.kinds.has(CLOUD_SYNC_CONSENT_KIND)) {
      logEvent('tengu_dir_sync_mode_prompt_skipped', {
        reason:
          'host_undeclared' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        surface,
      })
      return []
    }
    const copy = dirSyncConsentCopy({ folder: getOriginalCwd() })
    if (copy === null) {
      logEvent('tengu_dir_sync_mode_prompt_skipped', {
        reason:
          'unsendable_path' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        surface,
      })
      return []
    }
    const { answer, answered } = await opts.dialogs.request(
      {
        kind: CLOUD_SYNC_CONSENT_KIND,
        result: CLOUD_SYNC_CONSENT_RESULTS,
        default: CLOUD_SYNC_CONSENT_DEFAULT,
      },
      copy,
      { signal: opts.signal },
    )
    if (!answered) return []
    const mapped = answer === 'sync' ? 'container_sync' : answer
    logEvent('tengu_dir_sync_mode_prompt', {
      choice:
        mapped as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      surface,
    })
    return []
  } catch {
    return []
  }
}

/**
 * densable `rn` @202405874 — unattended serving consent. No dialogs → return.
 */
export async function promptUnattendedServingConsent(opts: {
  dialogs?: HeadlessCloudDialogs
  permissionMode?: PermissionMode
  signal?: AbortSignal
  seams?: {
    servingOn?: () => boolean
    gateOn?: () => Promise<boolean>
    forbiddenBySettings?: () => boolean
    readConsent?: () => Promise<'unset' | 'accepted' | 'declined'>
    writeConsent?: (choice: 'accepted' | 'declined') => Promise<boolean>
  }
}): Promise<void> {
  const surface =
    'desktop' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  const emit = (action: string) => {
    logEvent('tengu_served_unattended_consent', {
      action:
        action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      surface,
    })
  }
  try {
    const servingOn = opts.seams?.servingOn ?? (() => true)
    const gateOn = opts.seams?.gateOn ?? isViolinWoodEnabled
    const forbidden = opts.seams?.forbiddenBySettings ?? (() => false)
    if (
      opts.dialogs === undefined ||
      (opts.permissionMode !== 'auto' &&
        opts.permissionMode !== 'bypassPermissions') ||
      !servingOn() ||
      !(await gateOn().catch(() => false)) ||
      forbidden()
    ) {
      return
    }
    const stored = (await opts.seams?.readConsent?.()) ?? 'unset'
    if (stored !== 'unset') return
    if (!opts.dialogs.kinds.has(UNATTENDED_SERVING_CONSENT_KIND)) {
      emit('unsupported_surface')
      return
    }
    emit('shown')
    const { answer, answered } = await opts.dialogs.request(
      { kind: UNATTENDED_SERVING_CONSENT_KIND },
      unattendedServingConsentCopy(hostname()),
      { signal: opts.signal },
    )
    if (!answered || answer === 'not_now') {
      emit('not_now')
      return
    }
    const choice = answer === 'accept' ? 'accepted' : 'declined'
    emit(choice)
    const written = await opts.seams?.writeConsent?.(choice)
    if (written === false) {
      logForDebugging(
        '[headlessCloud] unattended-serving answer not saved; asked again next launch',
        { level: 'warn' },
      )
    }
  } catch (err) {
    logForDebugging(
      `[headlessCloud] unattended-serving question abandoned: ${errorMessage(err)}`,
    )
  }
}

export type HeadlessCloudSessionHost = {
  launchOptions: {
    mayForwardHomeSettings(): boolean
    homeSettingsHostConsent(): 'forward' | null
  }
  extensionsConfig: {
    allowedChannels(): unknown[]
  }
}

type HeadlessCloudRefuse = {
  kind: 'refused'
  code: string
  message: string
}

type HeadlessCloudReady = {
  kind: 'ready'
  input: AsyncIterable<string>
  policy: HeadlessCloudPolicy
}

type HeadlessCloudOpenerResult =
  | {
      kind: 'opened'
      sessionId: string
      bound?: boolean
      notices?: HeadlessCloudNotice[]
      openingRequests?: Array<{
        request: { subtype: 'set_permission_mode'; mode: PermissionMode }
        required: boolean
        describe: string
      }>
      folderRelation?: 'separate_copy'
    }
  | { kind: 'failed'; message: string }

export type HeadlessCloudHostResult = {
  message?: string
  exitCode: number
}

function formatHeadlessCloudList(names: string[]): string {
  if (names.length > HEADLESS_CLOUD_NOTICE_LIST_CAP) {
    return `${names.slice(0, HEADLESS_CLOUD_NOTICE_LIST_CAP).join(', ')} (and ${names.length - HEADLESS_CLOUD_NOTICE_LIST_CAP} more)`
  }
  return names.join(', ')
}

function printHeadlessCloudNotice(text: string): void {
  logForDebugging(`[headlessCloud] ${text}`)
  if (process.stderr.isTTY) {
    process.stderr.write(`${text}\n`)
  }
}

function writeHeadlessCloudError(message: string): void {
  process.stderr.write(`${message}\n`)
}

/** gold `S_n` — built-in tool names from the launch tool pool. */
export function registeredBuiltInToolNames(
  tools?: ReadonlyArray<{ name: string }>,
): string[] {
  return (tools ?? []).map(tool => tool.name)
}

/** gold `Qo` — host options forwarded at create, ignored on attach. */
export function headlessCloudIgnoredHostOptions(
  forwarded: HeadlessCloudForwarded,
  args: HeadlessCloudHostArgs,
  model: string | undefined,
): string[] {
  return (
    [
      ['appendSystemPrompt', forwarded.appendSystemPrompt],
      ['systemPrompt', forwarded.customSystemPrompt],
      ['appendSubagentSystemPrompt', forwarded.appendSubagentSystemPrompt],
      ['effort', forwarded.effort],
      ['fallbackModel', forwarded.fallbackModel],
      ['maxBudgetUsd', forwarded.maxBudgetUsd],
      ['allowedTools', forwarded.allowedTools?.length],
      ['thinking', forwarded.thinking],
      ['proactivity', forwarded.proactivityLevel],
      ['model', model],
      ['name', args.sessionNameArg],
    ] as Array<[string, unknown]>
  )
    .filter(([, value]) => Boolean(value))
    .map(([name]) => name)
}

/** gold `y_n` — not-applied notices for create vs attach. */
export function notAppliedReport(
  notApplied: HeadlessCloudNotApplied[],
  initialize: Record<string, unknown> | null,
  entry: 'create' | 'attach',
  honours: readonly string[],
): { notices: HeadlessCloudNotice[]; entries: HeadlessCloudNotApplied[] } {
  const keptOnAttach = new Set<string>(
    entry === 'attach' ? HEADLESS_CLOUD_CREATE_HONOURS : [],
  )
  const initializeIgnored: HeadlessCloudNotApplied[] =
    initialize === null
      ? []
      : classifyCloudInitializeOptions(
          initialize,
          'strict',
          new Set([...honours, 'supportedDialogKinds']),
        ).ignored.map(key => ({
          kind: keptOnAttach.has(key)
            ? ('kept' as const)
            : initializeFieldFate(key),
          name: `initialize.${key}`,
        }))
  const rank = { lost: 0, kept: 1, preference: 2 }
  const entries = [...notApplied, ...initializeIgnored].sort(
    (a, b) => rank[a.kind] - rank[b.kind],
  )
  const ofKind = (kind: HeadlessCloudNotApplied['kind']) =>
    entries.filter(entryRow => entryRow.kind === kind)
  const lost = ofKind('lost')
  const kept = ofKind('kept')
  const preference = ofKind('preference')
  const label = (row: HeadlessCloudNotApplied) =>
    row.kind === 'lost' && row.why !== undefined
      ? `${row.name} (${row.why})`
      : row.name
  const noticeText = [
    ...(kept.length > 0
      ? [
          `An existing cloud session keeps the configuration it was created with; not applied: ${formatHeadlessCloudList(kept.map(label))}.`,
        ]
      : []),
    ...(preference.length > 0
      ? [
          `Host options not applied to this cloud session (it runs with the cloud container's own configuration): ${formatHeadlessCloudList(preference.map(label))}.`,
        ]
      : []),
  ].join(' ')
  return {
    notices: [
      ...(lost.length > 0
        ? [
            {
              level: 'warning' as const,
              text: `Not applied to this cloud session, where the agent runs with the cloud container's own configuration: ${formatHeadlessCloudList(lost.map(label))}.`,
            },
          ]
        : []),
      ...(noticeText ? [{ level: 'notice' as const, text: noticeText }] : []),
    ],
    entries: entries.slice(0, HEADLESS_CLOUD_NOT_APPLIED_CAP),
  }
}

function collectForwarded(args: HeadlessCloudHostArgs): HeadlessCloudForwarded {
  return {
    ...(args.appendSystemPrompt !== undefined && {
      appendSystemPrompt: args.appendSystemPrompt,
    }),
    ...(args.systemPrompt !== undefined && {
      customSystemPrompt: args.systemPrompt,
    }),
    ...(args.appendSubagentSystemPrompt !== undefined && {
      appendSubagentSystemPrompt: args.appendSubagentSystemPrompt,
    }),
  }
}

/** densable `zGt` @185900700 — session_context extras gold Qre spreads. */
export function cloudSessionContextExtras(opts: {
  customSystemPrompt?: string
  maxBudgetUsd?: number
  allowedTools?: string[]
  disallowedTools?: string[]
}): Record<string, unknown> {
  return {
    ...(opts.customSystemPrompt && {
      custom_system_prompt: opts.customSystemPrompt,
    }),
    ...(opts.maxBudgetUsd !== undefined &&
      opts.maxBudgetUsd > 0 && { max_budget_usd: opts.maxBudgetUsd }),
    ...(opts.allowedTools &&
      opts.allowedTools.length > 0 && { allowed_tools: opts.allowedTools }),
    ...(opts.disallowedTools &&
      opts.disallowedTools.length > 0 && {
        disallowed_tools: opts.disallowedTools,
      }),
  }
}

function asStreamInput(
  input: string | AsyncIterable<string>,
): AsyncIterable<string> | null {
  if (typeof input === 'string') return null
  return input
}

/**
 * gold `Bo` @202419525 — qqr reject reason → refuse code.
 * No qqr engine; seam `argvPolicyReject` default undefined skips this map.
 */
export const HEADLESS_CLOUD_ARGV_POLICY_CODES = {
  bypass: 'rejected_argv',
  attach_restriction: 'rejected_tool_restriction',
  tool_restriction: 'rejected_tool_restriction',
  deny_rule_unclosed: 'deny_rule_unclosed',
  sdk_mcp: 'rejected_argv',
  unsupported: 'rejected_unsupported',
} as const

/**
 * leftover `b_n` @202419732 unique — gold `Tgt("policy_invalid")` when
 * `!r.valid && r.policyUnreadable`. Keep qqr seam; do not invent qqr engine.
 */
export const POLICY_INVALID_REASON = 'policy_invalid'

/** gold `b_n` qqr rejected branch — seam only; default undefined is skip. */
export function classifyHeadlessCloudArgvPolicy(
  reason?: HeadlessCloudArgvPolicyReason,
  message?: string,
): HeadlessCloudRefuse | undefined {
  if (reason === undefined) return undefined
  const code = HEADLESS_CLOUD_ARGV_POLICY_CODES[reason]
  return {
    kind: 'refused',
    code,
    message: message ?? `Error: ${code}`,
  }
}

/** gold `b_n` / `Wo` — org pin, remote policy, stream-json stdin. */
export async function refuseHeadlessCloudLaunch(
  args: HeadlessCloudHostArgs,
  _tools: ReadonlyArray<{ name: string }> | undefined,
  entry: 'create' | 'attach',
): Promise<HeadlessCloudRefuse | HeadlessCloudReady> {
  const org = await validateForceLoginOrg()
  if (!org.valid) {
    return { kind: 'refused', code: 'org_pin', message: org.message }
  }
  // Product-cut: policy limits always allow remote sessions.
  const argvReject = classifyHeadlessCloudArgvPolicy(
    args.argvPolicyReject,
    args.argvPolicyMessage,
  )
  if (argvReject) return argvReject
  const input = asStreamInput(args.inputPrompt)
  if (input === null) {
    return {
      kind: 'refused',
      code: 'no_stream_input',
      message: HEADLESS_CLOUD_STDIN_TTY_ERROR,
    }
  }
  const forwarded = collectForwarded(args)
  const ignored =
    entry === 'create'
      ? []
      : headlessCloudIgnoredHostOptions(forwarded, args, args.effectiveModel)
  return {
    kind: 'ready',
    input,
    policy: {
      notices: [],
      ignored,
      forwarded,
      notApplied: ignored.map(name => ({ kind: 'preference', name })),
    },
  }
}

/** gold `Dn` — wire LaunchOptions slots already on MAIN. */
export function headlessCloudFeatures(
  args: HeadlessCloudHostArgs,
  sessionHost: HeadlessCloudSessionHost,
): Array<Record<string, unknown>> {
  const launch = sessionHost.launchOptions
  const consent = args.homeSettingsConsent
  applyMayForwardHomeSettings(
    args.forwardHomeSettings ?? launch.mayForwardHomeSettings(),
  )
  applyHomeSettingsHostConsent(consent ?? null)
  return [
    {
      kind: 'forwardHomeSettings',
      forwardHomeSettings:
        args.forwardHomeSettings ?? launch.mayForwardHomeSettings(),
      ...(consent && { consentMode: consent }),
    },
    {
      kind: 'memory',
      sessionHost,
    },
    {
      kind: 'tools',
      getTools: () => args.tools ?? [],
    },
    {
      kind: 'channel',
      allowedChannels: sessionHost.extensionsConfig.allowedChannels(),
    },
  ]
}

/** gold `jo` — serve-only attach honours channel only. */
export function headlessCloudServeOnlyFeatures(): Array<
  Record<string, unknown>
> {
  return [{ kind: 'channel', controlOnly: true }]
}

function extractUserContent(message: StdinMessage | SDKMessage): string | null {
  if (!('type' in message) || message.type !== 'user') return null
  const bag = message as {
    content?: unknown
    message?: { content?: unknown }
  }
  const content = bag.message?.content ?? bag.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (
          block &&
          typeof block === 'object' &&
          'type' in block &&
          (block as { type: unknown }).type === 'text' &&
          'text' in block &&
          typeof (block as { text: unknown }).text === 'string'
        ) {
          return (block as { text: string }).text
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return null
}

async function drainHeadlessCloudStdout(io: StructuredIO): Promise<void> {
  for await (const frame of io.outbound) {
    writeToStdout(`${ndjsonSafeStringify(frame)}\n`)
  }
}

function enqueueControlSuccess(
  io: StructuredIO,
  requestId: string,
  extra?: Record<string, unknown>,
): void {
  io.outbound.enqueue({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: extra ?? {},
    },
  })
}

function enqueueControlError(
  io: StructuredIO,
  requestId: string,
  error: string,
  errorCode?: string,
): void {
  io.outbound.enqueue({
    type: 'control_response',
    response: {
      subtype: 'error',
      request_id: requestId,
      error,
      ...(errorCode !== undefined && { error_code: errorCode }),
    },
  })
}

/** densable `gn` @176416392 — tengu_feature_bad feature_name + error_code. leftover `Yo` compositor CALLs this. */
export function logRemoteHeadlessFeatureBad(
  errorCode: string,
  extra?: Record<string, string>,
): void {
  logEvent('tengu_feature_bad', {
    feature_name:
      'remote_headless_session' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code:
      errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(extra
      ? Object.fromEntries(
          Object.entries(extra).map(([k, v]) => [
            k,
            v as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ]),
        )
      : {}),
  })
}

/** densable `Ueo` @191132665 */
export function cloudInitializeSuccessEnvelope(
  account: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    commands: [],
    agents: [],
    output_style: 'default',
    available_output_styles: ['default'],
    models: [],
    account,
    pid: process.pid,
  }
}

/** densable `Ns` @202348499 */
export const HEADLESS_CLOUD_STALL_MS = 60_000
export const HEADLESS_CLOUD_STALL_WARNING =
  'Still waiting for the cloud session to start; what you sent will be delivered when it is ready.'
export const HEADLESS_CLOUD_WATCHDOG_WARNING =
  'Cloud session may be unresponsive. Attempting to reconnect…'

/**
 * densable `class st` @202335343 — hold worker frames until init (create).
 */
export class HeadlessCloudFrames {
  closed = false
  holdingForInit: boolean
  workerReady: boolean
  heldForInit: unknown[] = []
  /** gold `class st` @202335343 */
  peerFramesDroppedBeforeInitCount = 0
  peerHeldForInit = 0
  maxHeldForInit = 0
  turnCount = 0
  initCount = 0
  stamped: string
  entry: 'create' | 'attach'
  constructor(opts: {
    entry: 'create' | 'attach'
    sessionId: string
  }) {
    this.entry = opts.entry
    this.stamped = opts.sessionId
    this.workerReady = opts.entry === 'attach'
    this.holdingForInit = true
  }
  get stampedSessionId(): string {
    return this.stamped
  }
  /** gold `counts.peerFramesDroppedBeforeInit` aliases the Count field */
  get counts(): { peerFramesDroppedBeforeInit: number } {
    return {
      peerFramesDroppedBeforeInit: this.peerFramesDroppedBeforeInitCount,
    }
  }
  close(): void {
    this.closed = true
    this.heldForInit = []
  }
  releaseHeld(): unknown[] {
    this.holdingForInit = false
    const held = this.heldForInit
    this.heldForInit = []
    this.peerHeldForInit = 0
    return held
  }
  sanitize(event: Record<string, unknown>): Record<string, unknown> {
    return stripEdeDiagnosticErrors(stripCloudSessionKey(event))
  }
  handle(
    event: { type?: string; subtype?: string },
    source: 'worker' | 'host' = 'worker',
  ): 'drop' | 'hold' | 'emit' | 'init' {
    if (this.closed) return 'drop'
    if (event.type === 'system' && event.subtype === 'cloud_session_delta') {
      return 'drop'
    }
    if (event.type === 'system' && event.subtype === 'init') {
      this.initCount += 1
      this.workerReady = true
      return 'init'
    }
    if (event.type === 'result') this.turnCount += 1
    if (this.holdingForInit && source === 'host') {
      if (this.peerHeldForInit >= PEER_HELD_FOR_INIT_CAP) {
        notePeerFrameBeforeInit(this, {
          holdingForInit: true,
          dropped: true,
          held: false,
        })
        return 'drop'
      }
      notePeerFrameBeforeInit(this, {
        holdingForInit: true,
        dropped: false,
        held: true,
      })
      this.heldForInit.push(this.sanitize(event as Record<string, unknown>))
      return 'hold'
    }
    if (this.holdingForInit && source === 'worker' && event.type !== 'user') {
      if (this.entry === 'attach') {
        this.releaseHeld()
        return 'emit'
      }
      this.heldForInit.push(this.sanitize(event as Record<string, unknown>))
      return 'hold'
    }
    return 'emit'
  }
}

/**
 * densable `class ot` @202348530 — stall + response watchdog on CCR poll host.
 */
export class HeadlessCloudLiveness {
  compacting = false
  workerReady = false
  stopped = false
  watchdogFires = 0
  linesWritten = 0
  title: 'none' | 'skipped' | 'set' = 'none'
  lastLine: string | null = null
  cancelStall: (() => void) | null = null
  cancelWatchdog: (() => void) | null = null
  private stallTimer: ReturnType<typeof setTimeout> | null = null
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null
  constructor(
    readonly ports: {
      controlOnly: boolean
      queuedSendCount: () => number
      reconnect: () => void
      line: (level: 'notice' | 'warning', text: string) => void
    },
    readonly options: { titleFromFirstMessage: boolean },
  ) {}
  armStallWarning(): void {
    this.cancelStall?.()
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null
      this.cancelStall = null
      if (this.workerReady || this.stopped) return
      const queued = this.ports.queuedSendCount()
      if (queued === 0) {
        this.armStallWarning()
        return
      }
      logEvent('tengu_remote_headless_client_bootstrap_stalled', {
        queued: queued as never,
      })
      this.line('warning', HEADLESS_CLOUD_STALL_WARNING)
    }, HEADLESS_CLOUD_STALL_MS)
    this.cancelStall = () => {
      if (this.stallTimer) clearTimeout(this.stallTimer)
      this.stallTimer = null
    }
  }
  noteWorkerReady(): void {
    this.workerReady = true
    this.cancelStall?.()
    this.cancelStall = null
  }
  noteDelivered(content: unknown): void {
    this.maybeTitle(content)
  }
  noteSendOk({ afterStop }: { afterStop: boolean }): void {
    if (
      this.ports.controlOnly ||
      !this.workerReady ||
      this.stopped ||
      !afterStop
    ) {
      return
    }
    this.armWatchdog()
  }
  noteInbound(e: { type?: string; subtype?: string; status?: string }): void {
    this.clearWatchdog()
    if (e.type === 'system' && e.subtype === 'status') {
      this.compacting = e.status === 'compacting'
    } else if (
      e.type === 'result' ||
      (e.type === 'system' && e.subtype === 'compact_boundary')
    ) {
      this.compacting = false
    }
  }
  noteInterrupt(): void {
    this.clearWatchdog()
  }
  halt(): void {
    this.clearWatchdog()
    this.cancelStall?.()
    this.cancelStall = null
  }
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.halt()
  }
  armWatchdog(): void {
    this.clearWatchdog()
    const timeout = headlessCloudWatchdogMs(this.compacting)
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null
      this.cancelWatchdog = null
      if (this.stopped) return
      this.watchdogFires += 1
      logEvent('tengu_remote_headless_client_watchdog_fired', {
        timeout: (this.compacting
          ? 'compacting'
          : 'response') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      logForDebugging('[headlessCloudClient] response timeout; reconnecting')
      this.line('warning', HEADLESS_CLOUD_WATCHDOG_WARNING)
      this.ports.reconnect()
    }, timeout)
    this.cancelWatchdog = () => {
      if (this.watchdogTimer) clearTimeout(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }
  clearWatchdog(): void {
    this.cancelWatchdog?.()
    this.cancelWatchdog = null
  }
  maybeTitle(content: unknown): void {
    if (
      this.stopped ||
      !this.options.titleFromFirstMessage ||
      this.title !== 'none'
    ) {
      return
    }
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .flatMap(block =>
                typeof block === 'object' &&
                block !== null &&
                'type' in block &&
                (block as { type: unknown }).type === 'text' &&
                'text' in block &&
                typeof (block as { text: unknown }).text === 'string'
                  ? [(block as { text: string }).text]
                  : [],
              )
              .join('')
          : ''
    if (text.trim() !== '') this.title = 'set'
  }
  line(level: 'notice' | 'warning', text: string): void {
    this.linesWritten += 1
    this.lastLine = text
    this.ports.line(level, text)
  }
}

async function hostHeadlessCloudSession(opts: {
  input: AsyncIterable<string>
  replayUserMessages?: boolean
  includePartialMessages?: boolean
  sessionId: string
  notices: HeadlessCloudNotice[]
  notApplied: HeadlessCloudNotApplied[]
  serveOnly: boolean
  entry: 'create' | 'attach'
  openingRequests?: Array<{
    request: { subtype: 'set_permission_mode'; mode: PermissionMode }
    required: boolean
    describe: string
  }>
  sdkHost?: {
    frames: HeadlessCloudFrames | null
    liveness: HeadlessCloudLiveness | null
    outbound: HeadlessCloudOutbound | null
    features: HeadlessCloudFeatureHandles | null
    phase: 'pre_session' | 'live' | 'ending'
    connection: 'connecting' | 'live' | 'closed'
  }
}): Promise<HeadlessCloudHostResult> {
  const io = new StructuredIO(opts.input, opts.replayUserMessages)
  const outbound =
    opts.sdkHost?.outbound ??
    new HeadlessCloudOutbound(
      HEADLESS_CLOUD_QUEUE_CAP,
      Boolean(opts.replayUserMessages),
    )
  const features = opts.sdkHost?.features ?? new HeadlessCloudFeatureHandles()
  // densable `tn.installOAuthBridge` @202380172 — hut() ∧ Wmt(io.requestOAuthTokenRefresh)
  if (
    hasSdkOauthRefresh() &&
    SDK_OAUTH_REFRESH_ENTRYPOINTS.has(process.env.CLAUDE_CODE_ENTRYPOINT ?? '')
  ) {
    setSdkOauthTokenRefreshCallback(() => io.requestOAuthTokenRefresh())
  }
  const drain = drainHeadlessCloudStdout(io)
  let lastEventId: string | null = null
  let stop = false
  const pollAbort = new AbortController()
  let queuedSends = 0
  const frames = new HeadlessCloudFrames({
    entry: opts.entry,
    sessionId: opts.sessionId,
  })
  const liveness = new HeadlessCloudLiveness(
    {
      controlOnly: opts.serveOnly,
      queuedSendCount: () => queuedSends,
      reconnect: () => {
        lastEventId = null
      },
      line: (level, text) => {
        if (level === 'warning') {
          logForDebugging(`[headlessCloud] ${text}`, { level: 'warn' })
        } else {
          printHeadlessCloudNotice(text)
        }
      },
    },
    { titleFromFirstMessage: opts.entry === 'create' },
  )
  if (opts.sdkHost) {
    opts.sdkHost.frames = frames
    opts.sdkHost.liveness = liveness
    opts.sdkHost.outbound = outbound
    opts.sdkHost.features = features
    opts.sdkHost.phase = 'live'
    opts.sdkHost.connection = 'live'
  }
  liveness.armStallWarning()
  if (opts.entry === 'attach') liveness.noteWorkerReady()

  const emitWorkerEvent = (event: StdoutMessage): void => {
    const bag = event as { type?: string; subtype?: string }
    const action = frames.handle(bag, 'worker')
    liveness.noteInbound(bag)
    if (action === 'drop' || action === 'hold') return
    const sanitized = frames.sanitize(
      event as unknown as Record<string, unknown>,
    ) as StdoutMessage
    if (action === 'init') {
      liveness.noteWorkerReady()
      features.noteWorkerInit(sanitized)
      features.noteWorkerLive()
      io.outbound.enqueue(sanitized)
      for (const held of frames.releaseHeld()) {
        io.outbound.enqueue(held as StdoutMessage)
      }
      return
    }
    if (bag.type === 'result') {
      features.noteReply(sanitized)
      features.noteTurnEnded()
    }
    io.outbound.enqueue(sanitized)
  }

  const pollLoop = (async () => {
    while (!stop && !pollAbort.signal.aborted) {
      try {
        const page = await pollRemoteSessionEvents(
          opts.sessionId,
          lastEventId,
          { skipMetadata: true },
        )
        if (page.lastEventId) lastEventId = page.lastEventId
        for (const event of page.newEvents) {
          emitWorkerEvent(event as StdoutMessage)
        }
      } catch (error) {
        logForDebugging(`[headlessCloud] poll failed: ${errorMessage(error)}`)
      }
      await sleep(1000, pollAbort.signal)
    }
  })()

  try {
    for (const opening of opts.openingRequests ?? []) {
      await sendPayloadToRemoteSession(
        opts.sessionId,
        {
          type: 'control_request',
          request_id: `set-mode-${randomUUID()}`,
          request: opening.request,
        },
        '[headlessCloud openingPermissionMode]',
      )
    }
    for await (const message of io.structuredInput) {
      if (message.type === 'control_request') {
        const msg = message as unknown as {
          request_id: string
          request: Record<string, unknown> & {
            subtype?: string
            mode?: string
            settings?: unknown
          }
        }
        const subtype = msg.request.subtype
        // densable `Feo`/`D` @191125901 — host-originated control on a cloud session.
        const { route } = describeCloudHostedControlRoute(msg.request, {
          strict: true,
        })
        const routed = new HeadlessCloudHostRequests().handleControlRequest(
          msg.request,
          { strict: true },
        )
        if (route.kind === 'reject' || routed === 'rejected') {
          enqueueControlError(
            io,
            msg.request_id,
            route.kind === 'reject' ? route.error : CLOUD_HOSTED_NOT_SUPPORTED,
          )
          continue
        }
        if (subtype === 'initialize') {
          const classified = classifyCloudInitializeOptions(
            msg.request,
            'strict',
          )
          if (classified.outcome === 'reject') {
            enqueueControlError(io, msg.request_id, classified.error)
            continue
          }
          enqueueControlSuccess(io, msg.request_id, {
            ...cloudInitializeSuccessEnvelope({}),
            ...(classified.ignored.includes('hooks') && {
              hooks_applied: false,
            }),
            ...(classified.ignored.includes('plugins') && {
              plugins_applied: false,
            }),
            cloudSession: cloudSessionEnvelope({
              sessionId: opts.sessionId,
              viewUrl: cloudSessionViewUrl(opts.sessionId),
              device: { status: 'unbound' },
              directorySync: directorySyncEnvelope({
                fileMode: 'unspecified',
              }),
            }),
            not_applied: opts.notApplied.map(({ kind, name }) => ({
              name,
              kind,
            })),
          })
          logEvent('tengu_remote_headless_client_host_request', {
            subtype:
              'initialize' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            outcome:
              'local' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            ignored_count: classified.ignored.length as never,
          })
          for (const notice of opts.notices) {
            printHeadlessCloudNotice(notice.text)
          }
          continue
        }
        if (subtype === 'interrupt') {
          liveness.noteInterrupt()
          await interruptRemoteSession(opts.sessionId)
          enqueueControlSuccess(io, msg.request_id)
          continue
        }
        if (subtype === 'end_session') {
          enqueueControlSuccess(io, msg.request_id)
          stop = true
          pollAbort.abort()
          continue
        }
        if (subtype === 'set_permission_mode' && opts.serveOnly) {
          enqueueControlError(
            io,
            msg.request_id,
            'serve-only attach does not apply permission mode',
          )
          continue
        }
        enqueueControlSuccess(io, msg.request_id)
        continue
      }
      const user = extractUserContent(message)
      if (user !== null && user.trim() !== '') {
        const queued = outbound.submit({
          kind: 'message',
          uuid:
            'uuid' in message && typeof message.uuid === 'string'
              ? message.uuid
              : undefined,
          content: user,
        })
        if (queued === 'redelivered') {
          if (opts.replayUserMessages) {
            const uuid =
              'uuid' in message && typeof message.uuid === 'string'
                ? message.uuid
                : randomUUID()
            io.outbound.enqueue(
              replayCloudUserMessage(
                opts.sessionId,
                uuid,
                user,
              ) as StdoutMessage,
            )
          }
          continue
        }
        if (queued === 'refused') {
          writeHeadlessCloudError(
            'Error: too many messages are waiting for the cloud session',
          )
          stop = true
          pollAbort.abort()
          io.outbound.done()
          await drain
          await pollLoop.catch(() => undefined)
          return {
            message: 'too many messages are waiting for the cloud session',
            exitCode: 1,
          }
        }
        queuedSends += 1
        features.noteTurnInFlight()
        liveness.noteDelivered(user)
        const wait = features.sendWait()
        if (wait) await wait()
        const sendUuid =
          'uuid' in message && typeof message.uuid === 'string'
            ? message.uuid
            : undefined
        if (sendUuid) outbound.ledger.postStart(sendUuid)
        const sent = await sendEventToRemoteSession(opts.sessionId, user)
        outbound.shift()
        if (sent.ok) {
          if (sendUuid) outbound.ledger.postOk(sendUuid)
          queuedSends = Math.max(0, queuedSends - 1)
          features.noteMessageSent({ content: user })
          liveness.noteSendOk({ afterStop: true })
          if (opts.replayUserMessages) {
            const uuid =
              'uuid' in message && typeof message.uuid === 'string'
                ? message.uuid
                : randomUUID()
            io.outbound.enqueue(
              replayCloudUserMessage(
                opts.sessionId,
                uuid,
                user,
              ) as StdoutMessage,
            )
          }
        }
        if (!sent.ok) {
          writeHeadlessCloudError(
            `Error: failed to send message to cloud session ${opts.sessionId}: ${sent.reason}`,
          )
          stop = true
          pollAbort.abort()
          io.outbound.done()
          await drain
          await pollLoop.catch(() => undefined)
          return { message: sent.reason, exitCode: 1 }
        }
      }
    }
  } finally {
    stop = true
    pollAbort.abort()
    io.outbound.done()
    outbound.close('session_ended')
    frames.close()
    await features.dispose()
    await liveness.stop()
    const seedNotice = await waitDirSyncSeedAtExit(opts.sessionId, pollAbort)
    if (seedNotice) printHeadlessCloudNotice(seedNotice.text)
  }
  await drain
  await pollLoop.catch(() => undefined)
  return { exitCode: 0 }
}

async function openHeadlessCloudCreate(
  args: HeadlessCloudHostArgs,
): Promise<HeadlessCloudOpenerResult> {
  try {
    const bind = await bindPreflight()
    if (bind !== undefined) {
      logRemoteHeadlessFeatureBad('bind_unavailable', { reason: bind })
      return { kind: 'failed', message: cloudBindUnavailableError(bind) }
    }
    const syncNotices = await promptDirSyncConsent({
      dialogs: args.dialogs,
      explicitRef: args.poolOnBranch
        ? { revision: args.poolOnBranch, flag: '--on-branch' }
        : args.poolRef
          ? { revision: args.poolRef, flag: '--ref' }
          : undefined,
      storageV5: args.storageV5,
    })
    const settingsCloud = await settingsToCloudEnabled().catch(() => false)
    const gate = headlessCloudModelGate(args, {
      settingsToCloudEnabled: settingsCloud,
      settings: getSettings_DEPRECATED() as CloudSettingsBag,
      hostFillsDefault: true,
    })
    if (gate.decision.action !== 'none') {
      logEvent('tengu_remote_model_gate_hint', {
        entry_point:
          'cloud_headless' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        permission_mode: (gate.explicitMode ??
          'unset') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        action: gate.decision
          .action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    await promptUnattendedServingConsent({
      dialogs: args.dialogs,
      permissionMode: gate.decision.permissionMode,
    })
    const currentBranch = (await getBranch()) || undefined
    logEvent('tengu_remote_create_session', {
      has_initial_prompt:
        'false' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      entry_point:
        'cloud_headless' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      branch_mode: cloudBranchMode(
        args.poolOnBranch,
        args.poolRef,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    const payload = headlessCloudTeleportPayload(
      {
        ...args,
        customSystemPrompt: args.systemPrompt,
      },
      currentBranch,
    )
    const bundleNotices: HeadlessCloudNotice[] = []
    const opened = await withHeadlessCloudAuth(async () => {
      const abort = new AbortController()
      const binding = createDeviceBindingBag(getOauthAccountInfo()?.accountUuid)
      const created = await teleportToRemote({
        initialMessage: payload.initialMessage,
        signal: abort.signal,
        source: payload.source,
        branchName: payload.branchName,
        title: payload.title,
        description: args.remote || undefined,
        reuseOutcomeBranch: payload.reuseOutcomeBranch,
        explicitRef: payload.explicitRef,
        appendSystemPrompt: payload.appendSystemPrompt,
        customSystemPrompt: payload.customSystemPrompt,
        appendSubagentSystemPrompt: payload.appendSubagentSystemPrompt,
        allowBundle: payload.allowBundle,
        seedDirSync: payload.seedDirSync,
        staysAttached: payload.staysAttached,
        forwardHomeSettings: payload.forwardHomeSettings,
        homeSettingsConsent: payload.homeSettingsConsent,
        deviceBinding: {
          onBound: binding.onBound,
          onUnbound: binding.onUnbound,
        },
        model: gate.model,
        permissionMode: gate.decision.permissionMode,
        onBundleNotice: text => {
          bundleNotices.push({ level: 'notice', text })
        },
      })
      if (!created) {
        return reportRemoteCreateSessionError({
          aborted: abort.signal.aborted,
          branchMode: cloudBranchMode(args.poolOnBranch, args.poolRef),
          entryPoint: 'cloud_headless',
        })
      }
      const te = binding.snapshot()
      // Gold zo archives when bind compositor reports unbound. Local Qre has
      // no Far key / POST /device — do not fake onBound(sessionId) and do not
      // archive a session that was never offered a bind.
      if (te.status === 'unbound') abort.abort()
      logEvent('tengu_remote_create_session_success', {
        session_id:
          created.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        entry_point:
          'cloud_headless' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        branch_mode: cloudBranchMode(
          args.poolOnBranch,
          args.poolRef,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        home_seed_started: (created.homeSeed !== undefined
          ? 'true'
          : 'false') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(args.homeSettingsConsent && {
          home_settings_host_consent:
            args.homeSettingsConsent as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
      })
      if (te.status === 'unbound') {
        logRemoteHeadlessFeatureBad('unbound', {
          reason: te.reason ?? 'no_device_key',
        })
      }
      return {
        kind: 'opened' as const,
        sessionId: created.id,
        notices: [...syncNotices, ...bundleNotices],
        bound: true,
      }
    })
    return opened
  } catch (error) {
    logRemoteHeadlessFeatureBad('open_threw')
    return {
      kind: 'failed',
      message: `Error: ${errorMessage(error) || 'Unable to open the cloud session'}`,
    }
  }
}

function archivedCloudSessionMessage(sessionId: string): string {
  return `Error: cloud session ${sessionId} is archived and cannot accept new messages. View it at ${cloudSessionViewUrl(sessionId)}`
}

async function openHeadlessCloudAttach(
  args: HeadlessCloudHostArgs,
  sessionId: string,
  serveOnly: boolean,
): Promise<HeadlessCloudOpenerResult> {
  try {
    logEvent('tengu_remote_attach_session', {
      session_id:
        sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      entry_point:
        'cloud_headless' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    void (await settingsToCloudEnabled().catch(() => false))
    if (serveOnly) {
      const linked = await linkForServing({
        sessionId,
        serveOnly: true,
      })
      if (!linked.ok) {
        return { kind: 'failed', message: linked.message }
      }
      void (await hostedServeDialogsGateOn().catch(() => false))
    }
    const fetched = await fetchSession(sessionId).then(
      session => ({ session }),
      (error: unknown) => ({ error }),
    )
    let preflight:
      | {
          archived: boolean
          awaitsAnswer: boolean
          unreadable: boolean
          snapshot: { archived: boolean; boundDeviceId?: string }
          createdAt?: string
          startupFailure?: string
          busy: boolean
          refused?: undefined
        }
      | { refused: string }
    if ('session' in fetched) {
      preflight = {
        archived: fetched.session.session_status === 'archived',
        awaitsAnswer: fetched.session.session_status === 'requires_action',
        unreadable: false,
        snapshot: sessionBindingSnapshot(fetched.session),
        createdAt: fetched.session.created_at,
        startupFailure: fetched.session.startup_failure,
        busy: fetched.session.session_status === 'running',
      }
    } else if (fetched.error instanceof TeleportOperationError) {
      preflight = {
        refused: fetched.error.formattedMessage || fetched.error.message,
      }
    } else {
      logForDebugging(
        `[headlessCloud] attach preflight failed (continuing via the stream): ${errorMessage(fetched.error)}`,
      )
      preflight = {
        archived: false,
        awaitsAnswer: false,
        unreadable: true,
        snapshot: { archived: false, boundDeviceId: undefined },
        createdAt: undefined,
        startupFailure: undefined,
        busy: false,
      }
    }
    if ('refused' in preflight) {
      logRemoteHeadlessFeatureBad('attach_refused')
      return {
        kind: 'failed',
        message: `Error: ${(preflight.refused ?? '').slice(0, 300)}`,
      }
    }
    if (preflight.archived) {
      logEvent('tengu_remote_attach_session_rejected', {
        reason:
          'archived' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        entry_point:
          'cloud_headless' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      logRemoteHeadlessFeatureBad('attach_archived')
      return {
        kind: 'failed',
        message: archivedCloudSessionMessage(sessionId),
      }
    }
    if (preflight.unreadable) {
      logRemoteHeadlessFeatureBad('attach_session_unreadable')
    }
    if (preflight.awaitsAnswer) {
      return {
        kind: 'failed',
        message: `Error: cloud session ${sessionId} is waiting on a question; answer it where it was asked (${cloudSessionViewUrl(sessionId)}) before sending it another message.`,
      }
    }
    const binding = resolveAttachDeviceBinding({
      sessionId,
      session: Promise.resolve(preflight.snapshot),
    })
    const bound = await isAttachBound(binding)
    const trust = startRepositoryTrustPoll({ sessionId })
    const dirSync = await attachDirSyncLookup({
      sessionId,
      boundToThisMachine: bound,
      sessionHost: args.storageV5,
    })
    if (dirSync.handle === undefined && dirSync.why === 'lookup_failed') {
      logRemoteHeadlessFeatureBad('attach_dir_sync_lookup_failed')
    }
    void (await askHostDeviceMcpConsent({ dialogs: args.dialogs }))
    if (
      serveOnly &&
      dirSync.handle === undefined &&
      dirSync.why === 'not_armed_here'
    ) {
      startAttachSync({
        sessionId,
        boundToThisMachine: bound,
        sessionHost: args.storageV5,
      })
    }
    const resolved = await binding
    const registration = registerAttachDevice({
      sessionId,
      binding: Promise.resolve(resolved),
    })
    await startLaptopDeviceBridge({
      sessionId,
      deviceId: resolved.status === 'bound' ? resolved.deviceId : undefined,
      dirSync: dirSync.handle,
    })
    void isLinkPreparationOverlapOn()
    void isEventualHavenEnabledSync()
    try {
      await readCloudStreamPosition(sessionId)
    } catch (error) {
      await registration.stop()
      trust?.stop()
      logRemoteHeadlessFeatureBad('attach_stream_position')
      return {
        kind: 'failed',
        message: `Error: could not read where cloud session ${formatCloudSessionId(sessionId)}'s stream stands (${errorMessage(error).slice(0, 200)}).`,
      }
    }
    const folderRelation = serveOnlySeparateCopy({
      serveOnly,
      lookup: dirSyncNotArmedHere({}),
      sessionBefore:
        preflight.createdAt !== undefined
          ? {
              createdAt: preflight.createdAt,
              boundDeviceId: preflight.snapshot.boundDeviceId,
            }
          : undefined,
      sweep: { kind: 'unknown' },
    })
    return {
      kind: 'opened',
      sessionId,
      bound: resolved.status === 'bound',
      openingRequests: openingPermissionModeRequests(args.permissionModeCli, {
        serveOnly,
      }),
      ...(folderRelation && { folderRelation }),
      notices: [
        ...(serveOnly
          ? [
              {
                level: 'notice' as const,
                text: 'serve-only attach honours attachServeRequest',
              },
            ]
          : []),
        ...(dirSync.why === 'elsewhere' && dirSync.line
          ? [{ level: 'warning' as const, text: dirSync.line }]
          : []),
      ],
    }
  } catch (error) {
    logRemoteHeadlessFeatureBad('attach_stream_position')
    return {
      kind: 'failed',
      message: `Error: could not read where cloud session ${sessionId}'s stream stands (${errorMessage(error)}).`,
    }
  }
}

/**
 * gold `In` @202416789 — refuse / notices / openSession host using local
 * print/SDK StructuredIO + existing CCR teleport/print-attach.
 */
export async function runHeadlessCloudHost(
  args: HeadlessCloudHostArgs,
  tools: ReadonlyArray<{ name: string }> | undefined,
  opts: {
    entry: 'create' | 'attach'
    opener: () => Promise<HeadlessCloudOpenerResult>
    features?: Array<Record<string, unknown>>
    attachHonours?: string[]
    sdkHost?: HeadlessCloudSdkHost
  },
): Promise<void> {
  const honours: readonly string[] =
    opts.entry === 'create'
      ? HEADLESS_CLOUD_CREATE_HONOURS
      : (opts.attachHonours ?? [])
  const refused = await refuseHeadlessCloudLaunch(args, tools, opts.entry)
  if (refused.kind === 'refused') {
    logRemoteHeadlessFeatureBad(refused.code)
    writeHeadlessCloudError(refused.message)
    await gracefulShutdown(1)
    return
  }
  refused.policy.notices.forEach(notice =>
    printHeadlessCloudNotice(notice.text),
  )
  const features = opts.sdkHost?.features ?? new HeadlessCloudFeatureHandles()
  // densable `F_e(!0),D3(!0)` @202417046 — formatted stream-json + remote surface.
  setHasFormattedOutput(true)
  getBootstrapSession().surfaceCapabilities.markRemote(true)
  const opened = await opts.opener()
  if (opened.kind === 'failed') {
    logRemoteHeadlessFeatureBad('open_threw')
    writeHeadlessCloudError(opened.message)
    await gracefulShutdown(1)
    return
  }
  const bound = opened.kind === 'opened' && opened.bound === true
  void composeExtraReachForCloudHooks({
    kind: 'forward',
    launchDir: getOriginalCwd(),
    projectDir: findGitRoot(getOriginalCwd()) ?? getOriginalCwd(),
    configHome: homedir(),
    extraReachRoots: [],
    realpath: async p => p,
  })
  void mergeReachEnv(emptyReachMemory(), {
    path: homedir(),
    real: homedir(),
  })
  void legacyConfigFileCache({}, { path: homedir() })
  const packs = await attachHeadlessFeatures(
    [
      c =>
        createSettingsToCloudPack({
          forwardHomeSettings: args.forwardHomeSettings ?? true,
        })({
          bound,
          trigger: c.trigger,
          settingsToCloud: true,
        }),
      c =>
        createCloudHooksPack()({
          trigger: c.trigger,
          bound,
          sessionId: opened.sessionId,
        }),
      () =>
        createCloudToolsPack()({
          bound,
          servedTools: bound ? {} : undefined,
        }),
    ],
    { trigger: opts.entry },
  )
  features.adopt(packs as HeadlessCloudFeaturePack[])
  const applied = notAppliedReport(
    refused.policy.notApplied,
    null,
    opts.entry,
    honours,
  )
  const openedWithNotices = mergeOpenedCloudSessionNotices(opened, applied)
  const result = await hostHeadlessCloudSession({
    input: refused.input,
    replayUserMessages: args.effectiveReplayUserMessages,
    includePartialMessages: args.effectiveIncludePartialMessages,
    sessionId: openedWithNotices.sessionId,
    notices: [...applied.notices, ...(openedWithNotices.notices ?? [])],
    notApplied: applied.entries,
    serveOnly: honours.includes('attachServeRequest'),
    entry: opts.entry,
    openingRequests: openedWithNotices.openingRequests,
    sdkHost: opts.sdkHost,
  })
  if (result.message && result.exitCode === 0) {
    printHeadlessCloudNotice(result.message)
  } else if (result.message) {
    writeHeadlessCloudError(result.message)
  }
  await gracefulShutdown(result.exitCode)
}

/**
 * densable `m_n(e)` @202374511 — `{done: new tn(e).done}`.
 * densable `class tn` @202374555 wrapping existing CCR `runHeadlessCloudHost`.
 */
export class HeadlessCloudSdkHost {
  done: Promise<void>
  resolveDone: () => void = () => {}
  phase: 'pre_session' | 'live' | 'ending' = 'pre_session'
  oauthBridgeInstalled = false
  frames: HeadlessCloudFrames | null = null
  liveness: HeadlessCloudLiveness | null = null
  outbound: HeadlessCloudOutbound | null = null
  features: HeadlessCloudFeatureHandles | null = null
  agentRequests = new HeadlessCloudAgentRequests()
  hostRequests = new HeadlessCloudHostRequests()
  connection: 'connecting' | 'live' | 'closed' = 'connecting'
  /** densable `tn` ports.initializePolicy — gold In() pins `"strict"`. */
  initializePolicy: 'strict' | 'lenient' = 'strict'
  openingInitializeHonours: Set<string> = new Set()

  /** densable `tn.installOAuthBridge` @202380172 */
  installOAuthBridge(refresh: () => Promise<string | null>): void {
    if (
      hasSdkOauthRefresh() &&
      SDK_OAUTH_REFRESH_ENTRYPOINTS.has(
        process.env.CLAUDE_CODE_ENTRYPOINT ?? '',
      )
    ) {
      setSdkOauthTokenRefreshCallback(refresh)
      this.oauthBridgeInstalled = true
    }
  }

  constructor(
    args: HeadlessCloudHostArgs,
    tools: ReadonlyArray<{ name: string }> | undefined,
    opts: {
      entry: 'create' | 'attach'
      opener: () => Promise<HeadlessCloudOpenerResult>
      features?: Array<Record<string, unknown>>
      attachHonours?: string[]
    },
  ) {
    this.done = new Promise(resolve => {
      this.resolveDone = resolve
    })
    this.outbound = new HeadlessCloudOutbound(
      HEADLESS_CLOUD_QUEUE_CAP,
      Boolean(args.effectiveReplayUserMessages),
    )
    this.features = new HeadlessCloudFeatureHandles()
    this.features.adopt(
      (opts.features ?? []).map(pack => ({
        feature: typeof pack.kind === 'string' ? pack.kind : undefined,
        ...pack,
      })),
    )
    void runHeadlessCloudHost(args, tools, { ...opts, sdkHost: this }).finally(
      () => {
        this.phase = 'ending'
        this.connection = 'closed'
        this.resolveDone()
      },
    )
  }
}

export function startHeadlessCloudSession(
  args: HeadlessCloudHostArgs,
  tools: ReadonlyArray<{ name: string }> | undefined,
  opts: {
    entry: 'create' | 'attach'
    opener: () => Promise<HeadlessCloudOpenerResult>
    features?: Array<Record<string, unknown>>
    attachHonours?: string[]
  },
): { done: Promise<void> } {
  return { done: new HeadlessCloudSdkHost(args, tools, opts).done }
}

/** gold `EVo` @202420586 — `runHeadlessCloudCreate`. */
export function runHeadlessCloudCreate(
  args: HeadlessCloudHostArgs,
  tools: ReadonlyArray<{ name: string }> | undefined,
  sessionHost: HeadlessCloudSessionHost,
): Promise<void> {
  return startHeadlessCloudSession(args, tools, {
    entry: 'create',
    opener: () => openHeadlessCloudCreate(args),
    features: headlessCloudFeatures(args, sessionHost),
  }).done
}

/** gold `vVo` @202432597 — `runHeadlessCloudAttach`. */
export function runHeadlessCloudAttach(
  args: HeadlessCloudHostArgs,
  tools: ReadonlyArray<{ name: string }> | undefined,
  sessionId: string,
  sessionHost: HeadlessCloudSessionHost,
  { serveOnly = false }: { serveOnly?: boolean } = {},
): Promise<void> {
  return startHeadlessCloudSession(args, tools, {
    entry: 'attach',
    opener: () => openHeadlessCloudAttach(args, sessionId, serveOnly),
    features: serveOnly
      ? headlessCloudServeOnlyFeatures()
      : headlessCloudFeatures(args, sessionHost),
    ...(serveOnly && { attachHonours: ['attachServeRequest'] }),
  }).done
}

const CLOUD_BARE_NEEDS_PROMPT = 'Error: a cloud session needs a prompt'

/**
 * densable `wXn` @202426660 — `cloud_headless_bare` create.
 * `qt` staysAttached:!1; archive on dispose via existing `archiveRemoteSession`.
 */
export async function openHeadlessCloudBareCreate(
  args: HeadlessCloudHostArgs,
  prompt: string,
): Promise<HeadlessCloudOpenerResult> {
  if (!cloudBarePromptPresent(prompt)) {
    return { kind: 'failed', message: CLOUD_BARE_NEEDS_PROMPT }
  }
  const settingsCloud = await settingsToCloudEnabled().catch(() => false)
  const gate = headlessCloudModelGate(args, {
    settingsToCloudEnabled: settingsCloud,
    settings: getSettings_DEPRECATED() as CloudSettingsBag,
    hostFillsDefault: true,
  })
  if (gate.decision.action !== 'none') {
    logEvent('tengu_remote_model_gate_hint', {
      entry_point:
        'cloud_headless_bare' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      permission_mode: (gate.explicitMode ??
        'unset') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      action: gate.decision
        .action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  const currentBranch = (await getBranch()) || undefined
  logEvent('tengu_remote_create_session', {
    has_initial_prompt:
      'true' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    entry_point:
      'cloud_headless_bare' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    branch_mode: cloudBranchMode(
      args.poolOnBranch,
      args.poolRef,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  const promptUuid = randomUUID()
  const payload = headlessCloudBareTeleportPayload({
    prompt,
    promptUuid,
    currentBranch:
      (args.poolOnBranch ?? args.poolRef) == null ? currentBranch : undefined,
    poolOnBranch: args.poolOnBranch,
    poolRef: args.poolRef,
    title: args.sessionNameArg || undefined,
    permissionMode: gate.decision.permissionMode,
    model: gate.model,
  })
  const created = await teleportToRemote({
    initialMessage: payload.initialMessage,
    initialMessageUuid: payload.initialMessageUuid,
    signal: new AbortController().signal,
    source: payload.source,
    branchName: payload.branchName,
    title: payload.title,
    reuseOutcomeBranch: payload.reuseOutcomeBranch,
    explicitRef: payload.explicitRef,
    allowBundle: payload.allowBundle,
    staysAttached: payload.staysAttached,
    model: payload.model,
    permissionMode: payload.permissionMode,
  })
  if (!created) {
    return reportRemoteCreateSessionError({
      aborted: false,
      branchMode: cloudBranchMode(args.poolOnBranch, args.poolRef),
      entryPoint: 'cloud_headless_bare',
    })
  }
  logEvent('tengu_remote_create_session_success', {
    session_id:
      created.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    entry_point:
      'cloud_headless_bare' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    branch_mode: cloudBranchMode(
      args.poolOnBranch,
      args.poolRef,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return { kind: 'opened', sessionId: created.id, bound: false }
}

/**
 * densable `EXn` @202429218 — `cloud_headless_bare` attach.
 * Extra refuses vs Yo: `attach_wont_start` / `attach_busy`.
 */
export async function openHeadlessCloudBareAttach(
  sessionId: string,
): Promise<HeadlessCloudOpenerResult> {
  logEvent('tengu_remote_attach_session', {
    session_id:
      sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    entry_point:
      'cloud_headless_bare' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  const view = cloudSessionViewUrl(sessionId)
  const labeled = formatCloudSessionId(sessionId)
  const w = await fetchSession(sessionId).then(
    E => ({
      archived: E.session_status === 'archived',
      awaitsAnswer: E.session_status === 'requires_action',
      busy: E.session_status === 'running',
      wontStart: E.startup_failure,
      boundDeviceUuid: E.bound_device_uuid,
    }),
    (E: unknown) => ({
      refused:
        E instanceof TeleportOperationError
          ? E.formattedMessage || E.message
          : errorMessage(E),
    }),
  )
  if ('refused' in w) {
    logRemoteHeadlessFeatureBad('attach_refused')
    return {
      kind: 'failed',
      message: `Error: ${(w.refused ?? '').slice(0, 300)}`,
    }
  }
  if (w.archived) {
    logEvent('tengu_remote_attach_session_rejected', {
      reason:
        'archived' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      entry_point:
        'cloud_headless_bare' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logRemoteHeadlessFeatureBad('attach_archived')
    return { kind: 'failed', message: archivedCloudSessionMessage(sessionId) }
  }
  if (w.wontStart !== undefined) {
    logRemoteHeadlessFeatureBad('attach_wont_start')
    return {
      kind: 'failed',
      message: `Error: cloud session ${labeled} will not start: ${w.wontStart.slice(0, 200)} (${view})`,
    }
  }
  const turnBusy = (await cloudTurnInFlight(sessionId)) ?? w.busy
  if (turnBusy) {
    logRemoteHeadlessFeatureBad('attach_busy')
    return {
      kind: 'failed',
      message: `Error: cloud session ${labeled} is busy with a turn; wait for it to finish, or watch it at ${view}, then send the message again.`,
    }
  }
  if (w.awaitsAnswer) {
    logRemoteHeadlessFeatureBad('attach_requires_action')
    return {
      kind: 'failed',
      message: `Error: cloud session ${labeled} is waiting on a question; answer it where it was asked (${view}) before sending it another message.`,
    }
  }
  return { kind: 'opened', sessionId, bound: w.boundDeviceUuid !== undefined }
}

export function runHeadlessCloudBareCreate(
  args: HeadlessCloudHostArgs,
  tools: ReadonlyArray<{ name: string }> | undefined,
  prompt: string,
  sessionHost: HeadlessCloudSessionHost,
): Promise<void> {
  return startHeadlessCloudSession(args, tools, {
    entry: 'create',
    opener: () => openHeadlessCloudBareCreate(args, prompt),
    features: headlessCloudFeatures(args, sessionHost),
  }).done
}

export function runHeadlessCloudBareAttach(
  args: HeadlessCloudHostArgs,
  tools: ReadonlyArray<{ name: string }> | undefined,
  sessionId: string,
  sessionHost: HeadlessCloudSessionHost,
): Promise<void> {
  return startHeadlessCloudSession(args, tools, {
    entry: 'attach',
    opener: () => openHeadlessCloudBareAttach(sessionId),
    features: headlessCloudFeatures(args, sessionHost),
  }).done
}
