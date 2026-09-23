/**
 * densable 2.1.251 SEA peel extract4 — lock #20 /status+401, #52 label, #65 dialog, #68 apply.
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

function dumpHits(needle, n = 10, before = 80, after = 200) {
  const hits = allHits(buf, needle)
  console.log(`\n### ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    const fn = lastFnStartGeneric(buf, h, 20000)
    console.log(`  @${h} lastFn=${fn.name}@${fn.i}`)
    console.log('   ', asciiSlice(buf, h - before, h + after).replace(/\n/g, ' ').slice(0, 440))
  }
}

function showFn(label, i, maxLen = 16000) {
  const ex = extractFnAt(buf, i, maxLen)
  console.log(`\n==== ${label} @${i} len=${ex.len} sha=${ex.sha} missEnd=${!!ex.missEnd}`)
  if (ex.body) console.log(ex.body.slice(0, 5000))
  else console.log('PREVIEW', (ex.preview || '').slice(0, 500))
}

function win(label, i, before, after) {
  const t = asciiSlice(buf, i - before, i + after)
  console.log(`\n==== WIN ${label} @${i} len=${t.length} sha=${sha(t)}`)
  console.log(t)
}

// #20 /status + 401
dumpHits('implicit_profile_skipped_stored_login', 4, 80, 200)
dumpHits('Wd()', 12, 60, 160)
dumpHits('Profile........', 4, 40, 80)
dumpHits('name:"status"', 2, 0, 400)
dumpHits('Auth token', 8, 40, 120)
dumpHits('invalidateWif', 4)
dumpHits('lastIssuedWif', 4)
dumpHits('function lt(', 8, 0, 200)
dumpHits('status===401&&Wd', 2)
dumpHits('Wd()&&', 6, 60, 160)
dumpHits('if(Wd()', 8, 40, 180)
dumpHits('gatewayAuth()', 8, 40, 160)
dumpHits('gi()&&Wd', 2)
dumpHits('enterpriseGateway', 8, 60, 180)
dumpHits('Profile', 8, 20, 60)

// #52 densable format
dumpHits('(from plugin ', 8, 80, 200)
dumpHits('from plugin', 8, 60, 180)
dumpHits('plugin:', 12, 40, 120)
dumpHits('startsWith("plugin:")', 6, 80, 200)
dumpHits('MCP_SERVER_LABEL', 2)
dumpHits('from plugin ${', 4, 80, 200)

// #65 focused dialog
dumpHits('lsp-recommendation', 8, 80, 220)
dumpHits('plugin-hint', 8, 80, 220)
dumpHits('fullscreen-upsell', 6, 60, 160)
dumpHits('left-arrow-confirm', 8, 60, 160)
dumpHits('message-selector', 6, 40, 80)
dumpHits('worker-sandbox-permission', 6, 60, 140)

// #68 apply env
win('#68 amn cluster', 183670000, 20, 1800)
win('#68 T set cluster', 181416900, 200, 800)
dumpHits('amn.includes', 4, 80, 200)
dumpHits('mMe.includes', 4, 80, 200)
dumpHits('pn.includes', 6, 80, 200)
dumpHits('projectSettings","localSettings"', 8, 80, 240)
dumpHits('SAFE_WHEN', 4)
dumpHits('isSafeManagedEnv', 2)
dumpHits('LEh', 6, 20, 40)
dumpHits('ANTHROPIC_DEFAULT_SONNET_MODEL', 6, 80, 200)
