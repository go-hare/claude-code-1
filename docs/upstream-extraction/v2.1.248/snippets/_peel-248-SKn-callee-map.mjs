import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-SKn-callee-map', '']

// From SKn body: v, wKn, U, k_, Vjt, Qve, Fte, T, O, P, E, D, _, n, l, k, Ngn, Pc, f, S, W, Pn, Mn, FMe, $ue, A_, Se
const needles = [
  'function wKn(',
  'async function wKn(',
  'function Vjt(',
  'async function Vjt(',
  'function Qve(',
  'function Fte(',
  'async function $pn(',
  'async function _Ke(',
  'function _Ke(',
  'function Ngn(',
  'function Pn(',
  'async function Pn(',
]

for (const n of needles) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 2)) {
    const ext = extractFnAt(buf, i, 3000)
    if (ext.body) {
      lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body.length > 1800 ? ext.body.slice(0, 1800) + '…' : ext.body)
    } else {
      lines.push(`@${i} ${asciiSlice(buf, i, i + 500)}`)
    }
    lines.push('')
  }
}

// Look for seedLogged callees T and O near SKn - search "seedLogged"
const seedHits = allHits(buf, 'seedLogged')
lines.push(`## seedLogged hits=${seedHits.length}`)
for (const i of seedHits.slice(0, 5)) {
  lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 200), i + 300)}`)
  lines.push('')
}

writeFileSync(new URL('./gold-248-SKn-callee-map.txt', import.meta.url), lines.join('\n'))
console.log('wrote gold-248-SKn-callee-map.txt')
