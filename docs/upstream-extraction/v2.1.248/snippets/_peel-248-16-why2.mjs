import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-16-why2.txt'
const lines = ['# gold-248-16-why2', '']

function dump(label, i, max = 2500) {
  const ext = extractFnAt(b, i, max)
  lines.push(`## ${label} @${i} len=${ext.len}`)
  lines.push(ext.body ?? ext.preview ?? 'MISS')
  lines.push('')
}

function win(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(b, i - before, i + after))
  lines.push('')
}

win('aF=ir', 189661661, 80, 400)
dump('ir', b.lastIndexOf(Buffer.from('function ir('), 189661661))
win('Mie', b.lastIndexOf(Buffer.from('Mie='), 189661661), 20, 200)
win('Mie2', b.lastIndexOf(Buffer.from('var Mie'), 189661661), 20, 200)

dump('Cf', 182998017)
dump('rP', 182998742)
dump('tst', 184546199)
win('eJt', b.lastIndexOf(Buffer.from('eJt='), 184546199), 10, 200)
dump('iXe', 184556238)
dump('wJt', 184556035)
dump('kJt', 184555569)
dump('TJt', 184556170)
win('vJt', 184556350, 0, 500)
win('consts', 184556640, 80, 80)
win('Tt(', b.lastIndexOf(Buffer.from('function Tt('), 184556749), 0, 120)

win('fleet-import-KC', 192112900, 0, 400)
win('Wo-import', 192124700, 200, 80)

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out)
