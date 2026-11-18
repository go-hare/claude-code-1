/**
 * Gold 2.1.325 built-in `gh api` stand-in (`ghStandinMain` / `e6i` / `C2e` / `He` / `Pe`).
 *
 * Provides the built-in `gh api <REST endpoint>` argument parser, typed/raw
 * field builder (`-f`, `-F`, nested `a[b]=c` and `a[]=x`), help text, and
 * system-prompt note formatting when no external `gh` CLI is present.
 */

export const GH_STANDIN_TAG = 'builtin-api'
const GITHUB_HOST = 'github.com'

export function buildGhStandinNoteTag(opts: {
  enterprise?: boolean
  anyHost?: boolean
  noJq?: boolean
  runner?: boolean
}): string {
  return [
    GH_STANDIN_TAG,
    opts.enterprise && 'enterprise',
    opts.anyHost && 'any-host',
    opts.noJq && 'no-jq',
    opts.runner && 'runner',
  ]
    .filter(Boolean)
    .join('+')
}

export function formatGhStandinNote(tag: string): string | undefined {
  const [head, ...flags] = tag.split('+')
  if (head !== GH_STANDIN_TAG) return undefined
  const enterprise = flags.includes('enterprise')
  const anyHost = flags.includes('any-host')
  const noJq = flags.includes('no-jq')
  const runner = flags.includes('runner')
  return (
    "`gh` here is Claude Code's built-in GitHub client, not the GitHub CLI (none was found on this machine when the session started). `gh api <REST endpoint>` works against github.com" +
    (enterprise
      ? " and, with `--hostname <host>`, the GitHub Enterprise Server hosts this session's GitHub proxy serves"
      : '') +
    (runner
      ? ", already authenticated through this session's GitHub proxy (run `gh api --help` for its flags)."
      : (anyHost
          ? ", or against the GitHub Enterprise host of this checkout's remote (or `--hostname <host>`), through this session's GitHub proxy, which supplies the credential for the hosts and repositories this session is connected to"
          : (enterprise
              ? ', through that proxy,'
              : " through this session's GitHub proxy,") +
            ' which supplies the credential for the repositories this session can reach') +
        ' (run `gh api --help` for its flags). This holds even if an earlier instruction in this prompt says you have no `gh` CLI or GitHub API access; where the prompt tells you to prefer GitHub MCP tools, keep preferring them. A 403 from the proxy says what this session lacks; retrying does not fix it.') +
    ' Other gh commands are not available: use `gh api` (the error from a common one, such as `gh pr view` or `gh run list`, names its `gh api` form).' +
    (noJq
      ? ' `--jq` is unavailable because jq is not installed: run without it and pipe the output to a JSON tool that is installed.'
      : '') +
    (runner
      ? " Do not install a GitHub CLI to get other gh commands: one installed during the session is not routed through this proxy and has no GitHub credentials unless the runner's operator provides them."
      : '')
  )
}

export type GhApiOptions = {
  endpoint: string
  host: string | undefined
  method: string | undefined
  rawFields: string[]
  typedFields: string[]
  headers: string[]
  inputFile: string | undefined
  jq: string | undefined
  include: boolean
  paginate: boolean
  silent: boolean
}

export type GhStandinParseResult =
  | { kind: 'help' }
  | { kind: 'refuse'; message: string }
  | { kind: 'api'; options: GhApiOptions }

const VALUE_FLAGS: Record<string, string> = {
  '-X': '--method',
  '-f': '--raw-field',
  '-F': '--field',
  '-H': '--header',
  '-q': '--jq',
  '-t': '--template',
  '-p': '--preview',
  '--method': '--method',
  '--raw-field': '--raw-field',
  '--field': '--field',
  '--header': '--header',
  '--jq': '--jq',
  '--input': '--input',
  '--hostname': '--hostname',
  '--template': '--template',
  '--preview': '--preview',
  '--cache': '--cache',
}

const BOOL_FLAGS: Record<string, string> = {
  '-i': '--include',
  '-h': '--help',
  '--include': '--include',
  '--paginate': '--paginate',
  '--silent': '--silent',
  '--help': '--help',
  '--slurp': '--slurp',
  '--verbose': '--verbose',
}

const UNSUPPORTED_FLAGS = new Set([
  '--template',
  '--preview',
  '--slurp',
  '--verbose',
])

export function formatGhStandinHelp(ghesHosts: string[] | 'any' = []): string {
  const anyHost = ghesHosts === 'any'
  const hasGhes = anyHost || ghesHosts.length > 0
  return `Usage: gh api <endpoint> [flags]

This gh is Claude Code's built-in GitHub client (not the GitHub CLI):
it supports \`gh api <REST endpoint>\` only.
${
  anyHost
    ? `It makes GitHub REST API requests to ${GITHUB_HOST}, or to the GitHub Enterprise
host of this checkout's remote (or --hostname <host>), through this session's
GitHub proxy, which supplies the credential for the hosts and repositories this
session is connected to, and has no other gh command.`
    : `It makes GitHub REST API requests to ${[GITHUB_HOST, ...ghesHosts].join(', ')} through this session's GitHub
proxy, already authenticated, and has no other gh command.`
}

Flags:${
    hasGhes
      ? `
      --hostname <host>     GitHub host of the request${anyHost ? '' : ', as GH_HOST'} (default ${GITHUB_HOST})`
      : ''
  }
  -X, --method <method>     HTTP method (default GET, or POST with parameters or --input)
  -f, --raw-field key=value String parameter
  -F, --field key=value     Typed parameter: true, false, null and integers become JSON
                            values, {owner} {repo} {branch} are filled in, @file reads a
                            file, @- reads standard input
  -H, --header 'Name: v'    Request header
      --input <file>        File to send as the request body (- for standard input)
  -i, --include             Include HTTP response status line and headers
  -q, --jq <expression>     Query using jq syntax
      --paginate            Make additional HTTP requests to fetch all pages
      --silent              Do not print the response body`
}

function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase()
}

export function parseGhStandinArgs(
  args: string[],
  ghHost?: string,
  ghesHosts: string[] | 'any' = [],
  version = '2.1.325',
): GhStandinParseResult {
  if (args[0] !== 'api') {
    return {
      kind: 'refuse',
      message:
        `this gh is Claude Code's built-in GitHub client (Claude Code ${version}): \`gh api <REST endpoint>\` works here, already authenticated through this session's GitHub proxy, and there is no other gh command.\n` +
        'Example: gh api repos/{owner}/{repo}/pulls/123',
    }
  }

  const options: GhApiOptions = {
    endpoint: '',
    host: undefined,
    method: undefined,
    rawFields: [],
    typedFields: [],
    headers: [],
    inputFile: undefined,
    jq: undefined,
    include: false,
    paginate: false,
    silent: false,
  }
  const positionals: string[] = []
  let hostInput = ghHost
  let hostFromEnv = true
  const parsedFlags: Array<[string, string]> = []

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      positionals.push(...args.slice(i + 1))
      break
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg)
      continue
    }
    const isLong = arg.startsWith('--')
    const eqIdx = arg.indexOf('=')
    const parts = isLong
      ? [eqIdx === -1 ? arg : arg.slice(0, eqIdx)]
      : Array.from(arg.slice(1), ch => `-${ch}`)
    for (let j = 0; j < parts.length; j++) {
      const flag = parts[j]!
      const boolName = BOOL_FLAGS[flag]
      const valName = VALUE_FLAGS[flag]
      if (boolName !== undefined) {
        if (!isLong || !/=(?:false|0)$/i.test(arg)) {
          parsedFlags.push([boolName, ''])
        }
        continue
      }
      if (valName === undefined) {
        return {
          kind: 'refuse',
          message: `unknown ${isLong ? 'flag' : 'shorthand flag'}: ${flag}\n\n${formatGhStandinHelp(ghesHosts)}`,
        }
      }
      const inline = isLong
        ? arg.includes('=')
          ? arg.slice(flag.length + 1)
          : undefined
        : arg.slice(j + 2).replace(/^=/, '') || undefined
      const value = inline ?? args[++i]
      if (value === undefined) {
        return {
          kind: 'refuse',
          message: `flag needs an argument: ${flag}`,
        }
      }
      parsedFlags.push([valName, value])
      break
    }
  }

  for (const [flag, value] of parsedFlags) {
    if (UNSUPPORTED_FLAGS.has(flag)) {
      return {
        kind: 'refuse',
        message: `${flag} is not supported by this built-in gh.\n\n${formatGhStandinHelp(ghesHosts)}`,
      }
    }
    switch (flag) {
      case '--help':
        return { kind: 'help' }
      case '--method':
        options.method = value
        break
      case '--raw-field':
        options.rawFields.push(value)
        break
      case '--field':
        options.typedFields.push(value)
        break
      case '--header':
        options.headers.push(value)
        break
      case '--jq':
        options.jq = value
        break
      case '--input':
        options.inputFile = value
        break
      case '--hostname':
        hostInput = value
        hostFromEnv = false
        break
      case '--include':
        options.include = true
        break
      case '--paginate':
        options.paginate = true
        break
      case '--silent':
        options.silent = true
        break
    }
  }

  if (hostInput !== undefined) {
    const norm = normalizeHost(hostInput)
    if (norm === GITHUB_HOST || norm === '') {
      if (norm === GITHUB_HOST) options.host = GITHUB_HOST
    } else if (ghesHosts === 'any') {
      if (!hostFromEnv) {
        options.host = norm
      } else if (!positionals[0]?.includes('://')) {
        return {
          kind: 'refuse',
          message: `GH_HOST is set to ${hostInput}; pass --hostname <host> or unset GH_HOST.`,
        }
      }
    } else if (ghesHosts.includes(norm)) {
      options.host = norm
    } else {
      return {
        kind: 'refuse',
        message: `${hostInput} is not served here: this gh reaches ${[GITHUB_HOST, ...ghesHosts].join(' and ')} only, through this session's GitHub proxy.`,
      }
    }
  }

  const [endpoint, ...extra] = positionals
  if (endpoint === undefined || extra.length > 0) {
    return {
      kind: 'refuse',
      message: `accepts 1 arg(s), received ${positionals.length}\n\n${formatGhStandinHelp(ghesHosts)}`,
    }
  }
  if (endpoint === '') {
    return {
      kind: 'refuse',
      message:
        'the endpoint is empty; give a REST path such as repos/{owner}/{repo}/pulls',
    }
  }
  if (options.paginate && options.inputFile !== undefined) {
    return {
      kind: 'refuse',
      message: 'the `--paginate` option is not supported with `--input`',
    }
  }
  if (
    options.paginate &&
    options.method !== undefined &&
    options.method.toUpperCase() !== 'GET'
  ) {
    return {
      kind: 'refuse',
      message: 'the `--paginate` option is not supported for non-GET requests',
    }
  }
  if (options.silent && options.jq !== undefined) {
    return {
      kind: 'refuse',
      message:
        'only one of `--silent` or `--jq` may be used, since `--silent` prints no response body',
    }
  }

  options.endpoint = endpoint
  return { kind: 'api', options }
}

export class GhFieldError extends Error {}

type FieldMap = Map<string, FieldValue>
type FieldValue = string | number | boolean | null | FieldMap | FieldValue[]

function parseFieldSpec(spec: string): {
  keys: string[]
  key: string
  value: string | undefined
} {
  const keys: string[] = []
  let start = 0
  let eqPos = 0
  for (let i = 0; i < spec.length && eqPos === 0; i++) {
    const ch = spec[i]
    if (ch === '[') {
      if (start === 0) keys.push(spec.slice(0, i))
      start = i + 1
    } else if (ch === ']') {
      keys.push(spec.slice(start, i))
    } else if (ch === '=') {
      if (start === 0) keys.push(spec.slice(0, i))
      eqPos = i + 1
    }
  }
  if (keys.length === 0 || keys[0] === '') {
    throw new GhFieldError(`invalid key: "${spec}"`)
  }
  if (eqPos === 0) {
    if (keys.at(-1) !== '') {
      throw new GhFieldError(
        `field "${spec}" requires a value separated by an '=' sign`,
      )
    }
    return { keys, key: spec, value: undefined }
  }
  return { keys, key: spec.slice(0, eqPos - 1), value: spec.slice(eqPos) }
}

function getOrCreateNestedMap(
  target: FieldMap,
  key: string,
  subKey: string | undefined,
): FieldMap {
  const existing = target.get(key)
  const fresh: FieldMap = new Map()
  if (subKey === undefined) {
    if (existing instanceof Map) return existing
    if (existing !== undefined) {
      throw new GhFieldError(`expected map type under "${key}"`)
    }
    target.set(key, fresh)
    return fresh
  }
  if (existing !== undefined && !Array.isArray(existing)) {
    throw new GhFieldError(`expected array type under "${key}"`)
  }
  const last = existing?.at(-1)
  if (last instanceof Map && !last.has(subKey)) return last
  target.set(key, [...(existing ?? []), fresh])
  return fresh
}

function insertField(
  root: FieldMap,
  keys: string[],
  rawKey: string,
  value: FieldValue | undefined,
): void {
  let cursor = root
  let isArray = false
  let currentKey = ''
  for (const part of keys) {
    if (part === '') {
      isArray = true
      continue
    }
    if (currentKey !== '') {
      cursor = getOrCreateNestedMap(
        cursor,
        currentKey,
        isArray ? part : undefined,
      )
      isArray = false
    }
    currentKey = part
  }
  const existing = cursor.get(currentKey)
  if (!isArray) {
    if (existing !== undefined || value === undefined) {
      throw new GhFieldError(
        existing !== undefined
          ? `unexpected override existing field under "${currentKey}"`
          : `field "${rawKey}" requires a value separated by an '=' sign`,
      )
    }
    cursor.set(currentKey, value)
    return
  }
  if (existing !== undefined && !Array.isArray(existing)) {
    throw new GhFieldError(`expected array type under "${currentKey}"`)
  }
  cursor.set(
    currentKey,
    value === undefined ? (existing ?? []) : [...(existing ?? []), value],
  )
}

export async function buildGhApiFields(
  rawFields: string[],
  typedFields: string[],
  resolveTyped: (raw: string) => Promise<FieldValue> = async raw => {
    if (/^[+-]?\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) {
      return Number(raw)
    }
    switch (raw) {
      case 'true':
        return true
      case 'false':
        return false
      case 'null':
        return null
      default:
        return raw
    }
  },
): Promise<FieldMap> {
  const map: FieldMap = new Map()
  for (const spec of rawFields) {
    const { keys, key, value } = parseFieldSpec(spec)
    insertField(map, keys, key, value)
  }
  for (const spec of typedFields) {
    const { keys, key, value } = parseFieldSpec(spec)
    insertField(
      map,
      keys,
      key,
      value === undefined ? undefined : await resolveTyped(value),
    )
  }
  return map
}

function unwrapFieldValue(value: FieldValue): unknown {
  if (value instanceof Map) return fieldsMapToObject(value)
  if (Array.isArray(value)) return value.map(unwrapFieldValue)
  return value
}

export function fieldsMapToObject(map: FieldMap): Record<string, unknown> {
  return Object.fromEntries([...map].map(([k, v]) => [k, unwrapFieldValue(v)]))
}

function appendQueryEntries(
  out: Array<[string, string]>,
  prefix: string,
  value: FieldValue,
): void {
  if (value instanceof Map) {
    for (const [k, v] of value) {
      appendQueryEntries(out, `${prefix}[${k}]`, v)
    }
  } else if (Array.isArray(value)) {
    for (const v of value) {
      appendQueryEntries(out, `${prefix}[]`, v)
    }
  } else {
    out.push([prefix, value === null ? '' : String(value)])
  }
}

export function fieldsMapToQueryPairs(map: FieldMap): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [k, v] of map) {
    appendQueryEntries(out, k, v)
  }
  return out
}
