class zF {
  dispatch
  spawnPty
  getAuthSnapshot
  via
  record
  onStream = C7()
  onState = C7()
  onSettle = C7()
  onRepaintDone = C7()
  attachers = new Map()
  pty
  procStart
  ptyCols = 200
  ptyRows = 50
  decModes = fy_()
  execTracker
  execLastLine
  offData
  offExit
  ring = []
  ringBytes = 0
  ringSpawnMark = 0
  attempt = 0
  lastSpawnAt = 0
  fastCrashStreak = 0
  lastExitCause
  backoffTimer = null
  pidPoll = null
  rv
  rvSockPath
  ptySockPath
  unverifiedSock
  phase = { kind: 'spawning' }
  workerReady = !1
  resizeDeferred = !1
  lastInputAt
  deleteJobDirOnSettle = !1
  get shouldDeleteJobDir() {
    return this.deleteJobDirOnSettle
  }
  adoptedAt
  lastRvHeartbeat
  stalledLogged = !1
  lastCheckPidAt = Date.now()
  replyChain = Promise.resolve()
  killOutcome = 'killed'
  get isKilling() {
    return this.phase.kind === 'retiring' && this.phase.reason === 'reap'
  }
  get isRetiring() {
    return this.phase.kind === 'retiring' && this.phase.reason === 'grace'
  }
  get isUnverified() {
    return this.unverifiedSock !== void 0
  }
  getPhase() {
    return this.phase
  }
  get isTransitioning() {
    return this.phase.kind !== 'running' || !this.pty || this.record.pid === 0
  }
  get isDetached() {
    return this.phase.kind === 'retiring' && this.phase.reason === 'stop'
  }
  transitionTo(H) {
    if (!jfO(this.phase, H))
      return (
        N(
          `[bg] illegal worker-phase transition ${_84(this.phase)} \u2192 ${_84(H)} for ${this.record.short}`,
          { level: 'warn' },
        ),
        c('tengu_bg_phase_illegal', {}),
        !1
      )
    return (this.phase = H), !0
  }
  shutdownWorker() {
    let H = this.rv?.send({ type: 'shutdown' }) ?? !1
    if (!H) this.sigtermWorker()
    else
      setTimeout(
        _ => {
          let q = _.phase
          if (
            (q.kind === 'upgrading' ||
              (q.kind === 'retiring' && q.reason === 'grace')) &&
            !_.record.outcome
          )
            _.sigtermWorker()
        },
        5000,
        this,
      ).unref()
    return H
  }
  async respawnIfIdleStale(H) {
    if (this.dispatch.launch.mode === 'exec')
      return { respawned: !1, reason: 'not-stale' }
    if (this.isTransitioning) return { respawned: !1, reason: 'in-progress' }
    if (this.record.outcome) return { respawned: !1, reason: 'no-state' }
    if (this.attachers.size > 0) return { respawned: !1, reason: 'attached' }
    let _ = await o7(b4(this.dispatch.short))
    if (this.isTransitioning) return { respawned: !1, reason: 'in-progress' }
    if (this.record.outcome) return { respawned: !1, reason: 'no-state' }
    if (this.attachers.size > 0) return { respawned: !1, reason: 'attached' }
    if (!_) return { respawned: !1, reason: 'no-state' }
    if (HD(_) && !H?.has(this.dispatch.short))
      return { respawned: !1, reason: 'settled' }
    if (
      !_.cliVersion ||
      _.cliVersion ===
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
    )
      return { respawned: !1, reason: 'not-stale' }
    if (!HD(_) && _.tempo !== 'idle') return { respawned: !1, reason: 'busy' }
    if (!this.transitionTo({ kind: 'upgrading' }))
      return { respawned: !1, reason: 'in-progress' }
    return (
      this.onState.emit({ pid: this.record.pid }),
      c('tengu_bg_respawn_stale', {
        short: this.dispatch.short,
        rvSent: this.shutdownWorker(),
      }),
      { respawned: !0 }
    )
  }
  async retireIfSettled(H, _, q = H) {
    if (this.isTransitioning) return { retired: !1, reason: 'in-progress' }
    if (this.record.outcome) return { retired: !1, reason: 'no-state' }
    if (this.attachers.size > 0) return { retired: !1, reason: 'attached' }
    if (_?.has(this.dispatch.short)) return { retired: !1, reason: 'pinned' }
    if (this.adoptedAt && Date.now() - this.adoptedAt < AfO)
      return { retired: !1, reason: 'recent-adopt' }
    if (this.lastInputAt && Date.now() - this.lastInputAt < H)
      return { retired: !1, reason: 'recent-input' }
    let K = await o7(b4(this.dispatch.short))
    if (this.isTransitioning || this.attachers.size > 0)
      return { retired: !1, reason: 'in-progress' }
    if (this.lastInputAt && Date.now() - this.lastInputAt < H)
      return { retired: !1, reason: 'recent-input' }
    if (!K) {
      if (
        this.dispatch.source === 'spare' &&
        Date.now() - this.dispatch.createdAt > H
      ) {
        if (!this.transitionTo({ kind: 'retiring', reason: 'grace' }))
          return { retired: !1, reason: 'in-progress' }
        return (
          c('tengu_bg_retired', {
            short: this.dispatch.short,
            rvSent: this.shutdownWorker(),
            settledForMs: Date.now() - this.dispatch.createdAt,
            state: 'stale-spare',
          }),
          { retired: !0 }
        )
      }
      return { retired: !1, reason: 'no-state' }
    }
    if (
      this.dispatch.source !== 'shell' &&
      !K.name &&
      !K.intent &&
      !K.worktreePath &&
      K.template === 'bg' &&
      K.state === 'working' &&
      K.tempo === 'blocked'
    ) {
      let z = Date.now() - Date.parse(K.createdAt)
      if (z < wfO) return { retired: !1, reason: 'empty-idle-grace' }
      if (!this.transitionTo({ kind: 'retiring', reason: 'grace' }))
        return { retired: !1, reason: 'in-progress' }
      return (
        (this.deleteJobDirOnSettle = !0),
        c('tengu_bg_retired', {
          short: this.dispatch.short,
          rvSent: this.shutdownWorker(),
          settledForMs: z,
          state: 'empty-idle',
        }),
        { retired: !0 }
      )
    }
    if (!HD(K)) return { retired: !1, reason: 'not-settled' }
    if ((K.inFlight?.tasks ?? 1) > 0 || (K.inFlight?.queued ?? 1) > 0)
      return { retired: !1, reason: 'inflight' }
    if (K.inFlight?.kinds.includes('session_cron'))
      return { retired: !1, reason: 'session-cron' }
    if (K.routine) return { retired: !1, reason: 'routine' }
    let O = K.bridgeSessionId ? Math.max(H, q) : H,
      T = K.updatedAt && Date.now() - Date.parse(K.updatedAt)
    if (!T || T < O) return { retired: !1, reason: 'grace' }
    if (!this.transitionTo({ kind: 'retiring', reason: 'grace' }))
      return { retired: !1, reason: 'in-progress' }
    return (
      c('tengu_bg_retired', {
        short: this.dispatch.short,
        rvSent: this.shutdownWorker(),
        settledForMs: T,
        bridged: !!K.bridgeSessionId,
        state: K.state,
      }),
      { retired: !0 }
    )
  }
  sigtermWorker() {
    try {
      this.pty?.kill('SIGTERM')
    } catch {}
  }
  constructor(H, _, q, K, O) {
    this.dispatch = H
    this.spawnPty = _
    this.getAuthSnapshot = q
    this.via = K
    if (
      ((this.record = {
        short: H.short,
        nonce: H.nonce,
        sessionId: H.sessionId,
        pid: 0,
        attempt: 0,
        startedAt: Date.now(),
        cwd: H.cwd,
        backend: 'daemon',
        tempo: 'active',
        state: 'starting',
        detail: '',
        intent: H.seed?.intent ?? '',
        name: H.seed?.name,
        agent: H.agent,
        routine: H.routine,
        worktreePath: H.worktree?.path,
        cliVersion: {
          ISSUES_EXPLAINER:
            'report the issue at https://github.com/anthropics/claude-code/issues',
          PACKAGE_URL: '@anthropic-ai/claude-code',
          README_URL: 'https://code.claude.com/docs/en/overview',
          VERSION: '2.1.153',
          FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
          BUILD_TIME: '2026-05-27T20:03:21Z',
          GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
        }.VERSION,
        source: H.source,
        ...O,
      }),
      H.cols)
    )
      this.ptyCols = H.cols
    if (H.rows) this.ptyRows = H.rows
  }
  static spawn(H, _, q, K) {
    let O = new zF(H, _ ?? nqq(), q, 'cold')
    if (K?.afterUpgrade)
      return (
        (O.attempt = 1),
        O.buildBridgeReattachEnvFromState().then(T => O.doSpawn(T)),
        O
      )
    return O.doSpawn(H.reattachEnv), O
  }
  static claim(H, _) {
    let q = new zF(H, _.spawnPty, _.getAuthSnapshot, 'spare', {
      pid: _.pid,
      attempt: 1,
      state: 'running',
      cliVersion: {
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
    return (
      (q.attempt = 1),
      (q.ptySockPath = _.ptySockPath),
      (q.rvSockPath = x__(H.short)),
      q.wirePty(Ch6(_.ptySockPath, _.pid, void 0, H.short)),
      q.resize(H.cols ?? 200, H.rows ?? 50),
      q.connectRv(),
      ey(_.pid, { skipCache: !0 }).then(K => {
        if (q.record.pid !== _.pid || q.isDetached || q.record.outcome) return
        if (K) q.procStart = K
        q.patch({ pid: _.pid })
      }),
      q
    )
  }
  static buildClaimFrame(H, _) {
    let q = b4(H.short),
      K = H84(H, q, _, x__(H.short))
    if (H.reattachEnv) Object.assign(K, H.reattachEnv)
    let O = e64(H, 1, !1, H.sessionId, H.respawnFlags)
    return { env: K, argv: O }
  }
  static async adopt(H, _, q, K) {
    try {
      process.kill(_.pid, 0)
    } catch (z) {
      let $ = f6(z)
      if ($ === 'ESRCH' || $ === 'EPERM') return null
    }
    let O = await ey(_.pid)
    if (O && _.procStart !== O) return null
    let T = new zF(_.dispatch, q, K, 'adopted', {
      pid: _.pid,
      attempt: _.attempt,
      startedAt: _.startedAt,
      messagingSock: _.messagingSock,
      state: 'adopted',
      detail: 'adopted from previous supervisor',
      cliVersion: _.cliVersion,
      ...(_.ptySock ? {} : { legacy: !0 }),
    })
    if (
      ((T.attempt = _.attempt),
      (T.procStart = _.procStart),
      (T.workerReady = !0),
      (T.adoptedAt = Date.now()),
      (T.rvSockPath = _.rendezvousSock),
      (T.ptySockPath = _.ptySock),
      T.dispatch.launch.mode === 'exec')
    )
      (T.execTracker = dqq(b4(T.dispatch.short))), (T.workerReady = !0)
    if (_.ptySock)
      T.wirePty(Ch6(_.ptySock, _.pid, T.procStart, T.dispatch.short)),
        (T.ptyCols = 0),
        T.seedFocus(!1)
    if (_.decModes) T.decModes.seed(_.decModes)
    if ((T.connectRv(), _.pendingRespawn === 'upgrade'))
      T.transitionTo({ kind: 'upgrading' }),
        setTimeout(
          z => {
            if (z.phase.kind === 'upgrading' && !z.record.outcome)
              z.sigtermWorker()
          },
          5000,
          T,
        ).unref()
    return T
  }
  static unverified(H, _) {
    let q = new zF(_.dispatch, void 0, void 0, 'adopted', {
      pid: _.pid,
      attempt: _.attempt,
      startedAt: _.startedAt,
      messagingSock: _.messagingSock,
      state: 'adopted',
      detail: 'adopted (pid unverifiable; tracking via pty.sock)',
      cliVersion: _.cliVersion,
    })
    return (
      (q.attempt = _.attempt),
      (q.procStart = _.procStart),
      (q.rvSockPath = _.rendezvousSock),
      (q.ptySockPath = _.ptySock),
      (q.unverifiedSock = _.ptySock),
      (q.lastInputAt = Date.now()),
      (q.pidPoll = setInterval(
        K => {
          if (K.record.outcome || !K.unverifiedSock) return
          Jy6(K.unverifiedSock).then(O => {
            if (O || K.record.outcome || K.phase.kind !== 'spawning') return
            K.settle('crashed')
          })
        },
        cqq,
        q,
      )),
      q.pidPoll.unref(),
      c('tengu_bg_adopt_unverified', { short: H }),
      q
    )
  }
  tail(H) {
    return H > 0 ? this.ring.slice(-H) : []
  }
  ringSnapshot() {
    return this.ring
  }
  preInitErrorTail() {
    let H = D5(this.ring.slice(this.ringSpawnMark).join(''))
      .replace(/\s+/g, ' ')
      .trim()
    if (!H) return
    return H.length > s64 ? `\u2026${H.slice(-s64)}` : H
  }
  decModeSnapshot() {
    return this.decModes.snapshot()
  }
  write(H) {
    ;(this.lastInputAt = Date.now()), this.pty?.write(H)
  }
  noteActivity() {
    this.lastInputAt = Date.now()
  }
  shiftGraceClocksForward(H) {
    if (H <= 0) return
    if (this.adoptedAt !== void 0) this.adoptedAt += H
    if (this.lastInputAt !== void 0) this.lastInputAt += H
  }
  seedFocus(H) {
    if (this.dispatch.launch.mode === 'exec') return
    this.pty?.write(H ? iLH : rLH)
  }
  resize(H, _) {
    if (
      ((this.ptyCols = H),
      (this.ptyRows = _),
      n_() === 'windows' && !this.workerReady)
    ) {
      this.resizeDeferred = !0
      return
    }
    try {
      this.pty?.resize(H, _)
    } catch {}
  }
  signalPtyPgrp() {
    if (n_() === 'windows' || !this.record.pid) return
    setTimeout(
      H => {
        try {
          process.kill(-H, 'SIGWINCH')
        } catch {}
      },
      15,
      this.record.pid,
    )
  }
  resizeForRepaint(H, _) {
    if (H !== this.ptyCols || _ !== this.ptyRows)
      return (
        this.resize(H, _),
        this.signalPtyPgrp(),
        this.rv?.send({ type: 'repaint' }),
        () => {}
      )
    let q = this.rv?.send({ type: 'repaint' }) === !0,
      K = () => {},
      O = setTimeout(
        (T, z) => {
          if ((K(), this.ptyCols !== T || this.ptyRows !== z)) return
          let $ = Math.max(2, T - 1)
          this.resize($, z),
            this.signalPtyPgrp(),
            setTimeout(
              (Y, A, w) => {
                if (this.ptyCols === w && this.ptyRows === A)
                  this.resize(Y, A), this.signalPtyPgrp()
              },
              30,
              T,
              z,
              $,
            )
        },
        q ? 50 : 0,
        H,
        _,
      )
    if (q)
      K = this.onRepaintDone.subscribe(() => {
        K(), clearTimeout(O)
      })
    return () => {
      K(), clearTimeout(O)
    }
  }
  rosterEntry() {
    return {
      pid: this.record.pid,
      procStart: this.procStart,
      sessionId: this.record.sessionId,
      rendezvousSock: this.rvSockPath ?? x__(this.dispatch.short),
      ptySock: this.record.legacy
        ? void 0
        : (this.ptySockPath ?? BU(this.dispatch.short)),
      messagingSock: this.record.messagingSock,
      cliVersion: this.record.cliVersion,
      startedAt: this.record.startedAt,
      attempt: this.attempt,
      cwd: this.dispatch.cwd,
      worktreePath: this.dispatch.worktree?.path,
      dispatch: this.cappedDispatch(),
      pendingRespawn: this.phase.kind === 'upgrading' ? 'upgrade' : void 0,
      decModes: this.decModes.snapshot(),
    }
  }
  cappedDispatch() {
    return JSON.parse(
      JSON.stringify(this.dispatch, (H, _) =>
        H === 'reattachEnv' || H === 'attachStallRespawns'
          ? void 0
          : typeof _ === 'string' && _.length > t64
            ? _.slice(0, t64)
            : _,
      ),
    )
  }
  async reply(H) {
    if (
      ((this.lastInputAt = Date.now()),
      ((await o7(b4(this.dispatch.short)))?.tempo ?? this.record.tempo) ===
        'blocked' && this.rv?.send({ type: 'reply', text: H }))
    )
      return !0
    if (this.pty) {
      let q = this.dispatch.launch.mode !== 'exec'
      return (
        (this.replyChain = this.replyChain.then(
          () =>
            new Promise(K => {
              this.pty?.write(q ? `\x1B[200~${H}\x1B[201~` : H),
                setTimeout(
                  O => {
                    this.pty?.write('\r'), O()
                  },
                  10,
                  K,
                )
            }),
        )),
        !0
      )
    }
    return this.rv?.send({ type: 'reply', text: H }) ?? !1
  }
  sendAttacherCaps(H) {
    return this.rv?.send({ type: 'attacher-caps', caps: H }) ?? !1
  }
  kill(H = 'SIGTERM', _ = 'killed', q) {
    if (this.phase.kind === 'retired') return
    if (((this.killOutcome = _), q)) this.patch({ detail: q })
    if (
      (this.transitionTo({ kind: 'retiring', reason: 'reap' }),
      this.backoffTimer)
    )
      clearTimeout(this.backoffTimer), (this.backoffTimer = null)
    if (this.unverifiedSock) {
      aCH(this.unverifiedSock).finally(() => this.settle(this.killOutcome))
      return
    }
    if (this.pty)
      try {
        this.pty.kill(H)
      } catch {}
    else if (this.record.pid && !this.pidRecycled())
      try {
        process.kill(-this.record.pid, H)
      } catch {
        try {
          process.kill(this.record.pid, H)
        } catch {}
      }
    if (!this.pty) this.settle(this.killOutcome)
  }
  stop() {
    if (this.phase.kind === 'retiring' && this.phase.reason === 'reap')
      this.settle(this.killOutcome)
    else if (this.phase.kind === 'retiring' && this.phase.reason === 'grace')
      this.settle('done')
    else if (this.phase.kind !== 'retired')
      this.transitionTo({ kind: 'retiring', reason: 'stop' })
    if (this.backoffTimer)
      clearTimeout(this.backoffTimer), (this.backoffTimer = null)
    this.clearLiveness(),
      this.offData?.dispose(),
      this.offExit?.dispose(),
      this.execTracker?.dispose(),
      (this.execTracker = void 0),
      this.pty?.dispose(),
      (this.pty = void 0)
  }
  async doSpawn(H) {
    this.attempt++,
      (this.workerReady = !1),
      (this.resizeDeferred = !1),
      (this.ringSpawnMark = this.ring.length),
      (this.lastSpawnAt = Date.now())
    let _ = this.dispatch,
      q = b4(_.short)
    await sqH.mkdir(q, { recursive: !0 }).catch(() => {})
    let K =
        _.launch.mode === 'exec'
          ? void 0
          : await iqq(_.short, this.getAuthSnapshot?.()),
      O = _.launch.mode === 'resume' ? _.launch.sessionId : void 0,
      T = !1,
      z = !1,
      $ = _.sessionId,
      Y = _.respawnFlags
    if (this.attempt > 1) {
      let D = await o7(q)
      ;($ = D?.resumeSessionId ?? _.sessionId),
        (Y = D?.respawnFlags ?? _.respawnFlags)
      let f = await x$(_.cwd),
        X = lqq.join(_0(f), `${$}.jsonl`)
      if (
        ((T = await k$H(X)),
        (z = !T && O !== void 0 && !(await k$H(lqq.join(_0(f), `${O}.jsonl`)))),
        !T)
      )
        await sqH.unlink(X).catch(() => {})
    }
    if (
      this.phase.kind === 'retiring' ||
      this.phase.kind === 'retired' ||
      this.record.outcome
    )
      return
    if (z)
      return (
        this.patch({
          state: 'crashed',
          detail: `source session ${O} not found`,
        }),
        this.settle('crashed')
      )
    if (!this.spawnPty)
      return (
        this.patch({
          state: 'crashed',
          detail: 'Bun.Terminal unavailable (running under Node?)',
        }),
        c('tengu_bg_pty_unavailable', { short: this.dispatch.short }),
        this.settle('crashed')
      )
    let A = e64(_, this.attempt, T, $, Y),
      w = H84(_, q, K, this.rvSockPath ?? x__(_.short))
    if (this.attempt > 1 && T) w.CLAUDE_CODE_RESUME_INTERRUPTED_TURN = '1'
    if (H) Object.assign(w, H)
    let j = this.ptyCols || (_.cols ?? 200),
      J = this.ptyRows || (_.rows ?? 50),
      M
    try {
      let { cmd: D, prefixArgs: f } =
        _.launch.mode === 'exec'
          ? { cmd: _.launch.cmd, prefixArgs: [] }
          : WE({ pinToCurrentBinary: !0 })
      M = this.spawnPty(D, [...f, ...A], {
        cols: j,
        rows: J,
        cwd: _.cwd,
        env: w,
        ptySock: this.ptySockPath ?? BU(_.short),
        short: _.short,
      })
    } catch (D) {
      if (X6(D)) {
        let f = await sqH.access(_.cwd).then(
          () => !0,
          () => !1,
        )
        if (this.record.outcome) return
        if (!f) return this.settleCwdGone('cold')
        let X =
          _.launch.mode === 'exec'
            ? `${_.launch.cmd}: command not found`
            : 'daemon binary was deleted (upgrade in progress) \u2014 run your command again to use the new version'
        c('tengu_bg_spawn_binary_gone', {
          short: this.dispatch.short,
          attempt: this.attempt,
        }),
          this.patch({ state: 'crashed', detail: X })
        let P = `\r
\x1B[2m[${X}]\x1B[0m\r
`
        return this.pushRing(P), this.onStream.emit(P), this.settle('crashed')
      }
      return this.scheduleRespawn(LH(D))
    }
    if (_.launch.mode === 'exec')
      this.execTracker?.dispose(),
        (this.execTracker = dqq(q)),
        (this.workerReady = !0)
    if (n_() === 'windows')
      sqH.writeFile(xOH(_.short), String(M.pid)).catch(() => {})
    this.wirePty(M),
      this.rv?.close(),
      (this.rv = void 0),
      (this.lastRvHeartbeat = void 0),
      (this.stalledLogged = !1),
      this.connectRv(),
      this.patch({
        pid: M.pid,
        attempt: this.attempt,
        state: this.attempt > 1 ? 'resuming' : 'running',
        detail: '',
        cliVersion: {
          ISSUES_EXPLAINER:
            'report the issue at https://github.com/anthropics/claude-code/issues',
          PACKAGE_URL: '@anthropic-ai/claude-code',
          README_URL: 'https://code.claude.com/docs/en/overview',
          VERSION: '2.1.153',
          FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
          BUILD_TIME: '2026-05-27T20:03:21Z',
          GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
        }.VERSION,
      }),
      c('tengu_bg_worker_spawn', {
        short: this.dispatch.short,
        attempt: this.attempt,
        source: this.dispatch.source,
        launch_mode: this.dispatch.launch.mode,
      }),
      ey(M.pid, { skipCache: !0 }).then(D => {
        if (
          !D ||
          this.record.pid !== M.pid ||
          this.isDetached ||
          this.record.outcome
        )
          return
        ;(this.procStart = D), this.patch({ pid: M.pid })
      })
  }
  wirePty(H) {
    ;(this.pty = H),
      this.transitionTo({ kind: 'running' }),
      (this.decModes = fy_()),
      H.onResume?.(() => {
        this.rv?.send({ type: 'repaint' })
      }),
      (this.offData = H.onData(q => {
        if (this.decModes.feed(q) && this.record.pid)
          this.onState.emit({ pid: this.record.pid })
        this.execTracker?.feed(q),
          this.pushRing(q.includes(dSH) ? q.replaceAll(dSH, '') : q),
          this.onStream.emit(q)
      }))
    let _ = !1
    this.offExit = H.onExit(({ exitCode: q, signal: K }) => {
      if (_) return
      ;(_ = !0),
        this.offData?.dispose(),
        (this.execLastLine = this.execTracker?.lastLine),
        this.execTracker?.dispose(),
        (this.execTracker = void 0),
        (this.pty = void 0),
        this.onExit(q, K)
    })
  }
  pushRing(H) {
    if (
      (this.ring.push(H),
      (this.ringBytes += H.length),
      this.ringBytes > EV_ * 1.25 && this.ring.length > 1)
    ) {
      let _ = 0,
        q = 0
      while (this.ringBytes - q > EV_ && _ < this.ring.length - 1)
        (q += this.ring[_].length), _++
      this.ring.splice(0, _),
        (this.ringBytes -= q),
        (this.ringSpawnMark = Math.max(0, this.ringSpawnMark - _))
    }
  }
  patch(H) {
    Object.assign(this.record, H), this.onState.emit(H)
  }
  onExit(H, _) {
    if (this.isDetached) return
    if (this.phase.kind === 'retired') return
    let q = this.lastSpawnAt ? Date.now() - this.lastSpawnAt : void 0,
      K = q !== void 0 && q < a64 && H !== 0
    if (K) this.fastCrashStreak++
    else this.fastCrashStreak = 0
    let O = this.fastCrashStreak >= 3,
      T = this.workerReady ? void 0 : this.preInitErrorTail(),
      z = H !== 0 ? pp6(b4(this.dispatch.short)) : void 0,
      $ = K && !!z && z === this.lastExitCause
    this.lastExitCause = K ? z : void 0
    let Y = T ? ` \u2014 ${T}` : z ? ` \u2014 ${z}` : '',
      A =
        this.dispatch.launch.mode === 'exec' &&
        (_ === 'SIGINT' || _ === 'SIGQUIT'),
      w
    if (this.phase.kind === 'retiring' && this.phase.reason === 'reap')
      w = this.killOutcome
    else if (this.phase.kind === 'retiring' && this.phase.reason === 'grace')
      w = 'done'
    else if (this.phase.kind === 'upgrading') w = void 0
    else if (H === 0) w = 'done'
    else if (this.dispatch.launch.mode === 'exec') w = A ? 'killed' : 'crashed'
    else if (
      (!this.workerReady && (this.attempt >= 2 || T)) ||
      O ||
      $ ||
      this.attempt >= o64
    )
      w = 'crashed'
    if (
      (c('tengu_bg_worker_exit', {
        short: this.dispatch.short,
        code: H ?? void 0,
        signal: _,
        attempt: this.attempt,
        procUptimeMs: q,
        source: this.dispatch.source,
        launch_mode: this.dispatch.launch.mode,
        outcome: w,
        exitCause: z,
      }),
      this.phase.kind === 'retiring')
    )
      return this.settle(
        this.phase.reason === 'reap' ? this.killOutcome : 'done',
      )
    if (this.phase.kind === 'upgrading') {
      this.transitionTo({ kind: 'spawning' }),
        (this.attempt = 1),
        (this.fastCrashStreak = 0),
        (this.lastExitCause = void 0),
        this.patch({ pid: 0, state: 'starting', detail: 'upgrading' }),
        (this.procStart = void 0),
        this.buildBridgeReattachEnvFromState().then(J => this.doSpawn(J))
      return
    }
    if (H === 0) {
      if (this.dispatch.launch.mode === 'exec')
        this.patch({ detail: this.execLastLine || '(no output)' })
      return this.settle('done')
    }
    let j = _ ? `${_} (${H})` : `exit ${H}`
    if (this.dispatch.launch.mode === 'exec') {
      let J = this.execLastLine
      return (
        this.patch({
          state: A ? 'stopped' : 'crashed',
          detail: J ? `${j} \u2014 ${J}` : `${j}${Y}`,
        }),
        this.settle(A ? 'killed' : 'crashed')
      )
    }
    if (!this.workerReady && z === 'spare_postclaim:ENOENT')
      try {
        q84.accessSync(this.dispatch.cwd)
      } catch {
        return this.settleCwdGone('spare')
      }
    if (!this.workerReady && (this.attempt >= 2 || T))
      return (
        this.patch({ state: 'crashed', detail: `${j} before init${Y}` }),
        this.settle('crashed')
      )
    if (O || $)
      return (
        this.patch({
          state: 'crashed',
          detail: $
            ? `${j} \xD7${this.attempt}${Y}`
            : `${j} within ${a64 / 1000}s of spawn \xD7${this.fastCrashStreak}${Y}`,
        }),
        this.settle('crashed')
      )
    this.scheduleRespawn(`${j}${Y}`)
  }
  settleCwdGone(H) {
    let _ = `working directory no longer exists: ${this.dispatch.cwd}`
    c('tengu_bg_spawn_cwd_gone', {
      short: this.dispatch.short,
      attempt: this.attempt,
      via: H,
    }),
      this.patch({ state: 'crashed', detail: _ })
    let q = `\r
\x1B[2m[${_} \u2014 this job cannot be respawned]\x1B[0m\r
`
    this.pushRing(q), this.onStream.emit(q), this.settle('crashed')
  }
  async buildBridgeReattachEnvFromState() {
    let H = await o7(b4(this.dispatch.short)).catch(() => null)
    if (!H) return
    return VjH(H.bridgeSessionId, H.bridgeSessionSeq, H.bridgeOutboundOnly)
  }
  scheduleRespawn(H) {
    if (this.attempt >= o64)
      return (
        c('tengu_bg_respawn_exhausted', {
          short: this.dispatch.short,
          attempts: this.attempt,
        }),
        this.patch({ state: 'crashed', detail: H }),
        this.settle('crashed')
      )
    if (this.phase.kind === 'running') this.transitionTo({ kind: 'spawning' })
    this.patch({ pid: 0, state: 'crashed', detail: `${H}; respawning` }),
      (this.procStart = void 0)
    let _ = `\r
\x1B[2m[worker crashed (${H}) \u2014 respawning\u2026]\x1B[0m\r
`
    this.pushRing(_),
      this.onStream.emit(_),
      (this.backoffTimer = setTimeout(() => {
        if (
          ((this.backoffTimer = null),
          this.phase.kind !== 'retiring' && this.phase.kind !== 'retired')
        )
          this.doSpawn()
      }, $fO)),
      this.backoffTimer.unref()
  }
  settle(H) {
    if (this.record.outcome) return
    c('tengu_bg_settle', {
      short: this.dispatch.short,
      outcome: H,
      uptimeMs: Date.now() - this.record.startedAt,
      attempt: this.attempt,
    }),
      this.transitionTo({ kind: 'retired', outcome: H }),
      this.clearLiveness(),
      this.patch({ outcome: H, settledAt: Date.now(), tempo: 'idle' }),
      this.onSettle.emit(H)
  }
  connectRv() {
    if (this.rv || this.isDetached || this.record.outcome) return
    if (this.dispatch.launch.mode === 'exec') {
      this.startPidPoll()
      return
    }
    ;(this.rv = i64(
      this.rvSockPath ?? x__(this.dispatch.short),
      H => {
        if (H.type === 'heartbeat') this.lastRvHeartbeat = Date.now()
        else if (H.type === 'done') this.settle(H.outcome)
        else if (H.type === 'state') this.patch(H.patch)
        else if (H.type === 'detach-request') this.onStream.emit(MqH(H.msg))
        else if (H.type === 'repaint-done') this.onRepaintDone.emit()
      },
      () => void this.checkPid(),
      () => {
        if (((this.workerReady = !0), this.resizeDeferred))
          (this.resizeDeferred = !1), this.resize(this.ptyCols, this.ptyRows)
        if (this.attachers.size > 0) {
          let H = [...this.attachers.values()].at(-1)
          this.sendAttacherCaps(H.caps ?? null)
        } else this.sendAttacherCaps(null)
      },
    )),
      this.startPidPoll()
  }
  startPidPoll() {
    if (this.pidPoll) return
    ;(this.lastCheckPidAt = Date.now()),
      (this.pidPoll = setInterval(() => void this.checkPid(!0), cqq)),
      this.pidPoll.unref()
  }
  pidRecycled() {
    if (!this.procStart || !this.record.pid) return !1
    let H = VKH(this.record.pid)
    return H !== void 0 && H !== this.procStart
  }
  async pidRecycledAsync() {
    if (!this.procStart || !this.record.pid) return !1
    let H = await ey(this.record.pid)
    return H !== void 0 && H !== this.procStart
  }
  pidPollTick = 0
  async checkPid(H = !1) {
    if (this.record.outcome || !this.record.pid) return
    let _ = Date.now() - this.lastCheckPidAt
    this.lastCheckPidAt = Date.now()
    let q = _ > cqq * 3
    if (q && this.lastRvHeartbeat !== void 0) this.lastRvHeartbeat = Date.now()
    if (!this.pty)
      try {
        process.kill(this.record.pid, 0)
      } catch (O) {
        let T = f6(O)
        if (T === 'ESRCH' || T === 'EPERM')
          this.logVanished(!1, H),
            this.settle(this.isKilling ? 'killed' : 'crashed')
        return
      }
    let K = this.lastRvHeartbeat
    if (!q && !this.stalledLogged && K !== void 0 && Date.now() - K > YfO) {
      let O = await o7(b4(this.dispatch.short))
      if (!this.stalledLogged && (O?.tempo ?? this.record.tempo) === 'active')
        (this.stalledLogged = !0),
          c('tengu_bg_worker_stalled', {
            short: this.dispatch.short,
            sinceMs: Date.now() - K,
          })
    }
    if (this.pty) return
    if (H && this.pidPollTick++ % 12 !== 0) return
    if (await this.pidRecycledAsync()) {
      if (this.record.outcome || this.pty) return
      this.logVanished(!0, H),
        this.settle(this.isKilling ? 'killed' : 'crashed')
    }
  }
  logVanished(H, _) {
    if (this.isKilling) return
    c('tengu_bg_worker_vanished', {
      short: this.dispatch.short,
      recycled: H,
      fromPoll: _,
      uptimeMs: Date.now() - this.record.startedAt,
    })
  }
  clearLiveness() {
    if (this.pidPoll) clearInterval(this.pidPoll), (this.pidPoll = null)
    this.rv?.close(),
      (this.rv = void 0),
      (this.lastRvHeartbeat = void 0),
      (this.stalledLogged = !1)
  }
}
var q84,
  sqH,
  lqq,
  $fO = 1e4,
  o64 = 20,
  a64 = 5000,
  s64 = 200,
  cqq = 5000,
  YfO = 120000,
  AfO = 120000,
  wfO = 300000,
  t64 = 4096,
  rqq
var oqq = R(() => {
  Mk()
  YY()
  N_()
  lH()
  W_()
  OX()
  $9()
  KXH()
  nj()
  $A()
  p6q()
  p64()
  nv()
  cv()
  d64()
  QSH()
  Gy_()
  r64()
  Ln()
  ;(q84 = require('fs')),
    (sqH = require('fs/promises')),
    (lqq = require('path'))
  rqq = [
    'CLAUDE_CODE_QUESTION_PREVIEW_FORMAT',
    'GITHUB_ACTIONS',
    'CLAUDECODE',
    'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CODE_EXECPATH',
    'CLAUDE_CODE_COORDINATOR_MODE',
    'TERM_PROGRAM',
    'TERM_PROGRAM_VERSION',
    '__CFBundleIdentifier',
    'KITTY_WINDOW_ID',
    'WT_SESSION',
    'KONSOLE_VERSION',
    'VTE_VERSION',
    'ZED_TERM',
    'ZELLIJ',
    'TMUX',
    'TMUX_PANE',
    'STY',
    'LC_TERMINAL',
    'SSH_CONNECTION',
    'SSH_CLIENT',
    'SSH_TTY',
    'COLORFGBG',
    'CURSOR_TRACE_ID',
    'GIT_ASKPASS',
    'SSH_ASKPASS',
    'SSH_ASKPASS_REQUIRE',
    'VSCODE_GIT_ASKPASS_MAIN',
    'VSCODE_GIT_ASKPASS_NODE',
    'VSCODE_GIT_ASKPASS_EXTRA_ARGS',
    'VSCODE_GIT_IPC_HANDLE',
    'TERMINAL_EMULATOR',
    'ITERM_SESSION_ID',
    'GNOME_TERMINAL_SERVICE',
    'XTERM_VERSION',
    'ALACRITTY_LOG',
    'TILIX_ID',
    'TERMINATOR_UUID',
    'ConEmuANSI',
    'ConEmuPID',
    'ConEmuTask',
    'MSYSTEM',
    'CLAUDE_CODE_SSE_PORT',
    'FORCE_CODE_TERMINAL',
  ]
})
var ry_ = i(sqq => {
  class aqq extends Error {
    constructor(H, _, q) {
      super(q)
      Error.captureStackTrace(this, this.constructor),
        (this.name = this.constructor.name),
        (this.code = _),
        (this.exitCode = H),
        (this.nestedError = void 0)
    }
  }
  class K84 extends aqq {
    constructor(H) {
      super(1, 'commander.invalidArgument', H)
      Error.captureStackTrace(this, this.constructor),
        (this.name = this.constructor.name)
    }
  }
  sqq.CommanderError = aqq
  sqq.InvalidArgumentError = K84
})
var Ih6 = i(tqq => {
  var { InvalidArgumentError: JfO } = ry_()
  class O84 {
    constructor(H, _) {
      switch (
        ((this.description = _ || ''),
        (this.variadic = !1),
        (this.parseArg = void 0),
        (this.defaultValue = void 0),
        (this.defaultValueDescription = void 0),
        (this.argChoices = void 0),
        H[0])
      ) {
        case '<':
          ;(this.required = !0), (this._name = H.slice(1, -1))
          break
        case '[':
          ;(this.required = !1), (this._name = H.slice(1, -1))
          break
        default:
          ;(this.required = !0), (this._name = H)
          break
      }
      if (this._name.length > 3 && this._name.slice(-3) === '...')
        (this.variadic = !0), (this._name = this._name.slice(0, -3))
    }
    name() {
      return this._name
    }
    _concatValue(H, _) {
      if (_ === this.defaultValue || !Array.isArray(_)) return [H]
      return _.concat(H)
    }
    default(H, _) {
      return (this.defaultValue = H), (this.defaultValueDescription = _), this
    }
    argParser(H) {
      return (this.parseArg = H), this
    }
    choices(H) {
      return (
        (this.argChoices = H.slice()),
        (this.parseArg = (_, q) => {
          if (!this.argChoices.includes(_))
            throw new JfO(`Allowed choices are ${this.argChoices.join(', ')}.`)
          if (this.variadic) return this._concatValue(_, q)
          return _
        }),
        this
      )
    }
    argRequired() {
      return (this.required = !0), this
    }
    argOptional() {
      return (this.required = !1), this
    }
  }
  function MfO(H) {
    let _ = H.name() + (H.variadic === !0 ? '...' : '')
    return H.required ? '<' + _ + '>' : '[' + _ + ']'
  }
  tqq.Argument = O84
  tqq.humanReadableArgName = MfO
})
var eqq = i(z84 => {
  var { humanReadableArgName: DfO } = Ih6()
  class T84 {
    constructor() {
      ;(this.helpWidth = void 0),
        (this.sortSubcommands = !1),
        (this.sortOptions = !1),
        (this.showGlobalOptions = !1)
    }
    visibleCommands(H) {
      let _ = H.commands.filter(K => !K._hidden),
        q = H._getHelpCommand()
      if (q && !q._hidden) _.push(q)
      if (this.sortSubcommands)
        _.sort((K, O) => {
          return K.name().localeCompare(O.name())
        })
      return _
    }
    compareOptions(H, _) {
      let q = K => {
        return K.short ? K.short.replace(/^-/, '') : K.long.replace(/^--/, '')
      }
      return q(H).localeCompare(q(_))
    }
    visibleOptions(H) {
      let _ = H.options.filter(K => !K.hidden),
        q = H._getHelpOption()
      if (q && !q.hidden) {
        let K = q.short && H._findOption(q.short),
          O = q.long && H._findOption(q.long)
        if (!K && !O) _.push(q)
        else if (q.long && !O) _.push(H.createOption(q.long, q.description))
        else if (q.short && !K) _.push(H.createOption(q.short, q.description))
      }
      if (this.sortOptions) _.sort(this.compareOptions)
      return _
    }
    visibleGlobalOptions(H) {
      if (!this.showGlobalOptions) return []
      let _ = []
      for (let q = H.parent; q; q = q.parent) {
        let K = q.options.filter(O => !O.hidden)
        _.push(...K)
      }
      if (this.sortOptions) _.sort(this.compareOptions)
      return _
    }
    visibleArguments(H) {
      if (H._argsDescription)
        H.registeredArguments.forEach(_ => {
          _.description = _.description || H._argsDescription[_.name()] || ''
        })
      if (H.registeredArguments.find(_ => _.description))
        return H.registeredArguments
      return []
    }
    subcommandTerm(H) {
      let _ = H.registeredArguments.map(q => DfO(q)).join(' ')
      return (
        H._name +
        (H._aliases[0] ? '|' + H._aliases[0] : '') +
        (H.options.length ? ' [options]' : '') +
        (_ ? ' ' + _ : '')
      )
    }
    optionTerm(H) {
      return H.flags
    }
    argumentTerm(H) {
      return H.name()
    }
    longestSubcommandTermLength(H, _) {
      return _.visibleCommands(H).reduce((q, K) => {
        return Math.max(q, _.subcommandTerm(K).length)
      }, 0)
    }
    longestOptionTermLength(H, _) {
      return _.visibleOptions(H).reduce((q, K) => {
        return Math.max(q, _.optionTerm(K).length)
      }, 0)
    }
    longestGlobalOptionTermLength(H, _) {
      return _.visibleGlobalOptions(H).reduce((q, K) => {
        return Math.max(q, _.optionTerm(K).length)
      }, 0)
    }
    longestArgumentTermLength(H, _) {
      return _.visibleArguments(H).reduce((q, K) => {
        return Math.max(q, _.argumentTerm(K).length)
      }, 0)
    }
    commandUsage(H) {
      let _ = H._name
      if (H._aliases[0]) _ = _ + '|' + H._aliases[0]
      let q = ''
      for (let K = H.parent; K; K = K.parent) q = K.name() + ' ' + q
      return q + _ + ' ' + H.usage()
    }
    commandDescription(H) {
      return H.description()
    }
    subcommandDescription(H) {
      return H.summary() || H.description()
    }
    optionDescription(H) {
      let _ = []
      if (H.argChoices)
        _.push(
          `choices: ${H.argChoices.map(q => JSON.stringify(q)).join(', ')}`,
        )
      if (H.defaultValue !== void 0) {
        if (
          H.required ||
          H.optional ||
          (H.isBoolean() && typeof H.defaultValue === 'boolean')
        )
          _.push(
            `default: ${H.defaultValueDescription || JSON.stringify(H.defaultValue)}`,
          )
      }
      if (H.presetArg !== void 0 && H.optional)
        _.push(`preset: ${JSON.stringify(H.presetArg)}`)
      if (H.envVar !== void 0) _.push(`env: ${H.envVar}`)
      if (_.length > 0) return `${H.description} (${_.join(', ')})`
      return H.description
    }
    argumentDescription(H) {
      let _ = []
      if (H.argChoices)
        _.push(
          `choices: ${H.argChoices.map(q => JSON.stringify(q)).join(', ')}`,
        )
      if (H.defaultValue !== void 0)
        _.push(
          `default: ${H.defaultValueDescription || JSON.stringify(H.defaultValue)}`,
        )
      if (_.length > 0) {
        let q = `(${_.join(', ')})`
        if (H.description) return `${H.description} ${q}`
        return q
      }
      return H.description
    }
    formatHelp(H, _) {
      let q = _.padWidth(H, _),
        K = _.helpWidth || 80,
        O = 2,
        T = 2
      function z(M, D) {
        if (D) {
          let f = `${M.padEnd(q + 2)}${D}`
          return _.wrap(f, K - 2, q + 2)
        }
        return M
      }
      function $(M) {
        return M.join(`
`).replace(/^/gm, ' '.repeat(2))
      }
      let Y = [`Usage: ${_.commandUsage(H)}`, ''],
        A = _.commandDescription(H)
      if (A.length > 0) Y = Y.concat([_.wrap(A, K, 0), ''])
      let w = _.visibleArguments(H).map(M => {
        return z(_.argumentTerm(M), _.argumentDescription(M))
      })
      if (w.length > 0) Y = Y.concat(['Arguments:', $(w), ''])
      let j = _.visibleOptions(H).map(M => {
        return z(_.optionTerm(M), _.optionDescription(M))
      })
      if (j.length > 0) Y = Y.concat(['Options:', $(j), ''])
      if (this.showGlobalOptions) {
        let M = _.visibleGlobalOptions(H).map(D => {
          return z(_.optionTerm(D), _.optionDescription(D))
        })
        if (M.length > 0) Y = Y.concat(['Global Options:', $(M), ''])
      }
      let J = _.visibleCommands(H).map(M => {
        return z(_.subcommandTerm(M), _.subcommandDescription(M))
      })
      if (J.length > 0) Y = Y.concat(['Commands:', $(J), ''])
      return Y.join(`
`)
    }
    padWidth(H, _) {
      return Math.max(
        _.longestOptionTermLength(H, _),
        _.longestGlobalOptionTermLength(H, _),
        _.longestSubcommandTermLength(H, _),
        _.longestArgumentTermLength(H, _),
      )
    }
    wrap(H, _, q, K = 40) {
      let T = new RegExp(
        `[\\n][${' \\f\\t\\v\xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF'}]+`,
      )
      if (H.match(T)) return H
      let z = _ - q
      if (z < K) return H
      let $ = H.slice(0, q),
        Y = H.slice(q).replace(
          `\r
`,
          `
`,
        ),
        A = ' '.repeat(q),
        j = `\\s${'\u200B'}`,
        J = new RegExp(
          `
|.{1,${z - 1}}([${j}]|$)|[^${j}]+?([${j}]|$)`,
          'g',
        ),
        M = Y.match(J) || []
      return (
        $ +
        M.map((D, f) => {
          if (
            D ===
            `
`
          )
            return ''
          return (f > 0 ? A : '') + D.trimEnd()
        }).join(`
`)
      )
    }
  }
  z84.Help = T84
})
var _9q = i(H9q => {
  var { InvalidArgumentError: ffO } = ry_()
  class $84 {
    constructor(H, _) {
      ;(this.flags = H),
        (this.description = _ || ''),
        (this.required = H.includes('<')),
        (this.optional = H.includes('[')),
        (this.variadic = /\w\.\.\.[>\]]$/.test(H)),
        (this.mandatory = !1)
      let q = PfO(H)
      if (
        ((this.short = q.shortFlag),
        (this.long = q.longFlag),
        (this.negate = !1),
        this.long)
      )
        this.negate = this.long.startsWith('--no-')
      ;(this.defaultValue = void 0),
        (this.defaultValueDescription = void 0),
        (this.presetArg = void 0),
        (this.envVar = void 0),
        (this.parseArg = void 0),
        (this.hidden = !1),
        (this.argChoices = void 0),
        (this.conflictsWith = []),
        (this.implied = void 0)
    }
    default(H, _) {
      return (this.defaultValue = H), (this.defaultValueDescription = _), this
    }
    preset(H) {
      return (this.presetArg = H), this
    }
    conflicts(H) {
      return (this.conflictsWith = this.conflictsWith.concat(H)), this
    }
    implies(H) {
      let _ = H
      if (typeof H === 'string') _ = { [H]: !0 }
      return (this.implied = Object.assign(this.implied || {}, _)), this
    }
    env(H) {
      return (this.envVar = H), this
    }
    argParser(H) {
      return (this.parseArg = H), this
    }
    makeOptionMandatory(H = !0) {
      return (this.mandatory = !!H), this
    }
    hideHelp(H = !0) {
      return (this.hidden = !!H), this
    }
    _concatValue(H, _) {
      if (_ === this.defaultValue || !Array.isArray(_)) return [H]
      return _.concat(H)
    }
    choices(H) {
      return (
        (this.argChoices = H.slice()),
        (this.parseArg = (_, q) => {
          if (!this.argChoices.includes(_))
            throw new ffO(`Allowed choices are ${this.argChoices.join(', ')}.`)
          if (this.variadic) return this._concatValue(_, q)
          return _
        }),
        this
      )
    }
    name() {
      if (this.long) return this.long.replace(/^--/, '')
      return this.short.replace(/^-/, '')
    }
    attributeName() {
      return XfO(this.name().replace(/^no-/, ''))
    }
    is(H) {
      return this.short === H || this.long === H
    }
    isBoolean() {
      return !this.required && !this.optional && !this.negate
    }
  }
  class Y84 {
    constructor(H) {
      ;(this.positiveOptions = new Map()),
        (this.negativeOptions = new Map()),
        (this.dualOptions = new Set()),
        H.forEach(_ => {
          if (_.negate) this.negativeOptions.set(_.attributeName(), _)
          else this.positiveOptions.set(_.attributeName(), _)
        }),
        this.negativeOptions.forEach((_, q) => {
          if (this.positiveOptions.has(q)) this.dualOptions.add(q)
        })
    }
    valueFromOption(H, _) {
      let q = _.attributeName()
      if (!this.dualOptions.has(q)) return !0
      let K = this.negativeOptions.get(q).presetArg,
        O = K !== void 0 ? K : !1
      return _.negate === (O === H)
    }
  }
  function XfO(H) {
    return H.split('-').reduce((_, q) => {
      return _ + q[0].toUpperCase() + q.slice(1)
    })
  }
  function PfO(H) {
    let _,
      q,
      K = H.split(/[ |,]+/)
    if (K.length > 1 && !/^[[<]/.test(K[1])) _ = K.shift()
    if (((q = K.shift()), !_ && /^-[^-]$/.test(q))) (_ = q), (q = void 0)
    return { shortFlag: _, longFlag: q }
  }
  H9q.Option = $84
  H9q.DualOptions = Y84
})
var w84 = i(A84 => {
  function WfO(H, _) {
    if (Math.abs(H.length - _.length) > 3) return Math.max(H.length, _.length)
    let q = []
    for (let K = 0; K <= H.length; K++) q[K] = [K]
    for (let K = 0; K <= _.length; K++) q[0][K] = K
    for (let K = 1; K <= _.length; K++)
      for (let O = 1; O <= H.length; O++) {
        let T = 1
        if (H[O - 1] === _[K - 1]) T = 0
        else T = 1
        if (
          ((q[O][K] = Math.min(
            q[O - 1][K] + 1,
            q[O][K - 1] + 1,
            q[O - 1][K - 1] + T,
          )),
          O > 1 && K > 1 && H[O - 1] === _[K - 2] && H[O - 2] === _[K - 1])
        )
          q[O][K] = Math.min(q[O][K], q[O - 2][K - 2] + 1)
      }
    return q[H.length][_.length]
  }
  function ZfO(H, _) {
    if (!_ || _.length === 0) return ''
    _ = Array.from(new Set(_))
    let q = H.startsWith('--')
    if (q) (H = H.slice(2)), (_ = _.map(z => z.slice(2)))
    let K = [],
      O = 3,
      T = 0.4
    if (
      (_.forEach(z => {
        if (z.length <= 1) return
        let $ = WfO(H, z),
          Y = Math.max(H.length, z.length)
        if ((Y - $) / Y > T) {
          if ($ < O) (O = $), (K = [z])
          else if ($ === O) K.push(z)
        }
      }),
      K.sort((z, $) => z.localeCompare($)),
      q)
    )
      K = K.map(z => `--${z}`)
    if (K.length > 1)
      return `
(Did you mean one of ${K.join(', ')}?)`
    if (K.length === 1)
      return `
(Did you mean ${K[0]}?)`
    return ''
  }
  A84.suggestSimilar = ZfO
})
var f84=i((D84)=>{var GfO=require("events").EventEmitter,q9q=require("child_process"),kTH=require("path"),K9q=require("fs"),UW=require("process"),{Argument:RfO,humanReadableArgName:LfO}=Ih6(),{CommanderError:O9q}=ry_(),{Help:kfO}=eqq(),{Option:j84,DualOptions:VfO}=_9q(),{suggestSimilar:J84}=w84();class T9q extends GfO{constructor(H){super();this.commands=[],this.options=[],this.parent=null,this._allowUnknownOption=!1,this._allowExcessArguments=!0,this.registeredArguments=[],this._args=this.registeredArguments,this.args=[],this.rawArgs=[],this.processedArgs=[],this._scriptPath=null,this._name=H||"",this._optionValues={},this._optionValueSources={},this._storeOptionsAsProperties=!1,this._actionHandler=null,this._executableHandler=!1,this._executableFile=null,this._executableDir=null,this._defaultCommandName=null,this._exitCallback=null,this._aliases=[],this._combineFlagAndOptionalValue=!0,this._description="",this._summary="",this._argsDescription=void 0,this._enablePositionalOptions=!1,this._passThroughOptions=!1,this._lifeCycleHooks={},this._showHelpAfterError=!1,this._showSuggestionAfterError=!0,this._outputConfiguration={writeOut:(_)=>UW.stdout.write(_),writeErr:(_)=>UW.stderr.write(_),getOutHelpWidth:()=>UW.stdout.isTTY?UW.stdout.columns:void 0,getErrHelpWidth:()=>UW.stderr.isTTY?UW.stderr.columns:void 0,outputError:(_,q)=>q(_)},this._hidden=!1,this._helpOption=void 0,this._addImplicitHelpCommand=void 0,this._helpCommand=void 0,this._helpConfiguration={}}copyInheritedSettings(H){return this._outputConfiguration=H._outputConfiguration,this._helpOption=H._helpOption,this._helpCommand=H._helpCommand,this._helpConfiguration=H._helpConfiguration,this._exitCallback=H._exitCallback,this._storeOptionsAsProperties=H._storeOptionsAsProperties,this._combineFlagAndOptionalValue=H._combineFlagAndOptionalValue,this._allowExcessArguments=H._allowExcessArguments,this._enablePositionalOptions=H._enablePositionalOptions,this._showHelpAfterError=H._showHelpAfterError,this._showSuggestionAfterError=H._showSuggestionAfterError,this}_getCommandAndAncestors(){let H=[];for(let _=this;_;_=_.parent)H.push(_);return H}command(H,_,q){let K=_,O=q;if(typeof K==="object"&&K!==null)O=K,K=null;O=O||{};let[,T,z]=H.match(/([^ ]+) *(.*)/),$=this.createCommand(T);if(K)$.description(K),$._executableHandler=!0;if(O.isDefault)this._defaultCommandName=$._name;if($._hidden=!!(O.noHelp||O.hidden),$._executableFile=O.executableFile||null,z)$.arguments(z);if(this._registerCommand($),$.parent=this,$.copyInheritedSettings(this),K)return this;return $}createCommand(H){return new T9q(H)}createHelp(){return Object.assign(new kfO,this.configureHelp())}configureHelp(H){if(H===void 0)return this._helpConfiguration;return this._helpConfiguration=H,this}configureOutput(H){if(H===void 0)return this._outputConfiguration;return Object.assign(this._outputConfiguration,H),this}showHelpAfterError(H=!0){if(typeof H!=="string")H=!!H;return this._showHelpAfterError=H,this}showSuggestionAfterError(H=!0){return this._showSuggestionAfterError=!!H,this}addCommand(H,_){if(!H._name)throw Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);if(_=_||{},_.isDefault)this._defaultCommandName=H._name;if(_.noHelp||_.hidden)H._hidden=!0;return this._registerCommand(H),H.parent=this,H._checkForBrokenPassThrough(),this}createArgument(H,_){return new RfO(H,_)}argument(H,_,q,K){let O=this.createArgument(H,_);if(typeof q==="function")O.default(K).argParser(q);else O.default(q);return this.addArgument(O),this}arguments(H){return H.trim().split(/ +/).forEach((_)=>{this.argument(_)}),this}addArgument(H){let _=this.registeredArguments.slice(-1)[0];if(_&&_.variadic)throw Error(`only the last argument can be variadic '${_.name()}'`);if(H.required&&H.defaultValue!==void 0&&H.parseArg===void 0)throw Error(`a default value for a required argument is never used: '${H.name()}'`);return this.registeredArguments.push(H),this}helpCommand(H,_){if(typeof H==="boolean")return this._addImplicitHelpCommand=H,this;H=H??"help [command]";let[,q,K]=H.match(/([^ ]+) *(.*)/),O=_??"display help for command",T=this.createCommand(q);if(T.helpOption(!1),K)T.arguments(K);if(O)T.description(O);return this._addImplicitHelpCommand=!0,this._helpCommand=T,this}addHelpCommand(H,_){if(typeof H!=="object")return this.helpCommand(H,_),this;return this._addImplicitHelpCommand=!0,this._helpCommand=H,this}_getHelpCommand(){if(this._addImplicitHelpCommand??(this.commands.length&&!this._actionHandler&&!this._findCommand("help"))){if(this._helpCommand===void 0)this.helpCommand(void 0,void 0);return this._helpCommand}return null}hook(H,_){let q=["preSubcommand","preAction","postAction"];if(!q.includes(H))throw Error(`Unexpected value for event passed to hook : '${H}'.
Expecting one of '${q.join("', '")}'`);if(this._lifeCycleHooks[H])this._lifeCycleHooks[H].push(_);else this._lifeCycleHooks[H]=[_];return this}exitOverride(H){if(H)this._exitCallback=H;else this._exitCallback=(_)=>{if(_.code!=="commander.executeSubCommandAsync")throw _};return this}_exit(H,_,q){if(this._exitCallback)this._exitCallback(new O9q(H,_,q));UW.exit(H)}action(H){let _=(q)=>{let K=this.registeredArguments.length,O=q.slice(0,K);if(this._storeOptionsAsProperties)O[K]=this;else O[K]=this.opts();return O.push(this),H.apply(this,O)};return this._actionHandler=_,this}createOption(H,_){return new j84(H,_)}_callParseArg(H,_,q,K){try{return H.parseArg(_,q)}catch(O){if(O.code==="commander.invalidArgument"){let T=`${K} ${O.message}`;this.error(T,{exitCode:O.exitCode,code:O.code})}throw O}}_registerOption(H){let _=H.short&&this._findOption(H.short)||H.long&&this._findOption(H.long);if(_){let q=H.long&&this._findOption(H.long)?H.long:H.short;throw Error(`Cannot add option '${H.flags}'${this._name&&` to command '${this._name}'`} due to conflicting flag '${q}'
-  already used by option '${_.flags}'`)}this.options.push(H)}_registerCommand(H){let _=(K)=>{return[K.name()].concat(K.aliases())},q=_(H).find((K)=>this._findCommand(K));if(q){let K=_(this._findCommand(q)).join("|"),O=_(H).join("|");throw Error(`cannot add command '${O}' as already have command '${K}'`)}this.commands.push(H)}addOption(H){this._registerOption(H);let _=H.name(),q=H.attributeName();if(H.negate){let O=H.long.replace(/^--no-/,"--");if(!this._findOption(O))this.setOptionValueWithSource(q,H.defaultValue===void 0?!0:H.defaultValue,"default")}else if(H.defaultValue!==void 0)this.setOptionValueWithSource(q,H.defaultValue,"default");let K=(O,T,z)=>{if(O==null&&H.presetArg!==void 0)O=H.presetArg;let $=this.getOptionValue(q);if(O!==null&&H.parseArg)O=this._callParseArg(H,O,$,T);else if(O!==null&&H.variadic)O=H._concatValue(O,$);if(O==null)if(H.negate)O=!1;else if(H.isBoolean()||H.optional)O=!0;else O="";this.setOptionValueWithSource(q,O,z)};if(this.on("option:"+_,(O)=>{let T=`error: option '${H.flags}' argument '${O}' is invalid.`;K(O,T,"cli")}),H.envVar)this.on("optionEnv:"+_,(O)=>{let T=`error: option '${H.flags}' value '${O}' from env '${H.envVar}' is invalid.`;K(O,T,"env")});return this}_optionEx(H,_,q,K,O){if(typeof _==="object"&&_ instanceof j84)throw Error("To add an Option object use addOption() instead of option() or requiredOption()");let T=this.createOption(_,q);if(T.makeOptionMandatory(!!H.mandatory),typeof K==="function")T.default(O).argParser(K);else if(K instanceof RegExp){let z=K;K=($,Y)=>{let A=z.exec($);return A?A[0]:Y},T.default(O).argParser(K)}else T.default(K);return this.addOption(T)}option(H,_,q,K){return this._optionEx({},H,_,q,K)}requiredOption(H,_,q,K){return this._optionEx({mandatory:!0},H,_,q,K)}combineFlagAndOptionalValue(H=!0){return this._combineFlagAndOptionalValue=!!H,this}allowUnknownOption(H=!0){return this._allowUnknownOption=!!H,this}allowExcessArguments(H=!0){return this._allowExcessArguments=!!H,this}enablePositionalOptions(H=!0){return this._enablePositionalOptions=!!H,this}passThroughOptions(H=!0){return this._passThroughOptions=!!H,this._checkForBrokenPassThrough(),this}_checkForBrokenPassThrough(){if(this.parent&&this._passThroughOptions&&!this.parent._enablePositionalOptions)throw Error(`passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`)}storeOptionsAsProperties(H=!0){if(this.options.length)throw Error("call .storeOptionsAsProperties() before adding options");if(Object.keys(this._optionValues).length)throw Error("call .storeOptionsAsProperties() before setting option values");return this._storeOptionsAsProperties=!!H,this}getOptionValue(H){if(this._storeOptionsAsProperties)return this[H];return this._optionValues[H]}setOptionValue(H,_){return this.setOptionValueWithSource(H,_,void 0)}setOptionValueWithSource(H,_,q){if(this._storeOptionsAsProperties)this[H]=_;else this._optionValues[H]=_;return this._optionValueSources[H]=q,this}getOptionValueSource(H){return this._optionValueSources[H]}getOptionValueSourceWithGlobals(H){let _;return this._getCommandAndAncestors().forEach((q)=>{if(q.getOptionValueSource(H)!==void 0)_=q.getOptionValueSource(H)}),_}_prepareUserArgs(H,_){if(H!==void 0&&!Array.isArray(H))throw Error("first parameter to parse must be array or undefined");if(_=_||{},H===void 0&&_.from===void 0){if(UW.versions?.electron)_.from="electron";let K=UW.execArgv??[];if(K.includes("-e")||K.includes("--eval")||K.includes("-p")||K.includes("--print"))_.from="eval"}if(H===void 0)H=UW.argv;this.rawArgs=H.slice();let q;switch(_.from){case void 0:case"node":this._scriptPath=H[1],q=H.slice(2);break;case"electron":if(UW.defaultApp)this._scriptPath=H[1],q=H.slice(2);else q=H.slice(1);break;case"user":q=H.slice(0);break;case"eval":q=H.slice(1);break;default:throw Error(`unexpected parse option { from: '${_.from}' }`)}if(!this._name&&this._scriptPath)this.nameFromFilename(this._scriptPath);return this._name=this._name||"program",q}parse(H,_){let q=this._prepareUserArgs(H,_);return this._parseCommand([],q),this}async parseAsync(H,_){let q=this._prepareUserArgs(H,_);return await this._parseCommand([],q),this}_executeSubCommand(H,_){_=_.slice();let q=!1,K=[".js",".ts",".tsx",".mjs",".cjs"];function O(A,w){let j=kTH.resolve(A,w);if(K9q.existsSync(j))return j;if(K.includes(kTH.extname(w)))return;let J=K.find((M)=>K9q.existsSync(`${j}${M}`));if(J)return`${j}${J}`;return}this._checkForMissingMandatoryOptions(),this._checkForConflictingOptions();let T=H._executableFile||`${this._name}-${H._name}`,z=this._executableDir||"";if(this._scriptPath){let A;try{A=K9q.realpathSync(this._scriptPath)}catch(w){A=this._scriptPath}z=kTH.resolve(kTH.dirname(A),z)}if(z){let A=O(z,T);if(!A&&!H._executableFile&&this._scriptPath){let w=kTH.basename(this._scriptPath,kTH.extname(this._scriptPath));if(w!==this._name)A=O(z,`${w}-${H._name}`)}T=A||T}q=K.includes(kTH.extname(T));let $;if(UW.platform!=="win32")if(q)_.unshift(T),_=M84(UW.execArgv).concat(_),$=q9q.spawn(UW.argv[0],_,{stdio:"inherit"});else $=q9q.spawn(T,_,{stdio:"inherit"});else _.unshift(T),_=M84(UW.execArgv).concat(_),$=q9q.spawn(UW.execPath,_,{stdio:"inherit"});if(!$.killed)["SIGUSR1","SIGUSR2","SIGTERM","SIGINT","SIGHUP"].forEach((w)=>{UW.on(w,()=>{if($.killed===!1&&$.exitCode===null)$.kill(w)})});let Y=this._exitCallback;$.on("close",(A)=>{if(A=A??1,!Y)UW.exit(A);else Y(new O9q(A,"commander.executeSubCommandAsync","(close)"))}),$.on("error",(A)=>{if(A.code==="ENOENT"){let w=z?`searched for local subcommand relative to directory '${z}'`:"no directory for search for local subcommand, use .executableDir() to supply a custom directory",j=`'${T}' does not exist
 - if '${H._name}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${w}`;throw Error(j)}else if(A.code==="EACCES")throw Error(`'${T}' not executable`);if(!Y)UW.exit(1);else{let w=new O9q(1,"commander.executeSubCommandAsync","(error)");w.nestedError=A,Y(w)}}),this.runningCommand=$}_dispatchSubcommand(H,_,q){let K=this._findCommand(H);if(!K)this.help({error:!0});let O;return O=this._chainOrCallSubCommandHook(O,K,"preSubcommand"),O=this._chainOrCall(O,()=>{if(K._executableHandler)this._executeSubCommand(K,_.concat(q));else return K._parseCommand(_,q)}),O}_dispatchHelpCommand(H){if(!H)this.help();let _=this._findCommand(H);if(_&&!_._executableHandler)_.help();return this._dispatchSubcommand(H,[],[this._getHelpOption()?.long??this._getHelpOption()?.short??"--help"])}_checkNumberOfArguments(){if(this.registeredArguments.forEach((H,_)=>{if(H.required&&this.args[_]==null)this.missingArgument(H.name())}),this.registeredArguments.length>0&&this.registeredArguments[this.registeredArguments.length-1].variadic)return;if(this.args.length>this.registeredArguments.length)this._excessArguments(this.args)}_processArguments(){let H=(q,K,O)=>{let T=K;if(K!==null&&q.parseArg){let z=`error: command-argument value '${K}' is invalid for argument '${q.name()}'.`;T=this._callParseArg(q,K,O,z)}return T};this._checkNumberOfArguments();let _=[];this.registeredArguments.forEach((q,K)=>{let O=q.defaultValue;if(q.variadic){if(K<this.args.length){if(O=this.args.slice(K),q.parseArg)O=O.reduce((T,z)=>{return H(q,z,T)},q.defaultValue)}else if(O===void 0)O=[]}else if(K<this.args.length){if(O=this.args[K],q.parseArg)O=H(q,O,q.defaultValue)}_[K]=O}),this.processedArgs=_}_chainOrCall(H,_){if(H&&H.then&&typeof H.then==="function")return H.then(()=>_());return _()}_chainOrCallHooks(H,_){let q=H,K=[];if(this._getCommandAndAncestors().reverse().filter((O)=>O._lifeCycleHooks[_]!==void 0).forEach((O)=>{O._lifeCycleHooks[_].forEach((T)=>{K.push({hookedCommand:O,callback:T})})}),_==="postAction")K.reverse();return K.forEach((O)=>{q=this._chainOrCall(q,()=>{return O.callback(O.hookedCommand,this)})}),q}_chainOrCallSubCommandHook(H,_,q){let K=H;if(this._lifeCycleHooks[q]!==void 0)this._lifeCycleHooks[q].forEach((O)=>{K=this._chainOrCall(K,()=>{return O(this,_)})});return K}_parseCommand(H,_){let q=this.parseOptions(_);if(this._parseOptionsEnv(),this._parseOptionsImplied(),H=H.concat(q.operands),_=q.unknown,this.args=H.concat(_),H&&this._findCommand(H[0]))return this._dispatchSubcommand(H[0],H.slice(1),_);if(this._getHelpCommand()&&H[0]===this._getHelpCommand().name())return this._dispatchHelpCommand(H[1]);if(this._defaultCommandName)return this._outputHelpIfRequested(_),this._dispatchSubcommand(this._defaultCommandName,H,_);if(this.commands.length&&this.args.length===0&&!this._actionHandler&&!this._defaultCommandName)this.help({error:!0});this._outputHelpIfRequested(q.unknown),this._checkForMissingMandatoryOptions(),this._checkForConflictingOptions();let K=()=>{if(q.unknown.length>0)this.unknownOption(q.unknown[0])},O=`command:${this.name()}`;if(this._actionHandler){K(),this._processArguments();let T;if(T=this._chainOrCallHooks(T,"preAction"),T=this._chainOrCall(T,()=>this._actionHandler(this.processedArgs)),this.parent)T=this._chainOrCall(T,()=>{this.parent.emit(O,H,_)});return T=this._chainOrCallHooks(T,"postAction"),T}if(this.parent&&this.parent.listenerCount(O))K(),this._processArguments(),this.parent.emit(O,H,_);else if(H.length){if(this._findCommand("*"))return this._dispatchSubcommand("*",H,_);if(this.listenerCount("command:*"))this.emit("command:*",H,_);else if(this.commands.length)this.unknownCommand();else K(),this._processArguments()}else if(this.commands.length)K(),this.help({error:!0});else K(),this._processArguments()}_findCommand(H){if(!H)return;return this.commands.find((_)=>_._name===H||_._aliases.includes(H))}_findOption(H){return this.options.find((_)=>_.is(H))}_checkForMissingMandatoryOptions(){this._getCommandAndAncestors().forEach((H)=>{H.options.forEach((_)=>{if(_.mandatory&&H.getOptionValue(_.attributeName())===void 0)H.missingMandatoryOptionValue(_)})})}_checkForConflictingLocalOptions(){let H=this.options.filter((q)=>{let K=q.attributeName();if(this.getOptionValue(K)===void 0)return!1;return this.getOptionValueSource(K)!=="default"});H.filter((q)=>q.conflictsWith.length>0).forEach((q)=>{let K=H.find((O)=>q.conflictsWith.includes(O.attributeName()));if(K)this._conflictingOption(q,K)})}_checkForConflictingOptions(){this._getCommandAndAncestors().forEach((H)=>{H._checkForConflictingLocalOptions()})}parseOptions(H){let _=[],q=[],K=_,O=H.slice();function T($){return $.length>1&&$[0]==="-"}let z=null;while(O.length){let $=O.shift();if($==="--"){if(K===q)K.push($);K.push(...O);break
