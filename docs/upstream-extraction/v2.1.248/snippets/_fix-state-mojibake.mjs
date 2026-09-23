import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('src/bootstrap/state.ts', 'utf8')

// Mojibake replacements for em-dash / special punctuation from dump restore
const reps = [
  [/\uFFFD\?/g, ' - '],
  [/stickyBetas\s+\S+\s+LAND cut/g, 'stickyBetas - LAND cut'],
  [/lastInteractionTime\s+\S+\s+LAND cut/g, 'lastInteractionTime - LAND cut'],
  [/mainLoopBusy\s+\S+\s+LAND cut/g, 'mainLoopBusy - LAND cut'],
  [/teleportedSessionInfo\s+\S+\s+LAND cut/g, 'teleportedSessionInfo - LAND cut'],
  [/KEEP STATE\s+\S+\s+official/g, 'KEEP STATE - official'],
  [/KEEP STATE\s+\S+\s+SEA/g, 'KEEP STATE - SEA'],
  [/has no g\(\)\s+\S+\s+bag only/g, 'has no g() - bag only'],
  [/modelUsage\s+\S+\s+LAND cut/g, 'modelUsage - LAND cut'],
  [/loopConsecutiveKeepalives\s+\S+\s+LAND cut/g, 'loopConsecutiveKeepalives - LAND cut'],
  [/foundryDeploymentCapabilities\s+\S+\s+LAND cut/g, 'foundryDeploymentCapabilities - LAND cut'],
  [/mainThreadAgentHooks\s+\S+\s+LAND cut/g, 'mainThreadAgentHooks - LAND cut'],
  [/replBridgeActive\s+\S+\s+LAND cut/g, 'replBridgeActive - LAND cut'],
  [/midConvCachePromotionRejected\s+\S+\s+LAND cut/g, 'midConvCachePromotionRejected - LAND cut'],
  [/directConnectServerUrl\s+\S+\s+LAND cut/g, 'directConnectServerUrl - LAND cut'],
  [/promptCache1hAllowlist\s+\S+\s+LAND cut/g, 'promptCache1hAllowlist - LAND cut'],
  [/via al\/vh\/Gm\/\S+\s*@/g, 'via al/vh/Gm @'],
]

for (const [re, to] of reps) s = s.replace(re, to)

writeFileSync('src/bootstrap/state.ts', s)

const sticky = s.match(/stickyBetas.{0,30}LAND cut/)
console.log('sticky', sticky && sticky[0])
console.log(
  'tests needles',
  /stickyBetas\s+[—-]\s+LAND cut/.test(s) || /stickyBetas - LAND cut/.test(s),
  s.includes('lastInteractionTime - LAND cut'),
  s.includes('mainLoopBusy - LAND cut'),
  s.includes('teleportedSessionInfo - LAND cut'),
  s.includes('totalCostUSD / totalAPIDuration'),
  /KEEP STATE - SEA/.test(s) || /KEEP STATE — SEA/.test(s),
  /KEEP STATE - official `Qo/.test(s) || s.includes('KEEP STATE - official `Qo'),
)
