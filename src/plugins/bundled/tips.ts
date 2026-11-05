/**
 * densable 2.1.289 yfe `cc-plugin-tips` (`se` / `P(u)` / `x` / `S` / `l`).
 */
import { join } from 'path'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import { getPinnedFeatureValue } from '../../services/analytics/growthbook.js'
import {
  getSessionsSinceLastShown,
  getTipLifetimeShownCount,
} from '../../services/tips/tipHistory.js'
import {
  advertisedCommandAllowed,
  spinnerTipHostFromContext,
} from '../../services/tips/tipRegistry.js'
import {
  getSpinnerTipPluginSeat,
  recordShownTip,
  SpinnerTipPluginSeat,
  type SeatedSpinnerTipSlot,
} from '../../services/tips/tipScheduler.js'
import type { Tip, TipContext } from '../../services/tips/types.js'
import { logForDebugging } from '../../utils/debug.js'
import { toError, withTelemetryMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../../utils/model/providers.js'
import {
  getLoadedFunctionHooksModules,
  leftoverFu,
} from '../../utils/plugins/functionHooksModules.js'
import { OFFICIAL_MARKETPLACE_NAME } from '../../utils/plugins/officialMarketplace.js'
import { getReplDiffHost } from '../../utils/sessionHost.js'
import {
  BUILTIN_MARKETPLACE_NAME,
  getBuiltinPluginDefinition,
  getBuiltinPlugins,
  registerBuiltinPlugin,
} from '../builtinPlugins.js'

export { getSpinnerTipPluginSeat, SpinnerTipPluginSeat }
export type { SeatedSpinnerTipSlot }

export const TIPS_PLUGIN_NAME = 'cc-plugin-tips'
export const TIPS_PLUGIN_DESCRIPTION =
  'Spinner tips as a plugin: the tip line under the spinner while Claude works, picked once a turn from the tips that fit the session'
export const TIPS_GB_FEATURE = 'tengu_tips_mod'
export const TIPS_ON_BY_DEFAULT = false

export type SourcedTip = {
  id: string
  cooldownSessions: number
  maxLifetimeShows?: number
  priority?: number
  label?: string
  advertisedCommand?: string
  providerAgnostic: boolean
  isRelevant: () => Promise<boolean>
  content: () => Promise<string>
}

export function isTipsPluginAvailable(): boolean {
  return getPinnedFeatureValue(TIPS_GB_FEATURE, TIPS_ON_BY_DEFAULT)
}

export function isTipsModLoaded(): boolean {
  if (getIsRemoteMode()) return false
  if (getBuiltinPluginDefinition(TIPS_PLUGIN_NAME)?.isAvailable?.() !== true) {
    return false
  }
  if (!getBuiltinPlugins().enabled.some(p => p.name === TIPS_PLUGIN_NAME)) {
    return false
  }
  const allowedSources = new Set([
    `${TIPS_PLUGIN_NAME}@${BUILTIN_MARKETPLACE_NAME}`,
    `tips@${BUILTIN_MARKETPLACE_NAME}`,
    `${TIPS_PLUGIN_NAME}@${OFFICIAL_MARKETPLACE_NAME}`,
    `tips@${OFFICIAL_MARKETPLACE_NAME}`,
  ])
  return getLoadedFunctionHooksModules().some(
    mod =>
      (mod.status === undefined || mod.status === 'live') &&
      (mod.name === `builtin:${TIPS_PLUGIN_NAME}` ||
        ((mod.name === TIPS_PLUGIN_NAME || mod.name === 'tips') &&
          mod.pluginStorageId !== undefined &&
          allowedSources.has(mod.pluginStorageId))),
  )
}

function extractSessionHost(session: unknown): object | undefined {
  if (
    typeof session === 'object' &&
    session !== null &&
    'host' in session &&
    typeof session.host === 'object' &&
    session.host !== null
  ) {
    return session.host
  }
  return undefined
}

type TipRegistryModule = typeof import('../../services/tips/tipRegistry.js') & {
  getBuiltInTips?: () => Tip[]
  getAllBuiltInTips?: () => Tip[]
  TIP_REGISTRY?: readonly Tip[]
  BUILT_IN_TIPS?: readonly Tip[]
}

async function readBuiltInTips(
  registry: TipRegistryModule,
  tipCtx: TipContext,
): Promise<readonly Tip[]> {
  if (typeof registry.getBuiltInTips === 'function') {
    return registry.getBuiltInTips()
  }
  if (typeof registry.getAllBuiltInTips === 'function') {
    return registry.getAllBuiltInTips()
  }
  if (Array.isArray(registry.TIP_REGISTRY)) {
    return registry.TIP_REGISTRY
  }
  if (Array.isArray(registry.BUILT_IN_TIPS)) {
    return registry.BUILT_IN_TIPS
  }
  const probeHost = {}
  registry.spinnerTipHostFromContext({
    session: { host: probeHost },
  }).marketplacePluginTips = Promise.resolve([])
  return registry.getRelevantTips({
    ...tipCtx,
    session: { host: probeHost },
  })
}

export function sourcedTipOf(tip: Tip, ctx: TipContext): SourcedTip {
  return {
    id: tip.id,
    cooldownSessions: tip.cooldownSessions,
    ...(tip.maxLifetimeShows !== undefined && {
      maxLifetimeShows: tip.maxLifetimeShows,
    }),
    ...(tip.priority !== undefined && { priority: tip.priority }),
    ...(tip.label !== undefined && { label: tip.label }),
    ...(tip.advertisedCommand !== undefined && {
      advertisedCommand: tip.advertisedCommand,
    }),
    providerAgnostic: tip.providerAgnostic === true,
    isRelevant: () => tip.isRelevant(ctx),
    content: () =>
      tip.content({
        session: ctx.session,
        theme: ctx.theme,
        storageV5: ctx.storageV5,
      }),
  }
}

export function hostSourcesOf(host: object, slot: SeatedSpinnerTipSlot) {
  const rawCtx = slot.context()
  const storageV5 = slot.storageV5()
  const ctxSessionHost = extractSessionHost(rawCtx.session)
  const effectiveHost = ctxSessionHost ?? host
  const tipCtx: TipContext = {
    ...(rawCtx.theme !== undefined && {
      theme: rawCtx.theme as TipContext['theme'],
    }),
    ...(rawCtx.readFileState !== undefined && {
      readFileState: rawCtx.readFileState as TipContext['readFileState'],
    }),
    ...(rawCtx.bashTools instanceof Set && {
      bashTools: rawCtx.bashTools as Set<string>,
    }),
    ...(rawCtx.bashHosts instanceof Set && {
      bashHosts: rawCtx.bashHosts as Set<string>,
    }),
    ...(rawCtx.storageV5 !== undefined && { storageV5: rawCtx.storageV5 }),
    session: { host: effectiveHost },
  }
  const byId = new Map<string, Tip>()
  function remember(tips: readonly Tip[]): readonly Tip[] {
    for (const tip of tips) {
      byId.set(tip.id, tip)
    }
    return tips
  }
  return {
    candidates: async () => {
      const registry =
        require('../../services/tips/tipRegistry.js') as TipRegistryModule
      const builtInTips = await readBuiltInTips(registry, tipCtx)
      const marketplaceTips =
        ctxSessionHost !== undefined
          ? await registry
              .spinnerTipHostFromContext(tipCtx)
              .getMarketplacePluginTips(tipCtx.storageV5)
          : []
      return remember([...builtInTips, ...marketplaceTips]).map(tip =>
        sourcedTipOf(tip, tipCtx),
      )
    },
    orgTips: async () => ({ tips: [] as SourcedTip[], trustedCount: 0 }),
    isDefaultSuppressed: () => false,
    isFirstPartyBackend: () =>
      getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl(),
    isCommandOffered: (cmd: string) => advertisedCommandAllowed(cmd),
    sessionsSinceShown: (id: string) => getSessionsSinceLastShown(id),
    lifetimeShown: (id: string) => getTipLifetimeShownCount(id),
    hasFailed: (id: string) =>
      spinnerTipHostFromContext({
        session: { host: effectiveHost },
      }).failedTipIds.has(id),
    markFailed: (id: string) => {
      spinnerTipHostFromContext({
        session: { host: effectiveHost },
      }).failedTipIds.add(id)
    },
    show: (payload: { text: string; label?: string } | undefined) => {
      slot.show(payload)
    },
    record: (id: string) => {
      const tip = byId.get(id)
      if (tip === undefined) return
      logForDebugging(`tips plugin: showing spinner tip ${id}`)
      recordShownTip(tip, 'spinner', storageV5)
    },
    report: (err: unknown, message: string) => {
      logError(withTelemetryMessage(toError(err), message))
    },
  }
}

export function tipHostOf(): {
  install: (cb: (sources: ReturnType<typeof hostSourcesOf>) => void) => void
} {
  const host = getReplDiffHost()
  return {
    install: cb => {
      getSpinnerTipPluginSeat(host).install(slot => {
        cb(hostSourcesOf(host, slot))
      })
    },
  }
}

export function hostModuleOf(mod: {
  registerHooks?: (
    hookOn: unknown,
    tipHost: ReturnType<typeof tipHostOf>,
  ) => unknown
}): { register: (on: unknown) => unknown } {
  return {
    register: (on: unknown) => mod.registerHooks?.(on, tipHostOf()),
  }
}

export function registerTipsBuiltinPlugin(): void {
  const hostModule = {
    register: (on: unknown) => {
      const mod =
        require('../../../vendor/claude-code-mods/mods/cc-plugin-tips/hooks/register.ts') as {
          registerHooks?: (
            hookOn: unknown,
            tipHost: ReturnType<typeof tipHostOf>,
          ) => unknown
        }
      return hostModuleOf(mod).register(on)
    },
  }
  registerBuiltinPlugin({
    name: TIPS_PLUGIN_NAME,
    description: TIPS_PLUGIN_DESCRIPTION,
    // gold uS omits defaultEnabled → PZ ?? true
    isAvailable: isTipsPluginAvailable,
    hooksModule: leftoverFu(
      join(
        import.meta.dir,
        '../../../vendor/claude-code-mods/mods/cc-plugin-tips',
      ),
      hostModule,
      () => ({
        scan: {
          hooks: ['session.start'],
          calls: ['env.get', 'settings.read'],
          env: {
            reads: ['CLAUDE_CODE_FORCE_TIP_ID', 'USER_TYPE'],
            writes: [],
          },
        },
        files: {},
      }),
    ),
  })
}
