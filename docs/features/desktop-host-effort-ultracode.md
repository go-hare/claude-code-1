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
// 设普通 effort：CLI 会同时 ultracode:false + N9（densable 211 Host 对齐）
// 明确关 flag 仍可用 ultracode: false
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

### 3.1.1 同包 `effortLevel` + `ultracode` 冲突语义（固定序）

**应用顺序固定：`effortLevel` 先，`ultracode` 后。**  
不依赖 JSON key 书写顺序。后写的 `ultracode` 对 **flag** 有最终决定权；开 ultra 时还可 **覆盖** `effortValue` 到 catalog 顶档 wire。

| 同包字段 | 结果 | notes（若有） |
|----------|------|----------------|
| 仅 `effortLevel: "medium"` 等普通档 | wire=该档，`ultracode=false`，N9 | — |
| 仅 `effortLevel: null` | 清 session effort，`ultracode=false`，N9 | — |
| 仅 `effortLevel: "ultracode"` | **有 wire** → 顶档 + flag + N9；**无 wire** → **整段 no-op**（不抬空 flag） | `ultracode_alias_no_wire` |
| 仅 `effortLevel` 非法值（非 null/alias/档） | **忽略**该字段（不改 effort/flag） | `effort_level_ignored` |
| 仅 `ultracode: true` | **有 wire** → 顶档 + flag + N9；**无 wire** → **强制 `ultracode=false`** | `ultracode_true_no_wire` |
| 仅 `ultracode: false` | 只清 flag，不动 `effortValue` | — |
| `effortLevel` 普通档 + `ultracode: false` | wire=该档 + flag false（幂等） | — |
| `effortLevel` 普通档 + `ultracode: true` | **ultra 覆盖** → 顶档 wire + flag true | `same_packet_ultracode_overrode_effort`（当 wire≠原档时） |
| `effortLevel: "ultracode"` + `ultracode: false` | 别名先开顶档+flag，再被 false 清 flag；**wire 顶档可保留** | `same_packet_ultracode_false_after_alias` |
| `effortLevel: "ultracode"` + `ultracode: true` | 等同开 ultra | — |
| `effortLevel: null` + `ultracode: true` | 先 clear，再开 ultra → 有 wire 则顶档+flag | — |

**Host 推荐：** 避免同包塞互相打架的值。UI 滑条应：

- 切普通档 → 只发 `{ "effortLevel": "high" }`（CLI 会清 ultra）
- 切 Ultracode 末档 → 只发 `{ "ultracode": true }`
- 从 Ultra 拖回某档 → 推荐 `{ "ultracode": false, "effortLevel": "medium" }`（顺序无关，语义清晰）

### 3.1.2 无 wire 时是否给 Host 显式失败？

**结论：不 hard-fail（不发 `control_response` error），发 soft success + 可选 `effortNotes`。**

| 方式 | 是否采用 | 原因 |
|------|----------|------|
| `control_response` subtype=`error` | **否** | 同包可能已合并 `model` 等其它 flag；hard error 会让 Host 以为整包失败，但状态已部分生效 |
| 静默 success、无反馈 | **否**（相对 211 P0 已补） | Host 无法区分「用户开了 ultra」vs「模型无 wire 被拒」 |
| **success + `response.effortNotes[]`** | **是** | 与 bootstrap/settings 软拒绝空 flag 一致；权威 UI 仍以随后的 `get_settings.applied` 为准 |

成功响应示例（无 wire 开 ultra）：

```jsonc
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "<id>",
    "response": {
      "effortNotes": [
        {
          "code": "ultracode_true_no_wire",
          "message": "ultracode:true refused: model claude-haiku-4-5-… has no effort catalog wire; forced ultracode=false (soft success, not control error)."
        }
      ]
    }
  }
}
```

`effortNotes[].code` 枚举：

| code | 含义 |
|------|------|
| `ultracode_alias_no_wire` | `effortLevel:"ultracode"` 但模型无 catalog wire → 未改 AppState |
| `ultracode_true_no_wire` | `ultracode:true` 无 wire → 强制 flag false |
| `same_packet_ultracode_overrode_effort` | 同包普通 effort 被 `ultracode:true` 覆盖到顶档 |
| `same_packet_ultracode_false_after_alias` | 同包别名开 ultra 后被 `ultracode:false` 清 flag |
| `effort_level_ignored` | `effortLevel` 既非 null / 非 `"ultracode"` / 也非可解析 EffortLevel → 忽略该字段 |

Host 验收：

1. 发 `apply_flag_settings` 后 **必须** 再 `get_settings`，以 `applied.ultracode` / `applied.effort` 为准。
2. 若 `effortNotes` 非空，可 toast / 日志；**不要** 因 notes 重试 hard-fail。
3. 无 wire 模型：看 `applied.ultracodeOfferable === false`，UI **隐藏** Ultracode 档，不要发 `ultracode:true`。
4. 同包改 `model` 与 effort/ultracode 时，CLI 先应用 model override 再解析 wire；Host 仍应以随后的 `get_settings.applied` 为准。

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
