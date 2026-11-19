import { homedir } from 'os'
import { isAbsolute, normalize, posix, resolve } from 'path'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import type { z } from 'zod/v4'
import type { ToolPermissionContext } from 'src/Tool.js'
import type { Redirect, SimpleCommand } from 'src/utils/bash/ast.js'
import {
  extractOutputRedirections,
  splitCommand_DEPRECATED,
} from 'src/utils/bash/commands.js'
import { tryParseShellCommand } from 'src/utils/bash/shellQuote.js'
import { getDirectoryForPath } from 'src/utils/path.js'
import {
  allWorkingDirectories,
  getClaudeSignInFilePaths,
  isClaudeSignInFilePath,
  resolvePathWithExistingAncestorRealpath,
} from 'src/utils/permissions/filesystem.js'
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js'
import { createReadRuleSuggestion } from 'src/utils/permissions/PermissionUpdate.js'
import type { PermissionUpdate } from 'src/utils/permissions/PermissionUpdateSchema.js'
import {
  expandTilde,
  type FileOperationType,
  formatDirectoryList,
  isDangerousRemovalPath,
  validatePath,
} from 'src/utils/permissions/pathValidation.js'
import { getPlatform } from 'src/utils/platform.js'
import { posixPathToWindowsPath } from 'src/utils/windowsPaths.js'
import type { BashTool } from './BashTool.js'
import { stripSafeWrappers } from './bashPermissions.js'
import { sedCommandIsAllowedByAllowlist } from './sedValidation.js'

export type PathCommand =
  | 'cd'
  | 'ls'
  | 'find'
  | 'mkdir'
  | 'touch'
  | 'rm'
  | 'rmdir'
  | 'mv'
  | 'cp'
  | 'cat'
  | 'head'
  | 'tail'
  | 'sort'
  | 'uniq'
  | 'wc'
  | 'cut'
  | 'paste'
  | 'column'
  | 'tr'
  | 'file'
  | 'stat'
  | 'diff'
  | 'awk'
  | 'strings'
  | 'hexdump'
  | 'od'
  | 'base64'
  | 'nl'
  | 'grep'
  | 'rg'
  | 'sed'
  | 'git'
  | 'jq'
  | 'sha256sum'
  | 'sha1sum'
  | 'md5sum'

/**
 * SEA `_yr` (@289975469) — mounted drives, mount root folders, and their
 * immediate top-level children (`/Volumes`, `/Volumes/Foo`, `/mnt/c`,
 * `/mnt/c/Foo`, `/media/user/drive`, etc.).
 */
const MOUNTED_DRIVE_PATH_RE =
  /^\/(?:system\/)?volumes(?:\/[^/]+){0,2}$|^\/mnt\/(?:[^/]+|[a-z]\/[^/]+)$|^\/(?:run\/)?media(?:\/[^/]+){0,3}$/i

/**
 * Checks if an rm/rmdir command targets dangerous paths that should always
 * require explicit user approval, even if allowlist rules exist.
 * This prevents catastrophic data loss from commands like `rm -rf /`.
 */
function checkDangerousRemovalPaths(
  command: 'rm' | 'rmdir',
  args: string[],
  cwd: string,
): PermissionResult {
  // Extract paths using the existing path extractor
  const extractor = PATH_EXTRACTORS[command]
  const paths = extractor(args)
  const doubleDashIdx = args.indexOf('--')
  const flagArgs = doubleDashIdx >= 0 ? args.slice(0, doubleDashIdx) : args
  const hasRecursiveFlag = flagArgs.some(a => /^--r|^-[a-zA-Z]*[rR]/.test(a))

  for (const path of paths) {
    // Expand tilde and resolve to absolute path
    // NOTE: We check the path WITHOUT resolving symlinks, because dangerous paths
    // like /tmp should be caught even though /tmp is a symlink to /private/tmp on macOS
    const cleanPath = expandTilde(path.replace(/^['"]|['"]$/g, ''))
    const normalizedPath =
      getPlatform() === 'windows' &&
      /^\/(?:cygdrive\/)?[A-Za-z]\//.test(cleanPath)
        ? posixPathToWindowsPath(cleanPath)
        : cleanPath
    const absolutePath = isAbsolute(normalizedPath)
      ? normalizedPath
      : resolve(cwd, normalizedPath)

    // Check if this is a dangerous path (using the non-symlink-resolved path)
    // densable Ize: safetyCheck + circuitBreaker:"dangerousRemoval" so auto mode
    // can send this to the classifier (2.1.218 #26) while still blocking
    // acceptEdits / allow-rules auto-approve.
    if (isDangerousRemovalPath(absolutePath)) {
      return {
        behavior: 'ask',
        message: `Dangerous ${command} operation detected: '${absolutePath}'\n\nThis command would remove a critical system directory. This requires explicit approval and cannot be auto-allowed by permission rules.`,
        decisionReason: {
          type: 'safetyCheck',
          reason: `Dangerous ${command} operation on critical path: ${absolutePath}`,
          classifierApprovable: false,
          circuitBreaker: 'dangerousRemoval',
        },
        // Don't provide suggestions - we don't want to encourage saving dangerous commands
        suggestions: [],
      }
    }

    // SEA #967 (@289979782): mounted drive or top-level volume folder
    const isGlobStar = /(?:^|[\\/])\*$/.test(absolutePath)
    if (
      !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_MOUNTED_DRIVE_RM_PROMPT) &&
      command === 'rm' &&
      (hasRecursiveFlag || isGlobStar) &&
      absolutePath.startsWith('/')
    ) {
      const trimmedMountPath = normalize(absolutePath).replace(/(.)\/$/, '$1')
      if (MOUNTED_DRIVE_PATH_RE.test(trimmedMountPath)) {
        return {
          behavior: 'ask',
          message: `Dangerous rm operation detected: '${absolutePath}'\n\nThis command would remove a mounted drive, the folder that holds mounted drives, or a file or folder at the top level of a drive. This requires explicit approval and cannot be auto-allowed by permission rules.\n\nIf you meant something deeper inside, name it by its full path.`,
          decisionReason: {
            type: 'safetyCheck',
            reason: `Dangerous rm operation on mounted drive or top-level path: ${absolutePath}`,
            classifierApprovable: false,
            circuitBreaker: 'dangerousRemoval',
          },
          suggestions: [],
        }
      }
    }
  }

  // No dangerous paths found
  return {
    behavior: 'passthrough',
    message: `No dangerous removals detected for ${command} command`,
  }
}

/**
 * SECURITY: Extract positional (non-flag) arguments, correctly handling the
 * POSIX `--` end-of-options delimiter.
 *
 * Most commands (rm, cat, touch, etc.) stop parsing options at `--` and treat
 * ALL subsequent arguments as positional, even if they start with `-`. Naive
 * `!arg.startsWith('-')` filtering drops these, causing path validation to be
 * silently skipped for attack payloads like:
 *
 *   rm -- -/../.claude/settings.local.json
 *
 * Here `-/../.claude/settings.local.json` starts with `-` so the naive filter
 * drops it, validation sees zero paths, returns passthrough, and the file is
 * deleted without a prompt. With `--` handling, the path IS extracted and
 * validated (blocked by isClaudeConfigFilePath / pathInAllowedWorkingPath).
 */
function filterOutFlags(args: string[]): string[] {
  const result: string[] = []
  let afterDoubleDash = false
  for (const arg of args) {
    if (afterDoubleDash) {
      result.push(arg)
    } else if (arg === '--') {
      afterDoubleDash = true
    } else if (!arg?.startsWith('-')) {
      result.push(arg)
    }
  }
  return result
}

/** SEA `Dtt` (@289998239) — extract attached value from `--flag=VAL` or `-fVAL`. */
function extractAttachedFlagValue(
  arg: string,
  flagNames: string[],
): string | undefined {
  if (!arg.startsWith('-')) return undefined
  const eqIdx = arg.indexOf('=')
  if (eqIdx >= 0) {
    if (flagNames.includes(arg.slice(0, eqIdx))) {
      return arg.slice(eqIdx + 1)
    }
    return undefined
  }
  for (const name of flagNames) {
    if (
      name.length === 2 &&
      name[0] === '-' &&
      arg.startsWith(name) &&
      arg !== name
    ) {
      return arg.slice(2)
    }
  }
  return undefined
}

// Helper: Parse grep/rg style commands (pattern then paths) — SEA `Itt` (@289997344)
function parsePatternCommand(
  args: string[],
  flagsWithArgs: Set<string>,
  defaults: string[] = [],
): string[] {
  const paths: string[] = []
  let patternFound = false
  // SECURITY: Track `--` end-of-options delimiter. After `--`, all args are
  // positional regardless of leading `-`. See filterOutFlags() doc comment.
  let afterDoubleDash = false
  let seenPositional = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined || arg === null) continue

    if (!afterDoubleDash && !seenPositional && arg === '--') {
      afterDoubleDash = true
      continue
    }

    if (
      !afterDoubleDash &&
      !seenPositional &&
      arg !== '-' &&
      arg.startsWith('-')
    ) {
      const eqIdx = arg.indexOf('=')
      const flag = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg
      // Pattern/file flags mark that we've found the pattern; -f/--file also reads a path
      if (['-e', '--regexp', '-f', '--file'].includes(flag)) {
        patternFound = true
        if (flag === '-f' || flag === '--file') {
          const fileArg = eqIdx >= 0 ? arg.slice(eqIdx + 1) : args[i + 1]
          if (fileArg) paths.push(fileArg)
        }
      }
      if (
        /^-[a-zA-Z]*f$/.test(flag) &&
        flag !== '-f' &&
        eqIdx < 0 &&
        args[i + 1] !== undefined
      ) {
        patternFound = true
        paths.push(args[i + 1]!)
        i++
        continue
      }
      if (
        ['--exclude-from', '--include-from', '--ignore-file'].includes(flag)
      ) {
        const fileArg = eqIdx >= 0 ? arg.slice(eqIdx + 1) : args[i + 1]
        if (fileArg) paths.push(fileArg)
        if (eqIdx < 0) i++
        continue
      }
      if (eqIdx < 0) {
        const attachedFile = extractAttachedFlagValue(arg, ['-f', '--file'])
        if (attachedFile !== undefined) {
          patternFound = true
          paths.push(attachedFile)
          continue
        }
        if (arg.length > 2 && arg.startsWith('-e')) {
          patternFound = true
          continue
        }
      }
      // Skip next arg if flag needs it (and didn't use =value)
      if (flagsWithArgs.has(flag) && eqIdx < 0) {
        i++
      }
      continue
    }

    if (seenPositional && !afterDoubleDash) {
      const attachedFile = extractAttachedFlagValue(arg, ['-f', '--file'])
      if (attachedFile !== undefined) {
        paths.push(attachedFile)
      }
    }
    seenPositional = true

    // First non-flag is pattern, rest are paths
    if (!patternFound) {
      patternFound = true
      continue
    }
    paths.push(arg)
  }

  return paths.length > 0 ? paths : defaults
}

/**
 * Extracts paths from command arguments for different path commands.
 * Each command has specific logic for how it handles paths and flags.
 */
export const PATH_EXTRACTORS: Record<
  PathCommand,
  (args: string[]) => string[]
> = {
  // cd: special case - all args form one path
  cd: args => (args.length === 0 ? [homedir()] : [args.join(' ')]),

  // ls: filter flags, default to current dir
  ls: args => {
    const paths = filterOutFlags(args)
    return paths.length > 0 ? paths : ['.']
  },

  // find: collect paths until hitting a real flag, also check path-taking flags
  // SECURITY: `find -- -path` makes `-path` a starting point (not a predicate).
  // GNU find supports `--` to allow search roots starting with `-`. After `--`,
  // we conservatively collect all remaining args as paths to validate. This
  // over-includes predicates like `-name foo`, but find is a read-only op and
  // predicates resolve to paths within cwd (allowed), so no false blocks for
  // legitimate use. The over-inclusion ensures attack paths like
  // `find -- -/../../etc` are caught.
  find: args => {
    const paths: string[] = []
    const pathFlags = new Set([
      '-newer',
      '-anewer',
      '-cnewer',
      '-mnewer',
      '-samefile',
      '-path',
      '-wholename',
      '-ilname',
      '-lname',
      '-ipath',
      '-iwholename',
    ])
    const newerPattern = /^-newer[acmBt][acmtB]$/
    let foundNonGlobalFlag = false
    let afterDoubleDash = false

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (!arg) continue

      if (afterDoubleDash) {
        paths.push(arg)
        continue
      }

      if (arg === '--') {
        afterDoubleDash = true
        continue
      }

      // Handle flags
      if (arg.startsWith('-')) {
        // Global options don't stop collection
        if (['-H', '-L', '-P'].includes(arg)) continue

        // Mark that we've seen a non-global flag
        foundNonGlobalFlag = true

        // Check if this flag takes a path argument
        if (pathFlags.has(arg) || newerPattern.test(arg)) {
          const nextArg = args[i + 1]
          if (nextArg) {
            paths.push(nextArg)
            i++ // Skip the path we just processed
          }
        }
        continue
      }

      // Only collect non-flag arguments before first non-global flag
      if (!foundNonGlobalFlag) {
        paths.push(arg)
      }
    }
    return paths.length > 0 ? paths : ['.']
  },

  // All simple commands: just filter out flags
  mkdir: filterOutFlags,
  touch: filterOutFlags,
  rm: filterOutFlags,
  rmdir: filterOutFlags,
  mv: filterOutFlags,
  cp: filterOutFlags,
  cat: filterOutFlags,
  head: filterOutFlags,
  tail: filterOutFlags,
  sort: filterOutFlags,
  uniq: filterOutFlags,
  wc: filterOutFlags,
  cut: filterOutFlags,
  paste: filterOutFlags,
  column: filterOutFlags,
  file: filterOutFlags,
  stat: filterOutFlags,
  diff: filterOutFlags,
  awk: filterOutFlags,
  strings: filterOutFlags,
  hexdump: filterOutFlags,
  od: filterOutFlags,
  base64: filterOutFlags,
  nl: filterOutFlags,
  sha256sum: filterOutFlags,
  sha1sum: filterOutFlags,
  md5sum: filterOutFlags,

  // tr: special case - skip character sets
  tr: args => {
    const hasDelete = args.some(
      a =>
        a === '-d' ||
        a === '--delete' ||
        (a.startsWith('-') && a.includes('d')),
    )
    const nonFlags = filterOutFlags(args)
    return nonFlags.slice(hasDelete ? 1 : 2) // Skip SET1 or SET1+SET2
  },

  // grep: pattern then paths, defaults to stdin
  grep: args => {
    const flags = new Set([
      '-e',
      '--regexp',
      '-f',
      '--file',
      '--exclude',
      '--include',
      '--exclude-dir',
      '--include-dir',
      '-m',
      '--max-count',
      '-A',
      '--after-context',
      '-B',
      '--before-context',
      '-C',
      '--context',
    ])
    const paths = parsePatternCommand(args, flags)
    // Special: if -r/-R flag present and no paths, use current dir
    if (
      paths.length === 0 &&
      args.some(a => ['-r', '-R', '--recursive'].includes(a))
    ) {
      return ['.']
    }
    return paths
  },

  // rg: pattern then paths, defaults to current dir
  rg: args => {
    const flags = new Set([
      '-e',
      '--regexp',
      '-f',
      '--file',
      '-t',
      '--type',
      '-T',
      '--type-not',
      '-g',
      '--glob',
      '-m',
      '--max-count',
      '--max-depth',
      '-r',
      '--replace',
      '-A',
      '--after-context',
      '-B',
      '--before-context',
      '-C',
      '--context',
    ])
    return parsePatternCommand(args, flags, ['.'])
  },

  // sed: processes files in-place or reads from stdin
  sed: args => {
    const paths: string[] = []
    let skipNext = false
    let scriptFound = false
    // SECURITY: Track `--` end-of-options delimiter. After `--`, all args are
    // positional regardless of leading `-`. See filterOutFlags() doc comment.
    let afterDoubleDash = false

    for (let i = 0; i < args.length; i++) {
      if (skipNext) {
        skipNext = false
        continue
      }

      const arg = args[i]
      if (!arg) continue

      if (!afterDoubleDash && arg === '--') {
        afterDoubleDash = true
        continue
      }

      // Handle flags (only before `--`)
      if (!afterDoubleDash && arg.startsWith('-')) {
        // -f flag: next arg is a script file that needs validation
        if (['-f', '--file'].includes(arg)) {
          const scriptFile = args[i + 1]
          if (scriptFile) {
            paths.push(scriptFile) // Add script file to paths for validation
            skipNext = true
          }
          scriptFound = true
        }
        // -e flag: next arg is expression, not a file
        else if (['-e', '--expression'].includes(arg)) {
          skipNext = true
          scriptFound = true
        }
        // Combined flags like -ie or -nf
        else if (arg.includes('e') || arg.includes('f')) {
          scriptFound = true
        }
        continue
      }

      // First non-flag is the script (if not already found via -e/-f)
      if (!scriptFound) {
        scriptFound = true
        continue
      }

      // Rest are file paths
      paths.push(arg)
    }

    return paths
  },

  // jq: filter then file paths (similar to grep)
  // The jq command structure is: jq [flags] filter [files...]
  // If no files are provided, jq reads from stdin
  jq: args => {
    const paths: string[] = []
    const flagsWithArgs = new Set([
      '-e',
      '--expression',
      '-f',
      '--from-file',
      '--arg',
      '--argjson',
      '--slurpfile',
      '--rawfile',
      '--args',
      '--jsonargs',
      '-L',
      '--library-path',
      '--indent',
      '--tab',
    ])
    let filterFound = false
    // SECURITY: Track `--` end-of-options delimiter. After `--`, all args are
    // positional regardless of leading `-`. See filterOutFlags() doc comment.
    let afterDoubleDash = false

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === undefined || arg === null) continue

      if (!afterDoubleDash && arg === '--') {
        afterDoubleDash = true
        continue
      }

      if (!afterDoubleDash && arg.startsWith('-')) {
        const flag = arg.split('=')[0]
        // Pattern flags mark that we've found the filter
        if (flag && ['-e', '--expression'].includes(flag)) {
          filterFound = true
        }
        // Skip next arg if flag needs it
        if (flag && flagsWithArgs.has(flag) && !arg.includes('=')) {
          i++
        }
        continue
      }

      // First non-flag is filter, rest are file paths
      if (!filterFound) {
        filterFound = true
        continue
      }
      paths.push(arg)
    }

    // If no file paths, jq reads from stdin (no paths to validate)
    return paths
  },

  // git: handle subcommands that access arbitrary files outside the repository
  git: args => {
    // git diff --no-index is special - it explicitly compares files outside git's control
    // This flag allows git diff to compare any two files on the filesystem, not just
    // files within the repository, which is why it needs path validation
    if (args.length >= 1 && args[0] === 'diff') {
      if (args.includes('--no-index')) {
        // SECURITY: git diff --no-index accepts `--` before file paths.
        // Use filterOutFlags which handles `--` correctly instead of naive
        // startsWith('-') filtering, to catch paths like `-/../etc/passwd`.
        const filePaths = filterOutFlags(args.slice(1))
        return filePaths.slice(0, 2) // git diff --no-index expects exactly 2 paths
      }
    }
    // Other git commands (add, rm, mv, show, etc.) operate within the repository context
    // and are already constrained by git's own security model, so they don't need
    // additional path validation
    return []
  },
}

const SUPPORTED_PATH_COMMANDS = Object.keys(PATH_EXTRACTORS) as PathCommand[]

const ACTION_VERBS: Record<PathCommand, string> = {
  cd: 'change directories to',
  ls: 'list files in',
  find: 'search files in',
  mkdir: 'create directories in',
  touch: 'create or modify files in',
  rm: 'remove files from',
  rmdir: 'remove directories from',
  mv: 'move files to/from',
  cp: 'copy files to/from',
  cat: 'concatenate files from',
  head: 'read the beginning of files from',
  tail: 'read the end of files from',
  sort: 'sort contents of files from',
  uniq: 'filter duplicate lines from files in',
  wc: 'count lines/words/bytes in files from',
  cut: 'extract columns from files in',
  paste: 'merge files from',
  column: 'format files from',
  tr: 'transform text from files in',
  file: 'examine file types in',
  stat: 'read file stats from',
  diff: 'compare files from',
  awk: 'process text from files in',
  strings: 'extract strings from files in',
  hexdump: 'display hex dump of files from',
  od: 'display octal dump of files from',
  base64: 'encode/decode files from',
  nl: 'number lines in files from',
  grep: 'search for patterns in files from',
  rg: 'search for patterns in files from',
  sed: 'edit files in',
  git: 'access files with git from',
  jq: 'process JSON from files in',
  sha256sum: 'compute SHA-256 checksums for files in',
  sha1sum: 'compute SHA-1 checksums for files in',
  md5sum: 'compute MD5 checksums for files in',
}

export const COMMAND_OPERATION_TYPE: Record<PathCommand, FileOperationType> = {
  cd: 'read',
  ls: 'read',
  find: 'read',
  mkdir: 'create',
  touch: 'create',
  rm: 'write',
  rmdir: 'write',
  mv: 'write',
  cp: 'write',
  cat: 'read',
  head: 'read',
  tail: 'read',
  sort: 'read',
  uniq: 'read',
  wc: 'read',
  cut: 'read',
  paste: 'read',
  column: 'read',
  tr: 'read',
  file: 'read',
  stat: 'read',
  diff: 'read',
  awk: 'read',
  strings: 'read',
  hexdump: 'read',
  od: 'read',
  base64: 'read',
  nl: 'read',
  grep: 'read',
  rg: 'read',
  sed: 'write',
  git: 'read',
  jq: 'read',
  sha256sum: 'read',
  sha1sum: 'read',
  md5sum: 'read',
}

/**
 * Command-specific validators that run before path validation.
 * Returns true if the command is valid, false if it should be rejected.
 * Used to block commands with flags that could bypass path validation.
 */
const COMMAND_VALIDATOR: Partial<
  Record<PathCommand, (args: string[]) => boolean>
> = {
  mv: (args: string[]) => !args.some(arg => arg?.startsWith('-')),
  cp: (args: string[]) => !args.some(arg => arg?.startsWith('-')),
  // Official 2.1.x: zsh `cd OLD NEW` rewrites $PWD via substitution; only
  // multi-positional forms fail static path validation. Flags (-P/-L) are
  // skipped; bare `-` is a valid previous-directory target.
  cd: (args: string[]) => {
    let counting = false
    let positionalCount = 0
    for (const arg of args) {
      if (!counting) {
        if (arg === '--') {
          counting = true
          continue
        }
        if (arg.startsWith('-') && arg !== '-') {
          continue
        }
        counting = true
      }
      positionalCount++
    }
    return positionalCount <= 1
  },
}

/**
 * Official 2.1.321 #1955 (`IO`): normalize path-qualified `cp`/`mv`/`rm`/`rmdir`/`tee`
 * (e.g. `/bin/cp`, `/usr/bin/mv`, `C:\...\cp.exe`) to their canonical command name.
 */
const BASENAME_NORMALIZED_PATH_COMMANDS = new Set([
  'rm',
  'rmdir',
  'tee',
  'cp',
  'mv',
])

export function normalizePathCommandName(cmd: string): string {
  if (!cmd) return cmd
  const base = cmd.replace(/^.*[\\/]/, '')
  if (BASENAME_NORMALIZED_PATH_COMMANDS.has(base)) return base
  const lower = base.toLowerCase().replace(/\.exe$/, '')
  return BASENAME_NORMALIZED_PATH_COMMANDS.has(lower) ? lower : cmd
}

/**
 * Official 2.1.321 #1850 (`hfn`, `Tfn`, `bfn`, `Efn`):
 * Expand `cp`/`mv` destination-directory targets so deny rules and protected-file
 * prompts apply to `<destDir>/<basename(src)>` (and `-t`/`--target-directory`,
 * `--parents`, and `-b`/`-S` backup targets).
 */
function parseCpMvOptions(args: readonly string[]): Array<{
  name: string
  value?: string
  afterOperand: boolean
}> {
  const opts: Array<{ name: string; value?: string; afterOperand: boolean }> =
    []
  let afterOperand = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--') break
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=')
      const rawName = eqIdx === -1 ? arg.slice(2) : arg.slice(2, eqIdx)
      const val = eqIdx === -1 ? undefined : arg.slice(eqIdx + 1)
      const name =
        rawName.length >= 2 && 'suffix'.startsWith(rawName)
          ? 'S'
          : rawName !== '' && 'target-directory'.startsWith(rawName)
            ? 't'
            : rawName !== '' && 'backup'.startsWith(rawName)
              ? 'b'
              : rawName
      opts.push({
        name,
        value: val ?? (name === 'S' || name === 't' ? args[++i] : undefined),
        afterOperand,
      })
    } else if (arg.startsWith('-') && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        const ch = arg[j] ?? ''
        if (ch === 't' || ch === 'S') {
          const rest = arg.slice(j + 1)
          opts.push({
            name: ch,
            value: rest !== '' ? rest : args[++i],
            afterOperand,
          })
          if (rest.startsWith('=')) {
            opts.push({ name: ch, value: rest.slice(1), afterOperand })
          }
          break
        }
        opts.push({ name: ch, afterOperand })
      }
    } else {
      afterOperand = true
    }
  }
  return opts
}

export function expandCpMvDestinationPaths(
  args: readonly string[],
  extractedPaths: readonly string[],
): string[] {
  const opts = parseCpMvOptions(args)
  const attachedDestinations: string[] = []
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=')
      const key = eqIdx === -1 ? arg.slice(2) : arg.slice(2, eqIdx)
      if (key !== '' && 'target-directory'.startsWith(key) && eqIdx !== -1) {
        attachedDestinations.push(arg.slice(eqIdx + 1))
      }
    } else if (arg.startsWith('-') && arg.indexOf('t') > 0) {
      const tIdx = arg.indexOf('t')
      if (tIdx < arg.length - 1) {
        const rest = arg.slice(tIdx + 1)
        attachedDestinations.push(rest)
        if (rest.startsWith('=')) {
          attachedDestinations.push(rest.slice(1))
        }
      }
    }
  }
  const destSet = new Set<string>(
    [
      ...opts.flatMap(o => (o.name === 't' && o.value ? [o.value] : [])),
      ...attachedDestinations,
      ...extractedPaths.filter(
        (p, idx) =>
          !p.startsWith('-') && extractedPaths[idx + 1]?.startsWith('-'),
      ),
      ...extractedPaths.slice(-1),
    ].filter(Boolean),
  )
  const destinations = Array.from(destSet)
  const expanded: string[] = []
  for (const dest of destinations) {
    const cleanDest = dest.replace(/[\\/]+$/, '')
    for (const src of extractedPaths) {
      if (src === dest) continue
      const base = posix.basename(src.replace(/\\/g, '/'))
      if (base && base !== '.' && base !== '..') {
        expanded.push(`${cleanDest}/${base}`)
      }
    }
  }
  const hasBackupOrParents = hasCpMvBackupOrParentsFlag(args)
  if (hasBackupOrParents && args.some(a => /^--pa/.test(a))) {
    for (const dest of destinations) {
      const cleanDest = dest.replace(/[\\/]+$/, '')
      for (const src of extractedPaths) {
        if (src === dest) continue
        expanded.push(`${cleanDest}/${src.replace(/^[\\/]+/, '')}`)
      }
    }
  }
  const hasBackup =
    hasBackupOrParents && opts.some(o => o.name === 'b' || o.name === 'S')
  const suffixes = hasBackup
    ? Array.from(
        new Set([
          '~',
          ...opts.filter(o => o.name === 'S' && o.value).map(o => o.value!),
        ]),
      )
    : []
  const backupExpanded =
    suffixes.length > 0
      ? [...destinations, ...expanded].flatMap(target =>
          suffixes.map(suffix => `${target.replace(/[\\/]+$/, '')}${suffix}`),
        )
      : []
  return Array.from(
    new Set([...attachedDestinations, ...expanded, ...backupExpanded]),
  )
}

/**
 * Official 2.1.326 #295/#310 (`fMn` @295721932):
 * Detect `cp` source forms that write source directory contents directly into
 * the destination directory (`.` / `..` basename, macOS trailing slash `src/`,
 * or `-T`/`--no-target-directory`).
 */
export function cpSourceTargetsDestContents(
  args: readonly string[],
  sources: readonly string[],
): boolean {
  const hasContentsSource = sources.some(src => {
    const clean = src.replace(/[\\/]+$/, '')
    const base = posix.basename(clean.replace(/\\/g, '/'))
    return (
      base === '.' ||
      base === '..' ||
      (getPlatform() === 'macos' && /[\\/]$/.test(src))
    )
  })
  if (hasContentsSource) return true
  return args.some(a => a.startsWith('--no-t') || /^-[^-]*T/.test(a))
}

/**
 * Official 2.1.326 #310 (`pMn` @295722078):
 * Detect `--parents`, `--backup`, `--suffix`, `-b`, `-S` flags on `cp`/`mv`.
 */
export function hasCpMvBackupOrParentsFlag(args: readonly string[]): boolean {
  return args.some(a => /^--(?:pa|b|su)/.test(a) || /^-[^-]*[bS]/.test(a))
}

/**
 * Official 2.1.326 #310 (`Ut` @295711300):
 * `cp`/`mv` with `-b`/`--backup` and no explicit `-S` suffix before operands
 * creates a backup file whose name depends on the environment (`SIMPLE_BACKUP_SUFFIX`
 * / `VERSION_CONTROL`) and must ask.
 */
export function isCpMvBackupSuffixEnvDependent(
  args: readonly string[],
): boolean {
  if (!hasCpMvBackupOrParentsFlag(args)) return false
  const opts = parseCpMvOptions(args)
  const hasExplicitSuffix = opts.some(
    o => o.name === 'S' && !o.afterOperand && Boolean(o.value),
  )
  if (hasExplicitSuffix) return false
  const hasEnvDependentBackup = opts.some(
    o =>
      o.name === 'b' &&
      !(
        o.value === 't' ||
        (o.value !== undefined &&
          o.value.length > 1 &&
          ['none', 'off', 'numbered'].some(k => k.startsWith(o.value ?? '')))
      ),
  )
  if (!hasEnvDependentBackup) return false
  return Boolean(
    process.env.SIMPLE_BACKUP_SUFFIX || process.env.VERSION_CONTROL,
  )
}

/**
 * Official 2.1.326 #308 (`sMn` @295708400):
 * Check if any target path resolves directly to, or is an ancestor directory of,
 * one of Claude Code's sign-in files (`.credentials.json`, `.device-keys.json`).
 */
export function findSignInFilesReachedByPaths(
  paths: readonly string[],
  cwd: string,
): { named: string[]; below: string[] } {
  if (paths.length === 0) return { named: [], below: [] }
  const caseFold = getPlatform() === 'macos' || getPlatform() === 'windows'
  const normForCompare = (p: string): string => {
    const n = normalize(p).normalize('NFC')
    return caseFold ? n.toLowerCase() : n
  }
  const expandVariants = (p: string): string[] => {
    const literal = normForCompare(p)
    const real = normForCompare(resolvePathWithExistingAncestorRealpath(p))
    return real !== literal ? [literal, real] : [literal]
  }
  const signInEntries = getClaudeSignInFilePaths().map(p => ({
    canonical: normalize(p),
    variants: expandVariants(p),
  }))
  const resolvedTargetVariants = paths.map(raw => {
    const clean = expandTilde(raw.replace(/^['"]|['"]$/g, ''))
    const norm =
      getPlatform() === 'windows' && /^\/(?:cygdrive\/)?[A-Za-z]\//.test(clean)
        ? posixPathToWindowsPath(clean)
        : clean
    const abs = normalize(isAbsolute(norm) ? norm : resolve(cwd, norm))
    return expandVariants(abs)
  })
  const named: string[] = []
  const below: string[] = []
  for (const { canonical, variants: signInVariants } of signInEntries) {
    let matchedDirect = false
    let matchedBelow = false
    for (const targetVariants of resolvedTargetVariants) {
      for (const target of targetVariants) {
        const prefix =
          target.endsWith('/') || target.endsWith('\\')
            ? target
            : `${target}${target.includes('\\') ? '\\' : '/'}`
        for (const signInVar of signInVariants) {
          if (target === signInVar) {
            matchedDirect = true
            break
          }
          if (signInVar.startsWith(prefix)) {
            matchedBelow = true
          }
        }
        if (matchedDirect) break
      }
      if (matchedDirect) break
    }
    if (matchedDirect) named.push(canonical)
    else if (matchedBelow) below.push(canonical)
  }
  return { named, below }
}

/**
 * Official 2.1.326 #308 (`lMn` @295709000):
 * Check `ln` / `link` commands that link to or overwrite a protected file or
 * Claude sign-in file.
 */
function checkLinkCommandProtectedPaths(
  rawCmd: string,
  args: readonly string[],
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult | null {
  const base = rawCmd
    .replace(/^.*[\\/]/, '')
    .toLowerCase()
    .replace(/\.exe$/, '')
  if (base !== 'ln' && base !== 'link') return null
  const positional = filterOutFlags([...args])
  const extraTargets = expandCpMvDestinationPaths(args, positional)
  const targets = Array.from(
    new Set([
      ...positional,
      ...extraTargets,
      ...(positional.length === 1 ? ['.'] : []),
    ]),
  )
  const signInHits = findSignInFilesReachedByPaths(targets, cwd)
  const ctxNoDeny: ToolPermissionContext = {
    ...toolPermissionContext,
    alwaysDenyRules: {},
  }
  for (const target of [...targets, ...signInHits.named, ...signInHits.below]) {
    if (isClaudeSignInFilePath(target) || signInHits.below.includes(target)) {
      const reason = signInHits.below.includes(target)
        ? `This command reaches ${target}, which Claude Code’s tools cannot write`
        : `Linking to or overwriting Claude Code's sign-in file '${target}' requires explicit approval. A link gives the file a second name, and later writes to that name change it.`
      return {
        behavior: 'ask',
        message: reason,
        blockedPath: target,
        decisionReason: {
          type: 'safetyCheck',
          reason,
          classifierApprovable: false,
          circuitBreaker: 'claudeSettingsFile',
        } as unknown as PermissionResult['decisionReason'],
        suggestions: [],
        suppressAlwaysAllowRule: true,
      }
    }
    const { decisionReason, resolvedPath } = validatePath(
      target,
      cwd,
      ctxNoDeny,
      'write',
    )
    if (
      decisionReason?.type === 'safetyCheck' &&
      !decisionReason.classifierApprovable
    ) {
      const reason = `${decisionReason.reason.replace(/\.$/, '')}. A link gives the file a second name, and later writes to that name change it.`
      return {
        behavior: 'ask',
        message: reason,
        blockedPath: resolvedPath,
        decisionReason: { ...decisionReason, reason },
        suggestions: [],
        suppressAlwaysAllowRule: true,
      }
    }
  }
  return null
}

function validateCommandPaths(
  command: PathCommand,
  args: string[],
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
  operationTypeOverride?: FileOperationType,
  astCmd?: SimpleCommand,
): PermissionResult {
  const extractor = PATH_EXTRACTORS[command]
  const paths = extractor(args)
  const operationType = operationTypeOverride ?? COMMAND_OPERATION_TYPE[command]
  const extraCpMvTargets =
    command === 'cp' || command === 'mv'
      ? expandCpMvDestinationPaths(args, paths)
      : []
  const allWritePaths =
    extraCpMvTargets.length > 0
      ? Array.from(new Set([...paths, ...extraCpMvTargets]))
      : paths

  const cpMvOpts =
    command === 'cp' || command === 'mv' ? parseCpMvOptions(args) : []
  const targetDirectoryGiven = cpMvOpts.some(o => o.name === 't')
  const cpSources =
    command === 'cp'
      ? targetDirectoryGiven
        ? paths
        : paths.length >= 2
          ? paths.slice(0, -1)
          : []
      : []
  const cpDestSet =
    command === 'cp'
      ? new Set(
          targetDirectoryGiven
            ? extraCpMvTargets
            : [...paths.slice(-1), ...extraCpMvTargets],
        )
      : null

  // Official 2.1.326 #11 (`dn` / `gn` @295712100):
  // Simple literal `cp` whose source path is covered ONLY by an `Edit` deny
  // rule (and not a `Read` deny rule) must NOT be refused because `cp` only
  // reads its source.
  const isSimpleLiteralCp =
    command === 'cp' &&
    !compoundCommandHasCd &&
    !targetDirectoryGiven &&
    (astCmd === undefined ||
      (normalizePathCommandName(astCmd.argv[0] ?? '') === 'cp' &&
        astCmd.envVars.length === 0)) &&
    args
      .slice(0, Math.max(0, args.length - paths.length))
      .every(f => /^(?:-[pfinv]+|--)$/.test(f)) &&
    paths.every(p => /^(?!\d+$)[\w./][^*?[#^=]*$/.test(p))

  const validateSingleTarget = (
    p: string,
    isCpSource: boolean,
  ): ReturnType<typeof validatePath> => {
    const writeCheck = validatePath(
      p,
      cwd,
      toolPermissionContext,
      operationType,
    )
    if (
      !isSimpleLiteralCp ||
      !isCpSource ||
      writeCheck.allowed ||
      writeCheck.decisionReason?.type !== 'rule'
    ) {
      return writeCheck
    }
    // Check if the path passes write validation once deny rules are cleared;
    // if so, the deny was an Edit deny rule — evaluate as a read instead so
    // Read deny rules still block while Edit deny rules do not block cp source.
    const withoutDeny = validatePath(
      p,
      cwd,
      { ...toolPermissionContext, alwaysDenyRules: {} },
      operationType,
    )
    return withoutDeny.allowed
      ? validatePath(p, cwd, toolPermissionContext, 'read')
      : withoutDeny
  }

  // Official #1850 + #11: explicit deny rules on any cp/mv destination target
  // (including `<destDir>/<basename(src)>` and `-t DIR`) AND Read deny rules on
  // any cp/mv source (`Zt` in official `I1r`) must still deny even when flags
  // would otherwise trigger a generic flag-validation ask.
  if (command === 'cp' || command === 'mv') {
    const readSources = targetDirectoryGiven
      ? paths
      : paths.length >= 2
        ? paths.slice(0, -1)
        : []
    for (const src of readSources) {
      const readCheck = validatePath(src, cwd, toolPermissionContext, 'read')
      if (!readCheck.allowed && readCheck.decisionReason?.type === 'rule') {
        return {
          behavior: 'deny',
          message: `${command} from '${readCheck.resolvedPath}' was blocked by a deny rule`,
          decisionReason: readCheck.decisionReason,
        }
      }
    }
    for (const p of allWritePaths) {
      const isSource = command === 'cp' && !cpDestSet!.has(p)
      const check = validateSingleTarget(p, isSource)
      if (!check.allowed && check.decisionReason?.type === 'rule') {
        return {
          behavior: 'deny',
          message: `${command} in '${check.resolvedPath}' was blocked by a deny rule`,
          decisionReason: check.decisionReason,
        }
      }
    }
  }

  // Official 2.1.326 #308: ask before write/remove/move/copy commands reach
  // Claude Code's sign-in files (directly or via an ancestor directory).
  if (operationType !== 'read') {
    const pathsToCheckForSignIn =
      command === 'cp' && cpSourceTargetsDestContents(args, cpSources)
        ? [...allWritePaths, ...paths.slice(-1)]
        : allWritePaths
    const signInHits = findSignInFilesReachedByPaths(pathsToCheckForSignIn, cwd)
    const firstSignIn = signInHits.named[0] ?? signInHits.below[0]
    if (firstSignIn !== undefined) {
      const reason = signInHits.below.includes(firstSignIn)
        ? `This command reaches ${firstSignIn}, which Claude Code’s tools cannot write`
        : `Modifying Claude Code's sign-in file '${firstSignIn}' requires explicit approval`
      return {
        behavior: 'ask',
        message: reason,
        blockedPath: firstSignIn,
        decisionReason: {
          type: 'safetyCheck',
          reason,
          classifierApprovable: false,
          circuitBreaker: 'claudeSettingsFile',
        } as unknown as PermissionResult['decisionReason'],
        suggestions: [],
        suppressAlwaysAllowRule: true,
      }
    }
  }

  // Official 2.1.326 #310: `cp`/`mv` with `-b`/`--backup` and no `-S` suffix
  // when backup env vars (`SIMPLE_BACKUP_SUFFIX`/`VERSION_CONTROL`) are set.
  if (
    (command === 'cp' || command === 'mv') &&
    isCpMvBackupSuffixEnvDependent(args)
  ) {
    const reason = `${command} makes a backup whose name depends on the environment (no -S suffix on the line)`
    return {
      behavior: 'ask',
      message: reason,
      decisionReason: {
        type: 'safetyCheck',
        reason,
        classifierApprovable: false,
      },
      suggestions: [],
      suppressAlwaysAllowRule: true,
    }
  }

  // Official 2.1.326 #295 & #310: `cp` with `.` / `..` / macOS trailing slash
  // (`src/`) or `-T`/`--no-target-directory` copies directory contents into the
  // destination and must ask before running.
  if (command === 'cp' && cpSourceTargetsDestContents(args, cpSources)) {
    const reason =
      getPlatform() === 'macos' && cpSources.some(s => /[\\/]$/.test(s))
        ? 'cp with a trailing slash on macOS copies directory contents directly into the destination and requires manual approval'
        : 'cp with directory-contents source or -T/--no-target-directory requires manual approval'
    return {
      behavior: 'ask',
      message: reason,
      decisionReason: {
        type: 'other',
        reason,
        bashMissKind: 'flag-validation',
      },
    }
  }

  // SECURITY: Check command-specific validators (e.g., to block flags that could bypass path validation)
  // Some commands like mv/cp have flags (--target-directory=PATH) that can bypass path extraction,
  // so we block ALL flags for these commands to ensure security.
  const validator = COMMAND_VALIDATOR[command]
  if (validator && !validator(args)) {
    // Official: cd multi-positional is a distinct miss kind from generic flags.
    if (command === 'cd') {
      return {
        behavior: 'ask',
        message:
          'cd with two or more directory arguments requires manual approval. zsh\'s "cd OLD NEW" form substitutes OLD→NEW in $PWD, producing a target path that cannot be statically validated.',
        decisionReason: {
          type: 'other',
          reason: 'cd with two or more directory arguments',
          bashMissKind: 'cd-multi-positional',
        },
      }
    }
    return {
      behavior: 'ask',
      message: `${command} with flags requires manual approval to ensure path safety. For security, Claude Code cannot automatically validate ${command} commands that use flags, as some flags like --target-directory=PATH can bypass path validation.`,
      decisionReason: {
        type: 'other',
        reason: `${command} command with flags requires manual approval`,
        bashMissKind: 'flag-validation',
      },
    }
  }

  // SECURITY: Block write operations in compound commands containing 'cd'
  // This prevents bypassing path safety checks via directory changes before operations.
  // Example attack: cd .claude/ && mv test.txt settings.json
  // This would bypass the check for .claude/settings.json because paths are resolved
  // relative to the original CWD, not accounting for the cd's effect.
  //
  // ALTERNATIVE APPROACH: Instead of blocking all writes with cd, we could track the
  // effective CWD through the command chain (e.g., after "cd .claude/", subsequent
  // commands would be validated with CWD=".claude/"). This would be more permissive
  // but requires careful handling of:
  // - Relative paths (cd ../foo)
  // - Special cd targets (cd ~, cd -, cd with no args)
  // - Multiple cd commands in sequence
  // - Error cases where cd target cannot be determined
  // For now, we take the conservative approach of requiring manual approval.
  if (compoundCommandHasCd && operationType !== 'read') {
    return {
      behavior: 'ask',
      message: `Commands that change directories and perform write operations require explicit approval to ensure paths are evaluated correctly. For security, Claude Code cannot automatically determine the final working directory when 'cd' is used in compound commands.`,
      decisionReason: {
        type: 'other',
        reason:
          'Compound command contains cd with write operation - manual approval required to prevent path resolution bypass',
        bashMissKind: 'cd-compound-write',
      },
    }
  }

  for (const path of allWritePaths) {
    const isSource = command === 'cp' && !cpDestSet!.has(path)
    const { allowed, resolvedPath, decisionReason } = validateSingleTarget(
      path,
      isSource,
    )

    if (!allowed) {
      const workingDirs = Array.from(
        allWorkingDirectories(toolPermissionContext),
      )
      const dirListStr = formatDirectoryList(workingDirs)

      // Use security check's custom reason if available (type: 'other' or 'safetyCheck')
      // Otherwise use the standard "was blocked" message
      const message =
        decisionReason?.type === 'other' ||
        decisionReason?.type === 'safetyCheck'
          ? decisionReason.reason
          : `${command} in '${resolvedPath}' was blocked. For security, Claude Code may only ${ACTION_VERBS[command]} the allowed working directories for this session: ${dirListStr}.`

      if (decisionReason?.type === 'rule') {
        return {
          behavior: 'deny',
          message,
          decisionReason,
        }
      }

      return {
        behavior: 'ask',
        message,
        blockedPath: resolvedPath,
        decisionReason,
      }
    }
  }

  // All paths are valid - return passthrough
  return {
    behavior: 'passthrough',
    message: `Path validation passed for ${command} command`,
  }
}

export function createPathChecker(
  command: PathCommand,
  operationTypeOverride?: FileOperationType,
) {
  return (
    args: string[],
    cwd: string,
    context: ToolPermissionContext,
    compoundCommandHasCd?: boolean,
    astCmd?: SimpleCommand,
  ): PermissionResult => {
    // First check normal path validation (which includes explicit deny rules)
    const result = validateCommandPaths(
      command,
      args,
      cwd,
      context,
      compoundCommandHasCd,
      operationTypeOverride,
      astCmd,
    )

    // If explicitly denied, respect that (don't override with dangerous path message)
    if (result.behavior === 'deny') {
      return result
    }

    // Check for dangerous removal paths AFTER explicit deny rules but BEFORE other results
    // This ensures the check runs even if the user has allowlist rules or if glob patterns
    // were rejected, but respects explicit deny rules. Dangerous patterns get a specific
    // error message that overrides generic glob pattern rejection messages.
    if (command === 'rm' || command === 'rmdir') {
      const dangerousPathResult = checkDangerousRemovalPaths(command, args, cwd)
      if (dangerousPathResult.behavior !== 'passthrough') {
        return dangerousPathResult
      }
    }

    // If it's a passthrough, return it directly
    if (result.behavior === 'passthrough') {
      return result
    }

    // If it's an ask decision, add suggestions based on the operation type
    if (result.behavior === 'ask') {
      // Official 2.1.323 #2009: when a Bash command writes to a sensitive path
      // (.git, .claude, .bashrc, settings files, etc.), a saved Bash allow rule
      // or directory grant will NOT bypass the safetyCheck on the next prompt —
      // suppress "don't ask again" and emit no suggestions.
      if (result.decisionReason?.type === 'safetyCheck') {
        return {
          ...result,
          suggestions: [],
          suppressAlwaysAllowRule: true,
        }
      }

      const operationType =
        operationTypeOverride ?? COMMAND_OPERATION_TYPE[command]
      const suggestions: PermissionUpdate[] = []

      // Only suggest adding directory/rules if we have a blocked path
      if (result.blockedPath) {
        if (operationType === 'read') {
          // For read operations, suggest a Read rule for the directory (only if it exists)
          const dirPath = getDirectoryForPath(result.blockedPath)
          const suggestion = createReadRuleSuggestion(dirPath, 'session')
          if (suggestion) {
            suggestions.push(suggestion)
          }
        } else {
          // For write/create operations, suggest adding the directory
          suggestions.push({
            type: 'addDirectories',
            directories: [getDirectoryForPath(result.blockedPath)],
            destination: 'session',
          })
        }
      }

      // densable Tzu/Zlr: suggest acceptEdits only when mode is default|plan
      // and plan was not entered from elevated prePlanMode.
      if (operationType === 'write' || operationType === 'create') {
        const ctx = context
        const prePlanElevated =
          ctx.mode === 'plan' &&
          (ctx.prePlanMode === 'auto' ||
            ctx.prePlanMode === 'bypassPermissions' ||
            ctx.prePlanMode === 'acceptEdits' ||
            ctx.prePlanMode === 'dontAsk')
        if (
          (ctx.mode === 'default' || ctx.mode === 'plan') &&
          !prePlanElevated
        ) {
          suggestions.push({
            type: 'setMode',
            mode: 'acceptEdits',
            destination: 'session',
          })
        }
      }

      result.suggestions = suggestions
    }

    // Return the decision directly
    return result
  }
}

/**
 * Parses command arguments using shell-quote, converting glob objects to strings.
 * This is necessary because shell-quote parses patterns like *.txt as glob objects,
 * but we need them as strings for path validation.
 */
function parseCommandArguments(cmd: string): string[] {
  const parseResult = tryParseShellCommand(cmd, env => `$${env}`)
  if (!parseResult.success) {
    // Malformed shell syntax, return empty array
    return []
  }
  const parsed = parseResult.tokens
  const extractedArgs: string[] = []

  for (const arg of parsed) {
    if (typeof arg === 'string') {
      // Include empty strings - they're valid arguments (e.g., grep "" /tmp/t)
      extractedArgs.push(arg)
    } else if (
      typeof arg === 'object' &&
      arg !== null &&
      'op' in arg &&
      arg.op === 'glob' &&
      'pattern' in arg
    ) {
      // shell-quote parses glob patterns as objects, but we need them as strings for validation
      extractedArgs.push(String(arg.pattern))
    }
  }

  return extractedArgs
}

/**
 * Validates a single command for path constraints and shell safety.
 *
 * This function:
 * 1. Parses the command arguments
 * 2. Checks if it's a path command (cd, ls, find)
 * 3. Validates for shell injection patterns
 * 4. Validates all paths are within allowed directories
 *
 * @param cmd - The command string to validate
 * @param cwd - Current working directory
 * @param toolPermissionContext - Context containing allowed directories
 * @param compoundCommandHasCd - Whether the full compound command contains a cd
 * @returns PermissionResult - 'passthrough' if not a path command, otherwise validation result
 */
function validateSinglePathCommand(
  cmd: string,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
): PermissionResult {
  // SECURITY: Strip wrapper commands (timeout, nice, nohup, time) before extracting
  // the base command. Without this, dangerous commands wrapped with these utilities
  // would bypass path validation since the wrapper command (e.g., 'timeout') would
  // be checked instead of the actual command (e.g., 'rm').
  // Example: 'timeout 10 rm -rf /' would otherwise see 'timeout' as the base command.
  const strippedCmd = stripSafeWrappers(cmd)

  // Parse command into arguments, handling quotes and globs
  const extractedArgs = parseCommandArguments(strippedCmd)
  if (extractedArgs.length === 0) {
    return {
      behavior: 'passthrough',
      message: 'Empty command - no paths to validate',
    }
  }

  // Check if this is a path command we need to validate
  const [rawBaseCmd, ...args] = extractedArgs
  if (rawBaseCmd) {
    const linkCheck = checkLinkCommandProtectedPaths(
      rawBaseCmd,
      args,
      cwd,
      toolPermissionContext,
    )
    if (linkCheck !== null) return linkCheck
  }
  const baseCmd = rawBaseCmd ? normalizePathCommandName(rawBaseCmd) : undefined
  if (!baseCmd || !SUPPORTED_PATH_COMMANDS.includes(baseCmd as PathCommand)) {
    return {
      behavior: 'passthrough',
      message: `Command '${baseCmd}' is not a path-restricted command`,
    }
  }

  // For read-only sed commands (e.g., sed -n '1,10p' file.txt),
  // validate file paths as read operations instead of write operations.
  // sed is normally classified as 'write' for path validation, but when the
  // command is purely reading (line printing with -n), file args are read-only.
  const operationTypeOverride =
    baseCmd === 'sed' && sedCommandIsAllowedByAllowlist(strippedCmd)
      ? ('read' as FileOperationType)
      : undefined

  // Validate all paths are within allowed directories
  const pathChecker = createPathChecker(
    baseCmd as PathCommand,
    operationTypeOverride,
  )
  return pathChecker(args, cwd, toolPermissionContext, compoundCommandHasCd)
}

/**
 * Like validateSinglePathCommand but operates on AST-derived argv directly
 * instead of re-parsing the command string with shell-quote. Avoids the
 * shell-quote single-quote backslash bug that causes parseCommandArguments
 * to silently return [] and skip path validation.
 */
function validateSinglePathCommandArgv(
  cmd: SimpleCommand,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
): PermissionResult {
  const argv = stripWrappersFromArgv(cmd.argv)
  if (argv.length === 0) {
    return {
      behavior: 'passthrough',
      message: 'Empty command - no paths to validate',
    }
  }
  const [rawBaseCmd, ...args] = argv
  if (rawBaseCmd) {
    const linkCheck = checkLinkCommandProtectedPaths(
      rawBaseCmd,
      args,
      cwd,
      toolPermissionContext,
    )
    if (linkCheck !== null) return linkCheck
  }
  const baseCmd = rawBaseCmd ? normalizePathCommandName(rawBaseCmd) : undefined
  if (!baseCmd || !SUPPORTED_PATH_COMMANDS.includes(baseCmd as PathCommand)) {
    return {
      behavior: 'passthrough',
      message: `Command '${baseCmd}' is not a path-restricted command`,
    }
  }
  // sed read-only override: use .text for the allowlist check since
  // sedCommandIsAllowedByAllowlist takes a string. argv is already
  // wrapper-stripped but .text is raw tree-sitter span (includes
  // `timeout 5 ` prefix), so strip here too.
  const operationTypeOverride =
    baseCmd === 'sed' &&
    sedCommandIsAllowedByAllowlist(stripSafeWrappers(cmd.text))
      ? ('read' as FileOperationType)
      : undefined
  const pathChecker = createPathChecker(
    baseCmd as PathCommand,
    operationTypeOverride,
  )
  return pathChecker(
    args,
    cwd,
    toolPermissionContext,
    compoundCommandHasCd,
    cmd,
  )
}

/**
 * densable + Windows: discard targets that do not write to the filesystem.
 * `/dev/null` (POSIX) always; `NUL`/`nul`/`\\.\NUL` only on Windows — on
 * Unix/WSL `> nul` creates a real file named `nul` and must still trip
 * cd-compound-redirect (233 #20 review).
 */
export function isDiscardOutputRedirectTarget(target: string): boolean {
  const t = target.trim()
  if (t === '/dev/null') return true
  // Windows null device only (optionally \\.\NUL) — not Linux/macOS/WSL
  if (getPlatform() === 'windows' && /^(?:\\\\\.\\)?nul$/i.test(t)) {
    return true
  }
  return false
}

/** @internal exported for unit tests (cd-compound-redirect /dev/null exception) */
export function validateOutputRedirections(
  redirections: Array<{ target: string; operator: '>' | '>>' }>,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
): PermissionResult {
  // SECURITY: Block output redirections in compound commands containing 'cd'
  // This prevents bypassing path safety checks via directory changes before redirections.
  // Example attack: cd .claude/ && echo "malicious" > settings.json
  // The redirection target would be validated relative to the original CWD, but the
  // actual write happens in the changed directory after 'cd' executes.
  // SEA #1124 (`Wcn` @290025174): validate non-discard targets (when cd is present,
  // only absolute / ~ targets whose resolution doesn't depend on cd) FIRST so an
  // Edit(path) deny rule returns 'deny' before cd-compound-redirect returns 'ask'.
  const nonDiscard = redirections.filter(
    r => !isDiscardOutputRedirectTarget(r.target),
  )
  const validations = nonDiscard
    .filter(
      r =>
        !compoundCommandHasCd ||
        isAbsolute(r.target) ||
        r.target.startsWith('~'),
    )
    .map(r => validatePath(r.target, cwd, toolPermissionContext, 'create'))

  const ruleDeny = validations.find(
    v => !v.allowed && v.decisionReason?.type === 'rule',
  )
  if (ruleDeny?.decisionReason !== undefined) {
    return {
      behavior: 'deny',
      message: `Output redirection to '${ruleDeny.resolvedPath}' was blocked by a deny rule.`,
      decisionReason: ruleDeny.decisionReason,
    }
  }

  // Official 2.1.207: /dev/null-only redirects are safe (discard output) and must not
  // spuriously prompt — only non-discard targets trigger cd-compound-redirect.
  // densable 2.1.233 #20: also treat Windows NUL as discard (auto-mode regression).
  if (compoundCommandHasCd && nonDiscard.length > 0) {
    return {
      behavior: 'ask',
      message: `Commands that change directories and write via output redirection require explicit approval to ensure paths are evaluated correctly. For security, Claude Code cannot automatically determine the final working directory when 'cd' is used in compound commands.`,
      decisionReason: {
        type: 'other',
        reason:
          'Compound command contains cd with output redirection - manual approval required to prevent path resolution bypass',
        bashMissKind: 'cd-compound-redirect',
      },
    }
  }

  for (const { allowed, resolvedPath, decisionReason } of validations) {
    if (!allowed) {
      const workingDirs = Array.from(
        allWorkingDirectories(toolPermissionContext),
      )
      const dirListStr = formatDirectoryList(workingDirs)

      // Use security check's custom reason if available (type: 'other' or 'safetyCheck')
      // Otherwise use the standard message for deny rules or working directory restrictions
      const message =
        decisionReason?.type === 'other' ||
        decisionReason?.type === 'safetyCheck'
          ? decisionReason.reason
          : decisionReason?.type === 'rule'
            ? `Output redirection to '${resolvedPath}' was blocked by a deny rule.`
            : `Output redirection to '${resolvedPath}' was blocked. For security, Claude Code may only write to files in the allowed working directories for this session: ${dirListStr}.`

      // If denied by a deny rule, return 'deny' behavior
      if (decisionReason?.type === 'rule') {
        return {
          behavior: 'deny',
          message,
          decisionReason,
        }
      }

      // Official 2.1.323 #2009: output redirection to a sensitive path
      // (.git, .claude, .bashrc, etc.) triggers a safetyCheck that cannot be
      // bypassed by a saved allow rule — suppress "don't ask again" and
      // omit suggestions.
      if (decisionReason?.type === 'safetyCheck') {
        return {
          behavior: 'ask',
          message,
          blockedPath: resolvedPath,
          decisionReason,
          suggestions: [],
          suppressAlwaysAllowRule: true,
        }
      }

      return {
        behavior: 'ask',
        message,
        blockedPath: resolvedPath,
        decisionReason,
        suggestions: [
          {
            type: 'addDirectories',
            directories: [getDirectoryForPath(resolvedPath)],
            destination: 'session',
          },
        ],
      }
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No unsafe redirections found',
  }
}

/**
 * densable 2.1.232 #43 — validate Bash input redirections (`< file`) as reads.
 * Matches argument-form path checks: deny rules → deny; outside working dirs → ask.
 * `/dev/null` is always safe. Heredoc (`<<`/`<<<`) and fd dup (`<&`) are not
 * file-path reads here (densable only gates `op === "<"`).
 */
export function validateInputRedirections(
  redirections: Array<{ target: string }>,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult {
  for (const { target } of redirections) {
    if (target === '/dev/null') {
      continue
    }
    const { allowed, resolvedPath, decisionReason } = validatePath(
      target,
      cwd,
      toolPermissionContext,
      'read',
    )

    if (!allowed) {
      const message =
        decisionReason?.type === 'other' ||
        decisionReason?.type === 'safetyCheck'
          ? decisionReason.reason
          : decisionReason?.type === 'rule'
            ? `Input redirection from '${resolvedPath}' was blocked by a deny rule.`
            : `Input redirection from '${resolvedPath}' was blocked. For security, Claude Code may only read files in the allowed working directories for this session.`

      if (decisionReason?.type === 'rule') {
        return {
          behavior: 'deny',
          message,
          decisionReason,
        }
      }

      // densable lkt(rZ(y)): session Read suggestion for parent dir when no
      // decisionReason (working-dir restriction, not rule/safety).
      const suggestions: PermissionUpdate[] = []
      if (decisionReason === undefined) {
        const readSuggestion = createReadRuleSuggestion(
          getDirectoryForPath(resolvedPath),
          'session',
        )
        if (readSuggestion) {
          suggestions.push(readSuggestion)
        }
      }

      return {
        behavior: 'ask',
        message,
        blockedPath: resolvedPath,
        decisionReason,
        ...(suggestions.length > 0 ? { suggestions } : {}),
      }
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No unsafe input redirections found',
  }
}

/**
 * Checks path constraints for commands that access the filesystem (cd, ls, find).
 * Also validates output redirections to ensure they're within allowed directories.
 *
 * @returns
 * - 'ask' if any path command or redirection tries to access outside allowed directories
 * - 'passthrough' if no path commands were found or if all are within allowed directories
 */
export function checkPathConstraints(
  input: z.infer<typeof BashTool.inputSchema>,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
  astRedirects?: Redirect[],
  astCommands?: SimpleCommand[],
): PermissionResult {
  // SECURITY: Process substitution >(cmd) can execute commands that write to files
  // without those files appearing as redirect targets. For example:
  //   echo secret > >(tee .git/config)
  // The tee command writes to .git/config but it's not detected as a redirect.
  // Require explicit approval for any command containing process substitution.
  // Skip on AST path — process_substitution is in DANGEROUS_TYPES and
  // already returned too-complex before reaching here.
  if (!astCommands && />>\s*>\s*\(|>\s*>\s*\(|<\s*\(/.test(input.command)) {
    return {
      behavior: 'ask',
      message:
        'Process substitution (>(...) or <(...)) can execute arbitrary commands and requires manual approval',
      decisionReason: {
        type: 'other',
        reason: 'Process substitution requires manual approval',
        bashMissKind: 'process-substitution',
      },
    }
  }

  // SECURITY: When AST-derived redirects are available, use them directly
  // instead of re-parsing with shell-quote. shell-quote has a known
  // single-quote backslash bug that silently merges redirect operators into
  // garbled tokens on a successful parse (not a parse failure, so the
  // fail-closed guard doesn't help). The AST already resolved targets
  // correctly and checkSemantics validated them.
  const { redirections, hasDangerousRedirection } = astRedirects
    ? astRedirectsToOutputRedirections(astRedirects)
    : extractOutputRedirections(input.command)

  // SECURITY: If we found a redirection operator with a target containing shell expansion
  // syntax ($VAR or %VAR%), require manual approval since the target can't be safely validated.
  // Official also classifies /dev/tcp|/dev/udp as net-redirect (network_device).
  if (hasDangerousRedirection) {
    const isNetworkDevice =
      /\/dev\/(tcp|udp)\//.test(input.command) ||
      redirections.some(r => /\/dev\/(tcp|udp)\//.test(r.target))
    const message = isNetworkDevice
      ? 'Redirect involving /dev/tcp or /dev/udp opens a network connection'
      : 'Shell expansion syntax in paths requires manual approval'
    return {
      behavior: 'ask',
      message,
      decisionReason: {
        type: 'other',
        reason: message,
        bashMissKind: isNetworkDevice ? 'net-redirect' : 'shell-expansion',
      },
    }
  }
  const redirectionResult = validateOutputRedirections(
    redirections,
    cwd,
    toolPermissionContext,
    compoundCommandHasCd,
  )
  if (redirectionResult.behavior !== 'passthrough') {
    return redirectionResult
  }

  // densable 2.1.233: REVERTED 2.1.232 Bash input-redirect (`< file`) product
  // gate. Official notes: "Reverted the 2.1.232 Bash permission changes for
  // Cygwin-style symlinks on Windows and for input redirections (`< file`);
  // a narrower version will return in a later release."
  // Keep validateInputRedirections exported for residual tests / future revive;
  // do NOT call it from checkPathConstraints until densable ships the narrower gate.

  // SECURITY: When AST-derived commands are available, iterate them with
  // pre-parsed argv instead of re-parsing via splitCommand_DEPRECATED + shell-quote.
  // shell-quote has a single-quote backslash bug that causes
  // parseCommandArguments to silently return [] and skip path validation
  // (isDangerousRemovalPath etc). The AST already resolved argv correctly.
  if (astCommands) {
    for (const cmd of astCommands) {
      const result = validateSinglePathCommandArgv(
        cmd,
        cwd,
        toolPermissionContext,
        compoundCommandHasCd,
      )
      if (result.behavior === 'ask' || result.behavior === 'deny') {
        return result
      }
    }
  } else {
    const commands = splitCommand_DEPRECATED(input.command)
    for (const cmd of commands) {
      const result = validateSinglePathCommand(
        cmd,
        cwd,
        toolPermissionContext,
        compoundCommandHasCd,
      )
      if (result.behavior === 'ask' || result.behavior === 'deny') {
        return result
      }
    }
  }

  // Always return passthrough to let other permission checks handle the command
  return {
    behavior: 'passthrough',
    message: 'All path commands validated successfully',
  }
}

/**
 * Convert AST-derived Redirect[] to the format expected by
 * validateOutputRedirections. Filters to output-only redirects (excluding
 * fd duplications like 2>&1) and maps operators to '>' | '>>'.
 */
function astRedirectsToOutputRedirections(redirects: Redirect[]): {
  redirections: Array<{ target: string; operator: '>' | '>>' }>
  hasDangerousRedirection: boolean
} {
  const redirections: Array<{ target: string; operator: '>' | '>>' }> = []
  for (const r of redirects) {
    switch (r.op) {
      case '>':
      case '>|':
      case '&>':
        redirections.push({ target: r.target, operator: '>' })
        break
      case '>>':
      case '&>>':
        redirections.push({ target: r.target, operator: '>>' })
        break
      case '>&':
        // >&N (digits only) is fd duplication (e.g. 2>&1, >&10), not a file
        // write. >&file is the deprecated form of &>file (redirect to file).
        if (!/^\d+$/.test(r.target)) {
          redirections.push({ target: r.target, operator: '>' })
        }
        break
      case '<':
      case '<<':
      case '<&':
      case '<<<':
        // input redirects — skip
        break
    }
  }
  // AST targets are fully resolved (no shell expansion) — checkSemantics
  // already validated them. No dangerous redirections are possible.
  return { redirections, hasDangerousRedirection: false }
}

// ───────────────────────────────────────────────────────────────────────────
// Argv-level safe-wrapper stripping (timeout, nice, stdbuf, env, time, nohup)
//
// This is the CANONICAL stripWrappersFromArgv. bashPermissions.ts still
// exports an older narrower copy (timeout/nice-n-N only) that is DEAD CODE
// — no prod consumer — but CANNOT be removed: bashPermissions.ts is right
// at Bun's feature() DCE complexity threshold, and deleting ~80 lines from
// that module silently breaks feature('BASH_CLASSIFIER') evaluation (drops
// every pendingClassifierCheck spread). Verified in PR #21503 round 3:
// baseline classifier tests 30/30 pass, after deletion 22/30 fail. See
// team memory: bun-feature-dce-cliff.md. Hit 3× in PR #21075 + twice in
// #21503. The expanded version lives here (the only prod consumer) instead.
//
// KEEP IN SYNC with:
//   - SAFE_WRAPPER_PATTERNS in bashPermissions.ts (text-based stripSafeWrappers)
//   - the wrapper-stripping loop in checkSemantics (src/utils/bash/ast.ts ~1860)
// If you add a wrapper in either, add it here too. Asymmetry means
// checkSemantics exposes the wrapped command to semantic checks but path
// validation sees the wrapper name → passthrough → wrapped paths never
// validated (PR #21503 review comment 2907319120).
// ───────────────────────────────────────────────────────────────────────────

// SECURITY: allowlist for timeout flag VALUES (signals are TERM/KILL/9,
// durations are 5/5s/10.5). Rejects $ ( ) ` | ; & and newlines that
// previously matched via [^ \t]+ — `timeout -k$(id) 10 ls` must NOT strip.
const TIMEOUT_FLAG_VALUE_RE = /^[A-Za-z0-9_.+-]+$/

/**
 * Parse timeout's GNU flags (long + short, fused + space-separated) and
 * return the argv index of the DURATION token, or -1 if flags are unparseable.
 */
function skipTimeoutFlags(a: readonly string[]): number {
  let i = 1
  while (i < a.length) {
    const arg = a[i]!
    const next = a[i + 1]
    if (
      arg === '--foreground' ||
      arg === '--preserve-status' ||
      arg === '--verbose'
    )
      i++
    else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) i++
    else if (
      (arg === '--kill-after' || arg === '--signal') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    )
      i += 2
    else if (arg === '--') {
      i++
      break
    } // end-of-options marker
    else if (arg.startsWith('--')) return -1
    else if (arg === '-v') i++
    else if (
      (arg === '-k' || arg === '-s') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    )
      i += 2
    else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) i++
    else if (arg.startsWith('-')) return -1
    else break
  }
  return i
}

/**
 * Parse stdbuf's flags (-i/-o/-e in fused/space-separated/long-= forms).
 * Returns argv index of wrapped COMMAND, or -1 if unparseable or no flags
 * consumed (stdbuf without flags is inert). Mirrors checkSemantics (ast.ts).
 */
function skipStdbufFlags(a: readonly string[]): number {
  let i = 1
  while (i < a.length) {
    const arg = a[i]!
    if (/^-[ioe]$/.test(arg) && a[i + 1]) i += 2
    else if (/^-[ioe]./.test(arg)) i++
    else if (/^--(input|output|error)=/.test(arg)) i++
    else if (arg.startsWith('-'))
      return -1 // unknown flag: fail closed
    else break
  }
  return i > 1 && i < a.length ? i : -1
}

/**
 * Parse env's VAR=val and safe flags (-i/-0/-v/-u NAME). Returns argv index
 * of wrapped COMMAND, or -1 if unparseable/no wrapped cmd. Rejects -S (argv
 * splitter), -C/-P (altwd/altpath). Mirrors checkSemantics (ast.ts).
 */
function skipEnvFlags(a: readonly string[]): number {
  let i = 1
  while (i < a.length) {
    const arg = a[i]!
    if (arg.includes('=') && !arg.startsWith('-')) i++
    else if (arg === '-i' || arg === '-0' || arg === '-v') i++
    else if (arg === '-u' && a[i + 1]) i += 2
    else if (arg.startsWith('-'))
      return -1 // -S/-C/-P/unknown: fail closed
    else break
  }
  return i < a.length ? i : -1
}

/**
 * Argv-level counterpart to stripSafeWrappers (bashPermissions.ts). Strips
 * wrapper commands from AST-derived argv. Env vars are already separated
 * into SimpleCommand.envVars so no env-var stripping here.
 */
export function stripWrappersFromArgv(argv: string[]): string[] {
  let a = argv
  for (;;) {
    if (a[0] === 'time' || a[0] === 'nohup') {
      a = a.slice(a[1] === '--' ? 2 : 1)
    } else if (a[0] === 'timeout') {
      const i = skipTimeoutFlags(a)
      // SECURITY (PR #21503 round 3): unrecognized duration (`.5`, `+5`,
      // `inf` — strtod formats GNU timeout accepts) → return a unchanged.
      // Safe because checkSemantics (ast.ts) fails CLOSED on the same input
      // and runs first in bashToolHasPermission, so we never reach here.
      if (i < 0 || !a[i] || !/^\d+(?:\.\d+)?[smhd]?$/.test(a[i]!)) return a
      a = a.slice(i + 1)
    } else if (a[0] === 'nice') {
      // SECURITY (PR #21503 round 3): mirror checkSemantics — handle bare
      // `nice cmd` and legacy `nice -N cmd`, not just `nice -n N cmd`.
      // Previously only `-n N` was stripped: `nice rm /outside` →
      // baseCmd='nice' → passthrough → /outside never path-validated.
      if (a[1] === '-n' && a[2] && /^-?\d+$/.test(a[2]))
        a = a.slice(a[3] === '--' ? 4 : 3)
      else if (a[1] && /^-\d+$/.test(a[1])) a = a.slice(a[2] === '--' ? 3 : 2)
      else a = a.slice(a[1] === '--' ? 2 : 1)
    } else if (a[0] === 'stdbuf') {
      // SECURITY (PR #21503 round 3): PR-WIDENED. Pre-PR, `stdbuf -o0 -eL rm`
      // was rejected by fragment check (old checkSemantics slice(2) left
      // name='-eL'). Post-PR, checkSemantics strips both flags → name='rm'
      // → passes. But stripWrappersFromArgv returned unchanged →
      // baseCmd='stdbuf' → not in SUPPORTED_PATH_COMMANDS → passthrough.
      const i = skipStdbufFlags(a)
      if (i < 0) return a
      a = a.slice(i)
    } else if (a[0] === 'env') {
      // Same asymmetry: checkSemantics strips env, we didn't.
      const i = skipEnvFlags(a)
      if (i < 0) return a
      a = a.slice(i)
    } else {
      return a
    }
  }
}
