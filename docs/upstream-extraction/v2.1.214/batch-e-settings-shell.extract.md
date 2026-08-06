# densable 2.1.214 Batch E — #17 settings 2MiB + #36 shell-config directory

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## #17 `--settings` device / 超大文件 → 启动失败

### densable 证据

```
Jme = 2097152  // 2 MiB

function qvl(fs, path, maxBytes) {
  const n = fs.statSync(path)
  if (n.isDirectory()) throw Object.assign(Error("EISDIR: …"), { code: "EISDIR", … })
  if (!n.isFile()) throw Object.assign(Error("Not a regular file (device, FIFO, or socket)"), { code: "ERR_NOT_REGULAR_FILE", path })
  if (maxBytes !== undefined && n.size > maxBytes)
    throw Object.assign(Error("File exceeds maxBytes limit"), { code: "ERR_FILE_TOO_LARGE", path, size, maxBytes })
}
function eWe(e) { return e?.code === "ERR_NOT_REGULAR_FILE" }
function bj(path, maxBytes) { return tWe(path, maxBytes).content }  // tWe → yf resolve + qvl + read

// --settings loader (path form):
let { resolvedPath: o } = yf(Jt(), e)
try { bj(o, Jme) }
catch (i) {
  if (ar(i)) return Ki(`Error: Settings file not found: ${o}`)
  if (qt(i) === "ERR_FILE_TOO_LARGE")
    return Ki(`Error: Settings file exceeds the ${Jme/1048576}MiB limit: ${o}`)
  if (eWe(i) || Tae(i))  // not-regular || EISDIR
    return Ki(`Error: Cannot use settings file (${ue(i)}): ${o}`)
  throw i
}
// outer: Error processing --settings / Error processing settings
```

### 本地落地

| densable | 本地 |
|----------|------|
| `Jme=2097152` | `FLAG_SETTINGS_MAX_BYTES` in `src/utils/settings/constants.ts` |
| `qvl` | `assertRegularFileWithinMaxBytes` in `src/utils/fsOperations.ts` |
| `eWe` / `Tae` | `isNotRegularFileError` / `isEISDIR` in `src/utils/errors.ts` |
| `--settings` path 校验 | `loadSettingsFromFlag` in `src/main.tsx` — assert + 三路错误文案 |

测试：`src/utils/__tests__/flagSettingsMaxBytes.214.test.ts`

---

## #36 shell-config 路径是目录 → update/doctor hang、/status 空白

### densable 证据

```
// mnn = readFileLines
async function mnn(e) {
  try { return (await readFile(e, {encoding:"utf8"})).split("\n") }
  catch (t) {
    if (Ko(t)) return null                    // isFsInaccessible
    if (Tae(t)) return T(`Skipping ${e}: path is a directory`, {level:"warn"}), null
    throw t
  }
}

// cMs = findClaudeAlias
async function cMs(e) {
  let t = Zut(e)  // getShellConfigPaths
  for (let r of Object.values(t)) {
    let n = await mnn(r).catch((o) => {
      if (L4e(o) || BEt(o) || CXy.has(qt(o)??""))
        return T(`Skipping unreadable shell config ${r} during alias scan: ${ue(o)}`, {level:"warn"}), null
      throw o
    })
    …
  }
}
// CXy = EBUSY, EOPNOTSUPP, ENOTSUP, ENOMEM, ERR_FS_FILE_TOO_LARGE, ENOTCONN, EHOSTDOWN, EHOSTUNREACH, ETIMEDOUT
```

### 本地落地

| densable | 本地 |
|----------|------|
| `mnn` + Tae soft-skip | `readFileLines` — `isEISDIR` → warn + null |
| `cMs` unreadable skip | `findClaudeAlias` catch → `isFsInaccessible \|\| isEISDIR \|\| isTransientShellConfigError` |
| `BEt` ∪ `CXy` | `isTransientShellConfigError` in `errors.ts` |

测试：`src/utils/__tests__/shellConfig.214.test.ts`

---

## #19 stream-json 退出 drain 按队列字节扩展

> 详见 `batch-e-stdout-drain.extract.md`（本文件历史条目保留 #17/#36）。

### densable 证据（摘要）

```
P_m = 262144   // B/s
L_m = 30000    // ms cap
Ds(e)          // writeToStdout — pll/fll 字节记账
hll()          // pending = pll - fll（destroyed/ldi → 0）
zRn(e=2000)    // min(L_m, max(e, ceil(hll()*1000/P_m)))
fVt(e=2000,{scaleBudgetToQueue:t=true})  // end+queue empty, budget zRn
XDe()          // external clock for failsafe race
FMd: EDs(zRn()+1500); await fVt(); ADs
// failsafe body: XDe(); fVt(500,{scaleBudgetToQueue:false}); ADs
```

### 本地落地

| densable | 本地 |
|----------|------|
| `P_m`/`L_m`/`Ds`/`hll`/`zRn`/`fVt`/`XDe` | `src/utils/process.ts` |
| `FMd` failsafe + pre-exit drain | `src/utils/gracefulShutdown.ts` |

测试：`src/utils/__tests__/process.stdoutDrain.214.test.ts`

---

## 状态

- **#17 HAVE**
- **#36 HAVE**
- **#19 HAVE**
- **#31** 仍 GAP/KAIROS skip（本批不动）
