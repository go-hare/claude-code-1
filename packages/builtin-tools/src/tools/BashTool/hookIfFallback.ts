import { MAX_COMMAND_LENGTH, type Node } from 'src/utils/bash/parser.js'
import {
  matchWildcardPattern,
  permissionRuleExtractPrefix,
} from './bashPermissions.js'

/**
 * densable 2.1.243 `C5s` — too-complex node types that may use P7r
 * instead of matching every hook `if`.
 */
export const HOOK_IF_FALLBACK_NODE_TYPES = new Set([
  'command_substitution',
  'simple_expansion',
  'string',
])

const LIST_OPERATORS = new Set(['&&', '||', '|', ';', '&', '|&', '.'])

/** densable `j3s` — walker skips (no recurse). */
const SKIP_TYPES = new Set([
  ...LIST_OPERATORS,
  'comment',
  'string_content',
  'simple_expansion',
  'variable_name',
  'special_variable_name',
])

/** densable `H3s` — ignored when checking single-command shape. */
const SHAPE_IGNORE_TYPES = new Set([
  ...LIST_OPERATORS,
  'comment',
  '$(',
  '`',
  '<(',
  '>(',
  ')',
])

/** densable `W3s` — allowed children inside `"..."`. */
const STRING_CHILD_TYPES = new Set([
  '"',
  'string_content',
  'command_substitution',
])

/** densable `G3s` — allowed non-word args on a single command. */
const SUBST_ARG_TYPES = new Set([
  'simple_expansion',
  'expansion',
  'command_substitution',
  'process_substitution',
])

/** densable `V3s` — allowed literal args on a single command. */
const LITERAL_ARG_TYPES = new Set(['word', 'string', 'concatenation', 'number'])

const COMMAND_NAME_RE = /^[\w./+-]+$/
const SUBST_OR_REDIRECT_RE = /\$[({]|`|[<>]\(/

/**
 * densable `k7r` extras (plus imported wrapper tables in official).
 * Wrapper argv[0] → abort fallback (fail-open), same as official `q3s`.
 */
const FALLBACK_WRAPPER_NAMES = new Set([
  'find',
  'jobs',
  'setpriv',
  'setarch',
  'linux32',
  'linux64',
  'arch',
  'xargs',
  'parallel',
  'su',
  'runuser',
  'pkexec',
  'chroot',
  'time',
  'command',
  'builtin',
  'noglob',
  'env',
  'nice',
  'nohup',
  'sudo',
  'doas',
  'stdbuf',
  'timeout',
  'bash',
  'sh',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'ash',
  'mksh',
  'csh',
  'tcsh',
  'busybox',
  'python',
  'python2',
  'python3',
  'perl',
  'ruby',
  'node',
  'nodejs',
  'deno',
  'bun',
  'php',
  'lua',
  'awk',
  'gawk',
  'valgrind',
  'unbuffer',
  'rlwrap',
  'fakeroot',
  'fakechroot',
  'proot',
  'firejail',
  'caffeinate',
  'taskpolicy',
  'systemd-run',
  'expect',
  'socat',
  'screen',
  'tmux',
  'mawk',
  'nawk',
  'cmd',
  'powershell',
  'pwsh',
  'wsl',
])

/** densable `q3s`. */
export function isHookIfFallbackWrapperName(name: string): boolean {
  const base = name.slice(name.lastIndexOf('/') + 1).toLowerCase()
  if (FALLBACK_WRAPPER_NAMES.has(base)) return true
  const stripped = base
    .replace(/\.(exe|bat|cmd|com)$/, '')
    .replace(/(?<=[a-z])[\d.]+$/, '')
  return FALLBACK_WRAPPER_NAMES.has(stripped)
}

/** densable fallback pattern gate: prefix without space, or `cmd` / `cmd *`. */
export function isTrustedHookIfFallbackPattern(
  pattern: string,
  prefix: string | null,
): boolean {
  if (prefix !== null) return !/\s/.test(prefix)
  return /^[^\s*?[]+\s?\*$/.test(pattern)
}

/**
 * densable `v7r` — program / substitution children are exactly one `command`
 * whose args are words or substitutions.
 */
function isSingleCommandShape(children: Node[]): boolean {
  const kept = children.filter(c => !SHAPE_IGNORE_TYPES.has(c.type))
  if (kept.length !== 1 || kept[0]!.type !== 'command') return false
  const [name, ...rest] = kept[0]!.children
  if (name?.type !== 'command_name') return false
  for (const child of rest) {
    if (
      !LITERAL_ARG_TYPES.has(child.type) &&
      !SUBST_ARG_TYPES.has(child.type)
    ) {
      return false
    }
  }
  return true
}

/** densable `iGt`. */
function flattenNodeText(node: Node): string {
  if (node.type === 'string') {
    return node.children
      .filter(c => c.type !== '"')
      .map(flattenNodeText)
      .join('')
  }
  if (node.type === 'concatenation') {
    return node.children.map(flattenNodeText).join('')
  }
  return node.text
}

/**
 * densable `P7r` — extract command strings for hook `if` when parseForSecurity
 * is too-complex only because of `$()` / backticks / simple `$var` / `"..."`.
 */
export function extractHookIfFallbackCommands(
  command: string,
  root: Node,
): string[] | null {
  if (!command) return []
  if (command.length > MAX_COMMAND_LENGTH) return null
  if (!isSingleCommandShape(root.children)) return null

  const commands: string[] = []
  let aborted = false

  const walk = (node: Node): void => {
    if (aborted) return
    if (node.type === 'ERROR') {
      aborted = true
      return
    }
    if (
      node.type === 'command_substitution' ||
      node.type === 'process_substitution'
    ) {
      if (!isSingleCommandShape(node.children)) {
        aborted = true
        return
      }
    }
    if (
      node.type === 'string' &&
      node.children.some(c => !STRING_CHILD_TYPES.has(c.type))
    ) {
      aborted = true
      return
    }
    if (
      node.type === 'concatenation' &&
      node.children.some(c => c.type === 'simple_expansion' || c.type === '$')
    ) {
      aborted = true
      return
    }
    if (node.type === 'expansion' || node.type === 'arithmetic_expansion') {
      aborted = true
      return
    }
    if (node.type === 'raw_string' || node.type === 'ansi_c_string') {
      aborted = true
      return
    }
    if (
      node.type === 'regex' ||
      node.type === 'extglob_pattern' ||
      node.type === 'word'
    ) {
      if (
        SUBST_OR_REDIRECT_RE.test(node.text) ||
        (node.type === 'word' && node.text.includes('\\'))
      ) {
        aborted = true
      }
      return
    }
    if (SKIP_TYPES.has(node.type)) return
    if (node.type === 'command') {
      const nameNode = node.children.find(c => c.type === 'command_name')
        ?.children[0]
      if (
        nameNode &&
        (nameNode.type !== 'word' ||
          !COMMAND_NAME_RE.test(nameNode.text) ||
          isHookIfFallbackWrapperName(nameNode.text))
      ) {
        aborted = true
        return
      }
      commands.push(node.children.map(flattenNodeText).join(' '))
    }
    for (const child of node.children) walk(child)
  }

  walk(root)
  return aborted ? null : commands
}

/** densable Bash `preparePermissionMatcher` match closure. */
export function matchBashHookIfPattern(
  pattern: string,
  commands: string[],
  fallbackMode: boolean,
): boolean {
  const prefix = permissionRuleExtractPrefix(pattern)
  if (fallbackMode && !isTrustedHookIfFallbackPattern(pattern, prefix)) {
    return true
  }
  return commands.some(cmd => {
    if (prefix !== null) {
      return (
        cmd === prefix ||
        cmd.startsWith(`${prefix} `) ||
        cmd === `xargs ${prefix}` ||
        cmd.startsWith(`xargs ${prefix} `)
      )
    }
    return (
      matchWildcardPattern(pattern, cmd) ||
      matchWildcardPattern(`xargs ${pattern}`, cmd)
    )
  })
}
