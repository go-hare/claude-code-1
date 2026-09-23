/**
 * Pass 6: ao@179108467 ancestor collector; Ryr readable-set; I() write refuse.
 */
import { allHits, asciiSlice, extractFnAt, loadSea, sha } from './_peel-251-helpers.mjs'

const buf = loadSea()

function grow(i, max = 20000) {
  for (const cap of [2000, 8000, max]) {
    const ex = extractFnAt(buf, i, cap)
    if (ex.body) return { ...ex, at: i }
  }
  return { ...extractFnAt(buf, i, max), at: i }
}

function show(label, i) {
  const ex = grow(i)
  console.log(`\n==== ${label} @${i} len=${ex.len} sha=${ex.sha}`)
  console.log(ex.body || asciiSlice(buf, i, i + 200))
  if (ex.body) {
    console.log('hasProcFd', ex.body.includes('/proc/self/fd'))
  }
}

show('ao-tilde-or-ancestors', 179108467)
show('Jo-canonical', 179105968)
show('Ryr', 182137215)
show('zl-tools', 182137475)
show('I-write-refuse', 182186847)
show('H-read-refuse', 182185083)
show('async-aV', 182184937)
show('async-ht', 182184398)

// ao@179108467 context: is it imported into UWt module?
console.log('\n==== around ao 179108400-179108900')
console.log(asciiSlice(buf, 179108400, 179109200))

// Does UWt module import ao from this chunk?
const aoExport = asciiSlice(buf, 179108000, 179110000)
console.log('\nmentions export ao?', /ao/.test(aoExport))
