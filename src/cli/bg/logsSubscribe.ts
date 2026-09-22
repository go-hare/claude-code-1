/**
 * densable 2.1.248 #27 `Pqt` @188016977 sha=8ecf9f53059ae080 —
 * subscribe to a bg job, first snapshot / error, 10s stall timeout.
 *
 * Gold: proto subscribe + tail, `$ee("restart")` hint when TSe.
 * Local TSe leftover = DAEMON | BG_SESSIONS (the logs fast-path gate).
 * `xc()` leftover = backgroundServiceLabel().
 * `Ig` @182941621 redacts `cc-daemon-<16 hex>`.
 */
import { feature } from 'bun:bundle'
import { connect, type Socket } from 'net'
import { getControlSocketPath, PROTO_VERSION } from '../../daemon/bgWorker.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'

const SUBSCRIBE_ACK_TIMEOUT_MS = 10_000

const DAEMON_SOCKET_ID_RE = /cc-daemon-[0-9a-f]{16}/g

export function sanitizeDaemonControlError(text: string): string {
  return text.replace(DAEMON_SOCKET_ID_RE, 'cc-daemon-*')
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function daemonSubcommandHint(subcommand: string): string {
  if (feature('DAEMON')) {
    return ` \u2014 run 'claude daemon ${subcommand}'`
  }
  return feature('BG_SESSIONS')
    ? ` \u2014 run 'claude daemon ${subcommand}'`
    : ''
}

/** Gold `xc()` leftover — same body as backgroundServiceLabel(). */
function xc(): string {
  if (feature('DAEMON')) return 'daemon'
  return 'background service'
}

export function stalledSubscribeMessage(): string {
  return `${xc()} did not respond \u2014 it may be stalled${daemonSubcommandHint('restart')}`
}

/**
 * Gold `Pqt(f,a,r,o)` — returns unsubscribe. First snapshot/error wins.
 */
export function subscribeJobStreamTail(
  short: string,
  tail: number,
  onMessage: (msg: Record<string, unknown>) => void,
  onError: (err: string) => void,
): () => void {
  let socket: Socket
  try {
    socket = connect(getControlSocketPath())
  } catch (err) {
    queueMicrotask(() => onError(sanitizeDaemonControlError(errorText(err))))
    return () => {}
  }

  let finished = false
  let gotMessage = false
  const fail = (err: string): void => {
    if (finished) return
    finished = true
    onError(err)
  }

  socket.setTimeout(SUBSCRIBE_ACK_TIMEOUT_MS, () => {
    if (!gotMessage) {
      fail(stalledSubscribeMessage())
      socket.destroy()
    }
  })
  socket.on('error', err => fail(sanitizeDaemonControlError(errorText(err))))
  socket.on('close', () => fail('control socket closed'))
  socket.on('connect', () => {
    socket.write(
      jsonStringify({
        proto: PROTO_VERSION,
        op: 'subscribe',
        short,
        tail,
      }) + '\n',
    )
  })

  let buf = ''
  const onData = (chunk: Buffer): void => {
    buf += chunk.toString()
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!gotMessage) {
        gotMessage = true
        socket.setTimeout(0)
      }
      try {
        const parsed: unknown = jsonParse(line)
        if (parsed && typeof parsed === 'object') {
          const rec = parsed as Record<string, unknown>
          if ('ok' in rec && rec.ok === false) {
            fail(
              typeof rec.error === 'string'
                ? rec.error
                : sanitizeDaemonControlError(errorText(rec.error)),
            )
            return
          }
          onMessage(rec)
        }
      } catch {
        // gold $Qe swallows parse errors
      }
      nl = buf.indexOf('\n')
    }
  }
  socket.on('data', onData)

  return () => {
    finished = true
    socket.off('data', onData)
    socket.destroy()
  }
}
