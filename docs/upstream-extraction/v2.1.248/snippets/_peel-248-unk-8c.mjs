/**
 * densable 2.1.248 #8 pass C — kn() compose cache + Gx flag + 247 pa().
 */
import { existsSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const h = createRequire(import.meta.url)('./_peel-248-na-helpers.mjs')
const b248 = h.loadSea(h.EXE_248)
const b247 = existsSync(h.EXE_247) ? h.loadSea(h.EXE_247) : null
const lines = []
lines.push('# gold-248-unk-8c')
lines.push(`# when=${new Date().toISOString()}`)
lines.push('')

function dumpFn(tag, buf, i, maxLen = 6000) {
  if (i == null || i < 0) {
    lines.push(`## ${tag} MISS`)
    lines.push('')
    return null
  }
  const ex = h.extractFnAt(buf, i, maxLen)
  if (!ex.body) {
    lines.push(`## ${tag} FAIL @${i} ${JSON.stringify(ex).slice(0, 200)}`)
    lines.push('')
    return ex
  }
  const other =
    buf === b248 && b247 ? h.allHits(b247, ex.body).length : 'NA'
  lines.push(`## ${tag} @${i} len=${ex.len} sha=${ex.sha} otherHits=${other}`)
  lines.push(ex.body)
  lines.push('')
  return ex
}

function dumpWin(tag, buf, i, before = 80, after = 300) {
  if (i == null || i < 0) {
    lines.push(`## ${tag} MISS`)
    lines.push('')
    return
  }
  lines.push(`## ${tag} @${i}`)
  lines.push(h.asciiSlice(buf, i - before, i + after))
  lines.push('')
}

// kn() next to IW/o_/s_
lines.push('# ---- kn / Gx / compose class ----')
{
  const hits = h.allHits(b248, 'function kn()')
  lines.push(`## function kn() hits=${hits.length} ${hits.slice(0, 8)}`)
  for (const i of hits.filter((x) => x > 179000000 && x < 181000000)) {
    dumpFn('#8 kn', b248, i, 800)
  }
}

for (const n of [
  'keepAcrossTokenChanges',
  'dropInFlightComposes',
  'dropInFlight',
  'inFlightComposes',
]) {
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n).length : 'NA'
  lines.push(`## needle ${JSON.stringify(n)} 248=${a.length} 247=${b}`)
  for (const i of a.filter((x) => x > 170000000).slice(0, 6)) {
    dumpWin(`#8 ${n}`, b248, i, 120, 250)
    const fn = h.lastFnStartGeneric(b248, i, 1500)
    if (fn.i > 0) dumpFn(`#8 ${n}-fn ${fn.name}`, b248, fn.i, 2500)
  }
}

// Gx used by s_()
{
  const hits = h.allHits(b248, 'Gx')
  // too many; look around s_ @180125738
  dumpWin('#8 Gx-near-s_', b248, 180125738, 400, 250)
}

// class around dropInFlightComposes
{
  const hits = h.allHits(b248, 'dropInFlightComposes')
  for (const i of hits) {
    dumpWin('#8 class-around-drop', b248, i, 800, 400)
  }
}

// 247 pa() + mR class
if (b247) {
  lines.push('# ---- 247 pa / mR ----')
  const hits = h.allHits(b247, 'function pa()')
  lines.push(`## 247 function pa() hits=${hits.length} ${hits.slice(0, 8)}`)
  for (const i of hits.filter((x) => x > 208800000 && x < 208850000)) {
    dumpFn('#8 247 pa', b247, i, 400)
  }
  dumpWin('#8 247 mR-class', b247, 208828572, 600, 400)
  const keep = h.allHits(b247, 'keepAcrossTokenChanges')
  lines.push(`## 247 keepAcrossTokenChanges hits=${keep.length}`)
  const drop = h.allHits(b247, 'dropInFlightComposes')
  lines.push(`## 247 dropInFlightComposes hits=${drop.length}`)
}

// Bd / al — betas reset
lines.push('# ---- jN betas reset ----')
{
  const hits = h.allHits(b248, 'function Bd()')
  lines.push(`## function Bd() hits=${hits.length} ${hits.slice(0, 6)}`)
  for (const i of hits.filter((x) => x > 180200000 && x < 180400000).slice(0, 3)) {
    dumpFn('#8 Bd', b248, i, 400)
  }
}
{
  const hits = h.allHits(b248, 'function al()')
  lines.push(`## function al() hits=${hits.length} ${hits.slice(0, 6)}`)
  for (const i of hits.filter((x) => x > 180200000 && x < 180400000).slice(0, 3)) {
    dumpFn('#8 al', b248, i, 800)
  }
}

// 247 De().betas=Xc()
if (b247) {
  dumpFn('#8 247 no-betas', b247, 208606096, 200)
  const hits = h.allHits(b247, 'function De()')
  for (const i of hits.filter((x) => x > 208580000 && x < 208630000).slice(0, 2)) {
    dumpFn('#8 247 De', b247, i, 400)
  }
}

// leftover-looking: clearToolSchemaCache callers vs official G2t
lines.push('# ---- G2t vs leftover save trio ----')
dumpWin('#8 leftover-compare', b248, 180709491, 0, 80)

const out = join(here, 'gold-248-unk-8c.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
