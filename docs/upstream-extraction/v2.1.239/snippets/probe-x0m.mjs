import { readFileSync } from 'node:fs'

const exe = process.env.TEMP + '\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)
const scrub = s => s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '.')

function hits(needle, max = 20) {
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

function dump(label, needle, before, after, max = 5) {
  console.log('\n####', label, 'count=', hits(needle).length)
  let n = 0
  for (const k of hits(needle, 20)) {
    n++
    console.log('---', k)
    console.log(scrub(buf.subarray(Math.max(0, k - before), k + after).toString('latin1')))
    if (n >= max) break
  }
}

dump('function GTl', 'function GTl', 40, 500)
dump('C0m(', 'C0m(', 80, 200)
dump('blankCallCausedByHandler', 'blankCallCausedByHandler', 80, 300)
dump('udsBlankMessageGate impl', 'function GTl', 20, 800)
dump('_ve(e,t)', 'function _ve(', 40, 200)
dump('getFeatureValue_CACHED', 'getFeatureValue_CACHED_MAY_BE_STALE', 40, 80)
