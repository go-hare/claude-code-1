case"attach":
{
  let X = H.get(f.short)
  if (
    !X ||
    X.isKilling ||
    (X.record.outcome && X.dispatch.launch.mode !== 'exec')
  )
    return NT(Y,{ok:!1,error:"job not found \u2014 it may have already exited",code:"ENOJOB"});
  if (X.isUnverified)
    return NT(Y,{ok:!1,error:"worker is live but supervisor could not verify its identity \u2014 try restarting the supervisor to re-adopt",code:"EUNVERIFIED"});
  if (X.isRetiring)
    return NT(Y,{ok:!1,error:"job is retiring; retry attach",code:"ERESPAWNING"});
  if (X.record.legacy) {
    let a = X.dispatch,
      s = W3q.join(_0(await x$(a.cwd)), `${a.sessionId}.jsonl`),
      _H = await k$H(s)
    if (!_H) await K9_.rm(s, { force: !0 }).catch(() => {})
    if (H.get(f.short) !== X || Y.destroyed)
      return NT(Y,{ok:!1,error:"supervisor restarting",code:"ERESPAWNING"});
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
    return NT(Y,{ok:!1,error:"legacy job respawning with worker-owned PTY; retry attach",code:"ERESPAWNING"})
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
                X.kill('SIGKILL', 'failed', 'session keeps stalling at startup')
              return
            }
            c('tengu_bg_attach_stall_respawn', t),
              Y.write(b('Session not responding \u2014 restarting it\u2026')),
              jmO(X, Y, _, () => h)
                .catch(hH)
                .finally(() => {
                  if (!Y.destroyed)
                    Y.write(MqH('ERESPAWNING: worker stalled, restarting'))
                })
            return
          }
          let _H = X.attachers.get(Q)
          k(), (k = X.resizeForRepaint(_H?.cols ?? f.cols, _H?.rows ?? f.rows))
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
        if ((W.push(a), (Z += a.length), (L = s.slice(-G)), Z > 65536)) m(!0)
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
        X.resizeForRepaint(s.cols, s.rows), X.sendAttacherCaps(s.caps ?? null)
      } else X.seedFocus(!1), X.sendAttacherCaps(null)
    })
  return
}
case"ensure-spare":
return NT(Y,{ok:!0,op:"ensure-spare"});
case"permission-response":
return NT(Y,{ok:!0,op:"permission-response"});
case"subscribe":
{
  let X = H.get(f.short)
  if (!X)
    return NT(Y,{ok:!1,error:"job not found \u2014 it may have already exited",code:"ENOJOB"});
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
return NT(Y,{ok:!1,error:`unknown op: ${f.op}`,code:"EUNKNOWN"})
}}
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
async function tG4(H){let{jsonPath:_,logPath:q,origin:K,spawnedBy:O,signal:T,watch:z=tv6,createAuth:$=aoK,staleCheckIntervalMs:Y=hmO,idleGraceMs:A=EmO}=H,w=await QG4(q);w.write("supervisor",`\u2500\u2500\u2500 daemon start \u2500\u2500\u2500 version=${{ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues",PACKAGE_URL:"@anthrop
