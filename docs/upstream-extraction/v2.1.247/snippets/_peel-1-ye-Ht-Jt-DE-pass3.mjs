import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiSlice(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (i < buf.length) {
    const k = buf.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  return hits
}

function findFromAfter(i) {
  const win = asciiSlice(b247, i, i + 8000)
  const m = win.match(/from"B:\/~BUN\/root\/[^"]+"/)
  return m ? { clause: m[0], at: i + win.indexOf(m[0]) } : { miss: true, preview: win.slice(-200) }
}

function findVersionHeaderBefore(i) {
  const needle = Buffer.from('// Version: 2.1.247\n')
  let last = -1
  let p = 0
  while (p < i) {
    const k = b247.indexOf(needle, p)
    if (k < 0 || k >= i) break
    last = k
    p = k + needle.length
  }
  return last
}

const lines = ['# gold-1-ye-Ht-Jt-DE-pass3 247', '']

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b247, i - before, i + after))
  lines.push('')
}

function dumpHits(label, needle, around = 80, cap = 10) {
  const hits = allHits(b247, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [idx, off] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${off} ${asciiSlice(b247, off - around, off + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

// leftover barrel: resolve kb as xSa import source
const kbAsXsa = 219710851
const kbFrom = findFromAfter(kbAsXsa)
lines.push(`## kb-as-xSa from ${JSON.stringify(kbFrom)}`)
lines.push('')
dumpAround('kb-as-xSa-from-win', kbFrom.at ?? kbAsXsa, 40, 80)

// Lfs module header + imports
const lfs = 216525849
const lfsHdr = findVersionHeaderBefore(lfs)
dumpAround('Lfs-module-header', lfsHdr, 20, 2500)

// Poe/DE module header
const poe = 219563597
const poeHdr = findVersionHeaderBefore(poe)
dumpAround('Poe-module-header', poeHdr, 20, 2500)

// _158: find module that IS _158 (export Ps,Qs,Os)
// bun table often: <exportNames>B:/~BUN/root/_158.js
dumpAround('_158-table-names', 192216521, 250, 80)
dumpHits('root/_158.js after names', 'B:/~BUN/root/_158.js', 120, 16)

// Find _158 source by unique Os+Ps+Qs export glue
dumpHits('PsQs glue', 'PsQs')
dumpHits('export Ps Qs Os glue', 'Os,Ps,Qs')
dumpHits('_158 export map Os', 'Os as Yne')

// jr module already imports Ps as Ht from _158 — find _158 file body via
// neighboring unique string from table: geGBd LsYo Ms en Ns jr
dumpHits('geGBd', 'geGBd')

// search _158 source: modules that export both Ps and Qs
dumpHits('as Ht,Qs as Jt already', 'Ps as Ht,Qs as Jt')

// Find functions that take live messages and emit draft transcript shape
dumpHits(
  'live-filter-shape',
  'typeof e.uuid!=="string"||typeof e.timestamp!=="string"||e.isSidechain===!0',
)
dumpHits(
  'live-filter-t',
  'typeof t.uuid!=="string"||typeof t.timestamp!=="string"||t.isSidechain===!0',
)
dumpHits('for(let a of e)', 'for(let a of e)')
dumpHits('session messages ye-ish', 'isSidechain===!0||!e.message)continue;s.push')
dumpHits('isSidechain===!0||!t.message)continue;s.push', 'isSidechain===!0||!t.message)continue;s.push')

// kb definition that is NOT the 10 function kb( we already classified —
// maybe it's exported under original name from leftover source file
dumpHits('export{kb as', 'export{kb as')
dumpHits('export{kb}', 'export{kb}')
dumpHits(',kb as xSa', ',kb as xSa')

// DE import in Lfs / Poe modules
dumpHits('qcd as DE', 'qcd as DE')
dumpHits('Vzd as DE', 'Vzd as DE')
dumpHits('function qcd(', 'function qcd(')
dumpHits('function Vzd(', 'function Vzd(')
dumpHits('qcd=', 'qcd=')

// storage key reject leftover names from 246
dumpHits('function describeStorageKey', 'function describeStorageKey')
dumpHits('must be the recording stamp', 'must be the recording stamp')
dumpHits('names a .jsonl stream', 'names a .jsonl stream')

writeFileSync(`${outDir}/gold-1-ye-Ht-Jt-DE-pass3.txt`, lines.join('\n'))
console.log('WROTE', lines.join('\n').length)
