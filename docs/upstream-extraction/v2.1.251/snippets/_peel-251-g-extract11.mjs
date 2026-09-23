/**
 * densable 2.1.251 SEA peel extract11 — #65 m9/jx/vLe.
 */
import { asciiSlice, extractFnAt, loadSea, sha } from './_peel-251-helpers.mjs'

const buf = loadSea()
if (buf.length !== 217360032) throw new Error(`size ${buf.length}`)

function showFn(label, i, maxLen = 6000) {
  const ex = extractFnAt(buf, i, maxLen)
  console.log(`\n==== ${label} @${i} len=${ex.len} sha=${ex.sha} missEnd=${!!ex.missEnd}`)
  if (ex.body) console.log(ex.body.slice(0, 3500))
  else console.log('PREVIEW', (ex.preview || '').slice(0, 400))
}

function win(label, i, before, after) {
  const t = asciiSlice(buf, i - before, i + after)
  console.log(`\n==== WIN ${label} @${i} len=${t.length} sha=${sha(t)}`)
  console.log(t)
}

showFn('#65 vLe', 202741419, 200)
showFn('#65 jx', 202741500, 400)
showFn('#65 m9', 203360400, 2500)
win('#65 m9 start', 203360380, 0, 900)
win('#65 YTe JTe', 203360250, 0, 220)
