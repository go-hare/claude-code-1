/**
 * densable 2.1.251 SEA peel — changelog bullets 12, 13, 16, 17, 18.
 * Run from repo root:
 *   bun docs/upstream-extraction/v2.1.251/snippets/_peel-251-c.mjs
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
} from './_peel-251-helpers.mjs'

const buf = loadSea()
const dir = dirname(fileURLToPath(import.meta.url))
const outPath = join(dir, 'gold-251-c.md')
const EXCERPT = 3500
const MAX_LEN = 500000

const lines = []
const say = (s = '') => lines.push(s)

function fmtOffsets(hits, cap = 16) {
  if (hits.length === 0) return '(none)'
  if (hits.length <= cap) return hits.join(',')
  return `${hits.slice(0, cap).join(',')} … +${hits.length - cap}`
}

const extCache = new Map()
function extractCached(i) {
  const hit = extCache.get(i)
  if (hit) return hit
  const ext = extractFnAt(buf, i, MAX_LEN)
  extCache.set(i, ext)
  return ext
}

function locate(hitOff) {
  let cursor = hitOff + 1
  let look = 250000
  for (let n = 0; n < 320; n++) {
    const st = lastFnStartGeneric(buf, cursor, look)
    if (st.i < 0) return null
    const ext = extractCached(st.i)
    const rel = hitOff - st.i
    if (ext.body && rel >= 0 && rel < ext.body.length) {
      return { name: st.name, i: st.i, ext, rel }
    }
    if (st.i <= 0) return null
    cursor = st.i
    look = 60000
  }
  return null
}

function atMarker(marker) {
  const i = buf.indexOf(Buffer.from(marker))
  if (i < 0) return null
  const named = /function\s+([A-Za-z_$][\w$]*)/.exec(marker)
  const ext = extractCached(i)
  return { name: named?.[1] ?? '', i, ext, rel: 0 }
}

function excerptAt(body, rel) {
  if (!body) return ''
  if (body.length <= EXCERPT) return body
  const half = Math.floor(EXCERPT / 2)
  let start = Math.max(0, rel - half)
  let end = Math.min(body.length, start + EXCERPT)
  start = Math.max(0, end - EXCERPT)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < body.length ? '…' : ''
  const budget = EXCERPT - prefix.length - suffix.length
  return prefix + body.slice(start, start + budget) + suffix
}

function pushFn(rec, focusRel) {
  if (!rec?.ext?.body) {
    say('function: MISS (lastFnStartGeneric + extractFnAt)')
    say('')
    return
  }
  const rel = focusRel ?? rec.rel ?? 0
  const { name, i, ext } = rec
  say(`#### \`${name || '(anon)'}\` @${i}`)
  say(`- len=${ext.len} sha256_16=${ext.sha}`)
  const early = ext.body.indexOf('}function ')
  if (early >= 0 && early < rel) {
    say(
      `- note: extractFnAt span includes \`}function \` at +${early}, before the focus at +${rel} (a regex literal containing a quote keeps the brace matcher inside a string)`,
    )
  }
  say('')
  say('```')
  say(excerptAt(ext.body, rel))
  say('```')
  say('')
}

function needleBlock(needles) {
  const found = {}
  for (const n of needles) {
    const hits = allHits(buf, n)
    found[n] = hits
    say(`- \`${n}\` hits=${hits.length} offsets=${fmtOffsets(hits)}`)
  }
  say('')
  return found
}

say('# gold-251-c bullets 12,13,16,17,18')
say('')
say(`exe bytes=${buf.length}`)
say('')
say(
  'Method: `allHits` per needle. Enclosing function is `lastFnStartGeneric` walked outward until `extractFnAt` covers the hit, or `extractFnAt` on the `function` keyword when the marker is the start. `sha256_16` hashes the full extracted body. Excerpts are at most 3500 characters.',
)
say('')

// ----- #12 -----
say('## #12 fresh install starts in auto when the account startup default is auto')
say('')
needleBlock(['startup default', 'auto mode', 'fresh install', 'defaultMode'])

const kgn = atMarker('function kgn(')
const uht = atMarker('function Uht()')
const autoDefault = buf.indexOf(
  Buffer.from('tengu_harbor_willow:t?.autoDefaultLaunchEnabled'),
)
const b3n = autoDefault >= 0 ? locate(autoDefault) : null

say('### #12 functions')
say('##### `kgn` no-mode fallback')
pushFn(kgn, kgn ? kgn.ext.body.indexOf('fromAutoFallback:L') : 0)
say('##### `Uht` gate')
pushFn(uht, 0)
say(`##### \`autoDefaultLaunchEnabled\` @${autoDefault}`)
pushFn(b3n, b3n ? autoDefault - b3n.i : 0)

const kgnBody = kgn?.ext?.body ?? ''
const uhtBody = uht?.ext?.body ?? ''
const b3nBody = b3n?.ext?.body ?? ''
const shows12 =
  kgnBody.includes('if(!v)') &&
  kgnBody.includes('l="auto"') &&
  kgnBody.includes('Uht()') &&
  uhtBody.includes('tengu_harbor_willow') &&
  uhtBody.includes('meadow_lantern') &&
  b3nBody.includes('autoDefaultLaunchEnabled') &&
  b3nBody.includes('tengu_harbor_willow')

say(`**Verdict:** ${shows12 ? 'BODY' : 'STRING-ONLY'}`)
say('')
say(
  shows12
    ? '`kgn` leaves mode `"default"` when nothing supplied a mode, and sets it to `"auto"` (`fromAutoFallback`) when `Uht()` is on. `Uht` is the `tengu_harbor_willow` gate or client-data `meadow_lantern`. The same gate is published from `autoDefaultLaunchEnabled`. Strings "startup default" and "fresh install" are absent; the fallback is the no-configured-mode path.'
    : 'Needles did not land in a function that selects auto from an account launch-default flag.',
)
say('')

// ----- #13 -----
say('## #13 xhigh/max effort with thinking disabled is sent as high')
say('')
needleBlock([
  'is not supported when thinking is disabled',
  'effort',
  'xhigh',
  'thinking is disabled',
])

const clampAt = buf.indexOf(Buffer.from('ga.effort=Wht'))
const clampFn = clampAt >= 0 ? locate(clampAt) : null
const d6e = atMarker('function d6e(e){if(!(e instanceof Gt)')
const bJn = atMarker('function bJn(')
const sJn = atMarker('function SJn(')
const whtAt = buf.indexOf(Buffer.from('var Wht="high"'))
const jhAt = buf.indexOf(Buffer.from('var jh=["low","medium","high","xhigh","max"]'))

say('### #13 functions')
say(`##### clamp \`ga.effort=Wht\` @${clampAt}`)
pushFn(clampFn, clampFn ? clampAt - clampFn.i : 0)
say('##### `d6e` API-error parse')
pushFn(d6e, 0)
say('##### `bJn` rank above high')
pushFn(bJn, 0)
say('##### `SJn` opus-5 / thinking_disabled_effort_cap')
pushFn(sJn, 0)
say(`##### binding @${whtAt} / @${jhAt}`)
say('')
say('```')
say(asciiSlice(buf, jhAt, jhAt + 80))
say(asciiSlice(buf, whtAt - 80, whtAt + 220))
say('```')
say('')

const clampBody = clampFn?.ext?.body ?? ''
const shows13 =
  clampBody.includes('ga.effort=Wht') &&
  clampBody.includes('bJn(ga.effort)') &&
  clampBody.includes('thinking is disabled') &&
  !clampBody.slice(clampBody.indexOf('ga.effort=Wht') - 400, clampBody.indexOf('ga.effort=Wht') + 40).includes('throw') &&
  whtAt >= 0 &&
  jhAt >= 0 &&
  (bJn?.ext?.body ?? '').includes('y(e)>y(Wht)') &&
  (sJn?.ext?.body ?? '').includes('claude-opus-5')

say(`**Verdict:** ${shows13 ? 'BODY' : 'STRING-ONLY'}`)
say('')
say(
  shows13
    ? 'The request builder assigns `ga.effort=Wht` when thinking is disabled and `bJn(ga.effort)`. `var Wht="high"`. `jh` is `low|medium|high|xhigh|max`, so `bJn` is rank above high (xhigh and max). `SJn` includes `claude-opus-5`. `d6e` only reads the API error `/effort \'([a-z]+)\' is not supported when thinking is disabled/`; it does not throw. `extractFnAt` names the builder span `GMt` and runs past a later `function` because a regex contains a quote.'
    : 'The error phrase is present, but no extracted body assigns effort to high.',
)
say('')

// ----- #16 -----
say('## #16 teammate final answer is carried on the idle notification')
say('')
needleBlock(['idle notification', 'available', 'teammate'])

const jhFn = atMarker(
  'async function JH(b,R,x,P,j){let{teamName:Z,agentId:re,agentName:ue}=P',
)
const iMe = atMarker('function IMe(e,t){let s=lyr')
const idleCode = buf.indexOf(
  Buffer.from('Skipping duplicate idle notification for ${e.agentName}'),
)
const lfr = idleCode >= 0 ? locate(idleCode) : null
const lyr = atMarker('function lyr(')

say('### #16 functions')
say('##### `JH` teammate Stop hook')
pushFn(jhFn, jhFn ? (jhFn.ext.body ?? '').indexOf('idleReason:"available"') : 0)
say('##### `IMe` idle_notification')
pushFn(iMe, 0)
say('##### `lyr` result text')
pushFn(lyr, 0)
say(`##### in-process idle send @${idleCode}`)
pushFn(lfr, lfr ? idleCode - lfr.i : 0)

const jhBody = jhFn?.ext?.body ?? ''
const iMeBody = iMe?.ext?.body ?? ''
const lfrBody = lfr?.ext?.body ?? ''
const shows16 =
  jhBody.includes('idleReason:"available"') &&
  jhBody.includes('result:Pe') &&
  jhBody.includes('idle notification') &&
  iMeBody.includes('type:"idle_notification"') &&
  iMeBody.includes('result:s') &&
  lfrBody.includes('idleReason:') &&
  lfrBody.includes('"available"') &&
  lfrBody.includes('result:p')

say(`**Verdict:** ${shows16 ? 'BODY' : 'STRING-ONLY'}`)
say('')
say(
  shows16
    ? '`JH` builds the leader idle notification with `idleReason:"available"` plus `summary` and `result` from `aye`, then writes that object as the mailbox text. `IMe` sets `type:"idle_notification"` and `result` from `lyr` (the result text). The in-process runner passes the same `result` on the available/failed/interrupted idle send. That is the final answer on the idle notification, not only the available token.'
    : 'Idle-notification strings exist, but no extracted body attaches the turn result to that notification.',
)
say('')

// ----- #17 -----
say('## #17 background reply: `from` is an address, not the agent type')
say('')
const n17 = needleBlock([
  'not reachable',
  'from was the agent type',
  'unnamed',
])

say('### #17 representative windows')
const samples17 = [
  buf.indexOf(Buffer.from('installed daemon is not reachable after')),
  buf.indexOf(Buffer.from('it2 CLI is not reachable')),
  buf.indexOf(Buffer.from('not reachable from a cloud session')),
  buf.indexOf(Buffer.from('function gmt(e){let t=lE(e);return t===lE("")?"(unnamed agent)"')),
].filter((off) => off >= 0)

for (const off of samples17) {
  say(`- @${off} ${asciiSlice(buf, off - 90, off + 140).replaceAll('\n', ' ')}`)
}
say('')
say('**Verdict:** STRING-ONLY')
say('')
say(
  '`"from was the agent type"` hits=0. `not reachable` windows are daemon, iTerm `it2`, cloud trusted-device, and machine-copy strings. `unnamed` windows are plugin, cell, session, tool, and `(unnamed agent)` display labels. None of those function bodies set `from` to an agent id or name for an unnamed sibling or parent.',
)
say('')

// ----- #18 -----
say('## #18 mid-session managed disableAutoMode moves auto back to default')
say('')
needleBlock(['disableAutoMode'])

const intFn = atMarker('function Int(t,o,r,i){let l=Je()')
const iJt = atMarker('function iJt(')
const bFt = atMarker('function BFt(')
const qan = atMarker('function Qan(')
const dollarAt = atMarker('function $at(')

say('### #18 functions')
say('##### `Int` settings changed')
pushFn(intFn, intFn ? (intFn.ext.body ?? '').indexOf('iJt(') : 0)
say('##### `iJt` exit auto when policy disables it')
pushFn(iJt, 0)
say('##### `BFt` setMode default')
pushFn(bFt, 0)
say('##### `Qan` / `$at` managed disableAutoMode')
pushFn(qan, 0)
pushFn(dollarAt, 0)

const intBody = intFn?.ext?.body ?? ''
const iJtBody = iJt?.ext?.body ?? ''
const bFtBody = bFt?.ext?.body ?? ''
const qanBody = qan?.ext?.body ?? ''
const atBody = dollarAt?.ext?.body ?? ''
const shows18 =
  intBody.includes('Settings changed from') &&
  intBody.includes('iJt(') &&
  intBody.includes('exitedAutoMode') &&
  iJtBody.includes('Qan()') &&
  iJtBody.includes('BFt(') &&
  bFtBody.includes('mode:t') &&
  bFtBody.includes('let t="default"') &&
  bFtBody.includes('e.mode==="auto"') &&
  qanBody.includes('policySettings') &&
  atBody.includes('disableAutoMode==="disable"')

say(`**Verdict:** ${shows18 ? 'BODY' : 'STRING-ONLY'}`)
say('')
say(
  shows18
    ? '`Int` runs on `Settings changed from ${t}` and applies `iJt` to the live permission context. `iJt` calls `BFt` when the session is in auto (`Bdt`) and `Qan()` is true. `Qan` requires managed policy origin plus `policySettings` `disableAutoMode==="disable"` (`$at`). `BFt` `setMode`s `"auto"` to `"default"`. The `iJt` predicate also requires `hM().length===0||o5()` (no non-warning policy errors, or the admin-survivor flag).'
    : 'disableAutoMode strings exist, but no extracted body moves a running auto session to default when settings change.',
)
say('')

writeFileSync(outPath, lines.join('\n'))
console.log('WROTE', outPath, 'chars', lines.join('\n').length)
