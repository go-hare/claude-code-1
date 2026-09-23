/**
 * Dump unique 248 #9 / #23 bodies into gold-248-unk-*.txt
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_247,
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const buf = loadSea(EXE_248)
const buf247 = loadSea(EXE_247)

function hit(needle, which = buf) {
  return allHits(which, needle)
}

function dumpFn(label, needle) {
  const hits = hit(needle)
  const i = hits[0]
  const ex = extractFnAt(buf, i)
  return { label, i, hits: hits.length, ...ex }
}

const nan = dumpFn('#9 NAn', 'function NAn(){return zce(FAn,!0)}')
const zce = dumpFn(
  '#9 zce',
  'function zce(e,t){let r=rl().pinnedFeatureValues??=new Map',
)
const ivt = dumpFn(
  '#9 Ivt',
  'function Ivt(e,{agentCacheTtlOverride:t,ignoreOverage:r=!1}={})',
)
const b1 = dumpFn('#9 B1', 'function B1(e,t){return Ivt(e,t).ttl==="1h"}')
const bt = dumpFn('#23 _bt', 'function _bt(e){return e?.pluginSource!==void 0}')
const ebn = dumpFn(
  '#23 ebn',
  'function ebn(e){if(e.type!=="claudeai-proxy")return!1',
)

const promptHits = hit(
  'async prompt(){let e=NAn(),t=B1("repl_main_thread",{ignoreOverage:e})',
)
const prompt247 = hit(
  'async prompt(){let e=PR("repl_main_thread"),t=PR("sdk")',
  buf247,
)
const ignore248 = hit('ignoreOverage').length
const ignore247 = hit('ignoreOverage', buf247).length
const slate248 = hit('tengu_slate_anchor').length
const slate247 = hit('tengu_slate_anchor', buf247).length

const gold9 = `# gold-248-unk-9-slate  densable 2.1.248 #9
# wakeup-resume-cache — unique Ivt/B1 ignoreOverage + NAn/zce tengu_slate_anchor
# SEA 226708128 · 247 present

ignoreOverage 248=${ignore248} 247=${ignore247}
tengu_slate_anchor 248=${slate248} 247=${slate247}

## NAn @${nan.i} len=${nan.len} sha=${nan.sha} hits=${nan.hits}
${nan.body}

## zce @${zce.i} len=${zce.len} sha=${zce.sha} hits=${zce.hits}
${zce.body}

## Ivt @${ivt.i} len=${ivt.len} sha=${ivt.sha} hits=${ivt.hits}
${ivt.body}

## B1 @${b1.i} len=${b1.len} sha=${b1.sha} hits=${b1.hits}
${b1.body}

## prompt() 248 @${promptHits[0]}
${asciiSlice(buf, promptHits[0], promptHits[0] + 180)}

## 247 prompt() hits=${prompt247.length} @${prompt247[0] ?? -1}
${prompt247[0] != null ? asciiSlice(buf247, prompt247[0], prompt247[0] + 140) : 'MISS'}
`

const gold23 = `# gold-248-unk-23-ebn  densable 2.1.248 #23
# mcp-fake-claude-ai — unique ebn/_bt heading/scope split (no new heading)

## _bt @${bt.i} len=${bt.len} sha=${bt.sha} hits=${bt.hits}
${bt.body}

## ebn @${ebn.i} len=${ebn.len} sha=${ebn.sha} hits=${ebn.hits}
${ebn.body}

## ebn( 248=${hit('ebn(').length} 247=${hit('ebn(', buf247).length}
## scope==="claudeai"|| 248=${hit('scope==="claudeai"||').length} 247=${hit('scope==="claudeai"||', buf247).length}
`

writeFileSync(join(here, 'gold-248-unk-9-slate.txt'), gold9)
writeFileSync(join(here, 'gold-248-unk-23-ebn.txt'), gold23)
console.log('wrote gold-248-unk-9-slate.txt gold-248-unk-23-ebn.txt')
console.log({ nan: nan.i, zce: zce.i, ivt: ivt.i, b1: b1.i, bt: bt.i, ebn: ebn.i })
