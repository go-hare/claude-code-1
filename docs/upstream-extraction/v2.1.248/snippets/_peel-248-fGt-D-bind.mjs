/**
 * Resolve which D() binds into fGt / settings-load primer chunk.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-fGt-D-bind.txt'
const lines = ['# gold-248-fGt-D-bind', '']
const fGt = 178505059

const lookStart = fGt - 250000
const look = asciiSlice(buf, lookStart, fGt)

// chunk markers
for (const m of ['// @bun', '//@bun']) {
  const found = []
  let pos = 0
  while ((pos = look.indexOf(m, pos)) >= 0) {
    found.push(lookStart + pos)
    pos += m.length
  }
  lines.push(`## marker ${m} count=${found.length} last=${found.slice(-5).join(',')}`)
}

// imports containing bare D
{
  const re = /import\{([^}]{0,500})\}from"[^"]+"/g
  let m
  const hits = []
  while ((m = re.exec(look))) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0])
    const aliased = m[1].split(',').map(s => s.trim())
    if (
      names.includes('D') ||
      aliased.some(a => a === 'D' || a.endsWith(' as D'))
    ) {
      hits.push({ abs: lookStart + m.index, text: m[0].slice(0, 240) })
    }
  }
  lines.push(`## imports binding D before fGt count=${hits.length}`)
  for (const h of hits.slice(-30)) lines.push(`@${h.abs} ${h.text}`)
  lines.push('')
}

// SKn primer
lines.push('## class SKn')
for (const i of allHits(buf, 'class SKn{').slice(0, 3)) {
  lines.push(`@${i}`)
  lines.push(asciiSlice(buf, i, i + 600))
  lines.push('')
}

lines.push('## e.primer=new SKn')
for (const i of allHits(buf, 'e.primer=new SKn')) {
  lines.push(`@${i}`)
  lines.push(asciiSlice(buf, i - 300, i + 350))
  lines.push('')
}

// D in settings-load band with primer
const loadBand = [179480000, 179560000]
lines.push('## D defs/imports in settings-load band')
for (const n of [
  'function D(){',
  'function D(',
  'import{D}',
  'import{D,',
  ',D}',
  ',D,',
  '{D as ',
  ' as D}',
  ' as D,',
]) {
  const hits = allHits(buf, n).filter(
    i => i >= loadBand[0] && i < loadBand[1],
  )
  lines.push(`${JSON.stringify(n)} → ${hits.join(',') || 'NONE'}`)
}

// For D() calls in load band, look back for import
lines.push('')
lines.push('## D() call lookback imports in load band')
for (const i of allHits(buf, 'if(!D())return').filter(
  i => i >= loadBand[0] && i < loadBand[1],
)) {
  const win = asciiSlice(buf, i - 80000, i)
  const patterns = ['import{D}', 'import{D,', ',D}', '{D,', ' as D}', ' as D,']
  lines.push(`### call @${i}`)
  for (const p of patterns) {
    const idx = win.lastIndexOf(p)
    if (idx >= 0) {
      const abs = i - 80000 + idx
      lines.push(`${p} @${abs} …${win.slice(Math.max(0, idx - 30), idx + 100)}`)
    }
  }
  // also last function D
  let idx = win.lastIndexOf('function D(){')
  if (idx >= 0) {
    const abs = i - 80000 + idx
    lines.push(`function D(){ @${abs}`)
    lines.push(JSON.stringify(extractFnAt(buf, abs, 500)))
  }
}

// Check whether fGt chunk and load chunk share — find //@bun between them
{
  const between = asciiSlice(buf, fGt, loadBand[0])
  let count = 0
  let pos = 0
  const offs = []
  while ((pos = between.indexOf('// @bun', pos)) >= 0) {
    count++
    offs.push(fGt + pos)
    pos += 7
  }
  lines.push('')
  lines.push(
    `## // @bun between fGt and loadBand count=${count} first=${offs.slice(0, 5).join(',')} last=${offs.slice(-3).join(',')}`,
  )
}

// Peel the pin-style D @178167129 with more context
lines.push('')
lines.push('## pin-style D @178167129 context')
lines.push(asciiSlice(buf, 178166900, 178167400))

// Search: export{D,rtr} importers via chunk path near that export
lines.push('')
lines.push('## who might be settings D — scan tiny return-bool D near load')
{
  const hits = allHits(buf, 'function D(){return')
  for (const i of hits) {
    if (i < 179400000 || i > 179600000) continue
    lines.push(`@${i} ${asciiSlice(buf, i, i + 120)}`)
  }
}

// Maybe D is feature('...') wrapper renamed — search feature( near load D calls
lines.push('')
lines.push('## feature( near first load D call')
{
  const call = allHits(buf, 'if(!D())return').find(
    i => i >= loadBand[0] && i < loadBand[1],
  )
  if (call) {
    lines.push(asciiSlice(buf, call - 5000, call - 4800))
    // search for "function D" variants with feature
    const win = asciiSlice(buf, call - 100000, call)
    const re = /function ([A-Za-z_$][\w$]*)\(\)\{[^}]{0,60}feature\([^)]+\)[^}]{0,40}\}/g
    let m
    while ((m = re.exec(win))) {
      lines.push(`@${call - 100000 + m.index} ${m[0]}`)
    }
  }
}

writeFileSync(out, lines.join('\n'))
console.log('wrote', out)
