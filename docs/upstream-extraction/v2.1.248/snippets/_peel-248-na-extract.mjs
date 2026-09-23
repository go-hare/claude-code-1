/**
 * Pass 2 — unique-ish leftover extracts for 248 #10 #30 #33 #40 #41 #43 #46 #47
 * plus deeper #31/#32/#39 host probes.
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

const lines = [
  '# gold-248-na-extract',
  `bytes248=${b248.length} bytes247=${b247 ? b247.length : 'ABSENT'}`,
  '',
]

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

function dumpHits(label, needle, around = 100, cap = 8) {
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

// --- #10 Ae / xe / Y8e / schema ---
dumpHits('#10 schema-desc', 'Retention ceiling in days for session')
dumpHits('#10 $te', '$te=["cleanupPeriodDays","desktopSessionCleanupPeriodDays"]')
dumpHits('#10 filesRetainedFresh', 'filesRetainedFresh')
dumpHits('#10 filesPastCutoff', 'filesPastCutoff')
dumpHits('#10 presenceSources desktop', 'presenceSources:["userSettings","flagSettings"]')

const ae = b248.indexOf(Buffer.from('function Ae(){let e=tx("desktopSessionCleanupPeriodDays")'))
dumpFn('#10 Ae', ae, 4000)
const xe = b248.indexOf(Buffer.from('function xe(){'), ae)
dumpFn('#10 xe-after-Ae', xe, 6000)
dumpAround('#10 Ae-win', ae, 200, 2500)

const y8e = b248.indexOf(Buffer.from('function Y8e(e){let t=e.parentManaged'))
dumpFn('#10 Y8e', y8e, 3500)

// desktop exemption in cleanup
dumpHits('#10 desktop source cleanup', 'desktop')
dumpHits('#10 cowork cleanup', 'cowork')
dumpHits('#10 cleanupPeriodDays', 'cleanupPeriodDays')

// --- #30 seed tfvars / swap / env ---
dumpHits('#30 sr-tfvars', '/^(.*)\\.tfvars(?:\\.json)?$/')
dumpHits('#30 ar-fn', 'function ar(e){let t=sr.exec(e)')
const ar = b248.indexOf(Buffer.from('function ar(e){let t=sr.exec(e)'))
dumpFn('#30 ar', ar, 800)
dumpAround('#30 ar-win', ar, 800, 1200)

dumpHits('#30 St', 'function St(e)')
dumpHits('#30 env-style', '.env')
dumpHits('#30 swap-suffix', '.swp')
dumpHits('#30 swo-suffix', '.swo')
dumpHits('#30 tmp-suffix', '.tmp')
dumpHits('#30 backup-save', '.save.')
dumpHits('#30 prod.env-dot', 'prod.env')
dumpHits('#30 env.prod', '.env.prod')
dumpHits('#30 SECRET-like', 'secrets?.(?:ya?ml|json|toml)')

// compare 247 ar if present
if (b247) {
  const ar247 = b247.indexOf(Buffer.from('function ar(e){let t=sr.exec(e)'))
  lines.push(`## #30 ar-247 @${ar247}`)
  if (ar247 >= 0) {
    const ext = extractFnAt(b247, ar247, 800)
    lines.push(ext.body || JSON.stringify(ext))
  } else lines.push('MISS')
  lines.push('')
  const sr247 = allHits(b247, '/^(.*)\\.tfvars(?:\\.json)?$/')
  lines.push(`## #30 sr-tfvars-247 hits=${sr247.length}`)
  lines.push('')
}

// --- #31 deeper ---
dumpHits('#31 permission prompt', 'permission prompt')
dumpHits('#31 PermissionRequest reconnect', 'PermissionRequest')
dumpHits('#31 tengu_bridge_reconnected', 'tengu_bridge_reconnected')
dumpHits('#31 replay after reconnect', 'replay')
dumpHits('#31 flushGate', 'flushGate')
dumpHits('#31 connected device', 'connected device')
dumpHits('#31 on the connected', 'on the connected')

// --- #32 deeper ---
dumpHits('#32 readable', 'readable')
dumpHits('#32 EAGAIN cred', 'EAGAIN')
dumpHits('#32 ENOENT session', 'ENOENT')
dumpHits('#32 wait for credentials', 'wait for credentials')
dumpHits('#32 session cred file', 'session.json')

// --- #33 RC commander ---
const rcAllow = b248.indexOf(
  Buffer.from(
    'allowUnknownOption().allowExcessArguments(!0).action(w(async(P,M,H,L)=>{let{enterRemoteControl:j,rootOptions',
  ),
)
dumpAround('#33 rc-allowUnknown', rcAllow, 400, 800)
const fn33 = lastFnStartGeneric(b248, rcAllow, 2000)
lines.push(`## #33 lastFn before allowUnknown name=${fn33.name} @${fn33.i}`)
if (fn33.i >= 0) dumpFn('#33 commander-reg', fn33.i, 5000)

dumpHits('#33 enterRemoteControl', 'enterRemoteControl')
dumpHits('#33 remote-control allowUnknown', 'Control local sessions from claude.ai/code')

if (b247) {
  const rc247 = b247.indexOf(
    Buffer.from(
      'allowUnknownOption().allowExcessArguments(!0).action(w(async(P,M,H,L)=>{let{enterRemoteControl',
    ),
  )
  lines.push(`## #33 rc-allowUnknown-247 @${rc247}`)
  lines.push('')
}

// --- #39 ---
dumpHits('#39 vscode conversation', 'vscode')
dumpHits('#39 VSCode', '[VSCode]')
dumpHits('#39 No conversation found when', 'No conversation found when')

// --- #40 workflow-authoring ---
dumpHits('#40 $w', '$w="workflow-authoring"')
dumpHits('#40 K$', 'K$($w,')
dumpHits('#40 tengu_workflow_authoring', 'tengu_workflow_authoring_skill_autoload')
dumpHits('#40 workflow_authoring_autoload', 'workflow_authoring_autoload')
dumpHits('#40 bundled:workflow', 'bundled:workflow-authoring')
dumpHits('#40 SKILL.md authoring', 'name: workflow-authoring')
dumpHits('#40 You are writing', 'You are writing a workflow')
dumpHits('#40 script primitives', 'agent()/parallel()')

const kw = b248.indexOf(Buffer.from('K$($w,`bundled:${$w}`'))
dumpAround('#40 K$-call', kw, 200, 900)
const fn40 = lastFnStartGeneric(b248, kw, 4000)
if (fn40.i >= 0) dumpFn('#40 autoload-fn', fn40.i, 8000)

// --- #41 PR badge ---
dumpHits('#41 fetchPrStatus', 'fetchPrStatus')
dumpHits('#41 prStatusFooter', 'prStatusFooter')
dumpHits('#41 lastFetch', 'lastFetch')
dumpHits('#41 gh pr view --json', 'pr view --json')
dumpHits('#41 tengu_pr_status', 'tengu_pr_status')
dumpHits('#41 pr_badge', 'pr_badge')
dumpHits('#41 prStatus', 'prStatus')
dumpHits('#41 headRefOid', 'headRefOid')
dumpHits('#41 reviewDecision', 'reviewDecision')
dumpHits('#41 POLL_INTERVAL', '60000')

// --- #43 github_not_connected ---
dumpHits('#43 github_not_connected', 'github_not_connected')
dumpHits('#43 github_no_access', 'github_no_access')
dumpHits('#43 repo_inaccessible', 'repo_inaccessible')
dumpHits('#43 install the app at', 'install the app at')
dumpHits('#43 none is connected', 'none is connected')
const gh = b248.indexOf(Buffer.from('github_not_connected'))
dumpAround('#43 github_not_connected-win', gh, 400, 1200)
const fn43 = lastFnStartGeneric(b248, gh, 6000)
if (fn43.i >= 0) dumpFn('#43 precheck-fn', fn43.i, 10000)

// --- #46 loop gates gone ---
dumpHits('#46 tengu_kairos_loop_dynamic', 'tengu_kairos_loop_dynamic')
dumpHits('#46 tengu_kairos_loop_prompt', 'tengu_kairos_loop_prompt')
dumpHits('#46 tengu_kairos_loop', 'tengu_kairos_loop')
dumpHits('#46 jKe', 'jKe')
dumpHits('#46 qAs', 'qAs')
dumpHits('#46 firstParty loop', 'firstParty')
if (b247) {
  lines.push(
    `## #46 247 tengu_kairos_loop_dynamic hits=${allHits(b247, 'tengu_kairos_loop_dynamic').length}`,
  )
  lines.push(
    `## #46 247 tengu_kairos_loop_prompt hits=${allHits(b247, 'tengu_kairos_loop_prompt').length}`,
  )
  lines.push('')
}

// --- #47 Oht ---
const oht = b248.indexOf(Buffer.from('var xP="[Anthropic telemetry]";class Oht{'))
dumpFn('#47 Oht', oht, 6000)
dumpAround('#47 Oht-win', oht, 80, 2500)
dumpHits('#47 xP', 'var xP="[Anthropic telemetry]"')
dumpHits('#47 logSummary', 'logSummary')
dumpHits('#47 anthropic. prefix', ')\\.(anthropic\\..+)$')

writeFileSync(`${outDir}/gold-248-na-extract.txt`, lines.join('\n'))
console.log(
  'WROTE',
  `${outDir}/gold-248-na-extract.txt`,
  'chars',
  lines.join('\n').length,
)
