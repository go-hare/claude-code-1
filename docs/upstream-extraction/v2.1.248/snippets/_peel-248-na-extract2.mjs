/**
 * Pass 3 — remaining unique leftover bodies + host-only probes.
 */
import { existsSync, writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = existsSync(EXE_247) ? loadSea(EXE_247) : null
const lines = ['# gold-248-na-extract2', '']

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpFn(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpHits(label, needle, around = 80, cap = 6) {
  const hits = allHits(b248, needle)
  const n247 = b247 ? allHits(b247, needle).length : 'n/a'
  lines.push(
    `## ${label} needle=${JSON.stringify(needle)} hits248=${hits.length} hits247=${n247}`,
  )
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b248, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

// #10 desktop-written detection + schema
dumpHits('#10 desktop-host surface', 'desktop-host surface')
dumpHits('#10 last written by', 'last written by')
dumpHits('#10 created or last written', 'created or last written')
dumpHits('#10 otherwise exempt', 'otherwise exempt')
dumpHits('#10 host surface', 'host surface')
dumpHits('#10 writtenByDesktop', 'writtenByDesktop')
dumpHits('#10 desktopHost', 'desktopHost')
dumpHits('#10 sessionHost', 'sessionHost')
dumpHits('#10 hostKind', 'hostKind')
dumpHits('#10 Ce default desktop', '??Ce')
const schema = b248.indexOf(
  Buffer.from('desktopSessionCleanupPeriodDays:A().int().nonnegative()'),
)
dumpAround('#10 schema-full', schema, 80, 900)

// find desktop exemption predicate near Ae
dumpHits('#10 isDesktopWritten', 'isDesktop')
dumpHits('#10 desktopWrittenAt', 'desktopWritten')
dumpHits('#10 source desktop', 'source==="desktop"')
dumpHits('#10 cowork source', '"cowork"')
dumpHits('#10 CLAUDE_CODE_ENTRYPOINT desktop', 'entrypoint')

// #30 rr/or/ke/Xn
const rr = b248.indexOf(Buffer.from('function rr(e){return Yn.includes(e)||zn.test(e)'))
dumpFn('#30 rr', rr, 1500)
const or = b248.indexOf(
  Buffer.from('function or(e){return e.endsWith(ke)&&!St(e.slice(0,-ke.length))}'),
)
dumpFn('#30 or', or, 400)
dumpAround('#30 ke-Yn-zn', rr, 600, 200)
dumpHits('#30 var ke', 'var ke=".env"')
dumpHits('#30 ke=".env"', 'ke=".env"')
dumpHits('#30 Xn backup', 'Xn.exec')
const xn = b248.indexOf(Buffer.from('function ht(e){let t=Xn.exec(e)'))
dumpFn('#30 ht-backup', xn, 400)
dumpAround('#30 Xn-def', xn, 200, 80)

// #31 248-new RC
dumpHits('#31 republishSurviving', 'republishSurviving')
dumpHits('#31 getPendingPermissionRequests', 'getPendingPermissionRequests')
dumpHits('#31 flushPendingReceipts', 'flushPendingReceipts')
dumpHits('#31 after silent', 'after silent')
dumpHits('#31 silent WS', 'silent')
dumpHits('#31 permission after reconnect', 'permission after')
dumpHits('#31 latest messages', 'latest messages')
dumpHits('#31 undeliveredResponses', 'undeliveredResponses')

// #32 cloud container
dumpHits('#32 CLAUDE_CODE_ENVIRONMENT_KIND', 'CLAUDE_CODE_ENVIRONMENT_KIND')
dumpHits('#32 container session', 'container session')
dumpHits('#32 session cred not', 'credentials not')

// #33 enterRemoteControl
dumpHits('#33 rootOptionsRemoteControlRefuses', 'rootOptionsRemoteControlRefuses')
dumpHits('#33 rootOptionsRefusedMessage', 'rootOptionsRefusedMessage')
dumpHits('#33 suppliedRootOptions', 'suppliedRootOptions')
dumpHits('#33 enterRemoteControl export', 'export{R as enterRemoteControl')
const erc = b248.indexOf(Buffer.from('export{R as enterRemoteControl'))
dumpAround('#33 enterRemoteControl-export', erc, 80, 200)
const rFn = lastFnStartGeneric(b248, erc, 8000)
lines.push(`## #33 lastFn before export name=${rFn.name} @${rFn.i}`)
if (rFn.i >= 0) dumpFn('#33 enterRemoteControl-near', rFn.i, 6000)

const refuse = b248.indexOf(Buffer.from('function'))
// find rootOptionsRemoteControlRefuses body
const ror = b248.indexOf(Buffer.from('rootOptionsRemoteControlRefuses'))
dumpAround('#33 refuses-first-js', ror > 191000000 ? ror : b248.indexOf(Buffer.from('rootOptionsRemoteControlRefuses'), 191000000), 100, 800)

// #40 gTt skill body
dumpHits('#40 gTt', 'gTt()')
dumpHits('#40 function gTt', 'function gTt')
const gtt = b248.indexOf(Buffer.from('function gTt('))
dumpFn('#40 gTt', gtt, 4000)
dumpHits('#40 workflow-authoring.md', 'workflow-authoring.md')
dumpHits('#40 workflow-authoring/', 'workflow-authoring/')
dumpHits('#40 SKILL workflow', 'workflow-authoring')

// #41 248-new cache
dumpHits('#41 lastReviewFetchAt', 'lastReviewFetchAt')
dumpHits('#41 prStatusByUrl=A$', 'prStatusByUrl=A$')
dumpHits('#41 _Jt,30000', '_Jt,30000')
dumpHits('#41 iJt=300000', 'iJt=300000')
dumpHits('#41 pollerNotModifiedStreak', 'pollerNotModifiedStreak')
dumpHits('#41 304 Not Modified', '304')
if (b247) {
  lines.push(
    `## #41 247 lastReviewFetchAt hits=${allHits(b247, 'lastReviewFetchAt').length}`,
  )
  lines.push(
    `## #41 247 pollerNotModifiedStreak hits=${allHits(b247, 'pollerNotModifiedStreak').length}`,
  )
  lines.push('')
}

// #43 unique fns
const mapFn = b248.indexOf(
  Buffer.from('return"github_not_connected";if(e===404'),
)
const mapStart = lastFnStartGeneric(b248, mapFn, 2000)
dumpFn('#43 map-verdict', mapStart.i, 2500)
dumpAround('#43 map-win', mapFn, 400, 400)

const pre = b248.indexOf(
  Buffer.from('tengu_review_remote_github_access_probe'),
)
const preFn = lastFnStartGeneric(b248, pre > 193000000 ? pre : b248.indexOf(Buffer.from('tengu_review_remote_github_access_probe'), 193000000), 8000)
lines.push(`## #43 precheck lastFn name=${preFn.name} @${preFn.i}`)
if (preFn.i >= 0) dumpFn('#43 precheck', preFn.i, 12000)

dumpHits('#43 tengu_review_remote_github_access_probe', 'tengu_review_remote_github_access_probe')
dumpHits('#43 tengu_review_remote_precondition_failed', 'tengu_review_remote_precondition_failed')
dumpHits('#43 github_repo_not_found', 'github_repo_not_found')

// #46 always-on replacement
dumpHits('#46 function g9', 'function g9')
dumpHits('#46 isKairosLoopDynamicEnabled leftover name', 'loop_dynamic')
dumpHits('#46 Omit the interval to let the model self-pace', 'Omit the interval to let the model self-pace')
if (b247) {
  const d247 = b247.indexOf(Buffer.from('tengu_kairos_loop_dynamic'))
  dumpAround('#46 247-dynamic-gate-win', d247, 80, 200)
}
// find 248 loop enable: description still has self-pace
const pace = b248.indexOf(
  Buffer.from('Omit the interval to let the model self-pace'),
)
dumpAround('#46 self-pace-desc', pace, 200, 200)
const paceFn = lastFnStartGeneric(b248, pace, 3000)
if (paceFn.i >= 0) dumpFn('#46 loop-register-near', paceFn.i, 4000)

// #47 QO wrap
const qo = b248.indexOf(Buffer.from('function QO(e,t){let r=e.export.bind(e)'))
dumpFn('#47 QO', qo, 1500)

writeFileSync(`${outDir}/gold-248-na-extract2.txt`, lines.join('\n'))
console.log(
  'WROTE',
  `${outDir}/gold-248-na-extract2.txt`,
  'chars',
  lines.join('\n').length,
)
