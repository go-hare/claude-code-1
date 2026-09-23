import { readFileSync } from 'fs'

const src = readFileSync('src/bootstrap/state.ts', 'utf8')
const typeMatch = src.match(/type State = \{([\s\S]*?)\n\}/)
const body = typeMatch[1]
const fields = []
for (const line of body.split('\n')) {
  const m = line.match(/^\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[?:]/)
  if (m) fields.push(m[1])
}

// nested false-positives inside inline object types
const nestedNoise = new Set([
  'fallbackModel',
  'previousOverride',
  'previousAppStateModel',
  'previousModelForSession',
  'skillName',
  'skillPath',
  'content',
  'invokedAt',
  'agentId',
])

const keepG = new Set([
  'sessionCronTasks',
  'cachedClaudeMdContent',
  'registeredHooks',
  'mainThreadAgentType',
])
const keepState = new Set([
  'kairosActive',
  'afkModeHeaderLatched',
  'fastModeHeaderLatched',
  'cacheEditingHeaderLatched',
  'promptCache1hEligible',
  'teleportedSessionIds',
  'replBridgeSessionId',
  'turnHookDurationMs',
  'turnToolDurationMs',
  'turnClassifierDurationMs',
  'turnToolCount',
  'turnHookCount',
  'turnClassifierCount',
  'pinnedFeatureValues',
  'claudeInChromeSessionPromptActive',
])

function bagHint(field) {
  const fnRe = /export function \w+[^{]*\{[\s\S]*?\n\}/g
  const hits = []
  for (const m of src.matchAll(fnRe)) {
    const fn = m[0]
    // field appears as string in bag call, or camelCase method containing it
    if (!fn.includes(field)) continue
    for (const b of fn.matchAll(
      /getBootstrapSession(?:Host)?\(\)\.([\w.]+)/g,
    )) {
      hits.push(b[1])
    }
  }
  return [...new Set(hits)].slice(0, 5)
}

const dead = []
const live = []
for (const f of fields) {
  if (nestedNoise.has(f)) continue
  const re = new RegExp(`STATE\\.${f}\\b`, 'g')
  const n = [...src.matchAll(re)].length
  if (n === 0) dead.push(f)
  else live.push(f)
}

console.log('LIVE', live.length, live.join(','))
console.log('DEAD_TOPLEVEL', dead.length)
for (const f of dead) {
  let tag = 'CUT?'
  if (keepG.has(f)) tag = 'KEEP_G'
  if (keepState.has(f)) tag = 'KEEP_STATE'
  const bags = bagHint(f).join('|') || '?'
  console.log(`${tag}\t${f}\t${bags}`)
}
