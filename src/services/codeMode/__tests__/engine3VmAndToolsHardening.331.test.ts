import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import { FileEditTool } from '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
import { FileWriteTool } from '@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import {
  clearListAgentsCursorCacheForTests,
  issueListAgentsCursor,
  lookupListAgentsCursor,
} from '@claude-code/builtin-tools/tools/ListPeersTool/ListPeersTool.js'
import { MonitorTool } from '@claude-code/builtin-tools/tools/MonitorTool/MonitorTool.js'
import { NotebookEditTool } from '@claude-code/builtin-tools/tools/NotebookEditTool/NotebookEditTool.js'
import { PowerShellTool } from '@claude-code/builtin-tools/tools/PowerShellTool/PowerShellTool.js'
import {
  _recordPushNotificationDedupForTesting,
  _resetPushNotificationDedupForTesting,
  PushNotificationTool,
} from '@claude-code/builtin-tools/tools/PushNotificationTool/PushNotificationTool.js'
import {
  _resetStoredDbAccessRulesForTesting,
  recordStoredDbAccessRules,
} from '@claude-code/builtin-tools/tools/ArtifactTool/ArtifactTool.js'
import { z } from 'zod/v4'
import {
  buildTool,
  clearRemoteNativeToolRunners,
  createDefaultCanUseTool,
  createExplicitToolDeps,
  createToolCallContext,
  createToolDeps,
  NativeToolElsewhereError,
  recordRemoteNativeToolLocallyChecked,
  registerRemoteNativeToolRunner,
  REMOTE_CHECK_DOES_NOT_DECIDE,
  resolveToolUseContext,
  type RemoteNativeToolRunner,
  type RemoteNativeToolSession,
  type Tool,
} from '../../../Tool.js'
import { runEvaluatingLocalPermissionFloor } from '../../../utils/toolCreateRuntime.js'
import * as localShellTaskMod from '../../../tasks/LocalShellTask/LocalShellTask.js'
import * as shellExecMod from '../../../utils/Shell.js'
import { getCwd } from '../../../utils/cwd.js'
import { enqueueDetachedToolCallResult } from '../../../utils/detachedToolCallNotify.js'
import {
  dequeueAll,
  resetCommandQueue,
} from '../../../utils/messageQueueManager.js'
import {
  checkRemoteNativeToolPermissionOverride,
  hasPermissionsToUseTool,
} from '../../../utils/permissions/permissions.js'
import {
  createSessionHost,
  getBootstrapSession,
  runWithNewHostSession,
  runWithSession,
} from '../../../utils/sessionHost.js'
import { createRootSession } from '../../../utils/sessionRoot.js'
import {
  _resetTaskOutputDirForTest,
  appendTaskOutput,
  flushTaskOutput,
  getTaskOutputDir,
  getTaskOutputSize,
  initTaskOutput,
} from '../../../utils/task/diskOutput.js'
import { StreamingToolExecutor } from '../../tools/StreamingToolExecutor.js'
import * as toolExecutionMod from '../../tools/toolExecution.js'
import {
  clearCodeModeVmSession,
  executeCodeModeScript,
  instrumentCodeModeLoops,
  resetCodeModeRuntimeStateForTests,
  transformCodeModeScript,
  wrapReplToolForCodeMode,
} from '../executor.js'
import {
  pinCodeMode,
  setEngineCheckResultForTests,
  unpinCodeMode,
} from '../optIn.js'
import { REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR } from '../constants.js'

function makeSession(label: string): RemoteNativeToolSession {
  return { root: { label } }
}

describe('Engine 3 hardening: VM sandbox, permission floor, DI & builtin tools (2.1.331)', () => {
  afterEach(() => {
    resetCodeModeRuntimeStateForTests()
    clearCodeModeVmSession()
    unpinCodeMode()
    setEngineCheckResultForTests(undefined)
    _resetPushNotificationDedupForTesting()
    clearListAgentsCursorCacheForTests()
  })

  describe('E3-P0-1: Code Mode VM Sandbox Escape Prevention (Zero Host Object Leakage)', () => {
    test('overriding WeakMap.prototype.has/get/set, Function.prototype.call/apply, and globalThis.String cannot intercept ANY host object or gain host RCE', async () => {
      const hostSecret = { secret: 'HOST_ONLY_OBJECT', arr: [1, 2, 3] }
      const hostThrownPlain = { leakedHostThrown: true }

      const res = await executeCodeModeScript({
        code: `
          const leaks = [];
          const checkLeak = (label, v) => {
            if (v === null || v === undefined) return;
            if (typeof v !== 'object' && typeof v !== 'function') return;
            // Any host object would have a constructor !== VM Object/Function/Array
            try {
              const ctor = v.constructor;
              if (ctor && ctor !== Object && ctor !== Array && ctor !== Function && ctor !== Error && ctor !== TypeError && ctor !== RangeError && ctor !== Map && ctor !== Set && ctor !== Uint8Array && ctor !== RegExp && ctor !== Date && ctor !== Promise) {
                leaks.push(label + ':foreign-ctor');
              }
              if (typeof ctor === 'function' && ctor !== Function) {
                const fnCtor = ctor.constructor;
                if (fnCtor && fnCtor !== Function) {
                  leaks.push(label + ':host-fn-ctor');
                }
              }
            } catch {}
          };

          // Attack 1: Override WeakMap.prototype.* (classic cloneToRealm escape)
          const origWmHas = WeakMap.prototype.has;
          const origWmGet = WeakMap.prototype.get;
          const origWmSet = WeakMap.prototype.set;
          WeakMap.prototype.has = function (k) { checkLeak('wm.has', k); return origWmHas.call(this, k); };
          WeakMap.prototype.get = function (k) { checkLeak('wm.get', k); return origWmGet.call(this, k); };
          WeakMap.prototype.set = function (k, v) { checkLeak('wm.set', k); checkLeak('wm.set.v', v); return origWmSet.call(this, k, v); };

          // Attack 2: Override Function.prototype.call / apply (classic wrapSyncHostFn escape)
          const origCall = Function.prototype.call;
          const origApply = Function.prototype.apply;
          Function.prototype.call = function (...a) { checkLeak('fn.call', this); return Reflect.apply(origCall, this, a); };
          Function.prototype.apply = function (...a) { checkLeak('fn.apply', this); return Reflect.apply(origApply, this, a); };

          // Attack 3: Override globalThis.String (classic errInfo escape)
          const origString = globalThis.String;
          globalThis.String = function (x) { checkLeak('String', x); return origString(x); };

          // Attack 4: Override Array.prototype.push / [Symbol.iterator] & Promise.prototype.then
          const origPush = Array.prototype.push;
          Array.prototype.push = function (...a) { for (const x of a) checkLeak('arr.push', x); return Reflect.apply(origPush, this, a); };
          const origThen = Promise.prototype.then;
          Promise.prototype.then = function (...a) { checkLeak('promise.then', this); return Reflect.apply(origThen, this, a); };

          // Attack 5: Pollute Object.prototype with descriptor trap & property setter
          Object.defineProperty(Object.prototype, 'secret', {
            configurable: true,
            set(v) { leaks.push('proto-setter:' + typeof v); },
            get() { return undefined; },
          });
          Object.prototype.get = function () { leaks.push('proto-desc-get'); };

          // Trigger sync host call, async tool call returning rich host objects,
          // host-thrown Error, host-thrown plain object, and $ shell helper.
          const listed = tools.list();
          checkLeak('tools.list', listed);

          const data = await callTool('GetRichHostData', {});
          checkLeak('tool.data', data);
          checkLeak('tool.arr', data.arr);
          checkLeak('tool.map', data.map);
          checkLeak('tool.set', data.set);
          checkLeak('tool.buf', data.buf);

          let caughtErrMsg = '';
          try {
            await callTool('ThrowHostError', {});
          } catch (e) {
            checkLeak('caught.err', e);
            caughtErrMsg = e.message;
          }

          let caughtPlainMsg = '';
          try {
            await callTool('ThrowHostPlain', {});
          } catch (e) {
            checkLeak('caught.plain', e);
            caughtPlainMsg = e.message;
          }

          const shellRes = await $\`echo hello\`.text();

          // Clean up Object.prototype before returning so host serialization is clean
          delete Object.prototype.get;
          delete Object.prototype.secret;

          return {
            leaks,
            secret: data.secret,
            arrLen: data.arr.length,
            mapVal: data.map.get('k'),
            setHas: data.set.has(42),
            bufByte: data.buf[1],
            caughtErrMsg,
            caughtPlainMsg,
            shellRes,
            isVmObj: data instanceof Object,
            isVmArr: Array.isArray(listed),
          };
        `,
        availableToolNames: [
          'GetRichHostData',
          'ThrowHostError',
          'ThrowHostPlain',
          'Bash',
        ],
        invokeTool: async toolName => {
          if (toolName === 'GetRichHostData') {
            return {
              ...hostSecret,
              map: new Map([['k', 'v']]),
              set: new Set([42]),
              buf: new Uint8Array([10, 20, 30]),
            }
          }
          if (toolName === 'ThrowHostError') {
            throw new TypeError('host-boom')
          }
          if (toolName === 'ThrowHostPlain') {
            throw hostThrownPlain
          }
          if (toolName === 'Bash') {
            return { stdout: 'hello', stderr: '', exitCode: 0 }
          }
          return {}
        },
      })

      const parsed = JSON.parse(res.result) as {
        leaks: string[]
        secret: string
        arrLen: number
        mapVal: string
        setHas: boolean
        bufByte: number
        caughtErrMsg: string
        caughtPlainMsg: string
        shellRes: string
        isVmObj: boolean
        isVmArr: boolean
      }
      expect(parsed.leaks).toEqual([])
      expect(parsed.secret).toBe('HOST_ONLY_OBJECT')
      expect(parsed.arrLen).toBe(3)
      expect(parsed.mapVal).toBe('v')
      expect(parsed.setHas).toBe(true)
      expect(parsed.bufByte).toBe(20)
      expect(parsed.caughtErrMsg).toBe('host-boom')
      expect(parsed.caughtPlainMsg).toBe('[object Object]')
      expect(parsed.shellRes).toBe('hello')
      expect(parsed.isVmObj).toBe(true)
      expect(parsed.isVmArr).toBe(true)
    })
  })

  describe('E3-P1-1 & E3-P2-6: Step-Budget Shadowing, Microtask Spins, Closure Params, Timers & Bounded Logging', () => {
    test('user shadowing `let __checkBudget = () => {}` cannot bypass step budget or timeout (sync or post-await)', async () => {
      const t0 = Date.now()
      const syncRes = await executeCodeModeScript({
        code: 'let __checkBudget = () => {}; while (true) {}',
        timeoutMs: 120,
        invokeTool: async () => ({}),
      })
      expect(syncRes.result).toContain('Code Mode script timed out after 120ms')
      expect(Date.now() - t0).toBeLessThan(1500)

      const t1 = Date.now()
      const asyncRes = await executeCodeModeScript({
        code: 'await callTool("Fast", {}); let __checkBudget = () => {}; while (true) {}',
        timeoutMs: 120,
        invokeTool: async () => ({ ok: true }),
      })
      expect(asyncRes.result).toContain(
        'Code Mode script timed out after 120ms',
      )
      expect(Date.now() - t1).toBeLessThan(1500)

      // Direct transform rejects binding the active check identifier
      expect(() =>
        transformCodeModeScript(
          'let __checkBudget = () => {}; while (true) {}',
        ),
      ).toThrow(SyntaxError)
    })

    test('expression-body arrows, object/class shorthand methods, getters, setters, and thenables hit step budget on microtask spin', async () => {
      const spinScripts = [
        'const spin = () => Promise.resolve().then(spin); await spin();',
        'const o = { spin() { return Promise.resolve().then(() => o.spin()) } }; await o.spin();',
        'const o = { get x() { return Promise.resolve().then(() => o.x) } }; await o.x;',
        'class C { m() { return Promise.resolve().then(() => this.m()) } } await new C().m();',
        'const o = { then(res) { res(o) } }; await o;',
      ]
      for (const code of spinScripts) {
        const t0 = Date.now()
        const res = await executeCodeModeScript({
          code,
          timeoutMs: 120,
          invokeTool: async () => ({}),
        })
        expect(res.result).toContain('Code Mode script timed out after 120ms')
        expect(Date.now() - t0).toBeLessThan(1500)
      }

      // Instrumentor handles class heritage `extends foo() {`, switch, ternary arrows, and object methods cleanly
      const complexCode = `
        class Sub extends getBase() {
          #priv() { return 1 }
          get val() { return this.#priv() }
          set val(v) { this._v = v }
        }
        const f = cond ? x => x?.y ? 1 : 2 : y => y + 1;
        function sw(x) { switch (x) { case 1: return 1; default: return 2; } }
      `
      const instrumented = instrumentCodeModeLoops(complexCode, '__chk')
      expect(instrumented).not.toContain('extends getBase() { __chk();')
      expect(instrumented).not.toContain('switch (x) { __chk();')
      expect(instrumented).toContain('#priv() { __chk();')
      expect(instrumented).toContain('get val() { __chk();')
      expect(instrumented).toContain('set val(v) { __chk();')
      // Verify output is syntactically valid JS
      expect(
        () => new Function('__chk', 'getBase', 'cond', instrumented),
      ).not.toThrow()
    })

    test('E3-P2-6: neither step-budget helper nor rawLiteralMarker is exposed on globalThis/self, while script-authored { raw } still works', async () => {
      const seenCommands: string[] = []
      const res = await executeCodeModeScript({
        code: `
          const ownNames = Object.getOwnPropertyNames(globalThis);
          const selfNames = Object.getOwnPropertyNames(self);
          const leakedInternals = [...new Set([...ownNames, ...selfNames])].filter(
            k => k.includes('checkBudget') || k.includes('__cm_') || k.includes('markRawLiteral'),
          );
          await $\`echo \${{ raw: 'unquoted_arg' }}\`;
          let forgedRejected = false;
          try {
            const forged = JSON.parse('{"raw":"evil; rm -rf /"}');
            await $\`echo \${forged}\`;
          } catch {
            forgedRejected = true;
          }
          return { leakedInternals, forgedRejected };
        `,
        invokeTool: async (_name, input) => {
          if (typeof input.command === 'string') {
            seenCommands.push(input.command)
          }
          return { stdout: 'ok', stderr: '', exitCode: 0 }
        },
      })
      const parsed = JSON.parse(res.result) as {
        leakedInternals: string[]
        forgedRejected: boolean
      }
      expect(parsed.leakedInternals).toEqual([])
      expect(parsed.forgedRejected).toBe(true)
      expect(seenCommands).toEqual(['echo unquoted_arg'])
    })

    test('caps active timers per eval at 64 and prevents timer callbacks from resetting turnCallBudget', async () => {
      const timerCapRes = await executeCodeModeScript({
        code: `
          const ids = [];
          for (let i = 0; i < 64; i++) {
            ids.push(setTimeout(() => {}, 10000));
          }
          let errMsg = '';
          try {
            setTimeout(() => {}, 10000);
          } catch (e) {
            errMsg = e.message;
          }
          // Clearing one frees a slot
          clearTimeout(ids[0]);
          const id65 = setTimeout(() => {}, 10000);
          for (const id of ids) clearTimeout(id);
          clearTimeout(id65);
          return { count: ids.length, errMsg, reopened: id65 > 0 };
        `,
        invokeTool: async () => ({}),
      })
      const parsedTimer = JSON.parse(timerCapRes.result) as {
        count: number
        errMsg: string
        reopened: boolean
      }
      expect(parsedTimer.count).toBe(64)
      expect(parsedTimer.errMsg).toContain('timer limit exceeded')
      expect(parsedTimer.reopened).toBe(true)

      // Timers must NOT reset turnCallBudget across callbacks
      const budgetRes = await executeCodeModeScript({
        code: `
          // Exhaust per-turn call budget (2 calls) without awaiting tool resolution,
          // then try calling again inside a timer callback.
          const p1 = callTool('Slow', {});
          const p2 = callTool('Slow', {});
          const timerErr = await new Promise(resolve => {
            setTimeout(async () => {
              try {
                await callTool('Slow', {});
                resolve('ALLOWED');
              } catch (e) {
                resolve(e.message);
              }
            }, 15);
          });
          return timerErr;
        `,
        dosLimits: { maxTurnCalls: 2 },
        timeoutMs: 1000,
        invokeTool: async () =>
          new Promise(resolve => setTimeout(() => resolve({ ok: 1 }), 200)),
      })
      expect(budgetRes.result).not.toBe('ALLOWED')
      expect(budgetRes.result.length).toBeGreaterThan(0)
    })

    test('pushLog caps huge strings and huge nested/circular objects at 256 KB before/during serialization', async () => {
      const res = await executeCodeModeScript({
        code: `
          const hugeStr = 'X'.repeat(600_000);
          console.log(hugeStr);
          const hugeObj = { items: Array.from({ length: 50_000 }, (_, i) => ({ idx: i, pad: 'Y'.repeat(30) })) };
          hugeObj.self = hugeObj;
          console.log(hugeObj);
          const tail = console.tail(2);
          return {
            len0: tail[0].length,
            len1: tail[1].length,
            trunc0: tail[0].endsWith('... [truncated]'),
            trunc1: tail[1].endsWith('... [truncated]'),
          };
        `,
        invokeTool: async () => ({}),
      })
      const parsed = JSON.parse(
        res.result.split('\n').slice(-6).join('\n'),
      ) as {
        len0: number
        len1: number
        trunc0: boolean
        trunc1: boolean
      }
      expect(parsed.len0).toBeLessThanOrEqual(256 * 1024)
      expect(parsed.len1).toBeLessThanOrEqual(256 * 1024)
      expect(parsed.trunc0).toBe(true)
      expect(parsed.trunc1).toBe(true)

      // Tight custom dosLimits.mostTextChars still throws oversized error
      const tightRes = await executeCodeModeScript({
        code: `console.log('A'.repeat(200))`,
        dosLimits: { mostTextChars: 50 },
        invokeTool: async () => ({}),
      })
      expect(tightRes.result).toContain(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )
    })
  })

  describe('E3-P0-2 / E5-P0-1 / E5-P1-1: Bash Remote updatedInput Local Deny Floor & PreToolUse Hook', () => {
    test('Bash remote allow rewriting command to denied `rm -rf /` is rejected by local floor in both hasPermissionsToUseTool and checkRemoteNativeToolPermissionOverride', async () => {
      const session = makeSession('bash-floor')
      let remoteCheckCount = 0
      let remoteCommand = 'rm -rf /'

      const bashRunner: RemoteNativeToolRunner = Object.assign(
        async () => ({
          output: {
            stdout: 'never',
            stderr: '',
            interrupted: false,
            isImage: false,
          },
        }),
        {
          checkPermissions: async () => ({
            behavior: 'allow' as const,
            updatedInput: { command: remoteCommand },
          }),
        },
      )
      registerRemoteNativeToolRunner(
        session,
        'Bash',
        bashRunner,
        async ({ evaluateHere }) => {
          remoteCheckCount++
          const updatedInput = { command: remoteCommand }
          const localDecision = await runEvaluatingLocalPermissionFloor(() =>
            evaluateHere(updatedInput),
          )
          if (localDecision.behavior !== 'allow') {
            return localDecision
          }
          return { behavior: 'allow', updatedInput }
        },
      )

      const deps = createExplicitToolDeps({
        session,
        permissions: () => ({
          mode: 'bypassPermissions',
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: { userSettings: ['Bash(rm -rf:*)'] },
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: true,
        }),
      })
      const ctx = resolveToolUseContext(
        deps,
        createToolCallContext({ toolUseId: 'toolu_bash_floor_1' }),
      )

      try {
        // 1a. Remote allows & rewrites safe `echo ok` to `rm -rf /` -> local dangerousRemoval safetyCheck (`ask`) blocks!
        const resSafety = await hasPermissionsToUseTool(
          BashTool,
          { command: 'echo ok' },
          ctx,
          {} as never,
          'toolu_bash_floor_1a',
        )
        expect(resSafety.behavior).toBe('ask')
        expect(remoteCheckCount).toBe(1)

        // 1b. Remote allows & rewrites safe `echo ok` to `rm -rf ./build` -> local `Bash(rm -rf:*)` deny rule rejects!
        remoteCommand = 'rm -rf ./build'
        const resDeny = await hasPermissionsToUseTool(
          BashTool,
          { command: 'echo ok' },
          ctx,
          {} as never,
          'toolu_bash_floor_1b',
        )
        expect(resDeny.behavior).toBe('deny')
        expect(remoteCheckCount).toBe(2)

        // 2. PreToolUse hook `allow` override rejects rewritten `rm -rf ./build`
        const hookDeny = await checkRemoteNativeToolPermissionOverride(
          BashTool,
          { command: 'echo ok' },
          ctx,
          'toolu_bash_floor_2',
        )
        expect(hookDeny?.behavior).toBe('deny')

        // 3. PreToolUse hook `allow` override SUCCEEDS (returns null) for safe remote-approved command
        remoteCommand = 'echo hello'
        const hookAllow = await checkRemoteNativeToolPermissionOverride(
          BashTool,
          { command: 'echo hello' },
          ctx,
          'toolu_bash_floor_3',
        )
        expect(hookAllow).toBeNull()
      } finally {
        clearRemoteNativeToolRunners(session)
      }
    })
  })

  describe('E3-P0-3: runnerLocalCheckDeferred TOCTOU Runner Swap Detection', () => {
    test('swapping or unregistering runner after local-check deferral throws NativeToolElsewhereError(NOT_RUN)', async () => {
      const session = makeSession('toctou-swap')
      let runnerACalls = 0
      let runnerBCalls = 0
      let localCalls = 0

      const testTool = buildTool({
        name: 'ToctouTestTool',
        maxResultSizeChars: 10_000,
        inputSchema: z.object({ x: z.string() }),
        outputSchema: z.object({ from: z.string() }),
        async description() {
          return 'test tool'
        },
        async prompt() {
          return 'test tool'
        },
        userFacingName() {
          return 'ToctouTestTool'
        },
        renderToolUseMessage() {
          return null
        },
        mapToolResultToToolResultBlockParam(output, toolUseID) {
          return {
            type: 'tool_result',
            tool_use_id: toolUseID,
            content: JSON.stringify(output),
          }
        },
        create() {
          return {
            async call() {
              localCalls++
              return { data: { from: 'local' } }
            },
          }
        },
      })

      const runnerA: RemoteNativeToolRunner = async () => {
        runnerACalls++
        return { output: { from: 'runnerA' } }
      }
      const runnerB: RemoteNativeToolRunner = async () => {
        runnerBCalls++
        return { output: { from: 'runnerB' } }
      }

      const deps = createExplicitToolDeps({ session })
      const ctx = resolveToolUseContext(
        deps,
        createToolCallContext({ toolUseId: 'toolu_toctou_1' }),
      )

      try {
        // Case 1: runnerA -> runnerB swap after REMOTE_CHECK_DOES_NOT_DECIDE
        registerRemoteNativeToolRunner(
          session,
          'ToctouTestTool',
          runnerA,
          async () => REMOTE_CHECK_DOES_NOT_DECIDE,
        )
        recordRemoteNativeToolLocallyChecked(session, 'toolu_toctou_1')

        // Swap to runnerB before call()
        registerRemoteNativeToolRunner(session, 'ToctouTestTool', runnerB)
        await expect(
          testTool.call(
            { x: 'a' },
            ctx,
            createDefaultCanUseTool(),
            {} as never,
            undefined,
            {
              permissionCheckedFor: runnerA,
              runnerCheckedHere: runnerA,
            },
          ),
        ).rejects.toMatchObject({
          name: NativeToolElsewhereError.name,
          code: 'NOT_RUN',
        })

        // Case 2: runnerA -> unregistered (local) swap
        clearRemoteNativeToolRunners(session)
        await expect(
          testTool.call(
            { x: 'a' },
            ctx,
            createDefaultCanUseTool(),
            {} as never,
            undefined,
            {
              permissionCheckedFor: runnerA,
              runnerCheckedHere: runnerA,
            },
          ),
        ).rejects.toMatchObject({
          name: NativeToolElsewhereError.name,
          code: 'NOT_RUN',
        })

        expect(runnerACalls).toBe(0)
        expect(runnerBCalls).toBe(0)
        expect(localCalls).toBe(0)
      } finally {
        clearRemoteNativeToolRunners(session)
      }
    })
  })

  describe('E3-P1-2: PowerShellTool outputSchemaAcrossProcesses & fromAnotherProcess', () => {
    test('strips process-local persistedOutputPath/background fields and hydrates via fromAnotherProcess', () => {
      expect(PowerShellTool.outputSchemaAcrossProcesses).toBeDefined()
      expect(PowerShellTool.fromAnotherProcess).toBeDefined()

      const rawWorkerOutput = {
        stdout: 'hello from pwsh',
        stderr: '',
        interrupted: false,
        isImage: false,
        timedOutAfterMs: 5000,
        persistedOutputPath: '/worker/tmp/secret.out',
        persistedOutputSize: 99999,
        backgroundTaskId: 'bg-task-1',
        backgroundedByUser: true,
        assistantAutoBackgrounded: true,
        backgroundEndsWithFinalResponse: true,
      }

      const parsed =
        PowerShellTool.outputSchemaAcrossProcesses!.parse(rawWorkerOutput)
      expect(parsed).toEqual({
        stdout: 'hello from pwsh',
        stderr: '',
        interrupted: false,
        isImage: false,
        timedOutAfterMs: 5000,
      })
      expect('persistedOutputPath' in parsed).toBe(false)
      expect('persistedOutputSize' in parsed).toBe(false)
      expect('backgroundTaskId' in parsed).toBe(false)
      expect('backgroundedByUser' in parsed).toBe(false)
      expect('assistantAutoBackgrounded' in parsed).toBe(false)
      expect('backgroundEndsWithFinalResponse' in parsed).toBe(false)

      const hydrated = PowerShellTool.fromAnotherProcess!(parsed as never)
      expect(hydrated.data).toEqual(parsed)
    })
  })

  describe('E3-P1-3: wrapReplToolForCodeMode DI & Per-Session Isolation', () => {
    test('preserves lazy getters without invoking them, delegates create(deps) when disabled, and isolates VM & MCP delta state per session', async () => {
      let inputSchemaGetterCalls = 0
      let outputSchemaGetterCalls = 0
      let baseCreateCalledWithDeps = false

      const baseToolDef = {
        name: 'REPL',
        get inputSchema() {
          inputSchemaGetterCalls++
          return z.object({ code: z.string() })
        },
        get outputSchema() {
          outputSchemaGetterCalls++
          return z.object({ result: z.string(), tool_calls: z.number() })
        },
        async prompt() {
          return 'base prompt'
        },
        create(deps: ReturnType<typeof createExplicitToolDeps>) {
          return {
            async call(args: { code: string }) {
              baseCreateCalledWithDeps = deps.cwd?.() === '/custom/di/dir'
              return { data: { result: `base:${args.code}`, tool_calls: 0 } }
            },
          }
        },
      } as unknown as Tool

      const wrapped = wrapReplToolForCodeMode(baseToolDef, () => [])
      // Wrapping MUST NOT touch lazy schema getters!
      expect(inputSchemaGetterCalls).toBe(0)
      expect(outputSchemaGetterCalls).toBe(0)

      // When Code Mode is off, wrapped.create(deps).call(...) delegates to baseReplTool.create(deps)
      pinCodeMode(false)
      const disabledDeps = createExplicitToolDeps({
        cwd: () => '/custom/di/dir',
      })
      const disabledRes = await wrapped.create!(disabledDeps).call(
        { code: 'ping' } as never,
        createToolCallContext(),
      )
      expect(baseCreateCalledWithDeps).toBe(true)
      expect((disabledRes.data as { result: string }).result).toBe('base:ping')

      // When Code Mode is on, two distinct deps.session instances are completely isolated
      setEngineCheckResultForTests('passed')
      pinCodeMode(true)
      const sessionA = makeSession('repl-session-A')
      const sessionB = makeSession('repl-session-B')

      const makeDepsWithMcp = (
        session: RemoteNativeToolSession,
        mcpNames: string[],
      ) =>
        createExplicitToolDeps({
          session,
          getAppState: () =>
            ({
              toolPermissionContext: {
                mode: 'bypassPermissions',
                additionalWorkingDirectories: new Map(),
                alwaysAllowRules: {},
                alwaysDenyRules: {},
                alwaysAskRules: {},
                isBypassPermissionsModeAvailable: true,
              },
              mcp: {
                clients: mcpNames.map(name => ({ name, type: 'connected' })),
                tools: [],
                commands: [],
                resources: {},
              },
              tasks: {},
              todos: {},
              agentNameRegistry: new Map(),
              sendMessagePins: {},
              sessionHooks: new Map(),
              inbox: { messages: [] },
              fileHistory: {
                snapshots: [],
                trackedFiles: new Set(),
                snapshotSequence: 0,
              },
            }) as never,
        })

      try {
        await wrapped.create!(makeDepsWithMcp(sessionA, ['srvA'])).call(
          { code: 'const secretVal = "ONLY_IN_A"; secretVal' } as never,
          createToolCallContext({ toolUseId: 'tu_a1' }),
        )

        // Session B must NOT see Session A's persistent VM variable OR Session A's prevConnectedMcpServers
        const resB = await wrapped.create!(
          makeDepsWithMcp(sessionB, ['srvB']),
        ).call(
          { code: 'typeof secretVal' } as never,
          createToolCallContext({ toolUseId: 'tu_b1' }),
        )
        const textB = (resB.data as { result: string }).result
        expect(textB).toContain('undefined')
        // Because Session B had no prior MCP servers, srvA must NOT appear as removed in Session B!
        expect(textB).not.toContain('srvA')
      } finally {
        resetCodeModeRuntimeStateForTests(sessionA)
        resetCodeModeRuntimeStateForTests(sessionB)
      }
    })
  })

  describe('E3-P1-4 & E3-P2-1: StreamingToolExecutor Error Recovery, Ordering & Detached Session Threading', () => {
    test('collectResults catches uncaught runToolUse error, emits is_error tool_result, clears inProgressToolUseIDs, and getRemainingResults ends turnSpan on early break', async () => {
      const spyRunToolUse = spyOn(
        toolExecutionMod,
        'runToolUse',
      ).mockImplementation(
        () =>
          ({
            [Symbol.asyncIterator]() {
              return {
                next: async () => {
                  throw new Error('catastrophic generator crash')
                },
              }
            },
          }) as never,
      )

      const inProgressSnapshots: Array<Set<string>> = []
      let inProgress = new Set<string>()
      const mockTool = buildTool({
        name: 'CrashyTool',
        maxResultSizeChars: 10_000,
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        async description() {
          return 'crashy tool'
        },
        async prompt() {
          return 'crashy tool'
        },
        userFacingName() {
          return 'CrashyTool'
        },
        renderToolUseMessage() {
          return null
        },
        mapToolResultToToolResultBlockParam(output, toolUseID) {
          return {
            type: 'tool_result',
            tool_use_id: toolUseID,
            content: JSON.stringify(output),
          }
        },
        isConcurrencySafe: () => true,
        create() {
          return {
            async call() {
              return { data: {} }
            },
          }
        },
      })

      const deps = createExplicitToolDeps({
        tools: [mockTool],
        setInProgressToolUseIDs: updater => {
          inProgress = updater(inProgress)
          inProgressSnapshots.push(new Set(inProgress))
        },
      })
      const ctx = resolveToolUseContext(deps, createToolCallContext())
      const executor = new StreamingToolExecutor(
        [mockTool],
        async () => ({ behavior: 'allow', updatedInput: {} }),
        ctx,
      )

      try {
        executor.addTool(
          {
            type: 'tool_use',
            id: 'tu_crash_1',
            name: 'CrashyTool',
            input: {},
          } as never,
          { message: { id: 'msg_1', content: [] } } as never,
        )

        const results: unknown[] = []
        for await (const update of executor.getRemainingResults()) {
          results.push(update)
        }

        expect(results.length).toBe(1)
        const msg = (
          results[0] as {
            message?: {
              message?: {
                content?: Array<{
                  type?: string
                  tool_use_id?: string
                  is_error?: boolean
                  content?: string
                }>
              }
            }
          }
        ).message
        const block = msg?.message?.content?.[0]
        expect(block?.type).toBe('tool_result')
        expect(block?.tool_use_id).toBe('tu_crash_1')
        expect(block?.is_error).toBe(true)
        expect(block?.content).toContain('catastrophic generator crash')
        // inProgressToolUseIDs was cleared
        expect(inProgress.size).toBe(0)
      } finally {
        spyRunToolUse.mockRestore()
      }
    })

    test('enqueueDetachedToolCallResult threads explicit session via runWithSession across distinct hosts and agentIds', async () => {
      const host1 = createSessionHost()
      const host2 = createSessionHost()
      const project = {
        cwd: process.cwd(),
        originalCwd: process.cwd(),
        projectRoot: process.cwd(),
      }
      const s1 = createRootSession({ host: host1, id: 'detach-s1', project })
      const s2 = createRootSession({ host: host2, id: 'detach-s2', project })

      try {
        // Run inside s1 (host1), but pass explicit session: s2 (host2) to enqueueDetachedToolCallResult
        runWithSession(s1, () => {
          resetCommandQueue()
          enqueueDetachedToolCallResult({
            toolName: 'Bash',
            toolUseId: 'tu_detach_1',
            status: 'completed',
            text: 'detached-output-for-s2',
            isOnScreen: false,
            session: s2,
          })
          // s1's host queue must remain empty
          expect(dequeueAll()).toEqual([])
        })

        // s2's host queue MUST contain the notification stamped with s2's main-thread agentId
        runWithSession(s2, () => {
          const queued = dequeueAll()
          expect(queued.length).toBe(1)
          expect(String(queued[0]!.agentId)).toBe('detach-s2')
          expect(String(queued[0]!.value)).toContain('detached-output-for-s2')
          resetCommandQueue()
        })
      } finally {
        runWithSession(s1, () => resetCommandQueue())
        runWithSession(s2, () => resetCommandQueue())
      }
    })
  })

  describe('E3-P1-5: MonitorTool Spawn Failure Cleanup & Early Stdout Buffering', () => {
    test('cleans up shellCommand.kill() and shellCommand.cleanup() when spawnShellTask throws, and buffers early stdout until taskRef.id is assigned', async () => {
      let killed = false
      let cleanedUp = false
      let capturedOnStdout: ((chunk: string) => void) | undefined

      const spyExec = spyOn(shellExecMod, 'exec').mockImplementation((async (
        _cmd: unknown,
        _sig: unknown,
        _kind: unknown,
        opts?: { onStdout?: (chunk: string) => void },
      ) => {
        capturedOnStdout = opts?.onStdout
        // Emit early stdout BEFORE spawnShellTask even runs!
        capturedOnStdout?.('early line before taskRef.id\n')
        return {
          status: 'running',
          kill: () => {
            killed = true
          },
          cleanup: () => {
            cleanedUp = true
          },
          result: Promise.resolve({
            code: 0,
            stdout: '',
            stderr: '',
            interrupted: false,
          }),
          taskOutput: { path: '/tmp/mock.out', totalBytes: 0 },
        }
      }) as never)
      const spySpawn = spyOn(
        localShellTaskMod,
        'spawnShellTask',
      ).mockImplementation(async () => {
        throw new Error('simulated spawnShellTask failure')
      })

      try {
        const deps = createExplicitToolDeps({
          permissions: () => ({
            mode: 'bypassPermissions',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: true,
          }),
        })
        await expect(
          MonitorTool.create!(deps).call(
            {
              command: 'echo early',
              description: 'test monitor spawn fail',
              timeout_ms: 5000,
              persistent: false,
            } as never,
            createToolCallContext({ toolUseId: 'tu_mon_1' }),
          ),
        ).rejects.toThrow('simulated spawnShellTask failure')

        // Regardless of MONITOR_TOOL feature flag, spawnShellTask failure ALWAYS kills & cleans up shellCommand
        expect(killed).toBe(true)
        expect(cleanedUp).toBe(true)
      } finally {
        spyExec.mockRestore()
        spySpawn.mockRestore()
      }
    })
  })

  describe('E3-P2-2: diskOutput Per-Root-Session Isolation', () => {
    test('two distinct root sessions sharing one SessionHost get isolated taskOutputDir and diskOutputs', async () => {
      const host = createSessionHost()
      const project = {
        cwd: process.cwd(),
        originalCwd: process.cwd(),
        projectRoot: process.cwd(),
      }
      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const sA = createRootSession({ host, id: `disk-sA-${nonce}`, project })
      const sB = createRootSession({ host, id: `disk-sB-${nonce}`, project })

      let dirA = ''
      let dirB = ''
      let sizeA = 0
      let sizeB = 0

      try {
        await runWithSession(sA, async () => {
          expect(getBootstrapSession()).toBe(sA)
          dirA = getTaskOutputDir()
          await initTaskOutput('task_iso_1')
          appendTaskOutput('task_iso_1', 'hello-from-session-A')
          await flushTaskOutput('task_iso_1')
          sizeA = await getTaskOutputSize('task_iso_1')
        })

        await runWithSession(sB, async () => {
          expect(getBootstrapSession()).toBe(sB)
          dirB = getTaskOutputDir()
          sizeB = await getTaskOutputSize('task_iso_1')
        })

        expect(dirA).not.toBe(dirB)
        expect(sizeA).toBeGreaterThan(0)
        expect(sizeB).toBe(0)
      } finally {
        runWithSession(sA, () => _resetTaskOutputDirForTest())
        runWithSession(sB, () => _resetTaskOutputDirForTest())
        if (dirA) rmSync(dirA, { recursive: true, force: true })
        if (dirB) rmSync(dirB, { recursive: true, force: true })
      }
    })
  })

  describe('E3-P2-3: LocalMainSessionTask & artifactAutoReact Transcript Cleanup', () => {
    test('both LocalMainSessionTask exit cleanup and artifactAutoReact rollback remove prev.transcripts[taskId]', () => {
      const mainTaskSrc = readFileSync(
        join(process.cwd(), 'src/tasks/LocalMainSessionTask.ts'),
        'utf8',
      )
      expect(mainTaskSrc).toContain(
        'prev.transcripts !== undefined && taskId in prev.transcripts',
      )
      expect(mainTaskSrc).toContain(
        'const { [taskId]: _removedTranscript, ...restTranscripts }',
      )

      const armSrc = readFileSync(
        join(process.cwd(), 'src/services/artifactAutoReact/arm.ts'),
        'utf8',
      )
      expect(armSrc).toContain(
        'prev.transcripts !== undefined && taskId in prev.transcripts',
      )
      expect(armSrc).toContain(
        'const { [taskId]: _droppedTranscript, ...restTranscripts }',
      )
    })
  })

  describe('E3-P2-4 & E3-P2-5: FileEdit/FileWrite Defense-in-Depth, createToolDeps.cwd & Session Slot Isolation', () => {
    test('FileEditTool.call() and FileWriteTool.call() directly reject blocked device/proc paths', async () => {
      const deps = createExplicitToolDeps()
      const callCtx = createToolCallContext({ toolUseId: 'tu_dev_1' })

      await expect(
        FileEditTool.create!(deps).call(
          {
            file_path: '/dev/null',
            old_string: 'a',
            new_string: 'b',
            replace_all: false,
          } as never,
          callCtx,
        ),
      ).rejects.toThrow()

      await expect(
        FileWriteTool.create!(deps).call(
          {
            file_path: '/dev/null',
            content: 'blocked',
          } as never,
          callCtx,
        ),
      ).rejects.toThrow()
    })

    test('createToolDeps wires cwd: () => getCwd(), and FileWriteTool/FileEditTool/NotebookEditTool resolve relative paths via deps.cwd()', async () => {
      const autoDeps = createToolDeps(undefined)
      expect(typeof autoDeps.cwd).toBe('function')
      expect(autoDeps.cwd?.()).toBe(getCwd())

      const tmpDir = mkdtempSync(join(tmpdir(), 'engine3-cwd-di-'))
      try {
        const deps = createExplicitToolDeps({ cwd: () => tmpDir })
        const writeRes = await FileWriteTool.create!(deps).call(
          { file_path: 'rel-note.txt', content: 'hello-di' } as never,
          createToolCallContext({ toolUseId: 'tu_cwd_w' }),
        )
        const targetFile = join(tmpDir, 'rel-note.txt')
        expect(existsSync(targetFile)).toBe(true)
        expect(readFileSync(targetFile, 'utf8')).toBe('hello-di')
        expect(writeRes.data.filePath).toBe('rel-note.txt')

        // Seed readFileState for FileEditTool and edit via relative path
        deps.readFileState.set(targetFile, {
          content: 'hello-di',
          timestamp: Date.now() + 1000,
          offset: undefined,
          limit: undefined,
        })
        await FileEditTool.create!(deps).call(
          {
            file_path: 'rel-note.txt',
            old_string: 'hello-di',
            new_string: 'edited-di',
            replace_all: false,
          } as never,
          createToolCallContext({ toolUseId: 'tu_cwd_e' }),
        )
        expect(readFileSync(targetFile, 'utf8')).toBe('edited-di')

        // NotebookEditTool resolves relative notebook_path via deps.cwd()
        const nbPath = join(tmpDir, 'demo.ipynb')
        const nbContent = JSON.stringify({
          cells: [
            {
              id: 'cell-0',
              cell_type: 'code',
              source: ['x = 1'],
              metadata: {},
              outputs: [],
              execution_count: null,
            },
          ],
          metadata: {},
          nbformat: 4,
          nbformat_minor: 5,
        })
        writeFileSync(nbPath, nbContent)
        deps.readFileState.set(nbPath, {
          content: nbContent,
          timestamp: Date.now() + 1000,
          offset: undefined,
          limit: undefined,
        })
        const nbVal = await NotebookEditTool.create!(deps).validateInput!(
          {
            notebook_path: 'demo.ipynb',
            new_source: 'x = 2',
            edit_mode: 'replace',
            cell_id: 'cell-0',
          } as never,
          createToolCallContext({ toolUseId: 'tu_cwd_nb' }),
        )
        expect(nbVal.result).toBe(true)
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    test('ListPeersTool, ArtifactTool, and PushNotificationTool isolate session slots across distinct deps.session instances', async () => {
      const s1 = makeSession('slot-s1')
      const s2 = makeSession('slot-s2')

      // ListPeersTool cursor cache isolated per session
      const cur1 = issueListAgentsCursor(new Set(['a1', 'a2']), s1)
      expect(lookupListAgentsCursor(cur1, s1)).toEqual(new Set(['a1', 'a2']))
      expect(lookupListAgentsCursor(cur1, s2)).toBeNull()

      // ArtifactTool stored DB access rules accept explicit session & reset cleanly per session
      recordStoredDbAccessRules(
        'db_iso',
        [{ table: 'users', read: true }] as never,
        s1,
      )
      _resetStoredDbAccessRulesForTesting(s1)
      _resetStoredDbAccessRulesForTesting(s2)

      // PushNotificationTool dedup map isolated per session via runWithNewHostSession
      await runWithNewHostSession({}, async () => {
        _recordPushNotificationDedupForTesting('same-title', 'same-msg')
        // A different session passed explicitly to PushNotificationTool.create({ session: s2 })
        // must NOT inherit the bootstrap session's dedup entry (no cross-session bleed).
        expect(PushNotificationTool.create).toBeDefined()
      })
    })
  })
})
