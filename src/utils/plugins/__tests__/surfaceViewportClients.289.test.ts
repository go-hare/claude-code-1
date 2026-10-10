import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  attachRemoteUiSurface,
  attachSurfaceViewportClient,
  clientsWithFullscreenKey,
  clientsWithViewport,
  defaultClientIdForSurface,
  detachRemoteUiSurface,
  listDrawingSurfaces,
  listSurfaceViewportClients,
  parseUiAttachControlRequest,
  parseUiClientFaultControlRequest,
  parseUiClientModuleControlRequest,
  parseUiClientPressControlRequest,
  parseUiCloseControlRequest,
  parseUiDetachControlRequest,
  parseUiFocusControlRequest,
  parseUiInputControlRequest,
  parseUiMessageControlRequest,
  parseUiPaneFocusControlRequest,
  parseUiPaneShowControlRequest,
  parseUiPanesControlRequest,
  parseUiPressControlRequest,
  parseUiPromptEditControlRequest,
  parseUiRenderControlRequest,
  parseUiScrollControlRequest,
  parseUiSelectControlRequest,
  placementFromAttachedSurfaces,
  resetSurfaceViewportClientsForTests,
  uiClientModuleMissingError,
  UI_ATTACH_PARSE_ERROR,
  UI_CLIENT_FAULT_MALFORMED,
  UI_CLIENT_MODULE_PARSE_ERROR,
  UI_CLIENT_PRESS_PARSE_ERROR,
  UI_CLOSE_PARSE_ERROR,
  UI_DETACH_PARSE_ERROR,
  UI_FOCUS_PARSE_ERROR,
  UI_INPUT_PARSE_ERROR,
  UI_MESSAGE_PARSE_ERROR,
  UI_PANES_PARSE_ERROR,
  UI_PANE_FOCUS_PARSE_ERROR,
  UI_PANE_SHOW_PARSE_ERROR,
  UI_PRESS_PARSE_ERROR,
  UI_PROMPT_EDIT_PARSE_ERROR,
  UI_RENDER_PARSE_ERROR,
  UI_SCROLL_PARSE_ERROR,
  UI_SELECT_PARSE_ERROR,
} from '../surfaceViewportClients.js'

afterEach(() => {
  resetSurfaceViewportClientsForTests()
})

describe('densable 2.1.289 empty Epn / surfaceViewportClients', () => {
  test('empty registry → placementFromAttachedSurfaces undefined', () => {
    expect(placementFromAttachedSurfaces()).toBeUndefined()
    expect(clientsWithViewport()).toEqual([])
    expect(clientsWithFullscreenKey()).toEqual([])
  })

  test('viewport without isFullscreen key → deny', () => {
    attachSurfaceViewportClient({
      clientId: 'c1',
      surface: 'desktop',
      viewport: { columns: 120, rows: 40 },
    })
    const got = placementFromAttachedSurfaces()
    expect(got?.isPlaced).toBe(false)
    expect(got && 'reason' in got ? got.reason : '').toContain(
      'no attached surface places panes (c1)',
    )
  })

  test('isFullscreen key present (even false) → place', () => {
    attachSurfaceViewportClient({
      clientId: 'c2',
      surface: 'vscode',
      viewport: { columns: 80, rows: 24, isFullscreen: false },
    })
    expect(placementFromAttachedSurfaces()).toEqual({ isPlaced: true })
  })

  test('repeat attach merges viewport/answers and keeps first surface', () => {
    attachSurfaceViewportClient({
      clientId: 'phone-1',
      surface: 'mobile',
      viewport: { columns: 40, rows: 20 },
    })
    expect(
      attachSurfaceViewportClient({
        clientId: 'phone-1',
        surface: 'desktop',
        viewport: { columns: 80, rows: 24, isFullscreen: true },
        answers: ['ui_copy'],
      }),
    ).toBe(false)
    const got = listSurfaceViewportClients()
    expect(got).toHaveLength(1)
    expect(got[0]?.surface).toBe('mobile')
    expect(got[0]?.viewport).toEqual({
      columns: 80,
      rows: 24,
      isFullscreen: true,
    })
    expect(got[0]?.answers).toEqual(['ui_copy'])
  })
})

describe('densable 2.1.289 CLI Fco / ui_attach (not overlay footer)', () => {
  const ROOT = join(import.meta.dir, '../../../..')

  test('jAn parse copy + client_id charset', () => {
    expect(UI_ATTACH_PARSE_ERROR).toContain(
      'surface must be "desktop", "mobile" or "vscode"',
    )
    expect(UI_ATTACH_PARSE_ERROR).toContain('"ui_copy"')
    expect(parseUiAttachControlRequest({ subtype: 'ui_attach' }).ok).toBe(false)
    expect(
      parseUiAttachControlRequest({
        subtype: 'ui_attach',
        surface: 'terminal',
        client_id: 'ok',
      }).ok,
    ).toBe(false)
    expect(
      parseUiAttachControlRequest({
        subtype: 'ui_attach',
        surface: 'desktop',
        client_id: 'desktop:default',
      }).ok,
    ).toBe(false)
    const ok = parseUiAttachControlRequest({
      subtype: 'ui_attach',
      surface: 'vscode',
      client_id: 'vs.code-1',
      viewport: { columns: 120, rows: 40, isFullscreen: false },
      answers: ['ui_copy', 'ui_prompt_read'],
    })
    expect(ok).toEqual({
      ok: true,
      surface: 'vscode',
      clientId: 'vs.code-1',
      viewport: { columns: 120, rows: 40, isFullscreen: false },
      answers: ['ui_copy', 'ui_prompt_read'],
    })
  })

  test('print.ts hosts ui_attach via Fco analog, not overlay footer', () => {
    const print = readFileSync(join(ROOT, 'src/cli/print.ts'), 'utf8')
    expect(print).toContain("req.subtype === 'ui_attach'")
    expect(print).toContain('attachRemoteUiSurface')
    expect(print).toContain('listDrawingSurfaces')
    const overlay = readFileSync(
      join(ROOT, 'src/context/promptOverlayContext.tsx'),
      'utf8',
    )
    expect(overlay).not.toContain('ui_attach')
    expect(overlay).not.toContain('function Fco')
  })

  test('Fco first attach true, repeat false; drawing surfaces skip terminal', async () => {
    expect(
      await attachRemoteUiSurface({
        surface: 'desktop',
        clientId: 'desk-1',
        viewport: { columns: 100, rows: 30 },
      }),
    ).toBe(true)
    expect(
      await attachRemoteUiSurface({
        surface: 'desktop',
        clientId: 'desk-1',
        viewport: { columns: 101, rows: 31 },
      }),
    ).toBe(false)
    expect(listDrawingSurfaces()).toEqual(['desktop'])
  })
})

describe('densable 2.1.289 CLI ui_detach / ui_render (not overlay footer)', () => {
  const ROOT = join(import.meta.dir, '../../../..')

  test('WAn detach parse copy', () => {
    expect(UI_DETACH_PARSE_ERROR).toBe(
      "ui_detach: client_id must be 1-64 of letters, digits, . _ - (the colon is the engine's)",
    )
    expect(parseUiDetachControlRequest({ subtype: 'ui_detach' }).ok).toBe(false)
    expect(
      parseUiDetachControlRequest({
        subtype: 'ui_detach',
        client_id: 'desktop:default',
      }).ok,
    ).toBe(false)
    expect(
      parseUiDetachControlRequest({
        subtype: 'ui_detach',
        client_id: 'desk-1',
      }),
    ).toEqual({ ok: true, clientId: 'desk-1' })
  })

  test('GAn render parse copy + hrt default client', () => {
    expect(UI_RENDER_PARSE_ERROR).toContain(
      'surface must be "desktop", "mobile" or "vscode"',
    )
    expect(UI_RENDER_PARSE_ERROR).toContain(
      'on_screen (when given) null or integers first <= last < of',
    )
    expect(parseUiRenderControlRequest({ subtype: 'ui_render' }).ok).toBe(false)
    expect(defaultClientIdForSurface('vscode')).toBe('vscode:default')
    const ok = parseUiRenderControlRequest({
      subtype: 'ui_render',
      surface: 'vscode',
      component: 'Pane',
      instance_id: 'pane_1',
      props: {},
      client_id: 'vs-1',
      viewport: { columns: 80, rows: 24, isFullscreen: true },
      on_screen: { first: 0, last: 1, of: 3 },
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.component).toBe('Pane')
      expect(ok.instanceId).toBe('pane_1')
      expect(ok.clientId).toBe('vs-1')
      expect(ok.onScreen).toEqual({ first: 0, last: 1, of: 3 })
    }
  })

  test('print.ts hosts ui_detach and ui_render', () => {
    const print = readFileSync(join(ROOT, 'src/cli/print.ts'), 'utf8')
    expect(print).toContain("req.subtype === 'ui_detach'")
    expect(print).toContain("req.subtype === 'ui_render'")
    expect(print).toContain('detachRemoteUiSurface')
    expect(print).toContain('evaluateUiRender')
    expect(print).toContain('BENCH ui_render key=')
    expect(print).not.toContain('overlay footer')
  })

  test('U9t missing client is no-op; attached client detaches', async () => {
    expect(await detachRemoteUiSurface('gone')).toBeUndefined()
    expect(
      await attachRemoteUiSurface({
        surface: 'mobile',
        clientId: 'phone-2',
      }),
    ).toBe(true)
    const gone = await detachRemoteUiSurface('phone-2', 'detach')
    expect(gone?.clientId).toBe('phone-2')
    expect(listSurfaceViewportClients()).toEqual([])
  })
})

describe('densable 2.1.289 CLI ui_press / ui_input / ui_prompt_edit / ui_select', () => {
  const ROOT = join(import.meta.dir, '../../../..')

  test('zAn press parse unique English', () => {
    expect(UI_PRESS_PARSE_ERROR).toBe(
      'ui_press: plugin must be a string, handle an integer, key (when given) a string, surface (when given) "desktop", "mobile" or "vscode" and href (when given) a string of at most 2048 characters',
    )
    expect(parseUiPressControlRequest({ subtype: 'ui_press' }).ok).toBe(false)
    expect(
      parseUiPressControlRequest({
        subtype: 'ui_press',
        plugin: 'p',
        handle: 1.5,
      }).ok,
    ).toBe(false)
    expect(
      parseUiPressControlRequest({
        subtype: 'ui_press',
        plugin: 'p',
        handle: 1,
        href: 'x'.repeat(2049),
      }).ok,
    ).toBe(false)
    expect(
      parseUiPressControlRequest({
        subtype: 'ui_press',
        plugin: 'p',
        handle: 3,
        key: 'ok',
        surface: 'vscode',
        href: 'https://example',
      }),
    ).toEqual({
      ok: true,
      plugin: 'p',
      handle: 3,
      key: 'ok',
      surface: 'vscode',
      href: 'https://example',
    })
    expect(
      parseUiPressControlRequest({
        subtype: 'ui_press',
        plugin: 'p',
        handle: 0,
      }),
    ).toEqual({
      ok: true,
      plugin: 'p',
      handle: 0,
      surface: 'desktop',
    })
  })

  test('XAn input parse unique English', () => {
    expect(UI_INPUT_PARSE_ERROR).toBe(
      'ui_input: plugin must be a string, handle an integer, kind "change" or "submit", value a string of at most 16384 characters, key (when given) a string, component (when given) a render site name, instance_id (when given) a string and surface (when given) "desktop", "mobile" or "vscode"',
    )
    expect(parseUiInputControlRequest({ subtype: 'ui_input' }).ok).toBe(false)
    expect(
      parseUiInputControlRequest({
        subtype: 'ui_input',
        plugin: 'p',
        handle: 1,
        kind: 'blur',
        value: 'x',
      }).ok,
    ).toBe(false)
    expect(
      parseUiInputControlRequest({
        subtype: 'ui_input',
        plugin: 'p',
        handle: 1,
        kind: 'change',
        value: 'x'.repeat(16385),
      }).ok,
    ).toBe(false)
    expect(
      parseUiInputControlRequest({
        subtype: 'ui_input',
        plugin: 'p',
        handle: 2,
        kind: 'submit',
        value: 'hi',
        key: 'field',
        component: 'Pane',
        instance_id: 'row_1',
        surface: 'mobile',
      }),
    ).toEqual({
      ok: true,
      plugin: 'p',
      handle: 2,
      kind: 'submit',
      value: 'hi',
      key: 'field',
      component: 'Pane',
      instanceId: 'row_1',
      surface: 'mobile',
    })
  })

  test('JAn select parse unique English', () => {
    expect(UI_SELECT_PARSE_ERROR).toBe(
      'ui_select: plugin must be a string, handle an integer, value a string of at most 16384 characters, key (when given) a string, component (when given) a render site name, instance_id (when given) a string and surface (when given) "desktop", "mobile" or "vscode"',
    )
    expect(parseUiSelectControlRequest({ subtype: 'ui_select' }).ok).toBe(false)
    expect(
      parseUiSelectControlRequest({
        subtype: 'ui_select',
        plugin: 'p',
        handle: 1,
        value: 'x'.repeat(16385),
      }).ok,
    ).toBe(false)
    expect(
      parseUiSelectControlRequest({
        subtype: 'ui_select',
        plugin: 'p',
        handle: 4,
        value: 'opt',
        key: 'sel',
        component: 'AbovePrompt',
        instance_id: 'ap_1',
      }),
    ).toEqual({
      ok: true,
      plugin: 'p',
      handle: 4,
      value: 'opt',
      key: 'sel',
      component: 'AbovePrompt',
      instanceId: 'ap_1',
      surface: 'desktop',
    })
  })

  test('okn prompt_edit parse unique English', () => {
    expect(UI_PROMPT_EDIT_PARSE_ERROR).toBe(
      'ui_prompt_edit: text must be a string of at most 1000000 characters, cursor an integer >= 0, key (when given) an object with key a string of 1-32 characters and ctrl, shift, meta each true when present, by (when given) "person" or "app", surface (when given) "desktop", "mobile" or "vscode" and client_id (when given) 1-64 of letters, digits, . _ -',
    )
    expect(
      parseUiPromptEditControlRequest({ subtype: 'ui_prompt_edit' }).ok,
    ).toBe(false)
    expect(
      parseUiPromptEditControlRequest({
        subtype: 'ui_prompt_edit',
        text: 'hi',
        cursor: -1,
      }).ok,
    ).toBe(false)
    expect(
      parseUiPromptEditControlRequest({
        subtype: 'ui_prompt_edit',
        text: 'hi',
        cursor: 0,
        key: { key: 'a'.repeat(33) },
      }).ok,
    ).toBe(false)
    expect(
      parseUiPromptEditControlRequest({
        subtype: 'ui_prompt_edit',
        text: 'hi',
        cursor: 0,
        key: { key: 'return', ctrl: false },
      }).ok,
    ).toBe(false)
    expect(
      parseUiPromptEditControlRequest({
        subtype: 'ui_prompt_edit',
        text: 'hi',
        cursor: 0,
        client_id: 'desktop:default',
      }).ok,
    ).toBe(false)
    expect(
      parseUiPromptEditControlRequest({
        subtype: 'ui_prompt_edit',
        text: 'draft',
        cursor: 2,
        key: { key: 'return', ctrl: true },
        by: 'app',
        surface: 'vscode',
        client_id: 'vs-1',
      }),
    ).toEqual({
      ok: true,
      text: 'draft',
      cursor: 2,
      key: { key: 'return', ctrl: true },
      by: 'app',
      surface: 'vscode',
      clientId: 'vs-1',
    })
    expect(
      parseUiPromptEditControlRequest({
        subtype: 'ui_prompt_edit',
        text: '',
        cursor: 0,
      }),
    ).toEqual({
      ok: true,
      text: '',
      cursor: 0,
      surface: 'desktop',
      by: 'person',
    })
  })

  test('print.ts hosts the four subtypes with unique English fail copies', () => {
    const print = readFileSync(join(ROOT, 'src/cli/print.ts'), 'utf8')
    expect(print).toContain("req.subtype === 'ui_press'")
    expect(print).toContain("req.subtype === 'ui_input'")
    expect(print).toContain("req.subtype === 'ui_prompt_edit'")
    expect(print).toContain("req.subtype === 'ui_select'")
    expect(print).toContain('parseUiPressControlRequest')
    expect(print).toContain('parseUiInputControlRequest')
    expect(print).toContain('parseUiPromptEditControlRequest')
    expect(print).toContain('parseUiSelectControlRequest')
    expect(print).toContain('invokePress')
    expect(print).toContain('runFunctionHookChain')
    expect(print).toContain('UI_PRESS_PARSE_ERROR')
    expect(print).toContain('UI_INPUT_PARSE_ERROR')
    expect(print).toContain('UI_SELECT_PARSE_ERROR')
    expect(print).toContain('UI_PROMPT_EDIT_PARSE_ERROR')
    expect(print).not.toContain('overlay footer')
  })
})

describe('densable 2.1.289 CLI ui_panes through ui_client_fault', () => {
  const ROOT = join(import.meta.dir, '../../../..')

  test('QAn panes parse unique English', () => {
    expect(UI_PANES_PARSE_ERROR).toBe(
      'ui_panes: client_id (when given) 1-64 safe characters',
    )
    expect(parseUiPanesControlRequest({ subtype: 'ui_panes' })).toEqual({
      ok: true,
    })
    expect(
      parseUiPanesControlRequest({
        subtype: 'ui_panes',
        client_id: 'desktop:default',
      }).ok,
    ).toBe(false)
    expect(
      parseUiPanesControlRequest({
        subtype: 'ui_panes',
        client_id: 'desk-1',
      }),
    ).toEqual({ ok: true, clientId: 'desk-1' })
  })

  test('ZAn pane_show parse unique English', () => {
    expect(UI_PANE_SHOW_PARSE_ERROR).toBe(
      'ui_pane_show: id must be 1-64 of letters, digits, _ or -',
    )
    expect(parseUiPaneShowControlRequest({ subtype: 'ui_pane_show' }).ok).toBe(
      false,
    )
    expect(
      parseUiPaneShowControlRequest({
        subtype: 'ui_pane_show',
        id: 'pane.1',
      }).ok,
    ).toBe(false)
    expect(
      parseUiPaneShowControlRequest({
        subtype: 'ui_pane_show',
        id: 'pane_1',
        surface: 'vscode',
        client_id: 'vs-1',
      }),
    ).toEqual({
      ok: true,
      id: 'pane_1',
      surface: 'vscode',
      clientId: 'vs-1',
    })
  })

  test('ekn pane_focus parse unique English', () => {
    expect(UI_PANE_FOCUS_PARSE_ERROR).toBe(
      'ui_pane_focus: id must be null or 1-64 of letters, digits, _ or -, surface (when given) "desktop", "mobile" or "vscode"',
    )
    expect(
      parseUiPaneFocusControlRequest({
        subtype: 'ui_pane_focus',
        id: null,
      }),
    ).toEqual({ ok: true, id: null, surface: 'desktop' })
    expect(
      parseUiPaneFocusControlRequest({
        subtype: 'ui_pane_focus',
        id: 'p1',
        surface: 'mobile',
      }),
    ).toEqual({ ok: true, id: 'p1', surface: 'mobile' })
  })

  test('tkn close parse unique English', () => {
    expect(UI_CLOSE_PARSE_ERROR).toBe(
      'ui_close: id must be 1-64 of letters, digits, _ or -',
    )
    expect(parseUiCloseControlRequest({ subtype: 'ui_close' }).ok).toBe(false)
    expect(
      parseUiCloseControlRequest({ subtype: 'ui_close', id: 'gone' }),
    ).toEqual({ ok: true, id: 'gone' })
  })

  test('nkn scroll parse unique English', () => {
    expect(UI_SCROLL_PARSE_ERROR).toContain(
      'component must be "Pane" or "AbovePrompt"',
    )
    expect(parseUiScrollControlRequest({ subtype: 'ui_scroll' }).ok).toBe(false)
    expect(
      parseUiScrollControlRequest({
        subtype: 'ui_scroll',
        component: 'Pane',
        instance_id: 'pane_1',
        offset: 0,
        by: -2,
        body_rows: 20,
        content_rows: 40,
        pointer: { column: 1, row: 2 },
        surface: 'vscode',
      }),
    ).toEqual({
      ok: true,
      component: 'Pane',
      instanceId: 'pane_1',
      offset: 0,
      by: -2,
      bodyRows: 20,
      contentRows: 40,
      surface: 'vscode',
      pointer: { column: 1, row: 2 },
    })
  })

  test('rkn focus parse unique English', () => {
    expect(UI_FOCUS_PARSE_ERROR).toContain(
      'component must be "Pane" or "AbovePrompt"',
    )
    expect(parseUiFocusControlRequest({ subtype: 'ui_focus' }).ok).toBe(false)
    expect(
      parseUiFocusControlRequest({
        subtype: 'ui_focus',
        component: 'AbovePrompt',
        instance_id: 'above-prompt',
        is_held: true,
        element: { plugin: 'p', key: 'k' },
        by: 'auto',
      }),
    ).toEqual({
      ok: true,
      component: 'AbovePrompt',
      instanceId: 'above-prompt',
      isHeld: true,
      surface: 'desktop',
      by: 'auto',
      element: { plugin: 'p', key: 'k' },
    })
    expect(
      parseUiFocusControlRequest({
        subtype: 'ui_focus',
        component: 'Pane',
        instance_id: 'p1',
        is_held: false,
        element: null,
      }),
    ).toEqual({
      ok: true,
      component: 'Pane',
      instanceId: 'p1',
      isHeld: false,
      surface: 'desktop',
      by: 'person',
      element: null,
    })
  })

  test('VAn client_module parse unique English', () => {
    expect(UI_CLIENT_MODULE_PARSE_ERROR).toBe(
      'ui_client_module: plugin must be a string',
    )
    expect(
      parseUiClientModuleControlRequest({ subtype: 'ui_client_module' }).ok,
    ).toBe(false)
    expect(
      parseUiClientModuleControlRequest({
        subtype: 'ui_client_module',
        plugin: 'board',
      }),
    ).toEqual({ ok: true, plugin: 'board' })
    expect(uiClientModuleMissingError('board')).toBe(
      'ui_client_module: plugin board is not loaded or its hooks module names no surface module',
    )
  })

  test('qAn client_press parse unique English', () => {
    expect(UI_CLIENT_PRESS_PARSE_ERROR).toContain(
      'event {type: "press"} | {type: "input", kind, value} | {type: "select", value}',
    )
    expect(
      parseUiClientPressControlRequest({ subtype: 'ui_client_press' }).ok,
    ).toBe(false)
    expect(
      parseUiClientPressControlRequest({
        subtype: 'ui_client_press',
        plugin: 'p',
        component: 'Pane',
        instance_id: 'pane_1',
        client: 'c',
        module: 'hooks/board.tsx',
        element: 'btn',
        event: { type: 'press' },
      }),
    ).toEqual({
      ok: true,
      plugin: 'p',
      component: 'Pane',
      instanceId: 'pane_1',
      client: 'c',
      module: 'hooks/board.tsx',
      element: 'btn',
      event: { type: 'press' },
    })
  })

  test('KAn ui_message parse unique English', () => {
    expect(UI_MESSAGE_PARSE_ERROR).toBe(
      'ui_message: plugin, instance_id, client and module must be strings, component a render site name, and data present (plain JSON)',
    )
    expect(
      parseUiMessageControlRequest({
        subtype: 'ui_message',
        plugin: 'p',
        component: 'Pane',
        instance_id: 'pane_1',
        client: 'c',
        module: 'hooks/board.tsx',
      }).ok,
    ).toBe(false)
    expect(
      parseUiMessageControlRequest({
        subtype: 'ui_message',
        plugin: 'p',
        component: 'Pane',
        instance_id: 'pane_1',
        client: 'c',
        module: 'hooks/board.tsx',
        data: { n: 1 },
      }),
    ).toEqual({
      ok: true,
      plugin: 'p',
      component: 'Pane',
      instanceId: 'pane_1',
      client: 'c',
      module: 'hooks/board.tsx',
      data: { n: 1 },
    })
  })

  test('YAn ui_client_fault parse unique English', () => {
    expect(UI_CLIENT_FAULT_MALFORMED).toBe('ui_client_fault: malformed')
    expect(
      parseUiClientFaultControlRequest({ subtype: 'ui_client_fault' }).error,
    ).toBe('ui_client_fault: plugin: Required')
    expect(
      parseUiClientFaultControlRequest({
        subtype: 'ui_client_fault',
        plugin: 'p',
        component: 'Pane',
        instance_id: 'pane_1',
        client: 'c',
        module: 'hooks/board.tsx',
        phase: 'blur',
        reason: 'x',
      }).error,
    ).toContain('ui_client_fault: phase:')
    expect(
      parseUiClientFaultControlRequest({
        subtype: 'ui_client_fault',
        plugin: 'p',
        component: 'Pane',
        instance_id: 'pane_1',
        client: 'c',
        module: 'hooks/board.tsx',
        phase: 'run',
        reason: 'boom',
      }),
    ).toEqual({
      ok: true,
      plugin: 'p',
      component: 'Pane',
      instanceId: 'pane_1',
      client: 'c',
      module: 'hooks/board.tsx',
      phase: 'run',
      reason: 'boom',
    })
  })

  test('print.ts hosts ui_panes through ui_client_fault (not overlay footer)', () => {
    const print = readFileSync(join(ROOT, 'src/cli/print.ts'), 'utf8')
    expect(print).toContain("req.subtype === 'ui_panes'")
    expect(print).toContain("req.subtype === 'ui_pane_show'")
    expect(print).toContain("req.subtype === 'ui_pane_focus'")
    expect(print).toContain("req.subtype === 'ui_close'")
    expect(print).toContain("req.subtype === 'ui_scroll'")
    expect(print).toContain("req.subtype === 'ui_focus'")
    expect(print).toContain("req.subtype === 'ui_client_module'")
    expect(print).toContain("req.subtype === 'ui_client_press'")
    expect(print).toContain("req.subtype === 'ui_message'")
    expect(print).toContain("req.subtype === 'ui_client_fault'")
    expect(print).toContain("req.subtype === 'get_workspace_diff'")
    expect(print).toContain("req.subtype === 'get_plan'")
    expect(print).toContain("req.subtype === 'file_suggestions'")
    expect(print).toContain("req.subtype === 'add_directory'")
    expect(print).toContain("req.subtype === 'stage_file'")
    expect(print).toContain('stage_file failed')
    expect(print).toContain('wirePanesState')
    expect(print).toContain('runRemoteUiScroll')
    expect(print).toContain('runRemoteUiFocus')
    expect(print).toContain('clientModuleFor')
    expect(print).toContain('runRemoteClientPress')
    expect(print).toContain('runRemoteClientMessage')
    expect(print).toContain('dispatchClientFault')
    expect(print).not.toContain('overlay footer')
    expect(print).not.toContain('function Fco')
  })
})
