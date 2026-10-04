# ULTRAPLAN — 已产品拆除

> densable 2.1.222 #21 Removed ultraplan feature.
> 本仓库跟随官方：**命令 / 对话框 / ccrSession / AppState 字段已删除**，不是
> `FEATURE_ULTRAPLAN=1` 残留门。

<Warning>
不要复活 `/ultraplan`、不要把 `ULTRAPLAN` 加回 `DEFAULT_BUILD_FEATURES`、不要
再加 `feature('ULTRAPLAN')` 门。ultracode / ultrareview 关键字检测在
`src/utils/workflowKeyword.ts`，与 ultraplan 无关。
</Warning>

## 拆除范围

| 原模块 | 现状 |
|------|------|
| `src/commands/ultraplan.tsx` | 已删 |
| `src/components/ultraplan/` | 已删 |
| `src/utils/ultraplan/`（含 ccrSession / prompt / keyword） | 已删 |
| AppState `ultraplan*` / `isUltraplanMode` | 已删 |
| `ULTRAPLAN_TAG` | 已删 |
| ExitPlanMode 「refine with Ultraplan」选项 | 已删 |
| REPL ultraplan-choice / ultraplan-launch | 已删 |

回归锁：`scripts/__tests__/ultraplanProductOff.222.test.ts`。
