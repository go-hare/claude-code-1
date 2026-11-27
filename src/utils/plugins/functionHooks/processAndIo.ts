/**
 * Function hooks submodule: processAndIo
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { logForDebugging } from '../../debug.js'
import { isPluginFsNetworkOrDevicePath } from '../../path.js'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import {
  AUDIO_CLIP_BYTES,
  AUDIO_GAIN_MAX,
  AUDIO_PLAYS_AT_ONCE,
  HOST_TEXT_LIMIT,
  HTTP_FETCH_BODY_LIMIT,
  HTTP_FETCH_TIMEOUT_MS,
  PROCESS_RUN_CAPTURE_BYTES,
  PROCESS_RUN_DEFAULT_TIMEOUT_MS,
  PROCESS_RUN_KILL_GRACE_MS,
  PROCESS_RUN_TIMEOUT_CAP_MS,
  PROCESS_SPAWN_HIGH_WATER,
  argvFrom,
  isAbortSignal,
  isEventRecord,
} from './constants.js'
import { resolveSessionAuthHandle } from './settingsAndEnv.js'
import { activeHookServingAls, fhState } from './state.js'
import type {
  ProcessRunCapture,
  SessionAuthHandleEntry,
  SpawnQueueItem,
} from './types.js'

export async function resolvePluginFsBaseCwd(cwd?: unknown): Promise<string> {
  if (typeof cwd === 'string' && cwd !== '') return cwd
  const servingCwd = activeHookServingAls.getStore()?.cwd
  if (typeof servingCwd === 'string' && servingCwd !== '') return servingCwd
  try {
    const { getCwd } = await import('../../cwd.js')
    return getCwd()
  } catch {
    return process.cwd()
  }
}

/**
 * densable: every `$.fs` op refuses a network or device path before touching
 * the filesystem. `list` already did; read/write/stat/exists/ancestors share it.
 */
export async function refusePluginFsNetworkPath(
  rawPath: string,
  op: string,
  plugin?: string,
  cwd?: string,
): Promise<void> {
  const baseCwd = await resolvePluginFsBaseCwd(cwd)
  const target = resolve(baseCwd, rawPath)
  let projectRoot: string | null = null
  try {
    const { getProjectRoot } = await import('../../../bootstrap/state.js')
    projectRoot = getProjectRoot()
  } catch {
    projectRoot = null
  }
  if (
    isPluginFsNetworkOrDevicePath(rawPath, projectRoot) ||
    isPluginFsNetworkOrDevicePath(target, projectRoot)
  ) {
    const who = plugin !== undefined && plugin !== '' ? `${plugin}: ` : ''
    throw new Error(
      `${who}$.${op}: ${rawPath} refused: a network location is not reached from here`,
    )
  }
}

function captureProcessStream(
  stream: NodeJS.ReadableStream | null | undefined,
  cap: number,
): Promise<ProcessRunCapture> {
  if (stream == null) {
    return Promise.resolve({ text: '', isTruncated: false })
  }
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let taken = 0
    let truncated = false
    let settled = false
    const onData = (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      const room = cap - taken
      if (buf.byteLength > room) truncated = true
      if (room <= 0) return
      const slice = truncated ? buf.subarray(0, room) : buf
      chunks.push(slice)
      taken += slice.byteLength
    }
    const finish = () => {
      if (settled) return
      settled = true
      stream.off('data', onData)
      const joined = Buffer.concat(chunks)
      resolve({
        text: truncated
          ? new TextDecoder().decode(joined, { stream: true })
          : joined.toString('utf8'),
        isTruncated: truncated,
      })
    }
    stream.on('data', onData)
    stream.once('end', finish)
    stream.once('error', finish)
    stream.once('close', finish)
  })
}

function processRunFailedLine(err: unknown): string {
  const code =
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : undefined
  const message = err instanceof Error ? err.message : String(err)
  return `failed to start: ${code === undefined ? message : `${code}: ${message}`}`
}

export async function runProcess(
  argv: unknown,
  init: Record<string, unknown> | undefined,
  plugin?: string,
): Promise<{
  exitCode: number
  stdout: string
  stderr: string
  isStdoutTruncated: boolean
  isStderrTruncated: boolean
}> {
  const command = argvFrom(argv)
  const empty = {
    exitCode: 1,
    stdout: '',
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  }
  if (command.length === 0) return empty
  const { spawn } = await import('child_process')
  let baseCwd = process.cwd()
  try {
    const { getCwd } = await import('../../cwd.js')
    baseCwd = getCwd()
  } catch {
    // fallback to process.cwd()
  }
  const cwd =
    typeof init?.cwd === 'string' ? resolve(baseCwd, init.cwd) : baseCwd
  const timeoutMs = Math.min(
    typeof init?.timeoutMs === 'number'
      ? init.timeoutMs
      : PROCESS_RUN_DEFAULT_TIMEOUT_MS,
    PROCESS_RUN_TIMEOUT_CAP_MS,
  )
  const bin = command[0]!
  const prefix =
    plugin !== undefined && plugin !== ''
      ? `${plugin}: $.process.run(${bin}) `
      : `$.process.run(${bin}) `
  const child = spawn(bin, command.slice(1), {
    cwd,
    env: isEventRecord(init?.env)
      ? { ...process.env, ...(init.env as Record<string, string>) }
      : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let timedOut = false
  let aborted = false
  const timer = setTimeout(() => {
    timedOut = true
    aborted = true
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
    }, PROCESS_RUN_KILL_GRACE_MS).unref()
    child.stdout?.destroy()
    child.stderr?.destroy()
  }, timeoutMs)
  timer.unref()
  if (typeof init?.stdin === 'string' && child.stdin !== null) {
    child.stdin.once('error', () => {})
    child.stdin.end(init.stdin)
  } else {
    child.stdin?.end()
  }
  try {
    const closed = new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', code => resolve(code ?? 1))
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      captureProcessStream(child.stdout, PROCESS_RUN_CAPTURE_BYTES),
      captureProcessStream(child.stderr, PROCESS_RUN_CAPTURE_BYTES),
      closed,
    ])
    if (aborted && timedOut) {
      throw new Error(`${prefix}aborted: still running after ${timeoutMs}ms`)
    }
    if (aborted) {
      throw new Error(`${prefix}aborted`)
    }
    return {
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      isStdoutTruncated: stdout.isTruncated,
      isStderrTruncated: stderr.isTruncated,
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(prefix)) throw err
    throw new Error(`${prefix}${processRunFailedLine(err)}`)
  } finally {
    clearTimeout(timer)
  }
}

export function validateProcessSpawnRequest(req: unknown): string | undefined {
  if (!isEventRecord(req)) {
    return 'takes { argv, cwd?, env?, input? }'
  }
  const { argv, cwd, env, input } = req
  if (
    !Array.isArray(argv) ||
    argv.length === 0 ||
    argv.some(a => typeof a !== 'string')
  ) {
    return 'argv must be a non-empty list of strings'
  }
  if (cwd !== undefined && (typeof cwd !== 'string' || cwd === '')) {
    return 'cwd is a non-empty path'
  }
  if (
    env !== undefined &&
    (!isEventRecord(env) || Object.values(env).some(v => typeof v !== 'string'))
  ) {
    return 'env must be a record of strings'
  }
  if (input !== undefined && typeof input !== 'string') {
    return 'input is a string'
  }
  return undefined
}

/**
 * Official `F1s` — streaming `$.process.spawn` generator yielding
 * `{ stream: 'stdout' | 'stderr', text }` chunks with 1 MiB backpressure
 * and returning `{ code, signal }`.
 */
export async function* spawnProcessStream(
  req: {
    argv: string[]
    cwd?: string
    env?: Record<string, string>
    input?: string
  },
  plugin: string,
  opts: { signal?: AbortSignal; cwd?: string } = {},
): AsyncGenerator<
  { stream: 'stdout' | 'stderr'; text: string },
  { code: number | null; signal: NodeJS.Signals | null },
  unknown
> {
  const [command = '', ...args] = req.argv
  const baseCwd = opts.cwd ?? (await resolvePluginFsBaseCwd())
  const resolvedCwd =
    req.cwd === undefined ? baseCwd : resolve(baseCwd, req.cwd)
  const label = `$.process.spawn (${plugin})`
  const startedAt = Date.now()
  const queue: SpawnQueueItem[] = []
  let bufferedBytes = 0
  let paused = false
  let chunkCount = 0
  let wake: (() => void) | undefined

  const push = (item: SpawnQueueItem) => {
    queue.push(item)
    wake?.()
  }

  if (opts.signal?.aborted === true) {
    throw new Error(`${label}: ${command} aborted`)
  }

  const { spawn } = await import('child_process')
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(command, args, {
      cwd: resolvedCwd,
      env: req.env ? { ...process.env, ...req.env } : process.env,
      stdio: [req.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logForDebugging(`${label}: ${command} ${msg}`, { level: 'warn' })
    throw new Error(`${label}: ${command} ${msg}`)
  }

  const streams = [child.stdout, child.stderr]
  let killed = false
  const killChild = (graceMs = 300) => {
    if (killed) return false
    killed = true
    try {
      child.kill('SIGTERM')
    } catch {
      return false
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // already exited
      }
    }, graceMs)
    timer.unref?.()
    return true
  }

  logForDebugging(
    `${label}: ${command} with ${args.length} args in ${resolvedCwd} (pid ${child.pid ?? '?'})`,
  )

  const setFlow = (flowing: boolean) => {
    paused = !flowing
    for (const s of streams) {
      if (flowing) s?.resume()
      else s?.pause()
    }
  }

  const attachStream = (
    stream: NodeJS.ReadableStream | null | undefined,
    kind: 'stdout' | 'stderr',
  ) => {
    if (!stream) return
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      if (chunk === '') return
      bufferedBytes += chunk.length
      push({ stream: kind, text: chunk })
      if (bufferedBytes > PROCESS_SPAWN_HIGH_WATER && !paused) {
        setFlow(false)
      }
    })
    stream.once('error', () => {})
  }

  attachStream(child.stdout, 'stdout')
  attachStream(child.stderr, 'stderr')
  child.once('error', err => {
    const msg = err instanceof Error ? err.message : String(err)
    logForDebugging(`${label}: ${command} ${msg}`, { level: 'warn' })
    push({ failed: new Error(`${label}: ${command} ${msg}`) })
  })
  child.once('close', (code, signal) => {
    push({ ended: { code, signal } })
  })

  const onAbort = () => {
    const didKill = killChild()
    queue.length = 0
    push({ failed: new Error(`${label}: ${command} aborted`) })
    if (didKill) {
      logForDebugging(`${label}: ${command} stopped: the op was aborted`)
    }
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  if (req.input !== undefined && child.stdin !== null) {
    child.stdin.once('error', () => {})
    child.stdin.end(req.input)
  }

  try {
    while (true) {
      const item = queue.shift()
      if (item === undefined) {
        await new Promise<void>(r => {
          wake = r
        })
        wake = undefined
        continue
      }
      if ('failed' in item) throw item.failed
      if ('ended' in item) {
        const { ended } = item
        logForDebugging(
          `${label}: ${command} ended (${ended.code ?? ended.signal}) in ${Date.now() - startedAt}ms, ${chunkCount} chunks`,
        )
        return ended
      }
      bufferedBytes -= item.text.length
      chunkCount += 1
      if (paused && bufferedBytes <= PROCESS_SPAWN_HIGH_WATER) {
        setFlow(true)
      }
      yield item
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
    if (!killed && killChild()) {
      logForDebugging(
        `${label}: ${command} stopped after ${Date.now() - startedAt}ms: the stream was let go`,
      )
    }
  }
}

async function readHttpFetchResponseBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const body = response.body
  if (body === null) return ''
  if (body === undefined || typeof body.getReader !== 'function') {
    const text = await response.text()
    const buf = Buffer.from(text, 'utf8')
    return buf.byteLength > maxBytes
      ? new TextDecoder().decode(buf.subarray(0, maxBytes))
      : text
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - total
      if (value.byteLength >= remaining) {
        chunks.push(value.subarray(0, remaining))
        total += remaining
        await reader.cancel()
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export async function fetchHttp(
  url: string,
  init?: Record<string, unknown>,
  plugin?: string,
): Promise<{
  ok: boolean
  status: number
  headers: Record<string, string>
  text: string
}> {
  const owner = plugin ?? ''
  const prefix = owner !== '' ? `${owner}: ` : ''
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error(`${prefix}$.http.fetch: not a URL: ${String(url)}`)
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(
      `${prefix}$.http.fetch: ${parsedUrl.href} refused: http or https only`,
    )
  }
  if (parsedUrl.username !== '' || parsedUrl.password !== '') {
    throw new Error(
      `${prefix}$.http.fetch: ${parsedUrl.host} refused: credentials in the URL`,
    )
  }
  let authEntry: SessionAuthHandleEntry | undefined
  if (init?.auth !== undefined) {
    if (
      process.env.CLAUDE_CODE_EVAL_CONFINED === '1' ||
      Boolean(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)
    ) {
      throw new Error(
        `${prefix}$.http.fetch: refused: the session's credential is withheld: nonessential network traffic is disabled for this session`,
      )
    }
    authEntry = resolveSessionAuthHandle(owner, String(init.auth))
    if (authEntry === undefined) {
      throw new Error(
        `${prefix}$.http.fetch: unknown auth handle; $.session.authorize() mints one`,
      )
    }
  }
  if (
    typeof init?.body === 'string' &&
    init.body.length > HTTP_FETCH_BODY_LIMIT
  ) {
    throw new Error(
      `${prefix}$.http.fetch: ${parsedUrl.href} refused: a request body of ${init.body.length} characters is over the ${HTTP_FETCH_BODY_LIMIT}-character limit`,
    )
  }
  const callerHeaders: Record<string, string> = {}
  if (isEventRecord(init?.headers)) {
    for (const [k, v] of Object.entries(init.headers)) {
      if (k.toLowerCase() === 'host') continue
      callerHeaders[k] = String(v)
    }
  }
  const mergedHeaders =
    authEntry !== undefined &&
    parsedUrl.protocol === 'https:' &&
    parsedUrl.host === authEntry.host
      ? { ...callerHeaders, ...authEntry.headers }
      : callerHeaders
  const timeoutMs =
    typeof init?.timeoutMs === 'number' &&
    Number.isFinite(init.timeoutMs) &&
    init.timeoutMs > 0
      ? Math.min(init.timeoutMs, HTTP_FETCH_TIMEOUT_MS)
      : HTTP_FETCH_TIMEOUT_MS
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const method = (
      typeof init?.method === 'string' ? init.method : 'GET'
    ).toUpperCase()
    const response = await fetch(parsedUrl.href, {
      method: typeof init?.method === 'string' ? init.method : undefined,
      headers:
        Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: controller.signal,
    })
    const contentLength = Number(response.headers.get('content-length'))
    if (
      method !== 'HEAD' &&
      response.status !== 204 &&
      response.status !== 205 &&
      response.status !== 304 &&
      Number.isFinite(contentLength) &&
      contentLength > HTTP_FETCH_BODY_LIMIT
    ) {
      await response.body?.cancel()
      throw new Error(
        `${prefix}$.http.fetch: ${parsedUrl.href} refused: body of ${contentLength} bytes is over the ${HTTP_FETCH_BODY_LIMIT}-byte limit`,
      )
    }
    const text = await readHttpFetchResponseBody(
      response,
      HTTP_FETCH_BODY_LIMIT,
      controller.signal,
    )
    return {
      ok: response.ok,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      text,
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith(`${prefix}$.http.fetch:`)
    ) {
      throw err
    }
    if (timedOut) {
      throw new Error(
        `${prefix}$.http.fetch(${parsedUrl.href}) aborted: no complete answer within ${timeoutMs}ms`,
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function runAudioPlay(
  input: Record<string, unknown>,
  plugin?: string,
): Promise<unknown> {
  const clip = input.clip
  if (!isEventRecord(input) || !isEventRecord(clip)) {
    throw new Error(
      '$.audio.play: clip must be { asset }, { url } or { base64, mime }',
    )
  }
  const present = (['asset', 'url', 'base64'] as const).filter(
    key => clip[key] !== undefined,
  )
  const kind = present[0]
  if (kind === undefined || present.length !== 1) {
    throw new Error(
      `$.audio.play: clip must carry exactly one of asset, url, base64 (got ${present.length === 0 ? 'none' : present.join(' and ')})`,
    )
  }
  if (typeof clip[kind] !== 'string' || clip[kind] === '') {
    throw new Error(`$.audio.play: clip.${kind} must be a non-empty string`)
  }
  if (kind === 'base64') {
    if (typeof clip.mime !== 'string') {
      throw new Error('$.audio.play: clip.mime must accompany clip.base64')
    }
    if (
      typeof clip.base64 === 'string' &&
      Buffer.byteLength(clip.base64, 'base64') > AUDIO_CLIP_BYTES
    ) {
      throw new Error(
        `$.audio.play: the clip is over ${AUDIO_CLIP_BYTES} bytes`,
      )
    }
  }
  if (kind === 'asset') {
    if (typeof clip.asset !== 'string') {
      throw new Error('$.audio.play: clip.asset must be a string')
    }
    if (typeof input.root !== 'string') {
      throw new Error('$.audio.play: the plugin has no directory')
    }
  }
  if (input.shouldLoop !== undefined && typeof input.shouldLoop !== 'boolean') {
    throw new Error('$.audio.play: options.shouldLoop must be a boolean')
  }
  if (
    input.gain !== undefined &&
    (typeof input.gain !== 'number' ||
      !Number.isFinite(input.gain) ||
      input.gain < 0 ||
      input.gain > AUDIO_GAIN_MAX)
  ) {
    throw new Error(
      `$.audio.play: options.gain must be a number from 0 to ${AUDIO_GAIN_MAX}`,
    )
  }
  const owner = plugin ?? ''
  const running = fhState().audioPlays.get(owner) ?? 0
  if (running >= AUDIO_PLAYS_AT_ONCE) {
    throw new Error(
      `${owner}: $.audio.play: refused: ${AUDIO_PLAYS_AT_ONCE} plays are going at once`,
    )
  }
  if (kind === 'asset') {
    const asset = String(clip.asset)
    const rel = relative(String(input.root), resolve(String(input.root), asset))
    if (
      asset.trim() === '' ||
      isAbsolute(asset) ||
      rel.startsWith('..') ||
      asset.split(/[\\/]/).includes('..')
    ) {
      throw new Error(
        `$.audio.play: asset must be a path inside the plugin's directory (got ${JSON.stringify(asset)})`,
      )
    }
  }
  fhState().audioPlays.set(owner, running + 1)
  try {
    return await playAudioClip(input, owner)
  } finally {
    fhState().audioPlays.set(owner, (fhState().audioPlays.get(owner) ?? 1) - 1)
  }
}

function audioExtensionOf(mime: string): string {
  switch (mime.split(';')[0]?.trim().toLowerCase()) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3'
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav'
    case 'audio/aac':
      return 'aac'
    case 'audio/ogg':
      return 'ogg'
    default:
      return 'audio'
  }
}

async function materializeAudioClip(
  input: Record<string, unknown>,
  _plugin: string,
): Promise<{ file: string; cleanup: () => Promise<void> }> {
  const clip = input.clip as Record<string, unknown>
  if (typeof clip.asset === 'string') {
    return {
      file: resolve(String(input.root), clip.asset),
      cleanup: async () => {},
    }
  }
  const { mkdtemp, rm, writeFile } = await import('fs/promises')
  const { tmpdir } = await import('os')
  const dir = await mkdtemp(join(tmpdir(), 'claude-audio-'))
  let bytes: Buffer
  let ext = 'audio'
  if (typeof clip.url === 'string') {
    const response = await fetch(clip.url)
    bytes = Buffer.from(await response.arrayBuffer())
    const mime = response.headers.get('content-type') ?? ''
    ext = audioExtensionOf(mime)
  } else {
    bytes = Buffer.from(String(clip.base64), 'base64')
    ext = audioExtensionOf(String(clip.mime ?? ''))
  }
  if (bytes.byteLength > AUDIO_CLIP_BYTES) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    throw new Error(`$.audio.play: the clip is over ${AUDIO_CLIP_BYTES} bytes`)
  }
  const file = join(dir, `clip.${ext}`)
  await writeFile(file, bytes)
  return {
    file,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}),
  }
}

function spawnPluginAudio(
  command: string,
  args: string[],
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const { spawn } = require('child_process') as typeof import('child_process')
    const child = spawn(command, args, {
      stdio: 'ignore',
      windowsHide: true,
    })
    let stopped = false
    const onAbort = () => {
      stopped = true
      child.kill('SIGTERM')
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    child.once('error', error => {
      signal?.removeEventListener('abort', onAbort)
      reject(
        new Error(`${command} failed to start: ${(error as Error).message}`),
      )
    })
    child.once('exit', code => {
      signal?.removeEventListener('abort', onAbort)
      if (code === 0 || stopped) resolvePromise()
      else reject(new Error(`${command} exited ${code ?? 'by signal'}`))
    })
  })
}

/** densable `yzn` — Web Audio, else macOS `afplay`, else no-op. */
async function playAudioClip(
  input: Record<string, unknown>,
  _plugin: string,
): Promise<undefined> {
  const AudioCtor = (globalThis as { Audio?: new (src: string) => unknown })
    .Audio
  if (typeof AudioCtor === 'function') return undefined
  if (process.platform !== 'darwin') return undefined
  const signal = isAbortSignal(input.signal) ? input.signal : undefined
  const { file, cleanup } = await materializeAudioClip(input, _plugin)
  const gain = typeof input.gain === 'number' ? ['-v', String(input.gain)] : []
  try {
    do {
      if (signal?.aborted) return undefined
      await spawnPluginAudio('afplay', [...gain, file], signal)
    } while (
      input.shouldLoop === true &&
      signal !== undefined &&
      !signal.aborted
    )
  } finally {
    await cleanup()
  }
  return undefined
}

export function runAudioSpeak(
  input: Record<string, unknown>,
  _plugin?: string,
): Promise<unknown> {
  if (!isEventRecord(input)) {
    throw new Error('$.audio.speak: text must be a non-empty string')
  }
  if (typeof input.text !== 'string' || input.text.trim() === '') {
    throw new Error('$.audio.speak: text must be a non-empty string')
  }
  if (input.text.length > HOST_TEXT_LIMIT) {
    throw new Error(`$.audio.speak: text over ${HOST_TEXT_LIMIT} characters`)
  }
  if (input.voice !== undefined && typeof input.voice !== 'string') {
    throw new Error('$.audio.speak: voice must be a string when given')
  }
  if (process.platform === 'darwin') {
    const { spawnSync } =
      require('child_process') as typeof import('child_process')
    const argv =
      typeof input.voice === 'string'
        ? ['-v', input.voice, '--', input.text]
        : ['--', input.text]
    spawnSync('say', argv, { stdio: 'ignore' })
    return Promise.resolve({ via: 'system' })
  }
  throw new Error(`$.audio.speak: no speech synthesizer on ${process.platform}`)
}

/** densable `u1n` — walk parents via project-memory files. */
export async function runFsAncestors(
  input: Record<string, unknown>,
  _plugin?: string,
): Promise<
  Array<{
    dir: string
    name: string
    content: string
    parts: Array<{ path: string; content: string }>
  }>
> {
  const names = input.names
  if (!Array.isArray(names)) {
    throw new Error('takes names, a list of relative .md file names')
  }
  for (const field of ['of', 'below'] as const) {
    const value = input[field]
    if (value !== undefined && (typeof value !== 'string' || value === '')) {
      throw new Error(`takes ${field}, a path, when given`)
    }
  }
  for (const name of names) {
    if (typeof name !== 'string' || !name.toLowerCase().endsWith('.md')) {
      throw new Error(
        `takes names, each a .md file name (${JSON.stringify(name)})`,
      )
    }
    if (isAbsolute(name) || name.split(/[\\/]/).includes('..')) {
      throw new Error(`takes names, each relative with no ".." (${name})`)
    }
  }
  const { isSettingSourceEnabled } = await import('../../settings/constants.js')
  if (!isSettingSourceEnabled('projectSettings')) return []
  if (process.env.CLAUDE_CODE_REMOTE) return []
  const { processMemoryFile } = await import('../../claudemd.js')
  const root = await resolvePluginFsBaseCwd(input.cwd)
  if (typeof input.of === 'string' && input.of !== '') {
    await refusePluginFsNetworkPath(input.of, 'fs.ancestors', _plugin, root)
  } else {
    await refusePluginFsNetworkPath(root, 'fs.ancestors', _plugin, root)
  }
  if (typeof input.below === 'string' && input.below !== '') {
    await refusePluginFsNetworkPath(input.below, 'fs.ancestors', _plugin, root)
  }
  const target =
    typeof input.of === 'string' && input.of !== ''
      ? resolve(root, input.of)
      : root
  const start = target === root ? root : dirname(target)
  const resolvedBelow =
    typeof input.below === 'string' && input.below !== ''
      ? resolve(root, input.below)
      : undefined
  const below =
    resolvedBelow !== undefined
      ? resolvedBelow.endsWith(sep)
        ? resolvedBelow
        : `${resolvedBelow}${sep}`
      : undefined
  const dirs: string[] = []
  let dir = start
  const seen = new Set<string>()
  while (!seen.has(dir)) {
    seen.add(dir)
    if (below !== undefined && !dir.startsWith(below)) break
    dirs.push(dir)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const found: Array<{
    dir: string
    name: string
    content: string
    parts: Array<{ path: string; content: string }>
  }> = []
  for (const current of dirs.reverse()) {
    for (const name of names) {
      if (typeof name !== 'string') continue
      const parts = await processMemoryFile(
        join(current, name),
        'Project',
        new Set(),
        false,
      )
      if (parts.length === 0) continue
      found.push({
        dir: current,
        name,
        content: parts.map(part => part.content).join('\n\n'),
        parts: parts.map(part => ({ path: part.path, content: part.content })),
      })
    }
  }
  return found
}
