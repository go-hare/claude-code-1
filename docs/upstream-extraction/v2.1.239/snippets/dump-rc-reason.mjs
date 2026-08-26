import { readFileSync, writeFileSync } from 'node:fs'

const s = readFileSync(
  new URL('./gold-Remote_Control_isn-2.txt', import.meta.url),
  'utf8',
)
const i = s.indexOf('tengu_ccr_bridge')
writeFileSync(
  new URL('./gold-rc-reason-tail.txt', import.meta.url),
  s.slice(i, i + 1500),
)
console.log('i', i)
