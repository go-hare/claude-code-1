/**
 * densable 2.1.239 vxi / wxi / eHi / GMf / VMf — tools/list schema ingest.
 *
 * SEA: vxi@308808805 eHi hostname allowlist for
 * tengu_mcp_normalize_root_combinators / tengu_mcp_drop_invalid_tool_schemas.
 * Default allowlists are [] → both gates false. Root combinators are skipped
 * (not kept raw) unless the server URL hostname is allowlisted.
 *
 * Invent-ban: WMf dropped-tool allowlist + client.droppedTools UI host.
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { APIError } from '@anthropic-ai/sdk'
import type {
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
} from '@modelcontextprotocol/client'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv'
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../analytics/metadata.js'
import { logEvent } from '../analytics/index.js'
import {
  getFeatureValue_CACHED_MAY_BE_STALE,
  isGrowthBookEnabled,
} from '../analytics/growthbook.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { logForDebugging } from '../../utils/debug.js'
import { logMCPDebug, logMCPError } from '../../utils/log.js'
import { HostSlot, getBootstrapSessionHost } from '../../utils/sessionRoot.js'
/** Structural config for eHi / ingest — stdio has no url. */
export type McpSchemaGateConfig = {
  type?: string
  url?: unknown
}

function asSchemaGateConfig(config: object): McpSchemaGateConfig {
  return {
    type:
      'type' in config && typeof config.type === 'string'
        ? config.type
        : undefined,
    url: 'url' in config ? config.url : undefined,
  }
}

function loggingSafeMcpBaseUrl(
  config: McpSchemaGateConfig,
): string | undefined {
  if (typeof config.url !== 'string') return undefined
  try {
    const url = new URL(config.url)
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

const ROOT_COMBINATORS = ['anyOf', 'oneOf', 'allOf'] as const
const PROPERTY_KEY = /^[a-zA-Z0-9_.-]{1,64}$/
const PRESERVE_KEYS = [
  '$defs',
  'definitions',
  '$schema',
  'additionalProperties',
  'description',
  'title',
] as const
const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema'

/**
 * Official 2.1.328 (`Nh` @chunk@335138039.js@146748): legacy JSON Schema
 * `$schema` dialect URIs stripped prior to AJV 2020-12 validation so older
 * MCP servers declaring draft-04/06/07/2019-09 or unversioned `$schema` do
 * not fail schema compilation.
 */
export const LEGACY_JSON_SCHEMA_DIALECT_URIS: ReadonlySet<string> = new Set([
  'http://json-schema.org/draft-04/schema',
  'https://json-schema.org/draft-04/schema',
  'http://json-schema.org/draft-06/schema',
  'https://json-schema.org/draft-06/schema',
  'http://json-schema.org/draft-07/schema',
  'https://json-schema.org/draft-07/schema',
  'http://json-schema.org/draft/2019-09/schema',
  'https://json-schema.org/draft/2019-09/schema',
  'http://json-schema.org/schema',
  'https://json-schema.org/schema',
])

export function isLegacyJsonSchemaDialectUri(uri: unknown): boolean {
  return (
    typeof uri === 'string' &&
    LEGACY_JSON_SCHEMA_DIALECT_URIS.has(uri.replace(/#$/, ''))
  )
}

/**
 * Official 2.1.328 (`vi` @chunk@335138039.js@146748): strip legacy JSON Schema
 * `$schema` dialect URIs (draft-04/06/07/2019-09 / unversioned) before AJV
 * compilation while leaving draft 2020-12 and custom `$schema` values intact.
 */
export function stripLegacyJsonSchemaDialect<T extends Record<string, unknown>>(
  schema: T,
): T {
  if (!isLegacyJsonSchemaDialectUri(schema.$schema)) {
    return schema
  }
  const { $schema: _dropped, ...rest } = schema
  return rest as T
}

/**
 * Official 2.1.328 (`LegacyDialectToleratingValidator` / `class vi`
 * @chunk@335138039.js@146748): AJV jsonSchemaValidator wrapper that strips
 * legacy `$schema` dialect URIs before delegating to `AjvJsonSchemaValidator`.
 */
export class LegacyDialectToleratingValidator implements jsonSchemaValidator {
  private readonly inner = new AjvJsonSchemaValidator()

  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const stripped = stripLegacyJsonSchemaDialect(
      schema as Record<string, unknown>,
    )
    return this.inner.getValidator<T>(stripped as JsonSchemaType)
  }
}

export const TENGU_MCP_NORMALIZE_ROOT_COMBINATORS =
  'tengu_mcp_normalize_root_combinators'
export const TENGU_MCP_DROP_INVALID_TOOL_SCHEMAS =
  'tengu_mcp_drop_invalid_tool_schemas'

export type McpRootCombinator = (typeof ROOT_COMBINATORS)[number]

export type McpNormalizeOutcome =
  | { outcome: 'unchanged' }
  | {
      outcome: 'normalized'
      schema: Record<string, unknown>
      note: string
      combinators: McpRootCombinator[]
    }
  | { outcome: 'drop'; reason: string }

export type McpSchemaCheck = 'meta' | 'propertyKey'

export type McpSchemaValidation =
  | { valid: true }
  | { valid: false; check: McpSchemaCheck; detail: string }

export type ListedMcpTool = {
  name: string
  description?: string
  inputSchema?: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** densable zZa — resolve #/$defs|definitions/name on the root document. */
function resolveLocalRef(
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
): Record<string, unknown> {
  const ref = schema.$ref
  if (typeof ref !== 'string') return schema
  const match = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(ref)
  if (match === null) return schema
  const bag = root[match[1]!]
  if (!isPlainObject(bag)) return schema
  const target = bag[match[2]!]
  return isPlainObject(target) ? target : schema
}

/** densable _RS — required keys, else property keys, else null. */
function summarizeSchemaFields(schema: unknown): string | null {
  if (!isPlainObject(schema)) return null
  const required = schema.required
  if (
    Array.isArray(required) &&
    required.length > 0 &&
    required.every(item => typeof item === 'string')
  ) {
    return required.join(', ')
  }
  const properties = schema.properties
  if (isPlainObject(properties)) {
    const keys = Object.keys(properties)
    if (keys.length > 0) return keys.join(', ')
  }
  return null
}

/** densable bRS */
function formatFlattenNote(
  combinators: McpRootCombinator[],
  root: Record<string, unknown>,
  hasAnyOrOne: boolean,
): string {
  if (!hasAnyOrOne) {
    return 'Input constraint: all listed parameters apply together (flattened from a JSON Schema allOf).'
  }
  const kind = combinators.includes('oneOf') ? 'oneOf' : 'anyOf'
  const raw = root[kind]
  const groups = Array.isArray(raw)
    ? [
        ...new Set(
          raw
            .map(branch =>
              summarizeSchemaFields(
                isPlainObject(branch) ? resolveLocalRef(branch, root) : branch,
              ),
            )
            .filter((item): item is string => item !== null),
        ),
      ]
    : []
  const verb =
    kind === 'oneOf'
      ? 'Provide parameters for exactly one of'
      : 'Provide parameters for at least one of'
  if (groups.length === 0) {
    return `Input constraint: ${verb} the documented parameter groups (flattened from a JSON Schema ${kind}).`
  }
  const joined = groups.map(group => `(${group})`).join(' or ')
  return `Input constraint: ${verb}: ${joined}.`
}

function canonicalSchemaKey(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSchemaKey).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalSchemaKey(obj[k])}`).join(',')}}`
}

function dedupeBranchSchemas(
  schemas: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (schemas.length <= 1) return schemas
  const seen = new Set<string>()
  const unique: Record<string, unknown>[] = []
  for (const s of schemas) {
    const key = canonicalSchemaKey(s)
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(s)
    }
  }
  return unique
}

/**
 * Official 2.1.326 #82 (`_5a` @288167400): flatten top-level anyOf/oneOf/allOf,
 * merging distinct per-property schemas across all `anyOf`/`oneOf` branches into
 * `{ anyOf: [...stringBranches, ...nonStringBranches] }`, intersecting `required`
 * across `anyOf`/`oneOf` branches, and defaulting `additionalProperties: true`.
 */
export function normalizeMcpRootCombinators(
  schema: unknown,
  options: { everyBranch?: boolean } = {},
): McpNormalizeOutcome {
  if (!isPlainObject(schema)) return { outcome: 'unchanged' }
  const combinators = ROOT_COMBINATORS.filter(key => key in schema)
  if (combinators.length === 0) return { outcome: 'unchanged' }
  const everyBranch = options.everyBranch ?? true
  try {
    const properties = Object.create(null) as Record<string, unknown>
    const branchSchemasByKey = new Map<string, Record<string, unknown>[]>()
    const takeProperties = (bag: unknown, collectBranches = false) => {
      if (!isPlainObject(bag)) return
      for (const [key, value] of Object.entries(bag)) {
        if (!PROPERTY_KEY.test(key) || !isPlainObject(value)) continue
        if (!(key in properties)) {
          properties[key] = value
          if (collectBranches) {
            branchSchemasByKey.set(key, [value])
          }
        } else if (collectBranches) {
          const existing = branchSchemasByKey.get(key)
          if (existing) {
            existing.push(value)
          } else {
            const current = properties[key]
            branchSchemasByKey.set(
              key,
              isPlainObject(current) ? [current, value] : [value],
            )
          }
        }
      }
    }
    takeProperties(schema.properties)
    for (const key of combinators) {
      const branches = schema[key]
      if (!Array.isArray(branches)) {
        return {
          outcome: 'drop',
          reason: `input schema has top-level ${key} that is not an array`,
        }
      }
      for (const branch of branches) {
        if (isPlainObject(branch)) {
          takeProperties(
            resolveLocalRef(branch, schema).properties,
            everyBranch && key !== 'allOf',
          )
        }
      }
    }
    for (const [key, branchSchemas] of branchSchemasByKey) {
      const unique = dedupeBranchSchemas(branchSchemas)
      if (unique.length > 1) {
        properties[key] = {
          anyOf: [
            ...unique.filter(s => s.type === 'string'),
            ...unique.filter(s => s.type !== 'string'),
          ],
        }
      }
    }
    const required: string[] = []
    const takeRequired = (list: unknown) => {
      if (!Array.isArray(list)) return
      for (const item of list) {
        if (
          typeof item === 'string' &&
          item in properties &&
          !required.includes(item)
        ) {
          required.push(item)
        }
      }
    }
    takeRequired(schema.required)
    if (Array.isArray(schema.allOf)) {
      for (const branch of schema.allOf) {
        if (isPlainObject(branch)) {
          takeRequired(resolveLocalRef(branch, schema).required)
        }
      }
    }
    if (everyBranch) {
      for (const key of ['anyOf', 'oneOf'] as const) {
        const rawBranches = schema[key]
        if (!Array.isArray(rawBranches) || rawBranches.length === 0) continue
        const resolved = rawBranches.map(b =>
          isPlainObject(b) ? resolveLocalRef(b, schema) : b,
        )
        const counts = new Map<string, number>()
        for (const [idx, br] of resolved.entries()) {
          const reqList =
            isPlainObject(br) && Array.isArray(br.required) ? br.required : []
          for (const item of reqList) {
            if (typeof item === 'string' && (counts.get(item) ?? 0) === idx) {
              counts.set(item, idx + 1)
            }
          }
        }
        takeRequired(
          [...counts.keys()].filter(k => counts.get(k) === resolved.length),
        )
      }
    }
    const hasAnyOrOne =
      combinators.includes('anyOf') || combinators.includes('oneOf')
    const flattened: Record<string, unknown> = {
      type: 'object',
      properties,
      required,
    }
    for (const key of PRESERVE_KEYS) {
      if (key in schema) flattened[key] = schema[key]
    }
    if (!('additionalProperties' in schema)) {
      flattened.additionalProperties = true
    }
    return {
      outcome: 'normalized',
      schema: flattened,
      note: formatFlattenNote(combinators, schema, hasAnyOrOne),
      combinators,
    }
  } catch {
    return {
      outcome: 'drop',
      reason: `input schema uses top-level ${combinators.join('/')} and could not be normalized`,
    }
  }
}

const NUMERIC_LITERAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

function propertyAllowsNumericBranch(
  propSchema: unknown,
): 'integer' | 'number' | null {
  if (!isPlainObject(propSchema)) return null
  const branches: unknown[] = []
  if (Array.isArray(propSchema.anyOf)) branches.push(...propSchema.anyOf)
  if (Array.isArray(propSchema.oneOf)) branches.push(...propSchema.oneOf)
  if (branches.length === 0) {
    if (propSchema.type === 'integer') return 'integer'
    if (propSchema.type === 'number') return 'number'
    if (Array.isArray(propSchema.type)) {
      if (propSchema.type.includes('number')) return 'number'
      if (propSchema.type.includes('integer')) return 'integer'
    }
    return null
  }
  let numericKind: 'integer' | 'number' | null = null
  for (const br of branches) {
    if (!isPlainObject(br)) continue
    if (br.type === 'number') return 'number'
    if (br.type === 'integer') numericKind = 'integer'
  }
  return numericKind
}

function stringBranchAcceptsValue(propSchema: unknown, value: string): boolean {
  if (!isPlainObject(propSchema)) return false
  const branches: unknown[] = []
  if (Array.isArray(propSchema.anyOf)) branches.push(...propSchema.anyOf)
  if (Array.isArray(propSchema.oneOf)) branches.push(...propSchema.oneOf)
  if (branches.length === 0) {
    return propSchema.type === 'string'
  }
  for (const br of branches) {
    if (!isPlainObject(br) || br.type !== 'string') continue
    if (Array.isArray(br.enum)) {
      if (br.enum.includes(value)) return true
      continue
    }
    if (typeof br.const === 'string') {
      if (br.const === value) return true
      continue
    }
    if (typeof br.pattern === 'string') {
      try {
        if (new RegExp(br.pattern).test(value)) return true
      } catch {
        // Invalid regex pattern — do not match
      }
      continue
    }
    // Unconstrained string branch: check if another branch is numeric
    return false
  }
  return false
}

/**
 * Official 2.1.326 #82: Coerce numeric text arguments (e.g. `"42"`) to numbers
 * when the flattened MCP tool input schema exposes a `number` or `integer`
 * branch (e.g. via merged `anyOf`/`oneOf`) and no constrained string branch
 * claims the value.
 */
export function coerceMcpToolInputForSchema(
  args: Record<string, unknown>,
  schema: unknown,
): Record<string, unknown> {
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) {
    return args
  }
  let changed = false
  const next: Record<string, unknown> = { ...args }
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== 'string') continue
    const propSchema = schema.properties[key]
    if (!isPlainObject(propSchema)) continue
    const numericKind = propertyAllowsNumericBranch(propSchema)
    if (!numericKind) continue
    if (stringBranchAcceptsValue(propSchema, value)) continue
    const trimmed = value.trim()
    if (!NUMERIC_LITERAL_RE.test(trimmed)) continue
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) continue
    if (numericKind === 'integer' && !Number.isInteger(parsed)) continue
    next[key] = parsed
    changed = true
  }
  return changed ? next : args
}

type HostMcpToolSchemaState = {
  metaValidator: ValidateFunction | null | undefined
  sessionRefusedToolSchemas: Map<string, Set<string>>
}

const hostMcpToolSchemaSlot = new HostSlot<HostMcpToolSchemaState>(() => ({
  metaValidator: undefined,
  sessionRefusedToolSchemas: new Map<string, Set<string>>(),
}))

function getHostMcpToolSchemaState(): HostMcpToolSchemaState {
  return hostMcpToolSchemaSlot.of(getBootstrapSessionHost())
}

/** densable SRS() — do not strip $schema except the draft URL match path. */
function shouldStripSchemaKeyword(): boolean {
  return false
}

function firstInvalidPropertyKey(schema: unknown): string | null {
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) return null
  for (const key of Object.keys(schema.properties)) {
    if (!PROPERTY_KEY.test(key)) return key
  }
  return null
}

/** densable vRS — lazy Ajv2020 draft 2020-12 meta-validator; fail-open. */
export function getMcpDraft202012Validator(): ValidateFunction | null {
  const state = getHostMcpToolSchemaState()
  if (state.metaValidator !== undefined) return state.metaValidator
  try {
    state.metaValidator =
      new Ajv2020({
        allErrors: false,
        validateFormats: false,
      }).getSchema(DRAFT_2020_12) ?? null
  } catch {
    state.metaValidator = null
  }
  if (state.metaValidator === null) {
    logForDebugging(
      'MCP: draft 2020-12 meta-validator unavailable — tool schema checks fail open',
      { level: 'warn' },
    )
    logEvent('tengu_mcp_degraded', {
      reason: 'schema_validator_unavailable' as never,
    })
  }
  return state.metaValidator
}

export function resetMcpDraft202012ValidatorForTests(): void {
  const state = hostMcpToolSchemaSlot.peek(getBootstrapSessionHost())
  if (state) {
    state.metaValidator = undefined
  }
}

/**
 * densable wxi / ERS — property-key first, then draft 2020-12 meta.
 */
export function validateMcpToolInputSchema(
  schema: unknown,
): McpSchemaValidation {
  const badKey = firstInvalidPropertyKey(schema)
  if (badKey !== null) {
    return {
      valid: false,
      check: 'propertyKey',
      detail: `property key ${JSON.stringify(badKey.slice(0, 80))} does not match ${PROPERTY_KEY}`,
    }
  }
  const validator = getMcpDraft202012Validator()
  if (validator === null) return { valid: true }
  let candidate: unknown = schema
  if (isPlainObject(schema)) {
    let entries = Object.entries(schema)
    if (entries.some(([, value]) => value === null)) {
      entries = entries.filter(([, value]) => value !== null)
      candidate = Object.fromEntries(entries)
    }
    if (isPlainObject(candidate)) {
      const keyword = candidate.$schema
      if (keyword !== undefined) {
        if (shouldStripSchemaKeyword()) {
          const { $schema: _dropped, ...rest } = candidate
          candidate = rest
        } else if (
          typeof keyword === 'string' &&
          (keyword === DRAFT_2020_12 || keyword === `${DRAFT_2020_12}#`)
        ) {
          // keep $schema; meta-validate
        } else {
          return { valid: true }
        }
      }
    }
  }
  try {
    if (validator(candidate)) return { valid: true }
    const err = validator.errors?.[0]
    return {
      valid: false,
      check: 'meta',
      detail: err
        ? `schema${err.instancePath} ${err.message ?? 'is invalid'}`
        : 'schema is invalid',
    }
  } catch (error) {
    return {
      valid: false,
      check: 'meta',
      detail: `validation threw: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * densable eHi body — GB value is a hostname allowlist. Default [] → false.
 * `*` → true. Else match config.url hostname (exact or endsWith(.host)).
 */
export function matchMcpHostnameAllowlist(
  allowlist: unknown,
  config: object,
): boolean {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false
  if (allowlist.includes('*')) return true
  const url = 'url' in config ? config.url : undefined
  if (typeof url !== 'string') return false
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return allowlist.some(entry => {
      if (typeof entry !== 'string' || entry === '') return false
      const host = entry.toLowerCase()
      return hostname === host || hostname.endsWith(`.${host}`)
    })
  } catch {
    return false
  }
}

/**
 * Official 2.1.328 `V9()` — third-party API providers or GrowthBook/telemetry
 * disabled: use safe on-by-default fallback allowlists (`["*"]`) for root
 * combinator normalization and invalid schema dropping.
 */
export function shouldUseOffFlagFallbackDefaults(): boolean {
  return getAPIProvider() !== 'firstParty' || !isGrowthBookEnabled()
}

/** densable eHi / Zn(flag, config, fallbackDefault) */
export function isMcpHostnameAllowlisted(
  flag: string,
  config: object,
  fallbackDefault: readonly string[] = [],
): boolean {
  const defaultValue = shouldUseOffFlagFallbackDefaults() ? fallbackDefault : []
  return matchMcpHostnameAllowlist(
    getFeatureValue_CACHED_MAY_BE_STALE<unknown>(flag, defaultValue),
    config,
  )
}

/** densable GMf / Ph (2.1.328: defaults to ["*"] on 3P / flags-off) */
export function shouldNormalizeMcpRootCombinators(config: object): boolean {
  return isMcpHostnameAllowlisted(
    TENGU_MCP_NORMALIZE_ROOT_COMBINATORS,
    config,
    ['*'],
  )
}

/** densable VMf / Rh (2.1.328: defaults to ["*"] on 3P / flags-off) */
export function shouldDropInvalidMcpToolSchemas(config: object): boolean {
  return isMcpHostnameAllowlisted(TENGU_MCP_DROP_INVALID_TOOL_SCHEMAS, config, [
    '*',
  ])
}

function mcpSchemaAnalytics(config: McpSchemaGateConfig): {
  mcpServerBaseUrl?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
} {
  const url = loggingSafeMcpBaseUrl(config)
  return url
    ? {
        mcpServerBaseUrl:
          url as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }
    : {}
}

function emitDegraded(
  reason: string,
  config: McpSchemaGateConfig,
  serverName: string,
  counts: { normalizedCount?: number; skippedCount?: number },
): void {
  logEvent('tengu_mcp_degraded', {
    reason: reason as never,
    transportType: (config.type ??
      'stdio') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...counts,
    mcpServerName:
      serverName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...mcpSchemaAnalytics(config),
  })
}

/**
 * densable tools/list ingest after toolPermissions warn: vxi then wxi.
 */
export type DroppedMcpToolRecord = {
  toolName: string
  reason: string
}

export function filterListedMcpToolsBySchema<T extends ListedMcpTool>(
  tools: readonly T[],
  opts: {
    serverName: string
    config: object
    normalizeRootCombinators?: boolean
    dropInvalidSchemas?: boolean
    /** #2151: Collect omitted tools + reasons for display in `/mcp`. */
    onDroppedTool?: (dropped: DroppedMcpToolRecord) => void
  },
): T[] {
  const config = asSchemaGateConfig(opts.config)
  const normalize =
    opts.normalizeRootCombinators ?? shouldNormalizeMcpRootCombinators(config)
  const dropInvalid =
    opts.dropInvalidSchemas ?? shouldDropInvalidMcpToolSchemas(config)
  let normalizedCount = 0
  let normalizeGated = 0
  let unsupported = 0
  let invalidDropped = 0
  let propertyKeyDropped = 0
  let invalidKept = 0
  let propertyKeyKept = 0

  const kept = tools.flatMap((tool): T[] => {
    const normalized = normalizeMcpRootCombinators(tool.inputSchema)
    let next: T
    if (normalized.outcome === 'unchanged') {
      next = tool
    } else if (normalized.outcome === 'normalized' && normalize) {
      normalizedCount++
      logMCPDebug(
        opts.serverName,
        `Normalized input schema for tool "${tool.name}" (flattened top-level ${normalized.combinators.join('/')})`,
      )
      const description = tool.description
        ? `${normalized.note}..${tool.description}`
        : normalized.note
      next = {
        ...tool,
        inputSchema: normalized.schema,
        description,
      } as T
    } else {
      if (normalized.outcome === 'normalized') normalizeGated++
      else unsupported++
      const why =
        normalized.outcome === 'drop'
          ? normalized.reason
          : `its input schema uses top-level ${normalized.combinators.join('/')}, which the Anthropic API does not accept`
      logMCPError(
        opts.serverName,
        `Skipping tool "${tool.name}": ${why}. Other tools from this server remain available.`,
      )
      opts.onDroppedTool?.({ toolName: tool.name, reason: why })
      return []
    }

    const check = validateMcpToolInputSchema(next.inputSchema)
    if (check.valid) return [next]
    if (!dropInvalid) {
      if (check.check === 'meta') invalidKept++
      else propertyKeyKept++
      logMCPDebug(
        opts.serverName,
        `Tool "${tool.name}" input schema would be rejected by the Anthropic API (${check.detail}); requests that include it may fail`,
      )
      return [next]
    }
    if (check.check === 'meta') invalidDropped++
    else propertyKeyDropped++
    logMCPError(
      opts.serverName,
      `Skipping tool "${tool.name}": its input schema would be rejected by the Anthropic API (${check.detail}). Other tools from this server remain available.`,
    )
    opts.onDroppedTool?.({ toolName: tool.name, reason: check.detail })
    return []
  })

  if (normalizedCount > 0) {
    emitDegraded('tool_schema_normalized', config, opts.serverName, {
      normalizedCount,
    })
  }
  if (normalizeGated > 0) {
    emitDegraded('tool_schema_normalize_gated', config, opts.serverName, {
      skippedCount: normalizeGated,
    })
  }
  if (unsupported > 0) {
    emitDegraded('tool_schema_unsupported', config, opts.serverName, {
      skippedCount: unsupported,
    })
  }
  if (invalidDropped > 0) {
    emitDegraded('tool_schema_invalid', config, opts.serverName, {
      skippedCount: invalidDropped,
    })
  }
  if (propertyKeyDropped > 0) {
    emitDegraded('tool_property_key_invalid', config, opts.serverName, {
      skippedCount: propertyKeyDropped,
    })
  }
  if (invalidKept > 0) {
    emitDegraded('tool_schema_invalid_gated', config, opts.serverName, {
      skippedCount: invalidKept,
    })
  }
  if (propertyKeyKept > 0) {
    emitDegraded('tool_property_key_invalid_gated', config, opts.serverName, {
      skippedCount: propertyKeyKept,
    })
  }
  return kept
}

/**
 * Official `Hit` / `y$r` / `Bit` / `jbn` / `a2o` / `class jit` (2.1.300 #790):
 * When the API returns HTTP 400 rejecting an MCP tool's `input_schema`,
 * degrade that tool's schema to `{ type: 'object' }` for the rest of the
 * conversation and retry.
 */
export const EMPTY_OBJECT_TOOL_SCHEMA = { type: 'object' } as const
export const MAX_REFUSED_TOOL_SCHEMA_REPLACEMENTS = 8

export function getRefusedToolSchemas(): Map<string, Set<string>> {
  return getHostMcpToolSchemaState().sessionRefusedToolSchemas
}

export function resetRefusedToolSchemas(): void {
  hostMcpToolSchemaSlot
    .peek(getBootstrapSessionHost())
    ?.sessionRefusedToolSchemas.clear()
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(v => canonicalJson(v)).join(',')}]`
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys
    .map(
      k =>
        `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
    )
    .join(',')}}`
}

export function hashToolInputSchema(schema: unknown): string {
  return createHash('sha256').update(canonicalJson(schema)).digest('hex')
}

export function replaceRefusedToolSchemas<T>(
  toolSchemas: T[],
  refusedToolSchemas: Map<string, Set<string>> = getRefusedToolSchemas(),
): T[] {
  if (refusedToolSchemas.size === 0) return toolSchemas
  try {
    return toolSchemas.map(s => {
      if (s === null || typeof s !== 'object') return s
      const rec = s as {
        name?: unknown
        input_schema?: unknown
        eager_input_streaming?: unknown
      }
      if (
        typeof rec.name !== 'string' ||
        !('input_schema' in rec) ||
        refusedToolSchemas
          .get(rec.name)
          ?.has(hashToolInputSchema(rec.input_schema)) !== true
      ) {
        return s
      }
      const { eager_input_streaming: _omit, ...rest } = rec
      return {
        ...rest,
        input_schema: { ...EMPTY_OBJECT_TOOL_SCHEMA },
      } as unknown as T
    })
  } catch {
    return toolSchemas
  }
}

export function parseMessageToolSchemaError(error: APIError): {
  field: string
  place?: { message: number; block: number }
} | null {
  const errObj = error.error as
    | { error?: { param?: unknown }; param?: unknown }
    | undefined
  const param =
    typeof errObj?.error?.param === 'string'
      ? errObj.error.param
      : typeof errObj?.param === 'string'
        ? errObj.param
        : undefined
  if (!param) return null
  const m =
    /^(?:body\.)?messages\.(\d+)\.((?:(?:content|tool_changes)\.\d+\.)*)tool\.definition\.(\w+)/.exec(
      param,
    )
  if (!m?.[3]) return null
  const blockMatch = /^content\.(\d+)\.$/.exec(m[2] ?? '')?.[1]
  return {
    field: m[3],
    place:
      blockMatch === undefined
        ? undefined
        : { message: Number(m[1]), block: Number(blockMatch) },
  }
}

export type RefusedToolSchemaLookupTool = {
  name: string
  isMcp?: boolean
  mcpInfo?: { serverName: string; toolName: string }
}

export class RefusedToolSchemaResolver {
  #refusedToolSchemas: Map<string, Set<string>>
  #replacements = 0

  constructor(
    refusedToolSchemas: Map<string, Set<string>> = getRefusedToolSchemas(),
  ) {
    this.#refusedToolSchemas = refusedToolSchemas
  }

  get replacements(): number {
    return this.#replacements
  }

  resolve(
    error: unknown,
    toolSchemas: ReadonlyArray<unknown> | undefined,
    tools: ReadonlyArray<RefusedToolSchemaLookupTool>,
    querySource?: string,
  ): string | undefined {
    if (!(error instanceof APIError) || error.status !== 400) return undefined
    const msgMatch = /\btools\.(\d+)\.(?:custom\.)?input_schema\b/.exec(
      error.message,
    )?.[1]
    const parsedPlace = parseMessageToolSchemaError(error)
    const fieldPlace =
      parsedPlace?.field === 'input_schema' ? parsedPlace.place : undefined
    if (msgMatch === undefined && fieldPlace === undefined) return undefined

    if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_calm_crescent', true)) {
      this.#logOutcome('switched_off', querySource)
      return undefined
    }

    const rawTarget =
      msgMatch !== undefined ? toolSchemas?.[Number(msgMatch)] : undefined
    if (
      rawTarget === null ||
      typeof rawTarget !== 'object' ||
      !('name' in rawTarget) ||
      typeof (rawTarget as { name?: unknown }).name !== 'string' ||
      !('input_schema' in rawTarget)
    ) {
      this.#logOutcome('no_mcp_tool_at_index', querySource)
      return undefined
    }
    const target = rawTarget as { name: string; input_schema: unknown }

    const matchedTool = tools.find(t => t.name === target.name)
    if (!matchedTool?.isMcp && !target.name.startsWith('mcp__')) {
      this.#logOutcome('no_mcp_tool_at_index', querySource)
      return undefined
    }

    if (isDeepStrictEqual(target.input_schema, EMPTY_OBJECT_TOOL_SCHEMA)) {
      this.#logOutcome('already_replaced', querySource)
      return undefined
    }

    if (this.#replacements >= MAX_REFUSED_TOOL_SCHEMA_REPLACEMENTS) {
      this.#logOutcome('bound_reached', querySource)
      return undefined
    }

    const existing =
      this.#refusedToolSchemas.get(target.name) ?? new Set<string>()
    existing.add(hashToolInputSchema(target.input_schema))
    this.#refusedToolSchemas.set(target.name, existing)
    this.#replacements++

    this.#logOutcome(
      fieldPlace === undefined ? 'replaced' : 'replaced_in_message',
      querySource,
    )

    if (matchedTool?.mcpInfo) {
      logMCPError(
        matchedTool.mcpInfo.serverName,
        `Tool "${matchedTool.mcpInfo.toolName}": the API refused this tool's input schema. Claude can still call the tool in this conversation, but does not see its parameters. Fix the schema on the MCP server, then start a new conversation. The API said: ${error.message}`,
      )
    }

    return `retry:tool-schema-refused-${this.#replacements}`
  }

  #logOutcome(outcome: string, querySource?: string): void {
    logEvent('tengu_api_tool_schema_replacement', {
      outcome:
        outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      replacements: this.#replacements,
      ...(querySource !== undefined && {
        query_source:
          querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    })
  }
}
