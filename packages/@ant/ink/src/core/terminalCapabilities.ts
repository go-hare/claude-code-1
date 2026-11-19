/**
 * densable 2.1.289 `Jk` / `tD` / `class o` / `class f` / `function d`.
 * Gold: official-289 SEA @192996635–193001438. Do not export minify `o`/`f`/`h`.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { coerce, gte } from 'semver'
import { inkSessionHost } from './instances.js'
import { isJediTermEnv } from './jediTermInput.js'
import {
  CLEAR_PROGRAM_STATUS,
  clearProgramStatusForId,
  programStatus,
  type ProgramStatusOptions,
} from './termio/osc.js'

const execFileAsync = promisify(execFile)

export type TerminalCapabilityName =
  | 'extendedKeys'
  | 'synchronizedOutput'
  | 'kittyKeyboard'
  | 'kittyGraphics'
  | 'itermImages'
  | 'mousePixels'
  | 'programStatus'

export type TerminalCapabilityReading =
  | { state: 'settled'; value: boolean; source: string }
  | { state: 'pending'; likely: boolean; source: string }

type CapabilitySeed =
  | { settled: boolean; source: string }
  | { likely: boolean; source: string }

type CapabilityDefaults = Record<TerminalCapabilityName, CapabilitySeed>

/** densable `s` — pending `now()` fallback while a probe has not answered. */
const PENDING_NOW: Record<TerminalCapabilityName, boolean> = {
  extendedKeys: false,
  synchronizedOutput: false,
  kittyKeyboard: true,
  kittyGraphics: false,
  itermImages: false,
  mousePixels: false,
  programStatus: false,
}

/** densable `FDn`. */
export const CAPABILITY_NAMES = Object.keys(
  PENDING_NOW,
) as TerminalCapabilityName[]

/** densable `yyr`. */
const EXTENDED_KEYS_TERMINALS = [
  'iTerm.app',
  'kitty',
  'WezTerm',
  'ghostty',
  'tmux',
  'windows-terminal',
  'WarpTerminal',
]

/** densable `Fee`. */
const JETBRAINS_IDES = [
  'pycharm',
  'intellij',
  'webstorm',
  'phpstorm',
  'rubymine',
  'clion',
  'goland',
  'rider',
  'datagrip',
  'appcode',
  'dataspell',
  'aqua',
  'gateway',
  'fleet',
  'jetbrains',
  'androidstudio',
]

/** densable `Tno`. */
function isWindsurfAskpassPath(path: string): boolean {
  const lower = path.toLowerCase()
  return (
    lower.includes('windsurf') ||
    lower.includes('devin.app') ||
    lower.includes('devin desktop') ||
    lower.includes('devin-desktop') ||
    /appdata[\\/]local[\\/](programs[\\/])?devin[\\/]/.test(lower)
  )
}

function isSshSession(): boolean {
  return Boolean(
    process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY,
  )
}

type ImageFilesSeed = { value: boolean; source: string }

type ImageFilesReadingState =
  | { state: 'unasked' }
  | { state: 'asking' }
  | { state: 'settled'; value: boolean; source: string }

function createSettleEmitter<T>(): {
  emit: (value: T) => void
  clear: () => void
  subscribe: (listener: (value: T) => void) => () => void
} {
  const listeners = new Set<(value: T) => void>()
  return {
    emit(value) {
      for (const listener of listeners) listener(value)
    },
    clear() {
      listeners.clear()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * densable `z` — WeakMap factory keyed by session host. Copied privately;
 * do not import the minify class from instances.ts.
 */
class HostKeyedFactory<K extends object, V> {
  #create: () => V
  #map = new WeakMap<K, V>()
  constructor(create: () => V) {
    this.#create = create
  }
  of(key: K): V {
    const existing = this.#map.get(key)
    if (existing !== undefined) return existing
    const created = this.#create()
    this.#map.set(key, created)
    return created
  }
}

/** densable `gst`. */
export function familyFromTerm(name: string | undefined): 'st' | 'rxvt' | null {
  if (name === undefined) return null
  if (/^st(term)?(-|$)/.test(name)) return 'st'
  if (/^rxvt(-|$)/.test(name)) return 'rxvt'
  return null
}

/**
 * densable `xo()` — `a.terminal` for `d()`. Same BODY as `src/utils/env.ts`
 * `detectTerminal` (gold SEA @179462122).
 */
export function envTerminalName(): string | null {
  const env = process.env
  if (env.CURSOR_TRACE_ID) return 'cursor'
  const askpass = env.VSCODE_GIT_ASKPASS_MAIN?.toLowerCase() ?? ''
  if (askpass.includes('cursor')) return 'cursor'
  if (isWindsurfAskpassPath(askpass)) return 'windsurf'
  if (askpass.includes('antigravity')) return 'antigravity'
  const bundleId = env.__CFBundleIdentifier?.toLowerCase()
  if (bundleId?.includes('vscodium')) return 'codium'
  if (bundleId?.includes('windsurf') || bundleId?.includes('devin')) {
    return 'windsurf'
  }
  if (bundleId?.includes('com.google.android.studio')) return 'androidstudio'
  if (bundleId) {
    for (const ide of JETBRAINS_IDES) {
      if (bundleId.includes(ide)) return ide
    }
  }
  if (env.VisualStudioVersion) return 'visualstudio'
  if (env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') return 'pycharm'
  if (env.TERM === 'xterm-ghostty') return 'ghostty'
  if (env.TERM?.includes('kitty')) return 'kitty'
  if (env.TERM_PROGRAM) {
    if (/^devin([ -]desktop)?$/i.test(env.TERM_PROGRAM)) return 'windsurf'
    return env.TERM_PROGRAM
  }
  if (env.TMUX) return 'tmux'
  if (env.STY) return 'screen'
  if (env.KONSOLE_VERSION) return 'konsole'
  if (env.GNOME_TERMINAL_SERVICE) return 'gnome-terminal'
  if (env.XTERM_VERSION) return 'xterm'
  if (env.VTE_VERSION) return 'vte-based'
  if (env.TERMINATOR_UUID) return 'terminator'
  if (env.KITTY_WINDOW_ID) return 'kitty'
  if (env.ALACRITTY_LOG) return 'alacritty'
  if (env.TILIX_ID) return 'tilix'
  if (env.WT_SESSION) return 'windows-terminal'
  if (env.SESSIONNAME && env.TERM === 'cygwin') return 'cygwin'
  if (env.MSYSTEM) return env.MSYSTEM.toLowerCase()
  if (env.ConEmuANSI || env.ConEmuPID || env.ConEmuTask) return 'conemu'
  if (env.WSL_DISTRO_NAME) return `wsl-${env.WSL_DISTRO_NAME}`
  if (isSshSession()) return 'ssh-session'
  if (env.TERM) {
    const term = env.TERM
    if (term.includes('alacritty')) return 'alacritty'
    if (term.includes('rxvt')) return 'rxvt'
    if (term.includes('termite')) return 'termite'
    return env.TERM
  }
  if (!process.stdout.isTTY) return 'non-interactive'
  return null
}

function isBgSession(): boolean {
  return process.env.CLAUDE_CODE_SESSION_KIND === 'bg'
}

function isMultiplexed(): boolean {
  return Boolean(process.env.TMUX) || Boolean(process.env.STY)
}

/** densable `E`. */
function extendedKeysSeed(
  terminal: string | null,
  bgWorker: boolean,
): CapabilitySeed {
  const source = `env: terminal=${terminal || 'unknown'}`
  if (bgWorker) return { settled: false, source: `${source}, bg worker` }
  if (terminal !== null && EXTENDED_KEYS_TERMINALS.includes(terminal)) {
    return { settled: true, source }
  }
  if (terminal !== null && familyFromTerm(terminal) === 'st') {
    return { settled: false, source }
  }
  return { likely: false, source }
}

/** densable `v`. */
function synchronizedOutputEnvHint(): string | undefined {
  const env = process.env
  const termProgram = env.TERM_PROGRAM
  const term = env.TERM
  if (
    termProgram === 'iTerm.app' ||
    termProgram === 'WezTerm' ||
    termProgram === 'WarpTerminal' ||
    termProgram === 'ghostty' ||
    termProgram === 'contour' ||
    termProgram === 'vscode' ||
    termProgram === 'alacritty' ||
    termProgram === 'mintty' ||
    termProgram === 'rio' ||
    termProgram === 'Tabby'
  ) {
    return `TERM_PROGRAM=${termProgram}`
  }
  if (term?.includes('kitty')) return `TERM=${term}`
  if (env.KITTY_WINDOW_ID) return 'KITTY_WINDOW_ID'
  if (term === 'xterm-ghostty') return `TERM=${term}`
  if (term?.startsWith('foot')) return `TERM=${term}`
  if (term?.includes('alacritty')) return `TERM=${term}`
  if (env.ZED_TERM) return 'ZED_TERM'
  if (env.WT_SESSION) return 'WT_SESSION'
  if (parseInt(env.VTE_VERSION ?? '', 10) >= 6800) {
    return `VTE_VERSION=${env.VTE_VERSION}`
  }
  return undefined
}

/** densable `T`. */
function synchronizedOutputSeed(): CapabilitySeed {
  if (process.env.TMUX) {
    return {
      likely: false,
      source: 'env: TMUX (tmux answers for itself)',
    }
  }
  if (process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT) {
    return { settled: true, source: 'env: CLAUDE_CODE_FORCE_SYNC_OUTPUT' }
  }
  if (isJediTermEnv()) {
    return {
      settled: true,
      source: 'env: TERMINAL_EMULATOR=JetBrains-JediTerm',
    }
  }
  const hint = synchronizedOutputEnvHint()
  if (hint) return { likely: true, source: `env: ${hint}` }
  return { likely: false, source: 'env: no known terminal' }
}

/** densable `b`. */
function kittyKeyboardSeed(
  terminal: string | null,
  bgWorker: boolean,
): CapabilitySeed {
  if (bgWorker) return { settled: true, source: 'bg worker' }
  if (terminal !== null && familyFromTerm(terminal) === 'st') {
    return { settled: false, source: `env: terminal=${terminal}` }
  }
  return { likely: true, source: 'not asked yet' }
}

/** densable `m`. */
function kittyGraphicsSeed(input: {
  terminal: string | null
  bgWorker: boolean
  multiplexed: boolean
  tmux: boolean
  forced: boolean
}): CapabilitySeed {
  if (input.forced) {
    return { settled: true, source: 'env: CLAUDE_CODE_FORCE_TERMINAL_IMAGES' }
  }
  if (input.bgWorker) return { settled: false, source: 'bg worker' }
  if (input.tmux) {
    return { likely: false, source: 'env: inside tmux, not asked yet' }
  }
  if (input.multiplexed) {
    return { settled: false, source: 'env: inside screen' }
  }
  return {
    likely: false,
    source: `env: terminal=${input.terminal || 'unknown'}, not asked yet`,
  }
}

/** densable `y`. */
function mousePixelsSeed(input: {
  terminal: string | null
  bgWorker: boolean
  multiplexed: boolean
}): CapabilitySeed {
  if (input.bgWorker) return { settled: false, source: 'bg worker' }
  if (input.multiplexed) {
    return { settled: false, source: 'env: inside tmux or screen' }
  }
  return {
    likely: false,
    source: `env: terminal=${input.terminal || 'unknown'}, not asked yet`,
  }
}

/** Official 2.1.305 `OOr` (#1054): iTerm2 3.5.0+ supports inline images. */
export function isIterm2VersionAtLeast35(xtversion: string | null): boolean {
  if (xtversion === null || !/^iTerm2\s/.test(xtversion)) return false
  const match = xtversion
    .slice(6)
    .trim()
    .match(/^(\d+)\.(\d+)/)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 3 || (major === 3 && minor >= 5)
}

function itermImagesSeed(input: {
  terminal: string | null
  bgWorker: boolean
  multiplexed: boolean
  tmux: boolean
}): CapabilitySeed {
  if (input.bgWorker) return { settled: false, source: 'bg worker' }
  if (input.tmux) {
    return { likely: false, source: 'env: inside tmux, not asked yet' }
  }
  if (input.multiplexed) {
    return { settled: false, source: 'env: inside screen, not supported' }
  }
  return {
    likely: false,
    source: `env: terminal=${input.terminal || 'unknown'}, not asked yet`,
  }
}

/** densable `d()`. */
export function defaultCapabilityReadings(): CapabilityDefaults {
  const terminal = envTerminalName()
  const bgWorker = isBgSession()
  const multiplexed = isMultiplexed()
  const tmux = Boolean(process.env.TMUX) && !process.env.STY
  return {
    extendedKeys: extendedKeysSeed(terminal, bgWorker),
    synchronizedOutput: synchronizedOutputSeed(),
    kittyKeyboard: kittyKeyboardSeed(terminal, bgWorker),
    kittyGraphics: kittyGraphicsSeed({
      terminal,
      bgWorker,
      multiplexed,
      tmux,
      forced: Boolean(process.env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES),
    }),
    itermImages: itermImagesSeed({
      terminal,
      bgWorker,
      multiplexed,
      tmux,
    }),
    mousePixels: mousePixelsSeed({
      terminal,
      bgWorker,
      multiplexed,
    }),
    programStatus: {
      likely: false,
      source: 'env: default',
    },
  }
}

/**
 * densable `class o` — per-capability probe readings.
 * Do not export minify `o`.
 */
export class TerminalCapabilityStore {
  readings = new Map<TerminalCapabilityName, TerminalCapabilityReading>()
  answeredYes = new Set<TerminalCapabilityName>()
  listeners = new Map<TerminalCapabilityName, Set<(value: boolean) => void>>()

  constructor(seeds: CapabilityDefaults) {
    for (const name of CAPABILITY_NAMES) {
      const seed = seeds[name]
      this.readings.set(
        name,
        'settled' in seed
          ? { state: 'settled', value: seed.settled, source: seed.source }
          : { state: 'pending', likely: seed.likely, source: seed.source },
      )
    }
  }

  get(name: TerminalCapabilityName): TerminalCapabilityReading {
    return this.readings.get(name)!
  }

  now(name: TerminalCapabilityName): boolean {
    const reading = this.get(name)
    return reading.state === 'settled' ? reading.value : PENDING_NOW[name]
  }

  confirmed(name: TerminalCapabilityName): boolean {
    return this.answeredYes.has(name)
  }

  pending(): TerminalCapabilityName[] {
    return CAPABILITY_NAMES.filter(name => this.get(name).state === 'pending')
  }

  answer(
    name: TerminalCapabilityName,
    value: boolean,
    source: string,
  ): boolean {
    const reading = this.get(name)
    if (reading.state === 'settled') {
      if (value && reading.value) this.answeredYes.add(name)
      return false
    }
    if (value) this.answeredYes.add(name)
    this.settle(name, value, source)
    return true
  }

  deadline(): void {
    for (const name of this.pending()) {
      const reading = this.get(name)
      if (reading.state !== 'pending') continue
      this.settle(name, reading.likely, `${reading.source}, no answer`)
    }
  }

  onSettle(
    name: TerminalCapabilityName,
    listener: (value: boolean) => void,
  ): () => void {
    const reading = this.get(name)
    if (reading.state === 'settled') {
      listener(reading.value)
      return () => {}
    }
    const set = this.listeners.get(name) ?? new Set<(value: boolean) => void>()
    this.listeners.set(name, set)
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  settle(name: TerminalCapabilityName, value: boolean, source: string): void {
    this.readings.set(name, { state: 'settled', value, source })
    const set = this.listeners.get(name)
    this.listeners.delete(name)
    for (const listener of set ?? []) listener(value)
  }
}

/**
 * densable `class i` — `Jk().imageFiles` (FORCE_TERMINAL_IMAGES seed).
 * Do not export minify `i`.
 */
export class TerminalImageFilesReading {
  reading: ImageFilesReadingState
  settled = createSettleEmitter<boolean>()

  constructor(seed: ImageFilesSeed | undefined) {
    this.reading =
      seed === undefined
        ? { state: 'unasked' }
        : { state: 'settled', value: seed.value, source: seed.source }
  }

  get(): ImageFilesReadingState {
    return this.reading
  }

  now(): boolean {
    return this.reading.state === 'settled' && this.reading.value
  }

  begin(): boolean {
    if (this.reading.state !== 'unasked') return false
    this.reading = { state: 'asking' }
    return true
  }

  unask(): void {
    if (this.reading.state === 'asking') this.reading = { state: 'unasked' }
  }

  answer(result: { value: boolean; source: string }): boolean {
    if (this.reading.state === 'settled') return false
    this.reading = { state: 'settled', ...result }
    try {
      this.settled.emit(result.value)
    } finally {
      this.settled.clear()
    }
    return true
  }

  onSettle(listener: (value: boolean) => void): () => void {
    if (this.reading.state === 'settled') {
      listener(this.reading.value)
      return () => {}
    }
    return this.settled.subscribe(listener)
  }
}

export type ProgramStatusPolicy = { keep: 'all' | 'none' }

export const PROGRAM_STATUS_KEEP_ALL: ProgramStatusPolicy = { keep: 'all' }

export type ProgramStatusEntry = {
  root: ProgramStatusOptions
  main?: {
    drops: number
    children?: ProgramStatusOptions[]
  }
}

/**
 * Official 2.1.326 `class h` (#188): OSC 7501 Program Status Protocol
 * controller tracking active reporters, child task entries, deduplication,
 * and clean leave/clear semantics (including after idle compaction and
 * attached background sessions).
 */
export class ProgramStatusController {
  #entries = new Set<ProgramStatusEntry>()
  #emitted = new Map<string, string>()
  #policy: ProgramStatusPolicy | undefined
  #drops = 0
  #hasReported = false

  get hasReported(): boolean {
    return this.#hasReported
  }

  show(entry: ProgramStatusEntry): () => void {
    this.#entries.add(entry)
    return () => {
      this.#entries.delete(entry)
    }
  }

  update(policy: ProgramStatusPolicy, emitClearWhenNone = false): string {
    const policyChanged = this.#policy !== policy
    this.#policy = policy
    if (policy.keep === 'none') {
      const clearSeq = this.#clearEmitted()
      return emitClearWhenNone ? clearSeq : ''
    }
    const sorted = [...this.#entries].sort(
      (a, b) => Number(b.main !== undefined) - Number(a.main !== undefined),
    )
    const primary =
      sorted.find(entry => entry.root.state === 'blocked') ?? sorted[0]
    if (primary === undefined) {
      return this.#clearEmitted()
    }
    const main = sorted[0]?.main
    if (main !== undefined && main.drops !== this.#drops) {
      this.#drops = main.drops
      this.#emitted.clear()
    }
    const next = new Map<string, string>()
    for (const item of [primary.root, ...(main?.children ?? [])]) {
      next.set(item.id ?? '', programStatus(item))
    }
    let out = ''
    for (const [id, seq] of next) {
      if (policyChanged || this.#emitted.get(id) !== seq) {
        this.#emitted.set(id, seq)
        out += seq
      }
    }
    for (const id of [...this.#emitted.keys()]) {
      if (!next.has(id)) {
        this.#emitted.delete(id)
        out += id ? clearProgramStatusForId(id) : CLEAR_PROGRAM_STATUS
      }
    }
    if (out === '' || this.#hasReported) return out
    this.#hasReported = true
    return policy === PROGRAM_STATUS_KEEP_ALL ? out : CLEAR_PROGRAM_STATUS + out
  }

  leave(supported: boolean): string {
    const clearSeq = this.#clearEmitted()
    return supported ? CLEAR_PROGRAM_STATUS : clearSeq
  }

  #clearEmitted(): string {
    const out = this.#emitted.size > 0 ? CLEAR_PROGRAM_STATUS : ''
    this.#emitted.clear()
    return out
  }
}

/**
 * densable `class f` — host-keyed terminal identity + capability bag.
 * Do not export minify `f`.
 */
export class TerminalHostState {
  xtversionName: string | undefined = undefined
  #capabilities: TerminalCapabilityStore | undefined = undefined
  #imageFiles: TerminalImageFilesReading | undefined = undefined
  osc11Responsive: boolean | undefined = undefined
  cellPixels: { width: number; height: number } | undefined = undefined
  probeEventLogged = false
  nativeCursorEnabled: boolean | undefined = undefined
  tmuxPane: TmuxPaneState | undefined = undefined
  isTmuxPaneAsked = false
  tmuxPaneAnsweredAt: number | undefined = undefined
  programStatus = new ProgramStatusController()

  get capabilities(): TerminalCapabilityStore {
    return (this.#capabilities ??= new TerminalCapabilityStore(
      defaultCapabilityReadings(),
    ))
  }

  get imageFiles(): TerminalImageFilesReading {
    return (this.#imageFiles ??= new TerminalImageFilesReading(
      process.env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES
        ? {
            value: true,
            source: 'env: CLAUDE_CODE_FORCE_TERMINAL_IMAGES',
          }
        : undefined,
    ))
  }

  resetCapabilities(): void {
    this.#capabilities = undefined
    this.#imageFiles = undefined
    this.tmuxPane = undefined
    this.isTmuxPaneAsked = false
    this.tmuxPaneAnsweredAt = undefined
  }
}

/** densable `h = new z(() => new f)`. */
const hostStates = new HostKeyedFactory<object, TerminalHostState>(
  () => new TerminalHostState(),
)

/** densable `Jk()` — `return h.of(U().host)`. */
export function Jk(): TerminalHostState {
  return hostStates.of(inkSessionHost())
}

/** densable `tD()` — `return Jk().capabilities`. */
export function tD(): TerminalCapabilityStore {
  return Jk().capabilities
}

export type ImageProtocol = 'kitty' | 'iterm'

/** Official 2.1.305 `JMn` (#1054). */
export function getImageProtocol(): ImageProtocol | undefined {
  const caps = tD()
  if (caps.now('kittyGraphics')) return 'kitty'
  if (caps.now('itermImages')) return 'iterm'
  return undefined
}

/** Official 2.1.305 `i1i` (#1054). */
export function subscribeImageProtocol(
  listener: (protocol: ImageProtocol | undefined) => void,
): () => void {
  const caps = tD()
  const notify = () => listener(getImageProtocol())
  const unsubs = [
    caps.onSettle('kittyGraphics', notify),
    caps.onSettle('itermImages', notify),
  ]
  return () => {
    for (const unsub of unsubs) unsub()
  }
}

export type TmuxPassthroughMode = 'on' | 'all' | 'off'

export type TmuxPaneState = {
  passthrough: TmuxPassthroughMode
  hasFocusEvents: boolean
  isPlaced: boolean
  top: number
  left: number
}

export type TmuxPaneQueryResult = {
  termtype: string
  pane: TmuxPaneState
  hasPassthroughOption: boolean
}

export const TMUX_PANE_STALE_MS = 1500

const TMUX_ERR_NEED_OPTIONS =
  'images inside tmux need tmux 3.3 or later with allow-passthrough and focus-events on: run `tmux set -g allow-passthrough on` and `tmux set -g focus-events on`, detach and attach tmux again, then restart Claude Code'
const TMUX_ERR_OLD_TMUX =
  'images inside tmux need tmux 3.3 or later, with kitty 0.28 or later, Ghostty, or iTerm2 3.5 or later as the terminal outside it: update tmux, then end every tmux session so the new version runs (`tmux kill-server` ends them all, and Claude Code with them), start tmux again, run `tmux set -g allow-passthrough on` and `tmux set -g focus-events on`, detach and attach again, then start Claude Code'
const TMUX_ERR_BAD_OUTER =
  'images inside tmux need kitty 0.28 or later, Ghostty, or iTerm2 3.5 or later as the terminal outside tmux: attach tmux from one of those, run `tmux set -g allow-passthrough on` and `tmux set -g focus-events on`, detach and attach again, then restart Claude Code'
const TMUX_ERR_UNKNOWN_OUTER =
  'tmux does not know which terminal is outside it, so Claude Code draws no images here: attach tmux from kitty 0.28 or later, Ghostty, or iTerm2 3.5 or later, run `tmux set -g allow-passthrough on` and `tmux set -g focus-events on`, detach and attach again, then restart Claude Code'
const TMUX_ERR_NO_REPLY =
  'tmux did not say whether it passes images through; restart Claude Code to ask again'
const TMUX_ERR_NO_XTVERSION =
  "the terminal did not answer Claude Code's version query, so tmux was not asked whether it passes images through; restart Claude Code to ask again"
const TMUX_ERR_NO_PANE =
  'TMUX_PANE is not set (as in a tmux popup), so Claude Code cannot ask tmux about this pane; run Claude Code in a tmux pane to draw images'
const TMUX_ERR_NOT_TMUX =
  'TMUX is set, but the terminal did not answer as tmux; if this is not a tmux pane, unset TMUX and restart Claude Code'

const TMUX_DISPLAY_FORMAT = [
  '#{client_termtype}',
  '#{allow-passthrough}',
  '#{focus-events}',
  '#{pane_top}',
  '#{pane_left}',
  '#{status}',
  '#{status-position}',
  '#{window_bigger}',
].join('\t')

/** Official 2.1.310 `POr` — XTVERSION allows kitty graphics (kitty >=0.28 / ghostty). */
export function xtversionAllowsKittyGraphics(
  name: string | null | undefined,
): boolean {
  if (name === null || name === undefined || name === '') return false
  if (name.startsWith('kitty(')) {
    const parsed = coerce(name.slice(6))
    return parsed !== null && gte(parsed.version, '0.28.0')
  }
  return (
    name === 'kitty' ||
    name === 'ghostty' ||
    name.startsWith('kitty ') ||
    name.startsWith('ghostty ')
  )
}

/** Official 2.1.310 `H` — parse tmux display-message pane facts. */
export function parseTmuxPaneInfo(
  stdout: string,
): TmuxPaneQueryResult | undefined {
  const parts = stdout.replace(/\r?\n$/, '').split('\t')
  const [
    termtype,
    passthroughRaw,
    focusEvents,
    topStr,
    leftStr,
    status,
    statusPos,
  ] = parts
  const windowBigger = parts[7]
  if (
    parts.length !== 8 ||
    termtype === undefined ||
    passthroughRaw === undefined ||
    topStr === undefined ||
    leftStr === undefined ||
    status === undefined ||
    !/^\d+$/.test(topStr) ||
    !/^\d+$/.test(leftStr)
  ) {
    return undefined
  }
  const statusRows =
    status === 'on' ? 1 : /^[2-5]$/.test(status) ? Number(status) : 0
  const topOffset = statusPos === 'top' ? statusRows : 0
  const passthrough: TmuxPassthroughMode =
    passthroughRaw === 'on' || passthroughRaw === '1'
      ? 'on'
      : passthroughRaw === 'all'
        ? 'all'
        : 'off'
  return {
    termtype,
    pane: {
      passthrough,
      hasFocusEvents: focusEvents === '1',
      isPlaced: windowBigger !== '1',
      top: Number(topStr) + topOffset,
      left: Number(leftStr),
    },
    hasPassthroughOption: passthroughRaw !== '',
  }
}

/** Official 2.1.310 `eOs` — query tmux pane passthrough & placement facts. */
export async function queryTmuxPaneInfo(): Promise<
  TmuxPaneQueryResult | undefined
> {
  try {
    const paneArgs = process.env.TMUX_PANE ? ['-t', process.env.TMUX_PANE] : []
    const { stdout } = await execFileAsync(
      'tmux',
      ['display-message', '-p', ...paneArgs, TMUX_DISPLAY_FORMAT],
      { timeout: 1000 },
    )
    return parseTmuxPaneInfo(stdout)
  } catch {
    return undefined
  }
}

/** Official 2.1.310 `jYi` — decide kittyGraphics/itermImages inside tmux. */
export function evaluateTmuxImageCapabilities(
  facts: TmuxPaneQueryResult | undefined,
  env: { versionName: string | undefined; hasPane: boolean },
): {
  kittyGraphics: { value: boolean; source: string }
  itermImages: { value: boolean; source: string }
} {
  const isTmux = env.versionName?.startsWith('tmux ') === true
  const outerTerm =
    facts === undefined || facts.termtype === '' ? null : facts.termtype
  const allowsKitty = xtversionAllowsKittyGraphics(outerTerm)
  const allowsIterm = !allowsKitty && isIterm2VersionAtLeast35(outerTerm)

  if (
    !isTmux ||
    !env.hasPane ||
    facts === undefined ||
    facts.pane.passthrough === 'off' ||
    !facts.pane.hasFocusEvents
  ) {
    const source =
      env.versionName === undefined
        ? TMUX_ERR_NO_XTVERSION
        : !isTmux
          ? TMUX_ERR_NOT_TMUX
          : !env.hasPane
            ? TMUX_ERR_NO_PANE
            : facts === undefined
              ? TMUX_ERR_NO_REPLY
              : !facts.hasPassthroughOption
                ? TMUX_ERR_OLD_TMUX
                : allowsKitty || allowsIterm
                  ? TMUX_ERR_NEED_OPTIONS
                  : outerTerm === null
                    ? TMUX_ERR_UNKNOWN_OUTER
                    : `${TMUX_ERR_BAD_OUTER}; tmux says it is ${outerTerm}`
    const reading = { value: false, source }
    return { kittyGraphics: reading, itermImages: reading }
  }

  const baseSource =
    outerTerm === null
      ? `tmux passthrough ${facts.pane.passthrough}, but tmux does not know which terminal is outside`
      : `tmux passthrough ${facts.pane.passthrough}, outer terminal ${outerTerm}`
  const itermIssue = !allowsIterm
    ? undefined
    : facts.pane.passthrough === 'all'
      ? 'iTerm2 pictures need `tmux set -g allow-passthrough on`, not `all`; then restart Claude Code'
      : !facts.pane.isPlaced
        ? 'the tmux window is bigger than this terminal, so Claude Code cannot tell where on screen to draw iTerm2 pictures; make the window fit, then restart Claude Code'
        : undefined
  return {
    kittyGraphics: { value: allowsKitty, source: baseSource },
    itermImages: {
      value: allowsIterm && itermIssue === undefined,
      source:
        itermIssue === undefined ? baseSource : `${baseSource}: ${itermIssue}`,
    },
  }
}

/** Official 2.1.310 `WYi` — whether tmux pane placement is fresh enough to draw. */
export function isTmuxPaneFresh(
  isTmux: boolean,
  answeredAt: number | undefined,
  now: number,
): boolean {
  return (
    !isTmux ||
    (answeredAt !== undefined &&
      now >= answeredAt &&
      now - answeredAt <= TMUX_PANE_STALE_MS)
  )
}
