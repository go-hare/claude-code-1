import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

// Session-scoped cache of rendered tool schemas. Tool schemas render at server
// position 2 (before system prompt), so any byte-level change busts the entire
// ~11K-token tool block AND everything downstream. GrowthBook gate flips
// (tengu_tool_pear, tengu_fgts), MCP reconnects, or dynamic content in
// tool.prompt() all cause this churn. Memoizing per-session locks the schema
// bytes at first render — mid-session GB refreshes no longer bust the cache.
//
// Lives in a leaf module so auth.ts can clear it without importing api.ts
// (which would create a cycle via plans→settings→file→growthbook→config→
// bridgeEnabled→auth). GB is injected via i_/Bl (same slot as file.ts),
// never imported here. Ip lazily requires betas (jN) for the same reason.
//
// densable 2.1.248 #8 — official r_ @180125072 (247 mR has no keepAcross /
// no dropInFlight). Gold: gold-248-unk-8-ip.txt

export type CachedSchema = BetaTool & {
  strict?: boolean
  eager_input_streaming?: boolean
}

/**
 * densable r_ @180125072
 * `class r_{byKey=new Map;keepAcrossTokenChanges=void 0;generation=0;
 * get/stamp/register;invalidateAll(){clear,gen++};
 * dropInFlightComposes(){gen++}}`
 */
export class r_ {
  byKey = new Map<string, CachedSchema>()
  keepAcrossTokenChanges: boolean | undefined = undefined
  generation = 0
  get(e: string): CachedSchema | undefined {
    return this.byKey.get(e)
  }
  stamp(): number {
    return this.generation
  }
  register(e: string, t: CachedSchema, r: number): void {
    if (r === this.generation) this.byKey.set(e, t)
  }
  get size(): number {
    return this.byKey.size
  }
  invalidateAll(): void {
    this.byKey.clear()
    this.generation += 1
  }
  dropInFlightComposes(): void {
    this.generation += 1
  }
}

const Vx = new r_()

/** densable kn @180125416 — leftover is process-global (not per-host K). */
export function kn(): r_ {
  return Vx
}

export function getToolSchemaCache(): Map<string, CachedSchema> {
  return kn().byKey
}

/** densable Gx */
export const Gx = 'tengu_still_kestrel'

type StillKestrelReader = (
  gate: string,
  fallback: boolean,
) => boolean | undefined

/** densable Bl — leftover GrowthBook getter, registered via i_. */
let Bl: StillKestrelReader | null = null

/**
 * densable i_ — `function i_(e){let t=Bl;return Bl=e,t}`
 * Swap the tengu_still_kestrel reader; returns the previous.
 */
export function i_(e: StillKestrelReader | null): StillKestrelReader | null {
  let t = Bl
  Bl = e
  return t
}

/**
 * densable s_ @180125738 sha=4fb6f117e0cecea6
 * `function s_(){let e=kn();if(e.keepAcrossTokenChanges!==void 0)return
 * e.keepAcrossTokenChanges;let t=Bl?.(Gx,!1);if(t===void 0)return!1;
 * return e.keepAcrossTokenChanges=t,t}`
 */
export function s_(): boolean {
  let e = kn()
  if (e.keepAcrossTokenChanges !== undefined) return e.keepAcrossTokenChanges
  let t = Bl?.(Gx, false)
  if (t === undefined) return false
  e.keepAcrossTokenChanges = t
  return t
}

/**
 * densable IW @180125586 sha=a2343b0146ed09ed
 * `function IW(){kn().invalidateAll()}`
 */
export function IW(): void {
  kn().invalidateAll()
}

/** leftover alias — official IW */
export const clearToolSchemaCache = IW

/**
 * densable o_ @180125621 sha=7a1425b27219fa53
 * `function o_(){kn().dropInFlightComposes()}`
 */
export function o_(): void {
  kn().dropInFlightComposes()
}

/**
 * densable Ip @180712775 sha=043f2d44f49faba4
 * `function Ip(){if(jN(),!s_())IW();else o_()}`
 * jN leftover = clearBetasCaches
 */
export function Ip(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { clearBetasCaches } =
    require('./betas.js') as typeof import('./betas.js')
  // biome-ignore lint/complexity/noCommaOperator: gold Ip `if(jN(),!s_())IW()`
  if ((clearBetasCaches(), !s_())) IW()
  else o_()
}
