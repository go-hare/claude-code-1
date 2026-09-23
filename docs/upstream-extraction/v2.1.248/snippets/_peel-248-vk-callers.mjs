/**
 * Peel ALL official Vk( call sites for preExitFlush (exclude pricing/React/SQL Vk).
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-vk-callers.txt'
const lines = [
  '# gold-248-vk-callers',
  `# when=${new Date().toISOString()}`,
  '',
]
const b = loadSea(EXE_248)
lines.push(`# SEA248=${b.length}`)
lines.push('')

const vkDef = allHits(b, 'function Vk(e){return L().preExitFlush.register(e)}')
lines.push(
  `## Vk preExitFlush def hits=${vkDef.length} @${vkDef.join(',')}`,
)
lines.push('')

const allVk = allHits(b, 'Vk(')
lines.push(`## all Vk( hits=${allVk.length}`)

const candidates = []
for (const p of allVk) {
  const before = asciiSlice(b, Math.max(0, p - 100), p)
  const after = asciiSlice(b, p, p + 160)
  // skip definition
  if (after.startsWith('Vk(e){return L().preExitFlush')) continue
  // skip other Vk function defs
  if (
    after.startsWith('Vk(e,t){') ||
    after.startsWith('Vk(e,t,n,i)') ||
    after.startsWith('Vk(a,b,c,d,e)')
  )
    continue
  // skip pricing Yee(Vk(e,r)) / Bk
  if (before.includes('Yee(') || before.endsWith('Yee(')) continue
  if (before.includes('function Bk') || after.includes('cache_write_5m'))
    continue
  // skip SQL
  if (after.includes('WITH p AS') || after.includes('unnest')) continue
  // skip React FiberRoot
  if (after.includes('this.tag=') || after.includes('this.containerInfo'))
    continue
  // skip constructor-like `new Vk` if any (needle is Vk() so unlikely)
  candidates.push({ p, before, after })
}

lines.push(`## candidate call sites (filtered) =${candidates.length}`)
for (const c of candidates) {
  lines.push(`### ctx @${c.p}`)
  lines.push(asciiSlice(b, c.p - 220, c.p + 320))
  lines.push('')
}

const regHits = allHits(b, 'preExitFlush.register')
lines.push(`## preExitFlush.register hits=${regHits.length}`)
for (const p of regHits) {
  lines.push(`- @${p} ${asciiSlice(b, p - 120, p + 160)}`)
}
lines.push('')

// Also: return Vk( / Vk(() / Vk(async / Vk(e=> / Vk(()=>
for (const needle of [
  'return Vk(',
  'Vk(()=>',
  'Vk(async',
  'Vk(()=>{',
  'Vk(async ()',
  'Vk(async()',
  ',Vk(',
  ';Vk(',
  ' Vk(',
]) {
  const hits = allHits(b, needle)
  lines.push(`## needle ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const p of hits.slice(0, 30)) {
    const after = asciiSlice(b, p, p + 200)
    if (after.includes('preExitFlush.register')) continue
    if (after.includes('cache_write') || after.includes('WITH p AS')) continue
    if (after.includes('this.tag=')) continue
    lines.push(`- @${p} ${asciiSlice(b, p - 80, p + 220)}`)
  }
  lines.push('')
}

for (const c of candidates) {
  const fn = lastFnStartGeneric(b, c.p + 4, 12000)
  lines.push(`## caller @${c.p} lastFn=${fn.name} start=${fn.i}`)
  const ex = extractFnAt(b, fn.i > 0 ? fn.i : Math.max(0, c.p - 50), 16000)
  if (ex.body) {
    lines.push(`len=${ex.len} sha=${ex.sha}`)
    const body = ex.body
    lines.push(body.length > 6000 ? body.slice(0, 6000) + '\n...[truncated]...' : body)
  } else {
    lines.push('MISS ' + asciiSlice(b, c.p - 500, c.p + 800))
  }
  lines.push('')
}

writeFileSync(out, lines.join('\n'))
console.log('wrote', out)
console.log('candidates', candidates.length, candidates.map(c => c.p))
