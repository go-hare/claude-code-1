#!/usr/bin/env bun
import { writeFileSync } from 'fs'
import { allHits, asciiSlice, loadSea } from './_peel-289-helpers.mjs'

const buf = loadSea()

function extractQuoted(slice) {
  const out = new Set()
  const re = /["'`]([^"'`]{4,120})["'`]/g
  let m
  while ((m = re.exec(slice))) {
    const s = m[1]
    if (/[A-Za-z]/.test(s) && /[ a-z]/.test(s)) out.add(s)
  }
  return [...out]
}

const anchors = [
  [72273173, 25000, 'functionHooks-first'],
  [80739670, 25000, 'functionHooks-2'],
  [80962831, 25000, 'functionHooks-3'],
  [80968741, 25000, 'functionHooks-4'],
  [75660384, 12000, 'ui.fault-1'],
  [79049144, 12000, 'ui.fault-2'],
  [79181906, 12000, 'ui.fault-3'],
  [80736250, 20000, 'ui.fault-4'],
  [72582608, 8000, 'ui_client_fault-1'],
  [80977896, 15000, 'ui_client_fault-2'],
  [74310538, 15000, 'ErrorBoundary'],
  [74305868, 12000, 'laidOut'],
  [75658492, 15000, 'frameOutcome'],
  [72717992, 15000, 'CloseMark'],
  [72719128, 8000, 'OverflowCue'],
  [72806473, 8000, 'hasCue'],
  [72806656, 8000, 'docked'],
  [72859428, 8000, 'enterConfirms'],
  [78348564, 8000, 'scrollSites'],
  [80738991, 15000, 'ui.scroll-3'],
  [80741594, 15000, 'ui.scroll-4'],
  [72854049, 8000, 'ui.toast-1'],
  [72815200, 8000, 'ui.render-1'],
  [78047780, 8000, 'bareElicitation'],
  [81070124, 8000, 'cliOwnedConfigs'],
  [79713768, 6000, 'sdk_default_off'],
  [75606723, 8000, 'CHILD_ARTIFACT'],
  [76832920, 8000, 'elicitation/create'],
  [72970708, 8000, 'mcp_elicitation'],
  [72718928, 8000, 'AbovePrompt-1'],
  [72803440, 12000, 'AbovePrompt-2'],
]

const out = {}
for (const [i, len, name] of anchors) {
  const s = asciiSlice(buf, i - 400, i + len)
  out[name] = {
    i,
    quoted: extractQuoted(s).filter(
      x =>
        !x.startsWith('http') &&
        !x.includes('node_modules') &&
        /[A-Za-z]{3}/.test(x),
    ),
    preview: s.slice(0, 600),
  }
}
writeFileSync('/tmp/peel-289-quoted.json', JSON.stringify(out, null, 2))
for (const [k, v] of Object.entries(out)) {
  console.log('\n====', k, '====')
  console.log(v.quoted.slice(0, 80).join('\n'))
}
