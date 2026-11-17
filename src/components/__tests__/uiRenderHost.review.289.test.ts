import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('real Ink ui.render host handles cyclic inputs and fresh props without extra no-hook renders', () => {
  const child = Bun.spawnSync(
    [process.execPath, `${import.meta.dir}/uiRenderHost.fixture.tsx`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  expect(child.stdout.toString() + child.stderr.toString()).toContain(
    'UI_RENDER_HOST_REVIEW_OK',
  )
  expect(child.exitCode).toBe(0)
})

test('plugin engine fallbacks only attach measurement ref when no outer plugin host exists', () => {
  for (const file of [
    'messages/AssistantToolUseMessage.tsx',
    'messages/SystemTextMessage.tsx',
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    expect(source).toMatch(
      /ref=\{\s*rendered\.pluginTree === undefined\s*\?\s*\(?rendered\.hostRef as React\.Ref<DOMElement>\)?\s*:\s*undefined\s*\}/,
    )
  }
})

test('both effort panel confirmations preserve inherited session effort when toggling Ultracode', () => {
  const source = readFileSync(
    new URL('../EffortPanel/EffortPanel.tsx', import.meta.url),
    'utf8',
  )
  expect(source).toContain('let nextEffort = resolvedSessionEffort')
  expect(source).toContain(
    'executeEffort(arg, model, undefined, true, resolvedSessionEffort)',
  )
  expect(source).not.toContain(
    'executeEffort(arg, model, undefined, true, appStateEffort)',
  )
})
