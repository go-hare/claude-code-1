/**
 * Audit densable jsu/foo/doo vs tip wiring — dump contracts for review.
 */
import { readFileSync, writeFileSync } from 'fs'

const text = readFileSync(
  `${process.env.TEMP}/official-239/package/claude.exe`,
).toString('latin1')

// 1) Full jsu vM kind list from host
const jsuMatch = text.match(/jsu=\{([^}]{0,4000})\}/)
const jsuBody = jsuMatch?.[1] ?? ''
const vMs = [...jsuBody.matchAll(/vM\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)/g)].map(
  m => `${m[1]}→${m[2]}`,
)
console.log('=== densable jsu arms ===')
console.log(vMs.join('\n'))

// 2) Qg kinds
const qg = [...text.matchAll(/(\$?\w+)=Qg\(\{kind:"([^"]+)"/g)]
console.log('\n=== Qg kinds ===')
for (const m of qg) console.log(`${m[1]}\t${m[2]}`)

// 3) foo structure checkpoints
const foo = text.indexOf('async function foo(e,t)')
const fooSnip = text.slice(foo, foo + 4500)
writeFileSync(
  'docs/upstream-extraction/v2.1.236/snippets/gold-foo-full.txt',
  fooSnip.replace(/[^\x20-\x7e\n]/g, '.'),
)
for (const n of [
  'Fwl(r.tool)',
  'Mno(r.tool)',
  'await Lno',
  'await ISl',
  'dialog:bEt',
  'dialog:S4t',
  'dialog:m.dialog',
  'buildDescriptor',
  'queueBehind:h',
]) {
  console.log('foo has', n, fooSnip.includes(n))
}

// 4) doo checkpoints
const doo = text.slice(text.indexOf('function doo(e,t,r)'), text.indexOf('function doo(e,t,r)') + 3500)
for (const n of [
  'requestDialog',
  'queueBehind:h',
  'buildDescriptor',
  'handleUserAllow',
  'cancelAndAbort',
  'behavior==="allow"',
  'behavior==="deny"',
  'behavior==="cancelled"',
  'agentType==="teammate"',
  'forRemoteExecution',
]) {
  console.log('doo has', n, doo.includes(n))
}

// 5) _Sw Fwl registry matches
const sw = text.indexOf('_Sw=[')
console.log('\n_Sw', text.slice(sw, sw + 1200).replace(/[^\x20-\x7e]/g, '.'))
