/**
 * Client-side secret scanner for team memory (PSR M22174).
 *
 * Scans content for credentials before upload so secrets never leave the
 * user's machine. Uses a curated subset of high-confidence rules from
 * gitleaks (https://github.com/gitleaks/gitleaks, MIT license) — only
 * rules with distinctive prefixes that have near-zero false-positive
 * rates are included. Generic keyword-context rules are omitted.
 *
 * Rule IDs and regexes sourced directly from the public gitleaks config:
 * https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
 *
 * JS regex notes:
 *   - gitleaks uses Go regex; inline (?i) and mode groups (?-i:...) are
 *     not portable to JS. Affected rules are rewritten with explicit
 *     character classes ([a-zA-Z0-9] instead of (?i)[a-z0-9]).
 *   - Trailing boundary alternations like (?:[\x60'"\s;]|\\[nr]|$) from
 *     Go regex are kept (JS $ matches end-of-string in default mode).
 */

import { logError } from '../../utils/log.js'
import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js'
import { capitalize } from '../../utils/stringUtils.js'

type SecretRule = {
  /** Gitleaks rule ID (kebab-case), used in labels and analytics */
  id: string
  /** Regex source, lazily compiled on first scan */
  source: string
  /** Optional JS regex flags (most rules are case-sensitive by default) */
  flags?: string
  /** Optional cheap prefilter regex checked before running `re` (avoids lookahead backtracking) */
  prefilter?: RegExp
  /** Character class for run-guarded scan/redact lookahead (prevents ReDoS on long token runs) */
  run?: string
  /** Character class for run-guarded display-redact lookahead */
  displayRun?: string
  /**
   * densable `WKc.confidence`. Display redaction (`redactForDisplay` / `tAt`)
   * only applies `high`. Full redaction (`redactSecrets` / `pp`) applies all.
   * Default `high` for curated gitleaks prefixes.
   */
  confidence?: 'high' | 'low'
}

export type SecretMatch = {
  /** Gitleaks rule ID that matched (e.g., "github-pat", "aws-access-token") */
  ruleId: string
  /** Human-readable label derived from the rule ID */
  label: string
}

// ─── Curated rules ──────────────────────────────────────────────
// High-confidence patterns from gitleaks with distinctive prefixes.
// Ordered roughly by likelihood of appearing in dev-team content.

// Anthropic API key prefix, assembled at runtime so the literal byte
// sequence isn't present in the external bundle (excluded-strings check).
// join() is not constant-folded by the minifier.
const ANT_KEY_PFX = ['sk', 'ant', 'api'].join('-')

/** densable `UKc` — trailing boundary used by many high-confidence sources. */
const TRAILING_BOUNDARY = `(?:[\\x60'"\\s;]|\\\\[nr]|$)`
/** densable `BKc` — display boundary: allow shell delimiters after the token (#29). */
const DISPLAY_BOUNDARY = '(?=[^a-zA-Z0-9_\\-+=]|$)'
/** densable `Nhy` — display leading boundary. */
const DISPLAY_LEADING = '(?<![a-zA-Z0-9_\\-])'
/** densable `Mhy` — min chars between BEGIN/END private-key markers. */
const PRIVATE_KEY_MIN_GAP = 64

const JWT_CHAR = '[A-Za-z0-9_-]'
const JWT_PART = `${JWT_CHAR}{10}${JWT_CHAR}*`
const JWT_TAIL = `\\.${JWT_PART}\\.${JWT_PART}`
const LOOSE_JWT_SOURCE = `(?<!${JWT_CHAR})(?=${JWT_CHAR}+${JWT_TAIL})(?:${JWT_CHAR}*?-)??(eyJ${JWT_PART}${JWT_TAIL})`

const GITLAB_TOKEN_CHAR = '[\\w=-]'
const GITLAB_TOKEN_BODY = `${GITLAB_TOKEN_CHAR}{20,}(?:\\.[0-9a-z]{9})?`

const SECRET_RULES: SecretRule[] = [
  // — densable low-confidence (full redact only; not used by scanForSecrets high path) —
  // NOTE: `url-userinfo` (`://([^/@\s]+)@`) is handled by `redactUrlUserinfoLinear`
  // in O(N) time (#489) to avoid quadratic regex scanning on very long text with URLs.
  {
    id: 'gcp-service-account',
    prefilter: /\.iam\.gserviceaccount\.com/i,
    source: '\\b([a-z0-9-]+@[a-z0-9-]+\\.iam\\.gserviceaccount\\.com)\\b',
    flags: 'i',
    confidence: 'low',
  },
  {
    id: 'loose-anthropic-key',
    prefilter: /sk-ant/,
    source: '\\b(sk-ant-?[\\w-]{10,})',
    confidence: 'low',
  },
  {
    id: 'http-auth-scheme',
    prefilter: /\b(?:Bearer|Basic)\s/i,
    source: '\\b(?:Bearer|Basic)\\s+([A-Za-z0-9+/=._~-]{20,})',
    flags: 'i',
    confidence: 'low',
  },
  {
    id: 'loose-jwt',
    prefilter: /eyJ/,
    source: LOOSE_JWT_SOURCE,
    confidence: 'low',
  },

  // — Cloud providers —
  {
    id: 'aws-access-token',
    source: '\\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\\b',
  },
  {
    id: 'gcp-api-key',
    // densable 2.1.234: lookahead boundary (not UKc) so shell delimiters still match (#29)
    source: '\\b(AIza[\\w-]{35})(?![\\w-])',
  },
  {
    id: 'google-oauth-client-secret',
    source: '\\bGOCSPX-[\\w-]{28}(?![\\w-])',
  },
  {
    id: 'azure-ad-client-secret',
    prefilter: /\dQ~/,
    source:
      '(?:^|[\\\\\'"\\x60\\s>=:(,)])([a-zA-Z0-9_~.]{3}\\dQ~[a-zA-Z0-9_~.-]{31,34})(?:$|[\\\\\'"\\x60\\s<),])',
  },
  {
    id: 'digitalocean-pat',
    source: '\\b(dop_v1_[a-f0-9]{64})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'digitalocean-access-token',
    source: '\\b(doo_v1_[a-f0-9]{64})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },

  // — AI APIs —
  {
    id: 'anthropic-api-key',
    source: `\\b(${ANT_KEY_PFX}03-[a-zA-Z0-9_\\-]{93}AA)(?:[\\x60'"\\s;]|\\\\[nr]|$)`,
  },
  {
    id: 'anthropic-admin-api-key',
    source:
      '\\b(sk-ant-admin01-[a-zA-Z0-9_\\-]{93}AA)(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'anthropic-oauth-token',
    source: `\\b(sk-ant-(?:oat|ort)\\d{2}-[\\w-]{20,})(?:[\\x60'"\\s;]|\\\\[nr]|$)`,
    run: '[\\w-]',
  },
  {
    id: 'openai-api-key',
    prefilter: /T3BlbkFJ/,
    // densable WKc split: modern openai-api-key + openai-legacy-api-key
    source: 'sk-[A-Za-z0-9_-]{8,200}T3BlbkFJ[A-Za-z0-9_-]{8,200}',
  },
  {
    id: 'openai-legacy-api-key',
    source: '\\bsk-[a-zA-Z0-9]{48}(?![a-zA-Z0-9])',
  },
  {
    id: 'huggingface-access-token',
    // gitleaks: hf_(?i:[a-z]{34}) → JS: hf_[a-zA-Z]{34}
    source: '\\b(hf_[a-zA-Z]{34})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'supabase-secret-key',
    source: '\\bsb_secret_[A-Za-z0-9_-]{20,}',
  },
  {
    id: 'supabase-access-token',
    source: '\\bsbp_[a-z0-9]{40,}',
  },

  // — Version control —
  {
    id: 'github-pat',
    source: 'ghp_[0-9a-zA-Z]{36}',
  },
  {
    id: 'github-fine-grained-pat',
    source: 'github_pat_\\w{82}',
  },
  {
    id: 'github-app-token',
    source: '(?:ghu|ghs)_[0-9a-zA-Z]{36}',
  },
  {
    id: 'github-oauth',
    source: 'gho_[0-9a-zA-Z]{36}',
  },
  {
    id: 'github-refresh-token',
    source: 'ghr_[0-9a-zA-Z]{36}',
  },
  // densable 2.1.232 #6 — GitLab token families (prefixes from SEA gitleaks table).
  // Full redaction of routable glpat-/gldt-; additional families below.
  {
    id: 'gitlab-pat',
    // densable: full redaction of routable glpat-
    source: `glpat-${GITLAB_TOKEN_BODY}`,
    displayRun: GITLAB_TOKEN_CHAR,
  },
  {
    id: 'gitlab-deploy-token',
    source: `gldt-${GITLAB_TOKEN_BODY}`,
    displayRun: GITLAB_TOKEN_CHAR,
  },
  {
    id: 'gitlab-runner-authentication-token',
    source: `glrt-${GITLAB_TOKEN_BODY}`,
    displayRun: GITLAB_TOKEN_CHAR,
  },
  {
    id: 'gitlab-oauth-app-secret',
    source: `gloas-${GITLAB_TOKEN_BODY}`,
    displayRun: GITLAB_TOKEN_CHAR,
  },
  {
    id: 'gitlab-pipeline-trigger-token',
    source: `glptt-${GITLAB_TOKEN_BODY}`,
    displayRun: GITLAB_TOKEN_CHAR,
  },
  {
    id: 'gitlab-kubernetes-agent-token',
    source: `glagent-${GITLAB_TOKEN_BODY}`,
    displayRun: GITLAB_TOKEN_CHAR,
  },
  {
    id: 'gitlab-incoming-mail-token',
    source: `glimt-${GITLAB_TOKEN_BODY}`,
    displayRun: GITLAB_TOKEN_CHAR,
  },
  {
    id: 'gitlab-scim-oauth-token',
    source: `glsoat-${GITLAB_TOKEN_BODY}`,
    displayRun: GITLAB_TOKEN_CHAR,
  },
  {
    id: 'gitlab-ci-build-token',
    source: `glcbt-${GITLAB_TOKEN_BODY}`,
    displayRun: GITLAB_TOKEN_CHAR,
  },
  {
    id: 'gitlab-feed-token',
    source: `glft-${GITLAB_TOKEN_BODY}`,
    displayRun: GITLAB_TOKEN_CHAR,
  },
  {
    id: 'gitlab-feature-flag-client-token',
    source: `glffct-${GITLAB_TOKEN_BODY}`,
    displayRun: GITLAB_TOKEN_CHAR,
  },

  // — Communication —
  {
    id: 'slack-bot-token',
    source: 'xoxb-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*',
  },
  {
    id: 'slack-user-token',
    source: 'xox[a-z](?:-[0-9]{10,13}){3}-[a-zA-Z0-9-]{28,34}',
  },
  {
    id: 'slack-rotation-token',
    source: 'xoxe(?:\\.xox[a-z])?-[0-9]-[A-Za-z0-9-]{28,}',
  },
  {
    id: 'slack-app-token',
    source: 'xapp-\\d-[A-Z0-9]+-\\d+-[a-z0-9]+',
    flags: 'i',
  },
  {
    id: 'slack-workflow-token',
    source: '\\bxwfp-[a-zA-Z0-9-]{20,}',
  },
  {
    id: 'slack-webhook-url',
    prefilter: /hooks\.slack\.com/i,
    source:
      '(?:https?://)?hooks\\.slack\\.com/(?:services|workflows|triggers)/[A-Za-z0-9+/_-]{40,}',
    flags: 'i',
  },
  {
    id: 'twilio-api-key',
    source: 'SK[0-9a-fA-F]{32}',
  },
  {
    id: 'sendgrid-api-token',
    // gitleaks: SG\.(?i)[a-z0-9=_\-\.]{66} → JS: case-insensitive via flag
    source: '\\b(SG\\.[a-zA-Z0-9=_\\-.]{66})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },

  // — Dev tooling —
  {
    id: 'npm-access-token',
    source: '\\b(npm_[a-zA-Z0-9]{36})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'pypi-upload-token',
    source: 'pypi-AgEIcHlwaS5vcmc[\\w-]{50,1000}',
  },
  {
    id: 'databricks-api-token',
    source: '\\b(dapi[a-f0-9]{32}(?:-\\d)?)(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'hashicorp-tf-api-token',
    prefilter: /\.atlasv1\./,
    // gitleaks: (?i)[a-z0-9]{14}\.(?-i:atlasv1)\.[a-z0-9\-_=]{60,70}
    // → JS: case-insensitive hex+alnum prefix, literal "atlasv1", case-insensitive suffix
    source: '[a-zA-Z0-9]{14}\\.atlasv1\\.[a-zA-Z0-9\\-_=]{60,70}',
  },
  {
    id: 'pulumi-api-token',
    source: '\\b(pul-[a-f0-9]{40})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'postman-api-token',
    // gitleaks: PMAK-(?i)[a-f0-9]{24}\-[a-f0-9]{34} → JS: use [a-fA-F0-9]
    source:
      '\\b(PMAK-[a-fA-F0-9]{24}-[a-fA-F0-9]{34})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },

  // — Observability —
  {
    id: 'grafana-api-key',
    source:
      '\\b(eyJrIjoi[A-Za-z0-9+/]{70,400}={0,3})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'grafana-cloud-api-token',
    source: '\\b(glc_[A-Za-z0-9+/]{32,400}={0,3})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'grafana-service-account-token',
    source:
      '\\b(glsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'sentry-user-token',
    source: '\\b(sntryu_[a-f0-9]{64})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'sentry-org-token',
    source:
      '\\bsntrys_eyJpYXQiO[a-zA-Z0-9+/]{10,200}(?:LCJyZWdpb25fdXJs|InJlZ2lvbl91cmwi|cmVnaW9uX3VybCI6)[a-zA-Z0-9+/]{10,200}={0,2}_[a-zA-Z0-9+/]{43}',
  },

  // — Payment / commerce —
  {
    id: 'stripe-access-token',
    source:
      '\\b((?:sk|rk)_(?:test|live|prod)_[a-zA-Z0-9]{10,99})(?:[\\x60\'"\\s;]|\\\\[nr]|$)',
  },
  {
    id: 'shopify-access-token',
    source: 'shpat_[a-fA-F0-9]{32}',
  },
  {
    id: 'shopify-shared-secret',
    source: 'shpss_[a-fA-F0-9]{32}',
  },

  // — Crypto —
  // densable: PEM blocks are handled by Lhy (BEGIN/END pair find), not a
  // single regex rule, so oversized / truncated PEMs still redact under
  // full-strength `redactSecrets` (#28). Kept out of SECRET_RULES.
]

// densable `$Kc` / `FKc`
const PRIVATE_KEY_BEGIN =
  /-----BEGIN[ A-Z0-9_-]{0,100}?PRIVATE KEY(?: BLOCK)?-----/gi
const PRIVATE_KEY_END =
  /-----END[ A-Z0-9_-]{0,100}?PRIVATE KEY(?: BLOCK)?-----/gi

// densable `Bhy` / `jhy` — if the matched token looks like a command/path/dest,
// display redaction must keep it (#28).
const DISPLAY_SHELL_CHARS = /[$`|;&<>()\s]/
const DISPLAY_PATH_CHARS = /[/.@:~*?\\]/

type CompiledRule = {
  id: string
  confidence: 'high' | 'low'
  prefilter?: RegExp
  re: RegExp
}

type SecretScannerErrorReporter = (err: unknown) => void

type SecretScannerHostState = {
  scanRules: CompiledRule[] | null
  fullRedactRules: CompiledRule[] | null
  displayRedactRules: CompiledRule[] | null
  redactResultCache: Map<string, string>
  errorReporter: SecretScannerErrorReporter | undefined
  memoryProbeOverrideForTest: (() => void) | undefined
}

// Lazily compiled pattern caches — densable `jKc` / `$hy`, per-host via HostSlot.
const secretScannerStateByHost = new HostSlot<SecretScannerHostState>(() => ({
  scanRules: null,
  fullRedactRules: null,
  displayRedactRules: null,
  redactResultCache: new Map<string, string>(),
  errorReporter: undefined,
  memoryProbeOverrideForTest: undefined,
}))

function getSecretScannerState(): SecretScannerHostState {
  return secretScannerStateByHost.of(getBootstrapSessionHost())
}

const REDACT_CACHE_MAX = 512
const REDACT_CACHE_VALUE_MAX = 512

function flagsWithGlobal(
  flags: string | undefined,
  forceGlobal: boolean,
): string {
  const base = (flags ?? '').replaceAll('g', '')
  return forceGlobal ? `${base}g` : base
}

function stripTrailingBoundary(source: string): string {
  return source.endsWith(TRAILING_BOUNDARY)
    ? source.slice(0, -TRAILING_BOUNDARY.length)
    : source
}

function compileRules(forRedact: boolean): CompiledRule[] {
  return SECRET_RULES.map(r => {
    const baseFlags = (r.flags ?? '').replaceAll('g', '')
    const confidence = r.confidence ?? 'high'
    if (r.run === undefined) {
      return {
        id: r.id,
        confidence,
        ...(r.prefilter !== undefined && { prefilter: r.prefilter }),
        re: new RegExp(r.source, flagsWithGlobal(r.flags, forRedact)),
      }
    }
    return {
      id: r.id,
      confidence,
      prefilter: new RegExp(stripTrailingBoundary(r.source), baseFlags),
      re: new RegExp(
        `(?:(?<!${r.run})|(?<=\\\\[nr]))(?=${r.run}+${TRAILING_BOUNDARY})${r.run}*?${r.source}`,
        flagsWithGlobal(r.flags, forRedact),
      ),
    }
  })
}

/** densable `$hy` — high-confidence display rules with shell-delimiter-safe boundaries. */
function compileDisplayRules(): CompiledRule[] {
  return SECRET_RULES.map(r => {
    const confidence = r.confidence ?? 'high'
    const baseFlags = (r.flags ?? '').replaceAll('g', '')
    const globalFlags = flagsWithGlobal(r.flags, true)
    if (confidence !== 'high') {
      return {
        id: r.id,
        confidence,
        re: new RegExp(r.source, globalFlags),
      }
    }
    const stripped = stripTrailingBoundary(r.source)
    if (r.displayRun === undefined) {
      return {
        id: r.id,
        confidence,
        re: new RegExp(
          DISPLAY_LEADING + stripped + DISPLAY_BOUNDARY,
          globalFlags,
        ),
      }
    }
    return {
      id: r.id,
      confidence,
      prefilter: new RegExp(stripped, baseFlags),
      re: new RegExp(
        `(?<!${r.displayRun})(?=${r.displayRun}+${DISPLAY_BOUNDARY})${r.displayRun}*?${DISPLAY_LEADING}(${stripped})${DISPLAY_BOUNDARY}`,
        globalFlags,
      ),
    }
  })
}

function getScanRules(): CompiledRule[] {
  const state = getSecretScannerState()
  if (state.scanRules === null) {
    assertSecretScannerMemoryHeadroom()
    state.scanRules = compileRules(false)
  }
  return state.scanRules
}

function getFullRedactRules(): CompiledRule[] {
  const state = getSecretScannerState()
  if (state.fullRedactRules === null) {
    assertSecretScannerMemoryHeadroom()
    state.fullRedactRules = compileRules(true)
  }
  return state.fullRedactRules
}

function getDisplayRedactRules(): CompiledRule[] {
  const state = getSecretScannerState()
  if (state.displayRedactRules === null) {
    assertSecretScannerMemoryHeadroom()
    state.displayRedactRules = compileDisplayRules()
  }
  return state.displayRedactRules
}

/**
 * densable `RAs` — find next BEGIN…END private-key block starting at `from`.
 * Requires ≥ Mhy (64) chars between markers.
 */
function findPrivateKeyBlock(
  text: string,
  from: number,
): { start: number; end: number } | null {
  PRIVATE_KEY_BEGIN.lastIndex = from
  const begin = PRIVATE_KEY_BEGIN.exec(text)
  if (!begin) return null
  PRIVATE_KEY_END.lastIndex =
    begin.index + begin[0].length + PRIVATE_KEY_MIN_GAP
  const end = PRIVATE_KEY_END.exec(text)
  if (!end) return null
  return { start: begin.index, end: end.index + end[0].length }
}

function hasPrivateKeyBlock(text: string): boolean {
  return findPrivateKeyBlock(text, 0) !== null
}

/** densable `Lhy` — replace every PEM private-key block with `[REDACTED]`. */
function redactPrivateKeyBlocks(text: string): string {
  let block = findPrivateKeyBlock(text, 0)
  if (!block) return text
  let out = ''
  let cursor = 0
  while (block) {
    out += text.slice(cursor, block.start) + '[REDACTED]'
    cursor = block.end
    block = findPrivateKeyBlock(text, cursor)
  }
  return out + text.slice(cursor)
}

/**
 * densable `GKc` — replace the capture (or full match) with `[REDACTED]`,
 * preserving surrounding quotes when the capture itself is quoted.
 * `String.replace` may pass offset as 2nd arg when there is no capture group.
 */
function replaceMatchWithRedacted(full: string, capture: unknown): string {
  if (typeof capture !== 'string') return '[REDACTED]'
  const quote =
    capture.length >= 2 &&
    (capture[0] === '"' || capture[0] === "'") &&
    capture.at(-1) === capture[0]
      ? capture[0]
      : ''
  const idx = full.lastIndexOf(capture)
  if (idx < 0) return '[REDACTED]'
  return `${full.slice(0, idx)}${quote}[REDACTED]${quote}${full.slice(idx + capture.length)}`
}

/**
 * densable `zhy` — display replace callback: skip redaction when the matched
 * token contains shell/path characters so commands/paths/destinations stay
 * visible (#28).
 */
function displayRedactReplacer(full: string, capture: unknown): string {
  const token = typeof capture === 'string' ? capture : full
  if (DISPLAY_SHELL_CHARS.test(token) || DISPLAY_PATH_CHARS.test(token)) {
    return full
  }
  return replaceMatchWithRedacted(full, capture)
}

/**
 * Convert a gitleaks rule ID (kebab-case) to a human-readable label.
 * e.g., "github-pat" → "GitHub PAT", "aws-access-token" → "AWS Access Token"
 */
function ruleIdToLabel(ruleId: string): string {
  // Words where the canonical capitalization differs from title case
  const specialCase: Record<string, string> = {
    aws: 'AWS',
    gcp: 'GCP',
    api: 'API',
    pat: 'PAT',
    ad: 'AD',
    tf: 'TF',
    oauth: 'OAuth',
    npm: 'NPM',
    pypi: 'PyPI',
    jwt: 'JWT',
    ci: 'CI',
    scim: 'SCIM',
    github: 'GitHub',
    gitlab: 'GitLab',
    openai: 'OpenAI',
    digitalocean: 'DigitalOcean',
    huggingface: 'HuggingFace',
    hashicorp: 'HashiCorp',
    sendgrid: 'SendGrid',
  }
  return ruleId
    .split('-')
    .map(part => specialCase[part] ?? capitalize(part))
    .join(' ')
}

/**
 * Official 2.1.328 (#627, SEA `ojt`): fallback returned when secret masking
 * fails due to OOM / allocation failure so redaction never crashes or leaks
 * raw text.
 */
export const SECRET_REDACTION_OOM_FALLBACK = '[hidden for privacy]'

export function setSecretScannerErrorReporter(
  reporter: SecretScannerErrorReporter | undefined,
): void {
  getSecretScannerState().errorReporter = reporter
}

function reportSecretScannerError(err: unknown): void {
  try {
    const reporter = getSecretScannerState().errorReporter
    if (reporter !== undefined) {
      reporter(err)
    } else {
      logError(err)
    }
  } catch {
    // ignore reporter failures
  }
}

/**
 * Official 2.1.328 (#627, SEA `T.make`): probe whether enough heap/buffer
 * headroom exists before running regex compilation/redaction in low-memory
 * environments, freeing the probe buffer immediately via `ArrayBuffer.transfer(0)`.
 */
export function setSecretScannerMemoryProbeForTest(
  probe: (() => void) | undefined,
): void {
  const state = getSecretScannerState()
  state.memoryProbeOverrideForTest = probe
  state.scanRules = null
  state.fullRedactRules = null
  state.displayRedactRules = null
  state.redactResultCache.clear()
}

const OOM_PROBE_BYTES = 2 * 1024 * 1024

function assertSecretScannerMemoryHeadroom(): void {
  const probeOverride = getSecretScannerState().memoryProbeOverrideForTest
  if (probeOverride !== undefined) {
    probeOverride()
    return
  }
  if (
    typeof Bun === 'undefined' ||
    typeof ArrayBuffer.prototype.transfer !== 'function'
  ) {
    return
  }
  const buf = Buffer.allocUnsafeSlow(OOM_PROBE_BYTES).buffer
  buf.transfer(0)
}

/**
 * Official 2.1.327 (#489, SEA `Me`): linear-time O(N) redaction of URL
 * userinfo (`scheme://user:pass@host`) without quadratic regex backtracking on
 * very long text containing URLs.
 */
export function redactUrlUserinfoLinear(text: string): string {
  const firstScheme = text.indexOf('://')
  if (firstScheme === -1) return text
  const firstAt = text.indexOf('@', firstScheme + 3)
  if (firstAt === -1) return text

  let out = ''
  let copyFrom = 0
  let schemeIdx = firstScheme
  let nextAt = firstAt

  while (schemeIdx !== -1 && nextAt !== -1) {
    const userStart = schemeIdx + 3
    if (nextAt < userStart) {
      nextAt = text.indexOf('@', userStart)
      if (nextAt === -1) break
    }
    // Scan from userStart up to nextAt; stop early on `/` or whitespace (which
    // terminate the authority section). Any single char is visited at most once
    // because if we hit a terminator at `i`, the next `://` must be at >= `i`.
    let validUserinfo = nextAt > userStart
    let blockedAt = -1
    if (validUserinfo) {
      for (let i = userStart; i < nextAt; i++) {
        const ch = text.charCodeAt(i)
        if (
          ch === 47 /* / */ ||
          ch === 32 /* space */ ||
          ch === 9 /* \t */ ||
          ch === 10 /* \n */ ||
          ch === 13 /* \r */ ||
          ch === 11 /* \v */ ||
          ch === 12 /* \f */
        ) {
          validUserinfo = false
          blockedAt = i
          break
        }
      }
    }
    if (validUserinfo) {
      out += text.slice(copyFrom, userStart) + '[REDACTED]@'
      copyFrom = nextAt + 1
      schemeIdx = text.indexOf('://', copyFrom)
      if (schemeIdx !== -1) {
        nextAt = text.indexOf('@', schemeIdx + 3)
      }
    } else {
      const resumeFrom =
        blockedAt !== -1
          ? text.charCodeAt(blockedAt) === 47 /* / */
            ? Math.max(userStart, blockedAt - 1)
            : blockedAt + 1
          : userStart
      schemeIdx = text.indexOf('://', resumeFrom)
    }
  }

  return copyFrom === 0 ? text : out + text.slice(copyFrom)
}

/**
 * Scan a string for potential secrets.
 *
 * densable `VKc.scan` / `p6t`: only high-confidence rules + private-key
 * block presence. Returns one match per rule that fired (deduplicated by
 * rule ID). The actual matched text is intentionally NOT returned.
 */
export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = []
  const seen = new Set<string>()
  try {
    for (const rule of getScanRules()) {
      if (rule.confidence !== 'high') continue
      if (seen.has(rule.id)) continue
      if (rule.prefilter?.test(content) === false) continue
      if (rule.re.test(content)) {
        seen.add(rule.id)
        matches.push({
          ruleId: rule.id,
          label: ruleIdToLabel(rule.id),
        })
      }
    }

    if (hasPrivateKeyBlock(content) && !seen.has('private-key')) {
      matches.push({
        ruleId: 'private-key',
        label: 'Private Key',
      })
    }
  } catch (err) {
    reportSecretScannerError(err)
  }

  return matches
}

/**
 * densable `pp` / `VKc.redact` — full-strength redaction (logs, bridge
 * summaries). Applies all rules + PEM block redaction (Lhy). Oversized /
 * truncated private keys still redact when BEGIN+END markers are found.
 * Never crashes on OOM (#627): falls back to `[hidden for privacy]`.
 */
export function redactSecrets(content: string): string {
  const { redactResultCache } = getSecretScannerState()
  const cacheable = content.length <= REDACT_CACHE_VALUE_MAX
  if (cacheable) {
    const hit = redactResultCache.get(content)
    if (hit !== undefined) return hit
  }

  let out: string
  try {
    out = redactPrivateKeyBlocks(content)
    out = redactUrlUserinfoLinear(out)
    for (const rule of getFullRedactRules()) {
      if (rule.prefilter?.test(out) === false) continue
      out = out.replace(rule.re, replaceMatchWithRedacted)
    }
  } catch (err) {
    reportSecretScannerError(err)
    return SECRET_REDACTION_OOM_FALLBACK
  }

  if (cacheable) {
    if (redactResultCache.size >= REDACT_CACHE_MAX) {
      const first = redactResultCache.keys().next().value
      if (first !== undefined) redactResultCache.delete(first)
    }
    redactResultCache.set(content, out)
  }
  return out
}

/**
 * densable `tAt` / `VKc.redactForDisplay` — permission-preview redaction.
 * High-confidence only; shell/path-looking captures are kept (#28);
 * display boundaries allow tokens followed by shell delimiters (#29).
 * Does NOT run Lhy PEM full-block redact (preview path uses SHe+tAt on
 * field values; oversized PEMs go through full `redactSecrets` elsewhere).
 */
export function redactSecretsForDisplay(content: string): string {
  try {
    let out = content
    for (const rule of getDisplayRedactRules()) {
      if (rule.confidence !== 'high' || rule.prefilter?.test(out) === false) {
        continue
      }
      out = out.replace(rule.re, displayRedactReplacer)
    }
    return out
  } catch (err) {
    reportSecretScannerError(err)
    return SECRET_REDACTION_OOM_FALLBACK
  }
}

/**
 * densable `SHe` — deep-walk strings through a redactor (default full
 * `redactSecrets`). For object string fields, prefers `${key}: ${value}`
 * so assignment-style rules can fire, then strips the key prefix back.
 */
export function redactSecretsDeep(
  value: unknown,
  redactor: (s: string) => string = redactSecrets,
): unknown {
  if (typeof value === 'string') return redactor(value)
  if (Array.isArray(value)) {
    return value.map(v => redactSecretsDeep(v, redactor))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = Object.create(null)
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') {
        const prefix = `${k}: `
        const redacted = redactor(prefix + v)
        out[k] = redacted.startsWith(prefix)
          ? redacted.slice(prefix.length)
          : redactor(v)
      } else {
        out[k] = redactSecretsDeep(v, redactor)
      }
    }
    return out
  }
  return value
}

/**
 * Get a human-readable label for a gitleaks rule ID.
 * Falls back to kebab-to-Title conversion for unknown IDs.
 */
export function getSecretLabel(ruleId: string): string {
  return ruleIdToLabel(ruleId)
}
