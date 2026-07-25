# Desktop Host：Effort / Ultracode 对接说明

面向 **Desktop Host**（spawn 本地 `claude` / stream-json control）。  
对齐 densable 官方控制面（CLI ≥ **含 `a95b2309` 的构建**；包版本以 `--version` 为准）。

---

## 1. 概念（先读这个）

| 概念 | 含义 |
|------|------|
| **EffortLevel** | 仅 5 档：`low` \| `medium` \| `high` \| `xhigh` \| `max` |
| **ultracode** | **不是** EffortLevel。本会话模式 = **session flag** + **wire 顶档 effort** + **dynamic workflows** |
| **wire effort** | 真正进 API 的 effort 档（catalog 顶档；Claude 多为 `xhigh`，其它模型可能是 `high` 等） |
| **active ultracode** | flag 开 **且** workflows 可开 **且** 当前 applied effort 等于该模型顶档 |

- 新会话默认 **关** ultracode。
- `--effort xhigh` / `max` **只改 effort，不开** ultracode。
- `--effort ultracode` ≡ 开 flag + wire 用 catalog 顶档。

**没有** 独立 control：`set_effort` / `set_ultracode` / `get_effort`。  
官方与本 CLI 一律用下面两个 subtype。

---

## 2. Spawn（进程启动）

```bash
# 普通 effort（不开 ultracode）
claude --effort medium -p "…"
claude --effort xhigh -p "…"

# 开 ultracode（flag + 顶档 wire）
claude --effort ultracode -p "…"
```

| 参数 | 行为 |
|------|------|
| `--effort <level>` | `level` ∈ EffortLevel → 只设 session effort |
| `--effort ultracode` | 开 ultracode 模式（别名，非 EffortLevel） |
| 非法值 | **soft-warn** 到 stderr，**不崩**；忽略该参数，走默认 effort |

### help / soft-warn 文案（densable 语义，请勿当 bug）

- **`--help` / Valid values** 只列：`low, medium, high, xhigh, max`
- **`ultracode` 可传、不出现在 Valid values 列表**（XLr 别名）
- Host 验收 **不要** 要求 `help \| grep ultracode` 或 soft-warn 必须含 `ultracode`

---

## 3. 会话中控制（stream-json / SDK control）

### 3.1 设置 — `apply_flag_settings`

```json
{
  "type": "control_request",
  "request_id": "<id>",
  "request": {
    "subtype": "apply_flag_settings",
    "settings": { }
  }
}
```

`settings` 常用字段：

| 字段 | 类型 | 作用 |
|------|------|------|
| `effortLevel` | string \| `null` | 设 effort；`null` 清除 session effort。**可传** `"ultracode"`（别名 → 顶档 wire + 开 flag） |
| `ultracode` | boolean | `true`：开 flag，并把 effort 拉到 catalog 顶档；`false`：关 flag |
| `model` 等 | … | 其它 flag 层设置，与 effort 无关时可一并浅合并 |

**推荐 Host 写法：**

```jsonc
// 设普通 effort（并应关掉 ultracode 语义时：改 effortLevel 即可；
// 明确关 flag 用 ultracode: false）
{ "effortLevel": "high" }

// 开 ultracode（推荐显式 flag）
{ "ultracode": true }

// 或用别名（与 densable 一致）
{ "effortLevel": "ultracode" }

// 关 ultracode
{ "ultracode": false }

// 关 ultra 并落到某一档
{ "ultracode": false, "effortLevel": "medium" }
```

SDK（若用）：

```ts
await client.applyFlagSettings({ effortLevel: 'high' })
await client.applyFlagSettings({ ultracode: true })
await client.applyFlagSettings({ ultracode: false })
```

### 3.2 查询 — `get_settings`

```json
{
  "type": "control_request",
  "request_id": "<id>",
  "request": { "subtype": "get_settings" }
}
```

成功响应里关注 **`applied`**（运行时真实值，不是磁盘 merge 的 `effective`）：

```jsonc
{
  "effective": { /* 合并后的 settings 对象 */ },
  "sources": [ /* 各层原始 settings */ ],
  "applied": {
    "model": "claude-opus-4-7",
    "effort": "xhigh",          // string 档 | null（模型不支持 effort / 数值 ant-only 等）
    "ultracode": true,          // boolean：当前是否处于 ultracode 模式（Dee）
    "advisor": null,            // string | null，可选
    "effortLevels": ["low", "medium", "high", "xhigh", "max"],  // 可选（fork 扩展）
    "ultracodeOfferable": true  // 可选（fork 扩展）：UI 是否应显示 Ultracode 档
  },
  "errors": [ /* 可选：settings 校验错误 */ ]
}
```

| 字段 | Host 用途 |
|------|-----------|
| `applied.effort` | footer / 滑条当前位置（wire 档） |
| `applied.ultracode` | footer「· Ultracode」、末档高亮 |
| `applied.model` | 当前主模型 |
| `applied.advisor` | 可选；无 advisor 时为 `null` |
| `applied.effortLevels` | **可选（fork 扩展）**：该模型支持的 effort 档列表，滑条刻度用。模型无 effort 能力时为 `[]`；旧版本 CLI 无此字段，Host 需做缺省回退（按模型表缓存） |
| `applied.ultracodeOfferable` | **可选（fork 扩展）**：workflows 可用且模型有顶档 wire 时为 `true`；为 `false` 时 UI 应隐藏 Ultracode 档，不要假开 |

**查询幂等：** 改完 `apply_flag_settings` 后再发 `get_settings`，以 `applied.ultracode` / `applied.effort` 为准刷新 UI。

---

## 4. 关 ultracode 怎么表达

| 方式 | 结果 |
|------|------|
| `apply_flag_settings { "ultracode": false }` | 关 flag（推荐） |
| `apply_flag_settings { "effortLevel": "medium" }`（等非 ultra 档） | 设 effort；settings 同步路径会清 ultra flag |
| 新开进程、不带 `--effort ultracode` | 新会话默认关 |

**不要** 指望再 spawn 一次带 `--effort medium` 去改**已有**会话——那是新进程。已有会话必须用 control。

---

## 5. 3p / 自定义模型（简要）

- Effort / ultracode **按模型 catalog** 解析，不是写死「永远 xhigh」。
- 模型 **无 effort 能力** 时：`applied.effort` 可为 `null`；ultracode **不会** 伪造成 active（`applied.ultracode === false`）。
- ultracode **还依赖 workflows 门闩**（`disableWorkflows` / `enableWorkflows` / 环境与策略）。门闩关时：`isUltracodeOfferable` 为 false → **查出来也是 false**，Host 应隐藏 Ultracode 档，不要假开。
- Host **暂无** 启动 JSON 字段 `effort_supported` / `ultracode_supported`（可选增强，未做）。探测方式：
  1. 会话内 `get_settings` 看 `applied.effortLevels` / `applied.ultracodeOfferable`（fork 扩展字段，见 §3；旧版本 CLI 无此字段，需缺省回退）；
  2. 或产品侧按模型表缓存（推荐与 catalog 一致）。

---

## 6. 验收建议（给 Host QA）

```bash
claude --version
# spawn
claude --effort ultracode -p "ping"     # 应成功
claude --effort xhigh -p "ping"         # 应成功，且 ≠ 自动开 ultracode
claude --effort not-a-level -p "ping"   # soft-warn，不崩
```

会话内（stream-json control）：

1. `apply_flag_settings { "ultracode": true }` → `get_settings` → `applied.ultracode === true`
2. `apply_flag_settings { "ultracode": false }` → `get_settings` → `applied.ultracode === false`
3. `apply_flag_settings { "effortLevel": "high" }` → `applied.effort === "high"`（且不应无故保持 ultra active）

**不要** 作为失败条件：

- `claude --help` 不含字符串 `ultracode`
- soft-warn `Valid values:` 不含 `ultracode`

---

## 7. 不在本契约内

- Desktop Faster/Smarter 紫色滑条 UI
- 独立 `set_effort` / `set_ultracode` control 名（官方没有，本 CLI 也不加）
- 启动 capability 一行 JSON（P3，未做）

---

## 8. 一句话

> Desktop Host：spawn 用 `--effort`；会话中用 **`apply_flag_settings`** 设、`get_settings.applied` 查；ultracode 是 flag 不是 EffortLevel；help/soft-warn 故意不列 ultracode。

有问题对 CLI 版本号 + 一次 `get_settings` 的 `applied` 截图即可排查。
