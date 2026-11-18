import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
} from '../../../packages/@ant/ink/src/core/parse-keypress.js'

describe('2.1.299-300 AgentView alignment', () => {
  test('#573 AgentView supports /fast and opens settingPicker on bare /model, /effort, /fast', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../AgentView.tsx'),
      'utf8',
    )
    expect(src).toContain('sessionFastMode')
    expect(src).toContain('setSettingPicker')
    expect(src).toContain("setting: 'model'")
    expect(src).toContain("setting: 'effort'")
    expect(src).toContain("setting: 'fast'")
    expect(src).toContain(
      "quitToken === '/fast' || quitToken.startsWith('/fast ')",
    )
  })

  test('#771 burst words "up", "down", "escape" are not parsed as arrow/escape keys and are guarded in AgentView', () => {
    for (const word of ['up', 'down', 'escape']) {
      const [events] = parseMultipleKeypresses(INITIAL_STATE, word)
      expect(events.length).toBe(1)
      const ev = events[0]!
      expect('name' in ev).toBe(true)
      if ('name' in ev) {
        expect(ev.name).toBe('')
        expect(ev.sequence).toBe(word)
      }
    }
    const src = fs.readFileSync(
      path.resolve(__dirname, '../AgentView.tsx'),
      'utf8',
    )
    expect(src).toContain('multi-character printable bursts')
  })
})
