# densable 2.1.214 Batch E — #19 stream-json exit drain by queue bytes

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## 问题

stream-json / SDK 管道退出时若仍有大量 stdout 排队，固定 2s drain 会截断 result 事件。  
densable 2.1.214 改为按 pending 字节以 256 KiB/s 估算预算，硬顶 30s。

## densable 证据

```
P_m = 262144          // assumed drain throughput B/s
L_m = 30000           // hard cap ms
P8y = 1500            // failsafe headroom on top of zRn

// Ds — writeToStdout
dll = true
t = byteLength(e)
if write ok: pll += t
on write callback: fll += t; qRn?.()

// hll — pending
destroyed || ldi ? 0 : max(0, pll - fll)

// zRn(base=2000)
min(L_m, max(base, ceil(hll() * 1000 / P_m)))

// O_m — wait queue empty (singleton); qRn notify; also stdout 'close'
// mll / XDe — external clock promise for failsafe race
// D_m(e) = mll().then(() => sleep(e))

// fVt(base=2000, {scaleBudgetToQueue=true})
if !odi:
  if TTY || destroyed || writableEnded || !dll: return
  odi = stdout.end()
n = all([odi, O_m])
work = scale ? race([n, D_m(base)]) : n
budget = scale ? zRn(base) : base
await withTimeout(work, budget, "stdout drain timeout (exit)").catch()

// FMd graceful exit
EDs(zRn() + P8y)   // failsafe timer
// ... cleanup ...
await fVt()
ADs(code)          // forceExit

// EDs failsafe body
XDe()
fVt(500, {scaleBudgetToQueue: false}).then(() => ADs(code))
```

## 本地落地

| densable | 本地 |
|----------|------|
| `P_m` `L_m` base 2000 | `STDOUT_DRAIN_*` in `src/utils/process.ts` |
| `Ds` | `writeToStdout` — byte enqueue + flush callback |
| `hll` | `getPendingStdoutBytes` |
| `zRn` | `getStdoutDrainBudgetMs` |
| `fVt` | `drainStdoutBeforeExit` |
| `XDe` | `markStdoutDrainExternallyClocked` |
| `adi` | `registerProcessOutputErrorHandlers`（stdout error → ldi） |
| `FMd`/`EDs` | `gracefulShutdown.ts`：failsafe `max(5s, hooks+3.5s, zRn+1.5s)`；body `XDe`+`fVt(500,false)`；正常路径 `await fVt()` 再 `forceExit` |

## 测试

`src/utils/__tests__/process.stdoutDrain.214.test.ts`

- pending 0 → base
- 公式 `min(30000, max(base, ceil(p*1000/262144)))`
- flush 后 pending 归零
- never-wrote / TTY 立即返回
- `scaleBudgetToQueue:false` 不按大队列拉长
- `XDe` 可重入

## 状态

- **#19 HAVE**
