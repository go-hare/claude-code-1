/**
 * densable 2.1.289 `Vg` — XTVERSION + CSI ? u then DECRQM(2026)/kitty/pixels.
 * Gold: official-289 SEA @193269328.
 */

import { spawn } from 'child_process'
import { DEC } from './termio/dec.js'
import { printsUnknownSequences } from './termio/osc.js'
import {
  type TerminalQuerier,
  cellSize,
  decrqm,
  kittyGraphicsQuery,
  kittyKeyboard,
  programStatusQuery,
  xtversion,
} from './terminal-querier.js'
import {
  CAPABILITY_NAMES,
  envTerminalName,
  evaluateTmuxImageCapabilities,
  isIterm2VersionAtLeast35,
  Jk,
  queryTmuxPaneInfo,
  tD,
  type TerminalCapabilityStore,
} from './terminalCapabilities.js'
import {
  setCellPixels,
  setXtversionName,
  xtversionAllowsKittyGraphics,
} from './terminal.js'

const PROBE_TIMEOUT_MS = 2000

async function tmuxClientTermtype(): Promise<string> {
  return new Promise(resolve => {
    const proc = spawn(
      'tmux',
      ['display-message', '-p', '#{client_termtype}'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    let out = ''
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(out)
    }
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        // ignore
      }
      finish()
    }, 1000)
    proc.stdout?.on('data', (chunk: Buffer | string) => {
      out += typeof chunk === 'string' ? chunk : chunk.toString()
    })
    proc.on('error', () => finish())
    proc.on('close', () => finish())
  })
}

/** densable `Xg`. */
function cellPixelsLabel(): string {
  const size = Jk().cellPixels
  return size ? `${size.width}x${size.height}px` : 'size unknown'
}

/** densable `Yg` / `h1` — deadline the capability store if the probe stalls. */
function armProbeDeadline(
  capabilities: TerminalCapabilityStore,
  timeoutMs: number,
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    capabilities.deadline()
  }, timeoutMs)
  timer.unref?.()
  return timer
}

/**
 * densable `Vg(n,u,f=y1)`.
 */
export async function probeTerminalIdentity(
  querier: TerminalQuerier,
  capabilities: TerminalCapabilityStore = tD(),
  log: (message: string) => void = () => {},
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<void> {
  const firstDeadline = armProbeDeadline(capabilities, timeoutMs)
  const tmuxPanePromise = process.env.TMUX
    ? queryTmuxPaneInfo().then(facts => ({ facts, at: performance.now() }))
    : undefined
  const askKeys =
    capabilities.get('extendedKeys').state === 'pending' ||
    capabilities.get('kittyKeyboard').state === 'pending'
  const askProgramStatus = capabilities.get('programStatus').state === 'pending'
  const askXtversion = !printsUnknownSequences()
  const [xtReply, kittyFlags, programStatusReply, flushedKeys] =
    await Promise.all([
      askXtversion ? querier.send(xtversion()) : Promise.resolve(undefined),
      askKeys ? querier.send(kittyKeyboard()) : Promise.resolve(undefined),
      askProgramStatus
        ? querier.send(programStatusQuery()).then(reply => {
            if (reply) {
              capabilities.answer(
                'programStatus',
                true,
                'probe: OSC 7501 reply',
              )
            }
            return reply
          })
        : Promise.resolve(undefined),
      querier.flush(),
    ])
  clearTimeout(firstDeadline)
  if (xtReply) {
    let name = xtReply.name
    if (process.env.TMUX && name.startsWith('tmux ')) {
      const termtype = (await tmuxPanePromise)?.facts?.termtype
      if (termtype) {
        name = termtype
      } else {
        const raw = (await tmuxClientTermtype()).trim()
        if (raw) name = raw
      }
    }
    setXtversionName(name)
    log(`XTVERSION: terminal identified as "${name}"`)
    if (!process.env.TMUX) {
      capabilities.answer(
        'itermImages',
        isIterm2VersionAtLeast35(name),
        `probe: XTVERSION ${name}`,
      )
    }
  } else {
    log('XTVERSION: no reply (terminal ignored query)')
  }
  const flagsNote = kittyFlags
    ? `CSI ? u flags=${kittyFlags.flags}`
    : askKeys
      ? 'no reply to CSI ? u'
      : 'CSI ? u not asked'
  const answeredExtended =
    kittyFlags !== undefined &&
    capabilities.answer('extendedKeys', true, `probe: ${flagsNote}`)
  if (askKeys && (kittyFlags !== undefined || flushedKeys)) {
    capabilities.answer(
      'kittyKeyboard',
      kittyFlags !== undefined,
      `probe: ${flagsNote}`,
    )
  }
  if (askProgramStatus && programStatusReply === undefined && flushedKeys) {
    capabilities.answer(
      'programStatus',
      false,
      'probe: no reply to OSC 7501 ; ?',
    )
  }
  const skipDecrqm = !xtReply || process.env.TERM_PROGRAM === 'Apple_Terminal'
  const askGraphics =
    !skipDecrqm && capabilities.get('kittyGraphics').state === 'pending'
  const askPixels =
    !skipDecrqm && capabilities.get('mousePixels').state === 'pending'
  const secondDeadline = armProbeDeadline(capabilities, timeoutMs)
  const [decrpm, graphics, size, mousePixels, flushed] = await Promise.all([
    skipDecrqm
      ? Promise.resolve(undefined)
      : querier.send(decrqm(DEC.SYNCHRONIZED_UPDATE)),
    askGraphics
      ? querier.send(kittyGraphicsQuery())
      : Promise.resolve(undefined),
    askPixels ? querier.send(cellSize()) : Promise.resolve(undefined),
    askPixels
      ? querier.send(decrqm(DEC.MOUSE_PIXELS))
      : Promise.resolve(undefined),
    skipDecrqm ? Promise.resolve(false) : querier.flush(),
  ])
  if (decrpm) {
    capabilities.answer(
      'synchronizedOutput',
      decrpm.status === 1 || decrpm.status === 2 || decrpm.status === 3,
      `probe: DECRPM 2026 status=${decrpm.status}`,
    )
  }
  if (askGraphics && flushed) {
    const term = Jk().xtversionName ?? envTerminalName()
    capabilities.answer(
      'kittyGraphics',
      graphics !== undefined && xtversionAllowsKittyGraphics(term ?? undefined),
      graphics === undefined
        ? 'probe: no reply to the graphics query'
        : `probe: graphics reply ${graphics.message}, terminal ${term}`,
    )
  }
  if (size) setCellPixels({ width: size.width, height: size.height })
  if (mousePixels) {
    capabilities.answer(
      'mousePixels',
      mousePixels.status === 1 ||
        mousePixels.status === 2 ||
        mousePixels.status === 3,
      `probe: DECRPM 1016 status=${mousePixels.status}, cell ${cellPixelsLabel()}`,
    )
  }
  if (process.env.TMUX) {
    const tmuxEnv = {
      versionName: xtReply?.name,
      hasPane: Boolean(process.env.TMUX_PANE),
    }
    const tmuxReply =
      xtReply?.name.startsWith('tmux ') === true
        ? await tmuxPanePromise
        : undefined
    const facts = tmuxReply?.facts
    const hostState = Jk()
    const prevPane = hostState.tmuxPane
    hostState.tmuxPane =
      facts === undefined || !tmuxEnv.hasPane
        ? prevPane
        : {
            ...facts.pane,
            passthrough: prevPane?.passthrough ?? facts.pane.passthrough,
          }
    hostState.tmuxPaneAnsweredAt =
      facts !== undefined && tmuxEnv.hasPane ? tmuxReply?.at : undefined
    const evaluated = evaluateTmuxImageCapabilities(facts, tmuxEnv)
    capabilities.answer(
      'kittyGraphics',
      evaluated.kittyGraphics.value,
      `probe: ${evaluated.kittyGraphics.source}`,
    )
    capabilities.answer(
      'itermImages',
      evaluated.itermImages.value,
      `probe: ${evaluated.itermImages.source}`,
    )
    log(
      facts === undefined || !tmuxEnv.hasPane
        ? `tmux images: kitty no, iTerm2 no (${evaluated.itermImages.source})`
        : `tmux images: passthrough ${facts.pane.passthrough}, focus events ${facts.pane.hasFocusEvents ? 'on' : 'off'}, kitty ${evaluated.kittyGraphics.value ? 'yes' : 'no'}, iTerm2 ${evaluated.itermImages.value ? 'yes' : 'no'}, pane's top-left at row ${facts.pane.top}, column ${facts.pane.left} (from 0)`,
    )
  }
  clearTimeout(secondDeadline)
  capabilities.deadline()
  log(
    'Terminal capabilities: ' +
      CAPABILITY_NAMES.map(name => {
        const reading = capabilities.get(name)
        const value =
          reading.state === 'settled' ? reading.value : reading.likely
        return `${name}=${value ? 'yes' : 'no'} (${reading.source})`
      }).join('; ') +
      (answeredExtended ? '' : `; terminal said: ${flagsNote}`) +
      (decrpm
        ? ''
        : skipDecrqm
          ? `; DECRQM 2026 not asked (${xtReply ? 'Apple_Terminal' : 'no XTVERSION reply'})`
          : '; no reply to DECRQM 2026'),
  )
}

/** densable `p1` — CSI 16 t again; `qg` if the terminal answers. */
export async function reprobeCellPixels(
  querier: TerminalQuerier,
  log: (message: string) => void,
): Promise<void> {
  const [size] = await Promise.all([querier.send(cellSize()), querier.flush()])
  if (size) {
    setCellPixels({ width: size.width, height: size.height })
    log(`Cell size asked again: ${cellPixelsLabel()}`)
  }
}
