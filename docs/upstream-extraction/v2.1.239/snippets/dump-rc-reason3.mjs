import { readFileSync, writeFileSync } from 'node:fs'

const s = readFileSync(
  new URL('./gold-Remote_Control_isn-3.txt', import.meta.url),
  'utf8',
)
const i = s.indexOf('if(!await y$("tengu_ccr_bridge")')
writeFileSync(
  new URL('./gold-rc-gate-false.txt', import.meta.url),
  s.slice(i, i + 800),
)
console.log('i', i)
