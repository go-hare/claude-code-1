/**
 * SAFE cut: only strip dead fields inside `type State = { ... }` and
 * `const state: State = { ... }` object literals. Never touch function params.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/bootstrap/state.ts'
let s = readFileSync(path, 'utf8')

const keep = new Set([
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

function stripFieldsInRange(src, start, end, indent) {
  let block = src.slice(start, end)
  const fields = [
    ...new Set(
      [...block.matchAll(new RegExp(`\\n {${indent}}([a-zA-Z_]\\w*)\\??:`, 'g'))]
        .map(m => m[1])
        .filter(Boolean),
    ),
  ]
  const dead = []
  for (const f of fields) {
    if (keep.has(f)) continue
    const refs = (src.match(new RegExp(`STATE\\.${f}\\b`, 'g')) || []).length
    if (refs === 0) dead.push(f)
  }
  for (const f of dead) {
    const re = new RegExp(
      `(?:\\r?\\n(?: {${indent}}\\/\\/[^\\r\\n]*| {${indent}}\\/\\*[\\s\\S]*?\\*\\/))*\\r?\\n {${indent}}${f}\\??:[\\s\\S]*?(?=\\r?\\n {${indent}}[a-zA-Z_]|\\r?\\n {${indent - 2}}\\})`,
      'g',
    )
    block = block.replace(re, '')
  }
  return { text: src.slice(0, start) + block + src.slice(end), dead }
}

// type State
const typeStart = s.indexOf('type State = {')
const typeOpen = s.indexOf('{', typeStart)
const typeClose = matchingBrace(s, typeOpen)
let r1 = stripFieldsInRange(s, typeOpen + 1, typeClose, 2)
s = r1.text
console.log('type cut', r1.dead.length)

// re-find after mutation
const typeStart2 = s.indexOf('type State = {')
const typeOpen2 = s.indexOf('{', typeStart2)
const typeClose2 = matchingBrace(s, typeOpen2)

// init object: `const state: State = {`
const initMarker = s.indexOf('const state: State = {')
const initOpen = s.indexOf('{', initMarker)
const initClose = matchingBrace(s, initOpen)
let r2 = stripFieldsInRange(s, initOpen + 1, initClose, 4)
s = r2.text
console.log('init cut', r2.dead.length)

writeFileSync(path, s)

// verify switchSession / setMeter intact
const ok =
  /export function switchSession\(\r?\n  sessionId: SessionId/.test(s) &&
  /export function setMeter\(\r?\n  meter: Meter/.test(s)
console.log('signatures ok', ok)

const typeOpen3 = s.indexOf('{', s.indexOf('type State = {'))
const typeClose3 = matchingBrace(s, typeOpen3)
const typeBlock = s.slice(typeOpen3 + 1, typeClose3)
const remain = [
  ...new Set(
    [...typeBlock.matchAll(/\n {2}([a-zA-Z_]\w*)\??:/g)]
      .map(m => m[1])
      .filter(Boolean),
  ),
]
console.log('remain', remain.length, remain.join(','))
