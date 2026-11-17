import { toJSONSchema, type ZodTypeAny } from 'zod/v4'
import { jsonStringify } from '../slowOperations.js'
import { SettingsSchema } from './types.js'

const UNREPRESENTABLE = new Set([
  'bigint',
  'symbol',
  'void',
  'date',
  'map',
  'set',
  'transform',
  'nan',
  'custom',
  'function',
])

type ClaudeJsonSchemaOverrideContext = {
  zodSchema: unknown
  jsonSchema: Record<string, unknown>
}

type ClaudeJsonSchemaOptions = {
  io?: 'input' | 'output'
  unrepresentable?: 'throw' | 'any'
  target?: 'draft-2020-12' | 'draft-7' | 'draft-4' | 'openapi-3.0'
  override?: (ctx: ClaudeJsonSchemaOverrideContext) => void
}

type InternalZodDef = {
  type?: string
  shape?: Record<string, InternalZodNode>
  in?: InternalZodNode
  out?: InternalZodNode
  options?: InternalZodNode[]
  innerType?: InternalZodNode
  catchValue?: (ctx: unknown) => unknown
}

type InternalZodNode = {
  _zod?: {
    def?: InternalZodDef
    bag?: { minimum?: unknown; maximum?: unknown }
    innerType?: InternalZodNode
    optin?: string
    optout?: string
  }
}

const KEEP_BRANCH_KEY = 'x-claude-code-keep-branch'

/** densable `Id` — strip temporary keep-branch marker from anyOf/allOf branches. */
function stripKeepBranchMarker(branches: unknown): void {
  if (!Array.isArray(branches)) return
  for (const branch of branches) {
    if (branch && typeof branch === 'object') {
      delete (branch as Record<string, unknown>)[KEEP_BRANCH_KEY]
    }
  }
}

/** densable `Wy` — clean Zod v4 tuple JSON Schema artifacts. */
function cleanTupleSchema(
  json: Record<string, unknown>,
  zodNode: InternalZodNode,
): void {
  const bag = zodNode._zod?.bag
  if (json.items === false) delete json.items
  if (json.additionalItems === false) delete json.additionalItems
  if (typeof bag?.minimum !== 'number') delete json.minItems
  if (typeof bag?.maximum !== 'number') delete json.maxItems
}

/** densable `Gy` — validate static catch value and inject input default. */
function applyCatchDefault(
  json: Record<string, unknown>,
  def: InternalZodDef,
  io: 'input' | 'output',
): void {
  let fallback: unknown
  try {
    fallback = def.catchValue?.(undefined)
  } catch {
    throw new Error('Dynamic catch values are not supported in JSON Schema')
  }
  if (io !== 'input' || Object.hasOwn(json, 'default')) return
  const existing = { ...json }
  for (const key of Object.keys(existing)) {
    delete json[key]
  }
  json.default = fallback
  Object.assign(json, existing)
}

/** densable `Ct` — true when `node` can accept/produce `undefined` under `io`. */
function isOptionalForJsonSchema(
  node: InternalZodNode | undefined,
  io: 'input' | 'output',
): boolean {
  const zod = node?._zod
  const def = zod?.def
  switch (def?.type) {
    case 'undefined':
      return true
    case 'transform':
      return false
    case 'pipe':
      if (io === 'input' && def.in?._zod?.def?.type === 'transform') {
        return isOptionalForJsonSchema(def.out, io)
      }
      return isOptionalForJsonSchema(io === 'input' ? def.in : def.out, io)
    case 'union':
      return (def.options ?? []).some(opt => isOptionalForJsonSchema(opt, io))
    case 'nullable':
    case 'readonly':
      return isOptionalForJsonSchema(def.innerType, io)
    case 'catch':
      return io === 'input' || isOptionalForJsonSchema(def.innerType, io)
    case 'lazy':
      if (zod?.innerType) {
        return isOptionalForJsonSchema(zod.innerType, io)
      }
      return (io === 'input' ? zod?.optin : zod?.optout) === 'optional'
    default:
      return io === 'input'
        ? zod?.optin !== undefined
        : zod?.optout === 'optional'
  }
}

/**
 * densable `JOe` — wrap Zod `toJSONSchema`. Inner conversion always uses
 * `unrepresentable: "any"` so Zod itself never throws; `undefined` becomes
 * `{not:{}}`, `oneOf` becomes `anyOf`, object `required` respects `pipe`/`catch`,
 * tuples drop `items:false`, and `catch` injects static `default` on `input`.
 */
export function toJSONSchemaClaude(
  schema: ZodTypeAny,
  opts?: ClaudeJsonSchemaOptions,
): Record<string, unknown> {
  const io = opts?.io ?? 'output'
  const unrepresentable = opts?.unrepresentable ?? 'throw'
  return toJSONSchema(schema, {
    ...opts,
    io,
    unrepresentable: 'any',
    override(ctx) {
      const zodNode = ctx.zodSchema as InternalZodNode
      const def = zodNode._zod?.def
      const json = ctx.jsonSchema as Record<string, unknown>
      const type = def?.type
      if (
        unrepresentable === 'throw' &&
        type !== undefined &&
        UNREPRESENTABLE.has(type)
      ) {
        throw new Error('Schema type cannot be represented in JSON Schema')
      }
      if (type === 'undefined') {
        json.not = {}
      } else if (type === 'union' && json.oneOf) {
        json.anyOf = json.oneOf
        delete json.oneOf
      } else if (
        type === 'object' &&
        json.properties &&
        !json.$ref &&
        def?.shape
      ) {
        const shape = def.shape
        const requiredKeys = Object.keys(shape).filter(
          key => !isOptionalForJsonSchema(shape[key], io),
        )
        const additionalProps = json.additionalProperties
        delete json.required
        delete json.additionalProperties
        if (requiredKeys.length > 0) {
          json.required = requiredKeys
        }
        if (additionalProps !== undefined) {
          json.additionalProperties = additionalProps
        }
      } else if (type === 'tuple' && opts?.target !== 'openapi-3.0') {
        cleanTupleSchema(json, zodNode)
      } else if (type === 'catch' && def) {
        applyCatchDefault(json, def, io)
      }
      stripKeepBranchMarker(json.anyOf)
      stripKeepBranchMarker(json.allOf)
      opts?.override?.({
        zodSchema: ctx.zodSchema,
        jsonSchema: json,
      })
    },
  }) as Record<string, unknown>
}

const INTERNAL_DESC = /^@internal(?:\b|$)/

function isInternalDescription(value: unknown): boolean {
  return typeof value === 'string' && INTERNAL_DESC.test(value)
}

/**
 * densable `PRn(e,n)`. `n===false` drops `@internal` properties from the
 * settings dump (update-config skill).
 */
export function stripInternalJsonSchema(
  node: unknown,
  keepInternal: boolean,
): void {
  if (Array.isArray(node)) {
    for (const item of node) stripInternalJsonSchema(item, keepInternal)
    return
  }
  if (node === null || typeof node !== 'object') return
  const rec = node as Record<string, unknown>
  if (keepInternal && isInternalDescription(rec.description)) {
    const trimmed = String(rec.description)
      .replace(/^@internal\s*/, '')
      .trim()
    if (trimmed) rec.description = trimmed
    else delete rec.description
  }
  const properties = rec.properties
  if (
    !keepInternal &&
    properties !== null &&
    typeof properties === 'object' &&
    !Array.isArray(properties)
  ) {
    const props = properties as Record<string, unknown>
    for (const key of Object.keys(props)) {
      const child = props[key]
      const desc =
        child !== null &&
        typeof child === 'object' &&
        !Array.isArray(child) &&
        'description' in child
          ? (child as { description?: unknown }).description
          : undefined
      if (isInternalDescription(desc)) {
        delete props[key]
        if (Array.isArray(rec.required)) {
          rec.required = (rec.required as unknown[]).filter(r => r !== key)
        }
      }
    }
  }
  if (!keepInternal) {
    for (const key of ['anyOf', 'oneOf'] as const) {
      const list = rec[key]
      if (Array.isArray(list)) {
        const kept = list.filter(
          item =>
            item === null ||
            typeof item !== 'object' ||
            Array.isArray(item) ||
            !isInternalDescription(
              (item as { description?: unknown }).description,
            ),
        )
        if (kept.length === 0) delete rec[key]
        else rec[key] = kept
      }
    }
  }
  for (const value of Object.values(rec)) {
    stripInternalJsonSchema(value, keepInternal)
  }
}

export function generateSettingsJSONSchema(): string {
  const jsonSchema = toJSONSchemaClaude(SettingsSchema(), {
    unrepresentable: 'any',
  })
  stripInternalJsonSchema(jsonSchema, false)
  return jsonStringify(jsonSchema, null, 2)
}
