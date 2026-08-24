/**
 * Channel notifications — lets an MCP server push user messages into the
 * conversation. A "channel" (Discord, Slack, SMS, etc.) is just an MCP server
 * that:
 *   - exposes tools for outbound messages (e.g. `send_message`) — standard MCP
 *   - sends `notifications/claude/channel` notifications for inbound — this file
 *
 * The notification handler wraps the content in a <channel> tag and
 * enqueues it. SleepTool polls hasCommandsInQueue() and wakes within 1s.
 * The model sees where the message came from and decides which tool to reply
 * with (the channel's MCP tool, SendUserMessage, or both).
 *
 * feature('KAIROS') || feature('KAIROS_CHANNELS'). Runtime gate tengu_harbor.
 * Requires claude.ai OAuth auth — API key users are blocked until
 * console gets a channelsEnabled admin surface. Teams/Enterprise orgs
 * must explicitly opt in via channelsEnabled: true in managed settings.
 */

import type { AnyObjectSchema, ServerCapabilities } from './types.js'
import { z } from 'zod/v4'
import { type ChannelEntry, getAllowedChannels } from '../../bootstrap/state.js'
import { CHANNEL_TAG } from '../../constants/xml.js'
import { getSubscriptionType } from '../../utils/auth.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'
import { escapeXmlAttr } from '../../utils/xml.js'
import {
  type ChannelAllowlistEntry,
  getChannelAllowlist,
  isBuiltinWeixinChannel,
  isChannelsEnabled,
} from './channelAllowlist.js'
import { hasExperimentalCapability } from './channelPermissions.js'

/** densable/v2: string method for setNotificationHandler first arg. */
export const CHANNEL_MESSAGE_METHOD = 'notifications/claude/channel'

/** Params-only schema for v2 setNotificationHandler(method, {params}, …). */
export const ChannelMessageParamsSchema = lazySchema(() =>
  z.object({
    content: z.string(),
    // Opaque passthrough — thread_id, user, whatever the channel wants the
    // model to see. Rendered as attributes on the <channel> tag.
    meta: z.record(z.string(), z.string()).optional(),
  }),
)

export const ChannelMessageNotificationSchema = lazySchema(() =>
  z.object({
    method: z.literal(CHANNEL_MESSAGE_METHOD),
    params: ChannelMessageParamsSchema(),
  }),
)

/**
 * Structured permission reply from a channel server. Servers that support
 * this declare `capabilities.experimental['claude/channel/permission']` and
 * emit this event INSTEAD of relaying "yes tbxkq" as text via
 * notifications/claude/channel. Explicit opt-in per server — a channel that
 * just wants to relay text never becomes a permission surface by accident.
 *
 * The server parses the user's reply (spec: /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i)
 * and emits {request_id, behavior}. CC matches request_id against its
 * pending map. Unlike the regex-intercept approach, text in the general
 * channel can never accidentally match — approval requires the server
 * to deliberately emit this specific event.
 */
export const CHANNEL_PERMISSION_METHOD =
  'notifications/claude/channel/permission'

/** Params-only schema for v2 setNotificationHandler(method, {params}, …). */
export const ChannelPermissionParamsSchema = lazySchema(() =>
  z.object({
    request_id: z.string(),
    behavior: z.enum(['allow', 'deny']),
  }),
)

export const ChannelPermissionNotificationSchema = lazySchema(() =>
  z.object({
    method: z.literal(CHANNEL_PERMISSION_METHOD),
    params: ChannelPermissionParamsSchema(),
  }),
)

/**
 * Outbound: CC → server. Fired from interactiveHandler.ts when a
 * permission dialog opens and the server has declared the permission
 * capability. Server formats the message for its platform (Telegram
 * markdown, iMessage rich text, Discord embed) and sends it to the
 * human. When the human replies "yes tbxkq", the server parses that
 * against PERMISSION_REPLY_RE and emits the inbound schema above.
 *
 * Not a zod schema — CC SENDS this, doesn't validate it. A type here
 * keeps both halves of the protocol documented side by side.
 */
export const CHANNEL_PERMISSION_REQUEST_METHOD =
  'notifications/claude/channel/permission_request'
export type ChannelPermissionRequestParams = {
  request_id: string
  tool_name: string
  description: string
  /** JSON-stringified tool input, truncated to 200 chars with …. Full
   *  input is in the local terminal dialog; this is a phone-sized
   *  preview. Server decides whether/how to show it. */
  input_preview: string
  /** Optional source-channel routing hint for servers that support
   *  multi-chat routing. Backwards compatible: servers that don't care can
   *  ignore it and keep their existing fallback behavior. */
  channel_context?: {
    source_server?: string
    chat_id?: string
  }
}

/** Params-only schema for v2 setNotificationHandler(method, {params}, …). */
export const ChannelPermissionRequestParamsSchema = lazySchema(() =>
  z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
    channel_context: z
      .object({
        source_server: z.string().optional(),
        chat_id: z.string().optional(),
      })
      .optional(),
  }),
)

export const ChannelPermissionRequestNotificationSchema: () => AnyObjectSchema =
  lazySchema(() =>
    z.object({
      method: z.literal(CHANNEL_PERMISSION_REQUEST_METHOD),
      params: ChannelPermissionRequestParamsSchema(),
    }),
  )

/**
 * Meta keys become XML attribute NAMES — a crafted key like
 * `x="" injected="y` would break out of the attribute structure. Only
 * accept keys that look like plain identifiers. This is stricter than
 * the XML spec (which allows `:`, `.`, `-`) but channel servers only
 * send `chat_id`, `user`, `thread_ts`, `message_id` in practice.
 */
const SAFE_META_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function wrapChannelMessage(
  serverName: string,
  content: string,
  meta?: Record<string, string>,
): string {
  const attrs = Object.entries(meta ?? {})
    .filter(([k]) => SAFE_META_KEY.test(k))
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
    .join('')
  return `<${CHANNEL_TAG} source="${escapeXmlAttr(serverName)}"${attrs}>\n${content}\n</${CHANNEL_TAG}>`
}

/**
 * Effective allowlist for the current session. Team/enterprise orgs can set
 * allowedChannelPlugins in managed settings — when set, it REPLACES the
 * GrowthBook ledger (admin owns the trust decision). Undefined falls back
 * to the ledger. Unmanaged users always get the ledger.
 *
 * Callers already read sub/policy for the policy gate — pass them in to
 * avoid double-reading getSettingsForSource (uncached).
 */
export function getEffectiveChannelAllowlist(
  sub: ReturnType<typeof getSubscriptionType>,
  orgList: ChannelAllowlistEntry[] | undefined,
): {
  entries: ChannelAllowlistEntry[]
  source: 'org' | 'ledger'
} {
  if ((sub === 'team' || sub === 'enterprise') && orgList) {
    return { entries: orgList, source: 'org' }
  }
  return { entries: getChannelAllowlist(), source: 'ledger' }
}

export type ChannelGateKind =
  | 'capability'
  | 'era'
  | 'provider'
  | 'disabled'
  | 'auth'
  | 'policy'
  | 'session'
  | 'marketplace'
  | 'allowlist'

export type ChannelGateSkip = {
  action: 'skip'
  kind: ChannelGateKind
  reason: string
}

/** densable i3r allowlist skip — kind is the literal, not the wide union. */
export type ChannelAllowlistSkip = {
  action: 'skip'
  kind: 'allowlist'
  reason: string
}

export type ChannelGateResult = { action: 'register' } | ChannelGateSkip

/**
 * densable `t2a` — only these skip kinds actually tear down handlers.
 * Soft skips (policy/session/marketplace/allowlist/auth) preserve a
 * previously registered inbound handler so a mid-session re-gate does
 * not drop a still-trusted channel.
 */
export function isChannelGateHardRevocation(kind: ChannelGateKind): boolean {
  return (
    kind === 'provider' ||
    kind === 'disabled' ||
    kind === 'capability' ||
    kind === 'era'
  )
}

/**
 * densable `Kir` team/enterprise branch only: managed orgs must set
 * `channelsEnabled: true`. Gold also has a non-Yi residual
 * (`policy !== null && channelsEnabled !== true`) that would block
 * anyone with a policy file — do not port that.
 */
export function isChannelsPolicyBlocked(
  policy: { channelsEnabled?: boolean } | null | undefined,
  subscriptionType: ReturnType<typeof getSubscriptionType>,
): boolean {
  return (
    (subscriptionType === 'team' || subscriptionType === 'enterprise') &&
    policy?.channelsEnabled !== true
  )
}

/**
 * densable i3r allowlist half. `dev` entries bypass. Builtin weixin
 * always passes (existing product, not gold). Org list replaces ledger
 * only for team/enterprise when `allowedChannelPlugins` is set
 * (`getEffectiveChannelAllowlist` — stricter than gold `g4n`).
 */
export function evaluateChannelAllowlistSkip(
  entry: ChannelEntry,
  pluginSource: string | undefined,
  policy:
    | { allowedChannelPlugins?: ChannelAllowlistEntry[] }
    | null
    | undefined,
  subscriptionType: ReturnType<typeof getSubscriptionType>,
): ChannelAllowlistSkip | null {
  if (entry.dev) return null
  if (entry.kind === 'plugin') {
    if (isBuiltinWeixinChannel(pluginSource)) return null
    const { entries, source } = getEffectiveChannelAllowlist(
      subscriptionType,
      policy?.allowedChannelPlugins,
    )
    if (
      entries.some(
        c => c.plugin === entry.name && c.marketplace === entry.marketplace,
      )
    ) {
      return null
    }
    return {
      action: 'skip',
      kind: 'allowlist',
      reason:
        source === 'org'
          ? `plugin ${entry.name}@${entry.marketplace} is not on your org's approved channels list (set allowedChannelPlugins in managed settings)`
          : `plugin ${entry.name}@${entry.marketplace} is not on the approved channels allowlist (use --dangerously-load-development-channels for local dev)`,
    }
  }
  return {
    action: 'skip',
    kind: 'allowlist',
    reason: `server ${entry.name} is not on the approved channels allowlist (use --dangerously-load-development-channels for local dev)`,
  }
}

/**
 * Match a connected MCP server against the user's parsed --channels entries.
 * server-kind is exact match on bare name; plugin-kind matches on the second
 * segment of plugin:X:Y. Returns the matching entry so callers can read its
 * kind — that's the user's trust declaration, not inferred from runtime shape.
 */
export function findChannelEntry(
  serverName: string,
  channels: readonly ChannelEntry[],
): ChannelEntry | undefined {
  // split unconditionally — for a bare name like 'slack', parts is ['slack']
  // and the plugin-kind branch correctly never matches (parts[0] !== 'plugin').
  const parts = serverName.split(':')
  return channels.find(c =>
    c.kind === 'server'
      ? serverName === c.name
      : parts[0] === 'plugin' && parts[1] === c.name,
  )
}

/**
 * densable `i3r`. Caller checks feature('KAIROS') || feature('KAIROS_CHANNELS')
 * first. Order: capability → era → provider → tengu_harbor → org policy →
 * session --channels → marketplace → allowlist.
 *
 *   skip      Not a channel server, or managed org hasn't opted in, or
 *             not in session --channels / allowlist. Connection stays up;
 *             handler not registered (unless a prior register is preserved
 *             on a soft skip — see `isChannelGateHardRevocation`).
 *   register  Subscribe to notifications/claude/channel.
 *
 * Which servers can connect at all is governed by allowedMcpServers —
 * this gate only decides whether the notification handler registers.
 */
export function gateChannelServer(
  serverName: string,
  capabilities:
    | ServerCapabilities
    | { experimental?: Record<string, unknown> }
    | undefined,
  pluginSource: string | undefined,
  protocolEra?: string,
): ChannelGateResult {
  // densable t3r / s3r — truthy covers `{}` and `true`; explicit false opts out.
  if (!hasExperimentalCapability(capabilities, 'claude/channel')) {
    return {
      action: 'skip',
      kind: 'capability',
      reason: 'server did not declare claude/channel capability',
    }
  }

  if (protocolEra === 'modern') {
    return {
      action: 'skip',
      kind: 'era',
      reason:
        'connection negotiated a modern protocol revision with no unsolicited notification path',
    }
  }

  if (getAPIProvider() !== 'firstParty') {
    return {
      action: 'skip',
      kind: 'provider',
      reason: 'channels are not available on third-party providers',
    }
  }

  if (!isChannelsEnabled()) {
    return {
      action: 'skip',
      kind: 'disabled',
      reason: 'channels feature is not currently available',
    }
  }

  const policy = getSettingsForSource('policySettings')
  if (isChannelsPolicyBlocked(policy, getSubscriptionType())) {
    return {
      action: 'skip',
      kind: 'policy',
      reason:
        'channels not enabled by org policy (set channelsEnabled: true in managed settings)',
    }
  }

  const entry = findChannelEntry(serverName, getAllowedChannels())
  if (!entry) {
    return {
      action: 'skip',
      kind: 'session',
      reason: `server ${serverName} not in --channels list for this session`,
    }
  }

  if (entry.kind === 'plugin') {
    // Marketplace verification: the tag is intent (plugin:slack@anthropic),
    // the runtime name is just plugin:slack:X — could be slack@anthropic or
    // slack@evil depending on what's installed. Verify they match before
    // trusting the tag for the allowlist check below.
    const actual = pluginSource
      ? parsePluginIdentifier(pluginSource).marketplace
      : undefined
    if (actual !== entry.marketplace) {
      return {
        action: 'skip',
        kind: 'marketplace',
        reason: `you asked for plugin:${entry.name}@${entry.marketplace} but the installed ${entry.name} plugin is from ${actual ?? 'an unknown source'}`,
      }
    }
  }

  const allowlistSkip = evaluateChannelAllowlistSkip(
    entry,
    pluginSource,
    policy,
    getSubscriptionType(),
  )
  if (allowlistSkip) return allowlistSkip

  return { action: 'register' }
}
