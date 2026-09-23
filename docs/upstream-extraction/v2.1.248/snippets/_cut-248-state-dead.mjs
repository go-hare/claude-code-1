/**
 * Cut dead STATE type+init fields (0 STATE.field refs) from state.ts.
 * KEEP residuals stay.
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
  // still have STATE refs:
  'turnHookDurationMs',
  'turnToolDurationMs',
  'turnClassifierDurationMs',
  'turnToolCount',
  'turnHookCount',
  'turnClassifierCount',
  'claudeInChromeSessionPromptActive',
  'pinnedFeatureValues',
  // pending* may be live elsewhere — recompute dead from current file
])

const typeStart = s.indexOf('type State = {')
const typeEnd = s.indexOf('\n}', typeStart) // first close at indent 0 after type? fragile
// Find matching brace for type State
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

console.log('cutting', dead.length, 'dead fields')

function stripFieldFromObjectLiteral(src, field) {
  // Remove comment lines immediately above + field line(s) until next top-level field or close
  // Match: optional /** ... */ or // comments, then `  field:` ... until next `\n  word:` or `\n}`
  const re = new RegExp(
    `(?:\\n(?: {2}\\/\\/[^\n]*| {2}\\/\\*[\\s\\S]*?\\*\\/))*\\n {2}${field}\\??:[\\s\\S]*?(?=\\n {2}[a-zA-Z_]|\\n})`,
    'g',
  )
  return src.replace(re, '')
}

let next = s
for (const f of dead) {
  next = stripFieldFromObjectLiteral(next, f)
}

// Also strip from getInitialState return — same pattern of `    field:`
function stripInitField(src, field) {
  const re = new RegExp(
    `(?:\\n(?: {4}\\/\\/[^\n]*| {4}\\/\\*[\\s\\S]*?\\*\\/))*\\n {4}${field}:[\\s\\S]*?(?=\\n {4}[a-zA-Z_]|\\n {2}\\})`,
    'g',
  )
  return src.replace(re, '')
}

for (const f of dead) {
  next = stripInitField(next, f)
}

writeFileSync(path, next)

// verify
const after = readFileSync(path, 'utf8')
const still = dead.filter(f => {
  const typeHas = new RegExp(`\\n {2}${f}\\??:`).test(after)
  const initHas = new RegExp(`\\n {4}${f}:`).test(after)
  return typeHas || initHas
})
console.log('still present after cut:', still.length, still.slice(0, 20))
console.log('STATE.sdkDialogHostActive', after.includes('STATE.sdkDialogHostActive'))
console.log('STATE.invokedSkills', after.includes('STATE.invokedSkills'))
