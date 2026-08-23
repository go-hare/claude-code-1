# AGENTS.md

**本项目的 agent 指令唯一来源是 [`CLAUDE.md`](./CLAUDE.md)。请直接阅读那个文件。**

这个文件存在只是为了被那些约定查找 `AGENTS.md` 的工具（Cursor、Codex 等）发现。它**不再**保存
任何独立内容。

## 为什么改成指针

`AGENTS.md` 曾经是 `CLAUDE.md` 的完整副本。两份内容必然分叉，而它们都是 agent 的行为指令来源，
于是过期的那一份会持续误导后续开发。副本最后停留在的状态包括：版本号 `2.1.888`（实际早已不是）、
「19 个 feature」（实际 42 个）、「默认全部关闭」（实际 dev/build 注入 42 个默认 ON）、
`bunx tsc --noEmit`（实际应跑 `bun run precheck`）。

一份文档比两份不同步的文档有用。

<!-- 不要把 CLAUDE.md 的内容再抄回这里。要改指令，改 CLAUDE.md。 -->
