/**
 * densable 2.1.235 #1 — ispell-pipe spellchecker lifecycle (AuE / DCc / ihg).
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { homedir } from 'os'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { createSignal } from '../signal.js'
import { logForDebugging } from '../debug.js'
import { subprocessEnv } from '../subprocessEnv.js'
import { which } from '../which.js'
import {
  SPELLCHECK_CHECKERS,
  SPELLCHECK_TERSE_HANDSHAKE,
  buildSpellcheckArgs,
  formatSpellcheckRequest,
  isSpellcheckLanguageName,
  parseSpellcheckBanner,
  parseSpellcheckResponseLine,
  type SpellcheckCheckerName,
  type SpellcheckCheckerOrAuto,
} from './protocol.js'

/** densable RuE / xuE / IuE / PuE / thg / DuE / LuE / HuE / NuE / FuE / OCc */
const BANNER_TIMEOUT_MS = 3000
const DEFAULT_RESPONSE_TIMEOUT_MS = 15_000
const RESTART_DELAY_MS = 1000
const MAX_RESTARTS = 1
const MAX_SLOW_BATCHES = 3
const MAX_WORD_BYTES = 128
const BATCH_RESET_EVERY = 20
const MAX_STDIN_BYTES = 4096
const MAX_OUTPUT_BUF = 65_536
const MAX_CACHE = 10_000
const LOG_TRUNCATE = 80

const BATCH_LIMIT: Record<SpellcheckCheckerName, number> = {
  aspell: 256,
  hunspell: 16,
  ispell: 256,
}

/** densable MuE — skip control / whitespace tokens before enqueue. */
const SKIP_WORD_RE = /[\s\p{Cc}]/u

type CheckerStatus =
  | { status: 'idle' }
  | { status: 'resolving' }
  | { status: 'unavailable' }
  | {
      status: 'starting' | 'ready'
      process: ChildProcessWithoutNullStreams
      backend?: SpellcheckCheckerName
    }

export type SpellcheckVerdicts = {
  isMisspelled: (word: string) => boolean | undefined
}

type HostSlot = {
  key: string | undefined
  checker: SpellcheckChecker | undefined
}

const hostSlots = new WeakMap<object, HostSlot>()

function slotOf(host: object): HostSlot {
  let s = hostSlots.get(host)
  if (!s) {
    s = { key: undefined, checker: undefined }
    hostSlots.set(host, s)
  }
  return s
}

function truncateForLog(text: string, max = LOG_TRUNCATE): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  const sliced = text.slice(0, max)
  const code = sliced.charCodeAt(max - 1)
  // Avoid orphan high surrogate (Io)
  return code >= 0xd800 && code <= 0xdbff ? sliced.slice(0, -1) : sliced
}

function unrefMaybe(stream: unknown): void {
  if (
    typeof stream === 'object' &&
    stream !== null &&
    'unref' in stream &&
    typeof (stream as { unref?: unknown }).unref === 'function'
  ) {
    ;(stream as { unref: () => void }).unref()
  }
}

function killCheckerProcess(proc: ChildProcessWithoutNullStreams): void {
  try {
    proc.stdin?.end()
  } catch {
    /* ignore */
  }
  if (
    typeof proc.exitCode === 'number' ||
    typeof proc.signalCode === 'string'
  ) {
    return
  }
  try {
    proc.kill()
  } catch {
    /* ignore */
  }
}

function logSpellcheckEvent(
  reason: string,
  extra?: Record<string, boolean | number | undefined>,
): void {
  logEvent('input_spellcheck', {
    [reason]: true,
    ...extra,
  })
}

export type ResolvedSpellcheckCommand = {
  command: string
  args: string[]
}

/** densable AuE — resolve checker binary on PATH. */
export async function resolveSpellcheckCommand(
  checker: SpellcheckCheckerOrAuto,
  language: string | undefined,
): Promise<ResolvedSpellcheckCommand | null> {
  const candidates: SpellcheckCheckerName[] =
    checker !== 'auto' && SPELLCHECK_CHECKERS.includes(checker)
      ? [checker]
      : [...SPELLCHECK_CHECKERS]

  if (language !== undefined && !isSpellcheckLanguageName(language)) {
    logForDebugging(
      `[spellcheck] ignoring language "${language}" (not a plain dictionary name); the checker's default dictionary applies`,
    )
  }

  for (const name of candidates) {
    const path = await which(name)
    if (path) {
      return { command: path, args: buildSpellcheckArgs(name, language) }
    }
  }

  logForDebugging(
    `[spellcheck] no checker found on PATH (looked for ${candidates.join(', ')}); spell checking stays off`,
  )
  return null
}

export class SpellcheckChecker {
  readonly changed = createSignal()
  #verdicts: SpellcheckVerdicts = this.#makeVerdicts()
  #state: CheckerStatus = { status: 'idle' }
  #disposed = false
  #restarts = 0
  #slowBatches = 0
  #batchesSinceReset = 0
  #restartScheduled = false
  #readyOnce = false
  #lastStderr = ''
  #cache = new Map<string, boolean>()
  #pending = new Set<string>()
  #inFlight: Set<string> | null = null
  #misspelledInFlight = new Set<string>()
  #stdoutBuf = ''
  #timeout: ReturnType<typeof setTimeout> | undefined
  #cleanupRegistration: (() => void) | undefined
  #resolveCommand: () => Promise<ResolvedSpellcheckCommand | null>
  #responseTimeoutMs: number

  constructor(
    resolveCommand: () => Promise<ResolvedSpellcheckCommand | null>,
    options: { responseTimeoutMs?: number } = {},
  ) {
    this.#resolveCommand = resolveCommand
    this.#responseTimeoutMs =
      options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS
  }

  get verdicts(): SpellcheckVerdicts {
    return this.#verdicts
  }

  isMisspelled(word: string): boolean | undefined {
    return this.#cache.get(word)
  }

  #makeVerdicts(): SpellcheckVerdicts {
    return { isMisspelled: (word: string) => this.#cache.get(word) }
  }

  request(words: Iterable<string>): void {
    if (this.#disposed || this.#state.status === 'unavailable') return
    for (const word of words) {
      if (
        !this.#cache.has(word) &&
        !this.#inFlight?.has(word) &&
        word.length > 0 &&
        word.length <= MAX_WORD_BYTES &&
        !SKIP_WORD_RE.test(word)
      ) {
        this.#pending.add(word)
      }
    }
    this.#kick()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#teardownProcess()
    this.#pending.clear()
    this.changed.clear()
  }

  #kick(): void {
    void this.#pump().catch(err => {
      logForDebugging(
        `[spellcheck] internal error: ${err instanceof Error ? err.message : String(err)}`,
        { level: 'error' },
      )
      this.#fail(
        `internal error: ${err instanceof Error ? err.message : String(err)}`,
        'internal_error',
      )
    })
  }

  async #pump(): Promise<void> {
    if (
      this.#disposed ||
      this.#restartScheduled ||
      this.#pending.size === 0 ||
      this.#inFlight
    ) {
      return
    }
    switch (this.#state.status) {
      case 'unavailable':
      case 'resolving':
      case 'starting':
        return
      case 'idle':
        await this.#start()
        return
      case 'ready':
        break
    }

    const backend = this.#state.backend!
    const limit = BATCH_LIMIT[backend]
    const batch: string[] = []
    let bytes = 2 // `^\n`
    for (const word of this.#pending) {
      const add = Buffer.byteLength(word) + 1
      if (batch.length >= limit || bytes + add > MAX_STDIN_BYTES) break
      batch.push(word)
      bytes += add
    }
    for (const word of batch) this.#pending.delete(word)
    this.#inFlight = new Set(batch)
    this.#misspelledInFlight.clear()
    this.#armTimeout(this.#responseTimeoutMs, 'response timeout')
    this.#state.process.stdin?.write(formatSpellcheckRequest(batch))
  }

  async #start(): Promise<void> {
    this.#state = { status: 'resolving' }
    let resolved: ResolvedSpellcheckCommand | null = null
    let lookupFailed = false
    try {
      resolved = await this.#resolveCommand()
    } catch (err) {
      logForDebugging(
        `[spellcheck] could not look for a checker: ${err instanceof Error ? err.message : String(err)}; spell checking stays off`,
        { level: 'warn' },
      )
      resolved = null
      lookupFailed = true
    }
    if (this.#disposed || this.#state.status !== 'resolving') return
    if (!resolved) {
      logSpellcheckEvent(
        lookupFailed ? 'checker_lookup_failed' : 'checker_not_found',
      )
      this.#state = { status: 'unavailable' }
      this.#pending.clear()
      return
    }

    let proc: ChildProcessWithoutNullStreams
    try {
      logForDebugging(
        `[spellcheck] starting ${resolved.command} ${resolved.args.join(' ')}`,
      )
      proc = spawn(resolved.command, resolved.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: subprocessEnv(),
        cwd: homedir(),
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams
    } catch (err) {
      this.#state = { status: 'idle' }
      this.#fail(
        `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
        'checker_failed_to_start',
      )
      return
    }

    this.#state = { status: 'starting', process: proc }
    // Best-effort cleanup registration (densable Ba)
    const onExit = () => this.dispose()
    process.once('exit', onExit)
    this.#cleanupRegistration = () => process.off('exit', onExit)
    proc.unref?.()
    for (const stream of [proc.stdin, proc.stdout, proc.stderr]) {
      unrefMaybe(stream)
    }
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      if (this.#isActive(proc)) this.#onStdout(chunk)
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => {
      const trimmed = chunk.trim()
      if (trimmed) {
        this.#lastStderr = truncateForLog(trimmed, 200)
        logForDebugging(`[spellcheck] stderr: ${this.#lastStderr}`)
      }
    })
    for (const stream of [proc.stdout, proc.stderr]) {
      stream.on('error', (err: Error) => {
        if (this.#isActive(proc)) {
          this.#fail(`stdio error: ${err.message}`, 'checker_crashed')
        }
      })
    }
    proc.on('error', (err: Error) => {
      if (this.#isActive(proc)) {
        this.#fail(`process error: ${err.message}`, 'checker_crashed')
      }
    })
    proc.stdin?.on('error', (err: Error) => {
      if (this.#isActive(proc)) {
        this.#fail(`stdin error: ${err.message}`, 'checker_crashed')
      }
    })
    proc.on('exit', (code, signal) => {
      if (!this.#isActive(proc)) return
      const hint = this.#readyOnce
        ? ''
        : `; last stderr: ${this.#lastStderr || 'none'} (a missing dictionary usually means spellcheck.language needs setting)`
      this.#fail(
        `checker exited (code ${code}, signal ${signal})${hint}`,
        this.#readyOnce ? 'checker_crashed' : 'checker_failed_to_start',
      )
    })
    this.#armTimeout(BANNER_TIMEOUT_MS, 'banner timeout')
  }

  #isActive(proc: ChildProcessWithoutNullStreams): boolean {
    return (
      (this.#state.status === 'starting' || this.#state.status === 'ready') &&
      this.#state.process === proc
    )
  }

  #onStdout(chunk: string): void {
    this.#stdoutBuf += chunk
    let nl = this.#stdoutBuf.indexOf('\n')
    while (nl !== -1) {
      const line = this.#stdoutBuf.slice(0, nl).replace(/\r$/, '')
      this.#stdoutBuf = this.#stdoutBuf.slice(nl + 1)
      this.#onLine(line)
      if (this.#state.status !== 'starting' && this.#state.status !== 'ready') {
        return
      }
      nl = this.#stdoutBuf.indexOf('\n')
    }
    if (this.#stdoutBuf.length > MAX_OUTPUT_BUF) {
      this.#fail('output line too long', 'checker_protocol_error')
      return
    }
    if (this.#state.status === 'ready' && !this.#inFlight) this.#kick()
  }

  #onLine(line: string): void {
    if (this.#state.status === 'starting') {
      const backend = parseSpellcheckBanner(line)
      if (!backend) {
        this.#fail(
          `unexpected banner: ${truncateForLog(line)}`,
          'checker_failed_to_start',
        )
        return
      }
      if (this.#timeout) clearTimeout(this.#timeout)
      this.#state = {
        status: 'ready',
        process: this.#state.process,
        backend,
      }
      this.#state.process.stdin?.write(SPELLCHECK_TERSE_HANDSHAKE)
      if (!this.#readyOnce) {
        this.#readyOnce = true
        logEvent('input_spellcheck', {
          backend:
            backend as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
      logForDebugging(`[spellcheck] ${backend} ready`)
      return
    }

    if (!this.#inFlight) {
      this.#fail(
        `unexpected output: ${truncateForLog(line)}`,
        'checker_protocol_error',
      )
      return
    }

    const parsed = parseSpellcheckResponseLine(line)
    switch (parsed.type) {
      case 'correct':
        return
      case 'misspelled':
        this.#misspelledInFlight.add(parsed.word)
        return
      case 'unrecognized':
        this.#fail(
          `unrecognized output: ${truncateForLog(line)}`,
          'checker_protocol_error',
        )
        return
      case 'end': {
        if (this.#stdoutBuf !== '') {
          this.#fail(
            'output past the end of a response',
            'checker_protocol_error',
          )
          return
        }
        if (this.#timeout) clearTimeout(this.#timeout)
        this.#commitBatch(this.#inFlight, this.#misspelledInFlight)
        this.#inFlight = null
        this.#misspelledInFlight.clear()
        this.#batchesSinceReset++
        if (this.#batchesSinceReset >= BATCH_RESET_EVERY) {
          this.#batchesSinceReset = 0
          this.#restarts = 0
          this.#slowBatches = 0
        }
        this.#kick()
        return
      }
    }
  }

  #commitBatch(words: Set<string>, misspelled: Set<string>): void {
    if (this.#cache.size + words.size > MAX_CACHE) {
      let drop = Math.ceil(this.#cache.size / 2)
      for (const key of this.#cache.keys()) {
        if (drop-- <= 0) break
        this.#cache.delete(key)
      }
    }
    for (const word of words) {
      this.#cache.set(word, misspelled.has(word))
    }
    this.#verdicts = this.#makeVerdicts()
    this.changed.emit()
  }

  #armTimeout(ms: number, label: string): void {
    if (this.#timeout) clearTimeout(this.#timeout)
    this.#timeout = setTimeout(() => this.#onTimeout(label), ms)
    this.#timeout.unref?.()
  }

  #onTimeout(label: string): void {
    if (this.#state.status !== 'ready' || !this.#inFlight) {
      this.#fail(label, 'checker_failed_to_start')
      return
    }
    this.#slowBatches++
    this.#batchesSinceReset = 0
    logForDebugging(
      `[spellcheck] no answer for ${this.#inFlight.size} words within ${this.#responseTimeoutMs}ms; skipping them (${this.#slowBatches}/${MAX_SLOW_BATCHES})`,
      { level: 'warn' },
    )
    const words = this.#inFlight
    const miss = new Set(this.#misspelledInFlight)
    this.#inFlight = null
    this.#misspelledInFlight.clear()
    this.#commitBatch(words, miss)
    if (this.#slowBatches >= MAX_SLOW_BATCHES) {
      this.#disable(label, 'checker_too_slow')
      return
    }
    this.#teardownProcess()
    this.#kick()
  }

  #teardownProcess(): void {
    if (this.#timeout) clearTimeout(this.#timeout)
    this.#restartScheduled = false
    this.#cleanupRegistration?.()
    this.#cleanupRegistration = undefined
    const prev = this.#state
    this.#state = { status: 'idle' }
    this.#stdoutBuf = ''
    if (this.#inFlight) {
      for (const word of this.#inFlight) this.#pending.add(word)
      this.#inFlight = null
      this.#misspelledInFlight.clear()
    }
    if (prev.status === 'starting' || prev.status === 'ready') {
      killCheckerProcess(prev.process)
    }
  }

  #fail(message: string, reason: string): void {
    if (this.#disposed || this.#state.status === 'unavailable') return
    this.#teardownProcess()
    this.#batchesSinceReset = 0
    if (this.#restarts < MAX_RESTARTS) {
      this.#restarts++
      logForDebugging(`[spellcheck] ${message}; restarting once`, {
        level: 'warn',
      })
      this.#restartScheduled = true
      this.#timeout = setTimeout(() => {
        this.#restartScheduled = false
        this.#kick()
      }, RESTART_DELAY_MS)
      this.#timeout.unref?.()
      return
    }
    this.#disable(message, reason)
  }

  #disable(message: string, reason: string): void {
    logForDebugging(
      `[spellcheck] ${message}; spell checking is off for this session`,
      { level: 'warn' },
    )
    logSpellcheckEvent(reason)
    this.#teardownProcess()
    this.#state = { status: 'unavailable' }
    this.#pending.clear()
  }
}

/** densable DCc — per-host checker keyed by checker:language. */
export function getOrCreateSpellcheckChecker(
  host: object,
  checker: SpellcheckCheckerOrAuto,
  language: string | undefined,
): SpellcheckChecker {
  const slot = slotOf(host)
  const key = `${checker}:${language ?? ''}`
  if (slot.checker && slot.key === key) return slot.checker
  slot.checker?.dispose()
  slot.key = key
  slot.checker = new SpellcheckChecker(() =>
    resolveSpellcheckCommand(checker, language),
  )
  return slot.checker
}

/** densable ohg */
export function disposeSpellcheckChecker(host: object): void {
  const slot = slotOf(host)
  slot.checker?.dispose()
  slot.key = undefined
  slot.checker = undefined
}
