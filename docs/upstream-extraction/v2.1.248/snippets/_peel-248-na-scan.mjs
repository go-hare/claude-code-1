/**
 * densable 2.1.248 leftover / host N/A peel — items
 * #10 #30 #31 #32 #33 #39 #40 #41 #43 #46 #47
 *
 * Confirm SEA presence/absence. Extract fn only when unique.
 * NEVER HAVE. Tentative N/A only when host-only + no local-CLI path.
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
  looksJs,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = existsSync(EXE_247) ? loadSea(EXE_247) : null

const needles = [
  // #10 Desktop/Cowork 30d
  ['#10', 'desktopSessionCleanupPeriodDays'],
  ['#10', 'desktopSessionCleanupPeriod'],
  ['#10', 'desktopSessionCleanup'],
  ['#10', 'desktop-written'],
  ['#10', 'desktopWritten'],
  ['#10', 'isDesktopSession'],
  ['#10', 'coworkSession'],
  ['#10', 'Cowork sessions'],
  ['#10', 'desktop-written sessions'],
  ['#10', 'Claude Desktop'],
  ['#10', 'CLAUDE_DESKTOP'],
  ['#10', 'sessionSource:"desktop"'],
  ['#10', 'source:"desktop"'],
  ['#10', 'source==="desktop"'],
  ['#10', 'source==="cowork"'],
  ['#10', 'org policy manages retention'],

  // #30 ultrareview / local seed secrets
  ['#30', 'prod.env'],
  ['#30', '.tfvars'],
  ['#30', 'key.pem.tmp'],
  ['#30', 'id_rsa.swo'],
  ['#30', 'terraform.tfvars'],
  ['#30', '.pem.tmp'],
  ['#30', 'id_rsa.swp'],
  ['#30', '.swo'],
  ['#30', 'locally seeded'],
  ['#30', 'seeded cloud'],

  // #31 RC silent reconnect
  ['#31', 'silently reconnected'],
  ['#31', 'silent reconnect'],
  ['#31', 'silently reconnect'],
  ['#31', 'after the CLI silently'],
  ['#31', 'never showing a permission'],
  ['#31', 'replay permission'],
  ['#31', 'flush pending permission'],
  ['#31', 'pending permission after'],
  ['#31', 'resync after reconnect'],
  ['#31', 'latest messages on the connected'],

  // #32 cloud container credentials
  ['#32', 'not yet readable'],
  ['#32', "credentials were not yet"],
  ['#32', 'session credentials'],
  ['#32', "container's session"],
  ['#32', 'container session credentials'],
  ['#32', 'cloud sessions occasionally failing'],

  // #33 RC flags after global
  ['#33', "unknown option '--spawn'"],
  ['#33', 'unknown option `--spawn`'],
  ['#33', 'unknown option "--spawn"'],
  ['#33', "unknown option '--name'"],
  ['#33', 'passThroughOptions'],
  ['#33', 'enablePositionalOptions'],
  ['#33', 'allowUnknownOption'],
  ['#33', '--spawn may only be specified once'],
  ['#33', '--spawn requires one of'],

  // #39 VSCode
  ['#39', 'No conversation found'],
  ['#39', 'conversation was never saved'],
  ['#39', 'never saved'],
  ['#39', 'starts a new conversation instead'],

  // #40 workflow-authoring
  ['#40', 'workflow-authoring'],
  ['#40', 'workflow_authoring'],
  ['#40', 'script-writing'],
  ['#40', 'script writing reference'],
  ['#40', 'Execute a workflow script that orchestrates'],
  ['#40', 'bundled workflow-authoring'],

  // #41 PR badge unchanged (NOT 247 Wut=60000)
  ['#41', 'PR unchanged'],
  ['#41', 'pr unchanged'],
  ['#41', 'lastHeadSha'],
  ['#41', 'lastPrHead'],
  ['#41', 'prHeadSha'],
  ['#41', 'skip GitHub'],
  ['#41', 'immediate refresh'],
  ['#41', 'gh pr still'],
  ['#41', 'Wut'],
  ['#41', 'classifyPrStatusFocusRecheck'],

  // #43 ultrareview GH precheck
  ['#43', 'can access the repository'],
  ['#43', 'GitHub account connected'],
  ['#43', 'connected to your Claude account'],
  ['#43', 'Claude-connected GitHub'],
  ['#43', 'ultrareview precheck'],
  ['#43', 'ultrareview <PR'],
  ['#43', 'before the cloud session starts'],
  ['#43', 'instead of failing after the cloud'],

  // #46 /loop 3P always
  ['#46', 'self-paced'],
  ['#46', 'self-pace'],
  ['#46', 'autonomous default'],
  ['#46', 'tengu_kairos_loop_dynamic'],
  ['#46', 'tengu_kairos_loop_prompt'],
  ['#46', 'always available'],
  ['#46', 'including on Bedrock'],

  // #47 Anthropic telemetry prefix
  ['#47', '[Anthropic telemetry]'],
  ['#47', '[3P telemetry] OTEL diag error'],
  ['#47', '[3P telemetry] OTEL diag error:'],
  ['#47', '[3P telemetry] OTEL diag'],
  ['#47', 'Anthropic telemetry'],
]

const lines = [
  '# gold-248-na-scan',
  `exe=${EXE_248}`,
  `bytes=${b248.length}`,
  `when=${new Date().toISOString()}`,
  `b247=${b247 ? b247.length : 'ABSENT'}`,
  '',
]

function dumpHits(item, needle, around = 90, cap = 8) {
  const hits = allHits(b248, needle)
  const hits247 = b247 ? allHits(b247, needle).length : 'n/a'
  lines.push(
    `## ${item} needle=${JSON.stringify(needle)} hits248=${hits.length} hits247=${hits247}`,
  )
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    const win = asciiSlice(b248, i - around, i + needle.length + around)
    lines.push(`- #${idx} @${i} js=${looksJs(win) ? 1 : 0} ${win}`)
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

const byItem = new Map()
for (const [item, needle] of needles) {
  const hits = dumpHits(item, needle)
  if (!byItem.has(item)) byItem.set(item, [])
  byItem.get(item).push({ needle, hits })
}

lines.push('# unique-fn-extracts (hits248===1 only, lastFnStartGeneric)')
lines.push('')

const extracted = []
for (const [item, rows] of byItem) {
  for (const { needle, hits } of rows) {
    if (hits.length !== 1) continue
    const i = hits[0]
    const loc = lastFnStartGeneric(b248, i, 8000)
    lines.push(`## ${item} UNIQUE ${JSON.stringify(needle)} @${i}`)
    if (loc.i < 0) {
      lines.push(`NO_FN_START ${asciiSlice(b248, i - 80, i + 160)}`)
      lines.push('')
      continue
    }
    const ext = extractFnAt(b248, loc.i, 12000)
    if (ext.body) {
      lines.push(`fn=${loc.name} start=${loc.i} len=${ext.len} sha=${ext.sha}`)
      if (ext.len <= 4000) {
        lines.push(ext.body)
      } else {
        lines.push(`BODY_TOO_LONG preview=${ext.body.slice(0, 500)}`)
        lines.push(`… tail=${ext.body.slice(-200)}`)
      }
      extracted.push({
        item,
        needle,
        name: loc.name,
        start: loc.i,
        len: ext.len,
        sha: ext.sha,
      })
    } else {
      lines.push(`MISS ${JSON.stringify(ext)}`)
    }
    lines.push('')
  }
}

lines.push('# extract-index')
for (const e of extracted) {
  lines.push(
    `- ${e.item} ${JSON.stringify(e.needle)} fn=${e.name} @${e.start} len=${e.len} sha=${e.sha}`,
  )
}
lines.push('')

writeFileSync(`${outDir}/gold-248-na-scan.txt`, lines.join('\n'))
console.log(
  'WROTE',
  `${outDir}/gold-248-na-scan.txt`,
  'chars',
  lines.join('\n').length,
  'uniqueFns',
  extracted.length,
)
