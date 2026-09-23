import { readFileSync, writeFileSync } from 'node:fs'

const dumpPath =
  'C:/Users/Administrator/.cursor/projects/d-work-py-claude-claude-code/agent-tools/2c01d282-bb55-44af-afb2-7d2adf6c248b.txt'
const t = readFileSync(dumpPath, 'utf8')
const start = t.indexOf('import type { BetaMessageStreamParams')
if (start < 0) throw new Error('start not found')
let end = t.indexOf('[... omitted', start)
if (end < 0) end = t.length
let body = t.slice(start, end)

// Remove soft-wrap real newlines injected by expect pretty-printer
body = body.replace(/\r\n/g, '').replace(/\n/g, '').replace(/\r/g, '')

// Unescape the embedded string escapes
body = body
  .replace(/\\r\\n/g, '\n')
  .replace(/\\n/g, '\n')
  .replace(/\\r/g, '\n')
  .replace(/\\t/g, '\t')
  .replace(/\\"/g, '"')
  .replace(/\\\\/g, '\\')

// Drop trailing garbage
const lastGood = Math.max(
  body.lastIndexOf('\n}\n'),
  body.lastIndexOf('\n}\r'),
  body.lastIndexOf('\n}'),
)
if (lastGood > 0) body = body.slice(0, lastGood + 2)

writeFileSync('src/bootstrap/state.ts', body)
console.log('restored len', body.length, 'lines', body.split('\n').length)
console.log(
  'switchSession ok',
  /export function switchSession\(\n  sessionId: SessionId/.test(body),
)
console.log(
  'setMeter ok',
  /export function setMeter\(\n  meter: Meter/.test(body),
)
console.log('markRemote', body.includes('markRemote(value)'))
console.log('noteInvalidation', body.includes('noteInvalidation()'))
console.log(
  'foundry init',
  body.includes('foundryDeploymentCapabilities: new Map()'),
)
console.log('type State size', body.indexOf('function getInitialState') - body.indexOf('type State'))
