/**
 * Utility for substituting $ARGUMENTS placeholders in skill/command prompts.
 *
 * densable 2.1.233 #10 `iCt` — argument values must NOT re-expand as templates.
 * Gold uses yPr=￿ / Pxn=￾ sentinels: `$` inside substituted values is
 * protected, then restored after all placeholder passes.
 *
 * Supports:
 * - $ARGUMENTS - replaced with the full arguments string
 * - $ARGUMENTS[0], $ARGUMENTS[1], etc. - replaced with individual indexed arguments
 * - $0, $1, etc. - shorthand for $ARGUMENTS[0], $ARGUMENTS[1]
 * - Named arguments (e.g., $foo, $bar) - when argument names are defined in frontmatter
 * - `\$ARGUMENTS` / `\$0` — escaped placeholders stay literal `$…`
 *
 * Arguments are parsed using shell-quote for proper shell argument handling.
 */

import { tryParseShellCommand } from './bash/shellQuote.js'

/** densable yPr — temporary stand-in for `$` inside substituted values */
const DOLLAR_SENTINEL = '￿'
/** densable Pxn — wrapper around substituted values (stripped at end) */
const VALUE_WRAPPER = '￾'

/**
 * Parse an arguments string into an array of individual arguments.
 * Uses shell-quote for proper shell argument parsing including quoted strings.
 *
 * Examples:
 * - "foo bar baz" => ["foo", "bar", "baz"]
 * - 'foo "hello world" baz' => ["foo", "hello world", "baz"]
 * - "foo 'hello world' baz" => ["foo", "hello world", "baz"]
 */
export function parseArguments(args: string): string[] {
  if (!args || !args.trim()) {
    return []
  }

  // Return $KEY to preserve variable syntax literally (don't expand variables)
  const result = tryParseShellCommand(args, key => `$${key}`)
  if (!result.success) {
    // Fall back to simple whitespace split if parsing fails
    return args.split(/\s+/).filter(Boolean)
  }

  // Filter to only string tokens (ignore shell operators, etc.)
  return result.tokens.filter(
    (token): token is string => typeof token === 'string',
  )
}

/**
 * Parse argument names from the frontmatter 'arguments' field.
 * Accepts either a space-separated string or an array of strings.
 *
 * Examples:
 * - "foo bar baz" => ["foo", "bar", "baz"]
 * - ["foo", "bar", "baz"] => ["foo", "bar", "baz"]
 */
export function parseArgumentNames(
  argumentNames: string | string[] | undefined,
): string[] {
  if (!argumentNames) {
    return []
  }

  // Filter out empty strings and numeric-only names (which conflict with $0, $1 shorthand)
  const isValidName = (name: string): boolean =>
    typeof name === 'string' && name.trim() !== '' && !/^\d+$/.test(name)

  if (Array.isArray(argumentNames)) {
    return argumentNames.filter(isValidName)
  }
  if (typeof argumentNames === 'string') {
    return argumentNames.split(/\s+/).filter(isValidName)
  }
  return []
}

/**
 * Generate argument hint showing remaining unfilled args.
 * @param argNames - Array of argument names from frontmatter
 * @param typedArgs - Arguments the user has typed so far
 * @returns Hint string like "[arg2] [arg3]" or undefined if all filled
 */
export function generateProgressiveArgumentHint(
  argNames: string[],
  typedArgs: string[],
): string | undefined {
  const remaining = argNames.slice(typedArgs.length)
  if (remaining.length === 0) return undefined
  return remaining.map(name => `[${name}]`).join(' ')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * densable iCt — wrap a substituted value so embedded `$` cannot re-match
 * placeholders in later passes.
 */
function protectValue(
  value: string | undefined,
  transform?: (s: string) => string,
): string {
  let d = (value ?? '')
    .replaceAll(DOLLAR_SENTINEL, '�')
    .replaceAll(VALUE_WRAPPER, '�')
  if (transform) d = transform(d)
  return VALUE_WRAPPER + d.replaceAll('$', DOLLAR_SENTINEL) + VALUE_WRAPPER
}

/**
 * Substitute $ARGUMENTS placeholders in content with actual argument values.
 *
 * densable 2.1.233 #10: values are protected so `$ARGUMENTS` / `$0` inside user
 * args are not expanded a second time as templates.
 *
 * @param content - The content containing placeholders
 * @param args - The raw arguments string (may be undefined/null)
 * @param appendIfNoPlaceholder - If true and no placeholders are found, appends "ARGUMENTS: {args}" to content
 * @param argumentNames - Optional array of named arguments (e.g., ["foo", "bar"]) that map to indexed positions
 * @param valueTransform - Optional densable `o` post-process for values only
 * @returns The content with placeholders substituted
 */
export function substituteArguments(
  content: string,
  args: string | undefined,
  appendIfNoPlaceholder = true,
  argumentNames: string[] = [],
  valueTransform?: (s: string) => string,
): string {
  // undefined/null means no args provided - return content unchanged
  // empty string is a valid input that should replace placeholders with empty
  if (args === undefined || args === null) {
    return content
  }

  // densable: scrub any pre-existing sentinels in the template
  let e = content
    .replaceAll(DOLLAR_SENTINEL, '�')
    .replaceAll(VALUE_WRAPPER, '�')

  const wrap = (u: string | undefined) => protectValue(u, valueTransform)
  const parsedArgs = parseArguments(args)

  // densable: longer named args first
  const named = argumentNames
    .map((name, i) => ({ name, i }))
    .filter(u => Boolean(u.name))
    .sort((a, b) => b.name!.length - a.name!.length)

  // densable: `\$` before placeholder names → sentinel so they stay literal `$`
  const nameAlts = named.map(({ name }) => `${escapeRegExp(name!)}(?![\\[\\w])`)
  const escapeAlt = ['\\d', 'ARGUMENTS', ...nameAlts].join('|')
  // densable: unescaped `\$` before placeholder tokens → protect as literal `$`
  // eslint-disable-next-line custom-rules/no-lookbehind-regex -- densable iCt short strings
  e = e.replace(
    new RegExp(`(?<!\\\\)\\\\\\$(?=${escapeAlt})`, 'g'),
    DOLLAR_SENTINEL,
  )

  let anyHit = false

  for (const { name, i } of named) {
    if (!name) continue
    e = e.replace(
      new RegExp(`\\$${escapeRegExp(name)}(?![\\[\\w])`, 'g'),
      () => {
        anyHit = true
        return wrap(parsedArgs[i])
      },
    )
  }

  // densable: missing index → yPr + match without leading $ (restores to $ARGUMENTS[n])
  e = e.replace(/\$ARGUMENTS\[(\d+)\]/g, (full, indexStr: string) => {
    const index = parseInt(indexStr, 10)
    if (parsedArgs[index] === undefined) {
      return DOLLAR_SENTINEL + full.slice(1)
    }
    anyHit = true
    return wrap(parsedArgs[index])
  })

  e = e.replace(/\$(\d+)(?!\w)/g, (full, indexStr: string) => {
    const index = parseInt(indexStr, 10)
    if (parsedArgs[index] === undefined) {
      return full
    }
    anyHit = true
    return wrap(parsedArgs[index])
  })

  e = e.replaceAll('$ARGUMENTS', () => {
    anyHit = true
    return wrap(args)
  })

  if (!anyHit && appendIfNoPlaceholder && args) {
    e = e + `\n\nARGUMENTS: ${wrap(args)}`
  }

  // densable: restore protected `$`, strip value wrappers
  return e.replaceAll(DOLLAR_SENTINEL, '$').replaceAll(VALUE_WRAPPER, '')
}
