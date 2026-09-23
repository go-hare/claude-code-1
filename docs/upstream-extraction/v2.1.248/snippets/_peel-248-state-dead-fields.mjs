/**
 * Peel official 2.1.248 for leftover STATE type fields that may already
 * live on n() / n().host bags — confirm bag vs KEEP vs invent-ban.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
  sha,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-state-dead-fields',
  '',
  `when=${new Date().toISOString().slice(0, 10)} · SEA 2.1.248`,
  'cut=dead STATE type fields whose getters already mint n()/host bags',
  '',
]

const needles = [
  // suspects
  'midConvCachePromotionRejected',
  'markMidConvCachePromotionRejected',
  'stickyBetas',
  'unlatchStickyBetas',
  'foundryDeploymentCapabilities',
  'promptCache1hAllowlist',
  'replacePromptCache1hAllowlist',
  'directConnectServerUrl',
  'replaceDirectConnectServerUrl',
  'replBridgeActive',
  'replaceReplBridgeActive',
  'mainThreadAgentHooks',
  'replaceMainThreadAgentHooks',
  'systemPromptSectionCache',
  'lastEmittedDate',
  'replaceLastEmittedDate',
  // related dead type candidates already bagged in leftover wrappers
  'mainLoopBusy',
  'replaceMainLoopBusy',
  'cachedClaudeMdContent',
  'sessionCronTasks',
  'loopChainStartedAt',
  'teleportedSessionInfo',
  'mainThreadAgentType',
  'registeredHooks',
  // KEEP candidates
  'promptCache1hEligible',
  'afkModeHeaderLatched',
  'fastModeHeaderLatched',
  'cacheEditingHeaderLatched',
  'replBridgeSessionId',
  'teleportedSessionIds',
  'kairosActive',
]

for (const n of needles) {
  const hits = allHits(buf, n)
  lines.push(`## needle="${n}" hits=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    // prefer n()-wrapper / class body windows
    const win = asciiSlice(buf, i - 60, i + 180).replace(/\n/g, ' ')
    lines.push(`@${i} ${win}`)
  }
  lines.push('')
}

// Extract wrapper fns near known offsets from gold-248-host-missing / residual
const wrapperNeedles = [
  'function fwn()',
  'function eEr(',
  'function nTn()',
  'function rTn(',
  'function lTn()',
  'function cTn()',
  'function yvt()',
  'function On()',
  'function P4(',
]

lines.push('## wrapper extracts')
for (const w of wrapperNeedles) {
  const hits = allHits(buf, w)
  lines.push(`### ${w} hits=${hits.length}`)
  for (const i of hits.slice(0, 3)) {
    if (i < 178000000 || i > 179000000) continue
    const start = lastFnStartGeneric(buf, i + 20)
    const at = start.i >= 0 ? start.i : i
    const ex = extractFnAt(buf, at, 600)
    if (ex.body) {
      lines.push(`@${at} sha=${sha(ex.body)} ${ex.body}`)
    } else {
      lines.push(`@${i} ${asciiSlice(buf, i, i + 200)}`)
    }
  }
  lines.push('')
}

writeFileSync(
  new URL('./gold-248-state-dead-fields.txt', import.meta.url),
  lines.join('\n'),
)
console.log('wrote gold-248-state-dead-fields.txt')
