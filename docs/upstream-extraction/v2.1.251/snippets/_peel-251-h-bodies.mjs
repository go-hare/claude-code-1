/**
 * Extract #14 SendMessage Desktop path, #45 preflight retry, #21/#48 leftover.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const buf = loadSea()
if (buf.length !== 217360032) throw new Error(String(buf.length))

function lastFn(off, look = 20000) {
  return lastFnStartGeneric(buf, off, look)
}

function extractAround(off, look = 20000, maxLen = 30000) {
  const fn = lastFn(off, look)
  const ex = fn.i >= 0 ? extractFnAt(buf, fn.i, maxLen) : { miss: true }
  return { off, fn, ex }
}

function walkOut(off, look = 40000, maxLen = 40000) {
  const start = Math.max(0, off - look)
  const win = asciiSlice(buf, start, off + 40)
  const re = /(?:async )?function ([A-Za-z_$][\w$]*)\(/g
  const starts = []
  let m
  while ((m = re.exec(win))) starts.push({ i: start + m.index, name: m[1] })
  const hits = []
  for (let c = starts.length - 1; c >= 0 && hits.length < 6; c--) {
    const ex = extractFnAt(buf, starts[c].i, maxLen)
    if (ex.body && off >= starts[c].i && off < starts[c].i + ex.body.length) {
      hits.push({
        name: starts[c].name,
        i: starts[c].i,
        len: ex.len,
        sha: ex.sha,
        body: ex.body,
      })
    }
  }
  return hits
}

const targets = {
  sendDesktop: buf.indexOf(
    Buffer.from(
      "It has the shape of a Claude Desktop session id, but Claude Desktop's session messaging tool is not available",
    ),
  ),
  not_reachable_class: buf.indexOf(
    Buffer.from('desktop_host",h?"not_reachable"'),
  ),
  ghTransient: buf.indexOf(
    Buffer.from(
      'the GitHub App preflight failed transiently (network or service hiccup)',
    ),
  ),
  retryMoment: buf.indexOf(Buffer.from('Retry in a moment, or ')),
  setUpGithub: buf.indexOf(
    Buffer.from('Please set up GitHub on https://claude.ai/code'),
  ),
  modelChangedFalse: 185878389,
}

const out = {}
for (const [k, off] of Object.entries(targets)) {
  console.log(`\n######## ${k} @${off}`)
  if (off < 0) {
    out[k] = { miss: true }
    continue
  }
  const walked = walkOut(off)
  console.log(
    walked
      .map((f) => `${f.name}@${f.i} len=${f.len} sha=${f.sha}`)
      .join(' | ') || 'no enclose',
  )
  for (const f of walked) {
    console.log('---- ' + f.name)
    console.log(f.body.slice(0, 1800))
  }
  out[k] = {
    off,
    win: asciiSlice(buf, off - 500, off + 900),
    walked: walked.map((f) => ({
      name: f.name,
      i: f.i,
      len: f.len,
      sha: f.sha,
      body: f.body,
    })),
  }
}

// more #14 needles: desktop_host success path
const more14 = [
  'desktop_host',
  'session messaging tool',
  'deliver to it',
  'Delivered via Claude Desktop',
  'via Claude Desktop',
  'desktop messaging',
  'handler_rewrite',
  'hop_loop',
]
const table14 = {}
for (const n of more14) {
  const hits = allHits(buf, n)
  table14[n] = { hits: hits.length, offs: hits.filter((h) => h > 170e6).slice(0, 12) }
  console.log(`14 ${JSON.stringify(n)} hits=${hits.length} js=${table14[n].offs.join(',')}`)
}

// walk first js desktop_host that isn't the fail string
for (const off of table14.desktop_host.offs.slice(0, 8)) {
  const walked = walkOut(off, 25000, 30000)
  console.log(
    `\n14 desktop_host @${off} fns=${walked.map((f) => f.name + '@' + f.i + ':' + f.len).join(',')}`,
  )
  if (walked[0]) console.log(walked[0].body.slice(0, 600))
}

// #21 more
const more21 = [
  'model changed (',
  'hydrated baseline',
  'host model',
  'hostModel',
  'sessionModel',
  'initial session model',
  'only setting',
  'setModel',
  'model switch announced',
  'announceModel',
  'notifyModelChange',
  'told Claude',
]
const table21 = {}
for (const n of more21) {
  const hits = allHits(buf, n)
  table21[n] = { hits: hits.length, offs: hits.slice(0, 8) }
  console.log(`21 ${JSON.stringify(n)} hits=${hits.length} ${hits.slice(0, 6).join(',')}`)
}

// #48 bash tool result
const more48 = [
  'connection reset',
  'relay failure',
  'relayFailure',
  'proxy aborted',
  'bare reset',
  'ECONNRESET',
  'agent-proxy',
  'agent_proxy',
  'egress proxy',
]
const table48 = {}
for (const n of more48) {
  const hits = allHits(buf, n)
  table48[n] = { hits: hits.length, offs: hits.filter((h) => h > 170e6).slice(0, 10) }
  console.log(`48 ${JSON.stringify(n)} hits=${hits.length} js=${table48[n].offs.join(',')}`)
}

// extract V_e github preflight
const v_e = buf.indexOf(Buffer.from('function V_e('))
console.log('\nV_e first', v_e)
if (v_e > 0) {
  const ex = extractFnAt(buf, v_e, 8000)
  console.log('V_e', ex.len, ex.sha, ex.body?.slice(0, 900))
  out.V_e = { i: v_e, ...ex }
}

// modelChanged:!1 window
out.modelChangedFalseWin = asciiSlice(buf, 185878200, 185878600)

writeFileSync(
  join(__dir, '_peel-251-h-bodies.json'),
  JSON.stringify({ out, table14, table21, table48 }, null, 2),
)
console.log('wrote bodies json')
