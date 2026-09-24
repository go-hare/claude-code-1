/**
 * densable 2.1.251 bv — XTVERSION (+ tmux client_termtype) then DECRQM(2026).
 * Gold: official-251 SEA @189654676.
 */

import { spawn } from 'child_process'
import { DEC } from './termio/dec.js'
import { type TerminalQuerier, decrqm, xtversion } from './terminal-querier.js'
import { setSynchronizedOutputSupported, setXtversionName } from './terminal.js'

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
  const [decrpm] = await Promise.all([
    skipDecrqm
      ? Promise.resolve(undefined)
      : querier.send(decrqm(DEC.SYNCHRONIZED_UPDATE)),
    skipDecrqm ? Promise.resolve() : querier.flush(),
  ])
  const supported = decrpm?.status === 1 || decrpm?.status === 2
  setSynchronizedOutputSupported(supported)
  const skipReason = skipDecrqm
    ? `skipped (${reply ? 'Apple_Terminal' : 'no XTVERSION reply'})`
    : decrpm
      ? `status=${decrpm.status}`
      : 'no reply'
  log(
    `DECRQM(2026): ${skipReason} → sync ${supported ? 'supported' : 'unsupported'}`,
  )
}
