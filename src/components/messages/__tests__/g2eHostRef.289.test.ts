import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const toolUse = readFileSync(
  join(import.meta.dir, '../AssistantToolUseMessage.tsx'),
  'utf8',
)
const toolResult = readFileSync(
  join(import.meta.dir, '../UserToolResultMessage/UserToolResultMessage.tsx'),
  'utf8',
)
const turn = readFileSync(
  join(import.meta.dir, '../SystemTextMessage.tsx'),
  'utf8',
)
const notice = readFileSync(
  join(import.meta.dir, '../../../utils/statusNoticeDefinitions.tsx'),
  'utf8',
)
const assistant = readFileSync(
  join(import.meta.dir, '../AssistantTextMessage.tsx'),
  'utf8',
)

describe('densable 2.1.289 g2e t7t hostRef / onScreen', () => {
  test('useUiRenderHost cards attach hostRef', () => {
    expect(toolUse).toContain('rendered.hostRef')
    expect(toolResult).toContain('rendered.hostRef')
    expect(turn).toContain('rendered.hostRef')
    expect(notice).toContain('rendered.hostRef')
  })

  test('AssistantMessage measures onScreen like UserMessage', () => {
    expect(assistant).toContain("isG2eComponent('AssistantMessage')")
    expect(assistant).toContain('useSiteMeasure')
    expect(assistant).toContain('...(onScreen !== undefined && { onScreen })')
    expect(assistant).toContain('hostRef')
  })
})
