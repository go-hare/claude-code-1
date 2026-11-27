/**
 * Code Mode `$` shell template rendering, quoting, `.env()` validation, and
 * prefixed `dangerousRemoval` circuit-breaker check (2.1.326 #232 & #293).
 */
import type { Tool, ToolUseContext } from '../../../Tool.js'

// Official 2.1.326 #293 (`shell.prelude.js`): `$` shell helper refusal constants & patterns.
const SHELL_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const PS_TYPOGRAPHIC_QUOTE_RE = /[\u2018-\u201F]/
const BEFORE_WORDS_BASH =
  /(?:^|(?:^|[^\\])[ \t\n;&|(])(?:-[\w.-]*=?)?(?:\\\n)*$/
const BEFORE_WORDS_PS = /(?:^|(?:^|[^`])[ \t\n;&|(])(?:-[\w.-]*=?)?(?:`\r?\n)*$/
const BEFORE_TARGET_BASH =
  /(?:^|[^\\])(?:\\\\)*(?:<<-|[<>]&?[|!]?)(?:[ \t]|\\\n)*(?:-[\w.-]*=?(?:\\\n)*)?$/
const BEFORE_TARGET_PS = /[<>](?:[ \t]|`\r?\n)*(?:-[\w.-]*=?(?:`\r?\n)*)?$/

const ABSENT_ADVICE =
  ".\nFind out why first: an earlier script may have stopped before assigning the variable, or a field or regex group is missing. If the argument is optional, write ${x ?? []} to omit it or ${x ?? ''} for an empty one. Inside a word such as ${x}/build both leave /build, so check x instead."
const UNWRITTEN_RAW =
  'an object with a raw field, but not a one-key {raw: ...} literal written in a script and unchanged since.\nIt may be outside data, such as parsed JSON, where a string was expected, or a literal whose raw field was set again, so check the value first. ${x.raw} passes its text as one quoted argument. The {raw: ...} form is only for shell text that the script wrote itself: build that string first, then wrap it once.'
const NOT_ONE_WORD =
  "an array, in a place that seems to take one word: it continues a word, as after NAME= or a quote mark, or it follows a redirect such as > or <.\nThe other items could run as the command or become its arguments. The value may be outside data, such as parsed JSON, where a string was expected, so check it first. With no quotes of your own around them, ${x} after a space passes one argument per item, ${x.join(' ')} passes one word, and ${x.map(s => 'dir/' + s)} puts a prefix on each item. For a file's text, use write() in place of a here-document."
const NO_TARGET =
  'an empty array, so the redirect before it has no file or takes the next word.\nCheck the value first.'

const SHOWN_EACH_SIDE = 60

export function quoteCodeModeShellArg(
  value: unknown,
  shellKind: 'bash' | 'powershell' = 'bash',
): string {
  const str = String(value)
  if (shellKind === 'powershell') {
    const match = PS_TYPOGRAPHIC_QUOTE_RE.exec(str)
    if (match !== null) {
      const hex = (match[0]!.codePointAt(0) ?? 0)
        .toString(16)
        .toUpperCase()
        .padStart(4, '0')
      throw new Error(
        `$ cannot quote this value for PowerShell: it contains U+${hex}, a typographic quote (U+2018-U+201F) that PowerShell's tokenizer can take for a quote delimiter; remove or replace that character`,
      )
    }
    return `'${str.replaceAll("'", "''")}'`
  }
  return `'${str.replaceAll("'", "'\\''")}'`
}

/**
 * Official 2.1.326 #293: validates `.env()` passed to Code Mode's `$` shell
 * helper and formats the shell export prefix. Throws before anything runs if
 * `.env()` receives a string/array or a key that is not a valid shell var name.
 */
export function buildCodeModeShellEnvPrefix(
  env: unknown,
  shellKind: 'bash' | 'powershell' = 'bash',
): string {
  if (env === undefined || env === null) return ''
  if (typeof env === 'string' || Array.isArray(env)) {
    throw new Error(
      `$ did not run this command: .env() takes an object of variable names and values, and this call gave it ${Array.isArray(env) ? 'an array' : 'a string'}. Pass an object like { NAME: "value" }.`,
    )
  }
  if (typeof env !== 'object') {
    throw new Error(
      `$ did not run this command: .env() takes an object of variable names and values. Pass an object like { NAME: "value" }.`,
    )
  }
  const record = env as Record<string, unknown>
  const names = Object.keys(record)
  for (const name of names) {
    if (!SHELL_ENV_KEY_PATTERN.test(name)) {
      const cp = name.codePointAt(79)
      const end = cp !== undefined && cp > 0xffff ? 79 : 80
      const shown = name.length > 80 ? `${name.slice(0, end)}...` : name
      throw new Error(
        `$ did not run this command: the .env() key ${JSON.stringify(shown)} is not a shell variable name (ASCII letters, digits and underscores, not starting with a digit). $ writes each key into the command unquoted, so a key like this could change the command. Rename the key.`,
      )
    }
  }
  if (names.length === 0) return ''
  if (shellKind === 'powershell') {
    return `${names.map(k => `$env:${k} = ${quoteCodeModeShellArg(record[k], 'powershell')};`).join(' ')} `
  }
  return `export ${names.map(k => `${k}=${quoteCodeModeShellArg(record[k], 'bash')}`).join(' ')}; `
}

/**
 * Official 2.1.326 #293: renders a `` $`...` `` template literal into a shell
 * command string, refusing `undefined`/`null`, unverified `{ raw }` objects,
 * arrays in non-word-boundary or redirect positions, and PowerShell typographic
 * quotes — throwing an Error before anything runs.
 */
export function renderCodeModeShellTemplate(
  strings: readonly string[] & { raw?: readonly string[] },
  values: readonly unknown[],
  options: {
    shellKind?: 'bash' | 'powershell'
    mayLeaveUnquoted?: (value: object) => boolean
  } = {},
): string {
  const shellKind = options.shellKind ?? 'bash'
  const mayLeaveUnquoted = options.mayLeaveUnquoted ?? (() => false)
  const beforeWords =
    shellKind === 'powershell' ? BEFORE_WORDS_PS : BEFORE_WORDS_BASH
  const beforeTarget =
    shellKind === 'powershell' ? BEFORE_TARGET_PS : BEFORE_TARGET_BASH

  const lift = (s: string) =>
    s.replace(/\\\\|\\(\$\{|`)/g, (m, g: string | undefined) =>
      g === undefined ? m : g,
    )
  const rawArr =
    Array.isArray(strings.raw) &&
    strings.raw.length === strings.length &&
    strings.raw.every(x => typeof x === 'string')
      ? strings.raw
      : undefined
  const textAt = (i: number) =>
    rawArr === undefined ? String(strings[i] ?? '') : lift(rawArr[i] ?? '')

  const renderPiece = (
    v: unknown,
    soFar: { shape: string },
  ): string | { why: string; path: string } => {
    if (v === undefined || v === null) {
      return { why: `${String(v)}${ABSENT_ADVICE}`, path: '' }
    }
    if (
      typeof v === 'number' ||
      typeof v === 'bigint' ||
      typeof v === 'boolean'
    ) {
      soFar.shape = '%'
      return String(v)
    }
    if (Array.isArray(v)) {
      const items = v.slice()
      if (items.length !== 1 && beforeTarget.test(soFar.shape)) {
        return {
          why: items.length > 1 ? NOT_ONE_WORD : NO_TARGET,
          path: '',
        }
      }
      if (items.length > 1 && !beforeWords.test(soFar.shape)) {
        return { why: NOT_ONE_WORD, path: '' }
      }
      let words = ''
      for (let i = 0; i < items.length; i++) {
        soFar.shape += i === 0 ? '' : ' '
        const word = renderPiece(items[i], soFar)
        if (typeof word !== 'string') {
          return { why: word.why, path: `[${i}]${word.path}` }
        }
        words += (i === 0 ? '' : ' ') + word
      }
      return words
    }
    if (
      typeof v === 'object' &&
      v !== null &&
      Object.hasOwn(v, 'raw') &&
      typeof (v as { raw?: unknown }).raw === 'string'
    ) {
      const rawText = (v as { raw: string }).raw
      soFar.shape += rawText
      return mayLeaveUnquoted(v) ? rawText : { why: UNWRITTEN_RAW, path: '' }
    }
    if (
      typeof v === 'object' &&
      v !== null &&
      typeof (v as { stdout?: unknown }).stdout === 'string' &&
      'exitCode' in v
    ) {
      soFar.shape = '%'
      return quoteCodeModeShellArg(
        (v as unknown as { stdout: string }).stdout.replace(/\n$/, ''),
        shellKind,
      )
    }
    soFar.shape = '%'
    return quoteCodeModeShellArg(v, shellKind)
  }

  let cmd = textAt(0)
  const soFar = { shape: cmd }
  for (let i = 0; i < values.length; i++) {
    const word = renderPiece(values[i], soFar)
    if (typeof word !== 'string') {
      let before = textAt(0)
      for (let j = 1; j <= i; j++) before += '${}' + textAt(j)
      let after = textAt(i + 1)
      for (let j = i + 2; j <= values.length; j++) after += '${}' + textAt(j)
      const shown =
        (before.length > SHOWN_EACH_SIDE ? '...' : '') +
        before.slice(-SHOWN_EACH_SIDE) +
        '${?}' +
        after.slice(0, SHOWN_EACH_SIDE) +
        (after.length > SHOWN_EACH_SIDE ? '...' : '')
      throw new Error(
        `$ did not run this command: ${word.path === '' ? '' : `item ${word.path} of `}\${} value ${i + 1} of ${values.length} (the \${?} in ${JSON.stringify(shown)}) is ${word.why}`,
      )
    }
    const next = textAt(i + 1)
    cmd += word + next
    soFar.shape += next
  }
  return cmd
}

/**
 * Official 2.1.326 #232: checks whether a prefixed shell command (from `$`'s
 * `.cwd()` / `.env()`) hides a `dangerousRemoval` circuit breaker that would
 * trigger on the unprefixed written command, returning a refusal string if so.
 */
export async function checkPrefixedCodeModeShellCommand(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolUseContext,
): Promise<string | undefined> {
  const command = typeof input.command === 'string' ? input.command : undefined
  if (!command || typeof tool.checkPermissions !== 'function') return undefined
  // Extract written body when prefixed with Bash (`cd ... && `, `export ...; `)
  // or PowerShell (`Set-Location -LiteralPath '...' -ErrorAction Stop; `, `$env:K = '...'; `).
  const isPowerShell = tool.name === 'PowerShell'
  const prefixMatch = isPowerShell
    ? /^(?:Set-Location -LiteralPath '(?:[^']|'')*' -ErrorAction Stop;\s*)?(?:(?:\$env:[A-Za-z_][A-Za-z0-9_]* = '(?:[^']|'')*';\s*)+)?([\s\S]+)$/.exec(
        command,
      )
    : /^(?:cd\s+'(?:[^']|'\\'')*'\s*&&\s*)?(?:export\s+(?:[A-Za-z_][A-Za-z0-9_]*='(?:[^']|'\\'')*'\s*)+;\s*)?([\s\S]+)$/.exec(
        command,
      )
  const written = prefixMatch?.[1]
  const removalRe = isPowerShell
    ? /\b(?:r\W*m|remove-item|del|ri|rd|rmdir|erase)\b/i
    : /\br\W*m/i
  if (!written || written === command || !removalRe.test(written)) {
    return undefined
  }
  try {
    const res = await tool.checkPermissions(
      { ...input, command: written } as never,
      context,
    )
    const reason = (
      res as {
        decisionReason?: { circuitBreaker?: string; reason?: string }
      }
    )?.decisionReason
    if (reason?.circuitBreaker === 'dangerousRemoval' && reason.reason) {
      return `This command was not run. ${reason.reason}.\nIf you mean to remove it, write the full path in the command itself, not a shell variable or a relative path. The command then gets the normal permission check.`
    }
  } catch {
    // Best-effort check; fail open only if checkPermissions itself isn't applicable
  }
  return undefined
}
