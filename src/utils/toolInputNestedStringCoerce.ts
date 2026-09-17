/**
 * densable qPy / SEA 2.1.246 V5s — coerce nested JSON-string tool args by schema.
 *
 * Runs after top-level JSON.parse and before jYd unicode repair / UYd
 * normalizeToolInput. Empty / meta-only property schemas (`{}`, or only
 * K5s keys) coerce as `"any"` so MCP tools that advertise empty schemas
 * still receive real objects/arrays/bools/numbers instead of JSON strings.
 */

import { safeParseJSON } from './json.js'

/** densable K5s — JSON Schema keys that do not imply a concrete type. */
export const META_ONLY_JSON_SCHEMA_KEYS = new Set([
  '$comment',
  'default',
  'deprecated',
  'description',
  'examples',
  'readOnly',
  'title',
  'writeOnly',
])

type JsonSchemaNode = {
  type?: string | string[]
  $ref?: string
  anyOf?: unknown[]
  oneOf?: unknown[]
  [key: string]: unknown
}

type JsonSchemaRoot = {
  properties?: Record<string, unknown>
  $defs?: Record<string, unknown>
  definitions?: Record<string, unknown>
}

type ZodDefLike = {
  type?: string
  shape?: Record<string, { _zod?: { def?: ZodDefLike } }>
  innerType?: { _zod?: { def?: ZodDefLike } }
  in?: { _zod?: { def?: ZodDefLike } }
}

type ZodSchemaLike = {
  _zod?: { def?: ZodDefLike }
}

/** densable P7r */
export function isCoercibleJsonSchemaType(
  type: string | undefined,
): type is 'array' | 'object' | 'integer' | 'number' | 'boolean' {
  return (
    type === 'array' ||
    type === 'object' ||
    type === 'integer' ||
    type === 'number' ||
    type === 'boolean'
  )
}

/** densable Y5s */
export function isMetaOnlyJsonSchema(schema: unknown): boolean {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    return false
  }
  return Object.keys(schema).every(key => META_ONLY_JSON_SCHEMA_KEYS.has(key))
}

/**
 * densable SKt — resolve a concrete JSON Schema type, following $ref / anyOf / oneOf.
 */
export function resolveJsonSchemaType(
  schema: unknown,
  defs: Record<string, unknown> | undefined,
  seen: Set<unknown> = new Set(),
): string | undefined {
  if (
    seen.size > 64 ||
    seen.has(schema) ||
    schema === null ||
    typeof schema !== 'object'
  ) {
    return undefined
  }
  seen.add(schema)
  const node = schema as JsonSchemaNode

  if (typeof node.type === 'string') return node.type

  const pick = (types: Array<string | undefined>): string | undefined => {
    let structured: string | undefined
    let other: string | undefined
    let hasString = false
    for (const t of types) {
      if (t === 'array' || t === 'object') structured ??= t
      else if (t === 'string') hasString = true
      else if (t !== undefined && t !== 'null') other ??= t
    }
    return structured ?? (hasString ? 'string' : other)
  }

  if (Array.isArray(node.type)) {
    const picked = pick(
      node.type.filter((t): t is string => typeof t === 'string'),
    )
    if (picked !== undefined) return picked
  }

  if (typeof node.$ref === 'string' && defs) {
    const m = node.$ref.match(/^#\/(?:\$defs|definitions)\/([^/]+)$/)
    if (m?.[1]) return resolveJsonSchemaType(defs[m[1]], defs, seen)
  }

  for (const branch of [node.anyOf, node.oneOf]) {
    if (Array.isArray(branch)) {
      const picked = pick(branch.map(b => resolveJsonSchemaType(b, defs, seen)))
      if (picked !== undefined) return picked
    }
  }
  return undefined
}

/** densable X5s — unwrap Zod optional/nullable/default/pipe to inner type name. */
export function unwrapZodDefType(def: ZodDefLike | undefined): string {
  let cur: ZodDefLike | undefined = def
  while (cur) {
    switch (cur.type) {
      case 'optional':
      case 'nullable':
      case 'default':
        if (!cur.innerType) return cur.type
        cur = cur.innerType._zod?.def
        break
      case 'pipe':
        if (!cur.in) return cur.type
        cur = cur.in._zod?.def
        break
      default:
        return cur.type ?? 'unknown'
    }
  }
  return 'unknown'
}

function parsedMatchesCoerceType(
  parsed: unknown,
  raw: string,
  expected: 'array' | 'object' | 'boolean' | 'integer' | 'number' | 'any',
): boolean {
  switch (expected) {
    case 'array':
      return Array.isArray(parsed)
    case 'object':
      return (
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      )
    case 'boolean':
      return typeof parsed === 'boolean'
    case 'integer':
    case 'number':
      return (
        typeof parsed === 'number' &&
        Number.isFinite(parsed) &&
        String(parsed) === raw &&
        (expected === 'number' || Number.isInteger(parsed))
      )
    case 'any':
      return (
        typeof parsed === 'boolean' ||
        Array.isArray(parsed) ||
        (parsed !== null && typeof parsed === 'object') ||
        (typeof parsed === 'number' &&
          Number.isFinite(parsed) &&
          String(parsed) === raw)
      )
  }
}

/**
 * densable qPy / SEA V5s — shallow coerce of stringified nested tool-input fields.
 */
export function coerceNestedStringifiedToolInput(
  input: Record<string, unknown>,
  zodSchema: unknown,
  jsonSchema?: JsonSchemaRoot | null,
): Record<string, unknown> {
  let out: Record<string, unknown> = input

  const coerceKey = (
    key: string,
    expected: 'array' | 'object' | 'boolean' | 'integer' | 'number' | 'any',
  ): void => {
    const raw = out[key]
    if (typeof raw !== 'string') return
    const parsed = safeParseJSON(raw, false)
    if (!parsedMatchesCoerceType(parsed, raw, expected)) return
    if (out === input) out = { ...input }
    out[key] = parsed
  }

  const zodDef = (zodSchema as ZodSchemaLike | null | undefined)?._zod?.def
  if (zodDef?.type === 'object' && zodDef.shape) {
    for (const [key, field] of Object.entries(zodDef.shape)) {
      const inner = unwrapZodDefType(field._zod?.def)
      if (isCoercibleJsonSchemaType(inner)) coerceKey(key, inner)
    }
  }

  if (jsonSchema?.properties) {
    const defs = jsonSchema.$defs ?? jsonSchema.definitions
    for (const [key, propSchema] of Object.entries(jsonSchema.properties)) {
      const resolved = resolveJsonSchemaType(propSchema, defs)
      if (isCoercibleJsonSchemaType(resolved)) coerceKey(key, resolved)
      else if (resolved === undefined && isMetaOnlyJsonSchema(propSchema)) {
        coerceKey(key, 'any')
      }
    }
  }

  return out
}
