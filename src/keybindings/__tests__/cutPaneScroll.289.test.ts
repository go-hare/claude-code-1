/**
 * densable 2.1.289 CUt — Pane / PaneField / Scroll context copy.
 * defaultBindings already hosts these; schema + skill table must list them.
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../defaultBindings.js'
import {
  KEYBINDING_ACTIONS,
  KEYBINDING_CONTEXTS,
  KEYBINDING_CONTEXT_DESCRIPTIONS,
} from '../schema.js'

describe('densable 2.1.289 CUt Pane / PaneField / Scroll', () => {
  test('schema lists gold unique English; defaultBindings already host contexts', () => {
    expect(KEYBINDING_CONTEXTS).toContain('Pane')
    expect(KEYBINDING_CONTEXTS).toContain('PaneField')
    expect(KEYBINDING_CONTEXTS).toContain('Scroll')
    expect(KEYBINDING_CONTEXT_DESCRIPTIONS.Pane).toBe(
      "When a plugin's pane has keyboard focus",
    )
    expect(KEYBINDING_CONTEXT_DESCRIPTIONS.PaneField).toBe(
      "When an input field or select in a plugin's pane has keyboard focus",
    )
    expect(KEYBINDING_CONTEXT_DESCRIPTIONS.Scroll).toBe(
      'When a scrollable view is focused (fullscreen layout)',
    )
    expect(DEFAULT_BINDINGS.some(b => b.context === 'Pane')).toBe(true)
    expect(DEFAULT_BINDINGS.some(b => b.context === 'PaneField')).toBe(true)
    expect(DEFAULT_BINDINGS.some(b => b.context === 'Scroll')).toBe(true)
  })

  test('KEYBINDING_ACTIONS lists gold Scroll actions', () => {
    for (const action of [
      'scroll:pageUp',
      'scroll:pageDown',
      'scroll:lineUp',
      'scroll:lineDown',
      'scroll:top',
      'scroll:bottom',
      'selection:copy',
      'selection:clear',
    ] as const) {
      expect(KEYBINDING_ACTIONS).toContain(action)
    }
  })

  test('schema lists gold CUt ProactivityMenu / EffortSlider / Agents', () => {
    expect(KEYBINDING_CONTEXTS).toContain('ProactivityMenu')
    expect(KEYBINDING_CONTEXTS).toContain('EffortSlider')
    expect(KEYBINDING_CONTEXTS).toContain('Agents')
    expect(KEYBINDING_CONTEXT_DESCRIPTIONS.ProactivityMenu).toBe(
      'When the proactivity dialog is open',
    )
    expect(KEYBINDING_CONTEXT_DESCRIPTIONS.EffortSlider).toBe(
      'When the effort slider is open',
    )
    expect(KEYBINDING_CONTEXT_DESCRIPTIONS.Agents).toBe(
      'When the agents view (`claude agents`) is open',
    )
    expect(KEYBINDING_CONTEXT_DESCRIPTIONS.DiffPanel).toBe(
      'When the diff sidebar panel is open',
    )
    const goldCut = [
      'Global',
      'Chat',
      'Autocomplete',
      'Confirmation',
      'Help',
      'ProactivityMenu',
      'Transcript',
      'HistorySearch',
      'Task',
      'ThemePicker',
      'Settings',
      'Tabs',
      'Attachments',
      'Footer',
      'AbovePrompt',
      'AbovePromptInput',
      'AbovePromptSelect',
      'Pane',
      'PaneField',
      'MessageSelector',
      'DiffDialog',
      'DiffPanel',
      'ModelPicker',
      'EffortSlider',
      'Select',
      'Plugin',
      'Scroll',
      'Agents',
    ]
    expect(KEYBINDING_CONTEXTS.slice(0, goldCut.length)).toEqual(goldCut)
    expect(DEFAULT_BINDINGS.some(b => b.context === 'EffortSlider')).toBe(true)
    expect(DEFAULT_BINDINGS.some(b => b.context === 'Agents')).toBe(true)
    const agents = DEFAULT_BINDINGS.find(b => b.context === 'Agents')
    expect(agents?.bindings['ctrl+s']).toBe('agents:switchView')
    expect(agents?.bindings['ctrl+t']).toBe('agents:togglePin')
    expect(agents?.bindings['ctrl+f']).toBe('agents:find')
    expect(agents?.bindings['ctrl+r']).toBe('agents:rename')
    expect(agents?.bindings['ctrl+up']).toBe('agents:previousGroup')
    expect(agents?.bindings['ctrl+down']).toBe('agents:nextGroup')
  })

  test('AgentView hosts gold Agents CUt via useKeybindings', async () => {
    const src = await Bun.file(
      new URL('../../screens/AgentView.tsx', import.meta.url),
    ).text()
    expect(src).toContain("context: 'Agents'")
    expect(src).toContain("'agents:switchView'")
    expect(src).toContain("'agents:togglePin'")
    expect(src).toContain("'agents:find'")
    expect(src).toContain("'agents:rename'")
    expect(src).toContain("'agents:previousGroup'")
    expect(src).toContain("'agents:nextGroup'")
    expect(src).not.toContain("input === 's' && key.ctrl")
  })

  test('fork FormField / MessageActions / EffortPanel stay after gold CUt', () => {
    expect(KEYBINDING_CONTEXTS).toContain('FormField')
    expect(KEYBINDING_CONTEXTS).toContain('MessageActions')
    expect(KEYBINDING_CONTEXTS).toContain('EffortPanel')
    expect(KEYBINDING_CONTEXTS.indexOf('FormField')).toBeGreaterThan(
      KEYBINDING_CONTEXTS.indexOf('Agents'),
    )
    expect(DEFAULT_BINDINGS.some(b => b.context === 'FormField')).toBe(true)
    expect(DEFAULT_BINDINGS.some(b => b.context === 'EffortPanel')).toBe(true)
    for (const action of [
      'messageActions:prev',
      'messageActions:next',
      'messageActions:enter',
      'proactivityMenu:previousMode',
      'proactivityMenu:nextMode',
      'agents:switchView',
      'agents:setGroup',
    ] as const) {
      expect(KEYBINDING_ACTIONS).toContain(action)
    }
  })
})
