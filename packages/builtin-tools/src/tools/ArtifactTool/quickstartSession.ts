/**
 * densable 2.1.289 Artifact quickstart session bag analog
 * (`X().quickstartRan` / `quickstartGuidanceToolUseId`).
 * Semantic names only — do not export minify X.
 */

export type QuickstartRanRecord = {
  toolUseId?: string
  listed?: boolean
  designSystem?: string
  none?: boolean
  savedSystem?: { url: string; dir: string }
  savedPages?: { dir: string; paths: string[] }
}

type QuickstartSessionState = {
  quickstartRan: Map<string, QuickstartRanRecord>
  quickstartGuidanceToolUseId: string | undefined
}

function emptyState(): QuickstartSessionState {
  return {
    quickstartRan: new Map(),
    quickstartGuidanceToolUseId: undefined,
  }
}

let state = emptyState()

function truthyFlag(value: unknown): boolean {
  return value === true || (typeof value === 'number' && value > 0)
}

function objectFlag(
  rec: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return rec !== undefined && truthyFlag(rec[key])
}

/**
 * Gold `aa` analog: no instances, no unavailable/overflow/dropped, no
 * design_system.url.
 */
export function isQuickstartNone(bag: unknown): boolean {
  if (bag === null || typeof bag !== 'object') return true
  const rec = bag as Record<string, unknown>
  const systems =
    rec.design_systems !== null && typeof rec.design_systems === 'object'
      ? (rec.design_systems as Record<string, unknown>)
      : undefined
  const instances = systems?.instances
  if (Array.isArray(instances) && instances.length > 0) return false
  for (const key of ['unavailable', 'overflow', 'dropped'] as const) {
    if (objectFlag(rec, key) || objectFlag(systems, key)) return false
  }
  const designSystem =
    rec.design_system !== null && typeof rec.design_system === 'object'
      ? (rec.design_system as Record<string, unknown>)
      : undefined
  const url = designSystem?.url
  return !(typeof url === 'string' && url !== '')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

/** Gold findDesignSystemFile analog — first file whose path is `name`. */
function findDesignSystemFile(
  files: unknown,
  name: string,
): Record<string, unknown> | undefined {
  if (!Array.isArray(files)) return undefined
  for (const row of files) {
    const rec = asRecord(row)
    if (rec?.path === name) return rec
  }
  return undefined
}

/**
 * Gold `oy` analog — session extras from a saved start kit.
 * DualInk / uSo REPL routing is not invented here.
 */
export function extrasFromStartKit(
  bag: unknown,
  intent: unknown,
): Pick<QuickstartRanRecord, 'savedSystem' | 'savedPages'> {
  const e = asRecord(bag)
  const s = e !== undefined ? asRecord(e.start_kit) : undefined
  if (
    e === undefined ||
    s === undefined ||
    e.match === undefined ||
    (intent !== 'slides' && intent !== 'design')
  ) {
    return {}
  }
  const extras: Pick<QuickstartRanRecord, 'savedSystem' | 'savedPages'> = {}
  const system = asRecord(s.system)
  if (
    s.system_url !== undefined &&
    system !== undefined &&
    findDesignSystemFile(system.files, 'README.md') !== undefined &&
    typeof s.system_url === 'string' &&
    typeof system.dir === 'string'
  ) {
    extras.savedSystem = { url: s.system_url, dir: system.dir }
  }
  const type = asRecord(s.type)
  const files = Array.isArray(type?.files) ? type.files : undefined
  if (
    files?.some(row => {
      const rec = asRecord(row)
      return (
        typeof rec?.path === 'string' &&
        rec.path.startsWith('artifact-type/reference/')
      )
    }) === true &&
    type !== undefined
  ) {
    extras.savedPages = {
      dir: typeof type.dir === 'string' ? type.dir : '',
      paths: files.map(row => {
        const rec = asRecord(row)
        return typeof rec?.path === 'string' ? rec.path : ''
      }),
    }
  }
  return extras
}

/** Gold `X().quickstartRan.set(H, rec)` analog. */
export function recordQuickstartRan(
  slug: string,
  rec: QuickstartRanRecord,
): void {
  state.quickstartRan.set(slug, { ...rec })
}

export function getQuickstartRan(
  slug: string,
): QuickstartRanRecord | undefined {
  return state.quickstartRan.get(slug)
}

/** Gold `X().quickstartGuidanceToolUseId = s.toolUseId` analog. */
export function setQuickstartGuidanceToolUseId(id: string | undefined): void {
  state.quickstartGuidanceToolUseId = id
}

export function getQuickstartGuidanceToolUseId(): string | undefined {
  return state.quickstartGuidanceToolUseId
}

export function clearQuickstartSession(): void {
  state = emptyState()
}
