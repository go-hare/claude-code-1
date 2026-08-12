/**
 * OSC (Operating System Command) Types and Parser
 */

import { Buffer } from 'buffer'
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { BEL, ESC, ESC_TYPE, SEP } from './ansi.js'

/**
 * densable yn / lo — fire-and-capture subprocess without throwing.
 *
 * Uses spawn (not execFile) so stdout/stderr:'ignore' is real (Node execFile
 * has no effective stdio option; densable yn→execa passes stdout/stderr).
 * Timeout via SIGKILL when exceeded.
 */
function execFileNoThrow(
  command: string,
  args: string[],
  options: {
    input?: string
    useCwd?: boolean
    timeout?: number
    /** densable yn opts for wl-copy dual-write — discard child stdio */
    stdout?: 'ignore' | 'pipe'
    stderr?: 'ignore' | 'pipe'
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const {
      input,
      timeout = 2000,
      stdout = 'pipe',
      stderr = 'pipe',
      useCwd,
    } = options
    const proc = spawn(command, args, {
      stdio: [
        input !== undefined ? 'pipe' : 'ignore',
        stdout === 'ignore' ? 'ignore' : 'pipe',
        stderr === 'ignore' ? 'ignore' : 'pipe',
      ],
      // densable yn useCwd — only pin cwd when callers opt in
      ...(useCwd ? { cwd: process.cwd() } : {}),
    })
    let out = ''
    let err = ''
    let settled = false
    const finish = (code: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout: out, stderr: err })
    }
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        // ignore
      }
      finish(1)
    }, timeout)
    if (proc.stdout) {
      proc.stdout.on('data', (chunk: Buffer | string) => {
        out += typeof chunk === 'string' ? chunk : chunk.toString()
      })
    }
    if (proc.stderr) {
      proc.stderr.on('data', (chunk: Buffer | string) => {
        err += typeof chunk === 'string' ? chunk : chunk.toString()
      })
    }
    proc.on('error', () => finish(1))
    proc.on('close', code => finish(code ?? 1))
    if (input !== undefined && proc.stdin) {
      proc.stdin.write(input)
      proc.stdin.end()
    }
  })
}

/**
 * densable `xsc` / `Ob` — truthy if binary is on PATH.
 * Prefer Bun.which when present; fall back to `which` for Node.
 */
async function commandOnPath(bin: string): Promise<boolean> {
  const bunWhich = (
    globalThis as { Bun?: { which?: (c: string) => string | null } }
  ).Bun?.which
  if (typeof bunWhich === 'function') {
    return Boolean(bunWhich(bin))
  }
  const { code } = await execFileNoThrow('which', [bin], { timeout: 2000 })
  return code === 0
}

/**
 * densable `Wt` / local `src/utils/platform.ts` `getPlatform` — clipboard
 * dispatch platform. Ink cannot import `src/*`; keep the densable algorithm
 * here (darwin→macos, win32→windows, linux+/proc/version microsoft|wsl→wsl).
 * Test override: `process.env.__CLAUDE_INK_PLATFORM_TEST__`.
 */
type ClipboardHostPlatform = 'macos' | 'windows' | 'wsl' | 'linux' | 'unknown'

let clipboardHostPlatformCache: ClipboardHostPlatform | undefined

function getClipboardHostPlatform(): ClipboardHostPlatform {
  const testOverride = process.env['__CLAUDE_INK_PLATFORM_TEST__']
  if (
    testOverride === 'macos' ||
    testOverride === 'windows' ||
    testOverride === 'wsl' ||
    testOverride === 'linux' ||
    testOverride === 'unknown'
  ) {
    return testOverride
  }
  if (clipboardHostPlatformCache !== undefined) {
    return clipboardHostPlatformCache
  }
  try {
    if (process.platform === 'darwin') {
      clipboardHostPlatformCache = 'macos'
      return clipboardHostPlatformCache
    }
    if (process.platform === 'win32') {
      clipboardHostPlatformCache = 'windows'
      return clipboardHostPlatformCache
    }
    if (process.platform === 'linux') {
      try {
        // densable Esc + local getPlatform: /proc/version microsoft|wsl → wsl
        const procVersion = readFileSync('/proc/version', {
          encoding: 'utf8',
        }).toLowerCase()
        if (procVersion.includes('microsoft') || procVersion.includes('wsl')) {
          clipboardHostPlatformCache = 'wsl'
          return clipboardHostPlatformCache
        }
      } catch {
        // not WSL / unreadable — fall through to linux
      }
      clipboardHostPlatformCache = 'linux'
      return clipboardHostPlatformCache
    }
    clipboardHostPlatformCache = 'unknown'
    return clipboardHostPlatformCache
  } catch {
    clipboardHostPlatformCache = 'unknown'
    return clipboardHostPlatformCache
  }
}

/** densable O3u — UTF-8 stdin → Set-Clipboard (windows + wsl) */
const POWERSHELL_SET_CLIPBOARD =
  '[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())'

/** densable OB_ — UTF-8 stdout ← Get-Clipboard -Raw (windows + wsl) */
const POWERSHELL_GET_CLIPBOARD =
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw'

/** densable Wsn — SSH session: skip native clipboard (OSC 52 only) */
function isSshSession(): boolean {
  return Boolean(process.env['SSH_CONNECTION'])
}

/** @internal test-only — clear densable Wt cache for clipboard host */
export function _resetClipboardHostPlatformCache(): void {
  clipboardHostPlatformCache = undefined
}

/** @internal test-only densable Wt snapshot for clipboard */
export function _getClipboardHostPlatform(): ClipboardHostPlatform {
  return getClipboardHostPlatform()
}
import type { Action, Color, TabStatusAction } from './types.js'

export const OSC_PREFIX = ESC + String.fromCharCode(ESC_TYPE.OSC)

/** String Terminator (ESC \) - alternative to BEL for terminating OSC */
export const ST = ESC + '\\'

/** Generate an OSC sequence: ESC ] p1;p2;...;pN <terminator>
 * Uses ST terminator for Kitty (avoids beeps), BEL for others */
export function osc(...parts: (string | number)[]): string {
  const terminator = process.env.TERM_PROGRAM === 'kitty' ? ST : BEL
  return `${OSC_PREFIX}${parts.join(SEP)}${terminator}`
}

/**
 * Wrap an escape sequence for terminal multiplexer passthrough.
 * tmux and GNU screen intercept escape sequences; DCS passthrough
 * tunnels them to the outer terminal unmodified.
 *
 * tmux 3.3+ gates this behind `allow-passthrough` (default off). When off,
 * tmux silently drops the whole DCS — no junk, no worse than unwrapped OSC.
 * Users who want passthrough set it in their .tmux.conf; we don't mutate it.
 *
 * Do NOT wrap BEL: raw \x07 triggers tmux's bell-action (window flag);
 * wrapped \x07 is opaque DCS payload and tmux never sees the bell.
 */
export function wrapForMultiplexer(sequence: string): string {
  if (process.env['TMUX']) {
    const escaped = sequence.replaceAll('\x1b', '\x1b\x1b')
    return `\x1bPtmux;${escaped}\x1b\\`
  }
  if (process.env['STY']) {
    return `\x1bP${sequence}\x1b\\`
  }
  return sequence
}

/**
 * Which path setClipboard() will take, based on env state. Synchronous so
 * callers can show an honest toast without awaiting the copy itself.
 *
 * - 'native': densable L3u native utility will run (pbcopy / powershell /
 *   powershell.exe / wl-copy|xclip|xsel dual-write) — high-confidence system
 *   clipboard write. tmux buffer may also be loaded as a bonus.
 * - 'tmux-buffer': tmux load-buffer will run, but no native tool — paste
 *   with prefix+] works. System clipboard depends on tmux's set-clipboard
 *   option + outer terminal OSC 52 support; can't know from here.
 * - 'osc52': only the raw OSC 52 sequence will be written to stdout.
 *   Best-effort; iTerm2 disables OSC 52 by default.
 *
 * Native gating uses densable Wt() host (not darwin-only) and SSH_CONNECTION
 * specifically, not SSH_TTY — tmux panes inherit SSH_TTY forever even after
 * local reattach, but SSH_CONNECTION is in tmux's default update-environment
 * set and gets cleared. Must stay in sync with copyNative / setClipboard.
 */
export type ClipboardPath = 'native' | 'tmux-buffer' | 'osc52'

export function getClipboardPath(): ClipboardPath {
  // densable L3u runs when !SSH and Wt() ∈ {macos,windows,wsl,linux}
  if (!process.env['SSH_CONNECTION']) {
    const host = getClipboardHostPlatform()
    if (
      host === 'macos' ||
      host === 'windows' ||
      host === 'wsl' ||
      host === 'linux'
    ) {
      return 'native'
    }
  }
  if (process.env['TMUX']) return 'tmux-buffer'
  return 'osc52'
}

/**
 * Wrap a payload in tmux's DCS passthrough: ESC P tmux ; <payload> ESC \
 * tmux forwards the payload to the outer terminal, bypassing its own parser.
 * Inner ESCs must be doubled. Requires `set -g allow-passthrough on` in
 * ~/.tmux.conf; without it, tmux silently drops the whole DCS (no regression).
 */
function tmuxPassthrough(payload: string): string {
  return `${ESC}Ptmux;${payload.replaceAll(ESC, ESC + ESC)}${ST}`
}

/**
 * Load text into tmux's paste buffer via `tmux load-buffer`.
 * -w (tmux 3.2+) propagates to the outer terminal's clipboard via tmux's
 * own OSC 52 emission. -w is dropped for iTerm2: tmux's OSC 52 emission
 * crashes the iTerm2 session over SSH.
 *
 * Returns true if the buffer was loaded successfully.
 */
export async function tmuxLoadBuffer(text: string): Promise<boolean> {
  if (!process.env['TMUX']) return false
  const args =
    process.env['LC_TERMINAL'] === 'iTerm2'
      ? ['load-buffer', '-']
      : ['load-buffer', '-w', '-']
  const { code } = await execFileNoThrow('tmux', args, {
    input: text,
    useCwd: false,
    timeout: 2000,
  })
  return code === 0
}

/**
 * OSC 52 clipboard write: ESC ] 52 ; c ; <base64> BEL/ST
 * 'c' selects the clipboard (vs 'p' for primary selection on X11).
 *
 * When inside tmux ($TMUX set), `tmux load-buffer -w -` is the primary
 * path. tmux's buffer is always reachable — works over SSH, survives
 * detach/reattach, immune to stale env vars. The -w flag (tmux 3.2+) tells
 * tmux to also propagate to the outer terminal via its own OSC 52 path,
 * which tmux wraps correctly for the attached client. On older tmux, -w is
 * ignored and the buffer is still loaded. -w is dropped for iTerm2 (#22432)
 * because tmux's own OSC 52 emission (empty selection param: ESC]52;;b64)
 * crashes iTerm2 over SSH.
 *
 * After load-buffer succeeds, we ALSO return a DCS-passthrough-wrapped
 * OSC 52 for the caller to write to stdout. Our sequence uses explicit `c`
 * (not tmux's crashy empty-param variant), so it sidesteps the #22432 path.
 * With `allow-passthrough on` + an OSC-52-capable outer terminal, selection
 * reaches the system clipboard; with either off, tmux silently drops the
 * DCS and prefix+] still works. See Greg Smith's "free pony" in
 * https://anthropic.slack.com/archives/C07VBSHV7EV/p1773177228548119.
 *
 * If load-buffer fails entirely, fall through to raw OSC 52.
 *
 * Outside tmux, write raw OSC 52 to stdout (caller handles the write).
 *
 * Local (no SSH_CONNECTION): also shell out to a native clipboard utility.
 * OSC 52 and tmux -w both depend on terminal settings — iTerm2 disables
 * OSC 52 by default, VS Code shows a permission prompt on first use. Native
 * utilities (pbcopy/wl-copy/xclip/xsel/clip.exe) always work locally. Over
 * SSH these would write to the remote clipboard — OSC 52 is the right path there.
 *
 * Returns the sequence for the caller to write to stdout (raw OSC 52
 * outside tmux, DCS-wrapped inside).
 */
/**
 * densable `jCu=76` — GNU screen DCS passthrough chunk size for OSC 52 base64.
 * A single long OSC 52 inside one DCS is mis-parsed by screen and prints the
 * base64 payload into the terminal (2.1.219 #11). Chunk at 76 chars and
 * re-open DCS between segments.
 */
export const SCREEN_OSC52_B64_CHUNK = 76

/**
 * densable `$T` screen branch:
 *   `\x1bP` + `\x1b]52;c;` + chunks joined by `\x1b\\\x1bP` + BEL + `\x1b\\`
 * Each chunk is raw base64 (no ESC inside), so screen forwards cleanly.
 */
export function formatScreenOsc52Clipboard(b64: string): string {
  const chunks: string[] = []
  for (let i = 0; i < b64.length; i += SCREEN_OSC52_B64_CHUNK) {
    chunks.push(b64.slice(i, i + SCREEN_OSC52_B64_CHUNK))
  }
  // densable: `${JY}P${JY}]52;c;${i.join(`${Nas}${JY}P`)}${Oj}${Nas}`
  // JY=ESC, Nas=ST (\x1b\\), Oj=BEL
  return `${ESC}P${ESC}]52;c;${chunks.join(`${ST}${ESC}P`)}${BEL}${ST}`
}

export async function setClipboard(text: string): Promise<string> {
  const b64 = Buffer.from(text, 'utf8').toString('base64')
  const raw = osc(OSC.CLIPBOARD, 'c', b64)

  // Native safety net — fire FIRST, before the tmux await, so a quick
  // focus-switch after selecting doesn't race pbcopy. Previously this ran
  // AFTER awaiting tmux load-buffer, adding ~50-100ms of subprocess latency
  // before pbcopy even started — fast cmd+tab → paste would beat it
  // (https://anthropic.slack.com/archives/C07VBSHV7EV/p1773943921788829).
  // Gated on SSH_CONNECTION (not SSH_TTY) since tmux panes inherit SSH_TTY
  // forever but SSH_CONNECTION is in tmux's default update-environment and
  // clears on local attach. Fire-and-forget.
  if (!process.env['SSH_CONNECTION']) copyNative(text)

  const tmuxBufferLoaded = await tmuxLoadBuffer(text)

  // Inner OSC uses BEL directly (not osc()) — ST's ESC would need doubling
  // too, and BEL works everywhere for OSC 52.
  if (tmuxBufferLoaded) {
    // densable tmux: raw OSC + DCS-passthrough of the same OSC
    const inner = `${ESC}]52;c;${b64}${BEL}`
    return inner + tmuxPassthrough(inner)
  }

  // densable 2.1.219 #11: GNU screen ($STY) — chunked DCS, not wrapForMultiplexer.
  // wrapForMultiplexer doubles ESC inside a single DCS; screen still dumps
  // long base64. densable `$T` uses jCu=76 chunked re-open instead.
  if (process.env['STY'] && !process.env['TMUX']) {
    return formatScreenOsc52Clipboard(b64)
  }

  return raw
}

// densable kDe — Linux clipboard tool: undefined = not yet probed, null = none.
// densable Xws probe: WAYLAND_DISPLAY→wl-copy else DISPLAY→xclip/xsel.
let linuxCopy: 'wl-copy' | 'xclip' | 'xsel' | null | undefined
// densable D3u — generation counter so a newer copy aborts a stale primary write
let waylandCopyGen = 0

/**
 * densable Xws — probe once which Linux native clipboard tool is available.
 * Env-gated (not fire-and-write probe): WAYLAND_DISPLAY first, then DISPLAY.
 */
async function probeLinuxClipboardTool(): Promise<void> {
  // densable Xws: only on Wt()==="linux" (not wsl)
  if (getClipboardHostPlatform() !== 'linux' || typeof linuxCopy === 'string') {
    return
  }
  if (process.env['WAYLAND_DISPLAY'] && (await commandOnPath('wl-copy'))) {
    linuxCopy = 'wl-copy'
    return
  }
  if (process.env['DISPLAY']) {
    if (await commandOnPath('xclip')) {
      linuxCopy = 'xclip'
      return
    }
    if (await commandOnPath('xsel')) {
      linuxCopy = 'xsel'
      return
    }
  }
  linuxCopy = null
}

/**
 * densable DB_ — sequential wl-copy clipboard then --primary.
 * Generation counter aborts primary write if a newer copy started.
 */
async function copyWaylandClipboardAndPrimary(text: string): Promise<void> {
  const gen = ++waylandCopyGen
  const opts = {
    input: text,
    useCwd: false,
    timeout: 2000,
    stdout: 'ignore' as const,
    stderr: 'ignore' as const,
  }
  await execFileNoThrow('wl-copy', [], opts)
  if (gen !== waylandCopyGen) return
  await execFileNoThrow('wl-copy', ['--primary'], opts)
}

/**
 * densable L3u — shell out to a native clipboard utility as OSC 52 safety net.
 * Only called when not in an SSH session (over SSH, these would write to
 * the remote machine's clipboard — OSC 52 is the right path there).
 * Fire-and-forget at call site; densable 2.1.224 #15: Linux dual-writes
 * CLIPBOARD then PRIMARY so Wayland selection paste works without race.
 */
function copyNative(text: string): void {
  const opts = { input: text, useCwd: false, timeout: 2000 }
  // densable L3u: switch(Wt()) — not process.platform
  switch (getClipboardHostPlatform()) {
    case 'macos':
      void execFileNoThrow('pbcopy', [], opts)
      return
    case 'linux': {
      if (linuxCopy === null) return
      if (typeof linuxCopy !== 'string') {
        // densable: if(typeof kDe!=="string")Xws().then(()=>{if(typeof kDe==="string")L3u(e)})
        void probeLinuxClipboardTool().then(() => {
          if (typeof linuxCopy === 'string') copyNative(text)
        })
        return
      }
      if (linuxCopy === 'wl-copy') {
        void copyWaylandClipboardAndPrimary(text)
        return
      }
      if (linuxCopy === 'xclip') {
        // densable: dual fire clipboard + primary (xclip does not need await race fix)
        void execFileNoThrow('xclip', ['-selection', 'clipboard'], opts)
        void execFileNoThrow('xclip', ['-selection', 'primary'], opts)
        return
      }
      if (linuxCopy === 'xsel') {
        void execFileNoThrow('xsel', ['--clipboard', '--input'], opts)
        void execFileNoThrow('xsel', ['--primary', '--input'], opts)
        return
      }
      return
    }
    case 'wsl': {
      // densable L3u wsl: powershell.exe + O3u → Windows host clipboard
      void execFileNoThrow(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SET_CLIPBOARD],
        opts,
      )
      return
    }
    case 'windows': {
      // densable L3u windows: powershell + O3u (SEA has no clip.exe)
      void execFileNoThrow(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SET_CLIPBOARD],
        opts,
      )
      return
    }
  }
}

/**
 * densable `Ksn` — read native clipboard/primary selection text.
 * Used by middle-click (linux primary) and right-click paste (linux/wsl/windows).
 * SSH returns "" (OSC 52 path owns remote sessions).
 *
 * @param selection densable default "clipboard"; "primary" for linux middle-click
 */
export async function readNativeClipboard(
  selection: 'clipboard' | 'primary' = 'clipboard',
): Promise<string> {
  // densable: if(Wsn())return""
  if (isSshSession()) return ''
  const opts = { useCwd: false, timeout: 2000 }
  switch (getClipboardHostPlatform()) {
    case 'macos': {
      const r = await execFileNoThrow('pbpaste', [], opts)
      return r.code === 0 ? r.stdout : ''
    }
    case 'windows':
    case 'wsl': {
      // densable: powershell.exe on wsl, powershell on windows + OB_
      const bin =
        getClipboardHostPlatform() === 'wsl' ? 'powershell.exe' : 'powershell'
      const r = await execFileNoThrow(
        bin,
        ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_GET_CLIPBOARD],
        opts,
      )
      if (r.code !== 0) return ''
      // densable: replace \r\n → \n, strip one trailing \n
      return r.stdout.replace(/\r\n/g, '\n').replace(/\n$/, '')
    }
    case 'linux': {
      // densable: try wl-paste → xclip → xsel (primary vs clipboard args)
      const primary = selection === 'primary'
      const candidates: Array<[string, string[]]> = [
        [
          'wl-paste',
          primary ? ['--primary', '--no-newline'] : ['--no-newline'],
        ],
        ['xclip', ['-selection', primary ? 'primary' : 'clipboard', '-o']],
        ['xsel', [primary ? '--primary' : '--clipboard', '--output']],
      ]
      for (const [cmd, args] of candidates) {
        const r = await execFileNoThrow(cmd, args, opts)
        if (r.code === 0) return r.stdout
      }
      return ''
    }
    default:
      return ''
  }
}

/** @internal test-only */
export function _resetLinuxCopyCache(): void {
  linuxCopy = undefined
  waylandCopyGen = 0
  _resetClipboardHostPlatformCache()
}

/** @internal test-only densable kDe snapshot */
export function _getLinuxCopyTool(): typeof linuxCopy {
  return linuxCopy
}

/** @internal test-only densable D3u snapshot */
export function _getWaylandCopyGen(): number {
  return waylandCopyGen
}

/**
 * OSC command numbers
 */
export const OSC = {
  SET_TITLE_AND_ICON: 0,
  SET_ICON: 1,
  SET_TITLE: 2,
  SET_COLOR: 4,
  SET_CWD: 7,
  HYPERLINK: 8,
  ITERM2: 9, // iTerm2 proprietary sequences
  SET_FG_COLOR: 10,
  SET_BG_COLOR: 11,
  SET_CURSOR_COLOR: 12,
  CLIPBOARD: 52,
  KITTY: 99, // Kitty notification protocol
  RESET_COLOR: 104,
  RESET_FG_COLOR: 110,
  RESET_BG_COLOR: 111,
  RESET_CURSOR_COLOR: 112,
  SEMANTIC_PROMPT: 133,
  GHOSTTY: 777, // Ghostty notification protocol
  TAB_STATUS: 21337, // Tab status extension
} as const

/**
 * Parse an OSC sequence into an action
 *
 * @param content - The sequence content (without ESC ] and terminator)
 */
export function parseOSC(content: string): Action | null {
  const semicolonIdx = content.indexOf(';')
  const command = semicolonIdx >= 0 ? content.slice(0, semicolonIdx) : content
  const data = semicolonIdx >= 0 ? content.slice(semicolonIdx + 1) : ''

  const commandNum = parseInt(command, 10)

  // Window/icon title
  if (commandNum === OSC.SET_TITLE_AND_ICON) {
    return { type: 'title', action: { type: 'both', title: data } }
  }
  if (commandNum === OSC.SET_ICON) {
    return { type: 'title', action: { type: 'iconName', name: data } }
  }
  if (commandNum === OSC.SET_TITLE) {
    return { type: 'title', action: { type: 'windowTitle', title: data } }
  }

  // Hyperlinks (OSC 8)
  if (commandNum === OSC.HYPERLINK) {
    const parts = data.split(';')
    const paramsStr = parts[0] ?? ''
    const url = parts.slice(1).join(';')

    if (url === '') {
      return { type: 'link', action: { type: 'end' } }
    }

    const params: Record<string, string> = {}
    if (paramsStr) {
      for (const pair of paramsStr.split(':')) {
        const eqIdx = pair.indexOf('=')
        if (eqIdx >= 0) {
          params[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1)
        }
      }
    }

    return {
      type: 'link',
      action: {
        type: 'start',
        url,
        params: Object.keys(params).length > 0 ? params : undefined,
      },
    }
  }

  // Tab status (OSC 21337)
  if (commandNum === OSC.TAB_STATUS) {
    return { type: 'tabStatus', action: parseTabStatus(data) }
  }

  return { type: 'unknown', sequence: `\x1b]${content}` }
}

/**
 * Parse an XParseColor-style color spec into an RGB Color.
 * Accepts `#RRGGBB` and `rgb:R/G/B` (1–4 hex digits per component, scaled
 * to 8-bit). Returns null on parse failure.
 */
export function parseOscColor(spec: string): Color | null {
  const hex = spec.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (hex) {
    return {
      type: 'rgb',
      r: parseInt(hex[1]!, 16),
      g: parseInt(hex[2]!, 16),
      b: parseInt(hex[3]!, 16),
    }
  }
  const rgb = spec.match(
    /^rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})$/i,
  )
  if (rgb) {
    // XParseColor: N hex digits → value / (16^N - 1), scale to 0-255
    const scale = (s: string) =>
      Math.round((parseInt(s, 16) / (16 ** s.length - 1)) * 255)
    return {
      type: 'rgb',
      r: scale(rgb[1]!),
      g: scale(rgb[2]!),
      b: scale(rgb[3]!),
    }
  }
  return null
}

/**
 * Parse OSC 21337 payload: `key=value;key=value;...` with `\;` and `\\`
 * escapes inside values. Bare key or `key=` clears that field; unknown
 * keys are ignored.
 */
function parseTabStatus(data: string): TabStatusAction {
  const action: TabStatusAction = {}
  for (const [key, value] of splitTabStatusPairs(data)) {
    switch (key) {
      case 'indicator':
        action.indicator = value === '' ? null : parseOscColor(value)
        break
      case 'status':
        action.status = value === '' ? null : value
        break
      case 'status-color':
        action.statusColor = value === '' ? null : parseOscColor(value)
        break
    }
  }
  return action
}

/** Split `k=v;k=v` honoring `\;` and `\\` escapes. Yields [key, unescapedValue]. */
function* splitTabStatusPairs(data: string): Generator<[string, string]> {
  let key = ''
  let val = ''
  let inVal = false
  let esc = false
  for (const c of data) {
    if (esc) {
      if (inVal) val += c
      else key += c
      esc = false
    } else if (c === '\\') {
      esc = true
    } else if (c === ';') {
      yield [key, val]
      key = ''
      val = ''
      inVal = false
    } else if (c === '=' && !inVal) {
      inVal = true
    } else if (inVal) {
      val += c
    } else {
      key += c
    }
  }
  if (key || inVal) yield [key, val]
}

// Output generators

/** Start a hyperlink (OSC 8). Auto-assigns an id= param derived from the URL
 *  so terminals group wrapped lines of the same link together (the spec says
 *  cells with matching URI *and* nonempty id are joined; without an id each
 *  wrapped line is a separate link — inconsistent hover, partial tooltips).
 *  Empty url = close sequence (empty params per spec). */
export function link(url: string, params?: Record<string, string>): string {
  if (!url) return LINK_END
  const p = { id: osc8Id(url), ...params }
  const paramStr = Object.entries(p)
    .map(([k, v]) => `${k}=${v}`)
    .join(':')
  return osc(OSC.HYPERLINK, paramStr, url)
}

function osc8Id(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++)
    h = ((h << 5) - h + url.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** End a hyperlink (OSC 8) */
export const LINK_END = osc(OSC.HYPERLINK, '', '')

// iTerm2 OSC 9 subcommands

/** iTerm2 OSC 9 subcommand numbers */
export const ITERM2 = {
  NOTIFY: 0,
  BADGE: 2,
  PROGRESS: 4,
} as const

/** Progress operation codes (for use with ITERM2.PROGRESS) */
export const PROGRESS = {
  CLEAR: 0,
  SET: 1,
  ERROR: 2,
  INDETERMINATE: 3,
} as const

/**
 * Clear iTerm2 progress bar sequence (OSC 9;4;0;BEL)
 * Uses BEL terminator since this is for cleanup (not runtime notification)
 * and we want to ensure it's always sent regardless of terminal type.
 */
export const CLEAR_ITERM2_PROGRESS = `${OSC_PREFIX}${OSC.ITERM2};${ITERM2.PROGRESS};${PROGRESS.CLEAR};${BEL}`

/**
 * Clear terminal title sequence (OSC 0 with empty string + BEL).
 * Uses BEL terminator for cleanup — safe on all terminals.
 */
export const CLEAR_TERMINAL_TITLE = `${OSC_PREFIX}${OSC.SET_TITLE_AND_ICON};${BEL}`

/** Clear all three OSC 21337 tab-status fields. Used on exit. */
export const CLEAR_TAB_STATUS = osc(
  OSC.TAB_STATUS,
  'indicator=;status=;status-color=',
)

/**
 * Gate for emitting OSC 21337 (tab-status indicator). Ant-only while the
 * spec is unstable. Terminals that don't recognize it discard silently, so
 * emission is safe unconditionally — we don't gate on terminal detection
 * since support is expected across several terminals.
 *
 * Callers must wrap output with wrapForMultiplexer() so tmux/screen
 * DCS-passthrough carries the sequence to the outer terminal.
 */
export function supportsTabStatus(): boolean {
  return process.env.USER_TYPE === 'ant'
}

/**
 * Emit an OSC 21337 tab-status sequence. Omitted fields are left unchanged
 * by the receiving terminal; `null` sends an empty value to clear.
 * `;` and `\` in status text are escaped per the spec.
 */
export function tabStatus(fields: TabStatusAction): string {
  const parts: string[] = []
  const rgb = (c: Color) =>
    c.type === 'rgb'
      ? `#${[c.r, c.g, c.b].map(n => n.toString(16).padStart(2, '0')).join('')}`
      : ''
  if ('indicator' in fields)
    parts.push(`indicator=${fields.indicator ? rgb(fields.indicator) : ''}`)
  if ('status' in fields)
    parts.push(
      `status=${fields.status?.replaceAll('\\', '\\\\').replaceAll(';', '\\;') ?? ''}`,
    )
  if ('statusColor' in fields)
    parts.push(
      `status-color=${fields.statusColor ? rgb(fields.statusColor) : ''}`,
    )
  return osc(OSC.TAB_STATUS, parts.join(';'))
}
