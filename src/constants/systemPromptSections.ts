import {
  clearBetaHeaderLatches,
  clearSystemPromptSectionState,
  getPromptRenderEpoch,
  getSystemPromptSectionCache,
  setSystemPromptSectionCacheEntry,
} from '../bootstrap/state.js'

type ComputeFn = () => string | null | Promise<string | null>

export type SystemPromptSection = {
  name: string
  compute: ComputeFn
  cacheBreak: boolean
}

type PromptSectionResolverFn = (
  name: string,
  text: string | null,
  hookOrigin?: string,
) => Promise<string | null>

let promptSectionResolver: PromptSectionResolverFn | undefined
let promptSectionInvalidator: (() => void) | undefined
let sectionGeneration = 0

/**
 * densable fEn — register a resolver for `prompt.section` hook evaluation.
 */
export function setPromptSectionResolver(
  resolver: PromptSectionResolverFn | undefined,
): void {
  promptSectionResolver = resolver
}

/**
 * densable UQe — run registered `prompt.section` resolver if present.
 */
export function resolvePromptSection(
  name: string,
  text: string | null,
  hookOrigin?: string,
): Promise<string | null> {
  return (
    promptSectionResolver?.(name, text, hookOrigin) ?? Promise.resolve(text)
  )
}

/**
 * densable uEn — register an invalidator callback for prompt sections.
 */
export function setPromptSectionInvalidator(
  invalidator: (() => void) | undefined,
): void {
  promptSectionInvalidator = invalidator
}

/**
 * densable BQe — invoke registered prompt section invalidator if present.
 */
export function invalidatePromptSections(): void {
  promptSectionInvalidator?.()
}

/**
 * densable FQe — strip `:variant` suffix from section cache key so
 * `prompt.section` hook resolution matches the canonical base name while the
 * section cache key preserves the full name.
 */
export function stripSectionVariantSuffix(name: string): string {
  return name.replace(/:.*$/su, '')
}

/**
 * Create a memoized system prompt section.
 * Computed once, cached until /clear or /compact.
 */
export function systemPromptSection(
  name: string,
  compute: ComputeFn,
): SystemPromptSection {
  return { name, compute, cacheBreak: false }
}

/**
 * Create a volatile system prompt section that recomputes every turn.
 * This WILL break the prompt cache when the value changes.
 * Requires a reason explaining why cache-breaking is necessary.
 */
export function DANGEROUS_uncachedSystemPromptSection(
  name: string,
  compute: ComputeFn,
  _reason: string,
): SystemPromptSection {
  return { name, compute, cacheBreak: true }
}

function getCurrentSectionEpoch(): number {
  const hostEpoch =
    typeof getPromptRenderEpoch === 'function' ? getPromptRenderEpoch() : 0
  return hostEpoch + sectionGeneration
}

async function computeAndCacheSection(
  cacheKey: string,
  hookName: string,
  compute: ComputeFn,
): Promise<string | null> {
  const epochBefore = getCurrentSectionEpoch()
  const resolved = await resolvePromptSection(hookName, await compute())
  if (getCurrentSectionEpoch() === epochBefore) {
    setSystemPromptSectionCacheEntry(cacheKey, resolved)
  }
  return resolved
}

/**
 * Resolve all system prompt sections, returning prompt strings.
 * densable WQe / jQe: checks generation counter before writing to sectionCache
 * so a /clear during evaluation does not write stale entries back.
 */
export async function resolveSystemPromptSections(
  sections: SystemPromptSection[],
  options: { isStored?: boolean; hookOrigin?: string } = {},
): Promise<(string | null)[]> {
  const { isStored = true, hookOrigin } = options
  const cache = getSystemPromptSectionCache()

  return Promise.all(
    sections.map(async s => {
      if (!s.cacheBreak && cache.has(s.name)) {
        return cache.get(s.name) ?? null
      }
      const hookName = stripSectionVariantSuffix(s.name)
      if (!isStored) {
        return resolvePromptSection(hookName, await s.compute(), hookOrigin)
      }
      return computeAndCacheSection(s.name, hookName, s.compute)
    }),
  )
}

const STATIC_SECTION_SEP = '\x00'

/**
 * densable GQe — resolve and cache a static prompt section keyed by
 * `${name}\0${JSON.stringify(value)}`.
 */
export function resolveStaticSystemPromptSection(
  name: string,
  value: string | null,
): Promise<string | null> {
  const key = `${name}${STATIC_SECTION_SEP}${JSON.stringify(value)}`
  const cache = getSystemPromptSectionCache()
  if (cache.has(key)) {
    return Promise.resolve(cache.get(key) ?? null)
  }
  return computeAndCacheSection(
    key,
    stripSectionVariantSuffix(name),
    () => value,
  )
}

/**
 * Clear all system prompt section state. Called on /clear and /compact.
 * Also resets beta header latches so a fresh conversation gets fresh
 * evaluation of AFK/fast-mode/cache-editing headers.
 */
export function clearSystemPromptSections(): void {
  sectionGeneration++
  clearSystemPromptSectionState()
  clearBetaHeaderLatches()
  invalidatePromptSections()
}
