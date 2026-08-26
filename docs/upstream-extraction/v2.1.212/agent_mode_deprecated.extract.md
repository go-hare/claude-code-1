# densable 2.1.212 — #42 Task/Agent `mode` deprecated (ignored)

Changelog:

> Deprecated the Task tool's `mode` parameter (now ignored); subagents inherit
> the parent session's permission mode by default

## densable schema

```js
mode: dAl().optional().describe(
  "Deprecated; ignored. Subagents inherit the parent session's permission mode; agent-definition frontmatter may override it.",
)
```

(`team_name` is separately marked deprecated/ignored for implicit-team — out of #42 scope.)

## densable Agent call

```js
let y = _n(l) // parent toolPermissionContext
let _ = y.mode // parent permission mode

// teammate spawn — plan from parent mode, NOT input mode
plan_mode_required: _ === 'plan'

// worker tool pool
ie = { ...y, mode: $.permissionMode ?? _ }
// $.permissionMode = agent definition frontmatter
// _ = parent session mode (default inherit)
```

Input `mode` is still on the schema for validation of old tool calls but is
**not read** in the call body.

## Local alignment

| densable | local (`AgentTool.tsx`) |
|----------|-------------------------|
| schema describe | same deprecated string |
| `_ = y.mode` | `permissionMode = appState.toolPermissionContext.mode` |
| `plan_mode_required:_==="plan"` | `permissionMode === 'plan'` (was `spawnMode === 'plan'`) |
| `mode:$.permissionMode??_` | `selectedAgent.permissionMode ?? permissionMode` (was `?? 'acceptEdits'`) |
| ignore input mode | destructure as `_deprecatedSpawnMode` + `void` |

`runAgent` still applies frontmatter overrides with parent-precedence rules for
`bypassPermissions` / `acceptEdits` / `auto` — unchanged.

## Not changed

- Agent frontmatter `permissionMode` still valid override
- Resume path `spawnMode` metadata chain (observer/resume) is separate from Task input `mode`
