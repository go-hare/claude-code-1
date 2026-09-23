/**
 * densable 2.1.248 #8 oauth-refresh-tool-cache — prove Ip mapping.
 * Invent-ban. No checklist/board edit.
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
lines.push('# gold-248-unk-8')
lines.push(`# when=${new Date().toISOString()}`)
lines.push(`# sea248=${h.EXE_248} bytes=${b248.length}`)
lines.push(`# sea247=${b247 ? h.EXE_247 + ' bytes=' + b247.length : 'ABSENT'}`)
lines.push('')

function dumpWin(tag, buf, i, before = 80, after = 400) {
  if (i == null || i < 0) {
    lines.push(`## ${tag} MISS`)
    lines.push('')
    return
  }
  lines.push(`## ${tag} @${i}`)
  lines.push(h.asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(tag, buf, i, maxLen = 8000) {
  if (i == null || i < 0) {
    lines.push(`## ${tag} MISS`)
    lines.push('')
    return null
  }
  const ex = h.extractFnAt(buf, i, maxLen)
  if (!ex.body) {
    lines.push(`## ${tag} FAIL @${i} ${JSON.stringify(ex).slice(0, 220)}`)
    lines.push('')
    return ex
  }
  const other =
    buf === b248 && b247
      ? h.allHits(b247, ex.body).length
      : buf === b247 && b248
        ? h.allHits(b248, ex.body).length
        : 'NA'
  lines.push(
    `## ${tag} @${i} len=${ex.len} sha=${ex.sha} otherHits=${other}`,
  )
  lines.push(ex.body)
  lines.push('')
  return ex
}

function hitsAfter(buf, needle, min = 170000000) {
  return h.allHits(buf, needle).filter((i) => i > min)
}

function nearestFn(buf, name, around, maxDist = 8000) {
  const needles = [
    `function ${name}(`,
    `function ${name}()`,
    `async function ${name}(`,
    `async function ${name}()`,
  ]
  let best = -1
  let bestDist = Infinity
  for (const n of needles) {
    for (const i of h.allHits(buf, n)) {
      const d = Math.abs(i - around)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
  }
  return { i: best, dist: best === -1 ? -1 : bestDist }
}

// ---- G2t / yx oauth save ----
lines.push('# ---- G2t / 247 yx ----')
{
  const i = 180708774
  dumpFn('#8 G2t', b248, i, 2500)
  dumpWin('#8 G2t-after-save', b248, 180709316, 0, 220)
}
if (b247) {
  dumpFn('#8 247 yx', b247, 208856754, 2500)
  dumpWin('#8 247 yx-after-save', b247, 208857301, 0, 220)
}

// ---- 248 cluster around Ip ----
lines.push('# ---- 248 cluster lY Ip ON Hk Vmn ----')
for (const [name, off] of [
  ['lY', 180712164],
  ['Ip', 180712775],
  ['ON', 180712818],
  ['Hk', 180712847],
  ['Vmn', 180712878],
]) {
  dumpFn(`#8 ${name}`, b248, off, 2500)
}

// Find Vmn start if offset guess is off
{
  const hits = hitsAfter(b248, 'function Vmn(')
  lines.push(`## #8 function Vmn( hits=${hits.length} ${hits.slice(0, 6)}`)
  for (const i of hits.slice(0, 3)) dumpFn('#8 Vmn-hit', b248, i, 2500)
}

// ---- Ip callees near cluster ----
lines.push('# ---- Ip callees jN s_ IW o_ mE ----')
const cluster = 180712775
for (const name of ['jN', 's_', 'IW', 'o_', 'mE', 'D', '_Y']) {
  const n = nearestFn(b248, name, cluster, 20000)
  lines.push(`## #8 nearest ${name} @${n.i} dist=${n.dist}`)
  if (n.i > 0 && n.dist < 50000) dumpFn(`#8 ${name}`, b248, n.i, 2500)
}

// Also dump every nearby function *() with no args around cluster
{
  const winStart = 180711800
  const win = h.asciiSlice(b248, winStart, winStart + 2500)
  lines.push('## #8 cluster ascii 2500 @180711800')
  lines.push(win)
  lines.push('')
}

// ---- Ip() call sites ----
lines.push('# ---- Ip() call sites ----')
{
  const hits = hitsAfter(b248, 'Ip()')
  lines.push(`## #8 Ip() hits=${hits.length} ${hits.slice(0, 20)}`)
  for (const i of hits.slice(0, 16)) {
    dumpWin('#8 Ip()-call', b248, i, 80, 80)
    const fn = h.lastFnStartGeneric(b248, i, 2000)
    lines.push(`## #8 Ip() caller ${fn.name} @${fn.i}`)
  }
}

// ---- 247 oauth cluster ----
if (b247) {
  lines.push('# ---- 247 cluster Pi no ki Sm Tx wt o$ ----')
  dumpFn('#8 247 Pi-oauth', b247, 208859995, 400)
  for (const name of ['no', 'ki', 'Sm', 'Tx', 'wt', 'o$', 'va', 'F']) {
    const n = nearestFn(b247, name, 208859995, 20000)
    lines.push(`## #8 247 nearest ${name} @${n.i} dist=${n.dist}`)
    if (n.i > 0 && n.dist < 40000) dumpFn(`#8 247 ${name}`, b247, n.i, 2500)
  }
  const win247 = h.asciiSlice(b247, 208859900, 208859900 + 2200)
  lines.push('## #8 247 cluster ascii @208859900')
  lines.push(win247)
  lines.push('')
}

// ---- compare Ip body vs 247 ----
lines.push('# ---- Ip vs 247 bodies ----')
{
  const ip = h.extractFnAt(b248, 180712775, 500)
  lines.push(`## #8 Ip body sha=${ip.sha} 247exact=${b247 ? h.allHits(b247, ip.body || '').length : 'NA'}`)
  if (b247 && ip.body) {
    const folded = 'if(jN(),!s_())IW();else o_()'
    const a = h.allHits(b247, folded).length
    const b = h.allHits(b248, folded).length
    lines.push(`## #8 folded-needle ${JSON.stringify(folded)} 248=${b} 247=${a}`)
  }
}

// ---- leftover-looking needles in SEA ----
lines.push('# ---- leftover-looking needles ----')
for (const n of [
  'clearToolSchemaCache',
  'TOOL_SCHEMA_CACHE',
  'clearBetasCaches',
  'invalidateAll',
  'getClaudeAIOAuthTokens.cache',
  '.cache?.clear?.()',
  'cache?.clear?.()',
]) {
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n).length : 'NA'
  lines.push(`## #8 needle ${JSON.stringify(n)} 248=${a.length} 247=${b}`)
  for (const i of a.filter((x) => x > 180700000 && x < 180720000)) {
    dumpWin(`#8 ${n} near-oauth`, b248, i, 60, 160)
  }
}

// ---- .cache?.clear near Vmn ----
{
  const hits = hitsAfter(b248, 'cache?.clear?.()')
  lines.push(`## #8 cache?.clear?.() late hits=${hits.length} ${hits.slice(0, 12)}`)
  for (const i of hits.filter((x) => x > 180700000 && x < 180720000)) {
    dumpWin('#8 cache-clear near oauth', b248, i, 80, 200)
    const fn = h.lastFnStartGeneric(b248, i, 800)
    if (fn.i > 0) dumpFn(`#8 cache-clear-fn ${fn.name}`, b248, fn.i, 2000)
  }
}

// ---- toolsHash 248 vs 247 ----
lines.push('# ---- toolsHash ----')
{
  const a = h.allHits(b248, 'toolsHash')
  const b = b247 ? h.allHits(b247, 'toolsHash') : []
  lines.push(`## #8 toolsHash 248=${a.length} 247=${b.length}`)
}

const out = join(here, 'gold-248-unk-8.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
