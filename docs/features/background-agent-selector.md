# 后台任务面板

官方 2.1.289 的底部任务面是 `CoordinatorTaskPanel`，定义在 `src/components/CoordinatorAgentStatus.tsx`，由 `src/components/PromptInput/PromptInputFooter.tsx` 挂载。面板有行时，输入框按 ↓ 进入 `tasks` footer，再按 ↑/↓ 在行之间移动，Enter 打开对应 agent 视图。

`src/screens/REPL.tsx` 只走这块面板。shell 任务在 `tasks` 选中且面板行数为 0 时，↓ 打开 bash 对话框。
