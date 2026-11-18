import { getPlatform } from '../platform.js'
import { parseForSecurity } from './ast.js'

/**
 * Official 325 `pTo`: git options that consume a separate following argument.
 */
const GIT_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--attr-source',
  '--shallow-file',
  '--git-dir',
  '--separate-git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
])

const ENV_PREFIX_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/
const GIT_BIN_RE = /(?:^|[/\\])git(?:\.exe)?$/
const PCRE_OR_TEXTCONV_FLAG_RE = /^(?:--p|--op|--textc|-[A-Za-z0-9]*[OPf])/

/**
 * Official 325 `d4n` / `Vas` (#1448): shell function wrapper that runs `git grep`
 * with `LC_ALL=C` via `/usr/bin/env` on macOS to avoid macOS regex memory leaks
 * on non-UTF-8 files, while passing all other `git` subcommands to `command git`.
 */
const GIT_GREP_WRAPPER_BODY = [
  "function git { 'local' _cc_skip= _cc_word;",
  'for _cc_word in ${1+"$@"}; do',
  'if [ -n "$_cc_skip" ]; then _cc_skip=; continue; fi;',
  'case "$_cc_word" in',
  `${[...GIT_OPTIONS_WITH_VALUE].join('|')}) _cc_skip=1 ;;`,
  '-*) ;;',
  `grep) '/usr/bin/env' LC_ALL=C 'git' \${1+"$@"}; 'return' ;;`,
  '*) break ;;',
  'esac; done;',
  `'command' 'git' \${1+"$@"}; }`,
].join(' ')

function singleQuoteShell(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`
}

export const GIT_GREP_CLOCALE_GUARD = [
  "if ! 'typeset' -f 'git' >/dev/null 2>&1 && ! 'alias' 'git' >/dev/null 2>&1 &&",
  `( 'eval' ${singleQuoteShell(GIT_GREP_WRAPPER_BODY)} ) >/dev/null 2>&1;`,
  `then 'eval' ${singleQuoteShell(GIT_GREP_WRAPPER_BODY)}; fi`,
].join(' ')

/**
 * Official 325 `JOs(argv, true, (tok) => tok === 'git')` (simplified):
 * finds the index of the command token matching `predicate` after stripping
 * leading env assignments and shell prefixes (`noglob`, `nocorrect`, `command`, `builtin`).
 */
function findCommandTokenIndex(
  argv: readonly string[],
  predicate: (token: string) => boolean,
): number | undefined {
  let i = 0
  while (i < argv.length && ENV_PREFIX_ASSIGN_RE.test(argv[i]!)) i++
  while (i < argv.length) {
    const tok = argv[i]!
    if (tok === 'noglob' || tok === 'nocorrect') {
      i++
      continue
    }
    if (tok === 'builtin') {
      i++
      if (argv[i] !== undefined && GIT_BIN_RE.test(argv[i]!)) return -1
      continue
    }
    if (tok === 'command') {
      i++
      if (argv[i] === '-p') i++
      if (argv[i] === '--') i++
      continue
    }
    return predicate(tok) ? i : undefined
  }
  return undefined
}

/**
 * Official 325 `c4n(e)` (#1448): on macOS, if `command` is a simple `git grep`
 * invocation without PCRE/textconv flags or non-ASCII / >1000-char / env-var
 * complexity, returns `{ <wrapper>; }` to run `git grep` under `LC_ALL=C`.
 */
export async function buildMacOsGitGrepCLocaleWrapper(
  command: string,
  platform: string = getPlatform(),
): Promise<string | null> {
  if (
    platform !== 'macos' ||
    !command.includes('git') ||
    !command.includes('grep') ||
    command.length > 1000 ||
    /[\u0080-\uFFFF]/.test(command)
  ) {
    return null
  }
  const parsed = await parseForSecurity(command).catch(() => undefined)
  if (
    parsed?.kind !== 'simple' ||
    parsed.bareAssignmentNames.length > 0 ||
    parsed.commands.some(c => c.envVars.length > 0)
  ) {
    return null
  }
  const grepArgsList = parsed.commands.flatMap(({ argv }) => {
    const gitIdx = findCommandTokenIndex(argv, tok => tok === 'git')
    if (gitIdx === undefined || gitIdx === -1) return []
    let y = gitIdx + 1
    while (argv[y]?.startsWith('-') === true) {
      y += GIT_OPTIONS_WITH_VALUE.has(argv[y]!) ? 2 : 1
    }
    return argv[y] === 'grep' ? [argv.slice(y + 1)] : []
  })
  if (
    grepArgsList.length === 0 ||
    grepArgsList.flat().some(arg => PCRE_OR_TEXTCONV_FLAG_RE.test(arg))
  ) {
    return null
  }
  return `{ ${GIT_GREP_CLOCALE_GUARD}; }`
}
