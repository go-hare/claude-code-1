import { readFileSync, writeFileSync } from 'node:fs'

const s = readFileSync('src/bootstrap/state.ts', 'utf8')
const keepState = new Set([
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
])
const keepG = new Set([
  'sessionCronTasks',
  'cachedClaudeMdContent',
  'registeredHooks',
  'mainThreadAgentType',
])
const typeStart = s.indexOf('type State = {')
const typeOpen = s.indexOf('{', typeStart)
let depth = 0
let typeClose = -1
for (let i = typeOpen; i < s.length; i++) {
  if (s[i] === '{') depth++
  else if (s[i] === '}') {
    depth--
    if (depth === 0) {
      typeClose = i
      break
    }
  }
}
const typeBlock = s.slice(typeOpen + 1, typeClose)
const fields = [
  ...new Set(
    [...typeBlock.matchAll(/\n {2}([a-zA-Z_]\w*)\??:/g)]
      .map(m => m[1])
      .filter(Boolean),
  ),
]
const dead = []
const live = []
const gKeep = []
for (const f of fields) {
  if (keepState.has(f)) {
    live.push(`${f} KEEP_STATE`)
    continue
  }
  if (keepG.has(f)) {
    gKeep.push(f)
    continue
  }
  const refs = (s.match(new RegExp(`STATE\\.${f}\\b`, 'g')) || []).length
  if (refs === 0) dead.push(f)
  else live.push(`${f}:${refs}`)
}
const out = [
  '# gold-248-state-dead-audit-now',
  `fields=${fields.length} dead=${dead.length} gKeep=${gKeep.length} live=${live.length}`,
  '',
  '## DEAD candidates (0 STATE.field)',
  ...dead.map(d => `- ${d}`),
  '',
  '## KEEP g() type residual',
  ...gKeep.map(d => `- ${d}`),
  '',
  '## LIVE / KEEP STATE',
  ...live.map(d => `- ${d}`),
  '',
].join('\n')
writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-state-dead-audit-now.txt',
  out,
)
console.log(out)
