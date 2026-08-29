import { readFileSync, writeFileSync } from 'node:fs'

const exe =
  process.env.TEMP + '\\official-239\\package\\claude.exe'
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

let report = ''

function windowsFor(label, needle, before, after, pred, max = 6) {
  report += `\n## ${label}\n`
  let n = 0
  for (const k of hits(needle, 40)) {
    const w = scrub(buf.subarray(Math.max(0, k - before), k + after).toString('latin1'))
    if (pred && !pred(w)) continue
    n++
    report += `--- offset=${k}\n${w}\n\n`
    if (n >= max) break
  }
}

windowsFor('function jo near record', 'function jo(', 40, 400, w =>
  w.includes('typeof') || w.includes('object') || w.includes('null'))

windowsFor('function fp(', 'function fp(', 40, 800, w =>
  w.includes('trim') || w.includes('indexOf') || w.includes('slice') || w.includes('summary'))

windowsFor('isSlippedSummarySplitEnabled js', 'isSlippedSummarySplitEnabled', 80, 400)

windowsFor('applySplit:QTl', 'applySplit:QTl()', 200, 400)
windowsFor('applySplit:tQa', 'applySplit:tQa()', 200, 400)

windowsFor('function So( truncate', 'function So(', 40, 400, w =>
  w.includes('charCode') || w.includes('d800') || w.includes('slice') || w.includes('surrogate'))

writeFileSync(new URL('./gold-jo-fp-239.txt', import.meta.url), report)
console.log(report.slice(0, 18000))
