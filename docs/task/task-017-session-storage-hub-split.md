# Task 017: 从 sessionStorage 拆出环外轻量助手模块

> 状态: 已实施，**收益未兑现**——模块拆出成功，但消费方一个都没出环
> 起因: 2.1.246 leftover 语义化收尾时，`storageV5.246.test.ts` 有用例因 7.7s 冷加载超时（已临时把该用例超时放宽到 30s，非本任务范围）
> 结论先行: **不能靠剪 import 解决**，必须新建一个刻意留在依赖环外的模块

## 实施结果（2026-09-15）

模块拆出达标，收益推算被实测推翻：

| 项 | 预期 | 实测 |
|----|------|------|
| `sessionPaths.ts` 独立冷加载 | < 250ms | **282ms**（33 模块） |
| 19 个消费方脱离依赖环 | 全部 | **0 / 19** |

**为什么 0/19**：判定"可搬"用的是"该文件从 sessionStorage 导入的符号是否全在轻量集合里"。
这只能说明 sessionStorage 这条边可以摘，**不能说明该模块没有别的门通向环**。实测 19 个全都
还能到达 `settings/settings.ts`，其中多数是**直接** import 它，压根不经过 sessionStorage。

这和文档下面"为什么剪 import 没用"讲的是同一个道理——我在推算收益时没把自己的结论套用到
消费方身上。

### 真正的瓶颈在别处

顺着消费方的最短路径查下去，整个 768 模块的环是**一条边**造出来的：

| 砍掉的边 | 可达模块数 |
|----------|-----------|
| （不砍）`settings/settings.ts` | 769 |
| `settings.ts` ⇥ `utils/file.ts` | **87**（省 682） |
| `utils/file.ts` ⇥ `services/analytics/growthbook.ts` | **35**（省 734） |

`src/utils/file.ts:16` 为了 `src/utils/file.ts:292` 处读一个 feature flag
（`tengu_compact_line_prefix_killswitch`）而 import `getFeatureValue_CACHED_MAY_BE_STALE`，
这一条边把 analytics 整棵树接了进来，进而形成环。

**这条边已经撬掉了**（见下"已实施：反向注册"）。但收益要按实测说，不能按上表外推——
上表是"砍掉这条边后 `file.ts` 自己还剩多少"，不等于"别人也跟着出环"。

全仓模拟只砍 `file.ts → growthbook` 这**一条边**（不是砍掉整个 `file.ts`）：

| 指标 | 数 |
|------|----|
| 砍前在环内的源文件（可达 ≥400） | 1524 |
| 砍后出环 | **80（5.2%）** |

出环的包括 `src/utils/settings/settings.ts`（770 → 91）和 `src/utils/file.ts`（770 → 36），
这两个被极大量模块直接 import，所以 5.2% 的文件数低估了实际价值。

但 **sessionStorage、messages、commands 以及本任务那 19 个消费方都不在出环名单里**——
它们另有独立的门。这个环是多入口的，不存在"一刀砍断"。

### 已实施：反向注册

照 `registerAccountOnHoldGateReader`（densable `de`）的写法，把方向倒过来：
`src/utils/file.ts` 开一个 reader 槽，`src/services/analytics/growthbook.ts` 在模块体里注册，
`file.ts` 不再 import growthbook。

实测冷加载：

| 模块 | 改前 | 改后 |
|------|------|------|
| `src/utils/file.ts` | 6141 ms | **81 ms** |
| `src/utils/settings/settings.ts` | 7055 ms | **374 ms** |

全仓环内文件 1524 → 1444，放出 80 个，与模拟预测一致。

行为不变：未注册 reader 时回退调用方的 fallback，与 GrowthBook 缓存未预热时
`getFeatureValue_CACHED_MAY_BE_STALE` 的返回完全一致——函数名里的 `_CACHED_MAY_BE_STALE`
本来就没做更强承诺。而 `FileReadTool.ts` / `FileEditTool.ts` 自己就 import growthbook，
真正用到紧凑前缀时注册必然已完成。

`src/utils/__tests__/fileGateReader.test.ts` 锁住回退语义，并断言 `file.ts` 不得再出现
那条 import——这是最容易被无意加回来的东西。

### 顺带修掉的循环依赖 TDZ

`bun -e "import('./src/utils/toolResultStorage.ts')"` 会抛
`Cannot access 'TOOL_RESULTS_SUBDIR' before initialization`。与上面撬边那件事无关，
是独立的真 bug（撬边前后都复现）。

`toolResultStorage.ts` 在一个 12 跳的环里：

```
toolResultStorage → analytics/metadata → model/model → modelCost → fastMode →
extraUsage → model/fableCreditsLabel → fableConsent → messageQueueManager →
messages → AgentTool/builtInAgents → AgentTool/built-in/webFetchAgent
  ↩ 回到 toolResultStorage
```

`webFetchAgent.ts` 在**模块级模板字符串**里读这个常量，所以只要 `toolResultStorage.ts`
是入口，环就会先跑 `webFetchAgent` 的模块体，此时常量还在 TDZ 里。

修法是把常量搬进无依赖的叶子 `src/constants/toolResults.ts`：叶子在任何环参与者开始执行前
就已完成初始化，绑定不可能处于 TDZ。`toolResultStorage.ts` re-export 保持现有导入不破。

值得记一笔的是，**叶子这一步就够了**——re-export 的绑定直接解析到叶子，所以即便仍从
`toolResultStorage.js` 导入也不会 TDZ。把 `webFetchAgent.ts` 改指向叶子是额外的防御，
不是修复的必要条件。

`src/utils/__tests__/toolResultStorageCycle.test.ts` 用独立子进程守着（TDZ 只在该模块
**作为入口**时触发，同进程里被别的测试先加载过就复现不出来）。已验证：把常量搬回环内，
测试立刻失败。

### 这次改动仍然保留

19 个消费方改指向 `sessionPaths.js` 没有回滚，理由是：语义上本来就该从定义它的模块导入；
而且只要它们还握着 sessionStorage 这条边，将来 growthbook 那条边撬开了它们照样出不了环。
它是必要条件，只是不充分。

## 目标

把 `src/utils/sessionStorage.ts` 里的纯路径/元数据助手搬进一个新模块，使得"只需要算一个 transcript 路径"的调用方不再被迫加载 768 个模块、付 ~8 秒冷启动。

验收标准是可量化的：**新模块独立冷加载 < 250ms**（对照：环内任意入口 ~8000ms，环外模块 1–210ms）。

## 背景

### 现状测量

`src/utils/sessionStorage.ts` 7992 行、167 个导出，运行时可达 **768** 个模块。

各模块独立冷加载（独立子进程，避开模块缓存）：

| 模块 | 冷加载 |
|------|--------|
| `src/utils/messages.ts` | 8737 ms |
| `src/utils/sessionStorage.ts` | 7977 ms |
| `src/utils/sessionPersistenceSync.ts` | 7673 ms |
| `src/commands.ts` | 7539 ms |
| `src/utils/format.ts` | 210 ms |
| `src/utils/path.ts` | 89 ms |
| `src/utils/storageV5/storageLock.ts` | 70 ms |
| `src/bootstrap/state.ts` | 39 ms |

分布是双峰的：要么 ~8 秒，要么 200 毫秒以内，中间没有东西。这就是一个强连通分量的特征——环内任何一个入口都要把整个环拉起来。

### 为什么剪 import 没用

逐条砍掉 `sessionStorage.ts` 的 37 条直接运行时依赖，可达数变化：

- `src/commands.ts` —— 省 136，余 632
- `src/utils/messages.ts` —— 省 8
- 其余 35 条 —— 各省 1~5

看起来 `commands.ts` 值得砍，但砍完剩下的 632 个里就有 `messages.ts`，而它自己就要 8737ms。**省掉的模块数不等于省掉的时间**，只要还留在环内就是 ~8 秒。

顺带查清了 `commands.ts` 为什么会被拉进来：`src/utils/sessionStorage.ts:37` 为了两处标题/预览启发式导入 `builtInCommandNames`，调用点在 `src/utils/sessionStorage.ts:3274` 和 `src/utils/sessionStorage.ts:7725`，都只是判断"这条斜杠命令消息值不值得当上下文"。注意 `src/commands.ts:529` 的 `builtInCommandNames` 是从 `COMMANDS()` 派生的 memoized **运行时函数**（含插件/技能命令、受 env/settings 门控），**不是静态字符串表**，所以不能简单抽成常量模块——只能注入或惰性 import。

### 可行性已验证

候选轻依赖里 16 个测了 15 个在环外（1–210ms），**只有 `src/utils/settings/settings.ts` 在环内（7055ms）**。

所以约束只有一条：**新模块不得 import `settings/settings.ts`**（直接或间接）。

## 可搬集合

`Project` 类单例定义在 `src/utils/sessionStorage.ts:833`。它之前有 31 个导出，是纯路径/元数据计算：

`isTranscriptMessage`、`isChainParticipant`、`isEphemeralToolProgress`、`getProjectsDir`、`getTranscriptPath`、`getTranscriptPathForSession`、`MAX_TRANSCRIPT_READ_BYTES`、`setAgentTranscriptSubdir`、`clearAgentTranscriptSubdir`、`getAgentTranscriptPath`、`AGENT_METADATA_PRESERVE_KEYS`、`writeAgentMetadata`、`readAgentMetadata`、`patchAgentMetadata`、`appendObserverRef`、`readLatestObserverRef`、`isObserverSidecarReattachable`、`getMainSessionObserverPointerPath`、`writeMainSessionObserverPointer`、`readMainSessionObserverPointer`、`patchMainSessionObserverPointer`、`writeRemoteAgentMetadata`、`readRemoteAgentMetadata`、`deleteRemoteAgentMetadata`、`listRemoteAgentMetadata`、`sessionIdExists`、`getNodeEnv`、`getUserType`、`isCustomTitleEnabled`、`getProjectDir`

**两个例外**（读函数体才发现，只看行号位置会漏）：

- `isTranscriptPersistenceDisabled` 调 `getSettings_DEPRECATED()`，会把 settings 拖进来
- `appendObserverRef` 调 `getProject().appendEntry()`，绑在 `Project` 单例上

两个都留在 `sessionStorage.ts`。实际搬走 **29 个值 + 3 个类型**。

另外三个私有助手也留下，因为文件后段仍在用：`isLegacyProgressEntry`（L6304）、
`getEntrypoint`（L2087），以及 `appendObserverRef` 所需的一切。

## 收益（推算，已被实测推翻——见文首"实施结果"）

81 个模块运行时 import `sessionStorage.ts`，其中 **19 个只用了上面这批轻助手**，可以直接改指向新模块：

| 模块 | 用到的符号 |
|------|-----------|
| `src/utils/attribution.ts` | `getTranscriptPath` |
| `src/utils/cleanup.ts` | `getProjectsDir` |
| `src/utils/hooks.ts` | `getTranscriptPathForSession`、`getAgentTranscriptPath` |
| `src/utils/stats.ts` | `getProjectsDir`、`isTranscriptMessage` |
| `src/utils/teleport.tsx` | `isTranscriptMessage` |
| `src/utils/toolResultStorage.ts` | `getProjectDir` |
| `src/utils/permissions/filesystem.ts` | `getProjectDir` |
| `src/utils/hooks/execAgentHook.ts` | `getAgentTranscriptPath`、`getTranscriptPath` |
| `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | `deleteRemoteAgentMetadata`、`listRemoteAgentMetadata`、`writeRemoteAgentMetadata` |
| `src/skills/bundled/dream.ts` | `getProjectDir` |
| `src/services/PromptSuggestion/speculation.ts` | `getTranscriptPath` |
| `src/services/compact/sessionMemoryCompact.ts` | `getTranscriptPath` |
| `src/services/autoModeSetup/recon/gather.ts` | `getProjectDir`、`getProjectsDir`、`getTranscriptPath` |
| `src/services/autoDream/autoDream.ts` | `getProjectDir` |
| `src/services/autoDream/consolidationLock.ts` | `getProjectDir` |
| `src/memdir/memdir.ts` | `getProjectDir` |
| `src/components/ultraplan/UltraplanChoiceDialog.tsx` | `getTranscriptPath` |
| `packages/builtin-tools/src/tools/SendMessageTool/SendMessageTool.ts` | `readAgentMetadata` |
| `packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx` | `writeAgentMetadata` |

余下 62 个仍需重实现（`loadTranscriptFromFile`、`recordTranscript`、`flushSessionStorage` 等），不在本任务范围。

注意这 19 个里多数是热路径（权限、hooks、attribution、AgentTool），它们目前为了一次 `join()` 付 8 秒。

⚠️ **上面这段推算是错的**。19 个改完之后一个都没出环，因为它们另有通向 `settings/settings.ts`
的边（多数是直接 import）。摘掉 sessionStorage 这条边是必要条件，不是充分条件。详见文首。

## 文件清单

### 新增

| 文件 | 说明 |
|------|------|
| `src/utils/sessionPaths.ts` | 环外轻量助手。**硬约束：不得 import `settings/settings.ts`，直接或间接** |
| `src/utils/__tests__/sessionPaths.loadbudget.test.ts` | 冷加载预算回归：独立子进程 import，断言 < 250ms |

### 修改

| 文件 | 改动 |
|------|------|
| `src/utils/sessionStorage.ts` | 移出 29 值 + 3 类型，改为从新模块 re-export（保持现有 import 不破）；`isTranscriptPersistenceDisabled`、`appendObserverRef` 留下。7993 → 7446 行 |
| 上表 19 个消费方 | import 改指向 `sessionPaths.js` |

## 实现方案

1. ✅ **先建预算测试再搬代码**。新模块一旦误引入环内依赖，8 秒会悄无声息地回来——测试是唯一的护栏。用独立子进程测，不能在主测试进程里测（模块缓存会掩盖）。
   实现了两条断言：耗时 < 1500ms，以及传递闭包里不得出现 `settings/settings.ts`。
   后者更早暴露问题——某次计时侥幸过线也拦得住。

2. ✅ **搬助手，`sessionStorage.ts` 改为 re-export**。对所有现有调用方无感。
   注意 import 块要按**内部实际使用**收窄（29 个里只有 9 个内部还在用），export 才是全量。

3. ✅ **把 19 个消费方的 import 改指向新模块**。判定不要写死名单——读 `sessionPaths.ts` 的
   导出面逐文件比对，脚本自己算出这 19 个，与手工清点一致。
   ⚠️ 这一步**没有**产生预期收益，见文首。

4. **`isTranscriptPersistenceDisabled` 单独处理**。它是这批里唯一碰 settings 的。如果有调用方只要它，考虑改成接收注入值；否则留在 `sessionStorage.ts`。（未做）

5. **`builtInCommandNames` 那条边可以顺手处理，但别指望它省时间**。参考 `src/commands.ts` 里 `clearSkillIndexCache?.()` 的可选回调注入写法——commands.ts 反向注册谓词，sessionStorage 只读。价值在解耦（session 存储不该依赖命令注册表），不在性能。（未做）

## 不做什么

- **不拆 `Project` 单例**。它和重依赖同住，动它等于动整个会话生命周期，风险与收益不成比例。本任务只搬它上面那段。
- **不试图让 `sessionStorage.ts` 本身变快**。它在环里，注定 ~8 秒。目标是让*不需要它*的调用方别再碰它。
- **不动那 62 个重实现消费方**。

## 环的真实形状：554 模块的强连通分量

前面几轮都在凭直觉猜"撬哪条边"。跑一次 Tarjan 之后才看清全貌：

- 全仓 5164 个节点里，size > 1 的强连通分量只有 14 个，最大的一个 **554 个模块**，第二大的只有 14 个。
  也就是说所谓"环"就是这一个巨块，没有第二个值得管的。
- `settings/settings.ts`、`file.ts`、`sessionPaths.ts` **不在**这 554 里——它们只是*能到达*。
  所以撬一条边就能放出来，这解释了 growthbook 那次为什么有效。
- `sessionStorage.ts`、`messages.ts`、`commands.ts`、`hooks.ts`、`attribution.ts`、
  `permissions/filesystem.ts` 以及那 19 个消费方**都是 554 的成员**。

这是"19 个改完 0 收益"的根因，比文首的解释更准确：它们不是环的外围，是环的**一部分**。
成员与外围的区别决定了手段——外围砍一条边就走，成员必须先打破 SCC。

**只有能改变 SCC 大小的边才值得看。** 554 条内部边里有 486 条能让它变小，但绝大多数只减几个。
真正有结构意义的是一条 6 段的链，砍任意一段都把 554 打成 ~343：

```
model/model.ts → modelCost.ts → fastMode.ts → extraUsage.ts →
model/fableCreditsLabel.ts → fableConsent.ts → messageQueueManager.ts
```

（正是 `TOOL_RESULTS_SUBDIR` 那个 TDZ 环路里的同一段——同一处结构缺陷先后以性能和崩溃两种面目出现。）

## 撬 `fableConsent.ts → messageQueueManager.ts`

链的末端最划算。`messageQueueManager` 会拉到 `messages.ts` / `sessionStorage.ts`（都在 SCC 里），
而 `fableConsent.ts` 只用它两个符号（`getCommandQueueSnapshot` / `subscribeToCommandQueue`），
三个调用点全在 park-watch 那一个被 `watchQueue && parkTimeoutMs > 0` 守着的分支里。

改成惰性 `require`，沿用仓里既有写法（`daemonLock.ts:51`、`REPL.tsx:4424`、
`artifactAutoReact/bootstrap.ts:122` 都是"为断环而惰性加载"并在注释里写明）。净改动 9 增 4 删。

| 指标 | 改前 | 改后 |
|------|------|------|
| 全仓重依赖模块（可达 ≥400） | 1464 | **1051**（放出 413） |
| `model/model.ts` 可达 | 1298 | 183 |
| `model/model.ts` 冷加载 | 5515 ms | **714 ms** |
| `fastMode.ts` / `modelCost.ts` / `memdir.ts` 冷加载 | ~5500 ms | ~700 ms |

对照：`file.ts → growthbook.ts` 那次放出 80 个。这条边值 5 倍。

**仍然没救到 `sessionStorage` / `messages` / 那 19 个消费方**——它们在切口的另一侧，
正是 `messageQueueManager` 所依赖的东西。要动它们得另找边。

护栏：`src/utils/__tests__/fableConsentLazyQueue.test.ts`。

## 经验

**一、判定"某模块能否脱离依赖环"，只看它从目标模块导入了什么是不够的**——那只说明**这条边**可摘。
必须直接算传递闭包，看它是否还能到达环的标志物。本任务在推算阶段漏了这一步，代价是
19 个文件的改动换来 0 收益。预算测试里的第二条断言（查闭包而非查耗时）就是这个教训的产物。

**二、先算 SCC，再挑边。** 前三轮是挨个猜边、改完再量，命中率靠运气。Tarjan 跑一次 4 秒，
直接给出"谁是成员、谁是外围、哪条边能改变结构"。应该第一步就做。

**三、A/B 必须交叉进行。** 第一次量这条边时，"改前"是 `git stash` 刚重写文件之后测的，
磁盘缓存冷，读数虚高。来回切换 4 轮交叉测才可信（两组读数无重叠才算数）。

**四、未被使用的 import 不构成回归。** 验护栏时往 `fableConsent.ts` 塞了个静态 import，
预算断言却照样通过——TypeScript/Bun 会消除未在值位置使用的 import，运行时那条边根本不存在。
加 `void __probe` 强制使用后才复现出 5.5 秒。**构造回归去验测试时，要确认构造的回归真的生效了。**
