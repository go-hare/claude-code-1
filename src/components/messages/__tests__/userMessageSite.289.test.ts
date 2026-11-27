import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const prompt = readFileSync(
  join(import.meta.dir, '../UserPromptMessage.tsx'),
  'utf8',
)
const panesDir = join(import.meta.dir, '../../pluginRaster')
const panes = [
  readFileSync(join(import.meta.dir, '../../PluginRasterPanes.tsx'), 'utf8'),
  ...readdirSync(panesDir)
    .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
    .sort()
    .map(f => readFileSync(join(panesDir, f), 'utf8')),
].join('\n')
const toolUse = readFileSync(
  join(import.meta.dir, '../AssistantToolUseMessage.tsx'),
  'utf8',
)

describe('densable 2.1.289 TDe UserMessage / Xu ToolUse', () => {
  test('UserPromptMessage is the engine draw, not a second ui.render host', () => {
    expect(prompt).not.toContain("component: 'UserMessage'")
    expect(prompt).toContain('rewrittenText')
    expect(prompt).toContain('rewrittenText ?? param.text')
  })

  test('PluginUserMessageSite passes origin/isExpanded/task/from and rewritten text', () => {
    expect(panes).toContain("component: 'UserMessage'")
    expect(panes).toContain('...(origin !== undefined && { origin })')
    expect(panes).toContain('rewrittenText')
  })

  test('Xu ToolUse HAS carries isInterrupted and output; rewrite is input/toolLabel only', () => {
    expect(toolUse).toContain('isInterrupted')
    expect(toolUse).toContain('interruptedCall(resultMsg)')
    expect(toolUse).toContain('output,')
    expect(toolUse).toContain('toolLabel')
    expect(toolUse).not.toContain('outputOverride')
  })
})
