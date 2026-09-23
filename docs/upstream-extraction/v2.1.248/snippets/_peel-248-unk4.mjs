/**
 * densable 2.1.248 UNKNOWN pass4 — finish unique bodies:
 * #9 NAn/zce/FAn/Ivt · #23 MCP panel grouping · #25 login_handoff dialog
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
lines.push(`# gold-248-unk-pass4`)
lines.push(`# when=${new Date().toISOString()}`)
lines.push('')

function dumpWin(tag, buf, i, before = 80, after = 400) {
  if (i < 0) {
    lines.push(`## ${tag} MISS`)
    lines.push('')
    return
  }
  lines.push(`## ${tag} @${i}`)
  lines.push(h.asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(tag, buf, i, maxLen = 8000) {
  const ex = h.extractFnAt(buf, i, maxLen)
  if (!ex.body) {
    lines.push(`## ${tag} FAIL @${i} ${JSON.stringify(ex).slice(0, 180)}`)
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

// ---- #9 ----
lines.push('# ---- #9 NAn zce FAn Ivt ----')
dumpFn('#9 NAn', b248, 185604567, 200)
{
  const hits = h.allHits(b248, 'function zce(')
  lines.push(`## function zce( hits=${hits.length} ${hits.slice(0, 8)}`)
  for (const off of hits.filter((x) => x > 170000000).slice(0, 6)) {
    dumpFn('#9 zce', b248, off, 2500)
  }
}
{
  // FAn nearby NAn
  dumpWin('#9 FAn-near-NAn', b248, 185604500, 400, 200)
  const hits = h.allHits(b248, 'FAn')
  lines.push(`## FAn hits=${hits.length}`)
  for (const off of hits.filter((x) => x > 185580000 && x < 185620000)) {
    dumpWin('#9 FAn', b248, off, 60, 120)
  }
}
{
  const hits = h.allHits(b248, 'function Ivt(')
  lines.push(`## function Ivt( hits=${hits.length}`)
  for (const off of hits) dumpFn('#9 Ivt', b248, off, 2500)
}
{
  const hits = h.allHits(b248, 'function jTt(')
  for (const off of hits.filter((x) => x > 180000000).slice(0, 3)) {
    dumpFn('#9 jTt', b248, off, 2000)
  }
}

function dumpHits(tag, needle) {
  const a = h.allHits(b248, needle)
  const b = b247 ? h.allHits(b247, needle).length : 'NA'
  lines.push(`## ${tag} 248=${a.length} 247=${b}`)
  for (const off of a.filter((x) => x > 170000000).slice(0, 4)) {
    dumpWin(tag, b248, off, 60, 180)
  }
}

dumpHits('#9 zce(FAn', 'zce(FAn')
dumpHits('#9 var FAn', 'var FAn=')
dumpHits('#9 FAn=', 'FAn=')

// 247 PR() for ScheduleWakeup
if (b247) {
  dumpWin('#9 247 PR prompt', b247, 216445531, 200, 200)
  const hits = h.allHits(b247, 'function PR(')
  lines.push(`## 247 function PR( hits=${hits.length}`)
  for (const off of hits.filter((x) => x > 210000000 && x < 220000000).slice(0, 5)) {
    dumpFn('#9 247 PR', b247, off, 1500)
  }
}

// ---- #23 MCP panel grouping extract ----
lines.push('# ---- #23 MCP grouping body ----')
{
  // from ebn-call @209648224 extract larger function
  const fn = h.lastFnStartGeneric(b248, 209648224, 8000)
  lines.push(`## #23 group lastFn ${fn.name} @${fn.i}`)
  dumpWin('#23 group-start', b248, fn.i > 0 ? fn.i : 209647800, 20, 200)
  // dump 209647800-209652200 grouping+headings
  lines.push('## #23 grouping 4k')
  lines.push(h.asciiSlice(b248, 209647800, 209652200))
  lines.push('')
}

{
  // heading render for claude.ai vs Project MCPs
  const hits = h.allHits(b248, 'Project MCPs')
  for (const off of hits.filter((x) => x > 200000000)) {
    dumpWin('#23 Project MCPs', b248, off, 80, 300)
  }
}

if (b247) {
  const hits = h.allHits(b247, 'function ebn(')
  lines.push(`## 247 function ebn( hits=${hits.length}`)
  for (const off of hits) dumpFn('#23 247 ebn', b247, off, 400)
  // 247 grouping type!==claudeai-proxy
  dumpWin('#23 247 group leftover', b247, 236549574, 100, 500)
}

// ---- #25 login_handoff dialog ----
lines.push('# ---- #25 login_handoff dialog ----')
dumpWin('#25 dialog reveal', b248, 201101704, 100, 1200)
{
  const fn = h.lastFnStartGeneric(b248, 201101704, 4000)
  lines.push(`## #25 dialog lastFn ${fn.name} @${fn.i}`)
  if (fn.i > 0) dumpFn('#25 dialogFn', b248, fn.i, 12000)
}

{
  // consentHandoffRevealActive setter
  const n = 'consentHandoffRevealActive'
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n).length : 'NA'
  lines.push(`## consentHandoffRevealActive 248=${a.length} 247=${b}`)
  for (const off of a.filter((x) => x > 170000000)) {
    dumpWin('#25 handoff', b248, off, 80, 200)
  }
}

{
  const hits = h.allHits(b248, 'function nie(')
  for (const off of hits.filter((x) => x > 202540000 && x < 202560000)) {
    dumpFn('#25 nie-real', b248, off, 400)
  }
  // extract pOe generator with larger window from site
  dumpWin('#25 pOe-full', b248, 202549952, 0, 400)
}

const out = join(here, 'gold-248-unk-pass4.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
