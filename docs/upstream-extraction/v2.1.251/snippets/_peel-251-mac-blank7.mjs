import {
  loadSea,
  allHits,
  asciiSlice,
  extractFnAt,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

// Bd — style redistribute across soft-wrap using softWrap kinds
const bdHits = allHits(buf, 'function Bd(')
console.log('function Bd(', bdHits.length)
for (const h of bdHits.filter(x => x > 189600000 && x < 189750000)) {
  const ext = extractFnAt(buf, h, 12000)
  console.log('Bd sha', sha(ext.body || ''), 'len', ext.body?.length)
  console.log(ext.body)
}

// Also search width===2||width===3 or .width===2 in ink write
for (const n of [
  'width===2',
  'width===3',
  '.width===2||',
  'CellWidth',
  'SPACER',
  'spacer',
  'wide char',
  'Wide',
]) {
  const hits = allHits(buf, n).filter(h => h > 189600000 && h < 189800000)
  console.log(n, hits.length, hits.slice(0, 5).join(','))
}

// vE = writeLineToScreen equivalent
const veHits = allHits(buf, 'function vE(')
console.log('\nfunction vE(', veHits.length)
for (const h of veHits.filter(x => x > 189600000 && x < 189750000).slice(0, 2)) {
  const ext = extractFnAt(buf, h, 8000)
  console.log('vE sha', sha(ext.body || ''), 'len', ext.body?.length)
  console.log(ext.body?.slice(0, 2500))
}

// How official handles width-2 chars when writing cells
for (const n of ['function mn(', 'function ad(', 'packWord1', 'WIDTH_MASK']) {
  const hits = allHits(buf, n).filter(h => h > 189600000 && h < 189750000)
  console.log(n, hits.slice(0, 3).join(','))
}
