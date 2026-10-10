#!/usr/bin/env bun
import { allHits, asciiSlice, loadSea } from './_peel-289-helpers.mjs'

const buf = loadSea()

function dump(needle, radius = 900, max = 3) {
  const hits = allHits(buf, needle)
  console.log('\n########', JSON.stringify(needle), 'count=', hits.length)
  for (const i of hits.slice(0, max)) {
    console.log('---', i)
    console.log(asciiSlice(buf, i - 120, i + radius))
  }
}

const needles = [
  'ui_copy',
  'ui_prompt_read',
  'ui_prompt_fill',
  'ui_prompt_suggest',
  'ui_read_selection',
  'session.attach',
  'claude:surface-runtime',
  'client_modules',
  'hover.scope',
  'ui_client_fault',
  'Unsupported control request subtype',
  'ui.message',
  'ui.input',
  'surface.post',
  'the module failed without a message',
  'SITE_RULES',
  'did you mean',
  'hooks/board.tsx',
  'instance_id#seq',
  'e.viewport.isFullscreen',
  'first <= last < of',
  'press.plugin',
  'press.handle',
  'ui_press',
  'ui_select',
  'ui_attach',
  'Fco',
  'rowHolding',
  '$.ui.selection',
  'functionHooks',
  'plugin.mcp',
  'mcp.json',
  'userConfig.mcp',
  'bareElicitationCapability',
  'elicitation capability',
  'cli-owned',
  'cliOwned',
]

for (const n of needles) dump(n, 700, 2)
