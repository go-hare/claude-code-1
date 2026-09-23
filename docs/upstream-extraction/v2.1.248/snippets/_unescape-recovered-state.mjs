import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/_recovered-state.ts.txt',
  'utf8',
)

let body = src
  .replace(/\\r\\n/g, '\n')
  .replace(/\\n/g, '\n')
  .replace(/\\r/g, '\n')
  .replace(/\\t/g, '\t')
  .replace(/\\"/g, '"')
  .replace(/\\\\/g, '\\')

if (body.includes('[... omitted')) {
  body = body.slice(0, body.indexOf('[... omitted'))
}

writeFileSync('src/bootstrap/state.recovered.ts', body)
console.log('len', body.length, 'lines', body.split('\n').length)
const i = body.indexOf('export function switchSession')
console.log(body.slice(i, i + 350))
console.log('---')
const j = body.indexOf('export function setMeter')
console.log(body.slice(j, j + 280))
console.log('markRemote', body.includes('markRemote(value)'))
console.log('type State = ', body.includes('type State = {'))
