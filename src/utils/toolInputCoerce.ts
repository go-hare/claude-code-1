/**
 * densable residual: optional tool.coerceInput / validationErrorSteer helpers.
 *
 * Official tools may remap common model shape mistakes (snake_case aliases,
 * array-wrapped scalars, TaskCreate wrapper objects) before Zod safeParse.
 * Pure helpers live here so unit tests don't need the full tool stack.
 */

export type CoercedToolInput = {
  input: Record<string, unknown>
  shapeClass: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function hasTasksOrTodos(value: Record<string, unknown>): boolean {
  return 'tasks' in value || 'todos' in value
}

function hasAgentParams(value: Record<string, unknown>): boolean {
  return 'prompt' in value || 'subagent_type' in value
}

/** densable ZKg — truncate description → subject (≤80 graphemes, prefer word break). */
export function truncateToSubjectTitle(text: string, max = 80): string {
  const t = text.trim()
  const chars = Array.from(t)
  if (chars.length <= max) return t
  const head = chars.slice(0, max).join('')
  const lastSpace = head.lastIndexOf(' ')
  return (lastSpace > 40 ? head.slice(0, lastSpace) : head).trim()
}

/**
 * densable uWu — TaskCreate coerceInput.
 * Remaps aliases (title/name→subject, content→description, active_form→activeForm),
 * unwraps `{task: ...}`, backfills missing subject/description, strips unknown keys
 * when both subject+description are present.
 */
export function coerceTaskCreateInput(raw: unknown): CoercedToolInput | null {
  if (!isPlainObject(raw)) return null
  if (hasTasksOrTodos(raw)) return null
  const tags: string[] = []
  const r: Record<string, unknown> = { ...raw }
  if (
    hasAgentParams(r) &&
    !(isNonEmptyString(r.subject) && isNonEmptyString(r.description))
  ) {
    return null
  }
  if (!('subject' in r) && !('description' in r) && 'task' in r) {
    const task = r.task
    if (isNonEmptyString(task)) {
      delete r.task
      r.description = task
      tags.push('task_wrapper_string')
    } else if (isPlainObject(task)) {
      if (hasTasksOrTodos(task)) return null
      if (
        hasAgentParams(task) &&
        !(isNonEmptyString(task.subject) && isNonEmptyString(task.description))
      ) {
        return null
      }
      delete r.task
      Object.assign(r, task)
      tags.push('task_wrapper_object')
    } else {
      return null
    }
  }
  const aliasGroups: Array<[string[], string]> = [
    [['title', 'name'], 'subject'],
    [['content'], 'description'],
    [['active_form'], 'activeForm'],
  ]
  for (const [aliases, dest] of aliasGroups) {
    for (const a of aliases) {
      if (a in r && !(dest in r) && isNonEmptyString(r[a])) {
        r[dest] = r[a]
        delete r[a]
        tags.push(`alias_${a}`)
      }
    }
  }
  if (isNonEmptyString(r.subject) && !('description' in r)) {
    r.description = r.subject
    tags.push('backfill_description')
  } else if (isNonEmptyString(r.description) && !('subject' in r)) {
    r.subject = truncateToSubjectTitle(String(r.description))
    tags.push('backfill_subject')
  }
  if (isNonEmptyString(r.subject) && isNonEmptyString(r.description)) {
    const allowed = new Set([
      'subject',
      'description',
      'activeForm',
      'metadata',
    ])
    const knownJunk = new Set([
      'status',
      'state',
      'priority',
      'prompt',
      'subagent_type',
      'id',
      'type',
      'owner',
      'blocks',
      'blockedBy',
      'addBlocks',
      'addBlockedBy',
    ])
    for (const key of Object.keys(r)) {
      if (!allowed.has(key)) {
        delete r[key]
        tags.push(`strip_${knownJunk.has(key) ? key : 'other'}`)
      }
    }
    if ('activeForm' in r && typeof r.activeForm !== 'string') {
      delete r.activeForm
      tags.push('drop_invalid_activeForm')
    }
    if ('metadata' in r && !isPlainObject(r.metadata)) {
      delete r.metadata
      tags.push('drop_invalid_metadata')
    }
  }
  if (tags.length === 0) return null
  return { input: r, shapeClass: tags.join('+') }
}

/**
 * densable dWu — TaskCreate validationErrorSteer for multi-task / agent-shape mistakes.
 */
export function steerTaskCreateValidationError(raw: unknown): string | null {
  if (!isPlainObject(raw)) return null
  const nested = isPlainObject(raw.task) ? raw.task : null
  if (hasTasksOrTodos(raw) || (nested !== null && hasTasksOrTodos(nested))) {
    return (
      'TaskCreate creates ONE task per call and has no `tasks` or `todos` parameter. ' +
      'Call TaskCreate once per task, passing `subject` (a brief title) and `description` ' +
      '(what needs to be done) as top-level string parameters.'
    )
  }
  if (
    (hasAgentParams(raw) || (nested !== null && hasAgentParams(nested))) &&
    !(isNonEmptyString(raw.subject) && isNonEmptyString(raw.description))
  ) {
    return (
      'This call used Agent-tool parameters (`prompt`/`subagent_type`). TaskCreate adds an item ' +
      'to the task list and takes `subject` and `description` string parameters. To delegate work ' +
      'to a subagent, use the Agent tool instead.'
    )
  }
  return null
}

/**
 * densable S8r — TaskUpdate/Task* id aliases: id|task_id→taskId, active_form→activeForm.
 */
export function coerceTaskIdAliasInput(raw: unknown): CoercedToolInput | null {
  if (!isPlainObject(raw)) return null
  const tags: string[] = []
  const r: Record<string, unknown> = { ...raw }
  const groups: Array<[string[], string]> = [
    [['id', 'task_id'], 'taskId'],
    [['active_form'], 'activeForm'],
  ]
  for (const [aliases, dest] of groups) {
    for (const a of aliases) {
      if (a in r && !(dest in r) && isNonEmptyString(r[a])) {
        r[dest] = r[a]
        delete r[a]
        tags.push(`alias_${a}`)
      }
    }
  }
  if (tags.length === 0) return null
  return { input: r, shapeClass: tags.join('+') }
}

/**
 * densable _yu — FileEdit aliases: path→file_path, old_str→old_string, new_str→new_string,
 * replace_name→replace_all.
 */
export function coerceFileEditInput(raw: unknown): CoercedToolInput | null {
  if (!isPlainObject(raw)) return null
  const t: Record<string, unknown> = { ...raw }
  const tags: string[] = []
  if ('replace_name' in t) {
    const n = t.replace_name
    if (!('replace_all' in t)) {
      t.replace_all = n === true || n === 'true'
    }
    delete t.replace_name
    tags.push('alias_replace_name')
  }
  if ('path' in t && !('file_path' in t) && typeof t.path === 'string') {
    t.file_path = t.path
    delete t.path
    tags.push('path')
  }
  if (
    'old_str' in t &&
    !('old_string' in t) &&
    typeof t.old_str === 'string'
  ) {
    t.old_string = t.old_str
    delete t.old_str
    tags.push('old_str')
  }
  if (
    'new_str' in t &&
    !('new_string' in t) &&
    typeof t.new_str === 'string'
  ) {
    t.new_string = t.new_str
    delete t.new_str
    tags.push('new_str')
  }
  if (tags.length === 0) return null
  return { input: t, shapeClass: tags.join(',') }
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/**
 * densable gxd — FileRead: unwrap singleton offset/limit arrays, drop bad offsets,
 * map length→limit.
 */
export function coerceFileReadInput(raw: unknown): CoercedToolInput | null {
  if (!isPlainObject(raw)) return null
  const t: Record<string, unknown> = { ...raw }
  const tags: string[] = []
  if (Array.isArray(t.offset) && t.offset.length === 1) {
    t.offset = t.offset[0]
    tags.push('offset_array')
  }
  if (Array.isArray(t.limit) && t.limit.length === 1) {
    t.limit = t.limit[0]
    tags.push('limit_array')
  }
  const offsetN = asFiniteNumber(t.offset)
  if (offsetN !== undefined && offsetN < 0) {
    delete t.offset
    tags.push('offset_neg')
  }
  const limitN = asFiniteNumber(t.limit)
  if (limitN !== undefined && limitN <= 0) {
    delete t.limit
    tags.push('limit_dropped')
  }
  if ('length' in t) {
    const lengthN = asFiniteNumber(t.length)
    if (!('limit' in t) && lengthN !== undefined && lengthN > 0) {
      t.limit = lengthN
    }
    delete t.length
    tags.push('length')
  }
  if (tags.length === 0) return null
  return { input: t, shapeClass: tags.join(',') }
}

/**
 * densable Kvu — Bash: timeout_ms → timeout.
 */
export function coerceBashTimeoutInput(raw: unknown): CoercedToolInput | null {
  if (!isPlainObject(raw)) return null
  const t: Record<string, unknown> = { ...raw }
  const tags: string[] = []
  if ('timeout_ms' in t && !('timeout' in t)) {
    const n = t.timeout_ms
    if (
      typeof n === 'number' ||
      (typeof n === 'string' && /^\d+$/.test(n))
    ) {
      t.timeout = n
      tags.push('timeout_ms')
    }
    delete t.timeout_ms
  }
  if (tags.length === 0) return null
  return { input: t, shapeClass: tags.join(',') }
}
