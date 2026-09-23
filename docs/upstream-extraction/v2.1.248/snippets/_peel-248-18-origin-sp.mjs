/**
 * Peel #18 pass4: newsession origin `w`, function sp (keepQuery), 247 up.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  EXE_247,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStart,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [`when=${new Date().toISOString()}`]
function log(s) {
  lines.push(s)
  console.log(s)
}

function dumpWin(label, off, before = 400, after = 400) {
  log('')
  log(`## ${label} @${off}`)
  log(asciiSlice(buf, off - before, off + after))
}

dumpWin('newsession-row-origin-w', 192175915, 800, 200)

for (const n of ['function sp(', 'sp=(', 'function Ka(', 'scopedFallbackOrigin']) {
  const hits = allHits(buf, n).filter((h) => h >= 191900000 && h < 192400000)
  log('')
  log(`## ${JSON.stringify(n)} count=${hits.length} ${hits.slice(0, 8).join(',')}`)
  for (const h of hits.slice(0, 4)) {
    log(`-- @${h} ${asciiSlice(buf, h - 40, h + n.length + 200)}`)
  }
}

for (const h of allHits(buf, 'function sp(').filter((x) => x >= 191900000 && x < 192400000)) {
  const ext = extractFnAt(buf, h, 4000)
  log('')
  log(`## function sp @${h} sha=${ext.sha} len=${ext.len}`)
  if (ext.body) log(ext.body)
}

// 247 openNewSession / VIy / up-like
try {
  const b247 = loadSea(EXE_247)
  for (const n of [
    'function up(i,d){',
    'beginNewSession()',
    'openNewSessionRow:',
    'kind:"newsession"',
    'fleet_view_new_session',
  ]) {
    const hits = allHits(b247, n)
    log('')
    log(`## 247 ${JSON.stringify(n)} count=${hits.length} ${hits.slice(0, 6).join(',')}`)
    for (const h of hits.slice(0, 3)) {
      log(`-- @${h} ${asciiSlice(b247, h - 40, h + n.length + 220)}`)
    }
  }
  const begin = allHits(b247, 'beginNewSession()')
  for (const h of begin) {
    if (h < 180000000 || h > 200000000) continue
    const found = lastFnStart(b247, h + 20, ['function up(', 'function VIy(', 'async function '])
    log(`247 lastFn before beginNewSession @${h} → ${found.name}@${found.i}`)
    if (found.i >= 0) {
      const ext = extractFnAt(b247, found.i, 4000)
      log(`sha=${ext.sha} len=${ext.len}`)
      if (ext.body) log(ext.body)
    }
  }
} catch (e) {
  log(`247 fail ${e}`)
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-18-origin-sp.txt',
  lines.join('\n'),
)
console.log('wrote', lines.length)
