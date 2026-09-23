/**
 * Peel remaining official Ie wrappers + export aliases.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-ie-wrappers',
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(needle) {
  const hits = allHits(buf, needle)
  lines.push(`## ${needle} hits=${hits.length}`)
  for (const i of hits.slice(0, 2)) {
    const ext = extractFnAt(buf, i, 400)
    lines.push(`@${i} sha=${ext.sha ?? ''} ${ext.body ?? JSON.stringify(ext)}`)
  }
  lines.push('')
}

dumpAround('isInteractive-wrappers', 178563058, 0, 400)
dumpAround('clientType-hunt', 178569934, 0, 500)
dumpAround('export-get-192776700', 192776700, 0, 900)
dumpAround('export-set-192787000', 192787000, 0, 900)

for (const n of [
  'function De(',
  'function vu(',
  'function AEn(',
  'function BEn(',
  'function hEr(',
  'function _x(',
  'function c7(',
  'function NGt(',
  'function $Gt(',
  'function qC(',
  'function V$(',
  'function FEn(',
  'function NEn(',
  'function WEn(',
  'function GEn(',
]) {
  dumpFn(n)
}

for (const alias of [
  'vu as getIsInteractive',
  'De as getIsNonInteractiveSession',
  'AEn as setIsInteractive',
  'as getClientType',
  'as setClientType',
  'as getSdkAgentProgressSummariesEnabled',
  'FEn as setSdkAgentProgressSummariesEnabled',
  'BEn as getStrictToolResultPairing',
  'hEr as setStrictToolResultPairing',
  '_x as getUserMsgOptIn',
  'c7 as setUserMsgOptIn',
  'NGt as getQuestionPreviewFormat',
  '$Gt as setQuestionPreviewFormat',
  'as getSessionBypassPermissionsMode',
  'as setSessionBypassPermissionsMode',
  'as getScheduledTasksEnabled',
  'V$ as setScheduledTasksEnabled',
  'qC as isSessionPersistenceDisabled',
  'as setSessionPersistenceDisabled',
  'as getInitJsonSchema',
  'as setInitJsonSchema',
  'as getThinkingDisplayExplicit',
  'qLe as setThinkingDisplayExplicit',
  'WEn as isPollEventIngressWired',
  'NEn as isSingleShotPrintSession',
]) {
  const hits = allHits(buf, alias)
  lines.push(`## alias ${JSON.stringify(alias)} hits=${hits.length}`)
  if (hits[0] !== undefined) {
    lines.push(asciiSlice(buf, hits[0] - 80, hits[0] + alias.length + 80))
  }
  lines.push('')
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-ie-wrappers.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-ie-wrappers.txt')
