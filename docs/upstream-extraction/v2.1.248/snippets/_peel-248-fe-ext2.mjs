/**
 * Peel official Oe (extensionsConfig) full class + remaining leftover wrappers.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-fe-ext2',
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

const oeHits = allHits(buf, 'class Oe{')
lines.push(`## class Oe{ hits=${oeHits.length} ${oeHits.slice(0, 6).join(',')}`)
for (const i of oeHits.slice(0, 3)) {
  dumpAround(`class Oe @${i}`, i, 0, 2200)
}

dumpAround('Oe-after-tn', 178538860, 0, 2200)

for (const n of [
  'function G$(',
  'function y7e(',
  'function Tde(',
  'function xEe(',
  'function Skn(',
  'function qkn(',
  'function R7e(',
  'function s7e(',
  'function p7(',
  'function Bp(',
  'function Ykn(',
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 3)) {
    const ext = extractFnAt(buf, i, 400)
    lines.push(`@${i} sha=${ext.sha ?? ''} ${ext.body ?? JSON.stringify(ext)}`)
  }
  lines.push('')
}

for (const alias of [
  'G$ as setUseCoworkPlugins',
  'y7e as getUseCoworkPlugins',
  'Tde as setSyncedPluginDirs',
  ' as getSyncedPluginDirs',
  'Skn as setChromeFlagOverride',
  ' as getChromeFlagOverride',
  ' as getAdditionalDirectoriesForClaudeMd',
  ' as setAdditionalDirectoriesForClaudeMd',
  'Bp as getAllowedChannels',
  'p7 as setAllowedChannels',
  's7e as getHasDevChannels',
  'R7e as setHasDevChannels',
]) {
  const hits = allHits(buf, alias)
  lines.push(`## alias ${JSON.stringify(alias)} hits=${hits.length}`)
  if (hits[0] !== undefined) {
    lines.push(asciiSlice(buf, hits[0] - 50, hits[0] + alias.length + 50))
  }
  lines.push('')
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-fe-ext2.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-fe-ext2.txt')
