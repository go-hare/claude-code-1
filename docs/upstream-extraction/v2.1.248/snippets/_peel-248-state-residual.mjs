/**
 * Peel official 248 residual STATE fields vs n() bags.
 * Fields: promptCache1hEligible, *HeaderLatched, lastMainRequestId,
 * pendingPostCompaction, isRemoteMode, teleportedSessionIds, replBridgeSessionId
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXE =
  process.env.OFFICIAL_248_EXE ??
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const out = join(__dirname, 'gold-248-state-residual.txt')

const buf = readFileSync(EXE)
const text = buf.toString('latin1')

const lines = [
  '# gold-248-state-residual',
  `when=${new Date().toISOString()}`,
  `exe=${EXE}`,
  `bytes=${buf.length}`,
  '',
]

function allHits(needle) {
  const hits = []
  let i = 0
  while (true) {
    const j = text.indexOf(needle, i)
    if (j < 0) break
    hits.push(j)
    i = j + needle.length
  }
  return hits
}

function peelAt(offset, len = 450) {
  const slice = text.slice(offset, offset + len)
  const sha = createHash('sha256').update(slice).digest('hex').slice(0, 16)
  return { slice, sha, len: slice.length }
}

function reportNeedle(needle, max = 10, band = null) {
  let hits = allHits(needle)
  if (band) hits = hits.filter(h => h >= band[0] && h < band[1])
  lines.push(
    `## needle=${JSON.stringify(needle)} hits=${hits.length}${band ? ` band=${band[0]}-${band[1]}` : ''}`,
  )
  for (const h of hits.slice(0, max)) {
    const start = Math.max(0, h - 100)
    const { slice, sha } = peelAt(start, 560)
    lines.push(`@${h} sha=${sha}`)
    lines.push(slice.replace(/\r/g, '\\r').replace(/\n/g, '\\n'))
    lines.push('')
  }
}

const NEEDLES = [
  'promptCache1hEligible',
  'afkModeHeaderLatched',
  'fastModeHeaderLatched',
  'cacheEditingHeaderLatched',
  'clearBetaHeaderLatches',
  'lastMainRequestId',
  'replaceLastMainRequestId',
  'pendingPostCompaction',
  'replacePendingPostCompaction',
  'teleportedSessionIds',
  'replBridgeSessionId',
  'as getIsRemoteMode',
  'as setIsRemoteMode',
  'function On(){',
  'function P4(e){',
  'replaceIsRemoteMode',
  'isRemoteMode()',
  'promptCache1hAllowlist',
  'modelStringsCache',
  'requestLatches',
  'midConvCachePromotionRejected',
]

for (const n of NEEDLES) {
  reportNeedle(n, 8)
}

// Host-window wrappers near @17855xxxx
lines.push('## host-window wrappers band 178550000-178590000')
for (const needle of [
  'lastMainRequestId()',
  'pendingPostCompaction()',
  'promptCache1hEligible',
  'afkModeHeader',
  'fastModeHeader',
  'cacheEditingHeader',
  'teleportedSessionIds',
  'replBridgeSessionId',
  'isRemoteMode()',
  'getIsRemoteMode',
]) {
  reportNeedle(needle, 6, [178550000, 178590000])
}

// Export alias region ~19277xxxx
lines.push('## export-alias band 192770000-192800000')
for (const needle of [
  'getPromptCache1hEligible',
  'setPromptCache1hEligible',
  'getAfkModeHeaderLatched',
  'getFastModeHeaderLatched',
  'getCacheEditingHeaderLatched',
  'clearBetaHeaderLatches',
  'getLastMainRequestId',
  'getIsRemoteMode',
  'setIsRemoteMode',
  'getReplBridgeSessionId',
  'setReplBridgeSessionId',
  'teleportedSessionIds',
]) {
  reportNeedle(needle, 4, [192770000, 192800000])
}

// Class bodies that might hold these
for (const cls of [
  'class qe{',
  'class Ee{',
  'class ce{',
  'class he{',
  'class ge{',
  'class Ie{',
]) {
  const hits = allHits(cls).filter(h => h > 178510000 && h < 178560000)
  lines.push(`## ${cls} @${hits[0] ?? 'MISS'}`)
  if (hits[0]) {
    const { slice, sha } = peelAt(hits[0], 1400)
    lines.push(`sha=${sha}`)
    lines.push(slice)
    lines.push('')
  }
}

writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
