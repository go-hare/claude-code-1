/**
 * densable 2.1.248 UNKNOWN pass3 — extract unique candidates:
 * #9 B1 ignoreOverage · #23 ebn + MCP list · #8 mE · #25 login_handoff
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
lines.push(`# gold-248-unk-pass3`)
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
    lines.push(`## ${tag} EXTRACT FAIL @${i} ${JSON.stringify(ex).slice(0, 200)}`)
    lines.push('')
    return ex
  }
  const other =
    buf === b248 && b247
      ? h.allHits(b247, ex.body).length
      : buf === b247
        ? h.allHits(b248, ex.body).length
        : 'NA'
  lines.push(`## ${tag} @${i} len=${ex.len} sha=${ex.sha} otherHits=${other}`)
  lines.push(ex.body)
  lines.push('')
  return ex
}

// ---- #9 B1 ignoreOverage ----
lines.push('# ---- #9 B1 ignoreOverage ----')
{
  const n = 'ignoreOverage'
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n) : []
  lines.push(`## ignoreOverage 248=${a.length} 247=${b.length}`)
  for (const i of a) dumpWin('#9 ignoreOverage', b248, i, 100, 220)
  for (const i of b) dumpWin('#9 247 ignoreOverage', b247, i, 100, 220)
}

{
  const hits = h.allHits(b248, 'function B1(')
  lines.push(`## function B1( hits=${hits.length} ${hits.slice(0, 8)}`)
  for (const i of hits.filter((x) => x > 170000000).slice(0, 6)) {
    dumpFn('#9 B1', b248, i, 4000)
  }
}

{
  // caller of k5n / B1 at 185604985
  dumpWin('#9 prompt() caller', b248, 185604985, 400, 400)
  const fn = h.lastFnStartGeneric(b248, 185604985, 3000)
  lines.push(`## #9 lastFn ${fn.name} @${fn.i}`)
  if (fn.i > 0) dumpFn(`#9 caller ${fn.name}`, b248, fn.i, 6000)
}

{
  // DAn inputSchema nearby
  const hits = h.allHits(b248, 'function DAn(')
  for (const i of hits) dumpFn('#9 DAn', b248, i, 3000)
}

if (b247) {
  const n = 'repl_main_thread",{'
  const hits = h.allHits(b247, 'B1("repl_main_thread"')
  lines.push(`## #9 247 B1("repl_main_thread" hits=${hits.length}`)
  const hits2 = h.allHits(b247, '"repl_main_thread"')
  // look for ScheduleWakeup prompt resolve
  const g = 'the guidance here stays the same'
  const gi = h.allHits(b247, g)
  for (const i of gi) {
    // find who calls S3t
    dumpWin('#9 247 guidance', b247, i, 40, 40)
  }
  const s3 = h.allHits(b247, 'S3t(')
  lines.push(`## #9 247 S3t( hits=${s3.length}`)
  for (const i of s3.filter((x) => x > 200000000).slice(0, 6)) {
    dumpWin('#9 247 S3t-call', b247, i, 120, 160)
  }
}

// ---- #8 mE / 247 no+ki near oauth ----
lines.push('# ---- #8 mE / 247 trio ----')
{
  const hits = h.allHits(b248, 'function mE(')
  lines.push(`## function mE( hits=${hits.length} ${hits.slice(0, 10)}`)
  for (const off of hits.filter((x) => Math.abs(x - 180712775) < 20000)) {
    dumpFn('#8 mE-near', b248, off, 2000)
  }
  for (const off of hits.filter((x) => x > 180700000 && x < 180730000)) {
    dumpFn('#8 mE-window', b248, off, 2000)
  }
}

{
  // dump 180712150-180713000 full
  lines.push('## #8 clear-cluster 180712150')
  lines.push(h.asciiSlice(b248, 180712150, 180713200))
  lines.push('')
}

if (b247) {
  lines.push('## #8 247 clear-cluster around Pi @208859995')
  lines.push(h.asciiSlice(b247, 208859900, 208861200))
  lines.push('')
  // search function no() and ki() near 208850000-208870000
  const win = h.asciiSlice(b247, 208850000, 208870000)
  for (const name of ['function no(', 'function ki(', 'function Pi(', 'function wt(']) {
    lines.push(`## #8 247 win ${name} idx=${win.indexOf(name)}`)
  }
  // dump 247 oauth save function fully
  const fn = h.lastFnStartGeneric(b247, 208857301, 2000)
  lines.push(`## #8 247 save fn ${fn.name} @${fn.i}`)
  if (fn.i > 0) dumpFn('#8 247 save', b247, fn.i, 2500)
}

// ---- #23 ebn callers + MCP list grouping ----
lines.push('# ---- #23 ebn callers ----')
{
  const hits = h.allHits(b248, 'ebn(')
  lines.push(`## ebn( hits=${hits.length}`)
  for (const i of hits.filter((x) => x > 170000000)) {
    dumpWin('#23 ebn-call', b248, i, 80, 160)
  }
}

{
  // 248 MCP list: search claudeAiServers / unusedClaudeAi
  for (const n of [
    'unusedClaudeAi',
    'claudeAiServers',
    'Project MCPs',
    'children:"claude.ai"',
    'bold:!0,children:"claude.ai"',
    'ebn(',
  ]) {
    const a = h.allHits(b248, n)
    const b = b247 ? h.allHits(b247, n).length : 'NA'
    lines.push(`## #23 ${n} 248=${a.length} 247=${b}`)
  }
}

{
  // extract 248 MCP panel function — search "Manage MCP servers" jsx and walk back
  const hits = h.allHits(b248, 'title:"Manage MCP servers"')
  for (const i of hits.filter((x) => x > 200000000)) {
    const fn = h.lastFnStartGeneric(b248, i, 20000)
    lines.push(`## #23 panel lastFn ${fn.name} @${fn.i} title@${i}`)
    if (fn.i > 0) dumpFn('#23 panelFn', b248, fn.i, 20000)
  }
}

{
  // search grouping by ebn in 20k before title
  const hits = h.allHits(b248, 'title:"Manage MCP servers"')
  for (const i of hits.filter((x) => x > 200000000)) {
    const win = h.asciiSlice(b248, i - 20000, i)
    lines.push('## #23 panel-20k needles')
    for (const n of [
      'ebn(',
      'claudeai-proxy',
      'claude.ai',
      'Project MCPs',
      'scope==="claudeai"',
      'unusedClaude',
    ]) {
      lines.push(`- ${n}: ${win.includes(n)} idx=${win.lastIndexOf(n)}`)
    }
    const idx = win.lastIndexOf('claudeai-proxy')
    if (idx >= 0) lines.push(win.slice(Math.max(0, idx - 250), idx + 400))
    const eidx = win.lastIndexOf('ebn(')
    if (eidx >= 0) lines.push('--- ebn ---', win.slice(Math.max(0, eidx - 200), eidx + 300))
    lines.push('')
  }
}

// ---- #25 login_handoff ----
lines.push('# ---- #25 login_handoff ----')
{
  const n = 'login_handoff'
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n) : []
  lines.push(`## login_handoff 248=${a.length} 247=${b.length}`)
  for (const i of a) dumpWin('#25 login_handoff', b248, i, 80, 220)
  for (const i of b) dumpWin('#25 247 login_handoff', b247, i, 80, 220)
}

{
  const hits = h.allHits(b248, 'function pOe(')
  for (const i of hits) dumpFn('#25 pOe', b248, i, 4000)
  const hits2 = h.allHits(b248, 'function nie(')
  for (const i of hits2) dumpFn('#25 nie', b248, i, 1500)
  const hits3 = h.allHits(b248, 'function DKt(')
  for (const i of hits3) dumpFn('#25 DKt', b248, i, 1500)
}

{
  dumpWin('#25 pOe site', b248, 202549862, 200, 800)
}

const out = join(here, 'gold-248-unk-pass3.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
