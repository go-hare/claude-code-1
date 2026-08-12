/**
 * densable 2.1.224 work-hints SSE (uBh/Yjv) + wake queue (ZJl).
 * 1:1 from SEA `/tmp/shr-extract-224/sse-*.js` + `rbh-session.txt` ZJl.
 */
import { resolveRunnerVersion } from './runnerApi.js'

/** densable `Wjv` */
export const SSE_BASE_BACKOFF_MS = 1000
/** densable `Gjv` */
export const SSE_MAX_BACKOFF_MS = 30_000
/** densable `Vjv` */
export const SSE_IDLE_ABORT_MS = 45_000
/** densable `cBh` — post-SSE wake jitter before poll */
export const SSE_WAKE_JITTER_MS = 200

/** densable `lBh` / POLL_WAKE_SOURCE */
export type PollWakeSource = 'POLL' | 'SSE' | 'LOCAL'

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** densable `Sr` — abortable sleep */
export function sleepAbortable(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  if (signal?.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** densable `zjv` — resolve when AbortSignal fires */
export function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

/** densable `Kjv` */
export function abortController(ctrl: AbortController): void {
  ctrl.abort()
}

/**
 * densable `ZJl` — wake queue coordinating poll sleep with SSE/LOCAL wake.
 * SSE wakes are ignored while atCapacity (no free slots).
 */
export class PollWakeQueue {
  private ac = new AbortController()
  private pending: PollWakeSource | null = null
  atCapacity = false

  wake(source: PollWakeSource): void {
    if (source === 'SSE' && this.atCapacity) return
    if (this.pending !== 'SSE') this.pending = source
    this.ac.abort()
  }

  async wait(timeoutMs: number, signal: AbortSignal): Promise<void> {
    if (this.pending !== null || signal.aborted) return
    const wakeSignal = this.ac.signal
    await Promise.race([
      sleepAbortable(timeoutMs, signal),
      waitForAbort(wakeSignal),
    ])
  }

  consume(): PollWakeSource {
    const src = this.pending ?? 'POLL'
    this.pending = null
    this.ac = new AbortController()
    return src
  }
}

/**
 * densable `Yjv` — parse SSE body; fire onWake on `event: work_available`.
 * Idle timeout aborts the stream controller after Vjv without data.
 * Returns true if at least one byte was read (successful connection).
 */
export async function parseWorkHintsSse(
  body: ReadableStream<Uint8Array>,
  onWake: () => void,
  streamCtrl: AbortController,
): Promise<boolean> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let sawData = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const armIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = setTimeout(abortController, SSE_IDLE_ABORT_MS, streamCtrl)
    idleTimer.unref?.()
  }
  armIdle()
  try {
    while (!streamCtrl.signal.aborted) {
      const { done, value } = await reader.read()
      if (done) return sawData
      sawData = true
      armIdle()
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (
          line.startsWith('event:') &&
          line.slice(6).trimStart() === 'work_available'
        ) {
          onWake()
        }
      }
    }
    return sawData
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    reader.releaseLock()
    body.cancel().catch(() => {})
  }
}

export type OpenWorkHintsStreamOpts = {
  baseUrl: string
  runnerId: string
  tokenState: { runnerToken: string }
  onWake: () => void
  onDebug: (msg: string) => void
  signal: AbortSignal
  /** densable `aHt` override */
  runnerVersion?: string
  /** inject fetch for tests */
  fetchImpl?: typeof fetch
}

export type WorkHintsStreamHandle = {
  close: () => void
}

/**
 * densable `uBh` — long-lived reconnecting SSE client for work-hints.
 * Degrades to poll on HTTP errors; exponential backoff Wjv…Gjv with jitter.
 */
export function openWorkHintsStream(
  opts: OpenWorkHintsStreamOpts,
): WorkHintsStreamHandle {
  const fetchFn = opts.fetchImpl ?? fetch
  const version = opts.runnerVersion ?? resolveRunnerVersion()
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/v1/code/runners/self-hosted/runners/${encodeURIComponent(opts.runnerId)}/work-hints/stream`
  let closed = false
  let failures = 0
  let current: AbortController | null = null
  const close = (): void => {
    closed = true
    current?.abort()
  }
  opts.signal.addEventListener('abort', close, { once: true })

  void (async () => {
    while (!closed && !opts.signal.aborted) {
      current = new AbortController()
      try {
        const res = await fetchFn(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${opts.tokenState.runnerToken}`,
            Accept: 'text/event-stream',
            'anthropic-version': '2023-06-01',
            'x-self-hosted-runner-version': version,
          },
          signal: current.signal,
        })
        if (!res.ok || !res.body) {
          opts.onDebug(
            `[runner:hints] stream HTTP ${res.status} — degrading to poll, retrying`,
          )
          res.body?.cancel().catch(() => {})
          throw new Error(`HTTP ${res.status}`)
        }
        opts.onDebug('[runner:hints] stream connected')
        const ok = await parseWorkHintsSse(res.body, opts.onWake, current)
        if (ok) failures = 0
        opts.onDebug('[runner:hints] stream ended — reconnecting')
      } catch (err) {
        if (closed || opts.signal.aborted) break
        if (failures === 0) {
          opts.onDebug(`[runner:hints] stream error: ${errMsg(err)}`)
        }
      }
      failures++
      const cap = Math.min(
        SSE_MAX_BACKOFF_MS,
        SSE_BASE_BACKOFF_MS * 2 ** failures,
      )
      const delay = Math.floor(Math.random() * cap)
      await sleepAbortable(delay, opts.signal)
    }
    opts.signal.removeEventListener('abort', close)
  })()

  return { close }
}

/** densable env gate `CCR_SHR_SSE_HINTS` (hr) */
export function isSseHintsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = env.CCR_SHR_SSE_HINTS
  if (v === undefined || v === '') return false
  const t = v.trim().toLowerCase()
  return t === '1' || t === 'true' || t === 'yes' || t === 'on'
}
