# densable 2.1.214 Batch E — #40 hooks exit 2 still blocks on JSON schema fail

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## 问题

hooks 退出码 2 表示 blocking。若 stdout 看起来像 JSON 但 **schema 校验失败**，旧路径把结果当成 `non_blocking_error` 并 **return**，吞掉 exit 2 block。

## densable 证据

命令 hook 主路径：

```js
let {json:_e, plainText:Re, validationError:ge}=YHo(we.stdout);
if (ge && we.status !== 2) {
  // non_blocking_error + return
}
if (_e) {
  let pe = urn({json:_e, ...});
  if (we.status === 2 && !pe.blockingError)
    pe.blockingError = { blockingError: `[${oe}]: ${we.stderr||"No stderr output"}`, command: oe };
  yield { ...pe, outcome: pe.blockingError ? "blocking" : "success", hook:G };
  return;
}
// 非 JSON 路径: if (we.status === 2) yield blockingError...
```

次级路径（file/watch 类）：

```js
let {json:P, validationError:L}=YHo(k.stdout);
if (L && k.status !== 2) throw Error(L);
let M = P && g2(P) && P.decision === "block";
let $ = k.status === 2 || !!M;
```

文案：`Exit code 2 - show stderr to model and block tool call`。

## 本地落地

| densable | 本地 |
|----------|------|
| `ge && status!==2` | `hooks.ts` command path + secondary parse path |
| exit2 synthesize blockingError | JSON path: `if status===2 && !processed.blockingError` |
| outcome | `processed.blockingError ? blocking : success` |
| pure gate | `hookExit2Priority.ts` + `hookExit2Priority.214.test.ts` |

## 状态

- **#40 HAVE**
