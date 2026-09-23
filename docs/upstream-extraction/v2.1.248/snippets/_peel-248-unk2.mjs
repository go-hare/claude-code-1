/**
 * densable 2.1.248 UNKNOWN pass2 — resolve #8 cache-clear trio, #23 ebn,
 * #9 k5n vs 247 S3t, leftover MCP heading, TrustDialog rule list.
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
lines.push(`# gold-248-unk-pass2`)
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

function dumpFn(tag, buf, i, maxLen = 4000) {
  const ex = h.extractFnAt(buf, i, maxLen)
  if (!ex.body) {
    lines.push(`## ${tag} EXTRACT FAIL @${i} ${JSON.stringify(ex).slice(0, 180)}`)
    lines.push('')
    return ex
  }
  const hitsOther =
    buf === b248 && b247
      ? h.allHits(b247, ex.body).length
      : buf === b247
        ? h.allHits(b248, ex.body).length
        : 'NA'
  lines.push(
    `## ${tag} @${i} len=${ex.len} sha=${ex.sha} otherHits=${hitsOther}`,
  )
  lines.push(ex.body)
  lines.push('')
  return ex
}

function findFnDef(buf, name) {
  const needles = [`function ${name}(`, `function ${name}({`, `async function ${name}(`]
  for (const n of needles) {
    const hits = h.allHits(buf, n)
    const code = hits.filter((i) => i > 170000000)
    if (code.length) return { name, i: code[0], hits: code }
  }
  return { name, i: -1, hits: [] }
}

// ---- #8 resolve lY / Ip / and 247 Pi / no / ki ----
lines.push('# ---- #8 oauth-save clears ----')
dumpWin('#8 G2t after save', b248, 180709316, 0, 350)
dumpWin('#8 247 yx after save', b247, 208857301, 0, 400)

// From scan: 248 `if(lY(),Ip(),M!==void 0)`  247 `if(Pi(),no(),ki(),f!==void 0)`
for (const name of ['lY', 'Ip', 'ON', 'Hk', 'Bgt', 'SN']) {
  const f = findFnDef(b248, name)
  lines.push(`## #8 find ${name} @${f.i} n=${f.hits.length}`)
  if (f.i > 0) dumpFn(`#8 ${name}`, b248, f.i, 2500)
}

// Also search `function lY(` anywhere
for (const name of ['lY', 'Ip']) {
  const hits = h.allHits(b248, `function ${name}(`)
  lines.push(`## #8 all function ${name}( hits=${hits.length} ${hits.slice(0, 8)}`)
  for (const i of hits.slice(0, 4)) dumpFn(`#8 ${name}#${i}`, b248, i, 2000)
}

if (b247) {
  for (const name of ['Pi', 'no', 'ki', 'Pi()', 'no()', 'ki()']) {
    const hits = h.allHits(b247, `function ${name}(`)
    lines.push(`## #8 247 function ${name}( hits=${hits.length} ${hits.slice(0, 6)}`)
    for (const i of hits.filter((x) => x > 170000000).slice(0, 3)) {
      dumpFn(`#8 247 ${name}`, b247, i, 2000)
    }
  }
}

// Search nearby comments / strings for cache clear
for (const n of [
  'clearToolSchemaCache',
  'toolSchemaCache',
  'betas cache',
  'clearBetas',
  'getClaudeAIOAuthTokens.cache',
  '.cache?.clear',
  'cache.clear',
  'cache?.clear',
]) {
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n).length : 'NA'
  lines.push(`## #8 needle ${JSON.stringify(n)} 248=${a.length} 247=${b}`)
}

// Dump 80 chars around each `lY()` and `Ip()` near oauth save
{
  const winStart = 180708700
  const win = h.asciiSlice(b248, winStart, winStart + 800)
  lines.push('## #8 G2t ascii 800')
  lines.push(win)
  lines.push('')
}

// Search function assignments: lY= or var lY=
for (const n of ['var lY=', 'lY=function', ',lY=', 'function lY']) {
  const hits = h.allHits(b248, n)
  lines.push(`## #8 assign ${n} hits=${hits.length}`)
  for (const i of hits.filter((x) => x > 170000000).slice(0, 5)) {
    dumpWin(`#8 ${n}`, b248, i, 20, 200)
  }
}
for (const n of ['var Ip=', 'Ip=function', ',Ip=', 'function Ip']) {
  const hits = h.allHits(b248, n)
  lines.push(`## #8 assign ${n} hits=${hits.length}`)
  for (const i of hits.filter((x) => x > 170000000).slice(0, 5)) {
    dumpWin(`#8 ${n}`, b248, i, 20, 200)
  }
}

// 247 Pi/no/ki assignments
if (b247) {
  for (const n of ['function Pi(', 'function no(', 'function ki(', 'var Pi=', 'var no=', 'var ki=']) {
    const hits = h.allHits(b247, n).filter((i) => i > 200000000)
    lines.push(`## #8 247 ${n} late hits=${hits.length} ${hits.slice(0, 5)}`)
    for (const i of hits.slice(0, 2)) dumpFn(`#8 247 ${n}`, b247, i, 2000)
  }
}

// ---- #23 ebn real-connector predicate ----
lines.push('# ---- #23 ebn ----')
{
  const hits = h.allHits(b248, 'function ebn(')
  lines.push(`## #23 function ebn( hits=${hits.length}`)
  for (const i of hits) dumpFn('#23 ebn', b248, i, 1500)
}
{
  const n = 'e.scope==="claudeai"||e.scope==="dynamic"'
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n).length : 'NA'
  lines.push(`## #23 scope claudeai||dynamic 248=${a.length} 247=${b}`)
  for (const i of a) {
    dumpWin('#23 ebn-win', b248, i, 120, 200)
    const fn = h.lastFnStartGeneric(b248, i, 1500)
    if (fn.i > 0) dumpFn(`#23 ebn-fn ${fn.name}`, b248, fn.i, 1500)
  }
}

// MCP list heading "claude.ai" in JSX
{
  const n = 'children:"claude.ai"'
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n).length : 'NA'
  lines.push(`## #23 children:"claude.ai" 248=${a.length} 247=${b}`)
  for (const i of a) dumpWin('#23 heading children', b248, i, 200, 400)
}
{
  const n = 'bold:!0,children:"claude.ai"'
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n).length : 'NA'
  lines.push(`## #23 bold claude.ai 248=${a.length} 247=${b}`)
  for (const i of a) dumpWin('#23 bold heading', b248, i, 300, 500)
}

// Filter used by MCP list: claudeai-proxy AND scope
{
  for (const n of [
    'scope==="claudeai"',
    'scope!=="claudeai"',
    'scope!=="project"',
    'isOfficialClaude',
    'isTrustedClaude',
    'enterpriseManaged',
  ]) {
    const a = h.allHits(b248, n)
    const b = b247 ? h.allHits(b247, n).length : 'NA'
    lines.push(`## #23 ${n} 248=${a.length} 247=${b}`)
  }
}

// Extract MCP list panel function around heading
{
  const hits = h.allHits(b248, 'title:"Manage MCP servers"')
  for (const i of hits.filter((x) => x > 200000000)) {
    dumpWin('#23 panel title', b248, i, 400, 200)
    // look backward for claudeai-proxy filter in same function
    const win = h.asciiSlice(b248, i - 8000, i)
    const idx = win.lastIndexOf('claudeai-proxy')
    lines.push(`## #23 panel-8k last claudeai-proxy rel=${idx}`)
    if (idx >= 0) {
      lines.push(win.slice(Math.max(0, idx - 200), idx + 300))
      lines.push('')
    }
  }
}

if (b247) {
  const hits = h.allHits(b247, 'title:"Manage MCP servers"')
  for (const i of hits.filter((x) => x > 200000000).slice(0, 2)) {
    const win = h.asciiSlice(b247, i - 8000, i)
    const idx = win.lastIndexOf('claudeai-proxy')
    lines.push(`## #23 247 panel-8k last claudeai-proxy @${i} rel=${idx}`)
    if (idx >= 0) {
      lines.push(win.slice(Math.max(0, idx - 200), idx + 300))
      lines.push('')
    }
  }
}

// ---- #9 k5n vs S3t structural compare ----
lines.push('# ---- #9 k5n vs S3t ----')
{
  const i248 = 181122899
  const win = h.asciiSlice(b248, i248, i248 + 9000)
  lines.push('## #9 k5n first 2000')
  lines.push(win.slice(0, 2000))
  lines.push('')
  // find overage sentence position and after
  const g = 'If the session enters usage overage'
  const gi = win.indexOf(g)
  lines.push(`## #9 k5n overage rel=${gi}`)
  lines.push(win.slice(Math.max(0, gi - 100), gi + 500))
  lines.push('')
}
if (b247) {
  const i247 = 212903745
  const win = h.asciiSlice(b247, i247, i247 + 9000)
  lines.push('## #9 247 S3t first 2000')
  lines.push(win.slice(0, 2000))
  lines.push('')
  const g = 'If the session enters usage overage'
  const gi = win.indexOf(g)
  lines.push(`## #9 S3t overage rel=${gi}`)
  lines.push(win.slice(Math.max(0, gi - 100), gi + 500))
  lines.push('')
}

// Who calls k5n / cache guidance?
{
  const hits = h.allHits(b248, 'k5n(')
  lines.push(`## #9 k5n( hits=${hits.length}`)
  for (const i of hits.filter((x) => x > 170000000).slice(0, 8)) {
    dumpWin('#9 k5n-call', b248, i, 80, 160)
  }
}

// Search for resume-stable cache guidance
for (const n of [
  'cache1h',
  'promptCache1h',
  'isUsingOverage)&&',
  'yle().isUsingOverage',
  'isUsingOverage)return',
]) {
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n).length : 'NA'
  lines.push(`## #9 ${n} 248=${a.length} 247=${b}`)
  for (const i of a.filter((x) => x > 170000000).slice(0, 4)) {
    dumpWin(`#9 ${n}`, b248, i, 60, 180)
  }
}

// ---- #14 markdown-escape / code for model in notices ----
lines.push('# ---- #14 wrap model ----')
{
  // cGn is wrap helper used by Dv
  const hits = h.allHits(b248, 'function cGn(')
  lines.push(`## #14 function cGn( hits=${hits.length}`)
  for (const i of hits) dumpFn('#14 cGn', b248, i, 800)
}
{
  // ModelPicker notice around FAST_MODE_MODEL_DISPLAY
  for (const n of [
    'FAST_MODE_MODEL_DISPLAY',
    'available with',
    'Switching to other models',
    'and available with',
  ]) {
    const a = h.allHits(b248, n)
    const b = b247 ? h.allHits(b247, n).length : 'NA'
    lines.push(`## #14 ${n} 248=${a.length} 247=${b}`)
    for (const i of a.filter((x) => x > 190000000).slice(0, 3)) {
      dumpWin(`#14 ${n}`, b248, i, 80, 250)
    }
  }
}

// ---- #28 TrustDialog project allow rules display ----
lines.push('# ---- #28 trust rules ----')
{
  for (const n of [
    'hasProjectAllowRules',
    'projectAllowRules',
    'Allow:',
    'permission rules:',
    'cTe()',
    'uTe()',
  ]) {
    const a = h.allHits(b248, n)
    const b = b247 ? h.allHits(b247, n).length : 'NA'
    lines.push(`## #28 ${n} 248=${a.length} 247=${b}`)
  }
  const hits = h.allHits(b248, 'hasProjectAllowRules')
  for (const i of hits.filter((x) => x > 170000000)) {
    dumpWin('#28 hasProjectAllowRules', b248, i, 80, 300)
  }
}

// Search TrustDialog render for slice of rule strings
{
  const i = 203835504
  const body = h.asciiSlice(b248, i, i + 7000)
  const keys = ['slice(', 'truncate', '…', 'toWellFormed', 'Segmenter', 'grapheme', 'Allow']
  lines.push('## #28 Go body needles')
  for (const k of keys) {
    lines.push(`- ${k}: ${body.includes(k)} idx=${body.indexOf(k)}`)
  }
  // dump around Allow if any
  const ai = body.indexOf('Allow')
  if (ai >= 0) lines.push(body.slice(ai, ai + 250))
  lines.push('')
}

// ---- #25 deferred_no_consent 11 vs 10 ----
lines.push('# ---- #25 consent 248-new hit ----')
{
  const n = 'deferred_no_consent_surface'
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n) : []
  lines.push(`## #25 deferred hits 248=${a.length} 247=${b.length}`)
  for (const i of a.filter((x) => x > 170000000)) {
    dumpWin('#25 deferred248', b248, i, 100, 180)
  }
}

// ---- #31 afterReconnect unique? ----
lines.push('# ---- #31 afterReconnect ----')
{
  const hits = h.allHits(b248, 'function dNe(')
  for (const i of hits) dumpFn('#31 dNe', b248, i, 3000)
  const hits2 = h.allHits(b248, 'function xe(e,t,r,{afterReconnect')
  for (const i of hits2) dumpFn('#31 xe afterReconnect', b248, i, 4000)
}

const out = join(here, 'gold-248-unk-pass2.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
