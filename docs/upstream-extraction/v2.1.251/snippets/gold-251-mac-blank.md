# gold-251 — Mac blank / wrap-stream / darwin bullet

> SEA `%TEMP%\official-251\package\claude.exe` · 217360032 · `--version` 2.1.251  
> Peel: `_peel-251-mac-blank*.mjs` · scan dumps `gold-251-mac-blank*.txt`  
> Invent-ban. Not HAVE. 对照 tip（248 基线 Ink）的 Mac 空白假设。

## Verdict（对 Mac 「空白 / 截断」）

**用户实测：官方 Mac 正常，tip 空白。** 因此不能把现象甩锅给「官方也有的 wrap-stream pop」——pop 只藏**未完成的最后一视觉行**（N−1 行仍在）；tip 的「只剩子弹 / 大块空」是**额外分歧**。

| 点 | 251 官方 | tip 本地 | 结论 |
| -- | -------- | -------- | ---- |
| `wrap-stream` 末行 | `qv`：`if(c)S.pop(),E.pop()` | 同样 pop | 两边都有；**官方正常 ⇒ 不是根因**；勿删 pop |
| Streaming 布局 `Ba` | `minWidth:2` + `width:"100%"` + column + `eXt` | `StreamingTextPreview` 同 | 对齐 |
| darwin 子弹 / Bun 宽 | 裸 `\u23FA` + `ambiguousIsNarrow:!0` | 同 | 对齐；勿加 VS16 |
| **softWrap 种类** | `di={HardBreak:0,Continuation:1,ContinuationElidedSep:2}` | tip 已对齐（`softWrap.ts`） | **对齐中** |
| **softWrap 打包写入** | `U[y]=elided?k\|Ao:k`；`k=id(end,start)` | tip `output.ts` write 臂已对齐 | **对齐中** |
| **`Bd` 样式回贴** | 第 6 参 + ElidedSep 跳空格 | tip `applyStylesToWrappedText` 已接 | **对齐中** |

## 官方关键体（sha / 摘录）

### `qv` wrap-stream（sha `532404dea2f0d848`）

```js
function qv(t,o,u){
  let c=u==="wrap-stream";
  if(u!=="wrap"&&u!=="wrap-trim"&&!c)return{wrapped:uy(t,o,u),softWrap:void 0};
  let m=c?"wrap":u,p=t.replace(/\r\n?/g,`\n`).split(`\n`),S=[],E=[];
  for(let x of p){
    let M=uy(x,o,m).split(`\n`);
    for(let R=0;R<M.length;R++){
      if(R===0){S.push(M[R]),E.push(di.HardBreak);continue}
      let _=M[R],N=_.startsWith(" ")?_.slice(1):_,A=Wr(N)>0?N:_;
      S.push(A),E.push(A.length<_.length?di.ContinuationElidedSep:di.Continuation)
    }
  }
  if(c)S.pop(),E.pop();
  return{wrapped:S.join(`\n`),softWrap:E}
}
```

### 宽度链

```js
var n={ambiguousIsNarrow:!0};function se(t){return Bun.stringWidth(t,n)}
class Pm{#e=new Map;measure(t){… let u=se(t); …}}
function gGe(t){return bS.measure(t)}
```

### softWrap 写入（Output.get write 臂）

```js
U[ie]=ce===di.HardBreak||ce===void 0?0
  :ce===di.ContinuationElidedSep?k|Ao:k;
k=id(K,O)  // id(end,start)= end<<16 | start&32767 ; Ao=32768
```

选择拷贝 `iv` 在 `(x&Ao)!==0` 时于 join 处补回空格。

### darwin 子弹

```js
var Tr=D()==="macos"?"\u23FA":"\u25CF"
```

无 `\uFE0F`。

## changelog 251 相关？

71 条里**没有** Mac 空白 / emoji 宽 / wrap-stream 修法。近邻：

- **#15** 并行 subagent progress tick 替换（减 transcript 堆积）— UNKNOWN/未剥为 Mac 空白。
- **#36** `TERM` 以 `screen` 开头不发 italic — PARTIAL；Mac Terminal 默认不是该路径。
- **#46** 减冗余重绘 — STRING-ONLY。

## 对「改」的约束

1. **禁止**去掉 `wrap-stream` 的 `pop`（官方仍 pop；官方 Mac 正常说明 pop ≠ tip 空白）。
2. **禁止**给 darwin `⏺` 加 VS16（官方仍裸 `\u23FA`）。
3. **应对齐 251 Ink softWrap 合同**（最可能的 tip 独有分歧）：
   - `wrapWithSoftWrap` / `qv`：产出 `0|1|2`，勿 `boolean[]`
   - `output.get` write 臂：`id(end,start)` + `Ao` elide bit
   - `applyStylesToWrappedText` / `Bd`：接第 6 参，ElidedSep 跳原串空格
   - `selection` / `iv`：按 `>>>16` / `Pr` / `Ao` 读
4. changelog 251 无 Mac 空白条；这是 Ink 合同落后，不是 changelog HAVE。

## Bun 实测（本机）

| 串 | ambiguousIsNarrow true | false |
| -- | ---------------------- | ----- |
| `\u23FA` | 1 | 1 |
| `\u23FA\uFE0F` | 2 | — |
| `\u25CF` | 1 | 2 |
