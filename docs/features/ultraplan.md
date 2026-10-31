# ULTRAPLAN

> densable 2.1.222 #21 removed the `ULTRAPLAN` **compile flag**.
> densable 2.1.289 gold `BZt` slash HAS BODY — `/ultraplan` is registered
> without `feature('ULTRAPLAN')`. `isEnabled` is `jj()` /
> `isUltraplanProductEnabled()`.

<Warning>
不要把 `ULTRAPLAN` 加回 `DEFAULT_BUILD_FEATURES`、不要再加
`feature('ULTRAPLAN')` 门。产品门是 GrowthBook `tengu_ultraplan_config.enabled`
+ CCR 资格 + 非 remote workspace。ultracode / ultrareview 关键字检测在
`src/utils/workflowKeyword.ts`。
</Warning>

## 模块

| 模块 | 现状 |
|------|------|
| `src/commands/ultraplan.tsx` | BZt slash；`availability: ['claude-ai']` |
| `src/components/ultraplan/` | Launch / Choice 对话框 |
| `src/utils/ultraplan/` | ccrSession / prompt |
| `src/utils/ultraplanKeyword.ts` | jj / C$t screening |
| AppState `ultraplan*` | launching / sessionUrl / pendingChoice / launchPending |
| ExitPlanMode 「refine with Ultraplan」 | `isUltraplanProductEnabled()` 时出现 |
| REPL ultraplan-choice / ultraplan-launch | `_Zt` overlay |

回归锁：`scripts/__tests__/ultraplanProductOff.222.test.ts`（旗标仍关）、
`src/utils/__tests__/ultraplanKeyword.289.test.ts`。
