/**
 * Find official T/Zs/ve/Wa/an imports on the _G/gKt chunk.
 */
import { writeFileSync } from 'fs'
import { EXE_248, loadSea, asciiSlice, allHits, extractFnAt } from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const out = [`when=${new Date().toISOString()}`]

const gkt = allHits(b, 'function gKt(){let e=Zs(),t=ve();if(e&&T(e)===Wa(t))return t;return an()}')
out.push(`gkt=${gkt}`)

// Walk back to nearest import{ of this bun chunk
const i = gkt[0] ?? -1
if (i > 0) {
  const win = asciiSlice(b, Math.max(0, i - 8000), i)
  const lastImport = win.lastIndexOf('import{')
  out.push('\n## _G chunk lookback imports')
  out.push(win.slice(Math.max(0, lastImport), win.length).slice(-2500))
}

// dirname as T / basename as T near session paths
for (const needle of [
  'import{dirname as T}',
  'import{dirname as T,',
  'dirname as T}',
  'dirname as T,',
  'function T(e){return u(e)}',
  'function T(e){return dirname(e)}',
  'function T(e){return e.replace',
]) {
  const hits = allHits(b, needle)
  out.push(`\n## ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, 4)) {
    out.push(`- @${h} ${asciiSlice(b, h - 60, h + 180).replace(/\n/g, ' ')}`)
  }
}

// Wa(ve) / Wa(t) project-dir
const waVe = allHits(b, 'function Wa(t){let e=g.of(z().host)')
out.push(`\n## Wa projectDir hits=${waVe}`)
if (waVe[0]) {
  out.push(asciiSlice(b, waVe[0] - 200, waVe[0] + 500))
}

// T used as dirname of sessionFile: look for T(Zs or T(e)===Wa nearby other call sites
const teWa = allHits(b, 'T(e)===Wa')
out.push(`\n## T(e)===Wa hits=${teWa}`)

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-gkt-T-import.txt',
  out.join('\n'),
)
console.log('wrote', out.length)
