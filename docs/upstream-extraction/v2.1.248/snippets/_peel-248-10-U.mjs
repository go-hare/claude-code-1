import { writeFileSync } from 'fs'
import {
  EXE_248,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const i4t = buf.indexOf(Buffer.from('function i4t(e,n){return U(e,n)}'))
const lines = ['# gold-248-na-10-U', `i4t@${i4t}`, '']
lines.push(asciiSlice(buf, i4t - 800, i4t + 200))
lines.push('')

// last function U before i4t
const u = buf.lastIndexOf(Buffer.from('function U('), i4t)
lines.push(`## last function U( before i4t @${u}`)
const ext = extractFnAt(buf, u, 4000)
if (ext.body) {
  lines.push(`len=${ext.len} sha=${ext.sha}`)
  lines.push(ext.body)
} else lines.push(JSON.stringify(ext))
lines.push('')

const uWin = lastFnStartGeneric(buf, i4t, 2500)
lines.push(`## lastFnGeneric name=${uWin.name} @${uWin.i}`)
if (uWin.i >= 0) {
  const e2 = extractFnAt(buf, uWin.i, 4000)
  if (e2.body) {
    lines.push(`len=${e2.len} sha=${e2.sha}`)
    lines.push(e2.body)
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-na-10-U.txt',
  lines.join('\n'),
)
console.log('WROTE U', u, uWin)
