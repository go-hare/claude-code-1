/**
 * Peel official 248 sJt / tXe / G$n for leftover eDt wiring.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  asciiSlice,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const lines = ['# gold-248-41-sJt', '']

function dumpFn(label, i, maxLen = 4000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

dumpFn('#41 eDt', 184547975, 400)
dumpFn('#41 Wen', 184548139, 80)
dumpFn('#41 sJt', b248.indexOf(Buffer.from('async function sJt(')), 2500)
dumpAround('#41 sJt-after', b248.indexOf(Buffer.from('async function sJt(')), 0, 2000)
dumpFn('#41 G$n', b248.indexOf(Buffer.from('function G$n(')), 300)
dumpAround('#41 after-sJt', b248.indexOf(Buffer.from('async function sJt(')) + 800, 0, 1500)

writeFileSync(`${outDir}/gold-248-41-sJt.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-41-sJt.txt`)
