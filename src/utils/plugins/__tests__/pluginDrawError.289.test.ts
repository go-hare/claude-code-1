/**
 * densable 2.1.289 `Ymn` / `L1t` / `NBr` / `Jmn` / `Bmn` / `O9`.
 * Author toast is Ymn. Debug unattributed is the no-module fallback.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { registerBuiltinPlugin } from '../../../plugins/builtinPlugins.js'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import {
  acquirePluginClient,
  type ClientFaultReport,
  setClientFaultReporter,
} from '../functionHooksClient.js'
import {
  handleHostOp,
  setLoadedFunctionHooksModules,
} from '../functionHooksModules.js'
import { SURFACE_TRAMPOLINE_SOURCE } from '../functionHooksSurfaceRuntime.js'
import {
  Bmn,
  HOOKS_LEAD,
  Imt,
  Jmn,
  L1t,
  NBr,
  O9,
  Ymn,
  pluginFromLead,
  resetDrawErrorNotes,
  tellerOf,
} from '../pluginDrawError.js'

const SRC = readFileSync(join(import.meta.dir, '../pluginDrawError.ts'), 'utf8')
const PANES = readFileSync(
  join(import.meta.dir, '../../../components/PluginRasterPanes.tsx'),
  'utf8',
)

afterEach(() => {
  resetDrawErrorNotes()
  setLoadedFunctionHooksModules([])
  setClientFaultReporter(undefined)
})

describe('densable 2.1.289 Ymn / L1t / Jmn / O9', () => {
  test('Ymn author sentences match gold', () => {
    expect(Ymn.AbovePrompt).toBe('nothing was drawn')
    expect(Ymn.Pane).toBe('the pane was closed')
    expect(SRC).toContain('nothing was drawn')
    expect(SRC).toContain('the pane was closed')
  })

  test('Bmn / Imt: one name is the lead; else hooks', () => {
    expect(Bmn(['band-mod'])).toBe('band-mod')
    expect(Bmn([])).toBe(HOOKS_LEAD)
    expect(Bmn(['a', 'b'])).toBe(HOOKS_LEAD)
    expect(Imt([{ name: 'band-mod', environmentId: 'band-mod' }])).toEqual({
      load: 'band-mod#band-mod',
      lead: 'band-mod',
    })
    expect(tellerOf([]).lead).toBe(HOOKS_LEAD)
  })

  test('L1t: no module is unattributed; loaded lead uses O9', () => {
    const missing = L1t('AbovePrompt', tellerOf(['band-mod']), 'answer')
    expect(missing).toBe(
      "ui.render (AbovePrompt): a plugin's answer threw while drawn (plugin unattributed, unattributed)",
    )
    expect(pluginFromLead('hooks')).toBeNull()
    expect(pluginFromLead('')).toBeNull()
    expect(pluginFromLead('band-mod')).toBeNull()
    resetDrawErrorNotes()
    setLoadedFunctionHooksModules([
      {
        name: 'band-mod',
        patterns: [],
        pluginStorageId: 'band-mod',
      },
    ])
    const named = L1t('AbovePrompt', tellerOf(['band-mod']), 'answer')
    expect(named).toBe(
      "ui.render (AbovePrompt): a plugin's answer threw while drawn (plugin third-party, installed)",
    )
    expect(pluginFromLead('band-mod')).toEqual({
      plugin_name_redacted: 'third-party',
      provenance: 'installed',
    })
    setLoadedFunctionHooksModules([{ name: 'no-args', patterns: [] }])
    expect(pluginFromLead('no-args')).toBeNull()
  })

  test('O9: builtin needs sE; inline rft / other; else installed', () => {
    expect(
      O9({ pluginStorageId: 'demo@builtin', pluginRoot: '/tmp/demo' }),
    ).toEqual({
      plugin_name_redacted: 'demo',
      provenance: 'installed',
    })
    registerBuiltinPlugin({
      name: 'o9-s8e-demo',
      description: 'O9 s8e catalog hit',
    })
    expect(
      O9({ pluginStorageId: 'o9-s8e-demo@builtin', pluginRoot: '/tmp/demo' }),
    ).toEqual({
      plugin_name_redacted: 'o9-s8e-demo',
      provenance: 'builtin',
    })
    expect(
      O9({ pluginStorageId: 'band-mod', pluginRoot: '/tmp/other/plugin' }),
    ).toEqual({
      plugin_name_redacted: 'third-party',
      provenance: 'installed',
    })
    expect(
      O9({
        pluginStorageId: 'band-mod@inline',
        pluginRoot: '/tmp/other/plugin',
      }),
    ).toEqual({
      plugin_name_redacted: 'third-party',
      provenance: 'plugin_dir',
    })
    const root = join(getClaudeConfigHomeDir(), 'dev-mods', 'band-mod')
    expect(
      O9({ pluginStorageId: 'band-mod@inline', pluginRoot: root }),
    ).toEqual({
      plugin_name_redacted: 'third-party',
      provenance: 'dev_mods',
    })
    const sessionRoot = join(
      getClaudeConfigHomeDir(),
      'dev-mods',
      'sess-1',
      'band-mod',
    )
    expect(
      O9({ pluginStorageId: 'band-mod@inline', pluginRoot: sessionRoot }),
    ).toEqual({
      plugin_name_redacted: 'third-party',
      provenance: 'dev_mods',
    })
  })

  test('L1t reports once per teller+kind', () => {
    const teller = tellerOf(['band-mod'])
    expect(L1t('AbovePrompt', teller, 'answer')).not.toBeNull()
    expect(L1t('AbovePrompt', teller, 'answer')).toBeNull()
  })

  test('NBr / Jmn author toast uses Ymn; bxe warns lead', () => {
    expect(NBr('AbovePrompt', 'boom')).toBe(
      'ui.render (AbovePrompt) threw while drawn: boom; nothing was drawn',
    )
    expect(NBr('Pane', 'boom')).toBe(
      'ui.render (Pane) threw while drawn: boom; the pane was closed',
    )
    const toast = Jmn({
      component: 'AbovePrompt',
      teller: tellerOf(['band-mod']),
      error: new Error('boom'),
    })
    expect(toast?.text).toBe(
      'ui.render (AbovePrompt) threw while drawn: boom; nothing was drawn',
    )
    expect(SRC).toContain('teller.lead}: ${text}')
    expect(SRC).toContain("level: 'warn'")
    expect(
      Jmn({
        component: 'AbovePrompt',
        teller: tellerOf(['band-mod']),
        error: new Error('again'),
      }),
    ).toBeNull()
  })

  test('PluginRasterPanes hosts L1t answer + Client + Jmn', () => {
    expect(PANES).toContain('reportDrawWhileDrawn')
    expect(PANES).toContain("L1t(component, teller, 'answer')")
    expect(PANES).toContain("L1t(component, tellerOfPlugin(plugin), 'Client')")
    expect(PANES).toContain('telemetryMessage')
    expect(PANES).toContain('markThrown()')
    expect(PANES).not.toContain('plugin unattributed, unattributed')
    expect(PANES).not.toContain("a plugin's tree threw while drawn")
    expect(SRC).toContain('plugin_function_hooks_draw')
    expect(SRC).toContain('client_threw_while_drawn')
    expect(SRC).toContain('threw_while_drawn')
    expect(SRC).toContain('logForDiagnosticsNoPII')
    expect(SRC).toContain('logEvent')
  })

  test('Surface trampoline heard() routes rejected promises to host.fault (phase run)', async () => {
    expect(SURFACE_TRAMPOLINE_SOURCE).toContain('const reasonText = error =>')
    expect(SURFACE_TRAMPOLINE_SOURCE).toContain(
      'const faulted = (id, error) =>',
    )
    expect(SURFACE_TRAMPOLINE_SOURCE).toContain('const heard = (id, out) =>')

    const dir = mkdtempSync(join(tmpdir(), 'surf-fault-289-'))
    const modPath = join(dir, 'board.js')
    const source = `export function Board(props, surface) {
  surface.onKey(() => Promise.reject(new Error('rejected-key')))
  return { type: 'Box', children: ['ok'] }
}
`
    writeFileSync(modPath, source)
    setLoadedFunctionHooksModules([
      {
        name: 'faultplug',
        root: dir,
        patterns: [],
        hooks: [],
        surfaceModules: [
          {
            module: './board',
            modulePath: modPath,
            component: 'Board',
            source,
          },
        ],
      },
    ])
    const faults: ClientFaultReport[] = []
    setClientFaultReporter(r => faults.push(r))
    const instance = acquirePluginClient({
      plugin: 'faultplug',
      key: 'k',
      module: './board',
    })
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setImmediate(resolve))
      if (instance.getSnapshot().status !== 'loading') break
    }
    expect(instance.getSnapshot().status).toBe('drawn')
    instance.key({ key: 'a' })
    await new Promise(resolve => setImmediate(resolve))
    const snap = instance.getSnapshot()
    expect(snap.status).toBe('failed')
    if (snap.status === 'failed') {
      expect(snap.text).toBe(
        'faultplug: Client ./board: a promise it returned was rejected: rejected-key',
      )
    }
    expect(faults).toHaveLength(1)
    expect(faults[0]?.phase).toBe('run')
    expect(faults[0]?.reason).toBe(
      'a promise it returned was rejected: rejected-key',
    )
    instance.release()
    rmSync(dir, { recursive: true, force: true })
  })

  test('fs.read / fs.write / fs.exists / fs.ancestors / http.fetch / ui.open 289 rules', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-289-'))
    await handleHostOp('fs.write', [
      { path: 'nested/sub/file.txt', text: 'hello-289', cwd: dir },
    ])
    expect(
      await handleHostOp('fs.exists', [
        { path: 'nested/sub/file.txt', cwd: dir },
      ]),
    ).toBe(true)
    expect(
      await handleHostOp('fs.read', [
        { path: 'nested/sub/file.txt', as: 'text', cwd: dir },
      ]),
    ).toBe('hello-289')
    expect(
      await handleHostOp('fs.read', [
        { path: 'nested/sub/file.txt', as: 'bytes', cwd: dir },
      ]),
    ).toEqual({
      base64: Buffer.from('hello-289', 'utf8').toString('base64'),
    })
    await expect(
      handleHostOp(
        'fs.read',
        [{ path: 'nested/sub/file.txt', as: 'json', cwd: dir }],
        'plug',
      ),
    ).rejects.toThrow('as is "text" or "bytes"')
    await expect(
      handleHostOp(
        'fs.write',
        [{ path: 'big.txt', text: 'x'.repeat(4_194_305), cwd: dir }],
        'plug',
      ),
    ).rejects.toThrow('over the 4194304-byte limit')

    mkdirSync(join(dir, 'pkg', 'src'), { recursive: true })
    writeFileSync(join(dir, 'pkg', 'AGENTS.md'), 'pkg-agents')
    writeFileSync(join(dir, 'pkg', 'src', 'AGENTS.md'), 'src-agents')
    const ancestors = (await handleHostOp('fs.ancestors', [
      {
        names: ['AGENTS.md'],
        of: 'pkg/src/index.ts',
        below: dir,
        cwd: dir,
      },
    ])) as Array<{ dir: string; content: string }>
    expect(ancestors.map(a => a.content)).toEqual(['pkg-agents', 'src-agents'])

    await expect(
      handleHostOp(
        'http.fetch',
        ['https://example.com', { body: 'x'.repeat(4_194_305) }],
        'plug',
      ),
    ).rejects.toThrow('over the 4194304-character limit')

    await expect(
      handleHostOp('ui.open', [{ id: 'p1', title: 'bad\x00title' }], 'plug'),
    ).rejects.toThrow('title holds a control character')

    rmSync(dir, { recursive: true, force: true })
  })
})
