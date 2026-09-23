/**
 * Cut remaining dead State type+init fields (0 STATE.field refs).
 * KEEP STATE live + KEEP g() type residuals listed below.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/bootstrap/state.ts'
let s = readFileSync(path, 'utf8')

const keep = new Set([
  // KEEP STATE live
  'kairosActive',
  'promptCache1hEligible',
  'afkModeHeaderLatched',
  'fastModeHeaderLatched',
  'cacheEditingHeaderLatched',
  'teleportedSessionIds',
  'replBridgeSessionId',
  'turnHookDurationMs',
  'turnToolDurationMs',
  'turnClassifierDurationMs',
  'turnToolCount',
  'turnHookCount',
  'turnClassifierCount',
  'claudeInChromeSessionPromptActive',
  'pinnedFeatureValues',
  // KEEP g() type residual (official dual-path; leftover no g())
  'sessionCronTasks',
  'cachedClaudeMdContent',
  'registeredHooks',
  'mainThreadAgentType',
])

function matchingBrace(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const typeStart = s.indexOf('type State = {')
const typeOpen = s.indexOf('{', typeStart)
const typeClose = matchingBrace(s, typeOpen)
const typeBlock = s.slice(typeOpen + 1, typeClose)

const fields = [
  ...new Set(
    [...typeBlock.matchAll(/\n {2}([a-zA-Z_]\w*)\??:/g)]
      .map(m => m[1])
      .filter(Boolean),
  ),
]

const dead = []
for (const f of fields) {
  if (keep.has(f)) continue
  const refs = (s.match(new RegExp(`STATE\\.${f}\\b`, 'g')) || []).length
  if (refs === 0) dead.push(f)
}

console.log('will cut', dead.length, 'fields')

function stripTypeField(src, field) {
  // From optional preceding comments to next field or close of type
  const re = new RegExp(
    `(?:\\r?\\n(?: {2}\\/\\/[^\\r\\n]*| {2}\\/\\*[\\s\\S]*?\\*\\/))*\\r?\\n {2}${field}\\??:[\\s\\S]*?(?=\\r?\\n {2}[a-zA-Z_]|\\r?\\n})`,
    'g',
  )
  return src.replace(re, '')
}

function stripInitField(src, field) {
  const re = new RegExp(
    `(?:\\r?\\n(?: {4}\\/\\/[^\\r\\n]*| {4}\\/\\*[\\s\\S]*?\\*\\/))*\\r?\\n {4}${field}:[\\s\\S]*?(?=\\r?\\n {4}[a-zA-Z_]|\\r?\\n {2}\\})`,
    'g',
  )
  return src.replace(re, '')
}

let next = s
for (const f of dead) {
  const a = stripTypeField(next, f)
  const b = stripInitField(a, f)
  if (a === next && b === next) console.log('NO MATCH', f)
  next = b
}

writeFileSync(path, next)

const after = readFileSync(path, 'utf8')
const still = dead.filter(
  f =>
    new RegExp(`\\n {2}${f}\\??:`).test(after) ||
    new RegExp(`\\n {4}${f}:`).test(after),
)
console.log('still present', still.length, still.join(','))

// recount
const typeOpen2 = after.indexOf('{', after.indexOf('type State = {'))
const typeClose2 = matchingBrace(after, typeOpen2)
const typeBlock2 = after.slice(typeOpen2 + 1, typeClose2)
const fields2 = [
  ...new Set(
    [...typeBlock2.matchAll(/\n {2}([a-zA-Z_]\w*)\??:/g)]
      .map(m => m[1])
      .filter(Boolean),
  ),
]
console.log('type fields after', fields2.length, fields2.join(','))
