import { appendFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['', '# --- pass2 helpers near T/O/Vjt ---', '']

function peelAt(i, maxLen = 15000) {
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
    lines.push(
      ext.body.length > 4500 ? ext.body.slice(0, 4500) + '…' : ext.body,
    )
  } else {
    lines.push(`@${i} MISS ${asciiSlice(buf, i, i + 300)}`)
  }
  lines.push('')
}

function peelNear(label, needle, lo = 179400000, hi = 179600000, max = 6) {
  const hits = allHits(buf, needle)
  const near = hits.filter(i => i > lo && i < hi)
  lines.push(
    `## ${label} needle=${JSON.stringify(needle)} near=${near.length} total=${hits.length}`,
  )
  for (const i of (near.length ? near : hits).slice(0, max)) peelAt(i)
}

peelNear('function R(', 'function R(')
peelNear('function x(', 'function x(')
peelNear('async function vKn', 'async function vKn(')
peelNear('function vKn', 'function vKn(')
peelNear('function M(e,s)', 'function M(e,s)')
peelNear('function B(e,i,r', 'function B(e,i,r')
peelNear('function A(e,i,s)', 'function A(e,i,s)')
peelNear('function $ue', 'function $ue(')
peelNear('function To', 'function To(')
peelNear('jW={', 'jW={')
peelNear('userSettings(){', 'userSettings(){')
peelNear('function dyn(', 'function dyn(')
peelNear('function dEe(', 'function dEe(')
peelNear('Pc.home', 'Pc.home=')
peelNear('home(t)', 'home(e){')

lines.push('## ascii before T @179529407')
lines.push(asciiSlice(buf, 179529407 - 2800, 179529407 + 220))
lines.push('')

lines.push('## ascii before O @179531012')
lines.push(asciiSlice(buf, 179531012 - 4000, 179531012 + 250))
lines.push('')

lines.push('## ascii around Mn@179296998')
peelAt(179296998)
lines.push('## FMe@179441524')
peelAt(179441524)
lines.push('## A_@179441371 context')
lines.push(asciiSlice(buf, 179441371, 179441371 + 600))
lines.push('')

// Find R used by T: look for "function R(t)" returning array with .read
for (const needle of [
  'function R(t){',
  'function R(e){',
  'function x(e,i,r,s)',
  'function x(t,e,s,i)',
  'async function vKn(t,e)',
  'function vKn(t,e)',
]) {
  peelNear(needle, needle, 179520000, 179540000, 4)
}

appendFileSync(
  new URL('./gold-248-Vjt-T-O-seed.txt', import.meta.url),
  lines.join('\n'),
)
console.log('appended pass2', lines.length)
