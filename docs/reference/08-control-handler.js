async function JmO(H, _, q, K, O, T, z, $, Y, A, w) {
  let j
  try {
    j = B_(A)
  } catch {
    return NT(Y, { ok: !1, error: 'bad json', code: 'EUNKNOWN' })
  }
  if (j === null || typeof j !== 'object')
    return NT(Y, { ok: !1, error: 'bad json', code: 'EUNKNOWN' })
  let J = j.op
  if (J === 'ping')
    return NT(Y, {
      ok: !0,
      op: 'ping',
      version: {
        ISSUES_EXPLAINER:
          'report the issue at https://github.com/anthropics/claude-code/issues',
        PACKAGE_URL: '@anthropic-ai/claude-code',
        README_URL: 'https://code.claude.com/docs/en/overview',
        VERSION: '2.1.153',
        FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
        BUILD_TIME: '2026-05-27T20:03:21Z',
        GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
      }.VERSION,
      proto: P5,
    })
  if (J === 'nudge')
    return NT(Y, {
      ok: !0,
      op: 'nudge',
      restarting: await q(),
      version: {
        ISSUES_EXPLAINER:
          'report the issue at https://github.com/anthropics/claude-code/issues',
        PACKAGE_URL: '@anthropic-ai/claude-code',
        README_URL: 'https://code.claude.com/docs/en/overview',
        VERSION: '2.1.153',
        FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
        BUILD_TIME: '2026-05-27T20:03:21Z',
        GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
      }.VERSION,
    })
  if (J === 'yield') return NT(Y, { ok: !0, op: 'yield', yielding: T() })
  if (J === 'lease') {
    z(Y, MmO(j.client)),
      Y.write(
        CH({ ok: !0, op: 'lease' }) +
          `
`,
      )
    return
  }
  if (J === 'leases') return NT(Y, { ok: !0, op: 'leases', clients: $() })
  if (J === 'shutdown') {
    let X = j.reapWorkers !== !1,
      P = K(X)
    return NT(Y, { ok: !0, op: 'shutdown', reaped: P })
  }
  if (!O())
    return NT(Y, {
      ok: !1,
      error: `${QA()} starting (adoption in progress)`,
      code: 'ESTARTING',
    })
  let M = j.proto
  if (typeof M !== 'number' || !Number.isInteger(M) || M < CV_ || M > P5)
    return (
      c('tengu_bg_proto_mismatch', {
        client_proto: typeof M === 'number' ? M : -1,
        server_proto: P5,
      }),
      NT(Y, {
        ok: !1,
        error: `proto mismatch (server=${P5}, client=${M}) \u2014 ${QA()} and CLI versions differ; restart claude`,
        code: 'EPROTO',
        serverProto: P5,
        serverVersion: {
          ISSUES_EXPLAINER:
            'report the issue at https://github.com/anthropics/claude-code/issues',
          PACKAGE_URL: '@anthropic-ai/claude-code',
          README_URL: 'https://code.claude.com/docs/en/overview',
          VERSION: '2.1.153',
          FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
          BUILD_TIME: '2026-05-27T20:03:21Z',
          GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
        }.VERSION,
      })
    )
  let D = dLK().safeParse(j)
  if (!D.success)
    return NT(Y, {
      ok: !1,
      error: `malformed request: ${D.error.issues[0]?.message ?? 'invalid'}`,
      code: 'EUNKNOWN',
    })
  let f = D.data
  switch (f.op) {
    case 'ping':
    case 'nudge':
    case 'yield':
    case 'lease':
    case 'leases':
    case 'shutdown':
      return
    case 'list':
      return NT(Y, {
        ok: !0,
        op: 'list',
        jobs: Array.from(H.values()).map(X =>
          X.isKilling || X.isRetiring ? { ...X.record, dying: !0 } : X.record,
        ),
      })
    case 'has': {
      let X = H.get(f.short)
      return NT(Y, {
        ok: !0,
        op: 'has',
        alive: X !== void 0 && P3q(X),
        present: X !== void 0,
      })
    }
    case 'await-ack':
      return yG4(H, Y, 'await-ack', f.short, f.nonce, f.timeoutMs)
    case 'dispatch':
      if ((await r6(0), Y.readableEnded || Y.destroyed)) {
        c('tengu_bg_dispatch_stale_drop', {})
        return
      }
      return _(f.d), yG4(H, Y, 'dispatch', f.d.short, f.d.nonce, f.timeoutMs)
    case 'reply': {
      let X = H.get(f.short)
      if (!X || X.isRetiring || X.isKilling || X.record.outcome)
        return NT(Y, {
          ok: !1,
          error: 'job not found \u2014 it may have already exited',
          code: 'ENOJOB',
        })
      if (!(await X.reply(f.text)))
        return NT(Y, {
          ok: !1,
          error:
            "job isn't accepting replies \u2014 it may be in a non-interactive state",
          code: 'ENOREPLY',
        })
      return NT(Y, { ok: !0, op: 'reply' })
    }
    case 'kill': {
      let X = H.get(f.short)
      if (!X)
        return NT(Y, {
          ok: !1,
          error: 'job not found \u2014 it may have already exited',
          code: 'ENOJOB',
        })
      if (X.dispatch.launch.mode === 'exec' && X.record.outcome)
        return H.delete(f.short), NT(Y, { ok: !0, op: 'kill' })
      return X.kill(f.signal ?? 'SIGTERM'), NT(Y, { ok: !0, op: 'kill' })
    }
    case 'respawn-stale': {
      let X = H.get(f.short)
      if (!X)
        return NT(Y, {
          ok: !1,
          error: 'job not found \u2014 it may have already exited',
          code: 'ENOJOB',
        })
      let P = await X.respawnIfIdleStale()
      return NT(Y, { ok: !0, op: 'respawn-stale', ...P })
    }
    case 'resize': {
      let X = H.get(f.short)
      if (!X)
        return NT(Y, {
          ok: !1,
          error: 'job not found \u2014 it may have already exited',
          code: 'ENOJOB',
        })
      if (f.attachId) {
        let P = X.attachers.get(f.attachId)
        if (!P) return NT(Y, { ok: !0, op: 'resize' })
        if (((P.cols = f.cols), (P.rows = f.rows), P.repaint))
          return P.repaint(), NT(Y, { ok: !0, op: 'resize' })
      }
      return X.resize(f.cols, f.rows), NT(Y, { ok: !0, op: 'resize' })
    }
    case 'attach': {
      let X = H.get(f.short)
      if (
        !X ||
        X.isKilling ||
        (X.record.outcome && X.dispatch.launch.mode !== 'exec')
      )
        return NT(Y, {
          ok: !1,
          error: 'job not found \u2014 it may have already exited',
          code: 'ENOJOB',
        })
      if (X.isUnverified)
        return NT(Y, {
          ok: !1,
          error:
            'worker is live but supervisor could not verify its identity \u2014 try restarting the supervisor to re-adopt',
          code: 'EUNVERIFIED',
        })
      if (X.isRetiring)
        return NT(Y, {
          ok: !1,
          error: 'job is retiring; retry attach',
          code: 'ERESPAWNING',
        })
      if (X.record.legacy) {
        let a = X.dispatch,
          s = W3q.join(_0(await x$(a.cwd)), `${a.sessionId}.jsonl`),
          _H = await k$H(s)
        if (!_H) await K9_.rm(s, { force: !0 }).catch(() => {})
        if (H.get(f.short) !== X || Y.destroyed)
          return NT(Y, {
            ok: !1,
            error: 'supervisor restarting',
            code: 'ERESPAWNING',
          })
        if (!X.isKilling)
          c('tengu_bg_attach_legacy_autorespawn', {}),
            X.kill('SIGTERM'),
            _({
              ...a,
              source: 'respawn',
              launch: _H
                ? {
                    mode: 'resume',
                    sessionId: a.sessionId,
                    fork: !1,
                    flagArgs: a.respawnFlags,
                  }
                : a.launch,
            })
        return NT(Y, {
          ok: !1,
          error: 'legacy job respawning with worker-owned PTY; retry attach',
          code: 'ERESPAWNING',
        })
      }
      z(Y, null),
        Y.write(
          CH({
            ok: !0,
            op: 'attach',
            decModes: X.decModeSnapshot(),
            via: X.via,
            tempo: X.record.tempo,
            state: X.record.state,
          }) +
            `
`,
        ),
        c('tengu_bg_attach', {
          tempo: X.record.tempo,
          state: X.record.state,
          via: X.via,
          attachers: X.attachers.size,
        })
      let P = rM + EwH,
        G = 6,
        W = [],
        Z = 0,
        L = '',
        k = () => {},
        v,
        E = 0,
        h = !1,
        C = wmO(),
        I = C === 0 ? 0 : Math.max(1, Math.ceil((C - 500) / 1000)),
        b = a =>
          f0 +
          rM +
          `
  \x1B[2m${a}\x1B[0m
`,
        m = a => {
          if (W === null) return
          let s = W
          if (((W = null), clearTimeout(S), a && !Y.destroyed))
            for (let _H of s) Y.write(_H)
        },
        S = setTimeout(() => {
          let a = W !== null && Z === 0,
            s = a && f.holdingFrame === !0
          if (!s) m(!0)
          if (a && !Y.destroyed) {
            if (!s) {
              let _H = X.record.state,
                HH =
                  _H === 'starting' ||
                  _H === 'resuming' ||
                  _H === 'adopted' ||
                  _H === 'crashed'
                    ? 'Session is starting \u2014 it will appear once ready. Ctrl+Z to detach'
                    : 'Waiting for session to redraw\u2026 Ctrl+Z to detach'
              Y.write(b(HH))
            }
            ;(v = setInterval(() => {
              if (
                (E++,
                I > 0 &&
                  E >= I &&
                  !X.isKilling &&
                  !X.isRetiring &&
                  X.dispatch.launch.mode !== 'exec')
              ) {
                clearInterval(v), (v = void 0), k()
                let HH = X.dispatch.attachStallRespawns ?? 0,
                  t = { state: X.record.state, via: X.via, attempt: HH }
                if (HH >= 2) {
                  if (
                    (c('tengu_bg_attach_stall_gave_up', t),
                    Y.write(
                      b('Session keeps stalling at startup.') +
                        MqH(
                          `ESTALLED: Session ${f.short} keeps stalling at startup \u2014 check ${b4(f.short)} for logs.`,
                        ),
                    ),
                    !X.isKilling)
                  )
                    X.kill(
                      'SIGKILL',
                      'failed',
                      'session keeps stalling at startup',
                    )
                  return
                }
                c('tengu_bg_attach_stall_respawn', t),
                  Y.write(
                    b('Session not responding \u2014 restarting it\u2026'),
                  ),
                  jmO(X, Y, _, () => h)
                    .catch(hH)
                    .finally(() => {
                      if (!Y.destroyed)
                        Y.write(MqH('ERESPAWNING: worker stalled, restarting'))
                    })
                return
              }
              let _H = X.attachers.get(Q)
              k(),
                (k = X.resizeForRepaint(_H?.cols ?? f.cols, _H?.rows ?? f.rows))
            }, 1000)),
              v.unref()
          }
        }, 500),
        x = () => {
          if (v) clearInterval(v), (v = void 0)
        },
        U = X.onStream.subscribe(a => {
          if (Y.destroyed) return
          if (((h = !0), W !== null)) {
            let s = L + a
            if (s.includes(f0) || s.includes(P)) {
              x()
              let _H = a.includes(f0) || a.includes(P) ? a : s
              if ((k(), m(!1), Y.writableLength <= $S_)) Y.write(_H)
              else Y.destroy()
              return
            }
            if ((W.push(a), (Z += a.length), (L = s.slice(-G)), Z > 65536))
              m(!0)
            return
          }
          if ((x(), Y.writableLength > $S_)) {
            Y.destroy()
            return
          }
          Y.write(a)
        }),
        g = X.onRepaintDone.subscribe(() => {
          k(), m(!0)
        })
      if (n_() === 'windows') for (let a of X.attachers.values()) a.kick()
      let Q = f.attachId ?? Y
      X.attachers.set(Q, {
        cols: f.cols,
        rows: f.rows,
        caps: f.caps,
        kick: () => {
          if ((c('tengu_bg_attach_kick', {}), v)) clearInterval(v), (v = void 0)
          if (
            (clearTimeout(S),
            k(),
            U(),
            g(),
            Y.removeAllListeners('data'),
            !Y.destroyed)
          )
            Y.write(MqH('EKICKED: Session opened in another window')), Y.end()
          X.attachers.delete(Q)
        },
      }),
        X.noteActivity(),
        X.seedFocus(!0),
        X.sendAttacherCaps(f.caps ?? null)
      let l
      if (X.dispatch.launch.mode === 'exec') {
        Y.write(f0 + rM)
        for (let a of X.ringSnapshot()) Y.write(a)
        if (
          (m(!1),
          (l = () => {
            let a = X.attachers.get(Q)
            if (Y.destroyed || !a) return
            let _H = `\r
\x1B[2m\u2014 ${X.record.outcome === 'done' ? 'done' : X.record.outcome === 'killed' ? 'stopped' : 'failed'} \xB7 Ctrl+Z to return \u2014\x1B[0m\r
`
            Y.write(_H),
              (a.repaint = () => {
                if (Y.destroyed) return
                Y.write(f0 + rM)
                for (let HH of X.ringSnapshot()) Y.write(HH)
                Y.write(_H)
              })
          }),
          X.record.outcome)
        ) {
          l(),
            Y.once('close', () => {
              clearTimeout(S), U(), g(), X.attachers.delete(Q)
            })
          return
        }
      }
      k = X.resizeForRepaint(f.cols, f.rows)
      let d = X.onSettle.subscribe(() => {
          if (l && X.record.outcome !== 'killed') return l()
          Y.end()
        }),
        r = new EG4.StringDecoder('utf8')
      if (w.length) X.write(r.write(w))
      Y.on('data', a => X.write(r.write(a))),
        Y.once('close', () => {
          if (v) clearInterval(v)
          if ((k(), m(!1), U(), d(), g(), !X.attachers.delete(Q))) return
          let a = r.end()
          if (a) X.write(a)
          if (X.attachers.size > 0) {
            let s = [...X.attachers.values()].at(-1)
            X.resizeForRepaint(s.cols, s.rows),
              X.sendAttacherCaps(s.caps ?? null)
          } else X.seedFocus(!1), X.sendAttacherCaps(null)
        })
      return
    }
    case 'ensure-spare':
      return NT(Y, { ok: !0, op: 'ensure-spare' })
    case 'permission-response':
      return NT(Y, { ok: !0, op: 'permission-response' })
    case 'subscribe': {
      let X = H.get(f.short)
      if (!X)
        return NT(Y, {
          ok: !1,
          error: 'job not found \u2014 it may have already exited',
          code: 'ENOJOB',
        })
      if (
        (z(Y, null),
        zS_(Y, {
          type: 'snapshot',
          record: X.record,
          streamTail: X.tail(f.tail ?? 200),
        }),
        X.record.outcome)
      ) {
        zS_(Y, { type: 'settled', outcome: X.record.outcome }), Y.end()
        return
      }
      let P = [
        X.onStream.subscribe(G => zS_(Y, { type: 'stream', line: G })),
        X.onState.subscribe(G => zS_(Y, { type: 'state', patch: G })),
        X.onSettle.subscribe(G => {
          zS_(Y, { type: 'settled', outcome: G }), Y.end()
        }),
      ]
      Y.on('close', () => {
        for (let G of P) G()
      })
      return
    }
    default:
      return NT(Y, { ok: !1, error: `unknown op: ${f.op}`, code: 'EUNKNOWN' })
  }
}
function MmO(H) {
  if (H === null || typeof H !== 'object') return null
  let _ = H
  if (
    typeof _.label === 'string' &&
    typeof _.cwd === 'string' &&
    typeof _.pid === 'number'
  )
    return { label: _.label, cwd: _.cwd, pid: _.pid }
  return null
}
var K9_,
  hG4,
  W3q,
  EG4,
  $S_ = 1048576,
  AmO = 5000
var CG4 = R(() => {
  bP()
  Mk()
  YY()
  i6()
  N_()
  W_()
  W6()
  $9()
  nj()
  $A()
  i_()
  nv()
  vG4()
  cv()
  ;(K9_ = require('fs/promises')),
    (hG4 = require('net')),
    (W3q = require('path')),
    (EG4 = require('string_decoder'))
})
async function O9_(H, _) {
  await jm.mkdir(Po8(), { recursive: !0, mode: 448 }).catch(() => {}),
    await jm
      .rename(H, a2H.join(Po8(), a2H.basename(H)))
      .catch(() => jm.unlink(H).catch(() => {})),
    N(`[bg-dispatch] rejected ${a2H.basename(H)}: ${_}`, { level: 'warn' }),
    c('tengu_bg_dispatch_rejected', { reason: _.slice(0, 100) })
}
async function bG4(H, _) {
  let q
  try {
    q = await jm.lstat(H)
  } catch ($) {
    if (X6($)) return
    return (
      uH('daemon_bg_dispatch_ingest', 'read_failed'), O9_(H, IY($) ?? 'unknown')
    )
  }
  if (q.isSymbolicLink())
    return uH('daemon_bg_dispatch_ingest', 'symlink'), O9_(H, 'symlink')
  if (q.size > fmO)
    return (
      uH('daemon_bg_dispatch_ingest', 'oversized'),
      O9_(H, `oversized (${q.size} bytes)`)
    )
  let K
  try {
    K = await jm.readFile(H, 'utf8')
  } catch ($) {
    if (X6($)) return
    return (
      uH('daemon_bg_dispatch_ingest', 'read_failed'), O9_(H, IY($) ?? 'unknown')
    )
  }
  let O,
    T = !0
  try {
    O = B_(K)
  } catch {
    ;(O = void 0), (T = !1)
  }
  let z = OL6().safeParse(O)
  if (!z.success)
    return (
      uH('daemon_bg_dispatch_ingest', T ? 'schema' : 'bad_json'),
      O9_(H, 'schema')
    )
  if (Date.now() - z.data.createdAt > DmO)
    return uH('daemon_bg_dispatch_ingest', 'stale'), O9_(H, 'stale')
  _(z.data), SH('daemon_bg_dispatch_ingest'), await jm.unlink(H).catch(() => {})
}
async function XmO(H) {
  let _
  try {
    _ = await jm.readdir(OCH())
  } catch (q) {
    if (X6(q)) return
    throw q
  }
  for (let q of _) {
    if (q.startsWith('.') || xG4(q) || q === 'rejected') continue
    await bG4(a2H.join(OCH(), q), H)
  }
}
function xG4(H) {
  return H.endsWith('.tmp') || H.includes('.tmp.')
}
async function uG4(H) {
  return jK('daemon_bg_watcher_start', () => PmO(H))
}
async function PmO(H) {
  await jm.mkdir(OCH(), { recursive: !0, mode: 448 }).catch(() => {})
  let _ = n_(),
    q = _ === 'macos',
    K = hN.watch(OCH(), {
      ignoreInitial: !0,
      depth: 0,
      usePolling: q,
      interval: 100,
      ignored: O => xG4(a2H.basename(O)) || a2H.basename(O) === 'rejected',
      ...(_ === 'windows' && {
        awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
      }),
    })
  return (
    K.on('add', O => {
      bG4(O, H).catch(T => N(`[bg-dispatch] ${T}`, { level: 'error' }))
    }),
    K.on('error', O => {
      N(`[bg-dispatch] watcher error: ${O}`, { level: 'error' }),
        c('tengu_bg_dispatch_watcher_failed', { errno: IY(O) ?? 'unknown' })
    }),
    await g3(IG4.once(K, 'ready'), 5000, 'chokidar ready').catch(O =>
      N(`[bg-dispatch] watcher ready wait: ${O}`),
    ),
    await XmO(H).catch(O => {
      N(`[bg-dispatch] cold-start drain: ${O}`, { level: 'error' }),
        c('tengu_bg_dispatch_watcher_failed', { errno: IY(O) ?? 'unknown' })
    }),
    { close: () => K.close() }
  )
}
var IG4,
  jm,
  a2H,
  DmO = 86400000,
  fmO = 262144
var mG4 = R(() => {
  RHH()
  A6()
  N_()
  lH()
  W_()
  $9()
  i_()
  nv()
  cv()
  ;(IG4 = require('events')),
    (jm = require('fs/promises')),
    (a2H = require('path'))
})
async function BG4(H, _ = {}) {
  return jK('daemon_bg_manager_start', async () => {
    let q = new Map(),
      K = new Set(),
      O = _.spawnPty ?? nqq(),
      T = _.onKeepAliveChange ?? (() => {}),
      z = !1,
      $ = !1,
      Y = null,
      A = !1,
      w = !1,
      j = _.spawnPty === void 0,
      J = () => {
        if (!G_('tengu_bg_spare_enable', !0)) {
          if (Y) Y.dispose(), (Y = null)
          return
        }
        let v = jy6()
        if (v > 0 && L3q.freemem() < v) {
          if (Y) Y.dispose(), (Y = null)
          return
        }
        if (!w || Y || A || z || !$ || !O || !j || n_() === 'windows') return
        A = !0
        let E = null,
          h = !1
        M3q({
          log: H,
          onExit: () => {
            if (E === null) {
              h = !0
              return
            }
            if (Y === E) {
              if (((Y = null), Date.now() - E.startedAt >= 2000)) J()
            }
          },
        })
          .then(C => {
            if (((E = C), !C || z || h)) {
              C?.dispose()
              return
            }
            ;(Y = C), c('tengu_bg_spare_spawn', {})
          })
          .catch(C => {
            if (Pw(C)) {
              N(`bg-spare spawn failed: ${f6(C)} ${C.message}`, {
                level: 'warn',
              })
              return
            }
            hH(C)
          })
          .finally(() => {
            A = !1
          })
      },
      M = (v, E = 0, h) => {
        if (z) return
        w = !0
        let C = q.get(v.short)
        if (C) {
          if ((C.isKilling || C.isRetiring || C.record.outcome) && E < 30) {
            if (E === 15 && (C.isKilling || C.isRetiring))
              c('tengu_bg_dispatch_sigkill_escalate', {}), C.kill('SIGKILL')
            setTimeout(M, 100, v, E + 1, h)
            return
          }
          let S = C.isKilling || C.isRetiring || C.record.outcome
          if (
            (H(
              S
                ? `bg: dispatch ${v.short} dropped \u2014 retry budget exhausted (handle still settling)`
                : `bg: dup dispatch ${v.short} dropped (existing handle still live)`,
            ),
            S)
          )
            uH('daemon_bg_session_create', 'dup_retry_exhausted')
          else SH('daemon_bg_session_create')
          return
        }
        let I = L3q.freemem(),
          b = jy6()
        if (b > 0 && I < b && q.size > 0) {
          let S = Math.round(I / 1024 / 1024)
          H(
            `bg: low memory (${S}MB free) \u2014 retiring settled workers before spawning ${v.short}`,
          ),
            c('tengu_bg_dispatch_low_mem', { free_mb: S, handles: q.size }),
            GJ_()
              .catch(x => {
                return hH(x), new Set()
              })
              .then(x => {
                for (let U of q.values())
                  U.retireIfSettled(Z3q, x).catch(g => hH(g))
              })
        }
        if (v.source === 'spare' && b > 0 && I < b) {
          H(`bg: low memory \u2014 skipping spare dispatch ${v.short}`)
          return
        }
        if (
          Y &&
          !h &&
          v.launch.mode !== 'exec' &&
          Y.cliVersion ===
            {
              ISSUES_EXPLAINER:
                'report the issue at https://github.com/anthropics/claude-code/issues',
              PACKAGE_URL: '@anthropic-ai/claude-code',
              README_URL: 'https://code.claude.com/docs/en/overview',
              VERSION: '2.1.153',
              FEEDBACK_CHANNEL:
                'https://github.com/anthropics/claude-code/issues',
              BUILD_TIME: '2026-05-27T20:03:21Z',
              GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
            }.VERSION &&
          G_('tengu_bg_spare_enable', !0)
        ) {
          let S = Y
          Y = null
          try {
            let x = D3q(v, S, O, _.getAuthSnapshot)
            q.set(v.short, x),
              R3q(q, x, T, K, H),
              T(),
              c('tengu_bg_spare_claim', { age_ms: Date.now() - S.startedAt }),
              H(`bg claimed-spare ${v.short} (${v.source})`),
              SH('daemon_bg_session_create'),
              J()
            return
          } catch (x) {
            let U = f6(x),
              g =
                U === 'ENOENT'
                  ? 'enoent'
                  : U === 'ECONNREFUSED'
                    ? 'econnrefused'
                    : x instanceof Error
                      ? 'error'
                      : 'unknown'
            c('tengu_bg_spare_claim_fail', { reason: g }), S.dispose()
          }
        }
        let m = zF.spawn(
          v,
          O,
          _.getAuthSnapshot,
          h ? { afterUpgrade: h } : void 0,
        )
        q.set(v.short, m),
          R3q(q, m, T, K, H),
          T(),
          J(),
          H(`bg spawned ${v.short} (${v.source})`),
          SH('daemon_bg_session_create')
      },
      D = (v = 'SIGTERM') => {
        let E = 0
        for (let h of q.values()) if (!h.record.outcome) h.kill(v), E++
        return E
      }
    await aL6(), await UvK()
    let f = await SG4(
      q,
      M,
      _.onNudge ?? (async () => !1),
      v => {
        let E = v ? D('SIGTERM') : 0
        return _.onShutdown?.(), E
      },
      () => $,
      _.onYield ?? (() => !1),
    )
    f.onLeaseChange.subscribe(T),
      f.onLeaseChange.subscribe(() => {
        if (f.leaseCount() > 0 && !w) (w = !0), J()
      }),
      await Promise.all(
        n_() === 'windows'
          ? [mj.mkdir(TCH(), { recursive: !0 }).catch(() => {})]
          : [
              mj.mkdir(Wo8(), { recursive: !0, mode: 448 }).catch(() => {}),
              mj.mkdir(u__(), { recursive: !0, mode: 448 }).catch(() => {}),
            ],
      ),
      FvK()
    let X = await UU(),
      P = 0,
      G = 0,
      W = 0
    if (
      (await Promise.all(
        Object.entries(X.workers).map(async ([v, E]) => {
          let h
          try {
            h = await zF.adopt(v, E, O, _.getAuthSnapshot)
          } catch (C) {
            hH(C), G++
            return
          }
          if (
            !h &&
            E.procStart === void 0 &&
            E.ptySock &&
            (await Jy6(E.ptySock))
          ) {
            E.procStart = await ey(E.pid)
            try {
              h = await zF.adopt(v, E, O, _.getAuthSnapshot)
            } catch (C) {
              hH(C), (h = null)
            }
            h ??= zF.unverified(v, E)
          }
          if (h) q.set(v, h), R3q(q, h, T, K, H), P++
          else if (E.pendingRespawn === 'upgrade')
            W++, c('tengu_bg_adopt_upgrade_respawn', {}), M(E.dispatch, 0, !0)
          else if (
            (G++,
            dkH(v, 'failed', 'process gone while supervisor was down'),
            n_() === 'windows')
          )
            mj.unlink(xOH(v)).catch(() => {}),
              mj.unlink(IE(BU(v))).catch(() => {})
          else if (
            (mj.unlink(tV_(v)).catch(() => {}),
            mj.unlink(E.rendezvousSock).catch(() => {}),
            E.ptySock)
          ) {
            mj.unlink(E.ptySock).catch(() => {}),
              mj.unlink(IE(E.ptySock)).catch(() => {})
            try {
              process.kill(E.pid, 0)
            } catch {
              LGH([-E.pid])
            }
          }
        }),
      ),
      P + G + W > 0)
    )
      if (
        (H(`bg adopt: adopted=${P} respawned=${W} dead=${G}`),
        c('tengu_bg_adopt', { adopted: P, respawned: W, dead: G }),
        G === 0)
      )
        SH('daemon_bg_adopt')
      else if (P > 0 || W > 0) e_('daemon_bg_adopt', 'partial')
      else uH('daemon_bg_adopt', 'all_workers_dead')
    if (!X.parseFailed) GmO(q, H)
    if (!X.parseFailed) await f3q(q, H)
    await p__(v => {
      v.workers = {}
      for (let [E, h] of q) v.workers[E] = h.rosterEntry()
    }).catch(v => hH(v))
    let Z = await uG4(M)
    if ((($ = !0), T(), q.size > 0)) w = !0
    J()
    let L = Date.now(),
      k = setInterval(
        async (v, E) => {
          let h = Date.now(),
            C = h - L - G3q
          if (((L = h), C > G3q)) {
            for (let g of v.values()) g.shiftGraceClocksForward(C)
            E()
            return
          }
          let I = Zy_(),
            b = I ? Z3q : WmO,
            m = I ? Z3q : _tK(),
            S = await GJ_().catch(g => {
              return hH(g), new Set()
            })
          for (let g of v.values())
            if (S.has(g.dispatch.short))
              g.respawnIfIdleStale(S).catch(Q => hH(Q))
          let x = await Promise.all(
              [...v.values()].map(g =>
                g
                  .retireIfSettled(b, S, m)
                  .then(Q => Q.retired)
                  .catch(Q => {
                    return hH(Q), !1
                  }),
              ),
            ),
            U = e6(x, g => g)
          if (I && U === 0 && Zy_()) {
            let g = [...v.values()].filter(Q => S.has(Q.dispatch.short))
            if (g.length > 0) {
              H(
                'bg: low memory persists after shedding non-pinned \u2014 retiring pinned settled workers as a last resort',
              ),
                c('tengu_bg_retire_pinned_low_mem', {})
              for (let Q of g) Q.retireIfSettled(b, ZmO, m).catch(l => hH(l))
            }
          }
          E()
        },
        G3q,
        q,
        J,
      )
    return (
      k.unref(),
      {
        handles: q,
        dispatch: v => M(v),
        leaseCount: f.leaseCount,
        liveHandleCount: () => {
          let v = 0
          for (let E of q.values()) if (!E.record.outcome) v++
          return v
        },
        pendingSettleWrites: () => K.size,
        killAll: D,
        close: async () => {
          if (((z = !0), clearInterval(k), Y)) Y.dispose(), (Y = null)
          await Promise.all([
            Z.close().catch(() => {}),
            f.close().catch(() => {}),
          ])
          for (let v of q.values()) v.stop()
          if (
            (await Promise.allSettled([...K]),
            q.size === 0 && !X.parseFailed && n_() !== 'windows')
          )
            await mj.rm(Os(), { recursive: !0, force: !0 }).catch(() => {})
        },
      }
    )
  })
}
function R3q(H, _, q, K, O) {
  let T = z => {
    K.add(z), z.finally(() => K.delete(z))
  }
  _.onSettle.subscribe(z => {
    O(`bg settled ${_.record.short} (${z})`)
    let $ = b4(_.record.short),
      Y = z === 'done' ? 'done' : z === 'killed' ? 'stopped' : 'failed',
      A = _.record.detail
    if (_.shouldDeleteJobDir)
      T(mj.rm($, { recursive: !0, force: !0 }).catch(w => hH(w)))
    else
      T(
        o7($)
          .then(w => {
            if (
              w
                ? (HD(w) && !(z === 'crashed' && w.state === 'failed')) ||
                  (z === 'done' &&
                    w.state === 'blocked' &&
                    _.dispatch.launch.mode !== 'exec')
                : z !== 'crashed'
            )
              return
            let j = new Date().toISOString(),
              J = w ?? {
                state: 'working',
                detail: '',
                tempo: 'active',
                output: null,
                children: null,
                linkScanOffset: 0,
                template:
                  _.dispatch.launch.mode === 'exec'
                    ? 'exec'
                    : (_.dispatch.agent ?? _.dispatch.routine ?? 'bg'),
                routine: _.dispatch.routine,
                respawnFlags: [..._.dispatch.respawnFlags],
                intent: _.record.intent,
                name: _.record.name,
                sessionId: _.record.sessionId,
                cwd: _.record.cwd,
                worktreePath:
                  _.dispatch.worktree?.path ?? _.record.worktreePath,
                createdAt: new Date(_.dispatch.createdAt).toISOString(),
                updatedAt: j,
                firstTerminalAt: null,
                backend: 'daemon',
              }
            return iO($, {
              ...J,
              state: Y,
              detail:
                Y === 'stopped'
                  ? 'stopped'
                  : (A || J.detail).replace(/; respawning$/, ''),
              tempo: 'idle',
              inFlight: void 0,
              needs: void 0,
              block: void 0,
              updatedAt: j,
              firstTerminalAt: J.firstTerminalAt ?? j,
            })
          })
          .catch(w => hH(w)),
      )
    if (
      (T(
        p__(w => {
          delete w.workers[_.record.short]
        }).catch(w => hH(w)),
      ),
      n_() === 'windows')
    )
      T(mj.unlink(xOH(_.record.short)).catch(() => {})),
        T(mj.unlink(IE(BU(_.record.short))).catch(() => {}))
    else {
      T(mj.unlink(tV_(_.record.short)).catch(() => {}))
      let w = _.rosterEntry()
      if ((T(mj.unlink(w.rendezvousSock).catch(() => {})), w.ptySock))
        T(mj.unlink(w.ptySock).catch(() => {})),
          T(mj.unlink(IE(w.ptySock)).catch(() => {}))
    }
    if (_.dispatch.launch.mode === 'exec' && z !== 'killed') {
      q(),
        setTimeout(
          (j, J, M) => {
            if (j.get(J) === M) j.delete(J)
          },
          300000,
          H,
          _.record.short,
          _,
        ).unref()
      return
    }
    H.delete(_.record.short), q()
  }),
    _.onState.subscribe(z => {
      if (z.pid)
        p__($ => {
          $.workers[_.record.short] = _.rosterEntry()
        }).catch($ => hH($))
      if (z.state === 'crashed' || z.state === 'resuming') {
        let $ = z.state,
          Y = _.record.detail,
          A = $ === 'crashed' ? 'idle' : 'active',
          w = b4(_.record.short)
        o7(w)
          .then(j => {
            if (_.record.outcome || !j || HD(j) || j.state === 'blocked') return
            if ($ === 'resuming' && j.state !== 'crashed') return
            return iO(w, {
              ...j,
              state: $,
              detail: Y,
              tempo: A,
              inFlight: void 0,
              updatedAt: new Date().toISOString(),
            })
          })
          .catch(j => hH(j))
      }
    })
}
async function GmO(H, _) {
  let q = n_() === 'windows',
    [K, O] = q ? [TCH(), '.pid'] : [u__(), '.sock'],
    T = await mj.readdir(K).catch(() => []),
    z = new Set(T.filter(Y => Y.endsWith(O))),
    $ = 0
  for (let Y of T) {
    if (!Y.endsWith(O)) {
      if (Y.endsWith('.sock.err') && !z.has(Y.slice(0, -4)))
        mj.unlink(pG4.join(K, Y)).catch(() => {})
      continue
    }
    let A = Y.slice(0, -O.length)
    if (H.has(A)) continue
    $++
    let w = xOH(A)
    aCH(BU(A)).then(j => {
      if (!q) {
        dkH(A, 'failed', 'reaped (roster gap)')
        return
      }
      let J = IE(BU(A))
      if (j) {
        dkH(A, 'failed', 'reaped (roster gap)'),
          mj.unlink(w).catch(() => {}),
          mj.unlink(J).catch(() => {})
        return
      }
      mj.readFile(w, 'utf8')
        .then(M => {
          if (!qk(Number(M)))
            dkH(A, 'failed', 'reaped (roster gap)'),
              mj.unlink(w).catch(() => {}),
              mj.unlink(J).catch(() => {})
        })
        .catch(() => {})
    })
  }
  if ($)
    _(`bg orphan-reap: ${$} roster-less pty host(s)`),
      c('tengu_bg_orphan_reap', { reaped: $ })
}
var mj,
  L3q,
  pG4,
  WmO = 3600000,
  Z3q = 60000,
  G3q = 60000,
  ZmO
var UG4 = R(() => {
  YY()
  A6()
  i6()
  N_()
  lH()
  W_()
  OX()
  W6()
  $9()
  oqq()
  CG4()
  mG4()
  d6q()
  nv()
  Gy_()
  B__()
  X3q()
  ;(mj = require('fs/promises')),
    (L3q = require('os')),
    (pG4 = require('path')),
    (ZmO = new Set())
})
async function QG4(H) {
  let _ = process.stdout.isTTY,
    q = await s2H
      .stat(H)
      .then(T => T.size)
      .catch(() => 0)
  if (q > FG4) await N3q(H), (q = 0)
  let K = k3q(H),
    O = !1
  return {
    write(T, z) {
      let $ = `[${new Date().toISOString()}] [${T}] ${D1(z)}
`
      if (((q += Buffer.byteLength($)), K.write($), _)) process.stdout.write($)
      if (q > FG4 && !O) {
        O = !0
        let Y = K
        ;(async () => {
          if (n_() === 'windows') await V3q(Y), await N3q(H), (K = k3q(H))
          else await N3q(H), (K = k3q(H)), await V3q(Y)
          ;(q = 0), (O = !1)
        })().catch(() => {
          O = !1
        })
      }
    },
    close() {
      return V3q(K)
    },
  }
}
function k3q(H) {
  let _ = gG4.createWriteStream(H, { flags: 'a' })
  return _.on('error', () => {}), _
}
function V3q(H) {
  return new Promise(_ => H.end(() => _()))
}
async function N3q(H) {
  let _ = `${H}.1`
  try {
    await s2H.rename(H, _)
  } catch (q) {
    if (X6(q)) return
    await s2H.unlink(_).catch(() => {}),
      await s2H.rename(H, _).catch(() => s2H.unlink(H).catch(() => {}))
  }
}
var gG4,
  s2H,
  FG4 = 10485760
var dG4 = R(() => {
  W_()
  $9()
  oW()
  ;(gG4 = require('fs')), (s2H = require('fs/promises'))
})
function nG4(H) {
  return Math.round(H * (0.5 + Math.random()))
}
function NmO(H) {
  return nG4(Math.min(1000 * 2 ** H, kmO))
}
async function vmO() {
  if (!hz()) return null
  let H = v3q.join(O8H(), 'claude', 'versions')
  try {
    let _ = (await lG4.readdir(H)).sort((q, K) =>
      q.localeCompare(K, void 0, { numeric: !0 }),
    )
    if (_.length === 0) return null
    return v3q.join(H, _.at(-1))
  } catch {
    return null
  }
}
class iI6 {
  id
  kind
  config
  invocation
  logger
  authManager
  onStateChange
  child = null
  spawnedAt = 0
  stopping = !1
  consecutiveCrashes = 0
  backoffTimer = null
  exitPromise = null
  constructor(H, _, q, K, O, T, z) {
    this.id = H
    this.kind = _
    this.config = q
    this.invocation = K
    this.logger = O
    this.authManager = T
    this.onStateChange = z
  }
  get status() {
    let H = this.child?.pid
    return H !== void 0 ? { pid: H, startedAt: this.spawnedAt } : null
  }
  start(H = 0) {
    if (((this.stopping = !1), H > 0)) this.scheduleRespawn(H)
    else this.spawn()
  }
  updateConfig(H) {
    this.config = H
  }
  async stop() {
    if (((this.stopping = !0), this.backoffTimer))
      clearTimeout(this.backoffTimer), (this.backoffTimer = null)
    let H = this.child
    if (!H) return
    let _ = this.exitPromise,
      q = !1
    if (typeof H.send === 'function')
      try {
        q = H.send({ type: 'shutdown' })
      } catch {}
    if (n_() !== 'windows' || !q) H.kill('SIGTERM')
    let K = setTimeout(O => O.kill('SIGKILL'), LmO, H)
    if ((K.unref(), _)) await _
    clearTimeout(K)
  }
  spawn() {
    let H = Date.now()
    this.spawnedAt = H
    let _ = cG4.spawn(
      this.invocation.cmd,
      [...this.invocation.prefixArgs, '--daemon-worker', this.kind],
      {
        stdio: this.authManager
          ? ['pipe', 'pipe', 'pipe', 'ipc']
          : ['pipe', 'pipe', 'pipe'],
        windowsHide: !0,
      },
    )
    if (
      ((this.child = _),
      this.onStateChange?.(),
      _.stdin.on('error', T => {
        this.logger.write(this.id, `stdin write error: ${T.message}`)
      }),
      _.stdin.write(
        CH({
          config: this.config,
          initialAccessToken: this.authManager?.getAccessToken(),
        }) +
          `
`,
      ),
      _.stdin.end(),
      this.authManager)
    )
      this.authManager.attachWorker(_)
    let q = y3q.createInterface({ input: _.stdout })
    q.on('line', T => this.logger.write(this.id, T))
    let K = y3q.createInterface({ input: _.stderr })
    K.on('line', T => this.logger.write(this.id, T)),
      _.on('spawn', () => SH('daemon_worker_spawn'))
    let O = !1
    this.exitPromise = new Promise(T => {
      let z = ($, Y) => {
        if (O) return
        if (
          ((O = !0),
          q.close(),
          K.close(),
          (this.child = null),
          this.onStateChange?.(),
          this.authManager)
        )
          this.authManager.detachWorker(_)
        ;(this.exitPromise = null), this.onExit($, Y, H), T()
      }
      _.on('exit', z),
        _.on('error', $ => {
          if (
            (this.logger.write(this.id, `spawn error: ${$.message}`),
            uH(
              'daemon_worker_spawn',
              X6($)
                ? 'daemon_worker_spawn_enoent'
                : 'daemon_worker_spawn_error',
            ),
            !X6($))
          ) {
            z(null, null)
            return
          }
          vmO().then(Y => {
            if (Y && Y !== this.invocation.cmd)
              this.logger.write(
                this.id,
                `execPath gone (version GC?) \u2014 re-resolved to ${Y}`,
              ),
                (this.invocation = { cmd: Y, prefixArgs: [] }),
                (this.consecutiveCrashes = 0)
            z(null, null)
          })
        })
    })
  }
  onExit(H, _, q) {
    if (this.stopping) return
    let K = Date.now() - q
    if (H === zO6) {
      let T = nG4(VmO)
      this.logger.write(
        this.id,
        `exited tempfail code=${H} uptime=${K}ms \u2014 retry in ${T}ms`,
      ),
        this.scheduleRespawn(T)
      return
    }
    if (H === MX_) {
      this.logger.write(
        this.id,
        `exited permanently code=${H} uptime=${K}ms \u2014 will not respawn`,
      ),
        c('tengu_daemon_worker_permanent_exit', {
          exit_code: H ?? void 0,
          uptime_ms: K,
          worker_kind: this.kind,
        })
      return
    }
    if (H !== 0 || K < RmO) {
      this.consecutiveCrashes++
      let T = NmO(this.consecutiveCrashes)
      this.logger.write(
        this.id,
        `exited code=${H} sig=${_} uptime=${K}ms consecutive=${this.consecutiveCrashes} backoff=${T}ms`,
      ),
        c('tengu_daemon_worker_crash', {
          consecutive: this.consecutiveCrashes,
          exit_code: H ?? void 0,
          uptime_ms: K,
          worker_kind: this.kind,
        }),
        this.scheduleRespawn(T)
    } else
      (this.consecutiveCrashes = 0),
        this.logger.write(
          this.id,
          `exited code=${H} sig=${_} uptime=${K}ms (clean) \u2014 respawning`,
        ),
        this.spawn()
  }
  scheduleRespawn(H) {
    if (this.backoffTimer) clearTimeout(this.backoffTimer)
    ;(this.backoffTimer = setTimeout(() => {
      if (((this.backoffTimer = null), !this.stopping)) this.spawn()
    }, H)),
      this.backoffTimer.unref()
  }
}
var cG4,
  lG4,
  v3q,
  y3q,
  RmO = 60000,
  LmO = 5000,
  kmO = 300000,
  VmO = 30000,
  h3q = 2000
var iG4 = R(() => {
  A6()
  N_()
  W_()
  $9()
  i_()
  M3H()
  ;(cG4 = require('child_process')),
    (lG4 = require('fs/promises')),
    (v3q = require('path')),
    (y3q = require('readline'))
})
function rG4(H) {
  return H === 'heartbeat' || fHH()
}
function ymO(H) {
  let _ = 0
  for (let q of Object.keys(ml)) _ += (H[q] ?? []).length
  return _
}
async function oG4(H) {
  let {
      jsonPath: _,
      invocation: q,
      logger: K,
      authManager: O,
      watch: T = tv6,
    } = H,
    z = new Map(),
    $ = X6q()
  function Y() {
    let X = {}
    for (let [P, G] of z) {
      let W = G.status
      if (W) X[P] = W
    }
    _rK(X)
  }
  let A = await w2H(_)
  if (A.ok) {
    $ = A.config
    for (let X of A.unknownKeys)
      K.write('supervisor', `unknown config key '${X}' \u2014 upgrade claude?`)
  } else K.write('supervisor', `config load failed: ${A.error} \u2014 idling`)
  await O.ready
  let w = 0
  for (let X of Object.keys(ml)) {
    if (!rG4(X)) continue
    let P = $[X] ?? []
    for (let G = 0; G < P.length; G++) {
      let W = `${X}:${G}`,
        Z = new iI6(W, X, P[G], q, K, O, Y)
      z.set(W, Z), Z.start(w++ * h3q), K.write('supervisor', `spawned ${W}`)
    }
  }
  Y()
  let j = async () => {
      let X = await w2H(_)
      if (!X.ok) {
        K.write(
          'supervisor',
          `config reload failed: ${X.error} \u2014 keeping last-good config`,
        )
        return
      }
      for (let W of X.unknownKeys)
        K.write(
          'supervisor',
          `unknown config key '${W}' \u2014 upgrade claude?`,
        )
      let P = yaK($, X.config)
      $ = X.config
      for (let W of P.stop) {
        let Z = z.get(W)
        if (Z)
          await Z.stop(), z.delete(W), K.write('supervisor', `stopped ${W}`)
      }
      for (let { id: W, config: Z } of P.restart) {
        let L = z.get(W)
        if (L)
          await L.stop(),
            L.updateConfig(Z),
            L.start(),
            K.write('supervisor', `restarted ${W}`)
      }
      let G = 0
      for (let { id: W, kind: Z, config: L } of P.start) {
        if (!rG4(Z)) continue
        let k = new iI6(W, Z, L, q, K, O, Y)
        z.set(W, k), k.start(G++ * h3q), K.write('supervisor', `spawned ${W}`)
      }
      if (P.stop.length + P.start.length + P.restart.length > 0)
        K.write(
          'supervisor',
          `reload: stopped=${P.stop.length} started=${P.start.length} restarted=${P.restart.length}`,
        ),
          c('tengu_daemon_config_reload', {
            stopped: P.stop.length,
            started: P.start.length,
            restarted: P.restart.length,
          })
    },
    J = Promise.resolve(),
    M = T(_, () => {
      J = J.then(j).catch(X => hH(X))
    }),
    D = !1
  function f() {
    if (D) return
    ;(D = !0), M()
  }
  return {
    workerCount: () => ymO($),
    hasOAuthConsumer: () => {
      for (let X of z.values()) if (ml[X.kind].needsOAuth) return !0
      return !1
    },
    disposeWatcher: f,
    drainReloads: () => J,
    stop: async () => {
      f(),
        await J,
        await Promise.all(Array.from(z.values()).map(X => X.stop())),
        await qrK()
    },
  }
}
var aG4 = R(() => {
  bP()
  N_()
  W6()
  G8_()
  Lv6()
  iG4()
  Ty_()
})
async function sG4(H) {
  try {
    let _ = await rI6.realpath(H),
      q = await rI6.stat(_)
    return { target: _, mtimeMs: q.mtimeMs }
  } catch (_) {
    if (X6(_)) return null
    throw _
  }
}
function SmO(H, _) {
  if (H.target !== _.target) return !0
  return !y26() && H.mtimeMs !== _.mtimeMs
}
async function tG4(H) {
  let {
      jsonPath: _,
      logPath: q,
      origin: K,
      spawnedBy: O,
      signal: T,
      watch: z = tv6,
      createAuth: $ = aoK,
      staleCheckIntervalMs: Y = hmO,
      idleGraceMs: A = EmO,
    } = H,
    w = await QG4(q)
  w.write(
    'supervisor',
    `\u2500\u2500\u2500 daemon start \u2500\u2500\u2500 version=${{ ISSUES_EXPLAINER: 'report the issue at https://github.com/anthropics/claude-code/issues', PACKAGE_URL: '@anthropic-ai/claude-code', README_URL: 'https://code.claude.com/docs/en/overview', VERSION: '2.1.153', FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues', BUILD_TIME: '2026-05-27T20:03:21Z', GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2' }.VERSION} pid=${process.pid} origin=${K}`,
  ),
    lZ()
  let j = await bW(),
    J = !1
  if (j && j.origin === 'transient' && K !== 'transient') {
    ;(J = !0),
      w.write(
        'supervisor',
        `transient daemon running (pid=${j.pid}, origin=transient) \u2014 asking it to yield to origin=${K}`,
      )
    let l = await IA({ proto: P5, op: 'yield' })
    if (l.ok && l.op === 'yield' && l.yielding) {
      let d = Date.now() + 5000
      while (j && Date.now() < d) await r6(100), (j = await bW())
      if ((c('tengu_daemon_yield_takeover', { ok: !j, new_origin: K }), j))
        w.write(
          'supervisor',
          'yield acked but lock still held after 5s \u2014 refusing to start',
        )
    } else
      w.write(
        'supervisor',
        l.ok
          ? 'existing daemon refused to yield (it reports origin!=transient)'
          : `existing daemon unreachable on control socket (${l.error}); not taking over`,
      )
  }
  if (j) {
    let l = J
        ? `origin=${j.origin ?? 'unknown'}; asked it to yield but the handover failed (see above)`
        : K === 'transient'
          ? `origin=${j.origin ?? 'unknown'}; an on-demand daemon never displaces a running one`
          : `origin=${j.origin ?? 'unknown'}; only a transient daemon can be displaced`,
      d =
        n_() === 'windows'
          ? `Stop it with \`taskkill /PID ${j.pid}\`, then retry.`
          : 'Run `claude daemon stop` to stop it, then retry.'
    if (
      (w.write(
        'supervisor',
        `another daemon is already running (pid=${j.pid}, version=${j.version}, ${l}). ${d}`,
      ),
      J)
    )
      e_('daemon_start', 'daemon_start_yield_failed')
    else SH('daemon_start')
    return await w.close(), { upgradeDetected: !1, exitCode: 1 }
  }
  let M = WE({ pinToCurrentBinary: !0 }),
    D = y26() ? Jo8() : (M.prefixArgs[0] ?? M.cmd),
    f = await sG4(D).catch(l => {
      if (Pw(l))
        N(`binaryIdentity(${D}) failed at startup: ${l.code}`, {
          level: 'error',
        })
      else hH(l)
      return null
    }),
    X = {
      pid: process.pid,
      version: {
        ISSUES_EXPLAINER:
          'report the issue at https://github.com/anthropics/claude-code/issues',
        PACKAGE_URL: '@anthropic-ai/claude-code',
        README_URL: 'https://code.claude.com/docs/en/overview',
        VERSION: '2.1.153',
        FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
        BUILD_TIME: '2026-05-27T20:03:21Z',
        GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
      }.VERSION,
      jsonPath: _,
      logPath: q,
      startedAt: Date.now(),
      origin: K,
      spawnedBy: O,
      procStart: await ey(process.pid),
      launchTarget: f?.target,
    },
    P = await SvK(X)
  if (!P) {
    let l = await iV_()
    if (l) {
      let d = !1
      try {
        process.kill(l.pid, 0),
          (d = (await Ao8(l.pid)) && (await Y0(l.pid, l.procStart)))
      } catch (r) {
        if (f6(r) !== 'ESRCH') d = !0
      }
      if (d)
        return (
          w.write(
            'supervisor',
            `another daemon won the lock race (pid=${l.pid}) \u2014 exiting`,
          ),
          SH('daemon_start'),
          await w.close(),
          { upgradeDetected: !1, exitCode: 1 }
        )
      P = await Yo8(X)
    } else P = await Yo8(X)
    if (!P)
      return (
        w.write(
          'supervisor',
          'another daemon won the lock race \u2014 exiting',
        ),
        SH('daemon_start'),
        await w.close(),
        { upgradeDetected: !1, exitCode: 1 }
      )
  }
  let G = null,
    W = $(
      T,
      l => w.write('supervisor', l),
      () => G?.hasOAuthConsumer() ?? !1,
    ),
    Z = !1,
    L = !1,
    k = !1,
    v = !1,
    E = null,
    h = () => {
      if (K !== 'transient') return !1
      if (!v)
        (v = !0),
          w.write(
            'supervisor',
            'yielding to a foreground/service daemon \u2014 bg workers will be re-adopted',
          ),
          c('tengu_daemon_yield', {}),
          E?.()
      return !0
    },
    C = async () => {
      if (Z || !f) return Z
      let l
      try {
        l = await sG4(D)
      } catch (d) {
        if (Pw(d))
          N(`binaryIdentity(${D}) poll failed: ${d.code}`, { level: 'error' })
        else hH(d)
        return !1
      }
      if (T.aborted || k) return !1
      if (l !== null && !SmO(f, l)) return !1
      if (((Z = !0), l === null))
        w.write(
          'supervisor',
          `binary at ${D} was deleted (was ${f.target}) \u2014 exiting for upgrade`,
        )
      else {
        let d =
          f.target === l.target
            ? 'mtime changed'
            : `${f.target} \u2192 ${l.target}`
        w.write(
          'supervisor',
          `binary at ${D} changed (${d}) \u2014 self-restarting for upgrade`,
        )
      }
      return E?.(), !0
    },
    I = { manager: null },
    b = null,
    m = !1,
    S = () =>
      (I.manager?.leaseCount() ?? 0) + (I.manager?.liveHandleCount() ?? 0),
    x = () => {
      if (K !== 'transient') return
      if (m || Z || L || v || T.aborted) return
      if (S() > 0) {
        if (b) clearTimeout(b), (b = null)
        return
      }
      if (b) return
      ;(b = setTimeout(() => {
        if (((b = null), T.aborted || Z || S() > 0)) return
        m = !0
        let l = G?.workerCount() ?? 0
        w.write(
          'supervisor',
          `idle ${Math.round(A / 1000)}s with no clients \u2014 exiting` +
            (l > 0 ? ` (stopping ${l} configured workers)` : ''),
        ),
          c('tengu_daemon_idle_exit', { grace_ms: A, cfg_workers: l }),
          E?.()
      }, A)),
        b.unref()
    }
  W.ready
    .then(() =>
      BG4(l => w.write('bg', l), {
        getAuthSnapshot: K === 'service' ? () => W.getAuthSnapshot() : void 0,
        onNudge: C,
        onShutdown: () => {
          ;(L = !0),
            w.write('supervisor', 'shutdown requested via control socket'),
            E?.()
        },
        onYield: h,
        onKeepAliveChange: x,
      }),
    )
    .then(l => {
      if (T.aborted) return void l.close()
      ;(I.manager = l), x()
    })
    .catch(hH),
    (G = await oG4({
      jsonPath: _,
      invocation: M,
      logger: w,
      authManager: W,
      watch: z,
    }))
  let U = G.workerCount()
  if ((w.write('supervisor', `workers=${U}`), U > 0))
    w.write(
      'supervisor',
      'daemon.json has configured workers but they do not pin the supervisor \u2014 they stop when the last client lease and bg job are gone',
    )
  if (
    (c('tengu_daemon_start', {
      worker_kinds: Object.keys(ml).length,
      worker_count: U,
      origin: K,
    }),
    SH('daemon_start'),
    x(),
    await new Promise(l => {
      if (((E = l), T.aborted || Z || m || L || v)) return void l()
      if ((T.addEventListener('abort', () => l(), { once: !0 }), !f)) {
        w.write(
          'supervisor',
          `binary identity unresolvable at ${D}; upgrade polling disabled`,
        )
        return
      }
      let d = setInterval(() => {
        if (T.aborted || Z || k) return clearInterval(d)
        if ((C(), K === 'service' && VA8()))
          (k = !0),
            w.write(
              'supervisor',
              'service recall flag set \u2014 draining workers and uninstalling service',
            ),
            E?.()
      }, Y)
      d.unref()
    }),
    (E = null),
    b)
  )
    clearTimeout(b), (b = null)
  if (Z) c('tengu_daemon_self_restart_on_upgrade', {})
  if (k) c('tengu_copper_lantern', {})
  w.write('supervisor', 'shutting down'),
    G.disposeWatcher(),
    await G.drainReloads()
  let g = !1,
    Q = async () => {
      if (g) return
      g = !0
      let l = await iV_()
      if (l && l.pid === X.pid && l.startedAt === X.startedAt) await CvK()
    }
  if (v) await I.manager?.close(), (I.manager = null)
  if (m || k || v) {
    if ((await Q(), k)) I.manager?.killAll('SIGTERM')
  }
  if ((await Promise.all([I.manager?.close(), G.stop()]), await Q(), k))
    await b__()
  return await w.close(), W.dispose(), { upgradeDetected: Z, exitCode: 0 }
}
var rI6,
  hmO = 60000,
  EmO = 5000
var eG4 = R(() => {
  bP()
  A6()
  i6()
  N_()
  lH()
  W_()
  OX()
  W6()
  $9()
  KXH()
  q6q()
  LqH()
  UG4()
  cv()
  G8_()
  Zl()
  dG4()
  aG4()
  DPH()
  Ty_()
  rI6 = require('fs/promises')
})
var E3q = {}
f_(E3q, {
  parseKindArgs: () => HR4,
  matchAssistantTarget: () => _R4,
  handleListAllKinds: () => BmO,
  handleCliKind: () => UmO,
})
function Jm(H) {
  process.stdout.write(
    H +
      `
`,
  )
}
function CmO(H) {
  process.stderr.write(
    H +
      `
`,
  )
}
function nX(H) {
  CmO(H), process.exit(1)
}
function HR4(H, _) {
  let q,
    K = new Map(),
    O = !1,
    T = -1
  for (let A = 0; A < _.length; A++) {
    let w = _[A]
    if (!w.startsWith('-')) {
      T = A
      break
    }
    if (w !== '--json' && w.startsWith('--') && !w.includes('=')) A++
  }
  let z = T === -1 ? void 0 : _[T],
    $
  if (z === void 0 || z === 'list') $ = 'list'
  else if (z === 'add' || z === 'remove') $ = z
  else
    nX(
      `unknown action '${z}' \u2014 expected: claude daemon ${H} <add|remove|list>`,
    )
  let Y = T === -1 ? _ : [..._.slice(0, T), ..._.slice(T + 1)]
  for (let A = 0; A < Y.length; A++) {
    let w = Y[A]
    if (w === '--json') O = !0
    else if (w.startsWith('--')) {
      let j = w.indexOf('='),
        J = j !== -1 ? w.slice(2, j) : w.slice(2)
      if (J === 'add' || J === 'remove')
        nX(
          `'${w}' is no longer supported \u2014 use: claude daemon ${H} <add|remove|list>`,
        )
      K.set(J, j !== -1 ? w.slice(j + 1) : (Y[++A] ?? ''))
    } else if ($ === 'remove' && q === void 0) q = w
    else
      nX(
        `unknown option '${w}' \u2014 expected: claude daemon ${H} <add|remove|list>`,
      )
  }
  return { action: $, removeTarget: q, flags: K, json: O }
}
async function T9_() {
  if (!(await Gl()))
    nX(
      'daemon service is not installed (service install is disabled in this version; the daemon runs on demand)',
    )
}
async function YS_(H) {
  let _ = await w2H(H)
  if (!_.ok) nX(_.error)
  return _.config
}
async function ImO(H) {
  let _ = await YS_(H),
    q = [],
    K = _.assistant ?? []
  for (let z of K)
    q.push({
      kind: 'assistant',
      dir: z.dir,
      name: z.name ?? sE.basename(z.dir),
    })
  let O = _.remoteControl ?? []
  for (let z of O)
    q.push({
      kind: 'remote-control',
      dir: z.dir,
      name: z.name ?? sE.basename(z.dir),
      spawnMode: z.spawnMode ?? 'same-dir',
    })
  let T = await M8_(H)
  for (let z of T)
    q.push({
      kind: 'scheduled',
      id: z.id,
      dir: z.directory,
      enabled: z.enabled,
      cron: z.cron,
    })
  return q
}
function oI6(H) {
  if (H.length === 0) {
    Jm('(no entries)')
    return
  }
  let _ = ['kind', 'name/id', 'dir', 'extra'],
    q = H.map(T => [
      T.kind,
      T.id ?? T.name ?? '',
      T.dir,
      T.kind === 'scheduled'
        ? `${T.cron ?? ''}${T.enabled === !1 ? ' (disabled)' : ''}`
        : T.kind === 'remote-control'
          ? (T.spawnMode ?? '')
          : '',
    ]),
    K = _.map((T, z) => Math.max(T.length, ...q.map($ => $[z].length))),
    O = T => T.map((z, $) => z.padEnd(K[$])).join('  ')
  Jm(O(_)), Jm(K.map(T => '-'.repeat(T)).join('  '))
  for (let T of q) Jm(O(T))
}
async function bmO(H, _) {
  if (H.action === 'list') {
    let W = await M8_(_)
    if (H.json) {
      Jm(CH(W, null, 2))
      return
    }
    let Z = W.map(L => ({
      kind: 'scheduled',
      id: L.id,
      dir: L.directory,
      enabled: L.enabled,
      cron: L.cron,
    }))
    oI6(Z)
    return
  }
  if (H.action === 'remove') {
    if (!H.removeTarget) nX('usage: claude daemon scheduled remove <task-id>')
    if ((await T9_(), !(await sv_(H.removeTarget, _))))
      nX(`No scheduled task with id "${H.removeTarget}"`)
    Jm(`removed ${H.removeTarget}`)
    return
  }
  if ((await T9_(), H.flags.has('id') && !H.flags.get('id')))
    nX('--id requires a non-empty value')
  if (H.flags.has('model') && !H.flags.get('model'))
    nX('--model requires a non-empty value')
  function q(W) {
    return J8_.includes(W)
  }
  if (
    H.flags.has('permission-mode') &&
    !q(H.flags.get('permission-mode') ?? '')
  )
    nX(`--permission-mode must be one of ${J8_.join(', ')}`)
  let K = H.flags.get('prompt'),
    O = H.flags.get('id'),
    T = H.flags.get('dir'),
    z = sE.resolve(T ?? S_())
  if (!O && !K)
    nX('--prompt is required (or pass --id to update an existing task)')
  let $ = O ?? xmO(z, K),
    A = (await M8_(_)).find(W => W.id === $),
    w = K ?? A?.prompt,
    j = H.flags.get('cron') ?? A?.cron
  if (!w) nX('--prompt is required')
  if (!j) nX('--cron is required')
  let J = ulH(j)
  if (J.error !== void 0) nX(`invalid --cron '${j}': ${J.error}`)
  let M = J.cron,
    D = T ? sE.resolve(T) : (A?.directory ?? sE.resolve(S_())),
    f = H.flags.get('permission-mode') ?? A?.permissionMode ?? 'dontAsk',
    X = H.flags.get('model') ?? A?.model ?? void 0,
    { isPathTrusted: P } = await Promise.resolve().then(() => (n6(), ei))
  if (!P(D))
    nX(
      `${D} is not a trusted directory \u2014 run \`claude\` there once and accept the trust dialog.`,
    )
  let G = {
    ...(A && {
      enabled: A.enabled,
      runTimeoutMinutes: A.runTimeoutMinutes,
      maxQueued: A.maxQueued,
    }),
    id: $,
    cron: M,
    prompt: w,
    directory: D,
    permissionMode: f,
    ...(X && { model: X }),
  }
  if ((await av_(G, _), A)) Jm(`updated scheduled task '${$}'`)
  else Jm(`added scheduled task '${$}'`)
}
function xmO(H, _) {
  let q = z =>
      z
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40),
    K = q(sE.basename(H)),
    O = q(_.split(/\s+/).slice(0, 4).join(' '))
  return [K, O].filter(Boolean).join('-') || 'task'
}
async function umO(H, _) {
  if (H.action === 'list') {
    let $ = (await YS_(_)).assistant ?? []
    if (H.json) {
      Jm(CH($, null, 2))
      return
    }
    oI6(
      $.map(Y => ({
        kind: 'assistant',
        dir: Y.dir,
        name: Y.name ?? sE.basename(Y.dir),
      })),
    )
    return
  }
  if (H.action === 'remove') {
    if (!H.removeTarget)
      nX('usage: claude daemon assistant remove <name-or-dir>')
    await T9_()
    let z = await _R4(H.removeTarget, _)
    await Fv6(z, _), Jm(`removed ${z}`)
    return
  }
  await T9_()
  let q = await x$(sE.resolve(H.flags.get('dir') ?? S_())),
    K = H.flags.get('name'),
    O = H.flags.get('permission-mode'),
    T = H.flags.has('model') ? H.flags.get('model') || null : void 0
  nX('`claude daemon assistant add` is not available in this build')
}
async function _R4(H, _) {
  let K = (await YS_(_)).assistant ?? [],
    O = K.filter($ => ($.name ?? sE.basename($.dir)) === H)
  if (O.length === 1) return O[0].dir
  if (O.length > 1)
    nX(`ambiguous: multiple assistants match name '${H}'. Use a dir instead.`)
  let T = await x$(sE.resolve(H)),
    z = []
  for (let $ of K) if ((await x$($.dir)) === T) z.push($)
  if (z.length >= 1) return z[0].dir
  nX(`no assistant matched '${H}'`)
}
async function mmO(H, _) {
  if (H.action === 'list') {
    let Y = (await YS_(_)).remoteControl ?? []
    if (H.json) {
      Jm(CH(Y, null, 2))
      return
    }
    oI6(
      Y.map(A => ({
        kind: 'remote-control',
        dir: A.dir,
        name: A.name ?? sE.basename(A.dir),
        spawnMode: A.spawnMode ?? 'same-dir',
      })),
    )
    return
  }
  if (H.action === 'remove') {
    if (!H.removeTarget)
      nX('usage: claude daemon remote-control remove <name-or-dir>')
    await T9_()
    let $ = await pmO(H.removeTarget, _)
    await av6($, _), Jm(`removed ${$}`)
    return
  }
  await T9_()
  let q = await x$(sE.resolve(H.flags.get('dir') ?? S_())),
    { isPathTrusted: K } = await Promise.resolve().then(() => (n6(), ei))
  if (!K(q))
    nX(
      `${q} is not a trusted directory \u2014 run \`claude\` there once and accept the trust dialog.`,
    )
  let O = H.flags.get('name'),
    T = H.flags.get('spawn-mode')
  if (T !== void 0 && T !== 'same-dir' && T !== 'worktree')
    nX(`--spawn-mode must be same-dir or worktree, got '${T}'`)
  let z = await ov6({ dir: q, name: O, spawnMode: T }, _)
  Jm(`${z} remote-control server for ${q}`)
}
async function pmO(H, _) {
  let K = (await YS_(_)).remoteControl ?? [],
    O = K.filter($ => ($.name ?? sE.basename($.dir)) === H)
  if (O.length === 1) return O[0].dir
  if (O.length > 1)
    nX(
      `ambiguous: multiple remote-control servers match name '${H}'. Use a dir instead.`,
    )
  let T = await x$(sE.resolve(H)),
    z = []
  for (let $ of K) if ((await x$($.dir)) === T) z.push($)
  if (z.length >= 1) return z[0].dir
  nX(`no remote-control server matched '${H}'`)
}
async function BmO(H, _ = RI()) {
  let q = await ImO(_)
  if (H) {
    Jm(CH(q, null, 2))
    return
  }
  oI6(q)
}
async function UmO(H, _, q = RI()) {
  let K = HR4(H, _)
  if (H === 'scheduled') return bmO(K, q)
  if (H === 'assistant') return umO(K, q)
  return mmO(K, q)
}
var sE
var S3q = R(() => {
  Ed()
  Dq()
  nj()
  i_()
  G8_()
  IOH()
  DPH()
  gv6()
  sv6()
  tv_()
  sE = require('path')
})
var YR4 = {}
f_(YR4, { tailLog: () => $R4, parseArgs: () => zR4, daemonMain: () => amO })
function qR4() {
  return gmO + (ZwH() ? QmO : dmO) + cmO + lmO
}
function zR4(H) {
  let _ = RI(),
    q = !1,
    K = JPH(),
    O,
    T,
    z = new Set()
  for (let D = 0; D < H.length; D++) {
    let f = H[D]
    if (f === '--json-path' && H[D + 1])
      z.add(D), z.add(++D), (_ = H[D]), (q = !0)
    else if (f.startsWith('--json-path=')) z.add(D), (_ = f.slice(12)), (q = !0)
    else if (f === '--log-file' && H[D + 1]) z.add(D), z.add(++D), (K = H[D])
    else if (f.startsWith('--log-file=')) z.add(D), (K = f.slice(11))
    else if (f === '--origin' && H[D + 1]) z.add(D), z.add(++D), (O = KR4(H[D]))
    else if (f.startsWith('--origin=')) z.add(D), (O = KR4(f.slice(9)))
    else if (f === '--spawned-by' && H[D + 1])
      z.add(D), z.add(++D), (T = omO(H[D]))
  }
  let $ = []
  for (let D = 0; D < H.length; D++) if (!z.has(D)) $.push(H[D])
  let Y = new Set([
      'run',
      'install',
      'uninstall',
      'start',
      'stop',
      'restart',
      'status',
      'logs',
      'log',
      'list',
      'scheduled',
      'assistant',
      'remote-control',
      'hub',
    ]),
    A = process.stdin.isTTY ? 'hub' : 'run',
    w = -1
  for (let D = 0; D < $.length; D++)
    if (!$[D].startsWith('-')) {
      w = D
      break
    }
  if (w === -1)
    return { sub: A, jsonPath: _, logPath: K, origin: O, spawnedBy: T, rest: $ }
  let j = $[w]
  if (!Y.has(j)) {
    if (!/[./\\~]/.test(j))
      return {
        sub: j,
        jsonPath: _,
        logPath: K,
        origin: O,
        spawnedBy: T,
        rest: [],
      }
    return {
      sub: 'run',
      jsonPath: q ? _ : j,
      logPath: K,
      origin: O,
      spawnedBy: T,
      rest: [],
    }
  }
  let J = [...$.slice(0, w), ...$.slice(w + 1)],
    M = j
  if (M === 'run' && !q) {
    let D = J.find(f => !f.startsWith('-'))
    if (D) _ = D
  }
  return { sub: M, jsonPath: _, logPath: K, origin: O, spawnedBy: T, rest: J }
}
function KR4(H) {
  if (H === 'service' || H === 'transient' || H === 'foreground') return H
  if (H === 'auto') return 'transient'
  return
}
function rmO(H) {
  let _ = H.origin ?? 'unknown'
  if (_ !== 'transient' && _ !== 'auto') return _
  let q = H.spawnedBy
  if (!q) return 'transient \u2014 started on-demand by a client'
  return `transient \u2014 started on-demand by \`${q.label}\` (pid ${q.pid}) in ${q.cwd}`
}
function omO(H) {
  let _ = V7(H, !1)
  if (_ === null || typeof _ !== 'object') return
  let q = _
  if (
    typeof q.label === 'string' &&
    typeof q.cwd === 'string' &&
    typeof q.pid === 'number'
  )
    return { label: q.label, cwd: q.cwd, pid: q.pid }
  return
}
function vY(H) {
  process.stdout.write(
    H +
      `
`,
  )
}
function CD(H) {
  process.stderr.write(
    H +
      `
`,
  )
}
function t2H(H, _) {
  let q = []
  for (let K = 0; K < H.length; K++) {
    let O = H[K]
    if (_.includes(O)) continue
    if (
      O === '--debug' ||
      O === '-d' ||
      O === '--debug-to-stderr' ||
      O === '-d2e' ||
      O.startsWith('--debug=') ||
      O.startsWith('--debug-file=')
    )
      continue
    if (O === '--debug-file' && K + 1 < H.length) {
      K++
      continue
    }
    q.push(O)
  }
  if (q.length > 0) CD(`warning: extra arguments ignored: ${q.join(' ')}`)
}
async function Mm(H) {
  await Promise.race([
    Promise.all([kQ(), hQ()]),
    r6(500, void 0, { unref: !0 }),
  ]).catch(() => {}),
    process.exit(H)
}
async function amO(H) {
  if ((await TQH(), H.includes('--help') || H.includes('-h'))) {
    if (!L4H()) return GwH('daemon')
    vY(qR4())
    return
  }
  let _ = zR4(H),
    { jsonPath: q, logPath: K, origin: O, spawnedBy: T, rest: z } = _,
    $ = _.sub === 'hub' && !fHH() ? 'status' : _.sub
  if (!imO.has($)) {
    let Y = await yh6()
    if (Y)
      process.stderr.write(`${Y}
`),
        process.exit(1)
    if (!L4H()) return GwH('daemon')
  }
  if (nmO.has($) && !fHH()) return GwH(`daemon ${$}`)
  switch (($66(), $)) {
    case 'list': {
      t2H(z, ['--json'])
      let { handleListAllKinds: Y } = await Promise.resolve().then(
        () => (S3q(), E3q),
      )
      await Y(z.includes('--json'), q)
      return
    }
    case 'scheduled':
    case 'assistant':
    case 'remote-control': {
      let { handleCliKind: Y } = await Promise.resolve().then(
        () => (S3q(), E3q),
      )
      await Y($, z, q)
      return
    }
    case 'hub': {
      if ((t2H(z, []), !process.stdin.isTTY || !process.stdout.isTTY)) {
        vY('Interactive hub requires a TTY. See `claude daemon --help`.')
        return
      }
      let { renderDaemonHubStandalone: Y } = await Promise.resolve().then(
        () => (k6q(), L6q),
      )
      return await Y(), process.exit(0)
    }
    case 'run': {
      if (OQH())
        return (
          CD('claude daemon: background agents disabled (3P/opt-out)'),
          process.exit(0)
        )
      ;(process.title = 'claude daemon'), gyH()
      let Y = new AbortController(),
        A = !1,
        w = () => {
          if (A) CD('forced shutdown'), process.exit(1)
          ;(A = !0), Y.abort()
        }
      process.on('SIGINT', w), process.on('SIGTERM', w)
      let j = O ?? 'foreground',
        J,
        M
      try {
        ;({ upgradeDetected: J, exitCode: M } = await tG4({
          jsonPath: q,
          logPath: K,
          origin: j,
          spawnedBy: T,
          signal: Y.signal,
        }))
      } catch (D) {
        return (
          hH(D),
          uH('daemon_start', 'daemon_start_crash'),
          await Promise.all([
            Jh('tengu_daemon_startup_crash', {}),
            JQH('tengu_daemon_startup_crash', {}),
          ]),
          Mm(1)
        )
      }
      if (J) {
        if (j === 'service') return Mm(FmO)
        await smO(q, K, j, T)
      }
      return Mm(M)
    }
    case 'install': {
      if ((t2H(z, []), !ZwH()))
        return (
          CD(
            `\`claude daemon ${$}\` is disabled in this version \u2014 the daemon runs on demand and exits when the last client disconnects.`,
          ),
          await Jh('tengu_daemon_install', { ok: !1, disabled: !0 }),
          Mm(1)
        )
      if (!MPH())
        return (
          CD(
            `Service install isn't available on ${'darwin'} \u2014 the daemon still runs on demand when a client connects.`,
          ),
          uH('daemon_service_install', 'daemon_service_install_unsupported'),
          Mm(1)
        )
      if (process.env.CLAUDE_CONFIG_DIR)
        return (
          CD(
            'service install only supports the default config dir \u2014 the launchd/systemd unit is a per-user singleton',
          ),
          uH('daemon_service_install', 'daemon_service_install_config_dir'),
          Mm(1)
        )
      let Y = await rV_()
      if (Y !== null) vY(`stopped detached daemon (pid ${Y})`)
      let A = await aV_({ jsonPath: q, logPath: K })
      if (!A.ok)
        return (
          await Jh('tengu_daemon_install', { ok: !1 }),
          uH('daemon_service_install', 'daemon_service_install_failed'),
          CD(`install failed: ${A.error}`),
          CD(`  (service file was written to ${A.servicePath})`),
          Mm(1)
        )
      SH('daemon_service_install'), vY(`installed: ${A.servicePath}`)
      let w = await oCH(5000)
      if ((await Jh('tengu_daemon_install', { ok: !0, reachable: w }), w)) {
        let j = await bW().catch(() => null)
        vY(
          `running: pid=${j?.pid ?? '?'} origin=${j?.origin ?? '?'} (managed by ${n_() === 'macos' ? 'launchd' : 'systemd'})`,
        )
      } else
        CD(
          'warning: service installed but daemon not reachable within 5s \u2014 check `claude daemon logs`',
        )
      return Mm(0)
    }
    case 'start':
    case 'restart': {
      if ((t2H(z, []), !ZwH()))
        return (
          CD(
            `\`claude daemon ${$}\` is disabled in this version \u2014 the daemon runs on demand and exits when the last client disconnects.`,
          ),
          await Jh('tengu_daemon_install', { ok: !1, disabled: !0 }),
          Mm(1)
        )
      if (!MPH())
        CD(
          `\`claude daemon ${$}\` isn't available on ${'darwin'} (no launchd/systemd) \u2014 the daemon runs on demand instead.`,
        ),
          process.exit(1)
      if (process.env.CLAUDE_CONFIG_DIR)
        CD(
          'the launchd/systemd unit is a per-user singleton for the default config dir',
        ),
          process.exit(1)
      if (!(await Gl()))
        CD('service not installed \u2014 run `claude daemon install` first'),
          process.exit(1)
      if (await iL6()) {
        vY('service binary missing \u2014 regenerating service file')
        let A = await rV_()
        if (A !== null) vY(`stopped detached daemon (pid ${A})`)
        let w = await aV_({ jsonPath: q, logPath: K })
        if (
          (await Jh('tengu_daemon_control', {
            op_start: $ === 'start',
            op_restart: $ === 'restart',
            ok: w.ok,
            regenerated: !0,
          }),
          w.ok)
        )
          vY($ === 'start' ? 'started' : 'restarted')
        else CD(`regenerate failed: ${w.error}`)
        return Mm(w.ok ? 0 : 1)
      }
      let Y = await ($ === 'start' ? nL6() : mvK())
      if (
        (await Jh('tengu_daemon_control', {
          op_start: $ === 'start',
          op_restart: $ === 'restart',
          ok: Y.ok,
        }),
        Y.ok)
      )
        vY($ === 'start' ? 'started' : 'restarted')
      else CD(`${$} failed: ${Y.error}`)
      return Mm(Y.ok ? 0 : 1)
    }
    case 'uninstall': {
      t2H(z, [])
      let Y = await b__()
      if (
        (await Jh('tengu_daemon_control', { op_uninstall: !0, ok: Y.ok }), Y.ok)
      )
        SH('daemon_service_uninstall'), vY('uninstalled')
      else
        uH('daemon_service_uninstall', 'daemon_service_uninstall_failed'),
          CD(`uninstall failed: ${Y.error}`)
      return Mm(Y.ok ? 0 : 1)
    }
    case 'stop': {
      let Y = z.includes('--keep-workers')
      t2H(z, ['--keep-workers', '--any'])
      let A = X =>
          Y || X === 0
            ? 'stopped'
            : `stopped (terminated ${X} ${N6(X, 'background session')})`,
        w = async (X, P) => {
          if (X) SH('daemon_stop')
          else uH('daemon_stop', 'daemon_stop_failed')
          return (
            await Jh('tengu_daemon_control', { op_stop: !0, ok: X, reaped: P }),
            Mm(X ? 0 : 1)
          )
        },
        j = await Gl(),
        J = await bW()
      if (!j && J && !z.includes('--any'))
        return (
          CD(
            `no background service is installed, but a daemon is running (pid=${J.pid}, origin=${J.origin ?? 'unknown'}). Run \`claude daemon stop --any\` to stop it.`,
          ),
          Mm(1)
        )
      let M = await IA({ proto: P5, op: 'shutdown', reapWorkers: !Y })
      if (M.ok && M.op === 'shutdown') {
        let X = Y ? 0 : (await n6q()).reaped,
          P = Math.max(M.reaped, X)
        if (j) {
          let G = await sV_()
          if (!G.ok) return CD(`stop failed: ${G.error}`), w(!1, P)
        }
        if ((vY(A(P)), !j))
          vY(
            'note: the next `claude agents` or `claude --bg` will start a new one',
          )
        return w(!0, P)
      }
      let D = !1
      if (j) {
        let X = await sV_()
        if (!X.ok) return CD(`stop failed: ${X.error}`), w(!1, 0)
        D = !0
      } else if (J && n_() !== 'windows')
        try {
          process.kill(J.pid, 'SIGTERM'), (D = !0)
        } catch (X) {
          if (f6(X) === 'ESRCH') D = !0
          else {
            let P =
              f6(X) === 'EPERM'
                ? ' (running as another user \u2014 try with elevated privileges)'
                : ''
            return (
              CD(`could not stop daemon (pid=${J.pid}): ${LH(X)}${P}`), w(!1, 0)
            )
          }
        }
      let f = Y ? 0 : (await n6q()).reaped
      if (J && !D && n_() === 'windows')
        return (
          CD(
            (f > 0 ? `terminated ${f} background session(s); ` : '') +
              `supervisor (pid=${J.pid}) is still running \u2014 stop it with ` +
              `\`taskkill /PID ${J.pid}\` or close the terminal it was started in.`,
          ),
          w(!1, f)
        )
      if (!D && !J && f === 0) vY('no daemon running')
      else if ((vY(A(f)), !j && J))
        vY(
          'note: the next `claude agents` or `claude --bg` will start a new one',
        )
      return w(!0, f)
    }
    case 'status': {
      t2H(z, [])
      let Y = await bW()
      if (!Y) {
        vY('not running')
        let { getBgDaemonStatus: D, formatBgDaemonStatus: f } =
          await Promise.resolve().then(() => (eL6(), Lo8))
        vY(f(await D())), process.exit(1)
      }
      let A = Math.floor((Date.now() - Y.startedAt) / 1000)
      vY(`pid:     ${Y.pid}`),
        vY(`version: ${Y.version}`),
        vY(`uptime:  ${A}s`),
        vY(`origin:  ${rmO(Y)}`),
        vY(`config:  ${Y.jsonPath}`),
        vY(`log:     ${Y.logPath}`)
      let { getBgDaemonStatus: w, formatBgDaemonStatus: j } =
          await Promise.resolve().then(() => (eL6(), Lo8)),
        J = await w()
      vY(j(J))
      let M = Y.origin
      if (M === 'transient' || M === 'auto') {
        vY('')
        let D = J.workersLive ?? 0,
          f = J.leaseClients
        if (D > 0 || f.length > 0) {
          if ((vY('holding this daemon open:'), D > 0))
            vY(
              `  ${D} ${N6(D, 'bg worker')} running (daemon waits for them to settle)`,
            )
          for (let X of f) vY(`  \`${X.label}\` (pid ${X.pid}) in ${X.cwd}`)
          vY(''),
            vY(
              'to let it idle-exit: wait for (or cancel) bg workers and close any `claude agents`',
            )
        } else if (J.workersLive === 0)
          vY('nothing holding this daemon open \u2014 will idle-exit shortly')
      }
      if (
        Y.version !==
        {
          ISSUES_EXPLAINER:
            'report the issue at https://github.com/anthropics/claude-code/issues',
          PACKAGE_URL: '@anthropic-ai/claude-code',
          README_URL: 'https://code.claude.com/docs/en/overview',
          VERSION: '2.1.153',
          FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
          BUILD_TIME: '2026-05-27T20:03:21Z',
          GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
        }.VERSION
      ) {
        vY(''),
          vY(
            `warning: running daemon is ${Y.version}, but this claude is ${{ ISSUES_EXPLAINER: 'report the issue at https://github.com/anthropics/claude-code/issues', PACKAGE_URL: '@anthropic-ai/claude-code', README_URL: 'https://code.claude.com/docs/en/overview', VERSION: '2.1.153', FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues', BUILD_TIME: '2026-05-27T20:03:21Z', GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2' }.VERSION}`,
          )
        let D = (await Gl()) ? 'claude daemon stop' : 'claude daemon stop --any'
        vY(`  run \`${D}\` to pick up the new version`)
      }
      return process.exit(0)
    }
    case 'logs':
    case 'log': {
      t2H(z, []), await $R4(K)
      return
    }
    default:
      CD(`unknown subcommand: ${$}`), CD(''), CD(qR4()), process.exit(1)
  }
}
async function smO(H, _, q, K) {
  let O = await Ay6([
    'daemon',
    'run',
    '--json-path',
    H,
    '--log-file',
    _,
    '--origin',
    q,
    ...(K ? ['--spawned-by', CH(K)] : []),
  ])
  if (O)
    hH(`daemon: upgrade self-respawn failed: ${LH(O)}`),
      await Jh('tengu_bg_daemon_spawn_failed', {
        respawn: !0,
        errno_enoent: f6(O) === 'ENOENT',
        errno_eacces: f6(O) === 'EACCES',
      })
}
async function $R4(H) {
  {
    let T = OR4.spawn('tail', ['-f', H], { stdio: 'inherit' })
    await new Promise(z => {
      T.on('exit', $ => {
        if ($) process.exitCode = $
        z()
      }),
        T.on('error', $ => {
          CD(`tail failed: ${$.message}`), process.exit(1)
        })
    })
    return
  }
  let _
  try {
    _ = await TR4.open(H, 'r')
  } catch (T) {
    CD(`cannot open ${H}: ${LH(T)}`), process.exit(1)
  }
  let q = (await _.stat()).size,
    K = Buffer.alloc(65536),
    O = !1
  process.on('SIGINT', () => {
    O = !0
  })
  while (!O) {
    if ((await _.stat()).size < q) q = 0
    let { bytesRead: z } = await _.read(K, 0, K.length, q)
    if (z > 0) process.stdout.write(K.subarray(0, z)), (q += z)
    else await r6(500)
  }
  await _.close()
}
var OR4,
  TR4,
  FmO = 70,
  gmO = `Usage: claude daemon [subcommand] [options]

Service lifecycle:
  run [json-path]   Run the supervisor in the foreground (default when piped)
  status            Show daemon pid, version, uptime
  logs              Tail the daemon log (Ctrl-C to stop)
  uninstall         Remove the background service (launchctl/systemd)
  stop              Shut down the supervisor and terminate background sessions
                      --any           also stop a transient (non-service) daemon
                      --keep-workers  leave detached sessions running
`,
  QmO = `  install           Install as a launchctl/systemd service (persists across reboot)
  start             Start the installed service
  restart           Restart the installed service
`,
  dmO = `
  Service install is disabled in this version \u2014 the daemon runs on demand
  and exits when the last client disconnects.
`,
  cmO = '',
  lmO = `
Options:
  --json-path <p>   Config file (default: ~/.claude/daemon.json)
  --log-file <p>    Log file (default: ~/.claude/daemon.log)
  --help, -h        Show this help
`,
  nmO,
  imO
var AR4 = R(() => {
  bP()
  X66()
  EQ()
  A6()
  $k()
  W_()
  W3()
  W6()
  Sc()
  $9()
  jIH()
  i_()
  R8()
  LqH()
  v8_()
  cv()
  Gy_()
  g6q()
  Zl()
  IOH()
  DPH()
  eG4()
  ;(OR4 = require('child_process')),
    (TR4 = require('fs/promises')),
    (nmO = new Set([
      'list',
      'scheduled',
      'assistant',
      'remote-control',
      'hub',
    ])),
    (imO = new Set(['run', 'status', 'stop', 'uninstall']))
})
process.env.NoDefaultCurrentDirectoryInExePath = '1'
process.env.COREPACK_ENABLE_AUTO_PIN = '0'
oS_()
if (process.env.CLAUDE_CODE_REMOTE === 'true') {
  let H = process.env.NODE_OPTIONS || ''
  process.env.NODE_OPTIONS = H
    ? `${H} --max-old-space-size=8192`
    : '--max-old-space-size=8192'
}
function wR4(H) {
  for (let _ = 0; _ < H.length; _++) {
    let q = H[_]
    if (
      q === '--debug' ||
      q === '-d' ||
      q === '--debug-to-stderr' ||
      q === '-d2e' ||
      q.startsWith('--debug=') ||
      q.startsWith('--debug-file=')
    )
      continue
    if (q === '--debug-file' && _ + 1 < H.length) {
      _++
      continue
    }
    return !1
  }
  return !0
}
function tmO(H) {
  let _,
    q,
    K,
    O,
    T = []
  for (let z = 0; z < H.length; z++) {
    let $ = H[z],
      Y = $.indexOf('='),
      [A, w] = Y > 0 ? [$.slice(0, Y), $.slice(Y + 1)] : [$, void 0],
      j = w !== void 0 || z + 1 < H.length
    if (A === '--dangerously-skip-permissions') _ = 'bypassPermissions'
    else if (A === '--allow-dangerously-skip-permissions') O = !0
    else if (A === '--permission-mode' && j) _ = w ?? H[++z]
    else if (A === '--model' && j) q = w ?? H[++z]
    else if (A === '--effort' && j) K = w ?? H[++z]
    else T.push($)
  }
  return {
    dispatchDefaults:
      _ || q || K || O
        ? { permissionMode: _, model: q, effort: K, allowBypass: O }
        : void 0,
    rest: T,
  }
}
async function emO(){let H=process.argv.slice(2);if((H.length===1||H.length===2&&H[1]==="--verbose")&&(H[0]==="--version"||H[0]==="-v"||H[0]==="-V")){if(console.log(`${{ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues",PACKAGE_URL:"@anthropic-ai/claude-code",README_URL:"https://code.claude.com/docs/en/overview",VERSION:"2.1.153",FEEDBACK_CHANNEL:"https://github.com/anthropics/claude-code/issues",BUILD_TIME:"2026-05-27T20:03:21Z",GIT_SHA:"6cfd211761f355dcebba152b66399d0416e445d2"}.VERSION} (Claude Code)${zS()}`),H.length===2&&{ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues",PACKAGE_URL:"@anthropic-ai/claude-code",README_URL:"https://code.claude.com/docs/en/overview",VERSION:"2.1.153",FEEDBACK_CHANNEL:"https://github.com/anthropics/claude-code/issues",BUILD_TIME:"2026-05-27T20:03:21Z",GIT_SHA:"6cfd211761f355dcebba152b66399d0416e445d2"}.GIT_SHA)console.log(`Commit: ${{ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues",PACKAGE_URL:"@anthropic-ai/claude-code",README_URL:"https://code.claude.com/docs/en/overview",VERSION:"2.1.153",FEEDBACK_CHANNEL:"https://github.com/anthropics/claude-code/issues",BUILD_TIME:"2026-05-27T20:03:21Z",GIT_SHA:"6cfd211761f355dcebba152b66399d0416e445d2"}.GIT_SHA}`);return}let{profileCheckpoint:_}=await Promise.resolve().then(() => (qb(),jwq));if(_("cli_entry"),process.argv[2]==="--claude-in-chrome-mcp"){_("cli_claude_in_chrome_mcp_path");let{runClaudeInChromeMcpServer:j}=await Promise.resolve().then(() => (gc8(),Fc8));await j();return}else if(process.argv[2]==="--chrome-native-host"){_("cli_chrome_native_host_path");let{runChromeNativeHost:j}=await Promise.resolve().then(() => (L64(),R64));await j();return}else if(process.argv[2]==="--computer-use-mcp"){_("cli_computer_use_mcp_path");let{runComputerUseMcpServer:j}=await Promise.resolve().then(() => (Ec8(),hc8));await j();return}if(H[0]==="--daemon-worker"){let{loadFastPathPolicy:j}=await Promise.resolve().then(() => (jIH(),a8_)),J=await j();if(J)process.stderr.write(`${J}
`);let{runDaemonWorker:M}=await Promise.resolve().then(() => (Ty_(),vaK));await M(H[1]);return}if(H[0]==="--bg-pty-host"){let{runPtyHost:j}=await Promise.resolve().then(() => (C64(),S64));await j(H.slice(1));return}if(H[0]==="--bg-spare"){let{runBgSpare:j}=await Promise.resolve().then(() => (X3q(),kG4));await j(H.slice(1));return}if(H[0]==="remote-control"||H[0]==="rc"||H[0]==="remote"||H[0]==="sync"||H[0]==="bridge"){_("cli_bridge_path");let{loadFastPathPolicy:j}=await Promise.resolve().then(() => (jIH(),a8_));{let U=await j();if(U){let{exitWithError:g}=await Promise.resolve().then(() => (mL(),rxH));g(U)}}let{getBridgeDisabledReason:J,checkBridgeMinVersion:M,getBridgeAuthDebugInfo:D}=await Promise.resolve().then(() => (zV(),jp8)),{BRIDGE_LOGIN_ERROR:f}=await Promise.resolve().then(() => zBK),{bridgeMain:X}=await Promise.resolve().then(() => (rv6(),iv6)),{exitWithError:P}=await Promise.resolve().then(() => (mL(),rxH)),{getSettingsWithErrors:G}=await Promise.resolve().then(() => (M8(),U7H));if(G().settings.disableRemoteControl===!0)P("Error: Remote Control is disabled by your organization's policy (managed setting `disableRemoteControl`).");let{hasStoredOAuthToken:W}=await Promise.resolve().then(() => (jq(),nb));if(!W())P(f+D());let Z=await J();if(Z)P(`Error: ${Z}`+D());let L=M();if(L)P(L);let{waitForPolicyLimitsToLoad:k}=await Promise.resolve().then(() => (Ku(),q$6)),{isPolicyAllowed:v}=await Promise.resolve().then(() => (NO(),B76));if(await k(),!v("allow_remote_control"))P("Error: Remote Control is disabled by your organization's policy.");let[{initSinks:E},{initialize1PEventLogging:h,shutdown1PEventLogging:C},{shutdownDatadog:I},{sleep:b}]=await Promise.all([Promise.resolve().then(() => (rCH(),P8_)),Promise.resolve().then(() => (
