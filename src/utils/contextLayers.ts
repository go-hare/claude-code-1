/**
 * densable contextLayers / Ter / Tn residual (behavior only — no analytics).
 *
 * Tools may return `contextLayers` that are aggregated per tool_use id and
 * merged into ToolUseContext via `applyContextLayers` (densable Ter):
 * - append to permissionLayers stack
 * - last model layer → options.mainLoopModel
 * - last max_thinking_tokens → options.thinkingConfig
 *
 * Permission checks then fold the stack into ToolPermissionContext via
 * `applyPermissionLayers` (densable Tn): allowed/disallowed tools, avoid_prompts,
 * permission_mode, working_directory (last cwd layer only).
 *
 * densable P_ / X$ / fqr — resolveEffortValue / resolveMainLoopModel /
 * resolveThinkingConfig read the last matching layer over base state/options.
 */

import type {
  PermissionMode,
  ToolPermissionContext,
} from '../types/permissions.js'
import type { EffortValue } from './effort.js'
import type { ThinkingConfig } from './thinking.js'

/** densable layer kinds emitted by Skill / EnterWorktree / forked agents / etc. */
export type ContextLayer =
  | {
      kind: 'allowed_tools'
      allowedTools: string[]
    }
  | {
      kind: 'disallowed_tools'
      disallowedTools: string[]
    }
  | {
      kind: 'model'
      mainLoopModel: string
    }
  | {
      kind: 'max_thinking_tokens'
      maxThinkingTokens: number
    }
  | {
      kind: 'working_directory'
      directory: string
    }
  | {
      kind: 'avoid_prompts'
    }
  | {
      kind: 'permission_mode'
      mode: PermissionMode
    }
  | {
      kind: 'effort'
      effort: EffortValue
    }
  | {
      kind: 'flag_settings'
      settings: Record<string, unknown>
    }

/** densable Gus — maxThinkingTokens 0 → disabled, else enabled budget. */
export function thinkingConfigFromMaxTokens(
  maxThinkingTokens: number,
): ThinkingConfig {
  if (maxThinkingTokens === 0) {
    return { type: 'disabled' }
  }
  return { type: 'enabled', budgetTokens: maxThinkingTokens }
}

/** densable Ho — unique string list (preserve first-seen order). */
function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/**
 * densable udo — append command-source alwaysAllowRules.
 */
export function withAllowedToolRules(
  ctx: ToolPermissionContext,
  tools: readonly string[],
): ToolPermissionContext {
  if (tools.length === 0) return ctx
  return {
    ...ctx,
    alwaysAllowRules: {
      ...ctx.alwaysAllowRules,
      command: uniqueStrings([
        ...(ctx.alwaysAllowRules.command ?? []),
        ...tools,
      ]),
    },
  }
}

/**
 * densable ddo — append command-source alwaysDenyRules.
 */
export function withDeniedToolRules(
  ctx: ToolPermissionContext,
  tools: readonly string[],
): ToolPermissionContext {
  if (tools.length === 0) return ctx
  return {
    ...ctx,
    alwaysDenyRules: {
      ...ctx.alwaysDenyRules,
      command: uniqueStrings([
        ...(ctx.alwaysDenyRules.command ?? []),
        ...tools,
      ]),
    },
  }
}

/**
 * densable UM / $rs thin — bypass layer blocked by org gate or settings.
 * Cached GB + settings only (no network). Matches densable sync check.
 */
export function isBypassPermissionsLayerBlocked(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } =
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    if (
      checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
        'tengu_disable_bypass_permissions_mode',
      )
    ) {
      return true
    }
  } catch {
    // optional in tests
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSettings_DEPRECATED } =
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    const settings = getSettings_DEPRECATED() || {}
    if (settings.permissions?.disableBypassPermissionsMode === 'disable') {
      return true
    }
  } catch {
    // optional in tests
  }
  return false
}

/**
 * densable Tn — fold permissionLayers into ToolPermissionContext.
 * Empty / missing layers → identity. Does not mutate input.
 *
 * - allowed_tools / disallowed_tools → alwaysAllow/DenyRules.command (unique)
 * - avoid_prompts → shouldAvoidPermissionPrompts
 * - permission_mode → mode (bypass skipped when blocked / unavailable)
 * - working_directory → last layer only; session additionalWorkingDirectories
 * - effort / model / max_thinking_tokens / flag_settings → no-op here
 *   (model/thinking applied by Ter; effort via separate densable P_)
 */
export function applyPermissionLayers(
  base: ToolPermissionContext,
  layers: readonly ContextLayer[] | undefined | null,
): ToolPermissionContext {
  if (!layers || layers.length === 0) return base

  let ctx: ToolPermissionContext = base
  const lastWorking = [...layers]
    .reverse()
    .find(l => l.kind === 'working_directory')

  for (const layer of layers) {
    switch (layer.kind) {
      case 'allowed_tools':
        ctx = withAllowedToolRules(ctx, layer.allowedTools)
        break
      case 'disallowed_tools':
        ctx = withDeniedToolRules(ctx, layer.disallowedTools)
        break
      case 'avoid_prompts':
        if (!ctx.shouldAvoidPermissionPrompts) {
          ctx = { ...ctx, shouldAvoidPermissionPrompts: true }
        }
        break
      case 'permission_mode': {
        if (
          layer.mode === 'bypassPermissions' &&
          (isBypassPermissionsLayerBlocked() ||
            !ctx.isBypassPermissionsModeAvailable)
        ) {
          break
        }
        ctx = { ...ctx, mode: layer.mode }
        break
      }
      case 'working_directory':
        if (
          layer === lastWorking &&
          !ctx.additionalWorkingDirectories.has(layer.directory)
        ) {
          ctx = {
            ...ctx,
            additionalWorkingDirectories: new Map([
              ...ctx.additionalWorkingDirectories,
              [
                layer.directory,
                { path: layer.directory, source: 'session' as const },
              ],
            ]),
          }
        }
        break
      case 'effort':
      case 'model':
      case 'max_thinking_tokens':
      case 'flag_settings':
        break
    }
  }
  return ctx
}

/**
 * densable Tn(e) — resolve layered toolPermissionContext from a ToolUseContext-like.
 */
export function resolveToolPermissionContext(context: {
  permissionLayers?: ContextLayer[] | null
  getAppState: () => { toolPermissionContext: ToolPermissionContext }
}): ToolPermissionContext {
  return applyPermissionLayers(
    context.getAppState().toolPermissionContext,
    context.permissionLayers,
  )
}

/**
 * Wrap ToolUseContext so getAppState().toolPermissionContext reflects layers.
 * Identity when no layers. Used at permission-check entry (hasPermissions / rule check).
 */
export function withPermissionLayersApplied<
  T extends {
    permissionLayers?: ContextLayer[] | null
    getAppState: () => {
      toolPermissionContext: ToolPermissionContext
      [key: string]: unknown
    }
  },
>(context: T): T {
  const layers = context.permissionLayers
  if (!layers || layers.length === 0) return context
  const baseGetAppState = context.getAppState.bind(context)
  return {
    ...context,
    getAppState: () => {
      const state = baseGetAppState()
      return {
        ...state,
        toolPermissionContext: applyPermissionLayers(
          state.toolPermissionContext,
          layers,
        ),
      }
    },
  }
}

/**
 * densable Ter — merge layers into tool-use context.
 * Empty layers → identity. Does not mutate input.
 */
export function applyContextLayers<
  T extends {
    permissionLayers?: ContextLayer[]
    options: {
      mainLoopModel: string
      thinkingConfig: ThinkingConfig
      [key: string]: unknown
    }
  },
>(ctx: T, layers: readonly ContextLayer[]): T {
  if (layers.length === 0) return ctx

  const permissionLayers = ctx.permissionLayers
    ? [...ctx.permissionLayers, ...layers]
    : [...layers]

  let mainLoopModel: string | undefined
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (layer?.kind === 'model') {
      mainLoopModel = layer.mainLoopModel
      break
    }
  }

  let thinkingConfig: ThinkingConfig | undefined
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (layer?.kind === 'max_thinking_tokens') {
      thinkingConfig = thinkingConfigFromMaxTokens(layer.maxThinkingTokens)
      break
    }
  }

  if (mainLoopModel === undefined && thinkingConfig === undefined) {
    return {
      ...ctx,
      permissionLayers,
    }
  }

  return {
    ...ctx,
    permissionLayers,
    options: {
      ...ctx.options,
      ...(mainLoopModel !== undefined && { mainLoopModel }),
      ...(thinkingConfig !== undefined && { thinkingConfig }),
    },
  }
}

/**
 * densable P_ — last `effort` layer wins over AppState.effortValue.
 */
export function resolveEffortValue(context: {
  permissionLayers?: ContextLayer[] | null
  getAppState: () => { effortValue?: EffortValue }
}): EffortValue | undefined {
  let value = context.getAppState().effortValue
  for (const layer of context.permissionLayers ?? []) {
    if (layer.kind === 'effort') {
      value = layer.effort
    }
  }
  return value
}

/**
 * densable X$ — last `model` layer wins over options.mainLoopModel.
 */
export function resolveMainLoopModel(context: {
  permissionLayers?: ContextLayer[] | null
  options: { mainLoopModel: string }
}): string {
  let model = context.options.mainLoopModel
  for (const layer of context.permissionLayers ?? []) {
    if (layer.kind === 'model') {
      model = layer.mainLoopModel
    }
  }
  return model
}

/**
 * densable fqr — last `max_thinking_tokens` layer wins over options.thinkingConfig.
 */
export function resolveThinkingConfig(context: {
  permissionLayers?: ContextLayer[] | null
  options: { thinkingConfig: ThinkingConfig }
}): ThinkingConfig {
  let config = context.options.thinkingConfig
  for (const layer of context.permissionLayers ?? []) {
    if (layer.kind === 'max_thinking_tokens') {
      config = thinkingConfigFromMaxTokens(layer.maxThinkingTokens)
    }
  }
  return config
}
