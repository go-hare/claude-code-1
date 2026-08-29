import { readFileSync } from 'node:fs'

const exe = process.env.TEMP + '\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)
const scrub = s => s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '.')

function hits(needle, max = 15) {
  const nb = Buffer.from(needle)
  const out = []
  let i = 0
  for (;;) {
    const k = buf.indexOf(nb, i)
    if (k === -1) break
    out.push(k)
    i = k + 1
    if (out.length >= max) break
  }
  return out
}

function dump(label, needle, before, after, pred, max = 4) {
  console.log('\n####', label)
  let n = 0
  for (const k of hits(needle, 20)) {
    const w = scrub(buf.subarray(Math.max(0, k - before), k + after).toString('latin1'))
    if (pred && !pred(w)) continue
    n++
    console.log('---', k)
    console.log(w)
    if (n >= max) break
  }
}

dump('i$f or GRi vMi reader', 'vMi(n,{applySplit:QTl()})', 800, 600)
dump('function i$f', 'function i$f', 40, 800)
dump('function GRi', 'function GRi', 40, 800)
dump('function it( tengu', 'function it(', 40, 250, w => w.includes('getFeature') || w.includes('tengu') || w.includes('default'))
dump('it=getFeature', 'it=A(()', 0, 0)
dump('d0m blank', 'function d0m', 40, 400)
dump('udsBlankMessageGate', 'udsBlankMessageGate', 80, 400, w => w.includes('function') || w.includes('=>'))
dump('function er(', 'function er(', 40, 200, w => w.includes('JSON') || w.includes('parse'))
