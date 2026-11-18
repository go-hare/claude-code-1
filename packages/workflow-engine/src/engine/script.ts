import type { WorkflowMeta } from '../types.js'

export class ScriptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScriptError'
  }
}

/** Shape of the hook functions the engine injects into a script. */
export type WorkflowHooks = {
  agent: (prompt: string, opts?: Record<string, unknown>) => Promise<unknown>
  parallel: <T>(thunks: Array<() => Promise<T>>) => Promise<Array<T | null>>
  pipeline: <T, R>(
    items: readonly T[],
    ...stages: Array<
      (prev: unknown, item: T, index: number) => Promise<unknown>
    >
  ) => Promise<Array<R | null>>
  phase: (title: string) => void
  log: (message: string) => void
  workflow: (
    nameOrRef: string | { scriptPath: string },
    args?: unknown,
  ) => Promise<unknown>
}

const META_RE = /export\s+const\s+meta\s*=\s*/

/**
 * Extract the `export const meta = { ... }` pure literal. Returns the meta object and the stripped body.
 * The literal is evaluated with a parameter-less Function — any identifier reference throws ReferenceError → reported as "not a plain literal".
 */
export function extractMeta(rawSource: string): {
  meta: WorkflowMeta | null
  body: string
} {
  const source = rawSource.replaceAll('\r\n', '\n')
  const match = META_RE.exec(source)
  if (!match) return { meta: null, body: source }

  let i = match.index + match[0].length
  while (i < source.length && /\s/.test(source[i]!)) i++
  if (source[i] !== '{') {
    throw new ScriptError('meta must be an object literal `{ ... }`')
  }

  // Brace matching (handles strings / escapes / nesting)
  let depth = 0
  const start = i
  let inStr: string | null = null
  for (; i < source.length; i++) {
    const ch = source[i]!
    if (inStr) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        i++
        break
      }
    }
  }
  if (depth !== 0) throw new ScriptError('meta literal braces are not closed')

  const literal = source.slice(start, i)
  let metaObj: unknown
  try {
    // Parameter-less Function: a plain literal can be evaluated; referencing any identifier → ReferenceError
    metaObj = new Function(`return (${literal})`)()
  } catch (e) {
    throw new ScriptError(
      `meta must be a plain literal (no variable/function calls/interpolation): ${(e as Error).message}`,
    )
  }
  const meta = validateMeta(metaObj)

  // Strip the meta statement (including trailing semicolon and extra blank lines)
  const body =
    source.slice(0, match.index) +
    source.slice(i).replace(/^[ \t]*;[ \t]*\n/, '\n')
  return { meta, body }
}

function validateMeta(v: unknown): WorkflowMeta {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ScriptError('meta must be an object')
  }
  const o = v as Record<string, unknown>
  if (typeof o.name !== 'string' || typeof o.description !== 'string') {
    throw new ScriptError('meta must include string name and description')
  }
  return o as unknown as WorkflowMeta
}

// ---- Non-determinism sandbox shim ----
class NonDeterministicError extends Error {
  constructor(fn: string) {
    super(
      `${fn} is not available in workflow scripts (would break resume determinism). Pass timestamps/random seeds via args.`,
    )
    this.name = 'NonDeterministicError'
  }
}

function sandboxDate(): DateConstructor {
  const fn = function (...args: unknown[]): Date {
    if (args.length === 0)
      throw new NonDeterministicError('Date.now()/new Date()')
    return new (Date as unknown as DateConstructor)(
      ...(args as [string | number | Date]),
    )
  } as unknown as DateConstructor
  fn.now = () => {
    throw new NonDeterministicError('Date.now()')
  }
  fn.parse = Date.parse
  fn.UTC = Date.UTC
  return fn
}

function sandboxMath(): Math {
  return new Proxy(Math, {
    get(target, prop, receiver) {
      if (prop === 'random') {
        return () => {
          throw new NonDeterministicError('Math.random()')
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as Math
}

const AsyncFunction = Object.getPrototypeOf(async function () {})
  .constructor as {
  new (...args: string[]): (...args: unknown[]) => Promise<unknown>
}

export type ParsedScript = {
  meta: WorkflowMeta | null
  execute: (
    hooks: WorkflowHooks,
    args: unknown,
    budget: unknown,
  ) => Promise<unknown>
}

/** Validate + wrap the script as an executable async function (Date/Math are shimmed). */
/**
 * Detect common violations in the script body (import / extra export) and produce precise errors with guidance.
 * Otherwise it would fall through to AsyncFunction's generic "syntax error", making it hard for the model/user to pinpoint the root cause
 * (the script is a non-ESM function body, hooks are already injected, and the engine does not transpile TS).
 */
function assertScriptBody(body: string): void {
  if (/^\s*import\b/m.test(body)) {
    throw new ScriptError(
      'workflow scripts are the body of new AsyncFunction (not ESM modules); import is not supported. ' +
        'agent / parallel / pipeline / phase / log / workflow / args / budget are injected as parameters — use them directly.',
    )
  }
  // Dynamic import(...) calls: the sandbox only preserves resume determinism, not security, but obvious escape attempts should be blocked.
  // Not anchored to the start of a line so it can catch `await import(...)`, `return import(...)`, etc.; requires `import` followed by `(` to intercept,
  // avoiding false positives where the word "import" appears inside a string literal (e.g. agent('please import this module')).
  if (/\bimport\s*\(/m.test(body)) {
    throw new ScriptError(
      'dynamic import(...) is forbidden in workflow scripts: it bypasses the Date/Math sandbox and breaks resume determinism. ' +
        'The sandbox does not guarantee security (same trust level as the LLM), but explicit escapes are prohibited. Inject external dependencies via args.',
    )
  }
  if (/^\s*export\b/m.test(body)) {
    throw new ScriptError(
      'workflow scripts allow only one export const meta = {...} (already extracted by the engine). ' +
        'Remove other export / export default statements; use top-level return for the result.',
    )
  }
}

export const WORKFLOW_ARRAY_LENGTH_CAP = 4096
export const WORKFLOW_DEPTH_CAP_LEAVING = 28000
export const WORKFLOW_DEPTH_CAP_ENTERING = 100000

const STACK_END_MESSAGES = new Set([
  'Maximum call stack size exceeded.',
  'Maximum call stack size exceeded',
])
const STACK_END_CAP_MSG =
  'the stack ran out while copying a value across the VM boundary'

/**
 * Official `l(...)` / `Zgn` (`primitivizeDeep`, 2.1.296 #508) — iterative deep
 * copy across the workflow script boundary with depth/array caps, cycle
 * preservation, `__proto__` stripping, and stack-overflow detection.
 */
export function primitivizeDeep(
  rootVal: unknown,
  options: { isLeaving?: boolean; arrayLengthCap?: number } = {},
): unknown {
  if (typeof rootVal === 'function') return undefined
  if (rootVal === null || typeof rootVal !== 'object') return rootVal

  const isLeaving = options.isLeaving ?? true
  const arrayLengthCap = options.arrayLengthCap ?? WORKFLOW_ARRAY_LENGTH_CAP
  const depthCap = isLeaving
    ? WORKFLOW_DEPTH_CAP_LEAVING
    : WORKFLOW_DEPTH_CAP_ENTERING
  const depthMsg = isLeaving
    ? `nesting deeper than ${WORKFLOW_DEPTH_CAP_LEAVING} levels is not supported`
    : `nesting deeper than ${WORKFLOW_DEPTH_CAP_ENTERING} levels is not supported`

  const capErrors = new WeakSet<object>()
  function capErr(msg: string): Error {
    const err = new ScriptError(msg)
    capErrors.add(err)
    return err
  }
  function lost(e: unknown): void {
    if (e !== null && typeof e === 'object' && capErrors.has(e)) throw e
    if (e instanceof Error) {
      const desc = Object.getOwnPropertyDescriptor(e, 'message')
      if (
        desc !== undefined &&
        typeof desc.value === 'string' &&
        STACK_END_MESSAGES.has(desc.value)
      ) {
        throw capErr(STACK_END_CAP_MSG)
      }
    }
  }
  function checkedLength(v: unknown[]): number {
    let len: unknown
    try {
      len = v.length
    } catch (e) {
      lost(e)
      throw new ScriptError(
        'unable to read array length across the workflow VM boundary',
      )
    }
    if (typeof len !== 'number' || !Number.isSafeInteger(len)) {
      throw capErr(
        'array length is not a safe integer across the workflow VM boundary',
      )
    }
    if (len > arrayLengthCap) {
      throw capErr(
        `array length ${len} exceeds the maximum of ${arrayLengthCap} supported across the workflow VM boundary`,
      )
    }
    return len
  }

  const seen = new WeakMap<object, unknown>()
  let childKeys: string[] | null = null
  let childLength = 0

  function make(v: object, depth: number): unknown[] | Record<string, unknown> {
    if (depth > depthCap) {
      throw capErr(depthMsg)
    }
    if (Array.isArray(v)) {
      const out: unknown[] = []
      seen.set(v, out)
      const len = checkedLength(v)
      childKeys = null
      childLength = len
      return out
    }
    const out: Record<string, unknown> = {}
    seen.set(v, out)
    childLength = 0
    let ks: string[]
    try {
      ks = Object.keys(v)
    } catch (e) {
      lost(e)
      return out
    }
    childKeys = ks
    childLength = ks.length
    return out
  }

  type Frame = {
    src: object
    out: unknown[] | Record<string, unknown>
    keys: string[] | null
    len: number
    i: number
    depth: number
    below: Frame | null
  }

  const root = make(rootVal, 1)
  let src: object = rootVal
  let out: unknown[] | Record<string, unknown> = root
  let keys: string[] | null = childKeys
  let len = childLength
  let i = 0
  let depth = 1
  let own: Frame | null = null
  let below: Frame | null = null

  for (;;) {
    if (i >= len) {
      if (below === null) return root
      own = below
      below = own.below
      src = own.src
      out = own.out
      keys = own.keys
      len = own.len
      i = own.i
      depth = own.depth
      continue
    }
    const at = i++
    let down: object | null = null
    let made: unknown[] | Record<string, unknown> | undefined
    if (keys === null) {
      const arrOut = out as unknown[]
      try {
        const vi = (src as unknown[])[at]
        if (vi === null || typeof vi !== 'object') {
          arrOut[at] = typeof vi === 'function' ? undefined : vi
          continue
        }
        const hit = seen.get(vi)
        if (hit !== undefined) {
          arrOut[at] = hit
          continue
        }
        made = arrOut[at] = make(vi, depth + 1)
        down = vi
      } catch (e) {
        lost(e)
        arrOut[at] = undefined
        continue
      }
    } else {
      const k = keys[at]!
      if (k === '__proto__') continue
      try {
        const vk = (src as Record<string, unknown>)[k]
        if (typeof vk === 'function') continue
        let val: unknown = vk
        if (vk !== null && typeof vk === 'object') {
          const hit = seen.get(vk)
          if (hit !== undefined) {
            val = hit
          } else {
            made = make(vk, depth + 1)
            val = made
            down = vk
          }
        }
        Object.defineProperty(out, k, {
          value: val,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      } catch (e) {
        lost(e)
        continue
      }
    }
    if (down === null || childLength === 0 || made === undefined) continue
    if (own === null) {
      own = { src, out, keys, len, i, depth, below }
    } else {
      ;(own as Frame).i = i
    }
    below = own
    own = null
    src = down
    out = made
    keys = childKeys
    len = childLength
    i = 0
    depth = depth + 1
  }
}

export function parseScript(source: string): ParsedScript {
  const { meta, body } = extractMeta(source)
  assertScriptBody(body)
  let fn: (...args: unknown[]) => Promise<unknown>
  try {
    fn = new AsyncFunction(
      'agent',
      'parallel',
      'pipeline',
      'phase',
      'log',
      'workflow',
      'args',
      'budget',
      'Date',
      'Math',
      body,
    )
  } catch (e) {
    throw new ScriptError(`Script syntax error: ${(e as Error).message}`)
  }
  const sandboxedDate = sandboxDate()
  const sandboxedMath = sandboxMath()
  return {
    meta,
    async execute(hooks, args, budget) {
      const wrappedAgent: WorkflowHooks['agent'] = (prompt, opts) =>
        hooks.agent(
          prompt,
          opts === undefined
            ? undefined
            : (primitivizeDeep(opts, { isLeaving: true }) as Record<
                string,
                unknown
              >),
        )
      const wrappedWorkflow: WorkflowHooks['workflow'] = (ref, wfArgs) =>
        hooks.workflow(
          ref,
          wfArgs === undefined
            ? undefined
            : primitivizeDeep(wfArgs, { isLeaving: true }),
        )
      const result = await fn(
        wrappedAgent,
        hooks.parallel,
        hooks.pipeline,
        hooks.phase,
        hooks.log,
        wrappedWorkflow,
        args,
        budget,
        sandboxedDate,
        sandboxedMath,
      )
      return primitivizeDeep(result, { isLeaving: true })
    },
  }
}
