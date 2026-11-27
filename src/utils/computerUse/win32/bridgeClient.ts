/**
 * Python Bridge Client — manages a long-lived Python subprocess for Windows
 * Computer Use operations.
 *
 * Replaces per-call PowerShell spawning with a persistent Python process
 * that communicates via JSON lines over stdin/stdout.
 *
 * Performance: ~1-5ms per call vs ~200-500ms per PowerShell spawn.
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import * as path from 'path'
import { registerCleanup } from '../../cleanupRegistry.js'
import { getBootstrapSessionHost, HostSlot } from '../../sessionHost.js'

interface BridgeRequest {
  id: number
  method: string
  params: Record<string, unknown>
}

interface BridgeResponse {
  id: number
  result?: unknown
  error?: string
}

type BridgeClientHostState = {
  bridgeProc: ChildProcess | null
  requestId: number
  pendingRequests: Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
    }
  >
  outputBuffer: string
  unregisterCleanup: (() => void) | null
}

const bridgeClientHostSlot = new HostSlot<BridgeClientHostState>(() => ({
  bridgeProc: null,
  requestId: 0,
  pendingRequests: new Map(),
  outputBuffer: '',
  unregisterCleanup: null,
}))

// Process-wide tracking of all hosts with a live Python bridge subprocess so
// process exit/SIGINT/SIGTERM cleanup terminates every host's subprocess.
const activeBridgeStates = new Set<BridgeClientHostState>()

function getBridgeHostState(): BridgeClientHostState {
  return bridgeClientHostSlot.of(getBootstrapSessionHost())
}

const BRIDGE_SYNC_MAX_BUFFER = 64 * 1024 * 1024

function stopBridgeState(
  state: BridgeClientHostState,
  reason = 'Python bridge stopped',
): void {
  const proc = state.bridgeProc
  state.bridgeProc = null
  activeBridgeStates.delete(state)
  const unregister = state.unregisterCleanup
  state.unregisterCleanup = null
  unregister?.()
  if (proc) {
    try {
      proc.stdin?.end()
      proc.kill()
    } catch {}
  }
  const pending = [...state.pendingRequests.values()]
  state.pendingRequests.clear()
  state.outputBuffer = ''
  const err = new Error(reason)
  for (const req of pending) {
    try {
      req.reject(err)
    } catch {}
  }
}

/**
 * Start the Python bridge process if not already running.
 */
export function ensureBridge(): boolean {
  const state = getBridgeHostState()
  if (state.bridgeProc) return true
  try {
    const scriptPath = path.join(__dirname, 'bridge.py')
    const proc = spawn('python', ['-u', scriptPath], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      // LOCAL: keep the Python bridge from flashing a console window on Windows.
      windowsHide: true,
    })
    proc.stdin?.on('error', () => {})
    proc.on('error', err => {
      if (state.bridgeProc === proc) {
        stopBridgeState(state, `Python bridge error: ${err.message}`)
      }
    })
    if (proc.pid == null) {
      stopBridgeState(state, 'Python bridge failed to start')
      return false
    }
    state.bridgeProc = proc
    activeBridgeStates.add(state)
    state.unregisterCleanup?.()
    state.unregisterCleanup = registerCleanup(() => {
      stopBridgeState(state)
    })
    proc.on('exit', (code, signal) => {
      if (state.bridgeProc === proc) {
        stopBridgeState(
          state,
          `Python bridge exited (${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`})`,
        )
      }
    })

    // Read stdout lines asynchronously
    const decoder = new TextDecoder()
    proc.stdout?.on('data', (chunk: Buffer | string) => {
      try {
        state.outputBuffer +=
          typeof chunk === 'string'
            ? chunk
            : decoder.decode(chunk, { stream: true })
        // Process complete lines
        let newlineIdx: number
        while ((newlineIdx = state.outputBuffer.indexOf('\n')) !== -1) {
          const line = state.outputBuffer.slice(0, newlineIdx).trim()
          state.outputBuffer = state.outputBuffer.slice(newlineIdx + 1)
          if (!line) continue
          try {
            const resp: BridgeResponse = JSON.parse(line)
            const pending = state.pendingRequests.get(resp.id)
            if (pending) {
              state.pendingRequests.delete(resp.id)
              if (resp.error) {
                pending.reject(new Error(resp.error))
              } else {
                pending.resolve(resp.result)
              }
            }
          } catch {}
        }
      } catch {}
    })

    return true
  } catch {
    stopBridgeState(state)
    return false
  }
}

/**
 * Send a request to the Python bridge and wait for the response.
 */
export async function call<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs: number = 10000,
): Promise<T> {
  if (!ensureBridge()) {
    throw new Error('Python bridge not available')
  }

  const state = getBridgeHostState()
  const id = ++state.requestId
  const req: BridgeRequest = { id, method, params }

  return new Promise<T>((resolve, reject) => {
    // Timeout
    const timer = setTimeout(() => {
      state.pendingRequests.delete(id)
      reject(new Error(`Bridge call ${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()

    // Clear timeout on resolve/reject
    const origResolve = resolve as (v: unknown) => void
    const origReject = reject
    state.pendingRequests.set(id, {
      resolve: v => {
        clearTimeout(timer)
        origResolve(v)
      },
      reject: e => {
        clearTimeout(timer)
        origReject(e)
      },
    })

    try {
      const stdin = state.bridgeProc?.stdin
      if (!stdin) {
        clearTimeout(timer)
        state.pendingRequests.delete(id)
        reject(new Error('Python bridge stdin is unavailable'))
        return
      }
      stdin.write(JSON.stringify(req) + '\n')
    } catch (err) {
      clearTimeout(timer)
      state.pendingRequests.delete(id)
      reject(new Error(`Bridge write failed: ${err}`))
    }
  })
}

/**
 * Synchronous call — blocks the event loop. Use sparingly.
 * Falls back to PowerShell if bridge is not available.
 */
export function callSync<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs: number = 10000,
): T | null {
  // For sync calls, spawn a one-shot Python process.
  // SECURITY: JSON is passed via stdin (not embedded in -c) to prevent code injection.
  try {
    const scriptPath = path.join(__dirname, 'bridge.py')
    const req = JSON.stringify({ id: 1, method, params })
    const result = spawnSync('python', ['-u', scriptPath], {
      input: req + '\n',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      maxBuffer: BRIDGE_SYNC_MAX_BUFFER,
      timeout: timeoutMs,
      windowsHide: true,
    })
    if (result.error || result.status !== 0) return null
    const out = result.stdout ? result.stdout.toString('utf8').trim() : ''
    if (!out) return null
    const resp: BridgeResponse = JSON.parse(out)
    if (resp.error) throw new Error(resp.error)
    return resp.result as T
  } catch {
    return null
  }
}

/**
 * Kill the bridge process for the current host.
 */
export function stopBridge(): void {
  stopBridgeState(getBridgeHostState())
}

/**
 * Kill all live bridge processes across every host (used on process exit).
 */
export function stopAllBridges(): void {
  for (const state of [...activeBridgeStates]) {
    stopBridgeState(state)
  }
  stopBridge()
}

// NOTE: No process exit handlers here — the platform-level win32.ts
// already registers exit/SIGINT/SIGTERM handlers that call cleanupAll(),
// which includes stopBridge(). Adding handlers here would cause double
// cleanup and duplicate process.exit() calls.
