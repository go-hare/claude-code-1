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

let report = '## counts\n'
for (const c of [
  'function vMi',
  'function yEi',
  'split_slipped_summary_',
  'derive_summary',
  'truncate_summary',
  '_unrepaired_',
  '_detect_only',
  'applySplit',
  'tengu_deep_feather',
  'isSlippedSummarySplitEnabled',
  'malformed closing',
]) {
  report += `${hits(c).length}\t${JSON.stringify(c)}\n`
}

function windowsFor(label, needle, before, after, pred) {
  report += `\n## ${label}\n`
  for (const k of hits(needle)) {
    const w = scrub(buf.subarray(Math.max(0, k - before), k + after).toString('latin1'))
    if (pred && !pred(w)) continue
    report += `--- offset=${k}\n${w}\n\n`
  }
}

windowsFor('function vMi', 'function vMi', 80, 8000, w => w.includes('applySplit') || w.includes('summary') || w.includes('split'))
windowsFor('function yEi', 'function yEi', 80, 8000, w => w.includes('applySplit') || w.includes('summary') || w.includes('split'))
windowsFor('split_slipped_summary_ js', 'split_slipped_summary_', 2000, 2500, w => w.includes('function') || w.includes('shapeClass') || w.includes('summary'))
windowsFor('coerceInput vMi call', 'coerceInput:(e)=>vMi', 200, 800)
windowsFor('coerceInput yEi call', 'coerceInput:(e)=>yEi', 200, 800)

writeFileSync(new URL('./gold-yei-239.txt', import.meta.url), report)
console.log(report.slice(0, 20000))
console.log('\n... written', report.length)
