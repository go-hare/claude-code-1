/**
 * densable 2.1.251 bv — XTVERSION (+ tmux client_termtype) then DECRQM(2026).
 * Gold: official-251 SEA @189654676.
 */

import { spawn } from 'child_process'
import { DEC } from './termio/dec.js'
import {
  type TerminalQuerier,
  cellSize,
  decrqm,
  kittyGraphicsQuery,
  xtversion,
} from './terminal-querier.js'
import {
  getXtversionName,
  setCellPixels,
  setKittyGraphicsSupported,
  setMousePixelsSupported,
  setSynchronizedOutputSupported,
  setXtversionName,
  xtversionAllowsKittyGraphics,
} from './terminal.js'

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

/** densable bv(querier). */
export async function probeTerminalIdentity(
  querier: TerminalQuerier,
  log: (message: string) => void,
): Promise<void> {
  const [reply] = await Promise.all([
    querier.send(xtversion()),
    querier.flush(),
  ])
  if (reply) {
    let name = reply.name
    if (process.env.TMUX && name.startsWith('tmux ')) {
      const raw = (await tmuxClientTermtype()).trim()
      if (raw) name = raw
    }
    setXtversionName(name)
    log(`XTVERSION: terminal identified as "${name}"`)
  } else {
    log('XTVERSION: no reply (terminal ignored query)')
  }
  const skipDecrqm = !reply || process.env.TERM_PROGRAM === 'Apple_Terminal'
  const [decrpm, graphics, size, mousePixels, flushed] = await Promise.all([
    skipDecrqm
      ? Promise.resolve(undefined)
      : querier.send(decrqm(DEC.SYNCHRONIZED_UPDATE)),
    skipDecrqm
      ? Promise.resolve(undefined)
      : querier.send(kittyGraphicsQuery()),
    skipDecrqm ? Promise.resolve(undefined) : querier.send(cellSize()),
    skipDecrqm
      ? Promise.resolve(undefined)
      : querier.send(decrqm(DEC.MOUSE_PIXELS)),
    skipDecrqm ? Promise.resolve(false) : querier.flush().then(() => true),
  ])
  const supported = decrpm?.status === 1 || decrpm?.status === 2
  setSynchronizedOutputSupported(supported)
  if (size) setCellPixels({ width: size.width, height: size.height })
  const pixelsSupported =
    mousePixels?.status === 1 ||
    mousePixels?.status === 2 ||
    mousePixels?.status === 3
  setMousePixelsSupported(pixelsSupported)
  const termName = getXtversionName() ?? undefined
  if (!skipDecrqm && flushed) {
    if (graphics === undefined) {
      log('probe: no reply to the graphics query')
      setKittyGraphicsSupported(false)
    } else {
      log(
        `probe: graphics reply ${graphics.message}, terminal ${termName ?? ''}`,
      )
      setKittyGraphicsSupported(xtversionAllowsKittyGraphics(termName))
    }
  }
  const skipReason = skipDecrqm
    ? `skipped (${reply ? 'Apple_Terminal' : 'no XTVERSION reply'})`
    : decrpm
      ? `status=${decrpm.status}`
      : 'no reply'
  log(
    `DECRQM(2026): ${skipReason} → sync ${supported ? 'supported' : 'unsupported'}`,
  )
  if (mousePixels) {
    const cell =
      size && size.width > 0 && size.height > 0
        ? `${size.width}x${size.height}px`
        : 'size unknown'
    log(`probe: DECRPM 1016 status=${mousePixels.status}, cell ${cell}`)
  }
}

/** densable `p1` — CSI 16 t again; `qg` if the terminal answers. */
export async function reprobeCellPixels(
  querier: TerminalQuerier,
  log: (message: string) => void,
): Promise<void> {
  const [size] = await Promise.all([querier.send(cellSize()), querier.flush()])
  if (size) {
    setCellPixels({ width: size.width, height: size.height })
    log(`Cell size asked again: ${size.width}x${size.height}px`)
  }
}
