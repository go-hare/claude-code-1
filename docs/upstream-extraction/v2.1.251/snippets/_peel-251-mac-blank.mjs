/**
 * densable 2.1.251 — Mac blank / wrap-stream / darwin bullet width peel.
 */
import {
  loadSea,
  allHits,
  asciiSlice,
  extractFnAt,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()
console.log('size', buf.length)

const needles = [
  'wrap-stream',
  '\\u23FA',
  '\u23FA',
  'ambiguousIsNarrow',
  'hideTrailingLine',
  'needsWidthCompensation',
  '=="macos"',
  '==="macos"',
  'Wt()==="macos"',
]

for (const n of needles) {
  const hits = allHits(buf, n)
  console.log(JSON.stringify(n), 'hits', hits.length, hits.slice(0, 12).join(','))
}

function dumpAround(label, needle, before = 400, after = 800, max = 3) {
  const hits = allHits(buf, needle)
  console.log('\n====', label, 'hits', hits.length)
  for (const h of hits.slice(0, max)) {
    console.log('--- @', h)
    console.log(asciiSlice(buf, h - before, h + after))
  }
}

dumpAround('wrap-stream', 'wrap-stream', 200, 600, 6)
dumpAround('u23FA-escape', '\\u23FA', 300, 400, 4)
dumpAround('literal-23FA', '\u23FA', 300, 400, 4)
dumpAround('ambiguousIsNarrow', 'ambiguousIsNarrow', 200, 500, 3)
dumpAround('hideTrailingLine', 'hideTrailingLine', 200, 500, 4)

// Find function that pops last wrap-stream line (dtd style)
const popNeedles = [
  's.pop(),a.pop()',
  '.pop(),',
  '==="wrap-stream"',
  '=="wrap-stream"',
]
for (const n of popNeedles) {
  const hits = allHits(buf, n)
  console.log('\nPOP', JSON.stringify(n), 'hits', hits.length)
  for (const h of hits.slice(0, 5)) {
    const back = asciiSlice(buf, Math.max(0, h - 800), h + 200)
    const fn = back.lastIndexOf('function ')
    console.log('  @', h, 'fnDist', fn >= 0 ? 800 - fn : -1)
    if (fn >= 0) {
      const nameStart = Math.max(0, h - 800) + fn
      const ext = extractFnAt(buf, nameStart, 8000)
      if (!ext.miss && ext.body) {
        console.log(
          '  FN',
          ext.name,
          'len',
          ext.body.length,
          'sha',
          sha(ext.body),
        )
        console.log(ext.body.slice(0, 1200))
      } else {
        console.log(back.slice(Math.max(0, fn - 20), fn + 300))
      }
    } else {
      console.log(asciiSlice(buf, h - 200, h + 200))
    }
  }
}
