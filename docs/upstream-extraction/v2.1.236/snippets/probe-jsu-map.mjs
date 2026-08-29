/**
 * Map densable dialog symbols → kind strings; dump Lno/X_w bodies.
 */
import { readFileSync, writeFileSync } from 'fs'

const exe = `${process.env.TEMP}/official-239/package/claude.exe`
const text = readFileSync(exe).toString('latin1')

function around(i, before = 80, after = 400) {
  return text
    .slice(Math.max(0, i - before), i + after)
    .replace(/[^\x20-\x7e]/g, '.')
}

// All Qg({kind:"..."
const specs = [...text.matchAll(/(\w+)=Qg\(\{kind:"([^"]+)"/g)]
console.log('=== Qg specs ===')
for (const m of specs) {
  console.log(`${m[1]} => ${m[2]}`)
}

// Also defineDialogSpec-like
const specs2 = [...text.matchAll(/(\w+)=\{kind:"([^"]+)",payload:/g)]
console.log('=== inline kind specs ===')
for (const m of specs2) {
  if (m[2].includes('permission') || m[2].includes('_') ) {
    console.log(`${m[1]} => ${m[2]}`)
  }
}

const lno = text.indexOf('async function Lno(e)')
console.log('\n=== Lno full ===')
console.log(around(lno, 0, 1200))

const xw = text.indexOf('async function X_w(e)')
console.log('\n=== X_w start ===')
console.log(around(xw, 0, 3500))

// dump to files for reading
writeFileSync(
  'docs/upstream-extraction/v2.1.236/snippets/gold-jsu-kinds.txt',
  specs.map(m => `${m[1]}\t${m[2]}`).join('\n') + '\n',
)
writeFileSync(
  'docs/upstream-extraction/v2.1.236/snippets/gold-Lno.txt',
  text.slice(lno, lno + 1500).replace(/[^\x20-\x7e\n]/g, '.'),
)
writeFileSync(
  'docs/upstream-extraction/v2.1.236/snippets/gold-X_w.txt',
  text.slice(xw, xw + 8000).replace(/[^\x20-\x7e\n]/g, '.'),
)
console.log('wrote gold-jsu-kinds / gold-Lno / gold-X_w')
