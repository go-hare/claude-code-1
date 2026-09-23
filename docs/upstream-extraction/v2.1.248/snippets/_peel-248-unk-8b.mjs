/**
 * densable 2.1.248 #8 pass B — resolve Ip callees + 247 no/ki bodies.
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
lines.push('# gold-248-unk-8b')
lines.push(`# when=${new Date().toISOString()}`)
lines.push('')

function dumpFn(tag, buf, i, maxLen = 4000) {
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

function dumpWin(tag, buf, i, before = 80, after = 200) {
  if (i == null || i < 0) {
    lines.push(`## ${tag} MISS`)
    lines.push('')
    return
  }
  lines.push(`## ${tag} @${i}`)
  lines.push(h.asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function allNamed(buf, name) {
  const needles = [
    `function ${name}()`,
    `function ${name}(`,
    `async function ${name}()`,
    `async function ${name}(`,
  ]
  const out = []
  for (const n of needles) {
    for (const i of h.allHits(buf, n)) out.push({ n, i })
  }
  out.sort((a, b) => a.i - b.i)
  return out
}

// Exact no-arg defs first
lines.push('# ---- exact no-arg defs 248 ----')
for (const name of ['jN', 's_', 'IW', 'o_', 'mE', '_Y', 'lMe', 'J2t']) {
  const hits = h.allHits(b248, `function ${name}()`)
  lines.push(`## function ${name}() hits=${hits.length} ${hits.slice(0, 8)}`)
  for (const i of hits.filter((x) => x > 170000000).slice(0, 6)) {
    dumpFn(`#8 ${name}()`, b248, i, 2000)
  }
}

// s_() may take no args but be `function s_(){`
{
  const hits = h.allHits(b248, 'function s_(){')
  lines.push(`## function s_(){ hits=${hits.length} ${hits.slice(0, 8)}`)
  for (const i of hits.slice(0, 6)) dumpFn('#8 s_(){', b248, i, 1500)
}

// Also `function s_(` with 0 params via extract
{
  const hits = h.allHits(b248, 'function s_(')
  lines.push(`## function s_( hits=${hits.length} ${hits.slice(0, 10)}`)
  for (const i of hits.filter((x) => x > 170000000).slice(0, 8)) {
    dumpFn('#8 s_(', b248, i, 1500)
  }
}

// jN / IW / o_ with any arity near oauth cluster 18071xxxx
lines.push('# ---- nearby any-arity ----')
for (const name of ['jN', 'IW', 'o_', 'mE', '_Y', 's_']) {
  const hits = h.allHits(b248, `function ${name}(`).filter((i) => i > 179000000 && i < 182000000)
  lines.push(`## ${name} in 179-182M hits=${hits.length} ${hits}`)
  for (const i of hits.slice(0, 6)) dumpFn(`#8 near ${name}`, b248, i, 2000)
}

// Search `jN()` call sites to find definition via lastFn
lines.push('# ---- jN() call sites ----')
{
  const hits = h.allHits(b248, 'jN()').filter((i) => i > 170000000)
  lines.push(`## jN() late=${hits.length} ${hits.slice(0, 20)}`)
  for (const i of hits.slice(0, 12)) {
    dumpWin('#8 jN()', b248, i, 60, 80)
  }
}

lines.push('# ---- IW() / o_() call sites ----')
for (const n of ['IW()', 'o_()', 'mE()', '_Y()']) {
  const hits = h.allHits(b248, n).filter((i) => i > 170000000)
  lines.push(`## ${n} late=${hits.length} ${hits.slice(0, 16)}`)
  for (const i of hits.filter((x) => x > 180700000 && x < 180730000)) {
    dumpWin(`#8 ${n}`, b248, i, 40, 60)
  }
}

// 247 no() / ki() exact
if (b247) {
  lines.push('# ---- 247 no() ki() Sm() ----')
  for (const name of ['no', 'ki', 'Sm', 'va']) {
    const hits = h.allHits(b247, `function ${name}()`)
    lines.push(`## 247 function ${name}() hits=${hits.length} ${hits.slice(0, 10)}`)
    for (const i of hits.filter((x) => x > 206000000 && x < 210000000).slice(0, 6)) {
      dumpFn(`#8 247 ${name}()`, b247, i, 1500)
    }
  }
  // no() calls in oauth cluster
  {
    const hits = h.allHits(b247, 'no()').filter((i) => i > 208850000 && i < 208870000)
    lines.push(`## 247 no() in oauth-win=${hits.length} ${hits}`)
    for (const i of hits) dumpWin('#8 247 no()-win', b247, i, 80, 80)
  }
  {
    const hits = h.allHits(b247, 'ki()').filter((i) => i > 208850000 && i < 208870000)
    lines.push(`## 247 ki() in oauth-win=${hits.length} ${hits}`)
    for (const i of hits) dumpWin('#8 247 ki()-win', b247, i, 80, 80)
  }
  // dump 2k before Tx to catch no/ki/Sm defs if they're above
  dumpWin('#8 247 before-Tx', b247, 208860602, 2500, 80)
}

// Search invalidateAll near oauth
lines.push('# ---- invalidateAll near oauth 248 ----')
{
  const hits = h.allHits(b248, 'invalidateAll')
  lines.push(`## invalidateAll 248=${hits.length}`)
  for (const i of hits.filter((x) => x > 180500000 && x < 181000000)) {
    dumpWin('#8 invAll', b248, i, 80, 160)
    const fn = h.lastFnStartGeneric(b248, i, 400)
    if (fn.i > 0) dumpFn(`#8 invAll-fn ${fn.name}`, b248, fn.i, 800)
  }
}

if (b247) {
  const hits = h.allHits(b247, 'invalidateAll')
  lines.push(`## invalidateAll 247=${hits.length}`)
  for (const i of hits.filter((x) => x > 208800000 && x < 208900000)) {
    dumpWin('#8 247 invAll', b247, i, 80, 160)
    const fn = h.lastFnStartGeneric(b247, i, 400)
    if (fn.i > 0) dumpFn(`#8 247 invAll-fn ${fn.name}`, b247, fn.i, 800)
  }
}

// leftover mapping: search tool schema Map.clear patterns
lines.push('# ---- Map.clear / schema cache patterns ----')
for (const n of [
  'TOOL_SCHEMA',
  'toolSchemas',
  'schemaCache',
  '.clear()',
  'new Map',
]) {
  const a = h.allHits(b248, n).length
  const b = b247 ? h.allHits(b247, n).length : 'NA'
  lines.push(`## needle ${JSON.stringify(n)} 248=${a} 247=${b}`)
}

const out = join(here, 'gold-248-unk-8b.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
