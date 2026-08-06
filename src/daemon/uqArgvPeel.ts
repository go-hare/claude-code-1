/**
 * densable 2.1.212 Uq_ argv peel helpers (Qyr / r2o / WLp / t6_ / yie / IUe /
 * n2o / GLp / VLp / qat / e6_ flag sets).
 *
 * extract: docs/upstream-extraction/v2.1.212/Uq_.raw.js
 *          docs/upstream-extraction/v2.1.212/Uq_helpers.raw.js
 *          docs/upstream-extraction/v2.1.212/Uq_peel_more.raw.js
 */

/** densable Hne — flags that take a value */
export const VALUE_FLAGS = new Set([
  '--exec',
  '--model',
  '-m',
  '--permission-mode',
  '--agent',
  '--agents',
  '--routine',
  '--effort',
  '--add-dir',
  '--mcp-config',
  '--settings',
  '--setting-sources',
  '--system-prompt',
  '--system-prompt-file',
  '--append-system-prompt',
  '--append-system-prompt-file',
  '--append-subagent-system-prompt',
  '--fallback-model',
  '--advisor',
  '--channels',
  '--permission-prompt-tool',
  '--allowed-tools',
  '--allowedTools',
  '--disallowed-tools',
  '--disallowedTools',
  '--tools',
  '--session-id',
  '--debug-file',
  '-n',
  '--name',
  '--autocompact',
  '--betas',
  '--file',
  '--max-budget-usd',
  '--max-thinking-tokens',
  '--max-turns',
  '--task-budget',
  '--plan-mode-instructions',
  '--plugin-dir',
  '--plugin-dir-no-mcp',
  '--plugin-url',
  '--resume-session-at',
  '--rewind-files',
  '--thinking',
  '--thinking-display',
  '--remote-control-session-name-prefix',
  '--json-schema',
])

/** densable zRt — value flags that consume multiple consecutive non-flag tokens */
export const MULTI_VALUE_FLAGS = new Set([
  '--allowed-tools',
  '--allowedTools',
  '--disallowed-tools',
  '--disallowedTools',
  '--tools',
  '--mcp-config',
  '--betas',
  '--add-dir',
  '--file',
  '--channels',
])

/** densable $Yr — boolean long flags (no value) */
export const BOOL_FLAGS = new Set([
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--strict-mcp-config',
  '--dangerously-allow-browser-network-access',
  '--disable-slash-commands',
  '--verbose',
  '--reply-on-resume',
  '--ide',
  '--chrome',
  '--no-chrome',
  '--bare',
  '--brief',
  '--remote-control',
  '--rc',
])

/** densable jfo — short flags peelable from combined `-xyz` */
export const SHORT_PEEL_FLAGS = new Set(['-c', '-p', '-h', '-v'])

/** densable tke */
export function isFlagToken(e: string): boolean {
  return e.length > 1 && e.startsWith('-')
}

/**
 * densable IUe — peel leading known short flags from combined token.
 * e.g. `-cp` → peeled `[-c]`, rest `-p`
 */
export function peelShortFlags(e: string): { peeled: string[]; rest: string } {
  const peeled: string[] = []
  let rest = e
  while (/^-[a-zA-Z]./.test(rest) && SHORT_PEEL_FLAGS.has(rest.slice(0, 2))) {
    peeled.push(rest.slice(0, 2))
    rest = `-${rest.slice(2)}`
  }
  return { peeled, rest }
}

/**
 * densable yie — indices of flag values (not flags themselves).
 * Marks next token(s) after value-taking flags; multi-value flags keep eating.
 */
export function valueIndexSet(e: readonly string[]): Set<number> {
  const t = new Set<number>()
  for (let r = 0; r < e.length; r++) {
    if (t.has(r)) continue
    const n = e[r]!
    if (n === '--') break
    const { rest: o } = peelShortFlags(n)
    if (n === '--resume' || o === '-r') continue
    if (
      (n === '--remote-control' || n === '--rc') &&
      e[r + 1] !== undefined &&
      !(e[r + 1]!.length > 1 && e[r + 1]!.startsWith('-'))
    ) {
      t.add(r + 1)
      continue
    }
    if (!o.includes('=') && VALUE_FLAGS.has(o) && e[r + 1] !== undefined) {
      t.add(r + 1)
      if (MULTI_VALUE_FLAGS.has(o)) {
        let i = r + 2
        while (
          e[i] !== undefined &&
          !(e[i]!.length > 1 && e[i]!.startsWith('-'))
        ) {
          t.add(i)
          i++
        }
      }
    }
  }
  return t
}

/** densable Qyr — index of first non-value `--` separator, else -1 */
export function doubleDashIndex(e: readonly string[]): number {
  const t = valueIndexSet(e)
  for (let r = 0; r < e.length; r++) {
    if (e[r] === '--' && !t.has(r)) return r
  }
  return -1
}

/**
 * densable r2o — read long flag value (and optional short alias).
 * Supports `--flag=v`, `--flag v`, `-nV`, peeled short.
 */
export function readFlagValue(
  e: readonly string[],
  long: string,
  short?: string,
): string | undefined {
  const n = valueIndexSet(e)
  let o: string | undefined
  for (let i = 0; i < e.length; i++) {
    if (n.has(i)) continue
    const s = e[i]!
    if (s === '--') break
    if (s === long || (short !== undefined && s === short)) {
      if (e[i + 1] !== undefined) {
        o = e[i + 1]
        i++
      }
      continue
    }
    if (s.startsWith(`${long}=`)) {
      o = s.slice(long.length + 1)
      continue
    }
    if (short !== undefined) {
      const { peeled: a, rest: l } = peelShortFlags(s)
      if (l.length > 2 && l.slice(0, 2) === short) {
        o = l.slice(2)
        continue
      }
      if (a.length > 0 && l === short && e[i + 1] !== undefined) {
        o = e[i + 1]
        i++
      }
    }
  }
  return o
}

/**
 * densable WLp — resume session id from `--resume` / `-r` / `--resume=`.
 */
export function readResumeSessionId(e: readonly string[]): string | undefined {
  const t = valueIndexSet(e)
  let r: string | undefined
  for (let n = 0; n < e.length; n++) {
    if (t.has(n)) continue
    const o = e[n]!
    if (o === '--') break
    if (o.startsWith('--resume=')) {
      r = o.slice(9) || undefined
      continue
    }
    const { rest: i } = peelShortFlags(o)
    if (/^-r./.test(i)) {
      r = i.slice(2)
      continue
    }
    if (o === '--resume' || i === '-r') {
      const s = e[n + 1]
      if (s !== undefined && !isFlagToken(s)) {
        r = s
        n++
      } else {
        r = undefined
      }
    }
  }
  return r
}

/**
 * densable t6_ — last non-flag positional as prompt intent (excluding resume id).
 * densable skips value tokens via yie; skips resume pair.
 */
export function extractPositionalIntent(
  e: readonly string[],
  resumeId: string | undefined,
): string | undefined {
  const r = valueIndexSet(e)
  let n: string | undefined
  for (let o = 0; o < e.length; o++) {
    if (r.has(o)) continue
    const i = e[o]!
    if (isFlagToken(i)) {
      const { rest: s } = peelShortFlags(i)
      if (
        (i === '--resume' || s === '-r') &&
        e[o + 1] !== undefined &&
        !isFlagToken(e[o + 1]!)
      ) {
        o++
      }
      continue
    }
    if (i.length > 0 && i !== resumeId) n = i
  }
  return n
}

/**
 * densable n2o — strip resume/continue/session-id/fork-session for respawnFlags
 * (keep other flags + `--` tail).
 */
export function peelRespawnFlags(e: readonly string[]): string[] {
  const t = valueIndexSet(e)
  const r: string[] = []
  for (let n = 0; n < e.length; n++) {
    const o = e[n]!
    if (t.has(n)) {
      r.push(o)
      continue
    }
    if (o === '--') {
      for (let a = n; a < e.length; a++) r.push(e[a]!)
      break
    }
    if (
      o === '--fork-session' ||
      o === '--continue' ||
      o.startsWith('--resume=') ||
      o.startsWith('--session-id=')
    ) {
      continue
    }
    const { peeled: i, rest: s } = peelShortFlags(o)
    if (i.length > 0 || s === '-c' || s.startsWith('-r')) {
      const a = i.filter(d => d !== '-c').map(d => d[1]!)
      const l = s === '-c' || /^-r./.test(s)
      const c = s === '-r'
      const u = l || c ? '' : s.slice(1)
      if (a.length > 0 || u) r.push(`-${a.join('')}${u}`)
      if (c && e[n + 1] !== undefined && !isFlagToken(e[n + 1]!)) n++
      continue
    }
    if (o === '--session-id') {
      if (e[n + 1] !== undefined) n++
      continue
    }
    if (o === '--resume') {
      if (e[n + 1] !== undefined && !isFlagToken(e[n + 1]!)) n++
      continue
    }
    r.push(o)
  }
  return r
}

/**
 * densable GLp — strip `--session-id` / `--session-id=` from argv for prompt
 * launch args (keep values of other flags).
 */
export function stripSessionIdFlags(e: readonly string[]): string[] {
  const t = valueIndexSet(e)
  const r: string[] = []
  for (let n = 0; n < e.length; n++) {
    const o = e[n]!
    if (t.has(n)) {
      r.push(o)
      continue
    }
    if (o === '--') {
      for (let i = n; i < e.length; i++) r.push(e[i]!)
      break
    }
    if (o.startsWith('--session-id=')) continue
    if (o === '--session-id') {
      if (e[n + 1] !== undefined) n++
      continue
    }
    r.push(o)
  }
  return r
}

/**
 * densable VLp — keep only flag tokens (+ their values) for respawn allowlist
 * input (drop bare positionals).
 */
export function flagsOnlyArgv(e: readonly string[]): string[] {
  const t = valueIndexSet(e)
  const r: string[] = []
  for (let n = 0; n < e.length; n++) {
    const o = e[n]!
    if (t.has(n)) {
      r.push(o)
      continue
    }
    if (!isFlagToken(o)) continue
    if (o.includes('=')) {
      r.push(o)
      continue
    }
    const { rest: i } = peelShortFlags(o)
    if (VALUE_FLAGS.has(i)) {
      r.push(o)
      continue
    }
    if (BOOL_FLAGS.has(o)) {
      r.push(o)
      continue
    }
    const s = e[n + 1]
    if (s !== undefined && !isFlagToken(s) && !t.has(n + 1)) {
      n++
      continue
    }
    r.push(o)
  }
  return r
}

/**
 * densable qat — allowlist filter for persisted respawnFlags.
 * Drops non-allowlisted tokens (logs would warn in densable).
 */
export function filterAllowlistedRespawnFlags(e: readonly string[]): string[] {
  const t: string[] = []
  const r: string[] = []
  for (let n = 0; n < e.length; n++) {
    const o = e[n]!
    if (!o.startsWith('-')) {
      r.push(o)
      continue
    }
    const i = o.indexOf('=')
    const s = i === -1 ? o : o.slice(0, i)
    if (i !== -1 && !VALUE_FLAGS.has(s) && BOOL_FLAGS.has(s)) {
      // densable: malformed bool=value → still push to allow? it pushes to t
      t.push(s)
      r.push(o)
      continue
    }
    const a = i === -1 && VALUE_FLAGS.has(s)
    const l =
      i === -1
        ? BOOL_FLAGS.has(s) || (a && e[n + 1] !== undefined)
        : VALUE_FLAGS.has(s)
    const c = l ? t : r
    c.push(o)
    if (a && e[n + 1] !== undefined) c.push(e[++n]!)
    if (!l || (a && MULTI_VALUE_FLAGS.has(s))) {
      while (e[n + 1] !== undefined && !e[n + 1]!.startsWith('-')) {
        c.push(e[++n]!)
      }
    }
  }
  // densable xny(t) — return allowlisted only (drop r)
  return t
}

/** densable nPs — cloud/remote backends conflict with --bg */
export function hasCloudRemoteFlags(e: readonly string[]): boolean {
  return e.some(
    t =>
      t === '--cloud' ||
      t.startsWith('--cloud=') ||
      t === '--remote' ||
      t.startsWith('--remote='),
  )
}

export const CLOUD_BG_CONFLICT =
  "--bg and --cloud are different backends. Use `claude --cloud '<task>'` directly to start a cloud session."

/**
 * densable Xve subset — UNC / network path detection for shell warn.
 * Full densable realpath walk not required for peel ceremony.
 */
export function isUncLikePath(p: string | undefined | null): boolean {
  if (!p) return false
  if (/^\\\\\?\\unc\\/i.test(p)) return true
  if (/^\\\\\?\\volume\{/i.test(p)) return true
  // \\server\share
  if (/^\\\\[^?\\]/.test(p)) return true
  // //server/share
  if (/^\/\/[^/]/.test(p)) return true
  return false
}

export type UqPeeledArgv = {
  /** head before `--` */
  head: string[]
  /** index of `--` or -1 */
  dd: number
  agent?: string
  name?: string
  /** densable WLp resume id */
  resumeSessionId?: string
  /** densable t6_ / after `--` joined */
  intent?: string
  /** densable S — has continue/resume */
  hasResumeOrContinue: boolean
  /** densable E — has --fork-session */
  hasForkSession: boolean
  /** densable n2o respawn flags (pre-qat) */
  respawnFlags: string[]
  /** densable qat(u>=0?w:VLp(w)) */
  allowlistedRespawnFlags: string[]
  /** densable GLp for prompt launch args */
  promptArgs: string[]
  /** shell had explicit --session-id */
  hadSessionIdFlag: boolean
  /** value-index set on head */
  valueIdx: Set<number>
}

/**
 * densable Uq_ argv peel core (no I/O).
 * `e` = full argv after stripBgFlags.
 */
export function peelUqArgv(e: readonly string[]): UqPeeledArgv {
  const u = doubleDashIndex(e)
  const d = u >= 0 ? e.slice(0, u) : [...e]
  const p = readFlagValue(d, '--agent')
  const m = readFlagValue(d, '--name', '-n')
  const y = readResumeSessionId(d)
  const intent =
    u >= 0
      ? e
          .slice(u + 1)
          .join(' ')
          .trim() || undefined
      : extractPositionalIntent(e, y)
  const v = valueIndexSet(d)
  const S = d.some((ae, se) => {
    if (v.has(se)) return false
    if (
      ae === '--continue' ||
      ae === '--resume' ||
      ae.startsWith('--resume=')
    ) {
      return true
    }
    const { peeled: oe, rest: re } = peelShortFlags(ae)
    return oe.includes('-c') || re === '-c' || re === '-r' || /^-r./.test(re)
  })
  const E = d.some((ae, se) => !v.has(se) && ae === '--fork-session')
  const w = peelRespawnFlags(d)
  const D = filterAllowlistedRespawnFlags(u >= 0 ? w : flagsOnlyArgv(w))
  const promptArgs = stripSessionIdFlags(e)
  const hadSessionIdFlag = d.some(
    (ae, se) =>
      !v.has(se) && (ae === '--session-id' || ae.startsWith('--session-id=')),
  )
  return {
    head: d,
    dd: u,
    agent: p,
    name: m,
    resumeSessionId: y,
    intent,
    hasResumeOrContinue: S,
    hasForkSession: E,
    respawnFlags: w,
    allowlistedRespawnFlags: D,
    promptArgs,
    hadSessionIdFlag,
    valueIdx: v,
  }
}

/** densable shell UNC warn list from peeled + cwd/exec/resume. */
export function collectUncWarnPaths(input: {
  cwd?: string
  exec?: string
  resumeSessionId?: string
  respawnFlags: readonly string[]
}): string[] {
  const oe: string[] = []
  for (const token of input.respawnFlags) {
    if (isUncLikePath(token)) {
      oe.push(token)
      continue
    }
    const eq = token.indexOf('=')
    if (eq > 0 && isUncLikePath(token.slice(eq + 1))) oe.push(token)
  }
  if (isUncLikePath(input.cwd)) oe.push(input.cwd!)
  if (input.exec && isUncLikePath(input.exec)) oe.push(input.exec)
  if (input.resumeSessionId && isUncLikePath(input.resumeSessionId)) {
    oe.push(input.resumeSessionId)
  }
  return oe
}
