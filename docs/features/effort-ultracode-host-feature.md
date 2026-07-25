# CLI 侧新增：Effort / Ultracode Host 控制面（给桌面端）

> 一句话：桌面端可以像官方 Desktop 一样，**在会话中改 Effort、开关 Ultracode、并查询当前状态**——通过 stream-json control 的 `apply_flag_settings` / `get_settings`，以及 spawn 参数 `--effort`。
> 与 densable 官方 2.1.211 控制面对齐（提交 `a95b2309` 起；文档 + fenced-JSON 容错 `60aee390`）。

---

## 1. 我们加了什么

| # | 能力 | 入口 | 说明 |
|---|------|------|------|
| 1 | spawn 指定 effort | `--effort low\|medium\|high\|xhigh\|max` | 只改 effort，**不开** ultracode |
| 2 | spawn 开 ultracode | `--effort ultracode` | 别名：开 session flag + wire 用该模型 catalog 顶档 + workflows 编排 |
| 3 | **会话中改 effort** | control `apply_flag_settings { "effortLevel": "high" }` | 直写 AppState + N9 释放 launch pin；`null` 清除 session effort |
| 4 | **会话中开/关 ultracode** | control `apply_flag_settings { "ultracode": true/false }` | 开：flag + 强制顶档 wire + N9；关：清 flag |
| 5 | 别名开 ultracode | control `apply_flag_settings { "effortLevel": "ultracode" }` | 与 densable 一致：等价于 `ultracode: true` |
| 6 | **查询当前状态** | control `get_settings` → `applied` | 返回运行时真实值，见 §3 |
| 7 | **查询模型能力** | `get_settings` → `applied.effortLevels` / `applied.ultracodeOfferable` | fork 扩展：滑条刻度 + Ultracode 档是否可显示，Host 不用再维护模型表 |
| 8 | 非法值不崩 | `--effort not-a-level` | soft-warn 到 stderr，走默认 effort |
| 9 | fenced JSON 容错 | buddy / memdir | 模型输出带 \`\`\` 不再刷 ERROR（densable eee） |

---

## 2. 语义（桌面端 UI 对齐用）

- **EffortLevel 只有 5 档**：`low / medium / high / xhigh / max`。
- **ultracode 不是第 6 档**，是一个 session 模式：
  `ultracode = session flag + wire 顶档 effort + dynamic workflow 编排`
- 新开 session 默认 **关**。
- `--effort xhigh` ≠ ultracode：只有 effort，没有编排。
- wire 顶档**按模型 catalog**（Claude 通常是 `xhigh`；3p 模型可能是 `high` 等），不写死。
- 激活条件（`applied.ultracode === true`）：
  flag 开 **且** workflows 可用（未 `disableWorkflows`）**且** 当前 applied effort == 该模型顶档。

---

## 3. 查询返回（get_settings.applied）

```jsonc
{
  "applied": {
    "model": "claude-opus-4-7",
    "effort": "xhigh",      // 当前 wire 档 | null（模型不支持 effort 时）
    "ultracode": true,       // footer「· Ultracode」/ 滑条末档高亮
    "advisor": null,          // 可选
    "effortLevels": ["low", "medium", "high", "xhigh", "max"], // 可选：滑条刻度（该模型支持的档）
    "ultracodeOfferable": true // 可选：false 时 UI 隐藏 Ultracode 档
  }
}
```

- 改完 `apply_flag_settings` 再查一次 `get_settings`，以 `applied` 为准刷新 UI。
- 模型不支持 effort / workflows 门闩关闭时，`applied.ultracode` 必为 `false`——**UI 应隐藏 Ultracode 档，不要假开**。
- 滑条刻度直接用 `applied.effortLevels`（如 deepseek-v4-pro 为 `["high","max"]`）；旧版本 CLI 没有这两个扩展字段，Host 需按模型表做缺省回退。

---

## 4. 桌面端对接示例

```jsonc
// 滑条切到 high
{ "subtype": "apply_flag_settings", "settings": { "effortLevel": "high" } }

// 滑条拖到末档 Ultracode
{ "subtype": "apply_flag_settings", "settings": { "ultracode": true } }

// 从 Ultracode 拖回 medium
{ "subtype": "apply_flag_settings", "settings": { "ultracode": false, "effortLevel": "medium" } }

// 查询（渲染 footer / 滑条位置）
{ "subtype": "get_settings" }
```

SDK 侧等价：`client.applyFlagSettings({...})` / `client.getSettings()`。

---

## 5. 注意（与官方一致，勿当 bug）

1. **`--help` / soft-warn 的 Valid values 不含 ultracode**——它是别名，官方也不列。验收不要要求 `help | grep ultracode`。
2. **没有独立 control** `set_effort` / `set_ultracode`——官方没有，我们不加。
3. 3p / 自定义模型：effort/ultracode 按 catalog 解析；不支持时 `applied.effort` 为 `null`、ultracode 不会伪激活。
4. 会话内改已有 session 必须用 control；再 spawn 一次是新进程。

---

## 6. 相关提交

| SHA | 内容 |
|-----|------|
| `9200e316` | model-driven effort resolve + ultracode session 模式 |
| `a95b2309` | get_settings.applied.ultracode/advisor + apply_flag 直写 AppState + help 对齐官方 |
| `60aee390` | densable eee fenced-JSON 容错 + 本文档 |

详细字段级契约见 `docs/features/desktop-host-effort-ultracode.md`。
