# densable 2.1.232 #49 — remove custom subagent startup tip (+ /powerup nudge)

## Changelog

> Removed the custom subagent startup tip and `/powerup` nudge

## densable tip registry (SEA ~307688108)

Tip ids in order from `powerup-onboarding` … `feedback-command` include:

- `powerup-onboarding` (still present)
- … `image-paste` → **`agent-flag`** (no `custom-agents` between them)
- `desktop-app` …

**Missing id:** `custom-agents`  
**Missing copy:** `Use /agents to optimize specific tasks. Eg. Software Architect…`

### `powerup-onboarding` (not deleted product)

```js
{
  id: "powerup-onboarding",
  priority: 3,
  providerAgnostic: !0,
  content: async (e) =>
    `New to Claude Code? Run ${Fo("suggestion", e.theme)("/powerup")} for a quick interactive tutorial`,
  cooldownSessions: 1,
  async isRelevant() {
    let e = or()
    if (e.numStartups >= 10) return !1
    if (e.powerupsUnlocked?.length) return !1
    return rt("tengu_alder_compass", !1) // GB default false
  },
}
```

`/powerup` command + analytics (`tengu_powerup_discovery_shown` / lesson_*) still ship.  
Changelog “nudge” = aggressive discovery, not deletion of the gated tip/command.

## Local

- Removed `custom-agents` from `externalTips` in `tipRegistry.ts`
- Kept `agent-flag`
- No local `powerup-onboarding` tip id (residual onboarding env gate only)
