/**
 * Print gold-ready excerpts + remaining hit counts for gold-251-h.md
 */
import {
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

function excerpt(off, before, after) {
  const max = 2500
  const a = Math.max(0, off - before)
  let b = Math.min(buf.length, a + before + after)
  if (b - a > max) b = a + max
  const text = asciiSlice(buf, a, b)
  return { off, text, sha: sha(text), len: text.length }
}

const Ce = extractFnAt(buf, 196599616, 2000)
const Ve = extractFnAt(buf, 185450781, 4000)
const yGt = extractFnAt(buf, 182518308, 4000)
const oe = extractFnAt(buf, 209384187, 2000)
const XEn = extractFnAt(buf, 185879240, 4000)
const yit = extractFnAt(buf, 185877803, 4000)
const An = extractFnAt(buf, 204216547, 8000)
const nPn = extractFnAt(buf, 178833430, 800)
const It = extractFnAt(buf, 199298081, 4000)

console.log('Ce', Ce.len, Ce.sha)
console.log(Ce.body)
console.log('\nV_e', Ve.len, Ve.sha)
console.log('yGt', yGt.len, yGt.sha)
console.log('oe', oe.len, oe.sha)
console.log('XEn', XEn.len, XEn.sha)
console.log('yit', yit.len, yit.sha)
console.log('An', An.len, An.sha)
console.log('nPn', nPn.len, nPn.sha)

const extra = [
  'Forwarded to Claude Desktop',
  'session messaging',
  'not_reachable',
  'desktop_session_id',
  'desktop_host',
  'Cross-session messaging is not available',
  'preflight failed transiently',
  'Retry in a moment',
  'Please set up GitHub',
  'checkGithubAppInstalled',
  'recentRelayFailures',
  'names the host and reason',
  'SDKFooterIndicator',
  'Remote Control banner',
  'footer pill',
  'Bedrock, Foundry, or Vertex',
  'Amazon Bedrock, Microsoft Foundry, or Vertex AI',
  'third-party provider setup',
  '5 MB smaller',
  'install size',
  'quiet notice',
  'from was the agent type',
  'is not an address',
  'model had changed',
  'initial model',
  'host was only setting',
  'redundant UI',
  're-renders',
]
for (const n of extra) {
  const h = allHits(buf, n)
  console.log(
    `HIT ${JSON.stringify(n)} ${h.length} ${h.slice(0, 8).join(',')}${h.length > 8 ? ` +${h.length - 8}` : ''}`,
  )
}

const blocks = {
  call: excerpt(196617994, 0, 2500),
  ce: excerpt(196599616, 0, 400),
  ve: excerpt(185450781, 0, 2500),
  wTretry: excerpt(185753650, 0, 900),
  wTsetup: excerpt(185755900, 0, 700),
  yGt: excerpt(182518308, 0, 700),
  oe: excerpt(209384187, 0, 380),
  An: excerpt(204219870, 0, 480),
  It: excerpt(199299300, 80, 400),
  footer: excerpt(180879500, 20, 280),
  fromPhrase: excerpt(181642560, 40, 240),
  XEn: excerpt(185879240, 0, 500),
}

for (const [k, v] of Object.entries(blocks)) {
  console.log(`\n######## ${k} off=${v.off} sha=${v.sha} len=${v.len}`)
  console.log(v.text)
}
