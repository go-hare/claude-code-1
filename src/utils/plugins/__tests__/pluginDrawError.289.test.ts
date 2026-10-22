/**
 * densable 2.1.289 `Ymn` / `L1t` / `NBr` / `Jmn` / `Bmn` / `O9`.
 * Author toast is Ymn. Debug unattributed is the no-module fallback.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { registerBuiltinPlugin } from '../../../plugins/builtinPlugins.js'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import { setLoadedFunctionHooksModules } from '../functionHooksModules.js'
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
  })
})
