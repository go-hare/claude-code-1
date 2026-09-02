/**
 * densable CGi / HMw / VRm / Jeo / ICm — interaction schema registry (2.1.239).
 * Gold: gold-CGi / ixl workshop-decisions / VRm freeze.
 *
 * Workshop schema is registered; MCm / Jeo gates default closed — do not invent ON.
 */
import { un } from './store.js'
import { deriveWorkshopFromEntries } from './islandExtract.js'

export type InteractionSchemaDoc = {
  format: number
  name: string
  island: string
  key: string
  maxEntries: number
  fields: Record<string, unknown>
  invariants: unknown[]
}

export type InteractionSchemaReg = {
  doc: InteractionSchemaDoc
  enabled: () => boolean
  derive?: (entries: unknown) => Record<string, string>
}

export type CGiResult =
  | { ok: true; reg: InteractionSchemaReg }
  | { ok: false; reason: 'unknown' | 'invalid' }

/** densable ixl — workshop-decisions island grammar (doc only). */
export const WORKSHOP_DECISIONS_DOC: InteractionSchemaDoc = {
  format: 1,
  name: 'workshop-decisions',
  island: 'ws-decisions',
  key: 'id',
  maxEntries: 20,
  fields: {
    id: { kind: 'token' },
    opts: { kind: 'tokenArray', minItems: 2, maxItems: 5, unique: true },
    state: { kind: 'enum', values: ['open', 'resolved'] },
    choice: { kind: 'ref', into: 'opts', nullable: true },
    custom: { kind: 'text', nullable: true },
  },
  invariants: [
    { when: { state: 'open' }, null: ['choice', 'custom'] },
    { when: { state: 'resolved' }, exactlyOneOf: ['choice', 'custom'] },
    { forKey: 'get-started', null: ['custom'] },
  ],
}

class Gate {
  #fn: () => boolean = () => false
  register(fn: () => boolean): void {
    this.#fn = fn
  }
  isOpen(): boolean {
    return this.#fn()
  }
  isAvailable(): boolean {
    return this.#fn()
  }
}

/** densable MCm — workshop schema enabled gate (default closed). */
const workshopGate = new Gate()

/** densable AZf / Jeo — read_page_data product availability (default closed). */
const readPageDataAvailability = new Gate()

/** densable OCm */
export function registerWorkshopDecisionsGate(fn: () => boolean): void {
  workshopGate.register(fn)
}

/** densable TZf */
export function registerReadPageDataAvailability(fn: () => boolean): void {
  readPageDataAvailability.register(fn)
}

/** densable Jeo */
export function isReadPageDataAvailable(): boolean {
  return readPageDataAvailability.isAvailable()
}

/** densable xMw portable — meta validate; tip accepts registered docs as valid. */
function metaVerdict(_doc: InteractionSchemaDoc): null | 'invalid' {
  return null
}

/**
 * densable kGi — lazy init interactionSchemas on store + register ixl.
 */
export function ensureInteractionSchemas(): {
  byName: Map<string, InteractionSchemaReg>
  islandOwners: Map<string, string>
  metaVerdicts: Map<string, null | 'invalid'>
} {
  const e = un()
  if (e.interactionSchemas === undefined) {
    e.interactionSchemas = {
      byName: new Map(),
      islandOwners: new Map(),
      metaVerdicts: new Map(),
    }
    registerInteractionSchema({
      doc: WORKSHOP_DECISIONS_DOC,
      enabled: () => workshopGate.isOpen(),
      derive: deriveWorkshopFromEntries,
    })
  }
  return e.interactionSchemas
}

/** densable HMw */
export function registerInteractionSchema(reg: InteractionSchemaReg): void {
  const { name, island } = reg.doc
  const { byName, islandOwners } = ensureInteractionSchemas()
  if (byName.has(name)) {
    throw new Error('interaction schema name already registered')
  }
  if (islandOwners.has(island)) {
    throw new Error(
      'interaction schema island id already owned — one island id, one grammar',
    )
  }
  byName.set(name, reg)
  islandOwners.set(island, name)
}

/** densable CGi */
export function CGi(schemaName: string): CGiResult {
  const { byName, metaVerdicts } = ensureInteractionSchemas()
  const reg = byName.get(schemaName)
  if (reg === undefined) return { ok: false, reason: 'unknown' }
  let verdict = metaVerdicts.get(schemaName)
  if (verdict === undefined) {
    verdict = metaVerdict(reg.doc)
    metaVerdicts.set(schemaName, verdict)
  }
  if (verdict !== null) return { ok: false, reason: 'invalid' }
  return { ok: true, reg }
}

/** densable ICm — enabled schema names. */
export function listEnabledInteractionSchemaNames(): string[] {
  return [...ensureInteractionSchemas().byName.entries()]
    .filter(([, reg]) => reg.enabled())
    .map(([name]) => name)
}

/** densable HCm — all registered names. */
export function listRegisteredInteractionSchemaNames(): string[] {
  return [...ensureInteractionSchemas().byName.keys()]
}

/** densable VRm — schema name frozen into this session's Artifact input schema. */
export function VRm(schemaName: unknown): boolean {
  const frozen = un().frozenReadPageDataSchemaNames
  return (
    typeof schemaName === 'string' &&
    frozen !== undefined &&
    frozen.has(schemaName)
  )
}

/**
 * densable freeze at Artifact input-schema build.
 * `capabilityOpen` mirrors densable `t` (read_page_data capability).
 */
export function freezeReadPageDataSchemaNames(
  capabilityOpen: boolean,
  names: readonly string[] = listEnabledInteractionSchemaNames(),
): void {
  un().frozenReadPageDataSchemaNames = capabilityOpen
    ? new Set(names)
    : new Set()
}

/** Tip helper — schema available for permissions (VRm ∧ CGi). */
export function isReadPageDataSchemaAvailable(schema: unknown): boolean {
  if (typeof schema !== 'string') return false
  if (!VRm(schema)) return false
  return CGi(schema).ok
}

export function resetInteractionSchemaGatesForTests(): void {
  workshopGate.register(() => false)
  readPageDataAvailability.register(() => false)
  const e = un()
  e.interactionSchemas = undefined
  e.frozenReadPageDataSchemaNames = undefined
}
