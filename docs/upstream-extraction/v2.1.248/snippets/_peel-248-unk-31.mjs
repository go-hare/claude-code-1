/**
 * densable 2.1.248 #31 leftover peel — rc-reconnect-prompt
 * Unique 248 reconnect-repaint (permission re-show / last-message flush)
 * vs 247. Invent-ban. No checklist/board.
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = [
  '# gold-248-unk-31',
  `when=${new Date().toISOString()}`,
  `sea248=${EXE_248} bytes=${b248.length}`,
  `sea247=${EXE_247} bytes=${b247.length}`,
  'item=#31 rc-reconnect-prompt',
  'rule=unique 248 body + leftover host, else stay UNKNOWN',
  '',
]

function cnt(buf, n) {
  return allHits(buf, n).length
}

function dumpHits(label, needle, around = 160, cap = 6, minOff = 0) {
  const hits = allHits(b248, needle).filter(i => i >= minOff)
  const c247 = cnt(b247, needle)
  lines.push(
    `## ${label}  needle=${JSON.stringify(needle)}  248=${hits.length} 247=${c247}${c247 === 0 && hits.length ? '  **NEW248**' : ''}`,
  )
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b248, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpNear(buf, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(buf, label, i, maxLen = 12000) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return { miss: true }
  }
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    const other = buf === b248 ? b247 : b248
    const inOther = other.indexOf(Buffer.from(ext.body))
    lines.push(
      `len=${ext.len} sha=${ext.sha} exactOther=${inOther >= 0 ? inOther : 0}`,
    )
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
  return ext
}

function unique248Snippets(win248, win247, minLen = 24) {
  const out = []
  const seen = new Set()
  for (let len = 80; len >= minLen; len -= 8) {
    for (let i = 0; i + len <= win248.length; i += Math.max(4, Math.floor(len / 8))) {
      const s = win248.slice(i, i + len)
      if (s.includes('function ') === false && !/[A-Za-z]{6,}/.test(s)) continue
      if (win247.includes(s)) continue
      const key = s.slice(0, 40)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(s)
      if (out.length >= 12) return out
    }
  }
  return out
}

// leftover host strings that MUST exist in official if leftover is 1:1
const leftoverNeedles = [
  '[bridge:repl] Ingress transport connected',
  'tengu_bridge_repl_ws_connected',
  '[bridge:repl] Capped initial flush',
  '[bridge:repl] Flushing',
  '[bridge:repl] Initial flush dropped',
  '[bridge:repl] Initial flush failed',
  '[remote-bridge] v2 transport connected',
  '[remote-bridge] flushHistory failed',
  '[RemoteSessionManager] Connected',
  '[RemoteSessionManager] Reconnecting',
  '[RemoteSessionManager] Connecting to session',
  'tengu_bridge_reconnected',
  '[bridge:poll] Reconnected after',
  'tengu_pending_action_republished',
  'getPendingPermissionRequests',
  'republishSurvivingPendingAction',
  'pending_permission_requests',
  'pending_user_dialog_requests',
  'tengu_reinit_pending_redelivery',
  'tengu_bridge_repl_history_capped',
  'tengu_bridge_repl_reconnected_in_place',
  'Force-republish',
  'forceNextPublish',
  'shouldPublishTaskState',
  'buildTaskStateMessage',
]

lines.push('# ==== leftover-host needles ====')
for (const n of leftoverNeedles) {
  const a = cnt(b248, n)
  const b = cnt(b247, n)
  lines.push(`- ${JSON.stringify(n)} 248=${a} 247=${b}${a > 0 && b === 0 ? ' **NEW248**' : ''}`)
}
lines.push('')

// extra reconnect-repaint needles
const extra = [
  'afterReconnect',
  'resyncAfterReconnect',
  'replayPermission',
  'replay permission',
  're-show',
  'reshow',
  'reShow',
  'reconnect-repaint',
  'silent reconnect',
  'silently reconnect',
  'latest messages',
  'latest message',
  'last message',
  'flush last',
  'flushLast',
  'republishPending',
  'republishSurviving',
  'pendingPermissionRequests',
  'pending_action',
  'can_use_tool',
  'control_request',
  'writeSdkMessages',
  'writeBatch',
  'initialFlushDone',
  'previouslyFlushed',
  'onConnect',
  'setOnConnect',
  'logReconnected',
  'disconnected_ms',
  'permission prompt',
  'PermissionRequest',
  'undelivered',
  'catchUp',
  'onCatchUpTruncated',
  'from_sequence_num',
  'lastSequenceNum',
  'replay-on-reconnect',
  'redeliver',
  'redelivery',
  're-arm',
  'rearm',
  'reteeWaitingOnUser',
  'notifyStateChanged',
]
lines.push('# ==== extra reconnect/permission needles ====')
for (const n of extra) {
  const a = cnt(b248, n)
  const b = cnt(b247, n)
  if (a !== b || a === 0)
    lines.push(`- ${JSON.stringify(n)} 248=${a} 247=${b}${a > 0 && b === 0 ? ' **NEW248**' : ''}`)
}
lines.push('')

// dump leftover-host windows + enclosing fn + 247 twin + unique snippets
const hostWindows = [
  { n: '[bridge:repl] Ingress transport connected', around: 900 },
  { n: 'tengu_bridge_repl_ws_connected', around: 900 },
  { n: '[bridge:repl] Capped initial flush', around: 700 },
  { n: '[remote-bridge] v2 transport connected', around: 900 },
  { n: '[remote-bridge] flushHistory failed', around: 700 },
  { n: '[RemoteSessionManager] Connected', around: 600 },
  { n: '[RemoteSessionManager] Reconnecting', around: 600 },
  { n: 'tengu_bridge_reconnected', around: 800 },
  { n: '[bridge:poll] Reconnected after', around: 800 },
  { n: 'tengu_pending_action_republished', around: 500 },
  { n: 'getPendingPermissionRequests()', around: 400 },
  { n: 'republishSurvivingPendingAction', around: 400 },
  { n: 'tengu_reinit_pending_redelivery', around: 500 },
  { n: 'pending_permission_requests', around: 400 },
]

lines.push('# ==== leftover-host windows 248 vs 247 ====')
for (const { n, around } of hostWindows) {
  const hits248 = allHits(b248, n).filter(i => i > 170000000)
  const hits247 = allHits(b247, n).filter(i => i > 170000000)
  lines.push(`# -- ${JSON.stringify(n)} code248=${hits248.length} code247=${hits247.length}`)
  for (const [idx, i] of hits248.slice(0, 3).entries()) {
    const win248 = asciiSlice(b248, i - around, i + n.length + around)
    dumpNear(b248, `#31 248 ${n} #${idx}`, i, around, around)
    const st = lastFnStartGeneric(b248, i, 8000)
    lines.push(`- enclosing 248 fn=${st.name} @${st.i}`)
    if (st.i >= 0) dumpFn(b248, `#31 248-fn ${st.name} near ${n}`, st.i, 4000)

    // nearest 247 hit
    let best247 = -1
    let bestDist = Infinity
    for (const j of hits247) {
      // use relative position in file is meaningless; pick first + any with similar window
      if (best247 < 0) best247 = j
    }
    if (hits247[idx] !== undefined) best247 = hits247[idx]
    if (best247 >= 0) {
      const win247 = asciiSlice(b247, best247 - around, best247 + n.length + around)
      dumpNear(b247, `#31 247 ${n} #${idx}`, best247, around, around)
      const uniq = unique248Snippets(win248, win247, 20)
      lines.push(`## unique-in-248-window ${n} #${idx} n=${uniq.length}`)
      for (const s of uniq) lines.push(`- ${s}`)
      lines.push('')
    } else {
      lines.push(`## unique-in-248-window ${n} #${idx} NO 247 twin`)
      lines.push('')
    }
  }
}

// specifically hunt leftover-shaped reconnect else-branch
for (const n of [
  'onStateChange?.("connected")',
  'onStateChange("connected")',
  '.("connected")',
  '("connected")',
  "('connected')",
]) {
  dumpHits(`#31 leftoverish ${n}`, n, 80, 4, 200000000)
}

// hunt permission re-show next to reconnect in same 2k window
lines.push('# ==== permission+reconnect co-occurrence ====')
function nearby(aNeedle, bNeedle, radius = 2500) {
  const aHits = allHits(b248, aNeedle).filter(i => i > 170000000)
  const bHits = allHits(b248, bNeedle).filter(i => i > 170000000)
  let n = 0
  for (const a of aHits) {
    for (const b of bHits) {
      if (Math.abs(a - b) <= radius) {
        n++
        if (n <= 8) {
          lines.push(
            `- 248 ${JSON.stringify(aNeedle)}@${a} ~ ${JSON.stringify(bNeedle)}@${b} d=${a - b}`,
          )
          lines.push(asciiSlice(b248, Math.min(a, b) - 80, Math.max(a, b) + 200))
        }
      }
    }
  }
  const a247 = allHits(b247, aNeedle).filter(i => i > 170000000)
  const b247h = allHits(b247, bNeedle).filter(i => i > 170000000)
  let n247 = 0
  for (const a of a247) {
    for (const b of b247h) if (Math.abs(a - b) <= radius) n247++
  }
  lines.push(`pairs ${JSON.stringify(aNeedle)}~${JSON.stringify(bNeedle)} 248=${n} 247=${n247}`)
  lines.push('')
}

nearby('tengu_bridge_reconnected', 'getPendingPermissionRequests', 8000)
nearby('tengu_bridge_reconnected', 'can_use_tool', 4000)
nearby('tengu_bridge_reconnected', 'pending_permission', 4000)
nearby('tengu_bridge_reconnected', 'republish', 4000)
nearby('tengu_bridge_repl_ws_connected', 'can_use_tool', 4000)
nearby('tengu_bridge_repl_ws_connected', 'pending_permission', 4000)
nearby('tengu_bridge_repl_ws_connected', 'republish', 4000)
nearby('tengu_bridge_repl_ws_connected', 'getPendingPermissionRequests', 8000)
nearby('[bridge:repl] Ingress transport connected', 'can_use_tool', 4000)
nearby('[bridge:repl] Ingress transport connected', 'permission', 2000)
nearby('[RemoteSessionManager] Connected', 'pendingPermission', 3000)
nearby('[RemoteSessionManager] Connected', 'can_use_tool', 3000)
nearby('[RemoteSessionManager] Connected', 'redeliver', 3000)
nearby('logReconnected', 'permission', 3000)
nearby('disconnected_ms', 'permission', 3000)
nearby('afterReconnect', 'can_use_tool', 2000)
nearby('afterReconnect', 'permission', 2000)

// extract official getPendingPermissionRequests method body (class method)
for (const n of [
  'getPendingPermissionRequests(){',
  'republishSurvivingPendingAction(){',
  'getPendingUserDialogRequests(){',
]) {
  dumpHits(`#31 method ${n}`, n, 40, 6, 170000000)
  for (const i of allHits(b248, n).filter(x => x > 170000000).slice(0, 3)) {
    dumpNear(b248, `#31 248 method-win ${n}`, i, 80, 900)
    const i247 = b247.indexOf(Buffer.from(n), 170000000)
    if (i247 > 0) dumpNear(b247, `#31 247 method-win ${n}`, i247, 80, 900)
  }
}

// RemoteSessionManager class-ish: leftover onConnected does NOT re-show
for (const n of [
  '[RemoteSessionManager] Connected',
  '[RemoteSessionManager] Reconnecting WebSocket',
  '[RemoteSessionManager] Permission request for tool',
  'Redelivered dialog',
]) {
  dumpHits(`#31 rsm ${n}`, n, 200, 3, 170000000)
}

// leftover useReplBridge connected-case strings
for (const n of [
  'tengu_bridge_system_init',
  'Failed to send system/init',
  'Failed to publish task_state',
  'Remote Control',
  'PushNotification',
]) {
  const a = cnt(b248, n)
  const b = cnt(b247, n)
  lines.push(`- leftover-useRepl ${JSON.stringify(n)} 248=${a} 247=${b}`)
}

writeFileSync(`${outDir}/gold-248-unk-31.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-unk-31.txt`, 'lines', lines.length)
