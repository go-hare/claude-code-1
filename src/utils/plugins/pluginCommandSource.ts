/**
 * densable 2.1.229 #4 — plugin marketplace `source: "command"` (+ `mode: "link"|"copy"`).
 *
 * SEA symbols (product core):
 * - `dFe` / `d0t` — type guards for command source / link mode
 * - `c6_` — run command → single absolute plugin directory
 * - `bxd` — shell spawn with timeout + stdout/stderr byte caps
 * - `HK` / `cTn` — consent key + mode description
 * - `_le` / `dxe` / `hkr` — managed policy + Windows link ban
 * - `mkr` — plugin-shaped root markers (same as archive Lad)
 *
 * Full install path (`Oxd` copy/link into cache, `ptm` interactive consent,
 * producer-dir deny list) is wired separately; this module is the densable gold
 * surface that schema + install can call without inventing behavior.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { readdir, readlink, realpath, stat } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { getPlatform } from '../platform.js'
import { denyCommandProducerDir } from './commandProducerDirs.js'
import { getSettingsForSource } from '../settings/settings.js'
import { truncate } from '../truncate.js'

/** densable s6_ — default command timeout seconds */
export const PLUGIN_COMMAND_SOURCE_DEFAULT_TIMEOUT_S = 60

/** densable Txd / a6_ — stdout/stderr byte caps */
export const PLUGIN_COMMAND_SOURCE_MAX_STDOUT_BYTES = 65_536
export const PLUGIN_COMMAND_SOURCE_MAX_STDERR_BYTES = 65_536

/** densable wxd — stderr clip for error messages */
const STDERR_CLIP = 500

/** densable L$o — consent key suffix for link mode */
export const PLUGIN_COMMAND_LINK_CONSENT_SUFFIX = '\n[mode: link]'

/**
 * densable dxe — managed policy blocks command-sourced plugins.
 */
export const COMMAND_PLUGIN_SOURCES_DISABLED_MESSAGE =
  "Command-sourced plugins are disabled by your organization's managed settings (disableCommandPluginSources / allowManagedHooksOnly). The plugin was not installed or updated and its command was not run."

/**
 * densable hkr — link mode unsupported on Windows.
 */
export const COMMAND_PLUGIN_LINK_MODE_WINDOWS_MESSAGE =
  'This plugin source uses mode "link", which is not supported on Windows yet; the marketplace can use mode "copy" instead.'

/**
 * densable mkr / Lad — top-level names that make a directory plugin-shaped.
 */
export const PLUGIN_COMMAND_SOURCE_ROOT_MARKERS = [
  '.claude-plugin',
  'commands',
  'skills',
  'agents',
  'hooks',
  'themes',
  'output-styles',
  'monitors',
  'workflows',
  'SKILL.md',
  '.mcp.json',
  '.lsp.json',
] as const

const ROOT_MARKER_SET = new Set<string>(PLUGIN_COMMAND_SOURCE_ROOT_MARKERS)

/** densable command plugin source object */
export type CommandPluginSource = {
  source: 'command'
  command: string
  /** densable default is copy when omitted */
  mode?: 'copy' | 'link'
  /** seconds; densable s6_=60 */
  timeout?: number
}

export type PluginCommandSpawnKind =
  | { kind: 'exited'; exitCode: number; stdout: string; stderr: string }
  | { kind: 'timed-out'; stdout: string; stderr: string }
  | { kind: 'stdout-overflow'; stdout: string; stderr: string }
  | { kind: 'signaled'; signal: string; stdout: string; stderr: string }
  | { kind: 'spawn-error'; message: string; stdout: string; stderr: string }

/**
 * densable dTe — typed error carrying short densable reason codes.
 */
export class PluginCommandSourceError extends Error {
  readonly reason: string

  constructor(message: string, reason: string) {
    super(message)
    this.name = 'PluginCommandSourceError'
    this.reason = reason
  }
}

/** densable dFe */
export function isCommandPluginSource(
  source: unknown,
): source is CommandPluginSource {
  return (
    typeof source === 'object' &&
    source !== null &&
    (source as { source?: unknown }).source === 'command'
  )
}

/** densable d0t */
export function isCommandPluginLinkMode(source: unknown): boolean {
  return isCommandPluginSource(source) && source.mode === 'link'
}

/**
 * densable HK — consent key includes link-mode suffix when mode is link.
 */
export function commandPluginConsentKey(source: CommandPluginSource): string {
  return source.mode === 'link'
    ? `${source.command}${PLUGIN_COMMAND_LINK_CONSENT_SUFFIX}`
    : source.command
}

/** densable cTn */
export function describeCommandPluginMode(source: CommandPluginSource): string {
  return source.mode === 'link'
    ? 'mode "link": its output directory is used in place (linked, not copied)'
    : 'mode "copy": its output directory is copied into the plugin cache'
}

/**
 * densable _le — policySettings.disableCommandPluginSources, else
 * allowManagedHooksOnly.
 */
export function areCommandPluginSourcesDisabledByPolicy(): boolean {
  const policy = getSettingsForSource('policySettings') as
    | {
        disableCommandPluginSources?: boolean
        allowManagedHooksOnly?: boolean
      }
    | null
    | undefined
  if (policy?.disableCommandPluginSources !== undefined) {
    return policy.disableCommandPluginSources === true
  }
  return policy?.allowManagedHooksOnly === true
}

/** densable GCe-ish: UNC / device path not usable as plugin dir on Windows */
export function isWindowsUncOrDevicePath(p: string): boolean {
  return p.startsWith('\\\\') || p.startsWith('//') || /^[\\/]\?\?[\\/]/.test(p)
}

function clipForError(text: string, max: number): string {
  if (text.length <= max) return text
  return truncate(text, max)
}

/**
 * densable bxd — shell spawn with timeout + stdout byte cap.
 * Uses shell:true so marketplace commands can be full shell lines (densable).
 */
export function spawnPluginCommand(
  command: string,
  options: {
    cwd: string
    env?: NodeJS.ProcessEnv
    timeoutMs: number
    maxStdoutBytes: number
    maxStderrBytes: number
  },
): Promise<PluginCommandSpawnKind> {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let overflowOrTimeout: 'timed-out' | 'stdout-overflow' | undefined
    let killGraceTimer: ReturnType<typeof setTimeout> | undefined

    // stdin ignored → ChildProcessByStdio<null, Readable, Readable>; treat as
    // without-null-streams for the pipe handles we actually use.
    const child = spawn(command, [], {
      shell: true,
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: getPlatform() !== 'windows',
      windowsHide: true,
    }) as unknown as ChildProcessWithoutNullStreams

    const finish = (result: PluginCommandSpawnKind): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killGraceTimer) clearTimeout(killGraceTimer)
      child.stdout.removeAllListeners('data')
      child.stderr.removeAllListeners('data')
      try {
        child.stdout.destroy()
        child.stderr.destroy()
      } catch {
        // ignore
      }
      resolve(result)
    }

    const requestKill = (kind: 'timed-out' | 'stdout-overflow'): void => {
      if (overflowOrTimeout) return
      overflowOrTimeout = kind
      const pid = child.pid
      try {
        if (pid !== undefined) {
          if (getPlatform() === 'windows') {
            child.kill()
          } else {
            process.kill(-pid, 'SIGKILL')
          }
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
      // densable yxd=2000 grace then force-resolve
      killGraceTimer = setTimeout(() => {
        finish({ kind, stdout, stderr })
      }, 2000)
      if (typeof killGraceTimer === 'object' && 'unref' in killGraceTimer) {
        killGraceTimer.unref()
      }
    }

    const timer = setTimeout(() => {
      requestKill('timed-out')
    }, options.timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk)
      if (stdoutBytes > options.maxStdoutBytes) {
        requestKill('stdout-overflow')
        return
      }
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      if (stderrBytes >= options.maxStderrBytes) return
      stderrBytes += Buffer.byteLength(chunk)
      stderr += chunk
    })
    child.once('error', (err: Error) => {
      finish({
        kind: 'spawn-error',
        message: err.message,
        stdout,
        stderr,
      })
    })

    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (overflowOrTimeout) {
        finish({ kind: overflowOrTimeout, stdout, stderr })
        return
      }
      if (typeof code === 'number') {
        finish({ kind: 'exited', exitCode: code, stdout, stderr })
        return
      }
      finish({
        kind: 'signaled',
        signal: signal ?? 'unknown',
        stdout,
        stderr,
      })
    }
    child.once('close', onExit)
  })
}

/**
 * densable c6_ — run marketplace command; return realpath of plugin directory.
 */
export async function runPluginCommandSource(
  source: CommandPluginSource,
): Promise<string> {
  if (areCommandPluginSourcesDisabledByPolicy()) {
    throw new PluginCommandSourceError(
      COMMAND_PLUGIN_SOURCES_DISABLED_MESSAGE,
      'plugin command source disabled by managed policy',
    )
  }
  if (source.mode === 'link' && getPlatform() === 'windows') {
    throw new PluginCommandSourceError(
      COMMAND_PLUGIN_LINK_MODE_WINDOWS_MESSAGE,
      'plugin command source link mode unsupported on windows',
    )
  }

  const timeoutMs =
    (source.timeout ?? PLUGIN_COMMAND_SOURCE_DEFAULT_TIMEOUT_S) * 1000
  const cmdDisplay = clipForError(source.command, 200)
  logForDebugging(
    `Plugin command source: running \`${cmdDisplay}\` (timeout ${timeoutMs}ms)`,
  )

  const result = await spawnPluginCommand(source.command, {
    cwd: homedir(),
    env: process.env,
    timeoutMs,
    maxStdoutBytes: PLUGIN_COMMAND_SOURCE_MAX_STDOUT_BYTES,
    maxStderrBytes: PLUGIN_COMMAND_SOURCE_MAX_STDERR_BYTES,
  })

  const stderrClip = clipForError(result.stderr.trim(), STDERR_CLIP)
  const stderrSuffix = stderrClip ? ` (stderr: ${stderrClip})` : ''

  switch (result.kind) {
    case 'exited':
      if (result.exitCode !== 0) {
        throw new PluginCommandSourceError(
          `Plugin source command \`${cmdDisplay}\` exited with code ${result.exitCode}` +
            (stderrClip ? `: ${stderrClip}` : ' and no error output.'),
          'plugin command source exited non-zero',
        )
      }
      break
    case 'timed-out':
      throw new PluginCommandSourceError(
        `Plugin source command \`${cmdDisplay}\` did not finish within ${timeoutMs / 1000}s and was stopped.${stderrSuffix}`,
        'plugin command source timed out',
      )
    case 'stdout-overflow':
      throw new PluginCommandSourceError(
        `Plugin source command \`${cmdDisplay}\` printed more than ${PLUGIN_COMMAND_SOURCE_MAX_STDOUT_BYTES / 1024} KB and was stopped; it must print a single absolute path.`,
        'plugin command source exceeded the stdout cap',
      )
    case 'signaled':
      throw new PluginCommandSourceError(
        `Plugin source command \`${cmdDisplay}\` was killed by ${result.signal} before it finished.${stderrSuffix}`,
        'plugin command source killed by a signal',
      )
    case 'spawn-error':
      throw new PluginCommandSourceError(
        `Plugin source command \`${cmdDisplay}\` could not be started: ${clipForError(result.message, STDERR_CLIP)}`,
        'plugin command source failed to spawn',
      )
  }

  const lines = result.stdout
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
  if (lines.length === 0) {
    throw new PluginCommandSourceError(
      `Plugin source command \`${cmdDisplay}\` printed nothing; it must print the absolute path of the plugin directory.`,
      'plugin command source printed nothing',
    )
  }
  if (lines.length > 1) {
    throw new PluginCommandSourceError(
      `Plugin source command \`${cmdDisplay}\` printed ${lines.length} lines; it must print exactly one absolute path.`,
      'plugin command source printed multiple lines',
    )
  }

  const printed = lines[0]!
  if (!isAbsolute(printed)) {
    throw new PluginCommandSourceError(
      `Plugin source command \`${cmdDisplay}\` printed \`${clipForError(printed, 200)}\`, which is not an absolute path.`,
      'plugin command source printed a relative path',
    )
  }
  if (getPlatform() === 'windows' && isWindowsUncOrDevicePath(printed)) {
    throw new PluginCommandSourceError(
      `Plugin source command \`${cmdDisplay}\` printed \`${clipForError(printed, 200)}\`, a UNC path, which is not supported as a plugin directory.`,
      'plugin command source printed a UNC path',
    )
  }

  let resolved: string
  try {
    resolved = await realpath(printed)
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error'
    throw new PluginCommandSourceError(
      `Plugin source command \`${cmdDisplay}\` printed \`${clipForError(printed, 200)}\`, but that path could not be resolved (${detail}).`,
      'plugin command source path does not resolve',
    )
  }

  let entries: string[]
  try {
    entries = await readdir(resolved)
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : undefined
    const detail =
      code === 'ENOTDIR'
        ? 'which is not a directory.'
        : `which could not be read as a directory (${code ?? (err instanceof Error ? err.message : 'unknown error')}).`
    throw new PluginCommandSourceError(
      `Plugin source command \`${cmdDisplay}\` printed \`${clipForError(printed, 200)}\`, ${detail}`,
      'plugin command source path is not a readable directory',
    )
  }

  if (!entries.some(name => ROOT_MARKER_SET.has(name))) {
    throw new PluginCommandSourceError(
      `Plugin source command \`${cmdDisplay}\` printed \`${clipForError(printed, 200)}\`, but that directory has no plugin content (expected .claude-plugin/ or a commands/, skills/, agents/, hooks/, themes/, output-styles/, monitors/, workflows/, SKILL.md, .mcp.json, or .lsp.json at the top level). Nothing was installed.`,
      'plugin command source directory has no plugin content',
    )
  }

  logForDebugging(
    `Plugin command source: resolved plugin directory ${resolved}`,
  )
  return resolved
}

/**
 * densable consent kinds for `d6_` / `Pkr.commandSourceConsent`.
 * - none: first install / no stored acceptance
 * - recorded: prior acceptance with consent key (HK)
 * - shown: command was displayed this install but not yet confirmed matching
 * - accepted: interactive/CLI -y acceptance for this exact command key
 */
export type CommandSourceConsent =
  | { kind: 'none'; pluginId?: string }
  | { kind: 'recorded'; command?: string; pluginId?: string }
  | { kind: 'shown'; command?: string; pluginId?: string }
  | { kind: 'accepted'; command: string; pluginId?: string }

/**
 * densable d6_ — refuse to run unless consent matches HK(source).
 * Early-return only when kind is not "none" and command === HK(e).
 */
export function assertCommandSourceConsent(
  source: CommandPluginSource,
  consent: CommandSourceConsent | undefined,
): void {
  const key = commandPluginConsentKey(source)
  if (
    consent &&
    consent.kind !== 'none' &&
    'command' in consent &&
    consent.command === key
  ) {
    return
  }

  const cmdDisplay =
    clipForError(source.command, 200) +
    (source.mode === 'link' ? ' [mode: link]' : '')
  const pluginId =
    consent?.pluginId !== undefined
      ? clipForError(consent.pluginId, 200)
      : undefined
  const who = pluginId ?? 'This plugin'
  const installId = pluginId ?? '<plugin>@<marketplace>'

  if (consent?.kind === 'recorded' && consent.command !== undefined) {
    throw new PluginCommandSourceError(
      `${who}'s marketplace changed the command that installs it, or how its output is used (now \`${cmdDisplay}\`), since it was accepted, so it was not run. Review and accept the new command with \`claude plugin update ${installId}\` in a terminal (add \`--scope\` for a project/local install).`,
      'plugin command source command changed since consent',
    )
  }
  if (consent?.kind === 'recorded') {
    throw new PluginCommandSourceError(
      `${who}'s marketplace entry now installs it by running a command on this machine (\`${cmdDisplay}\`) that has not been reviewed yet, so it was not run. Review and accept it with \`claude plugin update ${installId}\` in a terminal (add \`--scope\` for a project/local install).`,
      'plugin command source never consented for an installed plugin',
    )
  }
  if (consent?.kind === 'shown') {
    throw new PluginCommandSourceError(
      `${who}'s marketplace entry changed while it was being installed (it now declares \`${cmdDisplay}\`, not the command that was shown), so nothing was run. Re-run the install/update to review the current command.`,
      'plugin command source changed between display and run',
    )
  }
  throw new PluginCommandSourceError(
    `${who} is installed by running a command on this machine (\`${cmdDisplay}\`) that has not been reviewed yet, so it was not run. Review and accept it from its /plugin details pane, or with \`claude plugin install ${installId}\` in a terminal.`,
    'plugin command source without consent',
  )
}

/** densable Exd — max plugin directory size (256 MiB) */
export const PLUGIN_COMMAND_SOURCE_MAX_DIR_BYTES = 268_435_456

/** densable Cxd — max directory entries */
export const PLUGIN_COMMAND_SOURCE_MAX_ENTRIES = 20_000

/**
 * densable: refuse when command printed cwd or an ancestor of cwd.
 */
export function isPluginCommandProducerCwdOrAncestor(
  producerDir: string,
  cwd: string = getCwd(),
): boolean {
  const prod = resolve(producerDir)
  const base = resolve(cwd)
  if (prod === base) return true
  // producer is ancestor of cwd
  return base === prod || base.startsWith(prod + sep)
}

/**
 * densable kxd — walk producer dir; enforce entry/size caps (copy-mode precheck).
 * Returns sorted file paths (absolute). Symlinks collected separately when provided.
 */
export async function walkPluginCommandProducer(
  root: string,
  options?: {
    collectSymlinks?: string[]
    sizes?: Map<string, number>
  },
): Promise<string[]> {
  const files: string[] = []
  let totalBytes = 0
  let entries = 0

  async function walk(dir: string): Promise<void> {
    const list = await readdir(dir, { withFileTypes: true })
    for (const ent of list) {
      entries++
      if (entries > PLUGIN_COMMAND_SOURCE_MAX_ENTRIES) {
        throw new PluginCommandSourceError(
          `Plugin directory has more than ${PLUGIN_COMMAND_SOURCE_MAX_ENTRIES} entries; refusing to install it as a plugin.`,
          'plugin command source directory has too many files',
        )
      }
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (dir === root && ent.name === '.git') continue
        await walk(full)
      } else if (ent.isFile()) {
        const st = await stat(full)
        options?.sizes?.set(full, st.size)
        totalBytes += st.size
        if (totalBytes > PLUGIN_COMMAND_SOURCE_MAX_DIR_BYTES) {
          throw new PluginCommandSourceError(
            `Plugin directory is larger than ${PLUGIN_COMMAND_SOURCE_MAX_DIR_BYTES / 1_048_576} MB; refusing to install it as a plugin.`,
            'plugin command source directory too large',
          )
        }
        files.push(full)
      } else if (ent.isSymbolicLink()) {
        options?.collectSymlinks?.push(full)
      }
    }
  }

  await walk(root)
  options?.collectSymlinks?.sort()
  return files.sort()
}

/**
 * densable u6_ — content sha256 of copy-mode install tree (files + symlink targets).
 */
export async function hashPluginCommandDirectory(
  root: string,
): Promise<string> {
  const symlinks: string[] = []
  const sizes = new Map<string, number>()
  const files = await walkPluginCommandProducer(root, {
    collectSymlinks: symlinks,
    sizes,
  })
  const hash = createHash('sha256')
  for (const file of files) {
    const size = sizes.get(file) ?? 0
    const rel = relative(root, file).split(sep).join('/')
    hash.update(`f ${rel}\0${size}\0`)
    if (size > 0) {
      await new Promise<void>((resolveP, reject) => {
        const stream = createReadStream(file, { start: 0, end: size - 1 })
        stream.on('data', chunk => {
          hash.update(chunk)
        })
        stream.on('error', reject)
        stream.on('end', () => resolveP())
      })
    }
  }
  for (const link of symlinks) {
    const target = await readlink(link)
    const rel = relative(root, link).split(sep).join('/')
    hash.update(`l ${rel}\0`)
    hash.update(`${Buffer.byteLength(target)}\0${target}`)
  }
  return hash.digest('hex')
}

export type InstallCommandPluginResult = {
  producerDirectory: string
  contentSha256: string
  mode: 'copy' | 'link'
}

/**
 * densable f0t — true when the plugin cache is not under the user home
 * (project-/workspace-local cache). Recorded `sourceCommand` consent is then
 * treated as workspace-scoped and must be re-confirmed on CLI install/update.
 */
export function isCommandSourceConsentWorkspaceScoped(
  pluginCacheDir?: string,
): boolean {
  try {
    const home = resolve(homedir())
    // Lazy: callers may pass cache dir; default via getPluginsDirectory would
    // risk cycles — use ~/.claude/plugins when unset (global cache → false).
    const cache = resolve(
      pluginCacheDir ?? join(homedir(), '.claude', 'plugins'),
    )
    const rel = relative(home, cache)
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * densable btm — read a single line from stdin; true for y/yes (case-insensitive).
 */
export async function readYesFromStdin(
  input: NodeJS.ReadableStream = process.stdin,
): Promise<boolean> {
  const readline = await import('readline')
  const rl = readline.createInterface({ input })
  try {
    for await (const line of rl) {
      return /^y(es)?$/i.test(String(line).trim())
    }
    return false
  } finally {
    rl.close()
  }
}

export type PromptCommandSourceConsentResult =
  | { kind: 'accepted'; grantKey: string }
  | { kind: 'declined' }

/**
 * densable ptm — interactive CLI consent for `source: "command"` marketplace
 * entries. Returns undefined when the entry is not command-sourced, policy
 * blocks it, or the command was only displayed (non-TTY without -y).
 *
 * @param pluginId plugin@marketplace
 * @param entry marketplace entry (needs `.source`)
 * @param options.yes densable -y/--yes
 * @param options.acceptedCommand prior stored HK (re-prompt copy when changed)
 * @param options.write densable La — default writeToStdout when available
 */
export async function promptCommandSourceConsent(
  pluginId: string,
  entry: { source: unknown },
  options: {
    yes?: boolean
    acceptedCommand?: string
    write?: (text: string) => void
  } = {},
): Promise<PromptCommandSourceConsentResult | undefined> {
  if (!isCommandPluginSource(entry.source)) return undefined

  const write =
    options.write ??
    ((text: string) => {
      try {
        // Prefer process stdout so pure unit tests can inject `write`.
        process.stdout.write(text)
      } catch {
        // ignore
      }
    })

  if (areCommandPluginSourcesDisabledByPolicy()) {
    write(`${COMMAND_PLUGIN_SOURCES_DISABLED_MESSAGE}\n`)
    return undefined
  }
  if (entry.source.mode === 'link' && getPlatform() === 'windows') {
    write(`${COMMAND_PLUGIN_LINK_MODE_WINDOWS_MESSAGE}\n`)
    return undefined
  }

  const command = entry.source.command
  const grantKey = commandPluginConsentKey(entry.source)
  const acceptedCommand = options.acceptedCommand
  if (
    acceptedCommand === grantKey &&
    !isCommandSourceConsentWorkspaceScoped()
  ) {
    return undefined
  }

  const at = pluginId.indexOf('@')
  const name = at > 0 ? pluginId.slice(0, at) : pluginId
  const marketplace = at > 0 ? pluginId.slice(at + 1) : ''
  const nameDisp = clipForError(name, 200)
  const mktDisp = clipForError(marketplace, 200)
  let changeNote = ''
  if (acceptedCommand === undefined) {
    changeNote = ''
  } else if (acceptedCommand !== grantKey) {
    changeNote =
      ' — and that command (or how its output is used) CHANGED since you accepted it'
  } else {
    changeNote =
      ' — your earlier acceptance is recorded inside this workspace, so please confirm it again'
  }
  write(
    `"${nameDisp}" is installed by running a command from marketplace "${mktDisp}" on this machine${changeNote}:\n  ${command}\n  (${describeCommandPluginMode(entry.source)})\n`,
  )

  const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY)
  const yes = options.yes === true
  if (yes) {
    // densable: -y is ignored inside a Claude Code child/session unless TTY
    const inSession = Boolean(
      process.env.CLAUDE_CODE_CHILD_SESSION || process.env.CLAUDECODE,
    )
    if (!inSession) {
      return { kind: 'accepted', grantKey }
    }
    if (!isTty) {
      write(
        '-y/--yes is ignored inside a Claude Code session: run this in your own terminal to accept the command shown above.\n',
      )
      return undefined
    }
  }
  if (!isTty) {
    write(
      'Not an interactive terminal, so the command was only displayed, not accepted. Re-run in a terminal to confirm it, or pass -y/--yes to accept the command shown above.\n',
    )
    return undefined
  }
  write('Run this command now? [y/N] ')
  const ok = await readYesFromStdin()
  return ok ? { kind: 'accepted', grantKey } : { kind: 'declined' }
}

/**
 * densable x0v — recorded consent from installed_plugins when HK still matches.
 * Returns undefined when not command-sourced, no install record, or workspace-
 * scoped cache (f0t) where stored consent must not auto-grant.
 */
export function getRecordedCommandSourceConsent(
  pluginId: string,
  source: unknown,
  installations: Array<{ sourceCommand?: string }> | undefined,
): CommandSourceConsent | undefined {
  if (!isCommandPluginSource(source)) return undefined
  if (!installations || installations.length === 0) return undefined
  if (isCommandSourceConsentWorkspaceScoped()) return undefined
  const key = commandPluginConsentKey(source)
  const exact = installations.find(s => s.sourceCommand === key)?.sourceCommand
  const any = installations.find(
    s => s.sourceCommand !== undefined,
  )?.sourceCommand
  return {
    kind: 'recorded',
    command: exact ?? any,
    pluginId,
  }
}

/**
 * densable HPd — roll previous producer paths when the resolved directory moves.
 * Keeps most recent last, bounded to 32 (densable ugo).
 */
export function mergePreviousProducerPaths(
  existing:
    | {
        sourceProducerPath?: string
        previousProducerPaths?: string[]
      }
    | undefined,
  newProducerPath: string,
  max = 32,
): string[] {
  if (!existing) return []
  const prior =
    existing.sourceProducerPath !== undefined &&
    existing.sourceProducerPath !== newProducerPath
      ? [existing.sourceProducerPath]
      : []
  return [
    ...(existing.previousProducerPaths ?? []).filter(
      p => p !== existing.sourceProducerPath && p !== newProducerPath,
    ),
    ...prior,
  ]
    .filter(p => p !== '')
    .slice(-max)
}

/**
 * densable ftm — resolve marketplace entry and run ptm for command sources.
 * Returns:
 * - undefined for non-command sources / policy skip / already-installed warn path
 * - accepted with grantKey when prior consent matches or user/yes accepts
 * - declined when user answers no
 */
export async function announceCommandSourceForInstall(
  plugin: string,
  options: {
    yes?: boolean
    scope?: 'user' | 'project' | 'local'
  } = {},
): Promise<PromptCommandSourceConsentResult | undefined> {
  const { getPluginById } = await import('./marketplaceManager.js')
  const { isPluginInstalled, loadInstalledPluginsV2 } = await import(
    './installedPluginsManager.js'
  )
  const { parsePluginIdentifier } = await import('./pluginIdentifier.js')

  const { name, marketplace } = parsePluginIdentifier(plugin)
  if (!name) return undefined

  // densable: prefer scoped id; unscoped searches marketplaces via getPluginById
  // when plugin already has @marketplace, getPluginById works; otherwise try
  // name-only lookup by scanning known marketplaces.
  let pluginId = marketplace ? `${name}@${marketplace}` : name
  let entrySource: unknown

  if (marketplace) {
    const info = await getPluginById(pluginId)
    if (!info || !isCommandPluginSource(info.entry.source)) return undefined
    entrySource = info.entry.source
  } else {
    // Unscoped: walk known marketplaces for a command-source match
    const { loadKnownMarketplacesConfig, getMarketplace } = await import(
      './marketplaceManager.js'
    )
    const known = await loadKnownMarketplacesConfig()
    let found: { marketplace: string; source: CommandPluginSource } | undefined
    for (const mktName of Object.keys(known)) {
      try {
        const mkt = await getMarketplace(mktName)
        const ent = mkt.plugins.find(p => p.name === name)
        if (ent && isCommandPluginSource(ent.source)) {
          found = { marketplace: mktName, source: ent.source }
          break
        }
      } catch {
        // skip unloadable marketplace
      }
    }
    if (!found) return undefined
    pluginId = `${name}@${found.marketplace}`
    entrySource = found.source
  }

  if (!isCommandPluginSource(entrySource)) return undefined

  const installations = loadInstalledPluginsV2().plugins[pluginId] ?? []
  const grantKey = commandPluginConsentKey(entrySource)
  const workspaceScoped = isCommandSourceConsentWorkspaceScoped()
  const hasMatchingConsent =
    !workspaceScoped && installations.some(g => g.sourceCommand === grantKey)

  if (isPluginInstalled(pluginId)) {
    if (!hasMatchingConsent) {
      const neverReviewed = installations.every(
        g => g.sourceCommand === undefined,
      )
      const scopeFlag =
        (options.scope ?? 'user') === 'user' ? '' : ` --scope ${options.scope}`
      const msg =
        `"${clipForError(name, 200)}" is already installed, and its marketplace ` +
        (neverReviewed
          ? 'entry now installs it by running a command on this machine that has not been reviewed yet.'
          : 'has since changed the command that installs it (or how its output is used).') +
        ` Review and accept it with \`claude plugin update ${pluginId}${scopeFlag}\`.\n`
      try {
        process.stdout.write(msg)
      } catch {
        // ignore
      }
    }
    return undefined
  }

  if (hasMatchingConsent) {
    return { kind: 'accepted', grantKey }
  }

  const acceptedCommand = !workspaceScoped
    ? installations.find(g => g.sourceCommand !== undefined)?.sourceCommand
    : undefined

  return promptCommandSourceConsent(
    pluginId,
    { source: entrySource },
    {
      yes: options.yes,
      acceptedCommand,
    },
  )
}

/**
 * densable Oxd core (without telemetry wrapper):
 * policy → windows link ban → consent → run command → refuse cwd/ancestor →
 * copy or link into targetPath → content sha256.
 *
 * Copy uses the provided `copyDir` so install stays consistent with local plugin copy.
 * Link mode writes top-level symlinks + `.claude-plugin-link` marker (densable fkr).
 */
export async function installCommandPluginSource(
  source: CommandPluginSource,
  targetPath: string,
  options: {
    consent?: CommandSourceConsent
    copyDir: (from: string, to: string) => Promise<void>
  },
): Promise<InstallCommandPluginResult> {
  if (areCommandPluginSourcesDisabledByPolicy()) {
    throw new PluginCommandSourceError(
      COMMAND_PLUGIN_SOURCES_DISABLED_MESSAGE,
      'plugin command source disabled by managed policy',
    )
  }
  if (source.mode === 'link' && getPlatform() === 'windows') {
    throw new PluginCommandSourceError(
      COMMAND_PLUGIN_LINK_MODE_WINDOWS_MESSAGE,
      'plugin command source link mode unsupported on windows',
    )
  }
  assertCommandSourceConsent(source, options.consent)

  const producer = await runPluginCommandSource(source)
  if (isPluginCommandProducerCwdOrAncestor(producer)) {
    throw new PluginCommandSourceError(
      `Plugin source command printed the working directory or one of its parents (${clipForError(producer, 300)}); refusing to use it as a plugin.`,
      'plugin command source printed cwd or an ancestor',
    )
  }

  // densable Oxd: zvt(producer) immediately after c6_ + cwd/ancestor check,
  // before copy/link — so link-mode live trees enter the deny bag + cDs bus
  // even if later materialize/register fails. Later cacheAndRegister zvt is
  // idempotent (Set).
  denyCommandProducerDir(producer)

  const mode = source.mode === 'link' ? 'link' : 'copy'
  if (mode === 'link') {
    const { mkdir, symlink, writeFile } = await import('fs/promises')
    await mkdir(targetPath, { recursive: true })
    const names = (await readdir(producer)).filter(
      // densable Ixd junk filter is separate; skip only known non-plugin junk lightly
      n => n !== '.DS_Store' && n !== '__MACOSX',
    )
    names.sort()
    const linkMeta: { name: string; target: string; isDirectory: boolean }[] =
      []
    for (const name of names) {
      const entry = join(producer, name)
      let real: string
      let isDir: boolean
      try {
        real = await realpath(entry)
        isDir = (await stat(real)).isDirectory()
      } catch {
        throw new PluginCommandSourceError(
          `A top-level entry of the plugin directory its command produced could not be resolved (${clipForError(name, 80)}); refusing to link it.`,
          'plugin command source link entry unresolvable',
        )
      }
      const rel = relative(producer, real)
      if (
        rel === '' ||
        rel === '..' ||
        rel.startsWith(`..${sep}`) ||
        isAbsolute(rel)
      ) {
        throw new PluginCommandSourceError(
          `A top-level entry of the plugin directory its command produced (${clipForError(name, 80)}) points outside that directory; refusing to link it.`,
          'plugin command source link escapes producer directory',
        )
      }
      await symlink(real, join(targetPath, name), isDir ? 'dir' : 'file')
      linkMeta.push({ name, target: real, isDirectory: isDir })
    }
    // densable fkr
    await writeFile(
      join(targetPath, '.claude-plugin-link'),
      JSON.stringify({ target: producer }),
      { flag: 'wx' },
    )
    const hash = createHash('sha256')
    hash.update(`${producer}\0`)
    for (const { name, target } of linkMeta) {
      hash.update(`${Buffer.byteLength(name)}\0${name}`)
      hash.update(`${Buffer.byteLength(target)}\0${target}`)
    }
    return {
      producerDirectory: producer,
      contentSha256: hash.digest('hex'),
      mode: 'link',
    }
  }

  // copy mode — densable kxd precheck then copy
  await walkPluginCommandProducer(producer)
  await options.copyDir(producer, targetPath)
  // strip .git like installFromLocal
  try {
    const { rm } = await import('fs/promises')
    await rm(join(targetPath, '.git'), { recursive: true, force: true })
  } catch {
    // ignore
  }
  const contentSha256 = await hashPluginCommandDirectory(targetPath)
  return { producerDirectory: producer, contentSha256, mode: 'copy' }
}
