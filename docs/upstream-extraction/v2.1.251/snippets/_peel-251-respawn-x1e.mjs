import { readFileSync } from 'fs'

const s = readFileSync(
  process.env.TEMP + '/official-251/package/claude.exe',
).toString('latin1')

function findAll(needle, limit = 12) {
  const hits = []
  let i = 0
  while (hits.length < limit) {
    i = s.indexOf(needle, i)
    if (i < 0) break
    hits.push(i)
    i += needle.length
  }
  return hits
}

for (const n of ['knownState', "couldn't confirm restart", 'async function X1e', 'function X1e(']) {
  console.log(n, findAll(n).join(','))
}

for (const n of ['function Yie(', 'async function uK(', 'function uK(']) {
  let i = 0
  let c = 0
  while (c < 4) {
    i = s.indexOf(n, i)
    if (i < 0) break
    const body = s.slice(i, i + 1200)
    if (body.includes('jobId') || body.includes('attach') || body.includes('background')) {
      console.log('\n====', n, i, '====')
      console.log(body)
      c++
    }
    i += n.length
  }
}
