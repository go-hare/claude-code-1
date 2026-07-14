/**
 * Official 2.1.198/199/207: Chrome MCP read-only classifier for plan mode.
 */
import { describe, expect, test } from 'bun:test'
import {
  chromeMcpReadOnlyInternals,
  isChromeMcpReadOnlyTool,
  isChromeMcpSafeForAutoMode,
} from '../chromeMcpReadOnly.js'

const CIC = 'mcp__claude-in-chrome__'
const LEGACY = 'mcp__Claude_in_Chrome__'
const PREVIEW = 'mcp__Claude_Preview__'

describe('isChromeMcpReadOnlyTool (heo)', () => {
  test('always-RO tools are RO under all browser prefixes', () => {
    for (const name of chromeMcpReadOnlyInternals.ALWAYS_READONLY_TOOLS) {
      expect(isChromeMcpReadOnlyTool(`${CIC}${name}`, {})).toBe(true)
      expect(isChromeMcpReadOnlyTool(`${LEGACY}${name}`, {})).toBe(true)
      expect(isChromeMcpReadOnlyTool(`${PREVIEW}${name}`, {})).toBe(true)
    }
  })

  test('unrelated MCP tools are not RO', () => {
    expect(isChromeMcpReadOnlyTool('mcp__slack__send_message', {})).toBe(false)
    expect(isChromeMcpReadOnlyTool('Bash', { command: 'ls' })).toBe(false)
    expect(
      isChromeMcpReadOnlyTool(`${CIC}navigate`, { url: 'https://x' }),
    ).toBe(false)
  })

  test('read_console_messages RO unless clear', () => {
    expect(
      isChromeMcpReadOnlyTool(`${CIC}read_console_messages`, { tabId: 1 }),
    ).toBe(true)
    expect(
      isChromeMcpReadOnlyTool(`${CIC}read_console_messages`, {
        tabId: 1,
        clear: true,
      }),
    ).toBe(false)
  })

  test('tabs_context_mcp RO unless createIfEmpty', () => {
    expect(isChromeMcpReadOnlyTool(`${CIC}tabs_context_mcp`, {})).toBe(true)
    expect(
      isChromeMcpReadOnlyTool(`${CIC}tabs_context_mcp`, {
        createIfEmpty: true,
      }),
    ).toBe(false)
  })

  test('preview tabs_context RO unless createIfEmpty', () => {
    expect(isChromeMcpReadOnlyTool(`${PREVIEW}tabs_context`, {})).toBe(true)
    expect(
      isChromeMcpReadOnlyTool(`${PREVIEW}tabs_context`, {
        createIfEmpty: true,
      }),
    ).toBe(false)
  })

  test('computer RO only for RO subactions without save_to_disk', () => {
    expect(
      isChromeMcpReadOnlyTool(`${CIC}computer`, {
        action: 'screenshot',
        tabId: 1,
      }),
    ).toBe(true)
    expect(
      isChromeMcpReadOnlyTool(`${CIC}computer`, {
        action: 'screenshot',
        tabId: 1,
        save_to_disk: true,
      }),
    ).toBe(false)
    expect(
      isChromeMcpReadOnlyTool(`${CIC}computer`, {
        action: 'left_click',
        tabId: 1,
      }),
    ).toBe(false)
  })

  test('browser_batch RO when every nested action is RO', () => {
    expect(
      isChromeMcpReadOnlyTool(`${CIC}browser_batch`, {
        actions: [
          { name: 'read_page', input: { tabId: 1 } },
          { name: 'get_page_text', input: { tabId: 1 } },
          {
            name: 'computer',
            input: { action: 'screenshot', tabId: 1 },
          },
        ],
      }),
    ).toBe(true)
  })

  test('browser_batch not RO when any nested action mutates', () => {
    expect(
      isChromeMcpReadOnlyTool(`${CIC}browser_batch`, {
        actions: [
          { name: 'read_page', input: { tabId: 1 } },
          { name: 'form_input', input: { ref: 'a', value: 'x', tabId: 1 } },
        ],
      }),
    ).toBe(false)
  })

  test('browser_batch empty or missing actions is not RO', () => {
    expect(isChromeMcpReadOnlyTool(`${CIC}browser_batch`, {})).toBe(false)
    expect(
      isChromeMcpReadOnlyTool(`${CIC}browser_batch`, { actions: [] }),
    ).toBe(false)
  })

  test('browser_batch nested read_console with clear is not RO', () => {
    expect(
      isChromeMcpReadOnlyTool(`${CIC}browser_batch`, {
        actions: [
          {
            name: 'read_console_messages',
            input: { tabId: 1, clear: true },
          },
        ],
      }),
    ).toBe(false)
  })
})

describe('plan-mode gate composition', () => {
  /**
   * Mirrors permissions.ts plan MCP branch:
   * ask when mcp && !annotationRO && passthrough && plan && !heo
   */
  function shouldAskInPlanMode(opts: {
    hasMcpInfo: boolean
    annotationReadOnly: boolean
    passthrough: boolean
    plan: boolean
    fqName: string
    input: unknown
  }): boolean {
    if (!opts.hasMcpInfo) return false
    if (opts.annotationReadOnly) return false
    if (!opts.passthrough) return false
    if (!opts.plan) return false
    if (isChromeMcpReadOnlyTool(opts.fqName, opts.input)) return false
    return true
  }

  test('read-only chrome tool does not force plan ask', () => {
    expect(
      shouldAskInPlanMode({
        hasMcpInfo: true,
        annotationReadOnly: false,
        passthrough: true,
        plan: true,
        fqName: `${CIC}read_page`,
        input: { tabId: 1 },
      }),
    ).toBe(false)
  })

  test('mutating chrome tool forces plan ask', () => {
    expect(
      shouldAskInPlanMode({
        hasMcpInfo: true,
        annotationReadOnly: false,
        passthrough: true,
        plan: true,
        fqName: `${CIC}navigate`,
        input: { url: 'https://example.com', tabId: 1 },
      }),
    ).toBe(true)
  })

  test('RO browser_batch does not force plan ask', () => {
    expect(
      shouldAskInPlanMode({
        hasMcpInfo: true,
        annotationReadOnly: false,
        passthrough: true,
        plan: true,
        fqName: `${CIC}browser_batch`,
        input: {
          actions: [{ name: 'find', input: { query: 'x', tabId: 1 } }],
        },
      }),
    ).toBe(false)
  })
})

describe('isChromeMcpSafeForAutoMode (NDu)', () => {
  test('always-safe tools include resize_window / switch_browser', () => {
    expect(
      isChromeMcpSafeForAutoMode(`${CIC}resize_window`, { tabId: 1 }),
    ).toBe(true)
    expect(
      isChromeMcpSafeForAutoMode(`${CIC}switch_browser`, { tabId: 1 }),
    ).toBe(true)
    // resize_window is NOT plan-mode RO (not in FDu)
    expect(isChromeMcpReadOnlyTool(`${CIC}resize_window`, { tabId: 1 })).toBe(
      false,
    )
  })

  test('computer left_click is safe for auto but not plan RO', () => {
    expect(
      isChromeMcpSafeForAutoMode(`${CIC}computer`, {
        action: 'left_click',
        tabId: 1,
      }),
    ).toBe(true)
    expect(
      isChromeMcpReadOnlyTool(`${CIC}computer`, {
        action: 'left_click',
        tabId: 1,
      }),
    ).toBe(false)
  })

  test('computer type is not safe for auto', () => {
    expect(
      isChromeMcpSafeForAutoMode(`${CIC}computer`, {
        action: 'type',
        text: 'x',
        tabId: 1,
      }),
    ).toBe(false)
  })

  test('preview tabs_create is always-safe for auto', () => {
    expect(isChromeMcpSafeForAutoMode(`${PREVIEW}tabs_create`, {})).toBe(true)
  })
})

describe('auto-mode plan_mode_floor (heo exempt)', () => {
  /**
   * Official: when decisionReason is plan mode, auto mode must keep ask
   * unless heo(name, input) is true.
   */
  function shouldKeepPlanFloorAsk(opts: {
    decisionMode: 'plan' | 'auto' | 'default'
    fqName: string
    input: unknown
  }): boolean {
    if (opts.decisionMode !== 'plan') return false
    return !isChromeMcpReadOnlyTool(opts.fqName, opts.input)
  }

  test('mutating navigate keeps plan floor (no auto-approve)', () => {
    expect(
      shouldKeepPlanFloorAsk({
        decisionMode: 'plan',
        fqName: `${CIC}navigate`,
        input: { url: 'https://x', tabId: 1 },
      }),
    ).toBe(true)
  })

  test('read_page heo exempts plan floor', () => {
    expect(
      shouldKeepPlanFloorAsk({
        decisionMode: 'plan',
        fqName: `${CIC}read_page`,
        input: { tabId: 1 },
      }),
    ).toBe(false)
  })

  test('RO browser_batch heo exempts plan floor', () => {
    expect(
      shouldKeepPlanFloorAsk({
        decisionMode: 'plan',
        fqName: `${CIC}browser_batch`,
        input: {
          actions: [{ name: 'get_page_text', input: { tabId: 1 } }],
        },
      }),
    ).toBe(false)
  })
})
