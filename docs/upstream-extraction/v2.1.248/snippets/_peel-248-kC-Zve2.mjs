import {
  EXE_248,
  loadSea,
  asciiSlice,
  extractFnAt,
  allHits,
  sha,
} from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)

function show(label, i, maxLen = 3000) {
  const ex = extractFnAt(b, i, maxLen)
  console.log('====', label, '@' + i, 'sha=' + ex.sha, 'len=' + ex.len)
  console.log(ex.body || ex.preview || 'MISS')
  console.log()
}

show('Zve', 179445024)
show('QB', 179442546)
show('cyn', 179442667)
show('xC', 179444878)
show('kC', 179506276)
show('R', 179527886)
show('CXn', 179444440)
show('vY', 179444669)

console.log('==== near A / join around Zve')
for (const n of [
  'function A(e){',
  'resolve as A',
  'join as _',
  'basename as',
  'from"path"',
  'from"node:path"',
]) {
  const hits = allHits(b, n).filter(i => i > 179400000 && i < 179510000)
  console.log(n, 'hits', hits.length, hits.slice(0, 5))
  for (const i of hits.slice(0, 2)) {
    console.log('@' + i, asciiSlice(b, i - 60, i + 160))
  }
}

console.log('==== Mo near cyn')
for (const i of allHits(b, 'function Mo(').filter(
  i => Math.abs(i - 179442667) < 80000,
)) {
  show('Mo', i, 600)
}

console.log('==== _o near QB')
for (const i of allHits(b, 'function _o(').filter(
  i => Math.abs(i - 179442546) < 80000,
)) {
  show('_o', i, 1200)
}

console.log('==== qyt near vY')
for (const i of allHits(b, 'function qyt(').filter(
  i => Math.abs(i - 179444669) < 80000,
)) {
  show('qyt', i, 1200)
}

// Also peels that match leftover decideCanonicalLocalRoot more closely
console.log('==== cyn decided field names check')
console.log(asciiSlice(b, 179442667, 179442667 + 400))

// Compare leftover relative path vs official xC
console.log('==== settings.local.json vs settings.local')
for (const n of [
  'settings.local.json',
  'settings.local.json',
  '.claude/settings.local.json',
  'legacy local settings',
  'legacy local',
]) {
  console.log(n, allHits(b, n).length, allHits(b, n).slice(0, 5))
}

// H() that kC uses — settings host bag
show('H settings', 179505605, 600)

// To / kC cluster
console.log('==== To/kC cluster')
console.log(asciiSlice(b, 179506200, 179506400))
