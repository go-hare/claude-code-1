import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Message } from '../../../types/message.js'
import {
  extractSideQuestionResponse,
  hasInlineToolCallMarkup,
} from '../../../utils/sideQuestion.js'
import {
  buildAutoCompactSliderStops,
  computeValueSliderLayout,
} from '../../autocompact/autocompact.js'
import { buildScrollSpeedSliderStops } from '../../scrollSpeed.js'
import {
  describePlannedTerminalSetupChanges,
  formatTmuxExtkeysNote,
  isWindowsTerminalBefore125,
  WINDOWS_TERMINAL_PRE_125_NOTICE,
} from '../../terminalSetup/terminalSetup.js'

describe('Wave 326 Group 4D: /btw, Sliders, /context, /terminal-setup', () => {
  test('#161: /btw appends tool-attempt notice when model outputs lead-in text plus tool_use or fake XML', () => {
    const msgWithLeadInAndTool = {
      type: 'assistant',
      uuid: 'a1',
      isApiErrorMessage: false,
      message: {
        content: [
          { type: 'text', text: 'Let me check that file.' },
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'Read',
            input: { file_path: 'foo.ts' },
          },
        ],
      },
    } as unknown as Message

    const extracted = extractSideQuestionResponse([msgWithLeadInAndTool])
    expect(extracted.synthetic).toBe(false)
    expect(extracted.response).toContain('Let me check that file.')
    expect(extracted.response).toContain(
      'The model tried to call Read instead of answering directly',
    )

    expect(
      hasInlineToolCallMarkup('Sure: <function_calls><invoke name="Bash">'),
    ).toBe(true)
    expect(hasInlineToolCallMarkup('Plain answer without tags')).toBe(false)

    const msgWithInlineXml = {
      type: 'assistant',
      uuid: 'a2',
      isApiErrorMessage: false,
      message: {
        content: [
          { type: 'text', text: 'Checking: <invoke name="Read"></invoke>' },
        ],
      },
    } as unknown as Message
    const xmlExtracted = extractSideQuestionResponse([msgWithInlineXml])
    expect(xmlExtracted.response).toContain('Side questions cannot run tools')
  })

  test('#162 & #216: /btw handles PgUp/PgDn/Home/End/wheel + scroll indicator; /context passes narrow columns', () => {
    const btwSrc = readFileSync(join(import.meta.dir, '../btw.tsx'), 'utf8')
    expect(btwSrc).toContain("e.name === 'pageup' || e.name === 'pagedown'")
    expect(btwSrc).toContain("e.name === 'home'")
    expect(btwSrc).toContain("e.name === 'end'")
    expect(btwSrc).toContain('onWheel={handleWheel}')
    expect(btwSrc).toContain('more below')

    const contextSrc = readFileSync(
      join(import.meta.dir, '../../context/context.tsx'),
      'utf8',
    )
    expect(contextSrc).toContain('renderColumns')
    expect(contextSrc).toContain('renderToAnsiString(')
  })

  test('#285: /autocompact & /scroll-speed sliders show every stop and adapt to narrow terminals', () => {
    const acStops = buildAutoCompactSliderStops()
    expect(acStops[0]?.label).toBe('auto')
    expect(acStops.length).toBeGreaterThanOrEqual(11)
    expect(acStops.at(-1)?.label.toLowerCase()).toBe('1m')

    const speedStops = buildScrollSpeedSliderStops()
    expect(speedStops.map(s => s.value)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])

    const wideLayout = computeValueSliderLayout(speedStops, 80)
    expect(wideLayout.compact).toBe(false)
    expect(wideLayout.stopCols.length).toBe(10)

    const narrowLayout = computeValueSliderLayout(acStops, 25)
    expect(narrowLayout.compact).toBe(true)
  })

  test('#187 & #288: /terminal-setup names tmux extkeys, detects WT < 1.25, and lists planned changes before applying', () => {
    expect(formatTmuxExtkeysNote({})).toBeNull()
    const tmuxNote = formatTmuxExtkeysNote({ TERM_PROGRAM: 'tmux' })
    expect(tmuxNote).toContain('set -s extended-keys on')
    expect(tmuxNote).toContain("set -as terminal-features 'xterm*:extkeys'")
    expect(tmuxNote).toContain('tmux source-file ~/.tmux.conf')

    expect(
      isWindowsTerminalBefore125(
        { WT_SESSION: '1', WT_VERSION: '1.22.10352.0' },
        'windows-terminal',
      ),
    ).toBe(true)
    expect(
      isWindowsTerminalBefore125(
        { WT_SESSION: '1', WT_VERSION: '1.25.0' },
        'windows-terminal',
      ),
    ).toBe(false)
    expect(isWindowsTerminalBefore125({}, 'ghostty')).toBe(false)
    expect(WINDOWS_TERMINAL_PRE_125_NOTICE).toContain(
      'Windows Terminal 1.25 or later',
    )

    const vscodeChanges = describePlannedTerminalSetupChanges('vscode')
    expect(vscodeChanges.length).toBeGreaterThanOrEqual(2)
    expect(vscodeChanges.some(c => c.includes('keybindings.json'))).toBe(true)

    const appleChanges = describePlannedTerminalSetupChanges('Apple_Terminal')
    expect(appleChanges.length).toBeGreaterThanOrEqual(3)
    expect(appleChanges.some(c => c.includes('Option as Meta'))).toBe(true)
  })
})
