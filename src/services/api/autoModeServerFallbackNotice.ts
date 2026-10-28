/**
 * densable 2.1.289 auto-mode classifier billing notice
 * (`B5t` / `lcn` / `O7o` / `H5t` / `U5t` / `XUe` / `Fzn` / `dLt` / `POo`).
 * NEVER `export function O7o`.
 */
import {
  getObservedGateway,
  getServerClassifierFallbackChoice,
  getSdkSupportedDialogKinds,
  isReplBridgeActive,
  isSdkDialogHostActive,
  setServerClassifierFallbackChoice,
  clearServerClassifierFallbackChoice,
} from '../../bootstrap/state.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  AUTO_MODE_SERVER_FALLBACK_KIND,
  autoModeServerFallbackSpec,
} from '../../dialog/specs/jsuKinds.js'
import { logForDebugging } from '../../utils/debug.js'
import { getAgentId } from '../../utils/teammate.js'
import { getSubscriptionType, isClaudeAISubscriber } from '../../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getGatewayAuth } from '../../utils/gatewayEnv.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { getApiBaseUrlHost } from '../analytics/growthbook.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'

/** densable `YUe` */
export const AUTO_MODE_CLASSIFIER_BILLING_DOCS_URL =
  'https://code.claude.com/docs/en/auto-mode-classifier-billing'

/** densable `S8o` */
const NOTICE_ACK_TTL_MS = 86_400_000

/** densable `$5t` */
const GATEWAY_HOST_CLAMP = 80

/** densable `v8o` */
const OBSERVED_GATEWAY_LABELS: Record<string, string> = {
  litellm: 'a LiteLLM gateway',
  helicone: 'a Helicone gateway',
  portkey: 'a Portkey gateway',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  kong: 'a Kong gateway',
  braintrust: 'a Braintrust proxy',
  bifrost: 'a Bifrost gateway',
  databricks: 'a Databricks gateway',
}

export type ClassifierGatewayHost = {
  gatewayHost?: string
}

export type AutoModeClassifierBillingNoticeCopy = {
  title: string
  paragraphs: string[]
}

export type AutoModeServerFallbackChoice =
  | 'continue'
  | 'interrupt'
  | 'cancelled'
  | 'continue_unacknowledged'

/** densable `k8o` — tengu_velvet_heron default true. */
function velvetHeronOn(): boolean {
  const value = getFeatureValue_CACHED_MAY_BE_STALE('tengu_velvet_heron', true)
  return typeof value === 'boolean' ? value : true
}

/** densable `F5t` */
function hostIfNotAnthropic(url: string | undefined): string | undefined {
  if (!url) return
  try {
    const { host, hostname } = new URL(url)
    return host && !hostname.endsWith('.anthropic.com') ? host : undefined
  } catch {
    return
  }
}

/** densable `IHr` */
function clampGatewayHost(host: string): string {
  if (host.length <= GATEWAY_HOST_CLAMP) return host
  return `${host.slice(0, GATEWAY_HOST_CLAMP - 1)}…`
}

/** densable `E8o` */
function labeledObservedGateway(): string | undefined {
  const observed = getObservedGateway()
  return observed === undefined ? undefined : OBSERVED_GATEWAY_LABELS[observed]
}

/**
 * densable `R8o` — firstParty custom host, gateway URL host; 3P env map
 * (`T8o`/`Dsr`) has no local analog, so those providers fall through to `E8o`.
 */
function providerGatewayHost(): string | undefined {
  const provider = getAPIProvider()
  switch (provider) {
    case 'firstParty': {
      const host = getApiBaseUrlHost()
      return host === undefined
        ? undefined
        : hostIfNotAnthropic(`https://${host}`)
    }
    case 'gateway':
      return hostIfNotAnthropic(getGatewayAuth()?.url)
    default:
      return undefined
  }
}

/** densable `dLt` */
export function describeClassifierGatewayHost(): string | undefined {
  const fromProvider = providerGatewayHost()
  return fromProvider === undefined
    ? labeledObservedGateway()
    : clampGatewayHost(fromProvider)
}

/** densable `Fzn` */
export function classifierGatewayHostPayload(): ClassifierGatewayHost {
  const host = describeClassifierGatewayHost()
  return host === undefined ? {} : { gatewayHost: host }
}

/** densable `B5t` — English gold copy. */
export function autoModeClassifierBillingNoticeCopy(
  payload: ClassifierGatewayHost,
): AutoModeClassifierBillingNoticeCopy {
  if (payload.gatewayHost !== undefined) {
    return {
      title:
        "We're changing auto mode to no longer charge for classifier requests in Claude Code.",
      paragraphs: [
        `However, this session isn't eligible because your requests go through ${payload.gatewayHost}, which isn't compatible with this update.`,
        'Nothing breaks: auto mode keeps working, and its classifier requests are billed as before.',
        `To fix it and access the new version of auto mode, ask your gateway to implement: ${AUTO_MODE_CLASSIFIER_BILLING_DOCS_URL}`,
      ],
    }
  }
  return {
    title:
      "We're changing auto mode to no longer charge for classifier requests in Claude Code.",
    paragraphs: [
      "However, this session isn't eligible.",
      'Nothing breaks: auto mode keeps working, and its classifier requests are billed as before.',
      `If this keeps happening, contact support or your company's admin: ${AUTO_MODE_CLASSIFIER_BILLING_DOCS_URL}`,
    ],
  }
}

/** densable `$zn` */
export function autoModeClassifierBillingNoticeDialogPayload(
  payload: ClassifierGatewayHost,
): ClassifierGatewayHost &
  AutoModeClassifierBillingNoticeCopy & { helpUrl: string } {
  return {
    ...payload,
    ...autoModeClassifierBillingNoticeCopy(payload),
    helpUrl: AUTO_MODE_CLASSIFIER_BILLING_DOCS_URL,
  }
}

/** densable `POo` */
export function formatAutoModeClassifierBillingNotice(
  payload: ClassifierGatewayHost,
): string {
  const { title, paragraphs } = autoModeClassifierBillingNoticeCopy(payload)
  return [title, ...paragraphs].join(' ')
}

/** densable `lcn` */
export function shouldShowAutoModeClassifierBillingNotice(): boolean {
  const subscription = getSubscriptionType()
  if (
    !velvetHeronOn() ||
    subscription === 'pro' ||
    subscription === 'max' ||
    subscription === 'team' ||
    (subscription === null && isClaudeAISubscriber())
  ) {
    return false
  }
  if (describeClassifierGatewayHost() === undefined) return true
  const ack = getGlobalConfig().autoModeClassifierBillingNoticeAcknowledgedAt
  return ack === undefined || Date.now() - ack >= NOTICE_ACK_TTL_MS
}

/** densable `jzn` */
export function sdkHostSupportsClassifierBillingNotice(): boolean {
  return (
    isSdkDialogHostActive() &&
    (getSdkSupportedDialogKinds() ?? []).includes(
      AUTO_MODE_SERVER_FALLBACK_KIND,
    )
  )
}

/** densable `ym` */
function isNoticeSurfaceUnavailable(context: {
  isBackgroundAgent?: boolean
}): boolean {
  return (
    isReplBridgeActive() ||
    context.isBackgroundAgent === true ||
    getAgentId() !== undefined
  )
}

/** densable `XUe` */
function raceChoiceWithAbort(
  choice: Promise<AutoModeServerFallbackChoice>,
  signal: AbortSignal,
): Promise<AutoModeServerFallbackChoice> {
  if (signal.aborted) return Promise.resolve('interrupt')
  return new Promise(resolve => {
    const onAbort = (): void => resolve('interrupt')
    signal.addEventListener('abort', onAbort, { once: true })
    choice.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve('interrupt')
      },
    )
  })
}

/**
 * densable `H5t` — mailbox has no `armInputGrace`/`onSettledUnanswered`;
 * cancelled without unanswered → gold `C8o` interrupt (fail-closed).
 * Ack only continue ∧ gatewayHost defined.
 */
async function requestClassifierBillingNotice(
  requestDialog: NonNullable<ToolUseContext['requestDialog']>,
  payload: ClassifierGatewayHost,
  options: { storageV5?: unknown; signal?: AbortSignal },
): Promise<AutoModeServerFallbackChoice> {
  const dialogPayload = autoModeClassifierBillingNoticeDialogPayload(payload)
  const result = (await requestDialog(
    autoModeServerFallbackSpec,
    dialogPayload,
    { signal: options.signal },
  )) as AutoModeServerFallbackChoice
  logEvent('tengu_auto_mode_server_fallback_notice_closed', {
    choice:
      result as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  switch (result) {
    case 'continue':
      if (payload.gatewayHost !== undefined) {
        saveGlobalConfig(
          current => ({
            ...current,
            autoModeClassifierBillingNoticeAcknowledgedAt: Date.now(),
          }),
          options.storageV5,
        )
      }
      return 'continue'
    case 'interrupt':
      return 'interrupt'
    case 'cancelled':
      return 'interrupt'
    default:
      return 'interrupt'
  }
}

/** densable `U5t` */
function latchClassifierBillingNoticeChoice(
  start: () => Promise<AutoModeServerFallbackChoice>,
): Promise<AutoModeServerFallbackChoice> {
  const existing = getServerClassifierFallbackChoice()
  if (existing !== undefined) return existing
  if (!shouldShowAutoModeClassifierBillingNotice()) {
    return Promise.resolve('continue')
  }
  const pending = start().then(choice => {
    if (choice === 'continue_unacknowledged') {
      clearServerClassifierFallbackChoice()
      return 'continue' as const
    }
    if (choice === 'interrupt') clearServerClassifierFallbackChoice()
    return choice
  })
  setServerClassifierFallbackChoice(pending)
  return pending
}

/**
 * densable `O7o` — show the billed-classifier notice, or continue silently
 * when there is no dialog surface.
 */
export async function promptAutoModeServerFallbackNotice(
  context: Pick<
    ToolUseContext,
    'abortController' | 'requestDialog' | 'isBackgroundAgent'
  > & { storageV5?: unknown },
): Promise<'continue' | 'interrupt'> {
  const requestDialog = context.requestDialog
  if (context.abortController.signal.aborted) {
    return 'interrupt'
  }
  const existing = getServerClassifierFallbackChoice()
  if (existing !== undefined) {
    return continueOrInterrupt(
      await raceChoiceWithAbort(existing, context.abortController.signal),
    )
  }
  if (!shouldShowAutoModeClassifierBillingNotice()) {
    return 'continue'
  }
  if (
    requestDialog === undefined ||
    (isSdkDialogHostActive()
      ? !sdkHostSupportsClassifierBillingNotice()
      : isNoticeSurfaceUnavailable(context))
  ) {
    logForDebugging(
      '[server-classifier] auto mode fell back to billed classifier requests; no dialog surface to warn on, continuing in auto mode',
    )
    return 'continue'
  }
  const pending = latchClassifierBillingNoticeChoice(() => {
    const gateway = classifierGatewayHostPayload()
    logEvent('tengu_auto_mode_server_fallback_notice', {
      gatewayDetected: gateway.gatewayHost !== undefined,
      provider:
        getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      interactive: true,
      sdkHost: isSdkDialogHostActive(),
    })
    return requestClassifierBillingNotice(requestDialog, gateway, {
      storageV5: context.storageV5,
      signal:
        context.isBackgroundAgent === true
          ? undefined
          : context.abortController.signal,
    })
  })
  return continueOrInterrupt(
    await raceChoiceWithAbort(pending, context.abortController.signal),
  )
}

/** densable O7o result is continue|interrupt; cancelled fail-closes. */
function continueOrInterrupt(
  choice: AutoModeServerFallbackChoice,
): 'continue' | 'interrupt' {
  return choice === 'continue' || choice === 'continue_unacknowledged'
    ? 'continue'
    : 'interrupt'
}
