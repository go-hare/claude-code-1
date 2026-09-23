/**
 * Second peel: v$e, Di, sS, terminalHolders writers, deadEpochReapedAt writer.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const buf = loadSea(EXE_248)
const lines = [`exe bytes=${buf.length}`, `when=${new Date().toISOString()}`]

function dumpWin(label, off, before = 300, after = 900) {
  lines.push('')
  lines.push(`## ${label} @${off}`)
  lines.push(asciiSlice(buf, off - before, off + after))
}

for (const n of ['v$e', 'var v$e', 'v$e=', 'T(v$e)']) {
  const hits = allHits(buf, n)
  lines.push('')
  lines.push(`## hits ${JSON.stringify(n)} count=${hits.length}`)
  for (const h of hits.slice(0, 8)) {
    lines.push(`-- @${h}`)
    lines.push(asciiSlice(buf, h - 120, h + 280))
  }
}

// Di(d.state) near open path
dumpWin('Di-sS-open', 192188300, 80, 400)

// function Di / function sS near fleet chunk
for (const name of ['function Di(', 'function sS(']) {
  const hits = allHits(buf, name)
  lines.push('')
  lines.push(`## ${name} count=${hits.length} ${hits.join(',')}`)
  for (const h of hits.slice(0, 6)) {
    const ext = extractFnAt(buf, h, 2000)
    lines.push(`-- @${h} ${ext.body ? `len=${ext.len}` : JSON.stringify(ext)}`)
    if (ext.body) lines.push(ext.body)
    else lines.push(asciiSlice(buf, h, h + 400))
  }
}

// terminalHolders writers
dumpWin('terminalHolders-update', 192139226, 600, 1200)

// deadEpochReapedAt writer @182999421
dumpWin('deadEpoch-writer', 182999421, 1200, 800)
const fn = lastFnStartGeneric(buf, 182999421, 4000)
lines.push('')
lines.push(`## deadEpoch-writer-fn ${fn.name} @${fn.i}`)
const ext = extractFnAt(buf, fn.i, 6000)
if (ext.body) {
  lines.push(`len=${ext.len} sha=${ext.sha}`)
  lines.push(ext.body)
} else {
  lines.push(JSON.stringify(ext))
}

// Wr assignment in row
dumpWin('Wr-assign', 192197201, 200, 600)

// liveStatus + terminalHolder
dumpWin('liveStatus-holder', 192133247, 400, 200)

// How terminalHolders map is filled — search ".set(" near terminalHolders
const setHits = allHits(buf, 'terminalHolders.set')
const getHits = allHits(buf, 'terminalHolders.get')
lines.push('')
lines.push(`## terminalHolders.set ${setHits} get ${getHits}`)
for (const h of [...setHits, ...getHits]) {
  lines.push(`-- @${h}`)
  lines.push(asciiSlice(buf, h - 200, h + 300))
}

// #p("terminalHolders"
const pHits = allHits(buf, '#p("terminalHolders"')
lines.push('')
lines.push(`## #p terminalHolders ${pHits}`)
for (const h of pHits) {
  dumpWin('p-terminalHolders', h, 800, 400)
}

// deadEpochGoneJobId / Offered
for (const n of [
  'deadEpochGoneJobId',
  'deadEpochOfferedJobId',
  'deadEpochOfferAgeMs',
  'tengu_fleetview_dead_epoch_offer',
]) {
  const hits = allHits(buf, n)
  lines.push('')
  lines.push(`## hits ${n} ${hits.join(',')}`)
  for (const h of hits.slice(0, 6)) {
    lines.push(`-- @${h}`)
    lines.push(asciiSlice(buf, h - 80, h + 200))
  }
}

writeFileSync(`${outDir}/gold-248-17-19b.txt`, lines.join('\n'))
console.log('wrote', lines.length)
