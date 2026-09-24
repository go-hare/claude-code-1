/**
 * densable 2.1.251 #57 — VQt `call` permissionOverrides four-arm + helpers.
 *
 * Gold call arm (gold-251-f):
 *   c = kx(tool,ctx)==="bypassPermissions"
 *   T = c ? skip_all
 *     : m ? follow_a_plan + domains + onPermissionRequest
 *     : R.length>0 ? follow_a_plan + domains
 *     : ask
 *   then ie(..., T) → socketClient.callTool with PermissionOverrides
 */
import type {
  BridgePermissionRequest,
  PermissionMode,
  PermissionOverrides,
} from '@ant/claude-for-chrome-mcp'
import {
  getSessionBypassPermissionsMode,
  getSessionId,
} from '../../bootstrap/state.js'
import { logEvent } from '../../services/analytics/index.js'
import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import {
  getChromeInstallSessionState,
  rememberLastExecutedTabUrl,
  type ResolvedChromeHost,
} from './sessionState.js'

export type ChromeDomainSets = {
  allowed: Set<string>
  denied: Set<string>
  allowedRaw: string[]
}

/**
 * densable `y` — normalize host for set membership (lowercase, strip trailing dots).
 */
export function normalizeChromeHost(host: string): string {
  return host
    .replace(/\.+(?=$|:)/, '')
    .toLowerCase()
    .replace(/\.+$/, '')
}

/**
 * densable `x` — collect chrome domain allow/deny from permission rules.
 */
export function chromeDomainSetsFromContext(
  ctx: ToolPermissionContext,
): ChromeDomainSets {
  const allowed = new Set<string>()
  const denied = new Set<string>()
  const allowedRaw: string[] = []

  const collect = (
    rulesBySource: ToolPermissionContext['alwaysAllowRules'] | undefined,
    into: Set<string>,
    raw?: string[],
  ): void => {
    if (!rulesBySource) return
    for (const list of Object.values(rulesBySource)) {
      if (!Array.isArray(list)) continue
      for (const rule of list) {
        const s = typeof rule === 'string' ? rule : String(rule ?? '')
        const hostMatch = s.match(
          /(?:claude-in-chrome|Chrome)[^\s]*[:\s@]+([a-z0-9.-]+\.[a-z]{2,})/i,
        )
        const bare = s.match(/^([a-z0-9.-]+\.[a-z]{2,}(?::\d+)?)$/i)
        const host = hostMatch?.[1] ?? bare?.[1]
        if (!host) continue
        const n = normalizeChromeHost(host)
        into.add(n)
        if (raw && !raw.includes(host)) raw.push(host)
      }
    }
  }

  collect(ctx.alwaysDenyRules, denied)
  collect(ctx.alwaysAllowRules, allowed, allowedRaw)
  return { allowed, denied, allowedRaw }
}

/**
 * densable `se` — onPermissionRequest: allow only if host still in allowed set.
 */
export function createChromeOnPermissionRequest(
  allowed: Set<string>,
): (request: BridgePermissionRequest) => Promise<boolean> {
  return async request => {
    let host: string | undefined
    try {
      const url =
        request && typeof request === 'object' && 'url' in request
          ? String((request as { url?: string }).url ?? '')
          : ''
      if (url) host = new URL(url).host
    } catch {
      host = undefined
    }
    const ok = !!host && allowed.has(normalizeChromeHost(host))
    if (!ok) {
      logEvent('chrome_permission_prompt', {})
    }
    return ok
  }
}

/** densable `F` — sessionScope bag. */
export function chromeSessionScope(): { sessionId: string } {
  return { sessionId: getSessionId() }
}

/**
 * densable VQt call arm — build PermissionOverrides for this tool use.
 */
export function resolveChromeCallPermissionOverrides(
  context: ToolUseContext,
  toolUseId: string | undefined,
): PermissionOverrides {
  const state = getChromeInstallSessionState()
  const resolved: ResolvedChromeHost | undefined = toolUseId
    ? state.resolvedHostByToolUseId.get(toolUseId)
    : undefined
  const resolvedUrl = toolUseId
    ? state.resolvedUrlByToolUseId.get(toolUseId)
    : undefined
  if (toolUseId) {
    state.resolvedHostByToolUseId.delete(toolUseId)
    state.resolvedUrlByToolUseId.delete(toolUseId)
  }

  const ctx = context.getAppState().toolPermissionContext
  // densable VQt: `c=kx(a,d)==="bypassPermissions"`. Nq is session bypass
  // (TD/Dme). Do NOT treat plan + isBypassPermissionsModeAvailable as skip_all
  // — that flag only means Shift+Tab can reach bypass (planBypass.ts).
  const bypass =
    getSessionBypassPermissionsMode() || ctx.mode === 'bypassPermissions'

  const sets = chromeDomainSetsFromContext(ctx)
  const host = resolved?.host
  if (host && !sets.allowed.has(normalizeChromeHost(host))) {
    sets.allowed.add(normalizeChromeHost(host))
    if (!sets.allowedRaw.includes(host)) sets.allowedRaw.push(host)
  }

  const sessionScope = chromeSessionScope()
  let overrides: PermissionOverrides
  if (bypass) {
    overrides = { permissionMode: 'skip_all_permission_checks' }
  } else if (host) {
    overrides = {
      permissionMode: 'follow_a_plan',
      allowedDomains: [...sets.allowedRaw],
      onPermissionRequest: createChromeOnPermissionRequest(sets.allowed),
    }
  } else if (sets.allowedRaw.length > 0) {
    overrides = {
      permissionMode: 'follow_a_plan',
      allowedDomains: [...sets.allowedRaw],
    }
  } else {
    overrides = { permissionMode: 'ask' }
  }

  if (resolvedUrl) {
    rememberLastExecutedTabUrl(sessionScope.sessionId, resolvedUrl)
  }
  if (host) {
    logEvent('chrome_permission_prompt', {})
  }

  return overrides
}

/** densable TD. */
export function chromePermissionModeFromSession(): PermissionMode {
  return getSessionBypassPermissionsMode()
    ? 'skip_all_permission_checks'
    : 'ask'
}

/** densable Nq mirror. */
export function isChromeSessionBypass(): boolean {
  return getSessionBypassPermissionsMode()
}
