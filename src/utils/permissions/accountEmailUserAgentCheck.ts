/**
 * Official 2.1.321 #1958 (`tengu_wise_newt` / privacy plugin):
 * Refuses (without prompting) a tool call that holds or reads the signed-in
 * account's email address beside a User-Agent / client identity, or puts the
 * account's email address in a WebFetch URL.
 */

import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getOauthAccountInfo } from '../auth.js'
import { getCwd } from '../cwd.js'
import type { PermissionDenyDecision } from './PermissionResult.js'

export const ACCOUNT_EMAIL_USER_AGENT_REFUSAL =
  "This call was refused: it, or a script it names, holds or reads the account's email address beside what looks like a client's identity, or puts the address in a URL. Use a generic client name. If a site needs a real contact, ask the person which to use. To send this address, the person sets it themselves in an environment variable the script reads, or runs the command themselves with `!`."

const QUOTING = /["'`\\]/g

const USER_AGENT_PATTERN =
  /user[-_]?agent|[-\u2013-\u2015]-user-(?:a(?:g[a-z]*)?)?(?![a-z-])|[-\u2013-\u2015]usera(?:g[a-z]*)?(?![a-z])|\bua\s*[:=]/i

const IDENTITY_PATTERN =
  /set_identity|(?<!-)identity=|(?<![\w-])--identity(?![\w-])|\bmailto=|sec_edgar|edgartools|browse-edgar|\bfrom\s+edgar\s+import\b|\bimport\s+edgar\b|\bsec\.gov\b/i

const HEADER_FROM_FLAG =
  /(?:\s-[a-zA-Z]*H|--header)[\s=]*(?:["']\s*)?[Ff][Rr][Oo][Mm]\s*:/

const HEADER_FROM_KEY = /["']From\\*["']\s*[:=,]/
const HEADERS_WORD = /(?<![a-z])headers(?![a-z])/i

const GIT_EMAIL_READ =
  /\bgit\b[^\n]{0,40}\bconfig\b[^\n]{0,40}\buser\.email\b(?![ \t]+(?!\d?>)["'$\w])|\$(?:\{|env:)?GIT_(?:AUTHOR|COMMITTER)_EMAIL\b/i

const CLI_UA_FLAG_PAIRS: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [/\bcurl(?:ie)?\b/i, /\s[-\u2013-\u2015][a-zA-WYZ0-9#]*A/],
  [/\bwget2?\b/i, /\s[-\u2013-\u2015][a-zA-Z0-9]*U/],
  [
    /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b/i,
    /\s[-\u2013-\u2015]user(?![\w=-])/i,
  ],
]

const SCRIPT_NAME_PATTERN =
  /(?<![^\s"'`=(;&|<>])(?:[\w./-]*\.(?:py|sh|bash|zsh|js|mjs|cjs|ts|mts|cts|rb|pl|php|lua|ps1|go)|\.[/\\][\w/-]+)(?![^\s"'`);&|<>])/gi

const UNSAFE_SCRIPT_PATH = /^[/\\]|(?:^|[/\\])\.\.(?:[/\\]|$)/

const GIT_COMMAND =
  /(?<=^|[&;|\n])[ \t]*(?:\w+=[^\s&;|]*[ \t]+)*git(?=\s|$)(?:<<-?[ \t]*["']?(\w+)[\s\S]*?(?:\n[ \t]*\1(?:\n?[ \t]*\)"|[ \t\r]*(?=\n|$))|$)|[^\n"'\\<;|&]+|"(?=\$\(cat\s+<<)|"[^"\\]*(?:\\[\s\S]?[^"\\]*)*(?:"|$)|'[^']*(?:'|$)|\\[\s\S]?|<)*/g

const WEBFETCH_TOOL = 'WebFetch'
const EDIT_TOOL = 'Edit'
const FIELD_TOOLS_MAP = new Map<string, string>([
  ['Write', 'content'],
  [EDIT_TOOL, 'new_string'],
  ['NotebookEdit', 'new_source'],
  [WEBFETCH_TOOL, 'url'],
])
const SHELL_TOOLS = new Set(['Bash', 'Monitor', 'PowerShell'])
const MCP_TOOL_RE = /^mcp__/

export function isWiseNewtEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_wise_newt', true) !== false
}

export function textOf(value: unknown): string {
  if (typeof value === 'string') {
    const unquoted = value
      .replace(/[\\`]\r?\n/g, '')
      .replace(/\$(?=["'])/g, '')
      .replace(QUOTING, '')
    return `${value}\n${unquoted}`
  }
  if (typeof value !== 'object' || value === null) return ''
  if (Array.isArray(value)) {
    return value.map(textOf).join(' ')
  }
  return Object.entries(value)
    .map(([k, v]) => `"${k}": ${textOf(v)}`)
    .join('\n')
}

function emailVariants(email: string): [string, string] {
  return [email, email.replace(QUOTING, '')]
}

export function mayHoldAddress(text: string): boolean {
  return text.includes('@') || text.includes('%40') || GIT_EMAIL_READ.test(text)
}

export function holdsAddress(text: string, email: string | undefined): boolean {
  if (email === undefined || email === '') return false
  const lower = text.toLowerCase()
  const decoded = text
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .toLowerCase()
  return emailVariants(email).some(variant => {
    const v = variant.toLowerCase()
    return lower.includes(v) || decoded.includes(v)
  })
}

function hasUserAgentCue(text: string): boolean {
  return (
    USER_AGENT_PATTERN.test(text) ||
    IDENTITY_PATTERN.test(text) ||
    HEADER_FROM_FLAG.test(text) ||
    (HEADERS_WORD.test(text) && HEADER_FROM_KEY.test(text)) ||
    CLI_UA_FLAG_PAIRS.some(
      ([cmdRe, flagRe]) => cmdRe.test(text) && flagRe.test(text),
    )
  )
}

export function namesUserAgentWithAddress(
  text: string,
  email: string | undefined,
): boolean {
  if (email === undefined || email === '') return false
  if (!holdsAddress(text, email)) {
    return text
      .split('\n')
      .some(line => GIT_EMAIL_READ.test(line) && hasUserAgentCue(line))
  }
  const stripped = text.replace(
    new RegExp(
      emailVariants(email)
        .map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|'),
      'gi',
    ),
    ' ',
  )
  return hasUserAgentCue(stripped)
}

function fieldText(
  input: unknown,
  field: string,
  stripPattern?: RegExp,
): string {
  const val =
    typeof input === 'object' && input !== null
      ? Object.entries(input).find(([k]) => k === field)?.[1]
      : undefined
  return textOf(
    stripPattern !== undefined && typeof val === 'string'
      ? val.replace(stripPattern, ' ')
      : val,
  )
}

function outgoingText(toolName: string, input: unknown): string {
  const field = FIELD_TOOLS_MAP.get(toolName)
  return field === undefined ? textOf(input) : fieldText(input, field)
}

export function scriptNamesInCommand(commandText: string): string[] {
  const names = new Set<string>()
  for (const [match] of commandText.matchAll(SCRIPT_NAME_PATTERN)) {
    if (!UNSAFE_SCRIPT_PATH.test(match)) {
      names.add(match)
    }
    if (names.size === 8) break
  }
  return [...names]
}

export function isAccountEmailUserAgentRefused(
  toolName: string,
  input: unknown,
  email: string | undefined,
): boolean {
  const text = outgoingText(toolName, input)
  if (toolName === WEBFETCH_TOOL) {
    return holdsAddress(text, email)
  }
  return (
    namesUserAgentWithAddress(text, email) &&
    !(
      toolName === EDIT_TOOL &&
      namesUserAgentWithAddress(fieldText(input, 'old_string'), email)
    )
  )
}

async function readLocalNonSymlinkScript(
  relPath: string,
  cwd: string,
): Promise<string> {
  try {
    const parts = relPath
      .split(/[/\\]+/)
      .filter(part => part !== '' && part !== '.')
    if (parts.length === 0) return ''
    let current = cwd
    let isFile = false
    for (const part of parts) {
      current = join(current, part)
      const st = await lstat(current)
      if (st.isSymbolicLink()) return ''
      isFile = st.isFile()
    }
    if (!isFile) return ''
    return await readFile(current, 'utf-8')
  } catch {
    return ''
  }
}

export function checkAccountEmailUserAgentSync(
  toolName: string,
  input: unknown,
  emailOverride?: string,
): PermissionDenyDecision | null {
  if (!isWiseNewtEnabled()) return null
  if (
    !SHELL_TOOLS.has(toolName) &&
    !FIELD_TOOLS_MAP.has(toolName) &&
    !MCP_TOOL_RE.test(toolName)
  ) {
    return null
  }
  const text = outgoingText(toolName, input)
  if (!mayHoldAddress(text)) return null
  const email = emailOverride ?? getOauthAccountInfo()?.emailAddress
  if (!email) return null
  if (isAccountEmailUserAgentRefused(toolName, input, email)) {
    return {
      behavior: 'deny',
      message: ACCOUNT_EMAIL_USER_AGENT_REFUSAL,
      decisionReason: {
        type: 'other',
        reason: ACCOUNT_EMAIL_USER_AGENT_REFUSAL,
      },
    }
  }
  return null
}

export async function checkAccountEmailUserAgent(
  toolName: string,
  input: unknown,
  options?: { email?: string; cwd?: string },
): Promise<PermissionDenyDecision | null> {
  if (!isWiseNewtEnabled()) return null
  if (
    !SHELL_TOOLS.has(toolName) &&
    !FIELD_TOOLS_MAP.has(toolName) &&
    !MCP_TOOL_RE.test(toolName)
  ) {
    return null
  }
  const text = outgoingText(toolName, input)
  const isShell = SHELL_TOOLS.has(toolName)
  const commandForScripts = isShell
    ? fieldText(input, 'command', GIT_COMMAND)
    : text
  const scripts = isShell ? scriptNamesInCommand(commandForScripts) : []
  if (scripts.length === 0 && !mayHoldAddress(text)) {
    return null
  }
  const email = options?.email ?? getOauthAccountInfo()?.emailAddress
  if (!email) return null
  if (isAccountEmailUserAgentRefused(toolName, input, email)) {
    return {
      behavior: 'deny',
      message: ACCOUNT_EMAIL_USER_AGENT_REFUSAL,
      decisionReason: {
        type: 'other',
        reason: ACCOUNT_EMAIL_USER_AGENT_REFUSAL,
      },
    }
  }
  if (scripts.length > 0) {
    const cwd = options?.cwd ?? getCwd()
    const contents = await Promise.all(
      scripts.map(s => readLocalNonSymlinkScript(s, cwd)),
    )
    if (
      contents.some(content =>
        namesUserAgentWithAddress(textOf(content), email),
      )
    ) {
      return {
        behavior: 'deny',
        message: ACCOUNT_EMAIL_USER_AGENT_REFUSAL,
        decisionReason: {
          type: 'other',
          reason: ACCOUNT_EMAIL_USER_AGENT_REFUSAL,
        },
      }
    }
  }
  return null
}
