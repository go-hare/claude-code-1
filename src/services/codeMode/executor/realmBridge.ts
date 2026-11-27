/**
 * Host <-> VM realm bridge (E3-P0-1).
 *
 * Captures all VM primordials inside the realm in strict mode before any user
 * script runs, and clones all values / extracts all error info on the host side
 * so host-realm objects, Errors, Promises, Arrays, and functions NEVER leak
 * across the VM boundary.
 */
import { REPL_UNAWAITED_PROMISE_ERROR } from '../constants.js'
import type {
  PersistentCodeModeVmSession,
  RawRealmBridge,
  RealmBridge,
} from './types.js'

// Security (E3-P0-1 / Re-Audit P0-4, P0-5, P0-6, P1-C2):
// - Capture ALL VM primordials in strict mode BEFORE any user code runs.
// - Lock down `WebAssembly` on `globalThis` (Bun ignores `codeGeneration.wasm: false`).
// - NEVER pass raw host-realm objects, Errors, Promises, Arrays, or functions
//   into any VM prototype method or user-reachable `.then` callback.
// - Wrap EVERY host-callback call inside the VM realm in a `try/catch` that
//   never inspects the caught host exception and always throws/rejects a newly
//   constructed VM-realm error (`RangeError` on host stack unwind).
// - Provide a private lexical VM-realm invocation slot (`invokeSlotName`) so
//   compiled script factories run under `vm.Script` `{ timeout }` with ZERO
//   host accessors or temporary properties ever placed on `sandbox`/`globalThis`.
// - Settle script results completely inside the VM realm via `settleResult`
//   using captured `_Promise` + `_promiseThen` + immutable `[Symbol.species]`
//   holder so host `resolve`/`reject` are NEVER exposed to user `.then`.
export function createRealmBridgeInitSource(invokeSlotName: string): string {
  return `const ${invokeSlotName} = (() => {
  'use strict';
  const _Object = Object;
  const _Array = Array;
  const _Error = Error;
  const _TypeError = TypeError;
  const _RangeError = RangeError;
  const _Promise = Promise;
  const _Map = Map;
  const _Set = Set;
  const _RegExp = RegExp;
  const _Date = Date;
  const _Uint8Array = Uint8Array;
  const _String = String;
  const _JSONParse = JSON.parse;
  const _ReflectApply = Reflect.apply;
  const _defineProperty = _Object.defineProperty;
  const _create = _Object.create;
  const _getPrototypeOf = _Object.getPrototypeOf;
  const _getOwnPropertyDescriptor = _Object.getOwnPropertyDescriptor;
  const _mapSet = _Map.prototype.set;
  const _setAdd = _Set.prototype.add;
  const _promiseThen = _Promise.prototype.then;
  const _stringSplit = _String.prototype.split;
  const _stringSlice = _String.prototype.slice;
  const _objProto = _Object.prototype;
  const _arrProto = _Array.prototype;
  const _SymbolSpecies = Symbol.species;

  // Null-prototype descriptor avoids Object.prototype getter/setter pollution.
  const defineDataProp = (obj, key, value) => {
    const desc = _create(null);
    desc.value = value;
    desc.writable = true;
    desc.enumerable = true;
    desc.configurable = true;
    _defineProperty(obj, key, desc);
  };

  // Security (P1-C2): Lock down WebAssembly inside the VM realm before any
  // user code executes (Bun does not honor \`codeGeneration: { wasm: false }\`).
  const _wasmDesc = _create(null);
  _wasmDesc.value = undefined;
  _wasmDesc.writable = false;
  _wasmDesc.enumerable = false;
  _wasmDesc.configurable = false;
  try {
    _defineProperty(globalThis, 'WebAssembly', _wasmDesc);
  } catch {
    // Already non-configurable
  }

  // Immutable [Symbol.species] holder so user tampering with Promise[Symbol.species]
  // or Promise.prototype.constructor cannot intercept or break internal _promiseThen.
  const _safeSpecies = function (executor) {
    return new _Promise(executor);
  };
  const _safeCtorHolder = _create(null);
  _safeCtorHolder[_SymbolSpecies] = _safeSpecies;

  const makeArgs1 = (a0) => {
    const args = _create(null);
    args[0] = a0;
    args.length = 1;
    return args;
  };
  const makeArgs2 = (a0, a1) => {
    const args = _create(null);
    args[0] = a0;
    args[1] = a1;
    args.length = 2;
    return args;
  };

  // Official 2.1.331 (kernel.prelude.js): throw a helpful TypeError when an
  // unawaited Promise is coerced to a string instead of yielding "[object Promise]".
  defineDataProp(_Promise.prototype, 'toString', function () {
    throw new _TypeError(${JSON.stringify(REPL_UNAWAITED_PROMISE_ERROR)});
  });

  const makeError = (message, name) => {
    const msg = typeof message === 'string' ? message : '';
    let err;
    if (name === 'RangeError') err = new _RangeError(msg);
    else if (name === 'TypeError') err = new _TypeError(msg);
    else {
      err = new _Error(msg);
      if (typeof name === 'string' && name.length > 0 && name !== 'Error') {
        defineDataProp(err, 'name', name);
      }
    }
    return err;
  };

  const clipText = (text) =>
    text.length > 65536 ? _ReflectApply(_stringSlice, text, makeArgs2(0, 65536)) : text;

  // Read string data property walking up to 4 prototype hops without ever
  // invoking user-defined accessor getters.
  const readDataStringProp = (obj, key) => {
    let cur = obj;
    for (let hop = 0; hop < 4 && cur !== null && cur !== undefined; hop++) {
      let desc;
      try {
        desc = _getOwnPropertyDescriptor(cur, key);
      } catch {
        return undefined;
      }
      if (desc !== undefined) {
        if ('get' in desc || 'set' in desc) return undefined;
        return typeof desc.value === 'string' ? clipText(desc.value) : undefined;
      }
      try {
        cur = _getPrototypeOf(cur);
      } catch {
        return undefined;
      }
    }
    return undefined;
  };

  const newObj = () => _create(_objProto);
  const newNullObj = () => _create(null);
  const newArray = (len) => new _Array(len);
  const newDate = (ms) => new _Date(ms);
  const newRegExp = (source, flags) => new _RegExp(source, flags);
  const newUint8Array = (len, readByte) => {
    const u = new _Uint8Array(len);
    for (let i = 0; i < len; i++) {
      try {
        u[i] = readByte(i);
      } catch {
        u[i] = 0;
      }
    }
    return u;
  };
  const newMap = () => new _Map();
  const mapSet = (m, k, v) => {
    _ReflectApply(_mapSet, m, makeArgs2(k, v));
  };
  const newSet = () => new _Set();
  const setAdd = (s, v) => {
    _ReflectApply(_setAdd, s, makeArgs1(v));
  };

  const wrapSyncHostInvoke = (invokeHost) => function () {
    let ok = false;
    let result;
    let errMsg = '';
    let errName = 'Error';
    try {
      invokeHost(
        arguments,
        (val) => {
          ok = true;
          result = val;
        },
        (msg, name) => {
          errMsg = msg;
          errName = name;
        },
      );
    } catch {
      ok = false;
      errName = 'RangeError';
      errMsg = 'Maximum call stack size exceeded';
    }
    if (!ok) {
      throw makeError(errMsg, errName);
    }
    return result;
  };

  const wrapAsyncHostInvoke = (invokeHost) => function () {
    const vmArgs = arguments;
    return new _Promise((resolve, reject) => {
      try {
        invokeHost(
          vmArgs,
          (val) => resolve(val),
          (msg, name) => reject(makeError(msg, name)),
        );
      } catch {
        reject(makeError('Maximum call stack size exceeded', 'RangeError'));
      }
    });
  };

  const attachShellResultMethods = (out) => {
    defineDataProp(out, 'text', function () {
      return out.stdout;
    });
    defineDataProp(out, 'lines', function () {
      return _ReflectApply(_stringSplit, _String(out.stdout), makeArgs1('\\n'));
    });
    defineDataProp(out, 'json', function () {
      return _JSONParse(out.stdout);
    });
    return out;
  };

  const createShellPromise = (startRun) => {
    let optNothrow = false;
    let optMs = undefined;
    let optCwd = undefined;
    let optEnv = undefined;
    const readOpts = (cb) => {
      try {
        cb(optNothrow, optMs, optCwd, optEnv);
      } catch {
        // Never allow host exception to unwind into VM
      }
    };
    const p = new _Promise((resolve, reject) => {
      try {
        startRun(
          readOpts,
          (val) => resolve(val),
          (msg, name) => reject(makeError(msg, name)),
        );
      } catch {
        reject(makeError('Maximum call stack size exceeded', 'RangeError'));
      }
    });
    defineDataProp(p, 'nothrow', function () {
      optNothrow = true;
      return p;
    });
    defineDataProp(p, 'throws', function (on) {
      optNothrow = !on;
      return p;
    });
    defineDataProp(p, 'quiet', function () {
      return p;
    });
    defineDataProp(p, 'timeout', function (n) {
      optMs = n;
      return p;
    });
    defineDataProp(p, 'cwd', function (d) {
      optCwd = _String(d);
      return p;
    });
    defineDataProp(p, 'env', function (e) {
      optEnv = e;
      return p;
    });
    defineDataProp(p, 'text', function () {
      return _ReflectApply(_promiseThen, p, makeArgs1((o) => o.stdout));
    });
    defineDataProp(p, 'lines', function () {
      return _ReflectApply(
        _promiseThen,
        p,
        makeArgs1((o) =>
          _ReflectApply(_stringSplit, _String(o.stdout), makeArgs1('\\n')),
        ),
      );
    });
    defineDataProp(p, 'json', function () {
      return _ReflectApply(_promiseThen, p, makeArgs1((o) => _JSONParse(o.stdout)));
    });
    return p;
  };

  const createDollarFn = (dispatchHost, escapeFn) => {
    const fn = function () {
      let ok = false;
      let startRun;
      let errMsg = '';
      let errName = 'Error';
      try {
        dispatchHost(
          arguments,
          (runner) => {
            ok = true;
            startRun = runner;
          },
          (msg, name) => {
            errMsg = msg;
            errName = name;
          },
        );
      } catch {
        ok = false;
        errName = 'RangeError';
        errMsg = 'Maximum call stack size exceeded';
      }
      if (!ok) {
        throw makeError(errMsg, errName);
      }
      return createShellPromise(startRun);
    };
    defineDataProp(fn, 'escape', escapeFn);
    return fn;
  };

  // Security (P0-5): Settle any VM return value / Promise / custom thenable
  // completely inside the VM realm so host resolve/reject callbacks are NEVER
  // passed to user-overridden Promise.prototype.then or custom thenables.
  const settleResult = (val, onOk, onErr) => {
    const settled = new _Promise((vmResolve) => {
      vmResolve(val);
    });
    const ctorDesc = _create(null);
    ctorDesc.value = _safeCtorHolder;
    ctorDesc.writable = false;
    ctorDesc.enumerable = false;
    ctorDesc.configurable = false;
    _defineProperty(settled, 'constructor', ctorDesc);
    _ReflectApply(
      _promiseThen,
      settled,
      makeArgs2(
        (v) => {
          try {
            onOk(v);
          } catch {
            // Never unwind host error into VM microtask
          }
        },
        (e) => {
          let hasExtracted = false;
          let msg = '';
          let name = '';
          let stack = '';
          if (e === null || e === undefined) {
            hasExtracted = true;
            msg = e === null ? 'null' : 'undefined';
          } else {
            const t = typeof e;
            if (
              t === 'string' ||
              t === 'number' ||
              t === 'boolean' ||
              t === 'bigint' ||
              t === 'symbol'
            ) {
              hasExtracted = true;
              try {
                msg = clipText(_String(e));
              } catch {
                msg = '<unprintable thrown value>';
              }
            } else if (t === 'object') {
              const dataMsg = readDataStringProp(e, 'message');
              const dataName = readDataStringProp(e, 'name');
              const dataStack = readDataStringProp(e, 'stack');
              if (dataMsg !== undefined || dataName !== undefined) {
                hasExtracted = true;
                msg = dataMsg ?? '';
                name = dataName && dataName.length > 0 ? dataName : 'Error';
                stack = dataStack ?? '';
              }
            }
          }
          try {
            onErr(hasExtracted, msg, name, stack, hasExtracted ? undefined : e);
          } catch {
            // Never unwind host error into VM microtask
          }
        },
      ),
    );
  };

  // Security (P0-4): Private lexical invocation slot for compiled script
  // factories (zero properties on globalThis/sandbox).
  let _pendingFactory = null;
  let _pendingArg0 = undefined;
  let _pendingArg1 = undefined;
  const armFactoryInvoke = (fn, arg0, arg1) => {
    _pendingFactory = fn;
    _pendingArg0 = arg0;
    _pendingArg1 = arg1;
  };
  const disarmFactoryInvoke = () => {
    _pendingFactory = null;
    _pendingArg0 = undefined;
    _pendingArg1 = undefined;
  };

  let _initBridge = {
    newObj,
    newNullObj,
    newArray,
    newDate,
    newRegExp,
    newUint8Array,
    newMap,
    mapSet,
    newSet,
    setAdd,
    defineDataProp,
    makeError,
    wrapSyncHostInvoke,
    wrapAsyncHostInvoke,
    createDollarFn,
    attachShellResultMethods,
    armFactoryInvoke,
    disarmFactoryInvoke,
    settleResult,
    realmObjectPrototype: _objProto,
    realmArrayPrototype: _arrProto,
  };

  return () => {
    if (_initBridge !== null) {
      const b = _initBridge;
      _initBridge = null;
      return b;
    }
    const fn = _pendingFactory;
    const a0 = _pendingArg0;
    const a1 = _pendingArg1;
    _pendingFactory = null;
    _pendingArg0 = undefined;
    _pendingArg1 = undefined;
    if (typeof fn !== 'function') return undefined;
    return _ReflectApply(fn, undefined, makeArgs2(a0, a1));
  };
})();
${invokeSlotName}();`
}

export const REALM_BRIDGE_INIT_SOURCE = createRealmBridgeInitSource(
  '__cm_invoke_default',
)

export function copyVmArgs(argsLike: ArrayLike<unknown>): unknown[] {
  const len =
    typeof argsLike?.length === 'number' && argsLike.length > 0
      ? argsLike.length
      : 0
  const out: unknown[] = new Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = argsLike[i]
  }
  return out
}

export function extractHostErrorInfo(err: unknown): {
  msg: string
  name: string
} {
  let name = 'Error'
  if (err !== null && typeof err === 'object') {
    try {
      const rec = err as { message?: unknown; name?: unknown }
      if (typeof rec.name === 'string' && rec.name.length > 0) {
        name = rec.name
      }
      if (typeof rec.message === 'string') {
        return { msg: rec.message, name }
      }
    } catch {
      // Fall through to safe host-realm stringification
    }
  }
  try {
    return { msg: String(err), name }
  } catch {
    return { msg: '<unprintable thrown value>', name }
  }
}

type RawBridgeExtras = {
  armFactoryInvoke?: (fn: unknown, arg0: unknown, arg1: unknown) => void
  disarmFactoryInvoke?: () => void
  settleResult?: (
    val: unknown,
    onOk: (v: unknown) => void,
    onErr: (
      hasExtracted: boolean,
      msg: string,
      name: string,
      stack: string,
      rawErr: unknown,
    ) => void,
  ) => void
}

const rawBridgeExtrasByBridge = new WeakMap<RealmBridge, RawBridgeExtras>()

export type SettledVmOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown }

function reconstructHostErrorFromVm(
  msg: string,
  name: string,
  stack: string,
): Error {
  let err: Error
  if (name === 'TypeError') err = new TypeError(msg)
  else if (name === 'RangeError') err = new RangeError(msg)
  else if (name === 'ReferenceError') err = new ReferenceError(msg)
  else if (name === 'SyntaxError') err = new SyntaxError(msg)
  else {
    err = new Error(msg)
    if (name.length > 0 && name !== 'Error') {
      err.name = name
    }
  }
  if (stack.length > 0) {
    err.stack = stack
  }
  return err
}

export function armVmFactoryInvoke(
  bridge: RealmBridge,
  factory: unknown,
  arg0: unknown,
  arg1: unknown,
): void {
  const extras = rawBridgeExtrasByBridge.get(bridge)
  if (typeof extras?.armFactoryInvoke !== 'function') {
    throw new Error('Code Mode realm bridge missing armFactoryInvoke')
  }
  extras.armFactoryInvoke(factory, arg0, arg1)
}

export function disarmVmFactoryInvoke(bridge: RealmBridge): void {
  rawBridgeExtrasByBridge.get(bridge)?.disarmFactoryInvoke?.()
}

/**
 * Security (P0-5): Settle any VM-returned value/Promise/thenable completely
 * inside the VM realm, resolving a host Promise with a boxed host-owned
 * `SettledVmOutcome` so host Promise machinery NEVER invokes `.then` on a
 * VM-owned object or passes host resolve/reject functions into the VM.
 */
export function settleVmResult(
  bridge: RealmBridge,
  rawRun: unknown,
): Promise<SettledVmOutcome> {
  const extras = rawBridgeExtrasByBridge.get(bridge)
  if (typeof extras?.settleResult !== 'function') {
    return Promise.resolve({
      ok: false,
      error: new Error('Code Mode realm bridge missing settleResult'),
    })
  }
  return new Promise<SettledVmOutcome>(resolve => {
    let settled = false
    const finish = (outcome: SettledVmOutcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    try {
      extras.settleResult!(
        rawRun,
        val => {
          finish({ ok: true, value: val })
        },
        (hasExtracted, msg, name, stack, rawErr) => {
          if (hasExtracted) {
            if (name.length > 0) {
              finish({
                ok: false,
                error: reconstructHostErrorFromVm(msg, name, stack),
              })
            } else {
              finish({ ok: false, error: msg })
            }
          } else {
            finish({ ok: false, error: rawErr })
          }
        },
      )
    } catch (err) {
      finish({ ok: false, error: err })
    }
  })
}

export function buildHostRealmBridge(rawBridge: RawRealmBridge): RealmBridge {
  const cloneToRealm = (
    val: unknown,
    seen?: WeakMap<object, unknown>,
  ): unknown => {
    if (val === null || val === undefined) return val
    const t = typeof val
    if (
      t === 'string' ||
      t === 'number' ||
      t === 'boolean' ||
      t === 'bigint' ||
      t === 'symbol'
    ) {
      return val
    }
    if (t === 'function') return undefined

    const objVal = val as object
    const seenMap = seen ?? new WeakMap<object, unknown>()
    if (seenMap.has(objVal)) return seenMap.get(objVal)

    const tag = Object.prototype.toString.call(objVal)
    if (
      tag === '[object Date]' &&
      typeof (objVal as Date).getTime === 'function'
    ) {
      const d = rawBridge.newDate((objVal as Date).getTime())
      seenMap.set(objVal, d)
      return d
    }
    if (
      tag === '[object RegExp]' &&
      typeof (objVal as RegExp).source === 'string'
    ) {
      const re = objVal as RegExp
      const r = rawBridge.newRegExp(
        re.source,
        typeof re.flags === 'string' ? re.flags : '',
      )
      seenMap.set(objVal, r)
      return r
    }
    const bytesLike = objVal as {
      byteLength?: unknown
      length?: unknown
      subarray?: unknown
      [index: number]: number
    }
    if (
      typeof bytesLike.byteLength === 'number' &&
      typeof bytesLike.length === 'number' &&
      typeof bytesLike.subarray === 'function'
    ) {
      const byteLen = bytesLike.length
      const u = rawBridge.newUint8Array(byteLen, idx => bytesLike[idx] ?? 0)
      seenMap.set(objVal, u)
      return u
    }
    if (objVal instanceof Error || tag === '[object Error]') {
      const info = extractHostErrorInfo(objVal)
      const e = rawBridge.makeError(info.msg, info.name)
      seenMap.set(objVal, e)
      return e
    }
    if (
      tag === '[object Map]' &&
      typeof (objVal as Map<unknown, unknown>).forEach === 'function'
    ) {
      const m = rawBridge.newMap()
      seenMap.set(objVal, m)
      ;(objVal as Map<unknown, unknown>).forEach((v, k) => {
        rawBridge.mapSet(m, cloneToRealm(k, seenMap), cloneToRealm(v, seenMap))
      })
      return m
    }
    if (
      tag === '[object Set]' &&
      typeof (objVal as Set<unknown>).forEach === 'function'
    ) {
      const s = rawBridge.newSet()
      seenMap.set(objVal, s)
      ;(objVal as Set<unknown>).forEach(v => {
        rawBridge.setAdd(s, cloneToRealm(v, seenMap))
      })
      return s
    }
    if (Array.isArray(objVal)) {
      const srcArr = objVal as unknown[]
      const arr = rawBridge.newArray(srcArr.length)
      seenMap.set(objVal, arr)
      for (let i = 0; i < srcArr.length; i++) {
        rawBridge.defineDataProp(arr, i, cloneToRealm(srcArr[i], seenMap))
      }
      return arr
    }

    const outObj =
      Object.getPrototypeOf(objVal) === null
        ? rawBridge.newNullObj()
        : rawBridge.newObj()
    seenMap.set(objVal, outObj)
    const keys = Object.keys(objVal)
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!
      const v = (objVal as Record<string, unknown>)[k]
      if (typeof v !== 'function') {
        rawBridge.defineDataProp(outObj, k, cloneToRealm(v, seenMap))
      }
    }
    return outObj
  }

  const wrapSyncHostFn = (fn: (...args: unknown[]) => unknown): unknown =>
    rawBridge.wrapSyncHostInvoke((vmArgs, onOk, onErr) => {
      try {
        const raw = fn(...copyVmArgs(vmArgs))
        onOk(cloneToRealm(raw))
      } catch (err) {
        try {
          const info = extractHostErrorInfo(err)
          onErr(info.msg, info.name)
        } catch {
          onErr('Maximum call stack size exceeded', 'RangeError')
        }
      }
    })

  const wrapIdentityHostFn = (fn: (...args: unknown[]) => unknown): unknown =>
    rawBridge.wrapSyncHostInvoke((vmArgs, onOk, onErr) => {
      try {
        const raw = fn(...copyVmArgs(vmArgs))
        onOk(raw)
      } catch (err) {
        try {
          const info = extractHostErrorInfo(err)
          onErr(info.msg, info.name)
        } catch {
          onErr('Maximum call stack size exceeded', 'RangeError')
        }
      }
    })

  const wrapAsyncHostFn = (fn: (...args: unknown[]) => unknown): unknown =>
    rawBridge.wrapAsyncHostInvoke((vmArgs, onResolve, onReject) => {
      let res: unknown
      try {
        res = fn(...copyVmArgs(vmArgs))
      } catch (err) {
        try {
          const info = extractHostErrorInfo(err)
          onReject(info.msg, info.name)
        } catch {
          onReject('Maximum call stack size exceeded', 'RangeError')
        }
        return
      }
      if (
        res !== null &&
        (typeof res === 'object' || typeof res === 'function') &&
        typeof (res as { then?: unknown }).then === 'function'
      ) {
        Promise.resolve(res).then(
          val => {
            try {
              onResolve(cloneToRealm(val))
            } catch (cloneErr) {
              const info = extractHostErrorInfo(cloneErr)
              onReject(info.msg, info.name)
            }
          },
          err => {
            const info = extractHostErrorInfo(err)
            onReject(info.msg, info.name)
          },
        )
      } else {
        try {
          onResolve(cloneToRealm(res))
        } catch (cloneErr) {
          const info = extractHostErrorInfo(cloneErr)
          onReject(info.msg, info.name)
        }
      }
    })

  const createRealmObj = (
    entries: ReadonlyArray<readonly [string, unknown]>,
  ): unknown => {
    const obj = rawBridge.newObj()
    for (let i = 0; i < entries.length; i++) {
      rawBridge.defineDataProp(obj, entries[i]![0], entries[i]![1])
    }
    return obj
  }

  const createNullProtoObj = (
    entries: ReadonlyArray<readonly [string, unknown]>,
  ): unknown => {
    const obj = rawBridge.newNullObj()
    for (let i = 0; i < entries.length; i++) {
      rawBridge.defineDataProp(obj, entries[i]![0], entries[i]![1])
    }
    return obj
  }

  const createDollarFn: RealmBridge['createDollarFn'] = (
    dispatchHost,
    escapeHost,
  ) => {
    const sealedEscape = wrapSyncHostFn(escapeHost)
    return rawBridge.createDollarFn((vmArgs, onHandleOk, onErr) => {
      let runner: ReturnType<Parameters<RealmBridge['createDollarFn']>[0]>
      try {
        const args = copyVmArgs(vmArgs)
        runner = dispatchHost(args[0], args.slice(1))
      } catch (err) {
        try {
          const info = extractHostErrorInfo(err)
          onErr(info.msg, info.name)
        } catch {
          onErr('Maximum call stack size exceeded', 'RangeError')
        }
        return
      }
      onHandleOk((readOpts, onResolve, onReject) => {
        Promise.resolve().then(() => {
          let nothrow = false
          let ms: number | undefined
          let cwd: string | undefined
          let env: unknown
          try {
            readOpts((n, m, c, e) => {
              nothrow = Boolean(n)
              ms = typeof m === 'number' ? m : undefined
              cwd = typeof c === 'string' ? c : undefined
              env = e
            })
            const res = runner(nothrow, ms, cwd, env)
            Promise.resolve(res).then(
              rawOut => {
                try {
                  const cloned = cloneToRealm(rawOut)
                  if (cloned !== null && typeof cloned === 'object') {
                    rawBridge.attachShellResultMethods(cloned)
                  }
                  onResolve(cloned)
                } catch (cloneErr) {
                  const info = extractHostErrorInfo(cloneErr)
                  onReject(info.msg, info.name)
                }
              },
              err => {
                const info = extractHostErrorInfo(err)
                onReject(info.msg, info.name)
              },
            )
          } catch (err) {
            const info = extractHostErrorInfo(err)
            onReject(info.msg, info.name)
          }
        })
      })
    }, sealedEscape)
  }

  const bridge: RealmBridge = {
    cloneToRealm: val => cloneToRealm(val),
    makeError: (message, name) =>
      rawBridge.makeError(String(message ?? ''), name),
    wrapSyncHostFn,
    wrapIdentityHostFn,
    wrapAsyncHostFn,
    createRealmObj,
    createNullProtoObj,
    createDollarFn,
    realmObjectPrototype: rawBridge.realmObjectPrototype,
    realmArrayPrototype: rawBridge.realmArrayPrototype,
  }
  const extendedRaw = rawBridge as RawRealmBridge & RawBridgeExtras
  rawBridgeExtrasByBridge.set(bridge, {
    armFactoryInvoke: extendedRaw.armFactoryInvoke,
    disarmFactoryInvoke: extendedRaw.disarmFactoryInvoke,
    settleResult: extendedRaw.settleResult,
  })
  return bridge
}

/**
 * Seal a sync host function for realm exposure (official `o.fn`/`St(e,name,o.fn)`).
 */
export function sealForRealm(
  session: PersistentCodeModeVmSession,
  fn: (...args: never[]) => unknown,
): unknown {
  return session.bridge.wrapSyncHostFn(fn as (...args: unknown[]) => unknown)
}

/**
 * Seal an async host function for realm exposure so returned Promises, resolved
 * values, and rejected Errors all belong to the VM realm.
 */
export function sealAsyncForRealm(
  session: PersistentCodeModeVmSession,
  fn: (...args: never[]) => unknown,
): unknown {
  return session.bridge.wrapAsyncHostFn(fn as (...args: unknown[]) => unknown)
}
