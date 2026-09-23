/**
 * densable 2.1.251 SEA peel deep — #14 #21 #45 #48 #70 #71 candidates.
 * Invent-ban. Extract enclosing functions only.
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
if (buf.length !== 217360032) throw new Error(`bytes ${buf.length}`)

function walkFn(off, lookback = 16000, maxLen = 24000) {
  const start = Math.max(0, off - lookback)
  const win = asciiSlice(buf, start, off + 80)
  const re = /(?:async )?function ([A-Za-z_$][\w$]*)\(/g
  const starts = []
  let m
  while ((m = re.exec(win))) starts.push({ i: start + m.index, name: m[1] })
  const out = []
  for (let c = starts.length - 1; c >= 0 && out.length < 4; c--) {
    const ex = extractFnAt(buf, starts[c].i, maxLen)
    if (ex.body && off >= starts[c].i && off < starts[c].i + ex.body.length) {
      out.push({
        name: starts[c].name,
        i: starts[c].i,
        len: ex.len,
        sha: ex.sha,
        body: ex.body,
      })
    }
  }
  return out
}

function dump(label, off, before = 200, after = 800) {
  const text = asciiSlice(buf, off - before, off + after)
  const fns = walkFn(off)
  console.log(`\n===== ${label} @${off} =====`)
  console.log(text.replace(/\n/g, '\\n').slice(0, 900))
  for (const f of fns) {
    console.log(
      `-- enclosed by ${f.name}@${f.i} len=${f.len} sha=${f.sha}`,
    )
    console.log(f.body.slice(0, 1400).replace(/\n/g, '\\n'))
  }
  return { off, text, fns }
}

const extraNeedles = [
  'desktop_session_id',
  'No agent named',
  'shape of a Claude Desk',
  'Held message from another session',
  'not reachable',
  'github_preflight_failed',
  'github_preflight_ok',
  'transient',
  'recentRelayFailures',
  'names the host and reason',
  'host-set initial',
  'hostSetInitial',
  'hostInitialModel',
  'initialModelOnly',
  'skipModelChanged',
  'modelChanged:false',
  'modelChanged:!0',
  'modelChanged:!1',
  'VSCode',
  '[VSCode]',
  'Bedrock, Foundry, or Vertex',
  'Amazon Bedrock, Microsoft Foundry, or Vertex AI',
  'third-party provider setup',
  'footer pill',
  'Remote Control banner',
  'SDKFooterIndicator',
  'kind:"error"',
  'Remote Control is disabled by your organization',
  'quiet notice',
  'from was the agent type',
  'from:e.agentType',
  'from:t.agentType',
  'from:e.type',
  'agentType as from',
]

const hitTable = {}
for (const n of extraNeedles) {
  const hits = allHits(buf, n)
  hitTable[n] = { hits: hits.length, offs: hits.slice(0, 20) }
  console.log(`${JSON.stringify(n)} hits=${hits.length} ${hits.slice(0, 10).join(',')}`)
}

const dumps = []

// #14 SendMessage desktop_session
for (const off of allHits(buf, 'desktop_session_id').filter((h) => h > 170e6)) {
  dumps.push({ tag: '#14 desktop_session_id', ...dump('#14 desktop_session_id', off, 400, 1200) })
}
for (const off of allHits(buf, 'shape of a Claude Desk').filter((h) => h > 170e6)) {
  dumps.push({ tag: '#14 shape', ...dump('#14 shape', off, 600, 1400) })
}
for (const off of allHits(buf, 'Held message from another session').filter((h) => h > 170e6)) {
  dumps.push({ tag: '#14 held', ...dump('#14 held', off, 200, 600) })
}

// all JS "not reachable"
for (const off of allHits(buf, 'not reachable').filter((h) => h > 170e6)) {
  dumps.push({ tag: '#14 not reachable js', ...dump('#14 not reachable', off, 180, 420) })
}

// #21 modelChanged bodies
for (const off of allHits(buf, 'function XEn(e,t){let r=[];if(e.modelChanged)')) {
  dumps.push({ tag: '#21 XEn', ...dump('#21 XEn', off, 0, 900) })
}
for (const off of allHits(buf, 'restoredFrom:"initial_model"')) {
  dumps.push({ tag: '#21 qie', ...dump('#21 qie', off, 400, 400) })
}

// #45 github_preflight + transient
for (const off of allHits(buf, 'github_preflight_failed').filter((h) => h > 170e6)) {
  dumps.push({ tag: '#45 preflight_failed', ...dump('#45 preflight_failed', off, 300, 900) })
}
for (const off of allHits(buf, 'Xn.transient').filter((h) => h > 170e6)) {
  dumps.push({ tag: '#45 Xn.transient', ...dump('#45 Xn.transient', off, 400, 800) })
}

// retry after github
for (const n of [
  'retry after',
  'try again',
  'GitHub is temporarily',
  'transient failure',
  'connection to GitHub',
  'could not reach GitHub',
  'GitHub is unreachable',
  'set up the GitHub',
  'install the GitHub app',
  'GitHub App',
]) {
  const hits = allHits(buf, n)
  hitTable[n] = { hits: hits.length, offs: hits.slice(0, 12) }
  console.log(`EXTRA ${JSON.stringify(n)} hits=${hits.length} ${hits.slice(0, 8).join(',')}`)
  for (const off of hits.filter((h) => h > 170e6).slice(0, 3)) {
    dumps.push({ tag: `#45 extra ${n}`, ...dump(`#45 ${n}`, off, 160, 400) })
  }
}

// #48 recentRelayFailures / bash proxy
for (const off of allHits(buf, 'recentRelayFailures').filter((h) => h > 170e6)) {
  dumps.push({ tag: '#48 recentRelayFailures', ...dump('#48 recentRelayFailures', off, 200, 500) })
}

// #22 yGt / oe
for (const off of allHits(buf, 'if(wve())return"Remote Control is disabled by your organization').filter((h) => h > 170e6)) {
  dumps.push({ tag: '#22 yGt', ...dump('#22 yGt', off, 200, 500) })
}
for (const off of allHits(buf, 'async function oe(l){let b=await yGt();if(b)return{kind:"error"').filter((h) => h > 170e6)) {
  dumps.push({ tag: '#22 oe', ...dump('#22 oe', off, 0, 320) })
}

// #70 login 3rd-party label
for (const off of allHits(buf, 'Amazon Bedrock, Microsoft Foundry, or Vertex AI').filter((h) => h > 170e6)) {
  dumps.push({ tag: '#70 login label', ...dump('#70 login', off, 200, 400) })
}

// #71 footer pill
for (const off of allHits(buf, 'footer pill').filter((h) => h > 170e6)) {
  dumps.push({ tag: '#71 footer pill', ...dump('#71 footer pill', off, 160, 360) })
}

writeFileSync(
  join(__dir, '_peel-251-h-deep.json'),
  JSON.stringify(
    {
      hitTable,
      dumps: dumps.map((d) => ({
        tag: d.tag,
        off: d.off,
        text: d.text.slice(0, 1800),
        fns: d.fns.map((f) => ({
          name: f.name,
          i: f.i,
          len: f.len,
          sha: f.sha,
          body: f.body.slice(0, 2500),
        })),
      })),
    },
    null,
    2,
  ),
)
console.log('wrote deep json')
