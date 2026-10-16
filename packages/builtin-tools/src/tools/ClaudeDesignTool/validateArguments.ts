/**
 * densable 2.1.289 ClaudeDesign argument validator (gold `le` / `W` / `V` / `G`).
 * Public names are semantic — do not export minify `le`/`W`/`G`/`N`/`K`.
 */

type ScalarEnum = Set<string> | { accepts: Set<string>; serverNormalizes: true }

type ArrayFieldSchema = {
  fields: Set<string>
  required: Set<string>
}

type ArraySchema = 'string' | ArrayFieldSchema

type OpArgumentSchema = {
  top: Set<string>
  arrays?: Record<string, ArraySchema>
  scalarEnums?: Record<string, ScalarEnum>
}

export type DesignOpHints = {
  readOnly: boolean
  destructive: boolean
}

/** Gold `G` operation catalog. */
export const operationHints: Record<string, DesignOpHints> = {
  list_design_systems: { readOnly: true, destructive: false },
  get_claude_design_prompt: { readOnly: true, destructive: false },
  list_projects: { readOnly: true, destructive: false },
  get_project: { readOnly: true, destructive: false },
  list_files: { readOnly: true, destructive: false },
  read_file: { readOnly: true, destructive: false },
  get_conversation: { readOnly: true, destructive: false },
  list_members: { readOnly: true, destructive: false },
  render_preview: { readOnly: false, destructive: false },
  create_project: { readOnly: false, destructive: false },
  put_conversation: { readOnly: false, destructive: false },
  finalize_plan: { readOnly: false, destructive: false },
  write_files: { readOnly: false, destructive: false },
  copy_files: { readOnly: false, destructive: false },
  create_support_js: { readOnly: false, destructive: false },
  add_member: { readOnly: false, destructive: false },
  delete_files: { readOnly: false, destructive: true },
  remove_member: { readOnly: false, destructive: true },
  update_member_role: { readOnly: false, destructive: true },
  update_sharing: { readOnly: false, destructive: true },
}

const MEMBER_ROLE_ENUM: ScalarEnum = {
  accepts: new Set(['viewer', 'commenter', 'editor']),
  serverNormalizes: true,
}

/** Gold `W` WRITE_OP_SCHEMAS. */
export const writeOpSchemas: Record<string, OpArgumentSchema> = {
  create_project: { top: new Set(['name', 'design_system_id']) },
  put_conversation: {
    top: new Set(['project_id', 'title', 'messages']),
    arrays: {
      messages: {
        fields: new Set(['role', 'content']),
        required: new Set(['role', 'content']),
      },
    },
  },
  finalize_plan: {
    top: new Set(['project_id', 'writes', 'deletes', 'scope']),
    arrays: { writes: 'string', deletes: 'string' },
    scalarEnums: { scope: new Set(['paths', 'project']) },
  },
  write_files: {
    top: new Set(['project_id', 'plan_token', 'files']),
    arrays: {
      files: {
        fields: new Set(['path', 'data', 'local_path', 'encoding', 'if_match']),
        required: new Set(['path']),
      },
    },
  },
  delete_files: {
    top: new Set(['project_id', 'plan_token', 'paths', 'files']),
    arrays: {
      paths: 'string',
      files: {
        fields: new Set(['path', 'if_match']),
        required: new Set(['path']),
      },
    },
  },
  copy_files: {
    top: new Set(['project_id', 'plan_token', 'files']),
    arrays: {
      files: {
        fields: new Set(['src', 'dest', 'src_project_id', 'if_match']),
        required: new Set(['src', 'dest']),
      },
    },
  },
  render_preview: {
    top: new Set(['project_id', 'path', 'render', 'validators']),
    arrays: { validators: 'string' },
  },
  create_support_js: {
    top: new Set(['project_id', 'plan_token', 'path', 'if_match']),
  },
  add_member: {
    top: new Set(['project_id', 'account_uuid', 'email', 'role']),
    scalarEnums: { role: MEMBER_ROLE_ENUM },
  },
  update_member_role: {
    top: new Set(['project_id', 'account_uuid', 'role']),
    scalarEnums: { role: MEMBER_ROLE_ENUM },
  },
  remove_member: { top: new Set(['project_id', 'account_uuid']) },
  update_sharing: {
    top: new Set(['project_id', 'scope', 'link_permission']),
    scalarEnums: {
      scope: {
        accepts: new Set(['invited', 'org']),
        serverNormalizes: true,
      },
      link_permission: {
        accepts: new Set(['view', 'comment', 'edit']),
        serverNormalizes: true,
      },
    },
  },
}

/** Gold `V` read-op argument schemas. */
export const readOpSchemas: Record<string, OpArgumentSchema> = {
  list: { top: new Set(['full']) },
  list_design_systems: { top: new Set() },
  get_claude_design_prompt: {
    top: new Set(['design_system_id', 'project_id']),
  },
  list_projects: { top: new Set() },
  get_project: { top: new Set(['project_id']) },
  list_files: { top: new Set(['project_id', 'path']) },
  read_file: { top: new Set(['project_id', 'path']) },
  get_conversation: { top: new Set(['project_id', 'chat_id']) },
  list_members: { top: new Set(['project_id']) },
}

/** Gold `eHt` — finalize_plan project_id length cap (reject when length > cap-2). */
export const DESIGN_PROJECT_ID_LENGTH_CAP = 80

const discoveredHints = new Map<string, DesignOpHints>()

export function resetDiscoveredOperationHints(): void {
  discoveredHints.clear()
}

export function recordDiscoveredOperationHints(
  tools: ReadonlyArray<{
    name?: unknown
    annotations?: { readOnlyHint?: unknown; destructiveHint?: unknown }
  }>,
): void {
  for (const tool of tools) {
    if (typeof tool.name !== 'string') continue
    const catalog = operationHints[tool.name]
    const readHint =
      typeof tool.annotations?.readOnlyHint === 'boolean'
        ? tool.annotations.readOnlyHint
        : undefined
    const destructiveHint =
      typeof tool.annotations?.destructiveHint === 'boolean'
        ? tool.annotations.destructiveHint
        : undefined
    let readOnly = readHint ?? catalog?.readOnly ?? false
    let destructive = destructiveHint ?? catalog?.destructive ?? true
    if (catalog) {
      readOnly &&= catalog.readOnly
      destructive ||= catalog.destructive
    }
    discoveredHints.set(tool.name, { readOnly, destructive })
  }
}

/** Gold `N(op) ?? K(op)`. */
export function getOperationHints(op: string): DesignOpHints | undefined {
  return discoveredHints.get(op) ?? operationHints[op]
}

export function isDesignOperationReadOnly(op: string): boolean {
  return getOperationHints(op)?.readOnly === true
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function truncArgName(name: string): string {
  return name.length > 60 ? `${name.slice(0, 60)}…` : name
}

function isNormalizingEnum(
  value: ScalarEnum,
): value is { accepts: Set<string>; serverNormalizes: true } {
  return typeof value === 'object' && value !== null && 'accepts' in value
}

/**
 * Gold `le(e,t)` — validate write/read operation arguments.
 * Returns an error string, or null when the call may proceed.
 */
export function validateWriteOpArgs(
  operation: string,
  args: Record<string, unknown> | undefined,
): string | null {
  const schema = Object.hasOwn(writeOpSchemas, operation)
    ? writeOpSchemas[operation]
    : Object.hasOwn(readOpSchemas, operation)
      ? readOpSchemas[operation]
      : undefined
  if (!schema) {
    const hints = discoveredHints.get(operation)
    if (hints?.readOnly === true) return null
    if (hints !== undefined) {
      return `ClaudeDesign ${operation}: the server reports this operation as write-capable, and this client version can't validate its arguments (it needs a WRITE_OP_SCHEMAS entry). Update Claude Code to use it.`
    }
    return `ClaudeDesign ${operation}: unrecognized operation. If the server added it recently, call {operation: "list"} first — a read-only operation becomes callable after discovery; a write-tier operation needs a WRITE_OP_SCHEMAS entry in this client.`
  }

  const prefix = `ClaudeDesign ${operation}`
  const t = args ?? {}
  if (
    operation === 'finalize_plan' &&
    t.scope === 'project' &&
    (t.writes !== undefined || t.deletes !== undefined)
  ) {
    return `${prefix}: scope "project" takes no writes/deletes — a project-scoped plan covers every path in the project.`
  }

  for (const [key, value] of Object.entries(t)) {
    if (!schema.top.has(key)) {
      const suggestion = [...schema.top].find(
        allowed => allowed.toLowerCase() === key.toLowerCase(),
      )
      const allowed = [...schema.top].join(', ')
      return `${prefix}: unrecognized argument '${truncArgName(key)}'${suggestion ? ` (did you mean '${suggestion}'?)` : ''}. ${allowed ? `Allowed: ${allowed}.` : 'This operation takes no arguments.'}`
    }
    if (
      !(key in (schema.arrays ?? {})) &&
      typeof value === 'object' &&
      value !== null
    ) {
      return `${prefix}.${key}: must be a scalar (string/bool/number), not ${Array.isArray(value) ? 'an array' : 'an object'}.`
    }
    const cap = key === 'plan_token' ? 65536 : 4096
    if (typeof value === 'string' && utf8Bytes(value) > cap) {
      return `${prefix}.${key}: too long (${utf8Bytes(value)} bytes; capped at ${cap}).`
    }
    const enumSpec = schema.scalarEnums?.[key]
    if (enumSpec !== undefined) {
      const normalizing = isNormalizingEnum(enumSpec)
      const accepted = normalizing ? enumSpec.accepts : enumSpec
      const compared =
        normalizing && typeof value === 'string'
          ? value.trim().toLowerCase()
          : value
      if (typeof compared !== 'string' || !accepted.has(compared)) {
        return `${prefix}.${key}: must be one of ${[...accepted].map(v => `"${v}"`).join(', ')}${normalizing ? ' (case-insensitive)' : ''}.`
      }
      if (
        normalizing &&
        typeof value === 'string' &&
        value.length > compared.length + 2
      ) {
        return `${prefix}.${key}: excess whitespace around the value.`
      }
    }
  }

  for (const [key, arraySchema] of Object.entries(schema.arrays ?? {})) {
    const raw = t[key]
    if (raw === undefined) continue
    if (!Array.isArray(raw)) return `${prefix}.${key}: must be an array.`
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i]
      if (arraySchema === 'string') {
        if (typeof item !== 'string') {
          return `${prefix}.${key}[${i}]: must be a string.`
        }
        if (utf8Bytes(item) > 4096) {
          return `${prefix}.${key}[${i}]: too long (${utf8Bytes(item)} bytes; capped at 4096).`
        }
        continue
      }
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return `${prefix}.${key}[${i}]: must be an object with keys from {${[...arraySchema.fields].join(', ')}}.`
      }
      const record = item as Record<string, unknown>
      for (const required of arraySchema.required) {
        if (typeof record[required] !== 'string') {
          return `${prefix}.${key}[${i}]: missing required field '${required}'.`
        }
      }
      for (const [field, fieldValue] of Object.entries(record)) {
        if (!arraySchema.fields.has(field)) {
          const suggestion = [...arraySchema.fields].find(
            allowed => allowed.toLowerCase() === field.toLowerCase(),
          )
          const contentHint =
            field === 'content'
              ? " (did you mean 'data'? designmcp's write_files reads 'data', not 'content')"
              : ''
          return `${prefix}.${key}[${i}]: unrecognized field '${truncArgName(field)}'${suggestion ? ` (did you mean '${suggestion}'?)` : contentHint}. Allowed: ${[...arraySchema.fields].join(', ')}.`
        }
        if (typeof fieldValue !== 'string') {
          return `${prefix}.${key}[${i}].${field}: must be a string (got ${Array.isArray(fieldValue) ? 'array' : typeof fieldValue}).`
        }
        if (
          field !== 'data' &&
          field !== 'content' &&
          utf8Bytes(fieldValue) > 4096
        ) {
          return `${prefix}.${key}[${i}].${field}: too long (${utf8Bytes(fieldValue)} bytes; non-body fields are capped at 4096).`
        }
      }
    }
  }
  return null
}

export function validateFinalizePlanProjectId(
  projectId: unknown,
): string | null {
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return 'ClaudeDesign finalize_plan: project_id is required (a plan is always scoped to one project).'
  }
  if (!/^[A-Za-z0-9._-]+$/.test(projectId)) {
    return 'ClaudeDesign finalize_plan: project_id contains characters outside the server id charset (letters, digits, dot, underscore, dash).'
  }
  if (projectId.length > DESIGN_PROJECT_ID_LENGTH_CAP - 2) {
    return 'ClaudeDesign finalize_plan: project_id is longer than any server-issued project id.'
  }
  return null
}

export function redactDesignOauthToken(text: string, token: string): string {
  if (!token) return text
  return text.split(token).join('[redacted-oauth-token]')
}
