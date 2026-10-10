#!/usr/bin/env bun
import { writeFileSync } from 'fs'
import { allHits, asciiSlice, loadSea } from './_peel-289-helpers.mjs'

const buf = loadSea()

function windows(needle, radius = 1800, max = 6) {
  const hits = allHits(buf, needle)
  return hits.slice(0, max).map((i, k) => ({
    k,
    i,
    s: asciiSlice(buf, i - 200, i + radius),
  }))
}

const targets = [
  'ui.fault',
  'ui_client_fault',
  'ui.scroll',
  'ui.focus',
  'ui.toast',
  'ui.render',
  'functionHooks',
  'AbovePrompt',
  'scrollSites',
  'CloseMark',
  'OverflowCue',
  'hasCue',
  'enterConfirms',
  'docked',
  'ErrorBoundary',
  'thrownAt',
  'drawnAgain',
  'laidOut',
  'frameOutcome',
  'passed over',
  'the module failed without a message',
  'bareElicitation',
  'cliOwnedConfigs',
  'sdk_default_off',
  'CHILD_ARTIFACT',
  'elicitation/create',
  'mcp_elicitation',
]

const out = {}
for (const t of targets) out[t] = windows(t, 1400, 4)
writeFileSync('/tmp/peel-289-windows.json', JSON.stringify(out))
console.log(
  Object.fromEntries(
    Object.entries(out).map(([k, v]) => [k, v.map(x => x.i)]),
  ),
)
