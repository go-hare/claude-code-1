/**
 * Peel #18 pass3: cs (openOrRespawn), keepQuery, Lc newsession tail, ag newsession.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  EXE_247,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const buf = loadSea(EXE_248)
const lines = [`when=${new Date().toISOString()}`]

function log(s) {
  lines.push(s)
  console.log(s)
}

function dumpWin(label, off, before = 200, after = 500) {
  log('')
  log(`## ${label} @${off}`)
  log(asciiSlice(buf, off - before, off + after))
}

const FLEET_LO = 191900000
const FLEET_HI = 192400000
function hitsIn(needle) {
  return allHits(buf, needle).filter((h) => h >= FLEET_LO && h < FLEET_HI)
}

for (const n of [
  'function cs(',
  'cs=(',
  'keepQuery',
  'freshDispatch',
  'function dp(',
  'openNewSessionRow(',
]) {
  const hits = hitsIn(n)
  log('')
  log(`## ${JSON.stringify(n)} count=${hits.length} ${hits.slice(0, 10).join(',')}`)
  for (const h of hits.slice(0, 6)) {
    log(`-- @${h} ${asciiSlice(buf, h - 50, h + n.length + 180)}`)
  }
}

for (const h of hitsIn('function cs(')) {
  const ext = extractFnAt(buf, h, 25000)
  log('')
  log(`## function cs @${h} sha=${ext.sha} len=${ext.len} missEnd=${ext.missEnd}`)
  if (ext.body) {
    log(`hasKeepQuery=${ext.body.includes('keepQuery')} hasDropDraft=${ext.body.includes('dropDraft')}`)
    log(ext.body.slice(0, 8000) + (ext.body.length > 8000 ? '\n…TRUNC…' : ''))
  }
}

// Lc tail around newsession
dumpWin('Lc-newsession-tail', 192165253, 800, 80)

// ag newsession + empty-query right
{
  const ext = extractFnAt(buf, 192252514, 40000)
  log('')
  log(`## ag sha=${ext.sha} len=${ext.len}`)
  if (ext.body) {
    const i = ext.body.indexOf('newsession')
    log(`newsession idx=${i}`)
    if (i >= 0) log(ext.body.slice(Math.max(0, i - 400), i + 500))
    const j = ext.body.indexOf('willInsertNewline')
    log(`willInsertNewline idx=${j}`)
    if (j >= 0) log(ext.body.slice(Math.max(0, j - 80), j + 200))
  }
}

// compare 247 up if present
try {
  const b247 = loadSea(EXE_247)
  const hits = allHits(b247, 'function up(i,d){let{editor:m,roster:w,attach:S,storageV5:h}=i')
  log('')
  log(`## 247 same-up-sig hits=${hits.length} ${hits.join(',')}`)
  for (const h of hits.slice(0, 2)) {
    const ext = extractFnAt(b247, h, 4000)
    log(`247 up @${h} sha=${ext.sha} len=${ext.len}`)
    if (ext.body) log(ext.body)
  }
  const hits2 = allHits(b247, 'fleet_view_new_session')
  log(`## 247 fleet_view_new_session hits=${hits2.length}`)
} catch (e) {
  log(`## 247 compare fail ${e}`)
}

writeFileSync(`${outDir}/gold-248-18-cs.txt`, lines.join('\n'))
console.log('wrote', lines.length)
