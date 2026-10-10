#!/usr/bin/env bun
import { allHits, asciiSlice, loadSea } from './_peel-289-helpers.mjs'

const buf = loadSea()

function dump(needle, radius = 500, max = 2) {
  const hits = allHits(buf, needle)
  console.log('\n########', JSON.stringify(needle), 'count=', hits.length)
  for (const i of hits.slice(0, max)) {
    console.log('---', i)
    console.log(asciiSlice(buf, Math.max(0, i - 80), i + radius))
  }
}

const needles = [
  'takes a ui.render argument',
  'did not answer within',
  'no handler is held under handle',
  'the press is not plain data',
  'unasked below',
  'placed when the person opens it',
  'waiting, ',
  'site failed:',
  'the chain threw',
  'the fault could not be said',
  'no client instance',
  'loaded no surface module',
  'is not a function (props, surface)',
  'ran longer than its',
  'surface environment of',
  'nothing was drawn',
  'the pane was closed',
  'Unsupported control request subtype: ui_client_fault',
  'hover display',
  'would hide it under the pointer',
  'hover.scope',
  'onScreen',
  'ui_prompt_edit',
  'ui.prompt',
  'prompt.edit',
  '$.ui.copy',
  'no-clipboard',
  'ui.copy',
  'session.surfaces',
  'client_modules',
  'surface:///',
  'claude:hooks-types',
  'ui_client_module',
  'ui_panes',
  'ui_pane_show',
  'ui_close',
  'plugin.json',
  'functionHooks',
  'hooks/register',
  'classic.ui.render',
  'SITE_RULES so it never runs',
  '(did you mean',
  'did you mean ',
  'Elicitation response content does not match',
  'bareElicitationCapability',
  'Java MCP SDK',
]

for (const n of needles) dump(n, 420, 2)
