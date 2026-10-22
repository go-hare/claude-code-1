/**
 * densable 2.1.289 hop: `mc` / `fQe` / `Nas` / `ESt` / `wtr` / `Fas` /
 * `Fn` / `$e` / `se` / `Mn` / `Mo.to`.
 * `next.to(e, "append")` lays a floor; `Mn` skips handlers between the
 * floor's from and to (user sits between prepend and append).
 */

export const HOOK_TIER_ORDER = Object.freeze([
  'prepend',
  'user',
  'append',
  'builtin',
  'core',
] as const)

export type HookTier = (typeof HOOK_TIER_ORDER)[number]

export type HopFloor = {
  from: HookTier
  to: HookTier
  plugin: string
}

/** densable `mQe`. */
export const EMPTY_HOP_FLOORS: readonly HopFloor[] = Object.freeze([])

/** densable `S` / `USER_REACHABLE_TIERS`. */
export const USER_REACHABLE_TIERS = Object.freeze([
  'user',
  'builtin',
  'core',
] as const)

export type HopHandler = {
  name: string
  tier?: HookTier
  isManaged?: boolean
  isCore?: boolean
  isHop?: boolean
}

/** densable `fQe`. */
export function hookTierIndex(tier: string): number {
  return (HOOK_TIER_ORDER as readonly string[]).indexOf(tier)
}

/** densable `$e`. */
export function handlerTier(handler: HopHandler): HookTier {
  if (handler.isCore === true) return 'core'
  if (handler.isManaged === true) return 'prepend'
  return handler.tier ?? 'user'
}

/** densable `se`. */
export function handlerSitsAboveFloors(handler: HopHandler): boolean {
  return handler.isCore === true || handler.isManaged === true
}

/** densable `ESt`. */
export function tiersADispatchContinuesAt(tier: HookTier): HookTier[] {
  return (
    {
      prepend: ['append', 'builtin', 'core'],
      user: [],
      append: ['core'],
      builtin: [],
      core: [],
    } as const
  )[tier].slice()
}

/** densable `wtr`. */
export function isContinuationTier(tier: string): tier is HookTier {
  return tiersADispatchContinuesAt('prepend').includes(tier as HookTier)
}

/** densable `Nas`. */
export function floorThatBypasses(
  floors: readonly HopFloor[],
  tier: string,
): string | undefined {
  const index = hookTierIndex(tier)
  return floors.find(
    floor =>
      hookTierIndex(floor.from) < index && index < hookTierIndex(floor.to),
  )?.plugin
}

/** densable `Fas`. */
export function addHopFloor(
  floors: readonly HopFloor[],
  floor: HopFloor,
): HopFloor[] {
  const to = floors.reduce(
    (furthest, item) =>
      hookTierIndex(item.to) > hookTierIndex(furthest) ? item.to : furthest,
    floor.to,
  )
  return Object.freeze([
    ...floors,
    Object.freeze({ ...floor, to }),
  ]) as HopFloor[]
}

/** densable `Fn`. */
export function floorsAfterNextTo(
  floors: readonly HopFloor[],
  tiers: readonly string[],
  origin: { plugin: string; tier: HookTier },
): HopFloor[] {
  if (tiers.length === 0) {
    throw new Error(`${origin.plugin}: next.to() names no tier`)
  }
  const allowed = tiersADispatchContinuesAt(origin.tier)
  return [...tiers].toReversed().reduce(
    (next, tier) => {
      if (!isContinuationTier(tier)) {
        throw new Error(
          `${origin.plugin}: next.to names "${String(tier)}", which is not a tier a dispatch continues at (append, builtin, core)`,
        )
      }
      if (allowed.length === 0) {
        throw new Error(
          `${origin.plugin}: next.to is available to managed plugins (prependPlugins / appendPlugins) only, not to a ${origin.tier} hook`,
        )
      }
      if (!allowed.includes(tier)) {
        throw new Error(
          `${origin.plugin}: next.to("${tier}") skips nothing from ${origin.tier}; a ${origin.tier} hook may continue at ${allowed.join(', ')}`,
        )
      }
      return addHopFloor(next, {
        from: origin.tier,
        to: tier,
        plugin: origin.plugin,
      })
    },
    [...floors],
  )
}

/** densable `Mn`. `undefined` = run; string = bypassed by that plugin. */
export function hopBypassReason(
  handler: HopHandler,
  floors: readonly HopFloor[],
): string | undefined {
  if (floors.length === 0 || handlerSitsAboveFloors(handler)) return undefined
  const tier = handlerTier(handler)
  const plugin = floorThatBypasses(floors, tier)
  if (plugin === undefined) return undefined
  return `bypassed by ${plugin}`
}

/** densable `nL`. */
export function restorePinnedKeys(
  keys: readonly string[],
  passed: Record<string, unknown>,
  original: Record<string, unknown>,
): Record<string, unknown> {
  const missing = keys.filter(
    key => !Object.hasOwn(passed, key) && Object.hasOwn(original, key),
  )
  if (missing.length === 0) return passed
  const next = { ...passed }
  for (const key of missing) next[key] = original[key]
  return next
}

/** densable `Bn` pin (JSON). */
export function pinValue(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/** densable `ua.checkArgument`. */
export function checkToolDescribeArgument(
  passed: Record<string, unknown>,
  original: Record<string, unknown>,
): string | undefined {
  if (typeof passed.tool !== 'string') return 'no { tool }'
  if (passed.tool !== original.tool) {
    return 'a changed tool (the engine caches the description by it)'
  }
  if (pinValue(passed.provider) !== pinValue(original.provider)) {
    return 'a changed provider (pinned: who provides the tool is a fact)'
  }
  if (
    !(passed.isDeferred === undefined || typeof passed.isDeferred === 'boolean')
  ) {
    return 'an isDeferred that is not a boolean'
  }
  return typeof passed.description === 'string'
    ? undefined
    : 'no { description }'
}

export type FunctionHookNext = ((value?: unknown) => Promise<unknown>) & {
  to: (value: unknown, ...tiers: string[]) => Promise<unknown>
}

/** densable `d` / `pastUsers`. */
export function pastUsers(
  event: Record<string, unknown>,
  next: FunctionHookNext,
): Promise<unknown> {
  const provider = event.provider
  const tier =
    typeof provider === 'object' &&
    provider !== null &&
    'tier' in provider &&
    typeof provider.tier === 'string'
      ? provider.tier
      : undefined
  if (
    tier !== undefined &&
    (USER_REACHABLE_TIERS as readonly string[]).includes(tier)
  ) {
    return next(event)
  }
  return next.to(event, 'append')
}
