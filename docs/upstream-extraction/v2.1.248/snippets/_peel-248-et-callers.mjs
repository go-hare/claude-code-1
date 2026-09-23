/**
 * Peel official Et( call sites (cleanup.register) near fe @178613195.
 * Output: gold-248-et-callers.txt
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  asciiSlice,
  allHits,
  loadSea,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const lines = []
const when = new Date().toISOString()
lines.push(`when=${when}`)
lines.push('')

const etDef = allHits(b, 'function Et(e){return L().cleanup.register(e)}')
lines.push(`## Et def hits=${etDef.length} @${etDef.join(',')}`)
const wBody = asciiSlice(b, 178612748, 178613195 + 200)
lines.push('## W+fe gold snippet')
lines.push(wBody.slice(0, 900))
lines.push('')

// Official mEe / DYe / tde usage needles
for (const [label, needle] of [
  ['mEe()', 'mEe()'],
  ['qt(mEe()', 'qt(mEe()'],
  ['DYe()', 'DYe()'],
  ['!DYe()', '!DYe()'],
  ['tde', 'tde'],
  ['cleanup.drainStarted', 'cleanup.drainStarted'],
]) {
  const hits = allHits(b, needle)
  lines.push(`## ${label} needle="${needle}" hits=${hits.length}`)
  for (const h of hits.slice(0, 12)) {
    lines.push(`- @${h} ${asciiSlice(b, h - 80, h + 160).replace(/\s+/g, ' ')}`)
  }
  lines.push('')
}

// Candidate Et( call patterns — filter false positives (other Et functions)
const callNeedles = [
  'Et(()=>',
  'Et(async ',
  'Et(async()',
  'Et(()=>{',
  'Et(e=>',
  'Et(t=>',
  'Et(i=>',
  'Et(n=>',
  'Et(r=>',
  'Et(o=>',
  'Et(a=>',
  'Et(s=>',
  'Et(u=>',
  'Et(c=>',
  'Et(l=>',
  'Et(h=>',
  'Et(d=>',
  'Et(f=>',
  'Et(p=>',
  'Et(m=>',
  'Et(g=>',
  'Et(v=>',
  'Et(b=>',
  'Et(y=>',
  'Et(w=>',
  'Et(x=>',
  'Et(k=>',
  'Et(_=>',
  'Et($=>',
  'Et(this.',
  'Et(S=>',
]

const seen = new Set()
const samples = []

for (const needle of callNeedles) {
  for (const h of allHits(b, needle)) {
    if (seen.has(h)) continue
    seen.add(h)
    // Skip the Et definition itself
    if (h >= 178613300 && h <= 178613400) continue
    // Skip if this is `function Et(` / `async function Et(`
    const before = asciiSlice(b, h - 20, h)
    if (/function\s*$/.test(before) || /async\s+function\s*$/.test(before)) {
      continue
    }
    // Heuristic: real Et register calls sit in app chunks near host/session
    // Prefer sites that look like registerCleanup: Et(()=>this.flush()), Et(async ()=>{...
    const win = asciiSlice(b, h - 120, h + 220)
    const parent = lastFnStartGeneric(b, h, 8000)
    samples.push({
      h,
      needle,
      parent: parent.name || '?',
      parentI: parent.i,
      win: win.replace(/\n/g, ' '),
    })
  }
}

samples.sort((a, c) => a.h - c.h)
lines.push(`## Et( candidate call sites filtered=${samples.length}`)
lines.push('')

// Group by parent fn for readability; dump first ~40 unique parents + high-signal
const byParent = new Map()
for (const s of samples) {
  const k = s.parent || '?'
  if (!byParent.has(k)) byParent.set(k, [])
  byParent.get(k).push(s)
}

lines.push(`## unique parent fns=${byParent.size}`)
for (const [name, arr] of [...byParent.entries()].sort(
  (a, c) => a[1][0].h - c[1][0].h,
)) {
  lines.push(`### parent=${name} count=${arr.length} first@${arr[0].h}`)
  for (const s of arr.slice(0, 3)) {
    lines.push(`- @${s.h} needle=${s.needle}`)
    lines.push(`  ${s.win.slice(0, 280)}`)
  }
  lines.push('')
}

// High-signal known patterns
lines.push('## high-signal needles')
for (const [label, needle] of [
  ['Qbt Et flush', 'Et(()=>this.flush())'],
  ['Et dispose-style', 'Et({[Symbol.dispose]'],
  ['Et asyncDispose', 'Et({[Symbol.asyncDispose]'],
  ['DYe gate', 'if(DYe())'],
  ['!DYe gate', 'if(!DYe())'],
  ['mEe race', 'qt(mEe(),tde'],
  ['await mEe', 'await mEe()'],
]) {
  const hits = allHits(b, needle)
  lines.push(`### ${label} "${needle}" hits=${hits.length}`)
  for (const h of hits.slice(0, 8)) {
    lines.push(`- @${h} ${asciiSlice(b, h - 100, h + 180).replace(/\s+/g, ' ')}`)
  }
  lines.push('')
}

const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-et-callers.txt'
writeFileSync(out, lines.join('\n'), 'utf8')
console.log('wrote', out, 'lines', lines.length, 'samples', samples.length)
