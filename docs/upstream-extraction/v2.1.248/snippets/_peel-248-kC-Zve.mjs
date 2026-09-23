import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  extractFnAt,
  allHits,
} from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const lines = [
  '# gold-248-kC-Zve',
  '',
  'Official densable 2.1.248 SEA peels for kC / Zve legacy local settings path.',
  'Leftover names only in map section.',
  '',
]

function peel(needle, maxLen = 4000) {
  const hits = allHits(b, needle)
  lines.push(`## ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const i of hits.slice(0, 12)) {
    const ex = extractFnAt(b, i, maxLen)
    if (ex.body) {
      lines.push(`@${i} sha=${ex.sha} len=${ex.len}`)
      lines.push(ex.body)
      lines.push('')
    } else {
      lines.push(`@${i} CONTEXT:`)
      lines.push(asciiSlice(b, i - 80, i + 400))
      lines.push('')
    }
  }
}

peel('function kC(')
peel('function Zve(')
peel('function QB(')
peel('function xC(')

const zve = 179445024
lines.push('## context around Zve @179445024 (±1200)')
lines.push(asciiSlice(b, zve - 1200, zve + 500))
lines.push('')

for (const needle of [
  'function A(e){',
  'function A(t){',
  'function _(e,t){',
  'function _(t,e){',
  'function H(){',
  'function vY(',
  'function CXn(',
  'function cyn(',
]) {
  const hits = allHits(b, needle).filter(i => Math.abs(i - zve) < 300000)
  lines.push(`## near-Zve ${JSON.stringify(needle)} count_near=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    const ex = extractFnAt(b, i, 2000)
    if (ex.body) {
      lines.push(`@${i} sha=${ex.sha} len=${ex.len}`)
      lines.push(ex.body)
      lines.push('')
    }
  }
}

peel(
  'function R(t){let e=[];for(let s of["projectSettings","localSettings"]',
  800,
)

lines.push('## kC() call-site windows')
for (const i of allHits(b, 'kC()').slice(0, 20)) {
  lines.push(`@${i}`)
  lines.push(asciiSlice(b, i - 160, i + 320))
  lines.push('')
}

lines.push('## Zve( call-site windows')
for (const i of allHits(b, 'Zve(').slice(0, 20)) {
  lines.push(`@${i}`)
  lines.push(asciiSlice(b, i - 120, i + 240))
  lines.push('')
}

// Also peel rule-removal kC caller body more fully
const ruleHit = allHits(b, 'if(e.source==="localSettings"){let g=kC()')
lines.push('## localSettings rule-removal caller')
for (const i of ruleHit) {
  lines.push(`@${i}`)
  lines.push(asciiSlice(b, i - 200, i + 600))
  lines.push('')
}

const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-kC-Zve.txt'
writeFileSync(out, lines.join('\n'))
console.log('wrote', out, 'lines=', lines.length)
