/**
 * densable 2.1.251 SEA peel extract5 — finish #20 #52 #65 #68 #28 #11.
 */
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()
if (buf.length !== 217360032) throw new Error(`size ${buf.length}`)

function dumpHits(needle, n = 8, before = 80, after = 220) {
  const hits = allHits(buf, needle)
  console.log(`\n### ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    const fn = lastFnStartGeneric(buf, h, 20000)
    console.log(`  @${h} lastFn=${fn.name}@${fn.i}`)
    console.log('   ', asciiSlice(buf, h - before, h + after).replace(/\n/g, ' ').slice(0, 460))
  }
}

function showFn(label, i, maxLen = 12000) {
  const ex = extractFnAt(buf, i, maxLen)
  console.log(`\n==== ${label} @${i} len=${ex.len} sha=${ex.sha} missEnd=${!!ex.missEnd}`)
  if (ex.body) console.log(ex.body.slice(0, 4500))
  else console.log('PREVIEW', (ex.preview || '').slice(0, 500))
}

function win(label, i, before, after) {
  const t = asciiSlice(buf, i - before, i + after)
  console.log(`\n==== WIN ${label} @${i} len=${t.length} sha=${sha(t)}`)
  console.log(t)
}

// #68 N()
dumpHits('project-scoped settings can\'t set this key', 3, 200, 400)
dumpHits('function N(t,s,e)', 4, 0, 700)
win('#68 N apply', 181417247, 80, 900)

// #20 status + 401
showFn('#20 odn', 185309279, 1200)
showFn('#20 Nl', 181225942, 600)
showFn('#20 IN warn', 181223104, 500)
dumpHits('source:"profile"', 8, 60, 160)
dumpHits('Login method', 6, 60, 200)
dumpHits('tokenSource', 8, 60, 180)
dumpHits('Auth token', 4, 80, 200)
dumpHits('gi()&&', 6, 40, 120)
dumpHits('gateway sessions', 4)
dumpHits('Claude apps gateway', 4)

// #52
dumpHits('(from plugin ', 8, 80, 240)
dumpHits('from plugin', 8, 80, 200)
dumpHits('startsWith("plugin:")', 8, 80, 240)
dumpHits(' (from plugin ', 6, 80, 200)

// #65
dumpHits('lspRecommendation', 8, 60, 180)
dumpHits('hintRecommendation', 8, 60, 180)
dumpHits('plugin-hint', 4)
dumpHits('lsp-recommendation', 4)
dumpHits('Install the frontend-design', 4, 80, 200)
dumpHits('frontend-design plugin', 6, 80, 200)
dumpHits('auto_default_nudge', 8, 80, 220)
dumpHits('shouldShowAutoDefaultNudge', 6, 80, 240)
dumpHits('function T9t', 3, 0, 800)
dumpHits('function #r', 4, 0, 200)
dumpHits('isPromptInputActive:Vct', 3, 80, 200)
dumpHits('Vct&&', 8, 60, 160)

// #28 Al + copy path
dumpHits('function Al(', 6, 0, 300)
showFn('#28 h tmux args', 183538592, 300)
showFn('#28 p ssh', 183538542, 80)
dumpHits('copySelectionNoClear', 6, 80, 240)

// #11 empty strip
dumpHits('empty_text_block', 4, 40, 80)
dumpHits('type==="text"&&Li.text.trim()', 4, 80, 160)
dumpHits('thinkingOnlyNudged:!0', 2, 200, 200)
dumpHits('function lrt(', 4, 0, 200)
dumpHits('function Co(Cn)', 2)
dumpHits('!Co(Cn)', 4, 40, 80)

// #43 ie + rt window
showFn('#43 ie', 190733145, 200)
win('#43 rt org_record', 190744900, 40, 500)
showFn('#43 fEt', 179882778, 120)
showFn('#43 c5', 179882395, 200)

// #15 mcn + XVt
win('#15 XVt', 184330300, 200, 200)
showFn('#15 mcn', 184330403, 80)
