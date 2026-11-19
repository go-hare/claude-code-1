import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import {
  createLSPServerInstance,
  formatLspServerStartFailureWarning,
  subscribeLspStartFailureWarnings,
} from '../../services/lsp/LSPServerInstance.js'
import { spawnPsPidPpid } from '../gitPrepare.js'
import {
  createActivityPipeState,
  handleActivityLine,
} from '../sessionActivity.js'
import { SessionChildSupervisor } from '../sessionChildSupervisor.js'

describe('Wave 323 Group 5B — LSP Startup Warning & Self-Hosted Runner', () => {
  test('#1974 LSP start failure formats actionable warning and notifies listeners immediately', async () => {
    const enoent = Object.assign(new Error('spawn missing-lsp ENOENT'), {
      code: 'ENOENT',
    })
    const wBare = formatLspServerStartFailureWarning(
      'ts-lsp@my-plugin',
      'missing-lsp',
      enoent,
      { isNonInteractive: false },
    )
    expect(wBare).toContain('ts-lsp@my-plugin')
    expect(wBare).toContain('missing-lsp')
    expect(wBare).toContain('PATH')

    const wPath = formatLspServerStartFailureWarning(
      'ts-lsp@my-plugin',
      '/opt/bin/missing-lsp',
      enoent,
      { isNonInteractive: false },
    )
    expect(wPath).toContain('missing-lsp')
    expect(wPath).toContain('at the path the plugin gives')

    const eacces = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })
    const wAcc = formatLspServerStartFailureWarning(
      'ts-lsp@my-plugin',
      '/opt/bin/lsp',
      eacces,
      { isNonInteractive: false },
    )
    expect(wAcc).toContain('executable')
    expect(wAcc).toContain('permission')

    const received: Array<{ server: string; msg: string }> = []
    const unsub = subscribeLspStartFailureWarnings((server, msg) => {
      received.push({ server, msg })
    })
    try {
      const instance = createLSPServerInstance('broken-lsp@demo', {
        command: '/definitely-nonexistent-lsp-binary-w323',
        args: [],
        extensionToLanguage: { '.ts': 'typescript' },
        scope: 'user',
        source: 'demo@mp',
      } as unknown as Parameters<typeof createLSPServerInstance>[1])
      await expect(instance.start()).rejects.toThrow()
      expect(instance.lastStartWarning).toContain('broken-lsp@demo')
      expect(received.length).toBe(1)
      expect(received[0]?.server).toBe('broken-lsp@demo')
    } finally {
      unsub()
    }
  })

  test('#1991 spawnPsPidPpid passes timeout + SIGKILL and trims partial trailing line on signal kill', async () => {
    let seenOpts: Record<string, unknown> | undefined
    const fakeSpawn = (
      _cmd: string,
      _args: readonly string[],
      opts: Record<string, unknown>,
    ) => {
      seenOpts = opts
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
      }
      child.stdout = new EventEmitter()
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('  100   1\n  200 100\n  300'))
        child.emit('close', null, 'SIGKILL')
      })
      return child
    }

    const out = await spawnPsPidPpid(2500, fakeSpawn as never)
    expect(seenOpts?.timeout).toBe(2500)
    expect(seenOpts?.killSignal).toBe('SIGKILL')
    expect(out).toBe('  100   1\n  200 100\n')
  })

  test('#2172 waiting_on_user keeps connector approval in awaiting-action & maxLifetime fires paused release', async () => {
    const state = createActivityPipeState()
    const events: string[] = []
    const handlers = {
      onSessionActivity: (kind: string) => events.push(kind),
    }

    // Mark session initialized (emits initial 'activity')
    handleActivityLine(
      JSON.stringify({ type: 'system', subtype: 'init' }),
      state,
      handlers,
    )
    events.length = 0
    // Receive session_state_changed with waiting_on_user=true (connector approval / sign-in inside running tool)
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'session_state_changed',
        state: 'running',
        waiting_on_user: true,
      }),
      state,
      handlers,
    )
    expect(state.sawWaitingOnUserField).toBe(true)
    expect(events).toEqual(['awaiting-action'])

    // Subsequent assistant/user line while waiting_on_user field is present must NOT clear awaiting-action
    handleActivityLine(
      JSON.stringify({ type: 'assistant', message: { content: [] } }),
      state,
      handlers,
    )
    expect(events).toEqual(['awaiting-action'])

    // When waiting_on_user flips to false, resume activity
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'session_state_changed',
        state: 'running',
        waiting_on_user: false,
      }),
      state,
      handlers,
    )
    expect(events).toEqual(['awaiting-action', 'activity'])

    let maxAgeRequested = 0
    const fakeChild = Object.assign(new EventEmitter(), {
      pid: 99999,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: () => true,
    })
    const sup = new SessionChildSupervisor({
      child: fakeChild as never,
      sessionId: 'sess-w323',
      maxLifetimeMs: 25,
      maxLifetimeGraceMs: 5000,
      sigkillTimeoutMs: 5000,
      sigkillGraceMs: 5000,
      onDebug: () => {},
      onStatus: () => {},
      onMaxLifetimeDeadline: () => {
        maxAgeRequested += 1
      },
      killProcessTree: async () => {},
    })
    try {
      await new Promise(resolve => setTimeout(resolve, 60))
      expect(maxAgeRequested).toBe(1)
    } finally {
      sup.stop()
    }
  })
})
