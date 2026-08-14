/**
 * PowerShell Common Parameters (available on all cmdlets via [CmdletBinding()]).
 * Source: about_CommonParameters (PowerShell docs) + Get-Command output.
 *
 * Shared between pathValidation.ts (merges into per-cmdlet known-param sets)
 * and readOnlyValidation.ts (merges into safeFlags check). Split out to break
 * what would otherwise be an import cycle between those two files.
 *
 * Stored lowercase with leading dash — callers `.toLowerCase()` their input.
 *
 * densable 2.1.232 #13 — `Loi`/`Jka`/`CUp`/`Cer`: variable-writing common
 * parameters can target preference vars (esp. PSDefaultParameterValues) and
 * must not silently pass as read-only.
 */

export const COMMON_SWITCHES = ['-verbose', '-debug']

/** densable `vNn` — action common parameters (value). */
export const COMMON_ACTION_VALUE_PARAMS = [
  '-erroraction',
  '-warningaction',
  '-informationaction',
  '-progressaction',
]

/**
 * densable `Loi` — common parameters that write into a named variable.
 * These can poison session state when the target is a preference var.
 */
export const VARIABLE_WRITING_COMMON_PARAMS = [
  '-errorvariable',
  '-warningvariable',
  '-informationvariable',
  '-outvariable',
  '-pipelinevariable',
] as const

/** densable `Jka` — short aliases for `Loi`. */
export const VARIABLE_WRITING_SHORT_ALIASES = [
  '-ev',
  '-wv',
  '-iv',
  '-ov',
  '-pv',
] as const

/**
 * densable `Xav` — other cmdlet params that take a variable name (not
 * always common-params, but Cer full-mode also matches endsWith("variable")
 * / prefix of these).
 */
const OTHER_VARIABLE_NAME_PARAMS = [
  '-variable',
  '-sessionvariable',
  '-responseheadersvariable',
  '-statuscodevariable',
] as const

export const COMMON_VALUE_PARAMS = [
  ...COMMON_ACTION_VALUE_PARAMS,
  ...VARIABLE_WRITING_COMMON_PARAMS,
  '-outbuffer',
]

export const COMMON_PARAMETERS: ReadonlySet<string> = new Set([
  ...COMMON_SWITCHES,
  ...COMMON_VALUE_PARAMS,
])

/**
 * densable `CUp` — preference / automatic variables that alter subsequent
 * cmdlet behavior when written via -OutVariable / -ErrorVariable / etc.
 */
export const PREFERENCE_VARIABLE_NAMES: ReadonlySet<string> = new Set([
  'psdefaultparametervalues',
  'confirmpreference',
  'debugpreference',
  'erroractionpreference',
  'errorview',
  'formatenumerationlimit',
  'informationpreference',
  'maximumhistorycount',
  'ofs',
  'outputencoding',
  'progresspreference',
  'psemailserver',
  'psmoduleautoloadingpreference',
  'psnativecommandargumentpassing',
  'psnativecommanduseerroractionpreference',
  'pssessionapplicationname',
  'pssessionconfigurationname',
  'pssessionoption',
  'psstyle',
  'transcript',
  'verbosepreference',
  'warningpreference',
  'whatifpreference',
  'logcommandhealthevent',
  'logcommandlifecycleevent',
  'logenginehealthevent',
  'logenginelifecycleevent',
  'logproviderhealthevent',
  'logproviderlifecycleevent',
  'maximumaliascount',
  'maximumdrivecount',
  'maximumerrorcount',
  'maximumfunctioncount',
  'maximumvariablecount',
])

/** densable `xUp` — scopes allowed before `:` in variable targets. */
const VARIABLE_SCOPES: ReadonlySet<string> = new Set([
  'global',
  'script',
  'local',
  'private',
  'variable',
])

/** densable `Foe` — parameter prefix characters (ASCII + PS alt dashes). */
const PS_PARAM_PREFIXES = new Set([
  '-',
  '/',
  '–', // en-dash
  '—', // em-dash
  '―', // horizontal bar
])

/**
 * densable `SNn` — strip internal hyphens/apostrophes for param matching
 * (`-Error-Variable` → `-errorvariable`). Keep leading dash.
 */
function normalizeParamName(param: string, exact = false): string {
  if (exact && param.length > 1 && param[1] === '-') {
    return param
  }
  return param.replace(/(?!^)[-']/g, '')
}

/**
 * densable `kUp` (full) / `IUp` (exact via HUp) — is this a variable-writing
 * common parameter name (lowercase, leading dash)?
 */
export function isVariableWritingCommonParam(
  paramLower: string,
  mode: 'full' | 'exact' = 'full',
): boolean {
  if (paramLower.length < 2) {
    return false
  }
  if (
    (VARIABLE_WRITING_SHORT_ALIASES as readonly string[]).includes(paramLower)
  ) {
    return true
  }
  if (mode === 'exact') {
    return (VARIABLE_WRITING_COMMON_PARAMS as readonly string[]).includes(
      paramLower,
    )
  }
  // full: prefix match on Loi + densable full-mode extras
  if (
    (VARIABLE_WRITING_COMMON_PARAMS as readonly string[]).some(p =>
      p.startsWith(paramLower),
    )
  ) {
    return true
  }
  if (paramLower.endsWith('variable')) {
    return true
  }
  // densable `MUp`: prefix of Xav when length >= 3
  if (paramLower.length >= 3) {
    return (OTHER_VARIABLE_NAME_PARAMS as readonly string[]).some(t =>
      t.startsWith(paramLower),
    )
  }
  return false
}

function stripOuterQuotes(value: string): string {
  const t = value.trim()
  if (t.length >= 2) {
    const a = t[0]!
    const b = t[t.length - 1]!
    if (
      (a === "'" && b === "'") ||
      (a === '"' && b === '"') ||
      (a === '`' && b === '`')
    ) {
      return t.slice(1, -1)
    }
  }
  return t
}

/**
 * densable `Cer(args, elementTypes, mode)` — true if dangerous:
 * a variable-writing common parameter targets a preference var (`CUp`),
 * an invalid identifier/scope, or a dynamic (`$`/`\``) target.
 *
 * Used by read-only validation so
 * `Get-Content x -OutVariable PSDefaultParameterValues` is not auto-allow.
 */
export function hasDangerousVariableWriteCommonParam(
  args: readonly string[],
  elementTypes?: readonly string[],
  mode: 'full' | 'exact' = 'full',
): boolean {
  const isVarParam = (name: string): boolean => {
    if (isVariableWritingCommonParam(name, mode)) {
      return true
    }
    const stripped = normalizeParamName(name, mode === 'exact')
    return stripped !== name && isVariableWritingCommonParam(stripped, mode)
  }

  for (let i = 0; i < args.length; i++) {
    const s = args[i]
    if (!s || s.length === 0 || !PS_PARAM_PREFIXES.has(s[0]!)) {
      continue
    }
    // densable: skip when elementTypes ground truth says not Parameter
    if (
      elementTypes !== undefined &&
      elementTypes[i + 1] !== undefined &&
      elementTypes[i + 1] !== 'Parameter'
    ) {
      continue
    }

    const normalized = s[0] === '-' ? s : `-${s.slice(1)}`
    const colonIdx = normalized.indexOf(':', 1)
    const paramPart = (
      colonIdx > 0 ? normalized.slice(0, colonIdx) : normalized
    ).toLowerCase()

    if (!isVarParam(paramPart)) {
      // densable also re-checks after stripping backtick line continuations
      // and returns true on non-ASCII param names that might be obfuscation.
      const decont = paramPart.replace(/`[\r\n]+\s*/g, '')
      if (decont !== paramPart && isVarParam(decont)) {
        // fall through with decont as matched
      } else if (/[^\x20-\x7e]/.test(paramPart)) {
        return true
      } else {
        continue
      }
    }

    let rawValue: string
    if (colonIdx > 0) {
      const post = normalized.slice(colonIdx + 1)
      // densable: here-string / $ / ` in colon value → dangerous
      if (/^@['"‘-‟]/.test(post)) {
        return true
      }
      if (post.includes('$') || post.includes('`')) {
        return true
      }
      rawValue = post
    } else {
      rawValue = args[i + 1] ?? ''
      if (rawValue.includes('$') || rawValue.includes('`')) {
        return true
      }
    }

    let d = stripOuterQuotes(rawValue).toLowerCase().trim()
    // densable s5/Mde-style: also strip remaining surrounding quotes
    d = stripOuterQuotes(d).toLowerCase().trim()
    if (d.length === 0) {
      continue
    }

    // +Name append form
    const p = d.startsWith('+') ? d.slice(1) : d
    let name = p
    const scopeSep = p.lastIndexOf(':')
    if (scopeSep >= 0) {
      const scope = p.slice(0, scopeSep)
      if (!VARIABLE_SCOPES.has(scope) && !/^[0-9]+$/.test(scope)) {
        return true
      }
      name = p.slice(scopeSep + 1)
    }

    if (!/^[a-z0-9_]+$/.test(name)) {
      return true
    }
    if (PREFERENCE_VARIABLE_NAMES.has(name)) {
      return true
    }
  }
  return false
}
