/**
 * densable S$m / w$m / hGw / Kee — non-interactive /auto-mode-setup args.
 * Gold: gold-wide-Grn.txt (hGw / Kee / E$m)
 */
import type { AutoModeSetupAnswers } from './answers.js'

export const AUTO_MODE_SETUP_USAGE = `Usage:
  /auto-mode-setup [--request-id <uuid>] --wizard posture=<personal|open-source|enterprise|mixed> scope=<all|project> depth=<both|shell|repos|here> --propose
  /auto-mode-setup [--request-id <uuid>] [--apply-target <user|project>] --expect-sha256 <64-hex> --apply-file <absolute-path>   (reads a proposal JSON from a file under the system temp dir or the Claude config dir — the caller must have shown it to the user first; --expect-sha256 is required and the apply refuses unless the file’s exact bytes hash to the given sha256)

--request-id must come first when used. The token must be a UUID (canonical 8-4-4-4-12 hex-and-dash form, either case) and is echoed verbatim as "requestId" on the command's JSON result, so a host with several commands in flight can match replies to requests.

--apply-target doesn’t change where the config is written — entries always land in the user settings file. It refuses a proposal whose scope answer doesn’t match the save choice (user ↔ scope=all, project ↔ scope=project). Flags ride in the order shown; everything after --apply-file is the path.`

const APPLY_TARGETS = ['user', 'project'] as const
const SCOPE_FOR_TARGET = {
  user: 'all',
  project: 'project',
} as const

const SHA256_RE = /^[0-9a-fA-F]{64}$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ParsedAutoModeSetupArgs =
  | {
      mode: 'usage'
      message: string
      logCode?: string
      requestId?: string
    }
  | {
      mode: 'propose'
      answers: AutoModeSetupAnswers
      requestId?: string
    }
  | {
      mode: 'apply-file'
      path: string
      target?: 'user' | 'project'
      expectedSha256?: string
      requestId?: string
    }

function pick<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return allowed.find(a => a === value)
}

function stripQuotes(path: string): string {
  if (
    (path.startsWith('"') && path.endsWith('"')) ||
    (path.startsWith("'") && path.endsWith("'"))
  ) {
    return path.slice(1, -1)
  }
  return path
}

/** densable S$m */
function parseRequestIdPrefix(
  raw: string,
):
  | { ok: true; rest: string; requestId?: string }
  | { ok: false; message: string } {
  const match = raw.match(/^--request-id(?:=|\s+(?!--))(\S+)\s*/)
  if (!match) {
    if (/^--request-id=?(?=\s|$)/.test(raw)) {
      return {
        ok: false,
        message: `--request-id needs a value.\n${AUTO_MODE_SETUP_USAGE}`,
      }
    }
    return { ok: true, rest: raw }
  }
  const id = match[1]!
  if (!UUID_RE.test(id)) {
    return {
      ok: false,
      message: `--request-id must be a UUID in canonical 8-4-4-4-12 hex-and-dash form (either case) — the token is refused, not echoed.\n${AUTO_MODE_SETUP_USAGE}`,
    }
  }
  return { ok: true, rest: raw.slice(match[0].length), requestId: id }
}

/** densable hGw */
export function parseAutoModeSetupHeadlessBody(
  raw: string,
): ParsedAutoModeSetupArgs {
  let rest = raw.trim()
  if (rest === '' || rest === '--help' || rest === '-h') {
    return { mode: 'usage', message: AUTO_MODE_SETUP_USAGE }
  }
  if (/^--request-id(?:=|\s|$)/.test(rest)) {
    return {
      mode: 'usage',
      message: `--request-id was given more than once — pass exactly one, as the first flag.\n${AUTO_MODE_SETUP_USAGE}`,
      logCode: 'bad_flag_grammar',
    }
  }

  let target: 'user' | 'project' | undefined
  const targetMatch = rest.match(/^--apply-target(?:[= ]\s*(\S+))?(?:\s+|$)/)
  if (targetMatch) {
    const parsed = pick(targetMatch[1], APPLY_TARGETS)
    if (!parsed) {
      return {
        mode: 'usage',
        message: `--apply-target must be "user" or "project".\n${AUTO_MODE_SETUP_USAGE}`,
        logCode: 'bad_flag_grammar',
      }
    }
    target = parsed
    rest = rest.slice(targetMatch[0].length)
    if (/^--apply-target(?:[= ]|\s|$)/.test(rest)) {
      return {
        mode: 'usage',
        message: `--apply-target was given more than once — pass exactly one.\n${AUTO_MODE_SETUP_USAGE}`,
        logCode: 'bad_flag_grammar',
      }
    }
    if (/^--request-id(?:=|\s|$)/.test(rest)) {
      return {
        mode: 'usage',
        message: `--request-id must come first, before --apply-target and --expect-sha256.\n${AUTO_MODE_SETUP_USAGE}`,
        logCode: 'bad_flag_grammar',
      }
    }
    if (!/^(?:--expect-sha256|--apply-file)(?:\s|$)/.test(rest)) {
      return {
        mode: 'usage',
        message: `--apply-target only applies to --apply-file.\n${AUTO_MODE_SETUP_USAGE}`,
        logCode: 'bad_flag_grammar',
      }
    }
  }

  let expectedSha256: string | undefined
  if (/^--expect-sha256=/.test(rest)) {
    return {
      mode: 'usage',
      message:
        '--expect-sha256 takes its value space-separated, not with `=`: --expect-sha256 <64-hex> --apply-file <path>.\n' +
        AUTO_MODE_SETUP_USAGE,
      logCode: 'bad_flag_grammar',
    }
  }
  if (/^--expect-sha256(?:\s|$)/.test(rest)) {
    const m = rest.match(/^--expect-sha256\s+(\S+)\s*(.*)$/s)
    const digest = m?.[1]
    if (digest === undefined || digest.startsWith('--')) {
      return {
        mode: 'usage',
        message: `--expect-sha256 needs the 64-character hex sha256 of the proposal file’s exact bytes.\n${AUTO_MODE_SETUP_USAGE}`,
        logCode: 'bad_flag_grammar',
      }
    }
    expectedSha256 = digest
    rest = m![2]!
    if (!/^--apply-file(?:\s|$)/.test(rest)) {
      return {
        mode: 'usage',
        message: `--expect-sha256 applies only to --apply-file and must come directly before it (--apply-target goes before --expect-sha256).\n${AUTO_MODE_SETUP_USAGE}`,
        logCode: 'bad_flag_grammar',
      }
    }
  }

  if (/^--apply-file(?:\s|$)/.test(rest)) {
    const m = rest.match(/^--apply-file\s+(.+)$/s)
    if (m) {
      const pathPart = m[1]!.trim()
      if (/(?:^|\s)--expect-sha256(?:=|\s|$)/.test(pathPart)) {
        return {
          mode: 'usage',
          message: `--expect-sha256 must come before --apply-file, not after it.\n${AUTO_MODE_SETUP_USAGE}`,
          logCode: 'bad_flag_grammar',
        }
      }
      if (/(?:^|\s)--request-id(?:=|\s|$)/.test(pathPart)) {
        return {
          mode: 'usage',
          message: `--request-id must come first, before --expect-sha256 and --apply-file — not after --apply-file.\n${AUTO_MODE_SETUP_USAGE}`,
          logCode: 'bad_flag_grammar',
        }
      }
      if (/(?:^|\s)--apply-target(?:=|\s|$)/.test(pathPart)) {
        return {
          mode: 'usage',
          message: `--apply-target must come before --expect-sha256 and --apply-file — not after --apply-file.\n${AUTO_MODE_SETUP_USAGE}`,
          logCode: 'bad_flag_grammar',
        }
      }
      return {
        mode: 'apply-file',
        path: stripQuotes(pathPart),
        ...(target !== undefined && { target }),
        ...(expectedSha256 !== undefined && { expectedSha256 }),
      }
    }
    return {
      mode: 'usage',
      message: `--apply-file needs a path to the reviewed proposal JSON.\n${AUTO_MODE_SETUP_USAGE}`,
      logCode: 'bad_flag_grammar',
    }
  }

  const wizard = rest.match(
    /^--wizard posture=(\S+) scope=(\S+) depth=(\S+)\s+--propose$/,
  )
  if (!wizard) {
    if (/--apply\b/.test(rest)) {
      return {
        mode: 'usage',
        message:
          'One-shot --apply isn’t available (it would write model output with no review). Use --propose, show the result to the user, then --apply-file <path>.',
      }
    }
    return {
      mode: 'usage',
      message: `Couldn’t parse arguments.\n${AUTO_MODE_SETUP_USAGE}`,
    }
  }

  const posture = pick(wizard[1], [
    'personal',
    'open-source',
    'enterprise',
    'mixed',
  ] as const)
  const scope = pick(wizard[2], ['all', 'project'] as const)
  const depth = pick(wizard[3], ['both', 'shell', 'repos', 'here'] as const)
  if (!posture || !scope || !depth) {
    return {
      mode: 'usage',
      message: `Couldn’t parse arguments.\n${AUTO_MODE_SETUP_USAGE}`,
    }
  }
  return {
    mode: 'propose',
    answers: { posture, scope, depth },
  }
}

/** densable w$m */
export function parseAutoModeSetupHeadlessArgs(
  args: string,
): ParsedAutoModeSetupArgs {
  const prefix = parseRequestIdPrefix(args.trim())
  if (!prefix.ok) {
    return {
      mode: 'usage',
      message: prefix.message,
      logCode: 'bad_flag_grammar',
    }
  }
  const parsed = parseAutoModeSetupHeadlessBody(prefix.rest)
  if (prefix.requestId === undefined) return parsed
  return { ...parsed, requestId: prefix.requestId }
}

export function expectedScopeForApplyTarget(
  target: 'user' | 'project',
): AutoModeSetupAnswers['scope'] {
  return SCOPE_FOR_TARGET[target]
}

export function isSha256Hex(value: string): boolean {
  return SHA256_RE.test(value)
}
