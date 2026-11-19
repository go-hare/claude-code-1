import { execFile } from 'child_process'
import { execa } from 'execa'
import { mkdir, stat } from 'fs/promises'
import * as os from 'os'
import { join } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { logEvent } from 'src/services/analytics/index.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import {
  embeddedSearchToolsBinaryPath,
  hasEmbeddedSearchTools,
} from '../embeddedTools.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../envUtils.js'
import { pathExists } from '../file.js'
import { getFsImplementation } from '../fsOperations.js'
import { logError } from '../log.js'
import { getPlatform } from '../platform.js'
import { ripgrepCommand } from '../ripgrep.js'
import { subprocessEnv } from '../subprocessEnv.js'
import { windowsPathToPosixPath } from '../windowsPaths.js'
import { quote } from './shellQuote.js'

const SNAPSHOT_CREATION_TIMEOUT = 10000 // 10 seconds

/** SEA `lHe` (@292220140) */
export const SHELL_EXPORTS_DELIMITER = '--- claude-code-shell-exports ---'

const SKIP_SHELL_EXPORTS = new Set([
  'PWD',
  'OLDPWD',
  'SHLVL',
  '_',
  'GIT_EDITOR',
  'CLAUDECODE',
  'AWKPATH',
  'AWKLIBPATH',
])

const FORBIDDEN_EXPORT_NAMES = new Set([
  'IFS',
  'PS4',
  'PROMPT4',
  'BASH_ENV',
  'ENV',
  'CDPATH',
  'GLOBIGNORE',
  'BASH_XTRACEFD',
])

function isForbiddenShellExportKey(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    FORBIDDEN_EXPORT_NAMES.has(name) ||
    lower.startsWith('ld_') ||
    lower.startsWith('dyld_') ||
    lower.startsWith('bash_func_')
  )
}

/** SEA `uls` (@292220264) */
export const SHELL_EXPORTS_PROBE_SCRIPT = `
      printf '\\n%s\\n' '${SHELL_EXPORTS_DELIMITER}'
      command awk 'BEGIN {
        for (name in ENVIRON) {
          value = ENVIRON[name]; size += length(name) + length(value)
          gsub(/%/, "%25", value); gsub(/\\n/, "%0A", value); gsub(/\\r/, "%0D", value)
          report = report name "=" value "\\n"
        }
        if (size <= 262144) printf "%s", report
      }'
      printf '%s\\n' '${SHELL_EXPORTS_DELIMITER}'
`

/** SEA `cls` (@292220593) */
export function parseShellExports(stdout: string): Map<string, string> {
  const result = new Map<string, string>()
  const baseEnv = subprocessEnv()
  const lines = stdout.split('\n')
  const markers: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === SHELL_EXPORTS_DELIMITER) markers.push(i)
  }
  const [start, end, ...extra] = markers
  if (start === undefined || end === undefined || extra.length > 0) {
    return result
  }
  for (const line of lines.slice(start + 1, end)) {
    const eqIdx = line.indexOf('=')
    const name = line.slice(0, Math.max(eqIdx, 0))
    if (
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
      baseEnv[name] === undefined &&
      !SKIP_SHELL_EXPORTS.has(name) &&
      !isForbiddenShellExportKey(name) &&
      !line.includes('\uFFFD')
    ) {
      result.set(
        name,
        line
          .slice(name.length + 1)
          .replace(/%(25|0A|0D)/g, (_, hex: string) =>
            hex === '25' ? '%' : hex === '0A' ? '\n' : '\r',
          ),
      )
    }
  }
  return result
}

let capturedShellExports: Record<string, string> | undefined

export function getCapturedShellExports(): Record<string, string> | undefined {
  return capturedShellExports
}

export function clearCapturedShellExportsForTesting(): void {
  capturedShellExports = undefined
}

function isDesktopNonWindowsClient(): boolean {
  if (getPlatform() === 'windows') return false
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  return entrypoint === 'claude-desktop' || entrypoint === 'claude-desktop-3p'
}

/**
 * Creates a shell function that invokes `binaryPath` with a specific argv[0].
 * This uses the bun-internal ARGV0 dispatch trick: the bun binary checks its
 * argv[0] and runs the embedded tool (rg, bfs, ugrep) that matches.
 *
 * @param prependArgs - Arguments to inject before the user's args (e.g.,
 *   default flags). Injected literally; each element must be a valid shell
 *   word (no spaces/special chars).
 */
function createArgv0ShellFunction(
  funcName: string,
  argv0: string,
  binaryPath: string,
  prependArgs: string[] = [],
  fallbackArgs: string[] = [],
): string {
  const quotedPath = quote([binaryPath])
  const argSuffix =
    prependArgs.length > 0 ? `${prependArgs.join(' ')} \${1+"$@"}` : '${1+"$@"}'
  const fallbackBlock =
    fallbackArgs.length > 0
      ? [
          '  local _cc_a',
          '  for _cc_a in ${1+"$@"}; do',
          `    case "$_cc_a" in ${fallbackArgs.join('|')}) command ${funcName} \${1+"$@"}; return ;; esac`,
          '  done',
        ]
      : []
  return [
    `function ${funcName} {`,
    ...fallbackBlock,
    '  if [[ -n $ZSH_VERSION ]]; then',
    `    ARGV0=${argv0} ${quotedPath} ${argSuffix}`,
    '  elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then',
    // On Windows (git bash), exec -a does not work, so use ARGV0 env var instead
    // The bun binary reads from ARGV0 natively to set argv[0]
    `    ARGV0=${argv0} ${quotedPath} ${argSuffix}`,
    '  elif [[ $BASHPID != $$ ]]; then',
    `    exec -a ${argv0} ${quotedPath} ${argSuffix}`,
    '  else',
    `    (exec -a ${argv0} ${quotedPath} ${argSuffix})`,
    '  fi',
    '}',
  ].join('\n')
}

/**
 * Creates ripgrep shell integration (alias or function)
 * @returns Object with type and the shell snippet to use
 */
export function createRipgrepShellIntegration(): {
  type: 'alias' | 'function'
  snippet: string
} {
  const rgCommand = ripgrepCommand()

  // For embedded ripgrep (bun-internal), we need a shell function that sets argv0
  if (rgCommand.argv0) {
    return {
      type: 'function',
      snippet: createArgv0ShellFunction(
        'rg',
        rgCommand.argv0,
        rgCommand.rgPath,
      ),
    }
  }

  // For regular ripgrep, use a simple alias target
  const quotedPath = quote([rgCommand.rgPath])
  const quotedArgs = rgCommand.rgArgs.map(arg => quote([arg]))
  const aliasTarget =
    rgCommand.rgArgs.length > 0
      ? `${quotedPath} ${quotedArgs.join(' ')}`
      : quotedPath

  return { type: 'alias', snippet: aliasTarget }
}

/**
 * VCS directories to exclude from grep searches. Matches the list in
 * GrepTool (see GrepTool.ts: VCS_DIRECTORIES_TO_EXCLUDE).
 */
const VCS_DIRECTORIES_TO_EXCLUDE = [
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  '.jj',
  '.sl',
] as const

/**
 * Creates shell integration for `find` and `grep`, backed by bfs and ugrep
 * embedded in the bun binary (ant-native only). Unlike the rg integration,
 * this always shadows the system find/grep since bfs/ugrep are drop-in
 * replacements and we want consistent fast behavior.
 *
 * These wrappers replace the GlobTool/GrepTool dedicated tools (which are
 * removed from the tool registry when embedded search tools are available),
 * so they're tuned to match those tools' semantics, not GNU find/grep.
 *
 * `find` ↔ GlobTool:
 * - Inject `-regextype findutils-default`: bfs defaults to POSIX BRE for
 *   -regex, but GNU find defaults to emacs-flavor (which supports `\|`
 *   alternation). Without this, `find . -regex '.*\.\(js\|ts\)'` silently
 *   returns zero results. A later user-supplied -regextype still overrides.
 * - No gitignore filtering: GlobTool passes `--no-ignore` to rg. bfs has no
 *   gitignore support anyway, so this matches by default.
 * - Hidden files included: both GlobTool (`--hidden`) and bfs's default.
 *
 * Caveat: even with findutils-default, Oniguruma (bfs's regex engine) uses
 * leftmost-first alternation, not POSIX leftmost-longest. Patterns where
 * one alternative is a prefix of another (e.g., `\(ts\|tsx\)`) may miss
 * matches that GNU find catches. Workaround: put the longer alternative first.
 *
 * `grep` ↔ GrepTool (file filtering) + GNU grep (regex syntax):
 * - `-G` (basic regex / BRE): GNU grep defaults to BRE where `\|` is
 *   alternation. ugrep defaults to ERE where `|` is alternation and `\|` is a
 *   literal pipe. Without -G, `grep "foo\|bar"` silently returns zero results.
 *   User-supplied `-E`, `-F`, or `-P` later in argv overrides this.
 * - `--ignore-files`: respect .gitignore (GrepTool uses rg's default, which
 *   respects gitignore). Override with `grep --no-ignore-files`.
 * - `--hidden`: include hidden files (GrepTool passes `--hidden` to rg).
 *   Override with `grep --no-hidden`.
 * - `--exclude-dir` for VCS dirs: GrepTool passes `--glob '!.git'` etc. to rg.
 * - `-I`: skip binary files. rg's recursion silently skips binary matches
 *   by default (different from direct-file-arg behavior); ugrep doesn't, so
 *   we inject -I to match. Override with `grep -a`.
 *
 * Not replicated from GrepTool:
 * - `--max-columns 500`: ugrep's `--width` hard-truncates output which could
 *   break pipelines; rg's version replaces the line with a placeholder.
 * - Read deny rules / plugin cache exclusions: require toolPermissionContext
 *   which isn't available at shell-snapshot creation time.
 *
 * Returns null if embedded search tools are not available in this build.
 */
/**
 * Official 2.1.326 #52 (`DFs` / `OOt` @298039700):
 * Arguments that trigger fallback to the system `grep` instead of embedded `ugrep`.
 */
export const UGREP_SYSTEM_GREP_FALLBACK_PATTERNS = [
  '-*-filter*',
  '-*-pager*',
  '-*-view*',
  '-*-format-open*',
  '-*-config*',
  '---*',
  '-@*',
  '-*-save-config*',
  '-[Zz]*',
  '-[!-]*[Zz]*',
  '--null',
  '--null-data',
] as const

export function createFindGrepShellIntegration(): string | null {
  if (!hasEmbeddedSearchTools()) {
    return null
  }
  const binaryPath = embeddedSearchToolsBinaryPath()
  return [
    // User shell configs may define aliases like `alias find=gfind` or
    // `alias grep=ggrep` (common on macOS with Homebrew GNU tools). The
    // snapshot sources user aliases before these function definitions, and
    // bash expands aliases before function lookup — so a renaming alias
    // would silently bypass the embedded bfs/ugrep dispatch. Clear them first
    // (same fix the rg integration uses).
    'unalias find 2>/dev/null || true',
    'unalias grep 2>/dev/null || true',
    createArgv0ShellFunction('find', 'bfs', binaryPath, [
      '-S',
      'dfs',
      '-regextype',
      'findutils-default',
    ]),
    // Official 2.1.326 #52: pass `--encoding=UTF-8` so ugrep does not silently
    // skip valid UTF-8 / non-ASCII text files, and fall back to system `grep`
    // for ugrep-incompatible flags.
    createArgv0ShellFunction(
      'grep',
      'ugrep',
      binaryPath,
      [
        '-G',
        '--ignore-files',
        '--hidden',
        '-I',
        '--encoding=UTF-8',
        ...VCS_DIRECTORIES_TO_EXCLUDE.map(d => `--exclude-dir=${d}`),
      ],
      [...UGREP_SYSTEM_GREP_FALLBACK_PATTERNS],
    ),
  ].join('\n')
}

/**
 * Official 325 `Fls` / `R6n` / `$ls` / `Bls` / `T6n` (#1440):
 * clear inherited `which` and `unsetenv` aliases/functions and strip exported
 * `BASH_FUNC_which*` / `BASH_FUNC_unsetenv*` env entries so `which` resolves to
 * the system command or zsh builtin.
 */
export const CLEAR_BUILTIN_CMD_NAMES = ['unsetenv', 'which'] as const

export function buildClearAliasAndFunctionCommand(name: string): string {
  return `{ \\builtin unalias -- '${name}'; \\builtin unset -f -- '${name}'; } >/dev/null 2>&1 || true`
}

export const CLEAR_WHICH_COMMAND = buildClearAliasAndFunctionCommand('which')
export const CLEAR_UNSETENV_COMMAND =
  buildClearAliasAndFunctionCommand('unsetenv')

export const STRIPPED_EXPORTED_FUNC_ENV_KEYS: readonly string[] =
  CLEAR_BUILTIN_CMD_NAMES.flatMap(name => [
    `BASH_FUNC_${name}%%`,
    `BASH_FUNC_${name}()`,
    `__BASH_FUNC<${name}>()`,
  ])

function getConfigFile(shellPath: string): string {
  const fileName = shellPath.includes('zsh')
    ? '.zshrc'
    : shellPath.includes('bash')
      ? '.bashrc'
      : '.profile'

  const configPath = join(os.homedir(), fileName)

  return configPath
}

/**
 * Generates user-specific snapshot content (functions, options, aliases)
 * This content is derived from the user's shell configuration file
 */
function getUserSnapshotContent(configFile: string): string {
  const isZsh = configFile.endsWith('.zshrc')

  let content = ''

  // User functions
  if (isZsh) {
    content += `
      echo "# Functions" >> "$SNAPSHOT_FILE"

      # Force autoload all functions first
      typeset -f > /dev/null 2>&1

      # Now get user function names - filter completion functions (single underscore prefix)
      # but keep double-underscore helpers (e.g. __zsh_like_cd from mise, __pyenv_init)
      typeset +f | grep -vE '^_[^_]' | while read func; do
        typeset -f "$func" >> "$SNAPSHOT_FILE"
      done
    `
  } else {
    // densable 2.1.246 #53 f1o — shopt before functions; %q eval, no base64 subshell
    content += `
      # shopt before functions: a body using extglob/globstar syntax only
      # re-parses with the option on.
      echo "# Shopt" >> "$SNAPSHOT_FILE"
      shopt -p >> "$SNAPSHOT_FILE"

      echo "# Functions" >> "$SNAPSHOT_FILE"

      # Force autoload all functions first
      declare -f > /dev/null 2>&1

      # Now get user function names - filter completion functions (single underscore prefix)
      # but keep double-underscore helpers (e.g. __zsh_like_cd from mise, __pyenv_init)
      # One eval per function so a body that no longer parses (rc=2, not fatal
      # in non-POSIX bash) drops only itself. The %q literal needs no fork
      # at source time, unlike a base64 command substitution.
      declare -F | while read func; do
        func=\${func##* } # the name: the last word of each declare -F line
        # declare reads a name starting with - or + as an option, and eval one starting with -; other names need no "--"
        if [[ "$func" == [-+]* ]]; then
          printf 'eval -- %q > /dev/null 2>&1\\n' "$(declare -f -- "$func")" >> "$SNAPSHOT_FILE"
        else
          [[ "$func" == _[!_]* ]] ||
            printf 'eval %q > /dev/null 2>&1\\n' "$(declare -f "$func")" >> "$SNAPSHOT_FILE"
        fi
      done
    `
  }

  // Shell options
  if (isZsh) {
    content += `
      echo "# Shell Options" >> "$SNAPSHOT_FILE"
      setopt | command awk 'NF == 1 || $2 == "on" { print "setopt " $1 }' | head -n 1000 >> "$SNAPSHOT_FILE"
    `
  } else {
    content += `
      echo "# Shell Options" >> "$SNAPSHOT_FILE"
      set -o | awk '$2 == "on" || $1 == "monitor" {print "set -o " $1}' >> "$SNAPSHOT_FILE"
      echo "shopt -s expand_aliases" >> "$SNAPSHOT_FILE"
    `
  }

  // User aliases
  content += `
      echo "# Aliases" >> "$SNAPSHOT_FILE"
      # Filter out winpty aliases on Windows to avoid "stdin is not a tty" errors
      # Git Bash automatically creates aliases like "alias node='winpty node.exe'" for
      # programs that need Win32 Console in mintty, but winpty fails when there's no TTY
      if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        # sed, not grep -v, whose exit 1 when no alias is left ends this script under errexit and pipefail.
        # Every line gets "alias -- " here: the filter works by line, so it can leave part of a multi-line alias behind.
        alias | sed -e "/='winpty /d" | sed -e '1001,$d' -e 's/^alias //g' -e 's/^/alias -- /' >> "$SNAPSHOT_FILE"
      else
        ${isZsh ? "alias | sed -e '1001,$d' -e 's/^alias //g' -e 's/^/alias -- /'" : "\\alias -p | sed -e '1001,$d' -e 's/^alias -- /alias /' -e 's/^alias /alias -- /'"} >> "$SNAPSHOT_FILE"
      fi
  `

  return content
}

/**
 * Generates Claude Code specific snapshot content
 * This content is always included regardless of user configuration
 */
/**
 * #93 SEA `wkt` (@292212895): append plugin bin/ directories to PATH while
 * dropping any entry that contains the PATH delimiter or is already present.
 */
export function appendPluginBinPathsToPath(
  basePath: string | undefined,
  pluginBinPaths: readonly string[],
  delimiter: string,
): { appended: string[]; path: string } {
  const existing = new Set((basePath ?? '').split(delimiter))
  const appended = pluginBinPaths.filter(p => {
    if (p.includes(delimiter)) {
      logForDebugging(
        `Dropping plugin bin path that holds the PATH delimiter: ${p}`,
      )
      return false
    }
    return !existing.has(p)
  })
  return {
    appended,
    path: [basePath, ...appended].filter(Boolean).join(delimiter),
  }
}

/**
 * Official `lls` (#699): probe Git Bash's login PATH directly via
 * `binShell -lc 'echo "$PATH"'` instead of `execa('echo $PATH', { shell: true })`
 * (which ran under cmd.exe on Windows and returned literal `$PATH` or
 * semicolon-separated Windows paths, causing "command not found").
 */
export async function probeWindowsBashPath(
  binShell: string,
): Promise<string | undefined> {
  const res = await execa(binShell, ['-lc', 'echo "$PATH"'], {
    reject: false,
    timeout: SNAPSHOT_CREATION_TIMEOUT,
    windowsHide: true,
  })
  const rawStdout = (res.stdout ?? '').trim()
  const lastLine = rawStdout.split('\n').at(-1)?.trim() ?? ''
  if (
    res.exitCode === 0 &&
    lastLine.startsWith('/') &&
    !lastLine.includes(';')
  ) {
    return lastLine
  }
  const stderr = res.stderr ?? ''
  logForDebugging(
    `Shell snapshot: ${binShell} -lc 'echo "$PATH"' gave no usable PATH (exit code ${res.exitCode ?? 'none'}, timed out: ${res.timedOut === true}, output empty: ${rawStdout === ''}). The snapshot will take PATH from the shell that creates it.`,
    { level: 'warn' },
  )
  logForDebugging(
    `Shell snapshot: PATH probe stderr (${stderr.length} chars): ${stderr}`,
  )
  logEvent('tengu_shell_snapshot_path_probe_failed', {
    timed_out: res.timedOut === true,
    exit_code: res.exitCode,
    empty_output: rawStdout === '',
  })
  return undefined
}

export async function getClaudeCodeSnapshotContent(
  binShell: string,
  pluginBinPaths: readonly string[] = [],
): Promise<string> {
  // Get the appropriate PATH based on platform
  let pathValue = process.env.PATH
  let fallbackToShellPath = false
  if (getPlatform() === 'windows') {
    const probed = await probeWindowsBashPath(binShell)
    if (probed === undefined) {
      fallbackToShellPath = true
    } else {
      pathValue = probed
    }
  }

  const rgIntegration = createRipgrepShellIntegration()

  let content = ''

  // Check if rg is available, if not create an alias/function to bundled ripgrep
  // We use a subshell to unalias rg before checking, so that user aliases like
  // `alias rg='rg --smart-case'` don't shadow the real binary check. The subshell
  // ensures we don't modify the user's aliases in the parent shell.
  content += `
      # Check for rg availability
      echo "# Check for rg availability" >> "$SNAPSHOT_FILE"
      echo "if ! (unalias rg 2>/dev/null; command -v rg) >/dev/null 2>&1; then" >> "$SNAPSHOT_FILE"
  `

  if (rgIntegration.type === 'function') {
    // For embedded ripgrep, write the function definition using heredoc
    content += `
      cat >> "$SNAPSHOT_FILE" << 'RIPGREP_FUNC_END'
  ${rgIntegration.snippet}
RIPGREP_FUNC_END
    `
  } else {
    // For regular ripgrep, write a simple alias
    const escapedSnippet = rgIntegration.snippet.replace(/'/g, "'\\''")
    content += `
      echo '  alias rg='"'${escapedSnippet}'" >> "$SNAPSHOT_FILE"
    `
  }

  content += `
      echo "fi" >> "$SNAPSHOT_FILE"
  `

  // For ant-native builds, shadow find/grep with bfs/ugrep embedded in the bun
  // binary. Unlike rg (which only activates if system rg is absent), we always
  // shadow find/grep since bfs/ugrep are drop-in replacements and we want
  // consistent fast behavior in Claude's shell.
  const findGrepIntegration = createFindGrepShellIntegration()
  if (findGrepIntegration !== null) {
    content += `
      # Shadow find/grep with embedded bfs/ugrep (ant-native only)
      echo "# Shadow find/grep with embedded bfs/ugrep" >> "$SNAPSHOT_FILE"
      cat >> "$SNAPSHOT_FILE" << 'FIND_GREP_FUNC_END'
${findGrepIntegration}
FIND_GREP_FUNC_END
    `
  }

  // densable K2g + #1865: refuse pkill patterns matching CLI & inject --ignore-ancestors in cloud
  const pkillGuard = createPkillSelfGuardShellIntegration()
  content += `
      echo "# Shadow pkill to refuse patterns matching the CLI process" >> "$SNAPSHOT_FILE"
      cat >> "$SNAPSHOT_FILE" << 'PKILL_FUNC_END'
${pkillGuard}
PKILL_FUNC_END
    `

  // Official 2.1.321 #1865 (`rls`): in cloud sessions (CLAUDE_CODE_REMOTE),
  // wrap pgrep and pidwait with --ignore-ancestors when supported.
  const pgrepPidwaitGuard = createPgrepPidwaitIgnoreAncestorsShellIntegration()
  if (pgrepPidwaitGuard !== null) {
    content += `
      echo "# Shadow pgrep/pidwait with --ignore-ancestors in cloud sessions" >> "$SNAPSHOT_FILE"
      cat >> "$SNAPSHOT_FILE" << 'PGREP_PIDWAIT_FUNC_END'
${pgrepPidwaitGuard}
PGREP_PIDWAIT_FUNC_END
    `
  }

  const effectivePluginBinPaths =
    getPlatform() === 'windows'
      ? pluginBinPaths.map(windowsPathToPosixPath)
      : pluginBinPaths
  const { appended, path: finalPathValue } = appendPluginBinPathsToPath(
    fallbackToShellPath ? undefined : pathValue,
    effectivePluginBinPaths,
    ':',
  )

  // Add PATH to the file
  if (fallbackToShellPath) {
    const appendLoop =
      appended.length > 0
        ? `
      for __cc_dir in ${quote(appended)}; do
        case ":$__cc_path:" in *":$__cc_dir:"*) ;; *) __cc_path=\${__cc_path:+$__cc_path:}$__cc_dir ;; esac
      done`
        : ''
    content += `

      # Add PATH to the file, as this shell has it, plus missing plugin dirs
      __cc_path=$PATH${appendLoop}
      builtin printf 'export PATH=%q\\n' "$__cc_path" >> "$SNAPSHOT_FILE"
      unset __cc_path __cc_dir
  `
  } else {
    content += `

      # Add PATH to the file
      echo "export PATH=${quote([finalPathValue || ''])}" >> "$SNAPSHOT_FILE"
  `
  }

  return content
}

/**
 * Official 2.1.321 #1865 (`m4n` / `h4n` / `rls`):
 * In cloud sessions (`CLAUDE_CODE_REMOTE`), inject `--ignore-ancestors` into
 * `pkill`, `pgrep`, and `pidwait` wrappers (when supported by `--help`) so
 * they never match the session's own parent processes.
 */
function isIgnoreAncestorsEnabled(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_dreamy_sunbeam', true) !== false
  )
}

function buildIgnoreAncestorsLines(cmd: string, indent: string): string[] {
  return [
    `${indent}case "$(command ${cmd} --help 2>&1)" in`,
    `${indent}  *--ignore-ancestors*) set -- --ignore-ancestors \${1+"$@"} ;;`,
    `${indent}esac`,
  ]
}

export function createPgrepPidwaitIgnoreAncestorsShellIntegration():
  | string
  | null {
  if (!isIgnoreAncestorsEnabled()) return null
  return ['pgrep', 'pidwait']
    .flatMap(cmd => [
      `unalias ${cmd} 2>/dev/null || true`,
      `if command -v ${cmd} >/dev/null 2>&1; then`,
      `  function ${cmd} {`,
      ...buildIgnoreAncestorsLines(cmd, '    '),
      `    command ${cmd} \${1+"$@"}`,
      '  }',
      'fi',
    ])
    .join('\n')
}

/**
 * densable `K2g` + #1865 — shadow `pkill` so patterns matching the Claude CLI
 * process (CLAUDE_PID) are refused, and in cloud sessions inject
 * `--ignore-ancestors` when supported.
 */
export function createPkillSelfGuardShellIntegration(): string {
  return [
    'unalias pkill 2>/dev/null || true',
    'function pkill {',
    '  if [ -n "${CLAUDE_PID:-}" ] && [ -r "/proc/${CLAUDE_PID}/comm" ]; then',
    '    local _cc_skip="" _cc_a',
    '    local -a _cc_probe=()',
    '    for _cc_a in ${1+"$@"}; do',
    '      if [ -n "$_cc_skip" ]; then _cc_skip=""; continue; fi',
    '      case "$_cc_a" in',
    '        --signal) _cc_skip=1 ;;',
    '        --signal=*|-e|--echo) ;;',
    '        -[0-9]*) ;;',
    '        -[PUGOF]?*) _cc_probe+=("$_cc_a") ;;',
    '        -[ABCDEFGHIJKLMNOPQRSTUVWXYZ][ABCDEFGHIJKLMNOPQRSTUVWXYZ0-9]*) ;;',
    '        *) _cc_probe+=("$_cc_a") ;;',
    '      esac',
    '    done',
    '    if command pgrep ${_cc_probe[@]+"${_cc_probe[@]}"} 2>/dev/null | command grep -qx "${CLAUDE_PID}"; then',
    '      printf \'pkill: refusing to run — this pattern matches the Claude CLI process (PID %s). Narrow the pattern, or target your own children with `pkill -P $$ ...`.\\n\' "${CLAUDE_PID}" >&2',
    '      return 1',
    '    fi',
    ...(isIgnoreAncestorsEnabled()
      ? buildIgnoreAncestorsLines('pkill', '    ')
      : []),
    '  fi',
    '  command pkill ${1+"$@"}',
    '}',
  ].join('\n')
}

/**
 * Creates the appropriate shell script for capturing environment
 */
export async function getSnapshotScript(
  shellPath: string,
  snapshotFilePath: string,
  configFileExists: boolean,
  pluginBinPaths: readonly string[] = [],
  captureShellExports = false,
): Promise<string> {
  const configFile = getConfigFile(shellPath)
  const isZsh = configFile.endsWith('.zshrc')

  // Generate the user content and Claude Code content
  const userContent = configFileExists
    ? getUserSnapshotContent(configFile)
    : !isZsh
      ? // we need to manually force alias expansion in bash - normally `getUserSnapshotContent` takes care of this
        'echo "shopt -s expand_aliases" >> "$SNAPSHOT_FILE"'
      : ''
  const claudeCodeContent = await getClaudeCodeSnapshotContent(
    shellPath,
    pluginBinPaths,
  )

  const script = `SNAPSHOT_FILE=${quote([snapshotFilePath])}
      ${configFileExists ? `source "${configFile}" < /dev/null` : '# No user config file to source'}
      ${captureShellExports ? SHELL_EXPORTS_PROBE_SCRIPT : ''}

      # First, create/clear the snapshot file
      echo "# Snapshot file" >| "$SNAPSHOT_FILE"

      # When this file is sourced, we first unalias to avoid conflicts
      # This is necessary because aliases get "frozen" inside function definitions at definition time,
      # which can cause unexpected behavior when functions use commands that conflict with aliases
      echo "# Unset all aliases to avoid conflicts with functions" >> "$SNAPSHOT_FILE"
      echo "unalias -a 2>/dev/null || true" >> "$SNAPSHOT_FILE"
      echo ${quote([CLEAR_WHICH_COMMAND])} >> "$SNAPSHOT_FILE"
      echo ${quote([CLEAR_UNSETENV_COMMAND])} >> "$SNAPSHOT_FILE"

      ${userContent}

      ${claudeCodeContent}

      # Exit silently on success, only report errors
      if [ ! -f "$SNAPSHOT_FILE" ]; then
        echo "Error: Snapshot file was not created at $SNAPSHOT_FILE" >&2
        exit 1
      fi
    `

  return script
}

/**
 * Creates and saves the shell environment snapshot by loading the user's shell configuration
 *
 * This function is a critical part of Claude CLI's shell integration strategy. It:
 *
 * 1. Identifies the user's shell config file (.zshrc, .bashrc, etc.)
 * 2. Creates a temporary script that sources this configuration file
 * 3. Captures the resulting shell environment state including:
 *    - Functions defined in the user's shell configuration
 *    - Shell options and settings that affect command behavior
 *    - Aliases that the user has defined
 *
 * The snapshot is saved to a temporary file that can be sourced by subsequent shell
 * commands, ensuring they run with the user's expected environment, aliases, and functions.
 *
 * This approach allows Claude CLI to execute commands as if they were run in the user's
 * interactive shell, while avoiding the overhead of creating a new login shell for each command.
 * It handles both Bash and Zsh shells with their different syntax for functions, options, and aliases.
 *
 * If the snapshot creation fails (e.g., timeout, permissions issues), the CLI will still
 * function but without the user's custom shell environment, potentially missing aliases
 * and functions the user relies on.
 *
 * @returns Promise that resolves to the snapshot file path or undefined if creation failed
 */
export const createAndSaveSnapshot = async (
  binShell: string,
  pluginBinPaths: readonly string[] = [],
): Promise<string | undefined> => {
  const shellType = binShell.includes('zsh')
    ? 'zsh'
    : binShell.includes('bash')
      ? 'bash'
      : 'sh'

  logForDebugging(`Creating shell snapshot for ${shellType} (${binShell})`)

  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: async needed for sequential awaits inside executor
  return new Promise(async resolve => {
    try {
      const configFile = getConfigFile(binShell)
      logForDebugging(`Looking for shell config file: ${configFile}`)
      const configFileExists = await pathExists(configFile)

      if (!configFileExists) {
        logForDebugging(
          `Shell config file not found: ${configFile}, creating snapshot with Claude Code defaults only`,
        )
      }

      // Create unique snapshot path with timestamp and random ID
      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(2, 8)
      const snapshotsDir = join(getClaudeConfigHomeDir(), 'shell-snapshots')
      logForDebugging(`Snapshots directory: ${snapshotsDir}`)
      const shellSnapshotPath = join(
        snapshotsDir,
        `snapshot-${shellType}-${timestamp}-${randomId}.sh`,
      )

      // Ensure snapshots directory exists
      await mkdir(snapshotsDir, { recursive: true })

      const captureShellExports = isDesktopNonWindowsClient()
      const snapshotScript = await getSnapshotScript(
        binShell,
        shellSnapshotPath,
        configFileExists,
        pluginBinPaths,
        captureShellExports,
      )
      logForDebugging(`Creating snapshot at: ${shellSnapshotPath}`)
      logForDebugging(`Execution timeout: ${SNAPSHOT_CREATION_TIMEOUT}ms`)
      execFile(
        binShell,
        ['-c', '-l', snapshotScript],
        {
          env: {
            ...(() => {
              try {
                const { isDontInheritEnvEnabled } =
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
                return isDontInheritEnvEnabled()
                  ? {}
                  : (subprocessEnv() as typeof process.env)
              } catch {
                return (
                  process.env.CLAUDE_CODE_DONT_INHERIT_ENV
                    ? {}
                    : subprocessEnv()
                ) as typeof process.env
              }
            })(),
            SHELL: binShell,
            GIT_EDITOR: 'true',
            // LOCAL (not official densable): same as Shell.ts spawn env.
            GIT_PAGER: 'cat',
            CLAUDECODE: '1',
          },
          timeout: SNAPSHOT_CREATION_TIMEOUT,
          maxBuffer: 1024 * 1024, // 1MB buffer
          encoding: 'utf8',
          // Official 2.1.210 densable: execFile(..., {..., windowsHide:!0})
          windowsHide: true,
        },
        async (error, stdout, stderr) => {
          if (error) {
            const execError = error as Error & {
              killed?: boolean
              signal?: string
              code?: number
            }
            logForDebugging(`Shell snapshot creation failed: ${error.message}`)
            logForDebugging(`Error details:`)
            logForDebugging(`  - Error code: ${execError?.code}`)
            logForDebugging(`  - Error signal: ${execError?.signal}`)
            logForDebugging(`  - Error killed: ${execError?.killed}`)
            logForDebugging(`  - Shell path: ${binShell}`)
            logForDebugging(`  - Config file: ${getConfigFile(binShell)}`)
            logForDebugging(`  - Config file exists: ${configFileExists}`)
            logForDebugging(`  - Working directory: ${getCwd()}`)
            logForDebugging(`  - Claude home: ${getClaudeConfigHomeDir()}`)
            logForDebugging(`Full snapshot script:\n${snapshotScript}`)
            if (stdout) {
              logForDebugging(
                `stdout output (${stdout.length} chars):\n${stdout.split(SHELL_EXPORTS_DELIMITER)[0]}`,
              )
            } else {
              logForDebugging(`No stdout output captured`)
            }
            if (stderr) {
              logForDebugging(
                `stderr output (${stderr.length} chars): ${stderr}`,
              )
            } else {
              logForDebugging(`No stderr output captured`)
            }
            logError(
              new Error(`Failed to create shell snapshot: ${error.message}`),
            )
            // Convert signal name to number if present
            const signalNumber = execError?.signal
              ? os.constants.signals[
                  execError.signal as keyof typeof os.constants.signals
                ]
              : undefined
            logEvent('tengu_shell_snapshot_failed', {
              stderr_length: stderr?.length || 0,
              has_error_code: !!execError?.code,
              error_signal_number: signalNumber,
              error_killed: execError?.killed,
            })
            resolve(undefined)
          } else {
            let snapshotSize: number | undefined
            try {
              snapshotSize = (await stat(shellSnapshotPath)).size
            } catch {
              // Snapshot file not found
            }

            if (snapshotSize !== undefined) {
              logForDebugging(
                `Shell snapshot created successfully (${snapshotSize} bytes)`,
              )

              // Register cleanup to remove snapshot on graceful shutdown
              registerCleanup(async () => {
                try {
                  await getFsImplementation().unlink(shellSnapshotPath)
                  logForDebugging(
                    `Cleaned up session snapshot: ${shellSnapshotPath}`,
                  )
                } catch (error) {
                  logForDebugging(
                    `Error cleaning up session snapshot: ${error}`,
                  )
                }
              })

              if (captureShellExports) {
                capturedShellExports ??= Object.fromEntries(
                  parseShellExports(stdout),
                )
              }

              resolve(shellSnapshotPath)
            } else {
              logForDebugging(
                `Shell snapshot file not found after creation: ${shellSnapshotPath}`,
              )
              logForDebugging(
                `Checking if parent directory still exists: ${snapshotsDir}`,
              )
              try {
                const dirContents =
                  await getFsImplementation().readdir(snapshotsDir)
                logForDebugging(
                  `Directory contains ${dirContents.length} files`,
                )
              } catch {
                logForDebugging(
                  `Parent directory does not exist or is not accessible: ${snapshotsDir}`,
                )
              }
              logEvent('tengu_shell_unknown_error', {})
              resolve(undefined)
            }
          }
        },
      )
    } catch (error) {
      logForDebugging(`Unexpected error during snapshot creation: ${error}`)
      if (error instanceof Error) {
        logForDebugging(`Error stack trace: ${error.stack}`)
      }
      logError(error)
      logEvent('tengu_shell_snapshot_error', {})
      resolve(undefined)
    }
  })
}
