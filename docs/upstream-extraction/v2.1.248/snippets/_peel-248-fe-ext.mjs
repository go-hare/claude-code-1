/**
 * Peel official Fe / settingsSource + extensionsConfig class + leftover wrappers.
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
  '# gold-248-fe-ext',
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

dumpAround('Fe-178537988', 178537988, 20, 1800)

for (const n of [
  'class Fe{',
  'function tn(',
  'function xL(',
  'function XEn(',
  'function x2(',
  'function AEe(',
  'function ZEn(',
  'function ekn(',
  'function kde(',
  'function mkn(',
  'function C4(',
  'function m7e(',
  'function R4(',
  'function h7e(',
  'function hkn(',
  'function Vne(',
  'extensionsConfig.',
]) {
  const hits = allHits(buf, n)
  lines.push(`## needle ${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 4)) {
    if (n.startsWith('function ') || n.startsWith('class ')) {
      const ext = extractFnAt(buf, i, 2200)
      lines.push(`@${i} sha=${ext.sha ?? ''} ${ext.body ?? JSON.stringify(ext)}`)
    } else {
      lines.push(`@${i}`)
      lines.push(asciiSlice(buf, i - 80, i + n.length + 220))
    }
  }
  lines.push('')
}

for (const alias of [
  'xL as getFlagSettingsPath',
  'XEn as setFlagSettingsPath',
  'x2 as getFlagSettingsInline',
  'AEe as setFlagSettingsInline',
  'ZEn as getParentManagedSettings',
  'ekn as setParentManagedSettings',
  'kde as getAllowedSettingSources',
  'mkn as setAllowedSettingSources',
  'C4 as getInlinePlugins',
  'm7e as setInlinePlugins',
  'R4 as getInlinePluginsNoMcp',
  'h7e as setInlinePluginsNoMcp',
  'Vne as getInlinePluginUrls',
  'hkn as setInlinePluginUrls',
]) {
  const hits = allHits(buf, alias)
  lines.push(`## alias ${JSON.stringify(alias)} hits=${hits.length}`)
  if (hits[0] !== undefined) {
    lines.push(asciiSlice(buf, hits[0] - 40, hits[0] + alias.length + 40))
  }
  lines.push('')
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-fe-ext.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-fe-ext.txt')
