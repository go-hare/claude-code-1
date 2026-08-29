import { readFileSync, writeFileSync } from 'node:fs'

const exe =
  process.env.TEMP + '\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)
const scrub = s => s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '.')

function hits(needle, max = 30) {
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

let report = '## counts\n'
for (const c of [
  'function U4f',
  'function fp(',
  'var VGr',
  'VGr=',
  'function jo(',
  'openerForm',
  'unrepaired',
  '</summary>',
  'parameter name="message"',
  'antml:parameter',
  'split_slipped_summary_',
  'function QTl',
  'function tQa',
  'tengu_deep_feather',
]) {
  report += `${hits(c).length}\t${JSON.stringify(c)}\n`
}

function windowsFor(label, needle, before, after, pred) {
  report += `\n## ${label}\n`
  let n = 0
  for (const k of hits(needle, 40)) {
    const w = scrub(buf.subarray(Math.max(0, k - before), k + after).toString('latin1'))
    if (pred && !pred(w)) continue
    n++
    report += `--- offset=${k}\n${w}\n\n`
    if (n >= 8) break
  }
}

// U4f is called from vMi at ~310216273. Search function U4f near that area first.
windowsFor('function U4f', 'function U4f', 200, 12000, w =>
  w.includes('openerForm') || w.includes('summary') || w.includes('split') || w.includes('_Mi') || w.includes('unrepaired'))

windowsFor('U4f(e) call site neighborhood', 'i=U4f(e)', 4000, 200)

windowsFor('openerForm assign', 'openerForm:', 3000, 1500, w =>
  w.includes('function') || w.includes('summary') || w.includes('unrepaired') || w.includes('message'))

windowsFor('VGr const near truncate', 'VGr=', 200, 200, w =>
  w.includes('200') || w.includes('summary') || w.includes('Cpr') || /\d{2,4}/.test(w))

windowsFor('QTl / tQa', 'function QTl', 80, 400)
windowsFor('tQa', 'function tQa', 80, 400)

windowsFor('tengu_deep_feather js', 'tengu_deep_feather', 400, 400, w =>
  w.includes('function') || w.includes('GrowthBook') || w.includes('getFeature') || w.includes('default'))

writeFileSync(new URL('./gold-u4f-239.txt', import.meta.url), report)
console.log(report.slice(0, 25000))
console.log('\n... written', report.length)
