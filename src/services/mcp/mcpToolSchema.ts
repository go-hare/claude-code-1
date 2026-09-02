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

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../analytics/metadata.js'
import { logEvent } from '../analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { logForDebugging } from '../../utils/debug.js'
import { logMCPDebug, logMCPError } from '../../utils/log.js'
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

/**
 * densable vxi — flatten top-level anyOf/oneOf/allOf, or drop.
 */
export function normalizeMcpRootCombinators(
  schema: unknown,
): McpNormalizeOutcome {
  if (!isPlainObject(schema)) return { outcome: 'unchanged' }
  const combinators = ROOT_COMBINATORS.filter(key => key in schema)
  if (combinators.length === 0) return { outcome: 'unchanged' }
  try {
    const properties = Object.create(null) as Record<string, unknown>
    const takeProperties = (bag: unknown) => {
      if (!isPlainObject(bag)) return
      for (const [key, value] of Object.entries(bag)) {
        if (
          PROPERTY_KEY.test(key) &&
          !(key in properties) &&
          isPlainObject(value)
        ) {
          properties[key] = value
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
          takeProperties(resolveLocalRef(branch, schema).properties)
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

let metaValidator: ValidateFunction | null | undefined

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
  if (metaValidator !== undefined) return metaValidator
  try {
    metaValidator =
      new Ajv2020({
        allErrors: false,
        validateFormats: false,
      }).getSchema(DRAFT_2020_12) ?? null
  } catch {
    metaValidator = null
  }
  if (metaValidator === null) {
    logForDebugging(
      'MCP: draft 2020-12 meta-validator unavailable — tool schema checks fail open',
      { level: 'warn' },
    )
    logEvent('tengu_mcp_degraded', {
      reason: 'schema_validator_unavailable' as never,
    })
  }
  return metaValidator
}

export function resetMcpDraft202012ValidatorForTests(): void {
  metaValidator = undefined
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

/** densable eHi(flag, config) */
export function isMcpHostnameAllowlisted(
  flag: string,
  config: object,
): boolean {
  return matchMcpHostnameAllowlist(
    getFeatureValue_CACHED_MAY_BE_STALE<unknown>(flag, []),
    config,
  )
}

/** densable GMf */
export function shouldNormalizeMcpRootCombinators(config: object): boolean {
  return isMcpHostnameAllowlisted(TENGU_MCP_NORMALIZE_ROOT_COMBINATORS, config)
}

/** densable VMf */
export function shouldDropInvalidMcpToolSchemas(config: object): boolean {
  return isMcpHostnameAllowlisted(TENGU_MCP_DROP_INVALID_TOOL_SCHEMAS, config)
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
export function filterListedMcpToolsBySchema<T extends ListedMcpTool>(
  tools: readonly T[],
  opts: {
    serverName: string
    config: object
    normalizeRootCombinators?: boolean
    dropInvalidSchemas?: boolean
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
