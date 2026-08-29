import { readFileSync, writeFileSync } from 'fs'
const text = readFileSync(`${process.env.TEMP}/official-239/package/claude.exe`).toString('latin1')

function dump(label, idx, len = 2000) {
  const s = text.slice(idx, idx + len).replace(/[^\x20-\x7e]/g, '.')
  console.log('\n====', label, idx, '====\n', s)
  return s
}

for (const n of ['function Bgp(', 'async function Bgp(', 'Bgp=function', 'function NEv(', 'async function NEv(', 'function $Ev(']) {
  const i = text.indexOf(n)
  console.log(n, i)
  if (i >= 0) dump(n, i, 2500)
}

// doo call site: buildDescriptor then f(
const i = text.indexOf('buildDescriptor({input:')
dump('doo buildDescriptor', i - 50, 600)

// vot helper
const v = text.indexOf('function vot(')
dump('vot', v, 400)

writeFileSync(
  'docs/upstream-extraction/v2.1.236/snippets/gold-Bgp.txt',
  text.slice(Math.max(0, text.indexOf('function Bgp(')), text.indexOf('function Bgp(') + 3000).replace(/[^\x20-\x7e\n]/g, '.'),
)
