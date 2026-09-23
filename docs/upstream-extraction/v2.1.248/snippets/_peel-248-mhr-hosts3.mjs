import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  extractFnAt,
  lastFnStart,
  lastFnStartGeneric,
  allHits,
} from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const out = [`when=${new Date().toISOString()}`]

function dumpHits(label, needle, max = 6) {
  const hits = allHits(b, needle)
  out.push(`\n## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    out.push(`- @${h} ${asciiSlice(b, h - 60, h + 280).replace(/\n/g, ' ')}`)
  }
}

function dumpFnNear(label, names, near) {
  const hits = allHits(b, near)
  out.push(`\n## fn ${label} near ${JSON.stringify(near)} hits=${hits.length}`)
  for (const h of hits.slice(0, 3)) {
    const start = lastFnStart(b, h, names)
    const generic = lastFnStartGeneric(b, h, 8000)
    const i = start.i > 0 ? start.i : generic.i
    out.push(`- hit @${h} start=${start.name || generic.name}@${i}`)
    if (i < 0) continue
    const ext = extractFnAt(b, i, 12000)
    if (ext.body) {
      out.push(`len=${ext.len} sha=${ext.sha}`)
      out.push(ext.body)
    } else out.push(asciiSlice(b, i, i + 800))
  }
}

dumpHits('dtt object', 'var dtt={')
dumpHits('Yet(', 'function Yet(')
dumpHits('Yet();', 'Yet()')
dumpHits('function WL(', 'function WL(')
dumpHits('var Wu=', 'var Wu=')
dumpHits('Wu,', 'model:Wu')
dumpHits('proactivityLevel', 'proactivityLevel:')
dumpHits('sessionEffort', 'sessionEffort:')

out.push('\n## dtt-window @189561724')
out.push(asciiSlice(b, 189561700, 189562200))

out.push('\n## _G-Yet window')
const yetHits = allHits(b, 'Object.assign(s,Yet())')
for (const h of yetHits.slice(0, 2)) {
  out.push(`@${h} ${asciiSlice(b, h - 40, h + 80)}`)
}

dumpFnNear('Yet', ['function Yet('], 'Object.assign(s,Yet())')
dumpFnNear('WL', ['function WL('], 'WL(r.message,e,{as:"clause"})')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-mhr-hosts3.txt',
  out.join('\n'),
)
console.log('wrote', out.length)
