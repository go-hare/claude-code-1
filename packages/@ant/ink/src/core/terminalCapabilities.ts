/**
 * densable 2.1.289 `Jk` / `tD` / `class o` / `class f` / `function d`.
 * Gold: official-289 SEA @192996635–193001438. Do not export minify `o`/`f`/`h`.
 */

import { inkSessionHost } from './instances.js'
import { isJediTermEnv } from './jediTermInput.js'

export type TerminalCapabilityName =
  | 'extendedKeys'
  | 'synchronizedOutput'
  | 'kittyKeyboard'
  | 'kittyGraphics'
  | 'mousePixels'

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
  mousePixels: false,
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
  forced: boolean
}): CapabilitySeed {
  if (input.forced) {
    return { settled: true, source: 'env: CLAUDE_CODE_FORCE_TERMINAL_IMAGES' }
  }
  if (input.bgWorker) return { settled: false, source: 'bg worker' }
  if (input.multiplexed) {
    return { settled: false, source: 'env: inside tmux or screen' }
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

/** densable `d()`. */
export function defaultCapabilityReadings(): CapabilityDefaults {
  const terminal = envTerminalName()
  const bgWorker = isBgSession()
  return {
    extendedKeys: extendedKeysSeed(terminal, bgWorker),
    synchronizedOutput: synchronizedOutputSeed(),
    kittyKeyboard: kittyKeyboardSeed(terminal, bgWorker),
    kittyGraphics: kittyGraphicsSeed({
      terminal,
      bgWorker,
      multiplexed: isMultiplexed(),
      forced: Boolean(process.env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES),
    }),
    mousePixels: mousePixelsSeed({
      terminal,
      bgWorker,
      multiplexed: isMultiplexed(),
    }),
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
