/**
 * densable 2.1.218 #11 — permissionLayers last-wins consumers (fdo island).
 *
 * densable SEA ~229312811:
 *   et(fdo, {
 *     getUltracodeRequested: yKr,
 *     getToolPermissionContext: bn,
 *     getThinkingConfig: _Kr,
 *     getMainLoopModel: qO,
 *     getEffortValue: bb,
 *     applyContextLayers: yor,
 *   })
 *
 * Sticky Me injects layers; these readers materialize effective mode/model/
 * thinking/effort for the turn. Without them, sticky layers are inert.
 */

import type { ToolPermissionContext, ToolUseContext } from '../Tool.js'
import { getAgentContext } from '../utils/agentContext.js'
import { type EffortValue, pdSessionEffort } from '../utils/effort.js'
import type { PermissionMode } from '../types/permissions.js'
import type { ThinkingConfig } from '../utils/thinking.js'
import {
  applyPollEventDeliveryGuard,
  isBypassPermissionsModeDisabled,
} from '../utils/permissions/permissionSetup.js'
import type { HostPermissionLayer } from './hostPermissionLayers.js'

/** densable Mo-style unique preserve-order merge for rule command lists. */
export function uniqueStrings(items: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/** densable Uls — append allowed tools into alwaysAllowRules.command */
export function mergeAllowedToolsLayer(
  ctx: ToolPermissionContext,
  allowedTools: readonly string[],
): ToolPermissionContext {
  if (allowedTools.length === 0) return ctx
  const prev = ctx.alwaysAllowRules.command ?? []
  return {
    ...ctx,
    alwaysAllowRules: {
      ...ctx.alwaysAllowRules,
      command: uniqueStrings([...prev, ...allowedTools]),
    },
  }
}

/** densable qls — append disallowed tools into alwaysDenyRules.command */
export function mergeDisallowedToolsLayer(
  ctx: ToolPermissionContext,
  disallowedTools: readonly string[],
): ToolPermissionContext {
  if (disallowedTools.length === 0) return ctx
  const prev = ctx.alwaysDenyRules.command ?? []
  return {
    ...ctx,
    alwaysDenyRules: {
      ...ctx.alwaysDenyRules,
      command: uniqueStrings([...prev, ...disallowedTools]),
    },
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

/**
 * densable bn / getToolPermissionContext — walk permissionLayers last-wins for
 * permission_mode / allowed_tools / disallowed_tools / avoid_prompts /
 * working_directory. model / max_thinking_tokens / flag_settings / effort are
 * ignored here (other readers).
 */
export function getToolPermissionContextFromLayers(
  toolUseContext: Pick<ToolUseContext, 'getAppState' | 'permissionLayers'> & {
    agentId?: ToolUseContext['agentId']
  },
): ToolPermissionContext {
  const rawBase = toolUseContext.getAppState().toolPermissionContext
  // Official 2.1.325 #2319: during poll-event delivery (`pollEventDeliveryGuard`)
  // or inside a background/async subagent, slash-command `allowed_tools` grants
  // must NOT apply — clear command-scoped allow rules and skip `allowed_tools` layers.
  const agentCtx = getAgentContext()
  const isBackgroundSubagent =
    agentCtx !== undefined &&
    (agentCtx.isBackgroundAgent === true ||
      (agentCtx.agentType === 'subagent' && agentCtx.isAsync === true))
  const isPollGuarded =
    (
      rawBase as ToolPermissionContext & {
        pollEventDeliveryGuard?: boolean
      }
    ).pollEventDeliveryGuard === true
  const skipAllowedToolsLayers = isPollGuarded || isBackgroundSubagent
  const base = skipAllowedToolsLayers
    ? applyPollEventDeliveryGuard(rawBase)
    : rawBase
  const layers = toolUseContext.permissionLayers
  if (!layers || layers.length === 0) return base

  let t: ToolPermissionContext = base
  // densable: findLast working_directory — only the last one applies
  let lastWorkingDir:
    | { kind: 'working_directory'; directory: string }
    | undefined
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (layer && layer.kind === 'working_directory') {
      lastWorkingDir = layer as { kind: 'working_directory'; directory: string }
      break
    }
  }

  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue
    switch (layer.kind) {
      case 'allowed_tools': {
        if (skipAllowedToolsLayers) {
          break
        }
        const tools = asStringArray(
          (layer as { allowedTools?: unknown }).allowedTools,
        )
        t = mergeAllowedToolsLayer(t, tools)
        break
      }
      case 'disallowed_tools': {
        const tools = asStringArray(
          (layer as { disallowedTools?: unknown }).disallowedTools,
        )
        t = mergeDisallowedToolsLayer(t, tools)
        break
      }
      case 'avoid_prompts': {
        // #1703 (official `sI(o)`): latch both shouldAvoidPermissionPrompts and
        // avoidsPromptsByNature so an avoid_prompts layer is distinguished from
        // interactive `permissions.denyInsteadOfPrompting`.
        const alreadyAvoidsByNature =
          t.shouldAvoidPermissionPrompts === true &&
          (t.denyInsteadOfPrompting !== true ||
            t.avoidsPromptsByNature === true)
        if (!alreadyAvoidsByNature) {
          t = {
            ...t,
            shouldAvoidPermissionPrompts: true,
            avoidsPromptsByNature: true,
          }
        }
        break
      }
      case 'permission_mode': {
        const mode = (layer as { mode?: unknown }).mode
        if (typeof mode !== 'string') break
        // densable: bypassPermissions skipped when org-disabled (_F/jls) OR
        // isBypassPermissionsModeAvailable is false
        if (
          mode === 'bypassPermissions' &&
          (isBypassPermissionsModeDisabled() ||
            !t.isBypassPermissionsModeAvailable)
        ) {
          break
        }
        t = { ...t, mode: mode as PermissionMode }
        break
      }
      case 'working_directory': {
        if (layer !== lastWorkingDir) break
        const directory = (layer as { directory?: unknown }).directory
        if (typeof directory !== 'string' || directory.length === 0) break
        if (t.additionalWorkingDirectories.has(directory)) break
        t = {
          ...t,
          additionalWorkingDirectories: new Map([
            ...t.additionalWorkingDirectories,
            [directory, { path: directory, source: 'session' as const }],
          ]),
        }
        break
      }
      case 'effort':
      case 'model':
      case 'max_thinking_tokens':
      case 'flag_settings':
        break
      default:
        break
    }
  }
  return t
}

/** Resolve session/settings effort for the effective model, then last effort layer wins. */
export function getEffortValueFromLayers(
  toolUseContext: Pick<
    ToolUseContext,
    'getAppState' | 'permissionLayers' | 'options'
  >,
): EffortValue | undefined {
  const model = getMainLoopModelFromLayers(toolUseContext)
  let effort = pdSessionEffort(toolUseContext.getAppState(), model)
  const layers = toolUseContext.permissionLayers
  if (!layers) return effort
  for (const layer of layers) {
    if (layer && layer.kind === 'effort') {
      effort = (layer as { effort?: EffortValue }).effort
    }
  }
  return effort
}

/** densable qO / getMainLoopModel — last model layer wins over options */
export function getMainLoopModelFromLayers(
  toolUseContext: Pick<ToolUseContext, 'options' | 'permissionLayers'>,
): string {
  let model = toolUseContext.options.mainLoopModel
  const layers = toolUseContext.permissionLayers
  if (!layers) return model
  for (const layer of layers) {
    if (layer && layer.kind === 'model') {
      const next = (layer as { mainLoopModel?: unknown }).mainLoopModel
      if (typeof next === 'string') model = next
    }
  }
  return model
}

/**
 * densable YDu — maxThinkingTokens number → ThinkingConfig.
 * 0 → disabled; otherwise enabled with budgetTokens.
 */
export function thinkingConfigFromMaxTokens(
  maxThinkingTokens: number | null | undefined,
): ThinkingConfig {
  if (maxThinkingTokens === 0) return { type: 'disabled' }
  if (typeof maxThinkingTokens === 'number') {
    return { type: 'enabled', budgetTokens: maxThinkingTokens }
  }
  // densable only calls YDu when layer present; defensive fallback
  return { type: 'disabled' }
}

/** densable _Kr / getThinkingConfig — last max_thinking_tokens layer wins */
export function getThinkingConfigFromLayers(
  toolUseContext: Pick<ToolUseContext, 'options' | 'permissionLayers'>,
): ThinkingConfig {
  let config = toolUseContext.options.thinkingConfig
  const layers = toolUseContext.permissionLayers
  if (!layers) return config
  for (const layer of layers) {
    if (layer && layer.kind === 'max_thinking_tokens') {
      config = thinkingConfigFromMaxTokens(
        (layer as { maxThinkingTokens?: number | null }).maxThinkingTokens,
      )
    }
  }
  return config
}

/** densable yKr / getUltracodeRequested */
export function getUltracodeRequestedFromLayers(
  toolUseContext: Pick<ToolUseContext, 'getAppState'>,
): boolean {
  return toolUseContext.getAppState().ultracode === true
}

/**
 * densable yor / applyContextLayers — append layers onto toolUseContext and
 * project last model + max_thinking_tokens into options (last-wins).
 */
export function applyContextLayers(
  toolUseContext: ToolUseContext,
  layers: HostPermissionLayer[],
): ToolUseContext {
  if (layers.length === 0) return toolUseContext
  const permissionLayers = toolUseContext.permissionLayers
    ? [...toolUseContext.permissionLayers, ...layers]
    : [...layers]

  let mainLoopModel: string | undefined
  let thinkingConfig: ThinkingConfig | undefined
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!
    if (layer.kind === 'model' && mainLoopModel === undefined) {
      mainLoopModel = layer.mainLoopModel
    }
    if (layer.kind === 'max_thinking_tokens' && thinkingConfig === undefined) {
      thinkingConfig = thinkingConfigFromMaxTokens(layer.maxThinkingTokens)
    }
  }

  const optionsTouched =
    mainLoopModel !== undefined || thinkingConfig !== undefined
  return {
    ...toolUseContext,
    permissionLayers,
    ...(optionsTouched
      ? {
          options: {
            ...toolUseContext.options,
            ...(mainLoopModel !== undefined ? { mainLoopModel } : {}),
            ...(thinkingConfig !== undefined ? { thinkingConfig } : {}),
          },
        }
      : {}),
  }
}
