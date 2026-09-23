/**
 * Peel #18 pass5: np fallbackOrigin, Rb group, 247 Lc newsession branch.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  EXE_247,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [`when=${new Date().toISOString()}`]
function log(s) {
  lines.push(s)
  console.log(s)
}

const hits = allHits(buf, 'function np(')
log(`np hits=${hits.join(',')}`)
for (const h of hits.filter((x) => x > 191900000 && x < 192400000)) {
  const ext = extractFnAt(buf, h, 8000)
  log(`## np @${h} sha=${ext.sha} len=${ext.len}`)
  if (ext.body) log(ext.body)
}

for (const n of ['np(', 'fallbackOrigin', 'group:Rb', 'var Rb=', 'Rb="']) {
  const hs = allHits(buf, n).filter((h) => h >= 191900000 && h < 192400000)
  log(`\n## ${JSON.stringify(n)} count=${hs.length}`)
  for (const h of hs.slice(0, 8)) {
    log(`-- @${h} ${asciiSlice(buf, h - 60, h + n.length + 160)}`)
  }
}

// 247 Lc around newsession
try {
  const b247 = loadSea(EXE_247)
  const hs = allHits(b247, 'kind==="newsession"')
  log(`\n## 247 kind===newsession count=${hs.length}`)
  for (const h of hs) {
    log(`-- @${h} ${asciiSlice(b247, h - 200, h + 220)}`)
  }
} catch (e) {
  log(`247 fail ${e}`)
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-18-fallback.txt',
  lines.join('\n'),
)
console.log('wrote', lines.length)
